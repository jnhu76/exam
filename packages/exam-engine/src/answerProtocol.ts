import type {
  AnswerRecord,
  AttemptStatus,
  QuestionSnapshot,
  SaveAnswerRequest,
  SaveAnswerResponse,
  SubmittedAnswersSnapshot,
} from "@exam/domain";

/**
 * Stable structural equality for answer values.
 *
 * - Primitives (boolean, string, number, null, undefined): Object.is
 * - Arrays: element-by-element, ordered comparison
 * - Plain objects: sorted-key comparison
 *
 * Designed for the Answer Save Protocol idempotency check where the same
 * clientSeq must only be accepted if the payload is structurally identical.
 */
function answersEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!answersEqual(a[i], b[i])) return false;
    }
    return true;
  }

  if (
    a !== null &&
    b !== null &&
    typeof a === "object" &&
    typeof b === "object" &&
    !Array.isArray(a) &&
    !Array.isArray(b)
  ) {
    const keysA = Object.keys(a as Record<string, unknown>);
    const keysB = Object.keys(b as Record<string, unknown>);
    if (keysA.length !== keysB.length) return false;
    const sortedA = [...keysA].sort();
    const sortedB = [...keysB].sort();
    for (let i = 0; i < sortedA.length; i++) {
      if (sortedA[i] !== sortedB[i]) return false;
      const key = sortedA[i] as string;
      if (
        !answersEqual(
          (a as Record<string, unknown>)[key],
          (b as Record<string, unknown>)[key],
        )
      ) {
        return false;
      }
    }
    return true;
  }

  return false;
}

/** State required by the answer save protocol to evaluate an incoming save request. */
export interface AnswerState {
  attemptStatus: AttemptStatus;
  answers: AnswerRecord[];
  clientSeqMap: Map<string, AnswerRecord>;
  deadlineAt?: Date;
  now?: Date;
}

/** Response from the answer save protocol, including newly created answer and updated idempotency map when accepted. */
export type ProcessSaveResult = SaveAnswerResponse & {
  newAnswer?: AnswerRecord;
  newClientSeqMap?: Map<string, AnswerRecord>;
};

/** Processes a single answer save request using versioned, idempotent conflict detection. */
export function processSaveAnswer(
  state: AnswerState,
  request: SaveAnswerRequest,
): ProcessSaveResult {
  // ADR-006: the exam-engine layer never reads the wall clock. The operation
  // `now` arrives via `state.now` from the API layer (fastify.now()). It is the
  // single time authority for every timestamp this function emits. The fallback
  // only applies if a caller forgets to supply it; the production route always
  // does, so the engine never reaches the fallback at runtime.
  const now = state.now ?? new Date();
  const savedAtIso = now.toISOString();

  if (state.attemptStatus === "voided") {
    return {
      accepted: false,
      serverVersion: 0,
      savedAt: savedAtIso,
      conflict: { reason: "ATTEMPT_CLOSED" },
    };
  }

  if (
    state.attemptStatus === "submitted" ||
    state.attemptStatus === "grading" ||
    state.attemptStatus === "graded"
  ) {
    return {
      accepted: false,
      serverVersion: 0,
      savedAt: savedAtIso,
      conflict: { reason: "ATTEMPT_ALREADY_SUBMITTED" },
    };
  }

  if (state.deadlineAt && now.getTime() > state.deadlineAt.getTime()) {
    return {
      accepted: false,
      serverVersion: 0,
      savedAt: savedAtIso,
      conflict: { reason: "DEADLINE_EXCEEDED" },
    };
  }

  const idempotencyKey = `${request.questionId}:${request.clientSeq}`;
  const existingBySeq = state.clientSeqMap.get(idempotencyKey);
  if (existingBySeq) {
    // Same idempotency key: if the payload is structurally identical,
    // it's a safe replay — return the prior result.
    // If the payload differs, the client is misusing this key — reject
    // as a conflicting payload to prevent silent data loss.
    if (answersEqual(existingBySeq.answer, request.answer)) {
      return {
        accepted: true,
        serverVersion: existingBySeq.version,
        savedAt: existingBySeq.savedAt.toISOString(),
      };
    }
    return {
      accepted: false,
      serverVersion: existingBySeq.version,
      savedAt: savedAtIso,
      conflict: {
        reason: "CONFLICTING_PAYLOAD" as const,
        latestAnswer: existingBySeq.answer,
      },
    };
  }

  const existingAnswer = state.answers.find(
    (a) => a.questionId === request.questionId,
  );
  const currentVersion = existingAnswer?.version ?? 0;

  if (request.baseVersion < currentVersion) {
    return {
      accepted: false,
      serverVersion: currentVersion,
      savedAt: savedAtIso,
      conflict: {
        reason: "STALE_VERSION",
        latestAnswer: existingAnswer?.answer,
      },
    };
  }

  const newVersion = currentVersion + 1;
  const newAnswer: AnswerRecord = {
    questionId: request.questionId,
    answer: request.answer,
    version: newVersion,
    savedAt: now,
  };

  const newClientSeqMap = new Map(state.clientSeqMap);
  newClientSeqMap.set(idempotencyKey, newAnswer);

  return {
    accepted: true,
    serverVersion: newVersion,
    savedAt: savedAtIso,
    newAnswer,
    newClientSeqMap,
  };
}

/**
 * Builds the frozen {@link SubmittedAnswersSnapshot} written to
 * `exam_attempts.submitted_answers` at submit time (P3-L0-2 / ADR-008).
 *
 * Normalizes draft {@link AnswerRecord}s against the attempt's question
 * snapshot: every snapshot question becomes one entry, ordered by the
 * snapshot's `order` field (NOT by answer-record arrival order). Protocol
 * metadata (version / savedAt / clientSeq / baseVersion) is stripped — the
 * frozen snapshot carries only `{ questionId, value }`. Unanswered questions
 * yield `value: null` so the snapshot is a complete answer set.
 *
 * Pure function: no IO, no mutation of inputs. Caller (`submitAttempt`)
 * runs this inside the locked submit transaction so the captured answers
 * are exactly those that existed when the row lock was held.
 */
export function buildSubmittedAnswersSnapshot(
  draftAnswers: AnswerRecord[],
  questionSnapshot: QuestionSnapshot[],
): SubmittedAnswersSnapshot {
  const answerByQuestion = new Map(
    draftAnswers.map((a) => [a.questionId, a.answer]),
  );

  const ordered = [...questionSnapshot].sort((a, b) => a.order - b.order);

  return {
    schemaVersion: 1,
    answers: ordered.map((q) => ({
      questionId: q.originalQuestionId,
      value: answerByQuestion.has(q.originalQuestionId)
        ? (answerByQuestion.get(q.originalQuestionId) ?? null)
        : null,
    })),
  };
}
