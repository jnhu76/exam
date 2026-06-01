import type {
  RequestContext,
  ExamAttempt,
  ScoreResult,
  SaveAnswerRequest,
  SaveAnswerResponse,
} from "@exam/domain";

// ── Command Function Signatures (§3.3) ───────────────────────────
// Type-only signatures for functions not yet implemented.
// Implemented functions are in examCommands.ts.

export declare function startAttempt(
  ctx: RequestContext,
  examId: string,
  candidateId: string,
): Promise<ExamAttempt>;

export declare function loadAttempt(
  ctx: RequestContext,
  attemptId: string,
): Promise<ExamAttempt>;

export declare function saveAnswer(
  ctx: RequestContext,
  attemptId: string,
  questionId: string,
  payload: SaveAnswerRequest,
): Promise<SaveAnswerResponse>;

export declare function submitAttempt(
  ctx: RequestContext,
  attemptId: string,
): Promise<void>;

export declare function gradeAttempt(
  ctx: RequestContext,
  attemptId: string,
): Promise<ScoreResult>;

export declare function markDisrupted(
  ctx: RequestContext,
  attemptId: string,
): Promise<void>;

export declare function restoreAttempt(
  ctx: RequestContext,
  attemptId: string,
): Promise<ExamAttempt>;

export declare function voidAttempt(
  ctx: RequestContext,
  attemptId: string,
  reason: string,
): Promise<void>;
