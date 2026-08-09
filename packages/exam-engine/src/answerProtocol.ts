import {
  NotFoundError,
  ValidationError,
  type AnswerRecord,
  type AttemptStatus,
  type ExamAttempt,
  type QuestionSnapshot,
  type SaveAnswerRequest,
  type SaveAnswerResponse,
  type SubmittedAnswersSnapshot,
} from "@exam/domain";
import type { AttemptRepository } from "./attemptCommands.js";
import type { ReconciledAttemptMutationContext } from "./deadlineReconciliation.js";

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

  // EXAM-ANSWER-PRECONDITION-CORRECTIVE-0 §11 — canonical expiry predicate is
  // `now >= effectiveDeadline`. Equality at the deadline is expired, aligning
  // the pure Save decision with the canonical `isAttemptDeadlineExpired`
  // authority (`now >= computeEffectiveDeadline(...)`). This closes the prior
  // `>` vs `>=` boundary divergence at the instant `now === deadlineAt`.
  if (state.deadlineAt && now.getTime() >= state.deadlineAt.getTime()) {
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

  // P7-S2-B (ANSWER_BASE_VERSION_MUST_EQUAL_CURRENT_VERSION): a future
  // baseVersion is impossible client state and must not be accepted as a
  // legitimate update based on `currentVersion`. The idempotency-key replay
  // above already handled same-`clientSeq` replays, so any request reaching
  // here with `baseVersion > currentVersion` claims a version that does not
  // exist yet — reject it instead of silently advancing to `currentVersion+1`.
  if (request.baseVersion > currentVersion) {
    return {
      accepted: false,
      serverVersion: currentVersion,
      savedAt: savedAtIso,
      conflict: {
        reason: "FUTURE_VERSION",
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

// ── Save Answer composite action (EXAM-ANSWER-CLOSURE-0) ──────────
//
// The helpers below are the protocol-state reconstruction + accepted-result
// application that previously lived in the API route. They are engine-internal:
// the route now delegates to `saveAnswer`, which owns load → reconstruct →
// decide (pure `processSaveAnswer`) → apply → persist. `processSaveAnswer`
// stays a pure, independently-tested decision core.

/**
 * A draft answer row as persisted on `exam_attempts.answers`. Mirrors the
 * JSONB shape written by prior versions of the save protocol: the engine
 * reconstructs this representation internally and never exposes it as a caller
 * responsibility.
 *
 * `savedAt` may be a Date or an ISO string on read (legacy JSONB); `clientSeq`
 * / `clientSeqHistory` carry the idempotency receipts.
 */
interface PersistedAnswer extends Omit<AnswerRecord, "savedAt"> {
  savedAt: Date | string;
  clientSeq?: number;
  clientSeqHistory?: PersistedAnswerReceipt[];
}

/** A single prior client-side save receipt persisted for idempotency replay. */
interface PersistedAnswerReceipt {
  clientSeq: number;
  answer: unknown;
  version: number;
  savedAt: Date | string;
}

/**
 * Normalizes persisted draft answers so `savedAt` is always a Date, recursively
 * through the clientSeq history receipts. Pure.
 */
function normalizePersistedAnswers(
  answers: PersistedAnswer[],
): PersistedAnswer[] {
  return answers.map((a) => ({
    ...a,
    savedAt: typeof a.savedAt === "string" ? new Date(a.savedAt) : a.savedAt,
    ...(a.clientSeqHistory
      ? {
          clientSeqHistory: a.clientSeqHistory.map((receipt) => ({
            ...receipt,
            savedAt:
              typeof receipt.savedAt === "string"
                ? new Date(receipt.savedAt)
                : receipt.savedAt,
          })),
        }
      : {}),
  }));
}

/**
 * Builds the `questionId:clientSeq` → AnswerRecord lookup used by the
 * idempotency check inside `processSaveAnswer`. Pure.
 */
function buildClientSeqMap(
  answers: PersistedAnswer[],
): Map<string, AnswerRecord> {
  const map = new Map<string, AnswerRecord>();
  for (const answer of answers) {
    for (const receipt of answer.clientSeqHistory ?? []) {
      map.set(`${answer.questionId}:${receipt.clientSeq}`, {
        questionId: answer.questionId,
        answer: receipt.answer,
        version: receipt.version,
        savedAt: new Date(receipt.savedAt),
      });
    }
    if (answer.clientSeq !== undefined) {
      map.set(`${answer.questionId}:${answer.clientSeq}`, {
        questionId: answer.questionId,
        answer: answer.answer,
        version: answer.version,
        savedAt:
          answer.savedAt instanceof Date
            ? answer.savedAt
            : new Date(answer.savedAt),
      });
    }
  }
  return map;
}

/**
 * Reconstructs the persisted draft-answer state for the accepted result: folds
 * the new answer into the existing list, carrying forward the prior answer's
 * clientSeq as a history receipt (when its clientSeq was set). Pure — returns
 * the next persisted answers array without mutating the input.
 *
 * The persisted JSONB column (`exam_attempts.answers`) stores a wider shape than
 * `AnswerRecord` — it additionally carries `clientSeq` / `clientSeqHistory`
 * receipts used for idempotent replay. Those additive fields ride alongside the
 * `AnswerRecord` core; the returned array is typed `AnswerRecord[]` (the
 * declared column shape) with the extra metadata preserved structurally.
 * `savedAt` is always a `Date` here because `normalizePersistedAnswers` has
 * already run on the input prior to this call.
 */
function applyAcceptedResult(
  storedAnswers: PersistedAnswer[],
  newAnswer: AnswerRecord,
  request: SaveAnswerRequest,
): AnswerRecord[] {
  const previousAnswer = storedAnswers.find(
    (a) => a.questionId === request.questionId,
  );
  const previousReceipt =
    previousAnswer?.clientSeq === undefined
      ? []
      : [
          {
            clientSeq: previousAnswer.clientSeq,
            answer: previousAnswer.answer,
            version: previousAnswer.version,
            savedAt: previousAnswer.savedAt,
          },
        ];
  const storedNewAnswer = {
    ...newAnswer,
    clientSeq: request.clientSeq,
    clientSeqHistory: [
      ...(previousAnswer?.clientSeqHistory ?? []),
      ...previousReceipt,
    ],
  };
  return storedAnswers
    .filter((a) => a.questionId !== request.questionId)
    .concat([storedNewAnswer]) as unknown as AnswerRecord[];
}

/**
 * Canonical composite Save Answer protocol action
 * (EXAM-ANSWER-CLOSURE-0 + EXAM-ANSWER-PRECONDITION-CORRECTIVE-0).
 *
 * Owns the full SAVE_ANSWER action inside the engine:
 *
 *   consume opaque mutation evidence (provenance + repo affinity)
 *     → load authoritative persisted attempt state
 *     → P1: validate questionId ∈ attempt.questionSnapshot (local legality)
 *     → reconstruct AnswerState (normalize + build clientSeqMap)
 *     → invoke the pure `processSaveAnswer` decision core using the CANONICAL
 *       effective deadline from the mutation context (P3), not attempt.deadlineAt
 *     → on accept: apply the result and persist `attempt.answers` + heartbeat,
 *       stamped with the context's authoritative checkedAt
 *     → return the semantic result
 *
 * Precondition evidence (`mutationContext`): minted by the canonical
 * preparation seam (`prepareReconciledAttemptMutation`) AFTER the EA lock seam
 * and canonical deadline reconciliation have run. The evidence carries attempt
 * identity, the authoritative checked-at snapshot, the canonical effective
 * deadline (output of `computeEffectiveDeadline`), and the exact
 * transaction-scoped AttemptRepository the seam minted against. This action
 * runtime-asserts repo affinity against that exact object — proving the
 * Attempt row lock established through the EA capability path is the one this
 * action mutates under (P2).
 *
 * The action does NOT accept the EA capability directly, does NOT acquire its
 * own row lock, does NOT load the Exam, and does NOT run deadline
 * reconciliation — those cross-region facts arrive as narrow evidence. The
 * context is attempt-bound, checkedAt-bound, and AttemptRepository-bound; it
 * cannot be reused with a different transaction/repository object.
 *
 * The caller (API route) is responsible ONLY for: transaction composition, the
 * EA lock predecessor seam (`lockEnrollmentAndAttempt`), the canonical
 * preparation seam, candidate-ownership checks, and mapping the returned
 * semantic result to the wire contract. It must NOT construct `AnswerState`,
 * rebuild the clientSeqMap, compute the effective deadline, or write
 * `attempt.answers` itself.
 *
 * Persistence semantics:
 *   - accepted NEW answer        → single `update({ answers, lastActivityAt })`
 *   - accepted idempotent replay → NO WRITE (the prior savedAt is returned)
 *   - any rejection              → NO WRITE (draft answers unchanged)
 *
 * @throws {NotFoundError} attempt not found.
 * @throws {ValidationError} request.attemptId does not match the context's
 *   bound attempt identity, or the request targets a question that is not a
 *   member of the attempt's frozen question snapshot (P1 local legality).
 * @throws {Error} mutation-context repo-affinity violation (P2).
 */
export async function saveAnswer(
  attemptRepo: AttemptRepository,
  mutationContext: ReconciledAttemptMutationContext,
  request: SaveAnswerRequest,
): Promise<ProcessSaveResult> {
  // P2 — mechanical precondition evidence. Assert the context was minted against
  // the exact AttemptRepository object this action is now using. This proves the
  // Attempt row lock established through the EA capability path is the one whose
  // read-modify-write window this action runs under. Throws before any mutation.
  mutationContext.assertAttemptRepository(attemptRepo);

  // Identity binding — the context is bound to one attempt identity; the request
  // must target that same attempt. Do not silently trust a mismatched identity.
  if (request.attemptId !== mutationContext.attemptId) {
    throw new ValidationError(
      "Save answer request attemptId does not match the mutation context's bound attempt identity",
    );
  }

  const attempt = await attemptRepo.findById(mutationContext.attemptId);
  if (!attempt) {
    throw new NotFoundError("Attempt not found");
  }

  // P1 — local legality. The attempt is a frozen universe of questions
  // (`questionSnapshot`, INV-010). Accepting an answer for a question outside
  // that universe produces a structurally invalid `attempt.answers` element, so
  // the Save Answer command itself must be illegal. This internalizes the
  // invariant the old route owned (the route's `.some(...)` guard is removed).
  // Preserved error semantics: ValidationError, matching the old route throw.
  // Defensive guard: questionSnapshot may be null/undefined on legacy rows.
  const snapshot = attempt.questionSnapshot ?? [];
  const isMember = snapshot.some(
    (q) => q.originalQuestionId === request.questionId,
  );
  if (!isMember) {
    throw new ValidationError("问题不在此尝试中");
  }

  const storedAnswers = normalizePersistedAnswers(
    (attempt.answers ?? []) as PersistedAnswer[],
  );
  const clientSeqMap = buildClientSeqMap(storedAnswers);

  // P3 — the canonical effective deadline. The pure decision receives the
  // canonical effective deadline from the mutation context (output of
  // `computeEffectiveDeadline(exam, attempt)`), NOT `attempt.deadlineAt`. This
  // closes the reachability gap where a reachable active attempt can have
  // `attempt.deadlineAt > exam.closeAt`: the action now refuses a save past the
  // canonical `min(exam.closeAt, attempt.deadlineAt)` even when called without
  // the predecessor. The checkedAt snapshot is the single time authority for
  // the deadline decision, savedAt, and lastActivityAt — never a second
  // caller-provided `now`.
  const saveResult = processSaveAnswer(
    {
      attemptStatus: attempt.status as AttemptStatus,
      answers: attempt.answers,
      clientSeqMap,
      deadlineAt: mutationContext.effectiveDeadline,
      now: mutationContext.checkedAt,
    },
    request,
  );

  // Apply ONLY on an accepted NEW answer. An idempotent replay returns
  // accepted:true with no `newAnswer` and must NOT trigger a write — the prior
  // savedAt is returned to the caller verbatim. Rejections never write.
  if (saveResult.accepted && saveResult.newAnswer) {
    const newAnswers = applyAcceptedResult(
      storedAnswers,
      saveResult.newAnswer,
      request,
    );
    await attemptRepo.update(mutationContext.attemptId, {
      answers: newAnswers,
      lastActivityAt: mutationContext.checkedAt,
    });
  }

  return saveResult;
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
      // Map.get returns undefined for missing keys; ?? null normalizes both
      // "no answer record" and "answer record with null value" to null.
      value: answerByQuestion.get(q.originalQuestionId) ?? null,
    })),
  };
}
