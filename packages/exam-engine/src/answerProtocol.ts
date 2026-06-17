import type {
  AnswerRecord,
  AttemptStatus,
  SaveAnswerRequest,
  SaveAnswerResponse,
} from "@exam/domain";

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
  if (state.attemptStatus === "voided") {
    return {
      accepted: false,
      serverVersion: 0,
      savedAt: new Date().toISOString(),
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
      savedAt: new Date().toISOString(),
      conflict: { reason: "ATTEMPT_ALREADY_SUBMITTED" },
    };
  }

  if (
    state.deadlineAt &&
    state.now &&
    state.now.getTime() > state.deadlineAt.getTime()
  ) {
    return {
      accepted: false,
      serverVersion: 0,
      savedAt: new Date().toISOString(),
      conflict: { reason: "DEADLINE_EXCEEDED" },
    };
  }

  const idempotencyKey = `${request.questionId}:${request.clientSeq}`;
  const existingBySeq = state.clientSeqMap.get(idempotencyKey);
  if (existingBySeq) {
    return {
      accepted: true,
      serverVersion: existingBySeq.version,
      savedAt: existingBySeq.savedAt.toISOString(),
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
      savedAt: new Date().toISOString(),
      conflict: {
        reason: "STALE_VERSION",
        latestAnswer: existingAnswer?.answer,
      },
    };
  }

  const newVersion = currentVersion + 1;
  const now = new Date();
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
    savedAt: now.toISOString(),
    newAnswer,
    newClientSeqMap,
  };
}
