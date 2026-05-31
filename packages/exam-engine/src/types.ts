import type {
  RequestContext,
  ExamAttempt,
  QuestionSnapshot,
  AnswerRecord,
  ScoreResult,
  GradingRule,
  SaveAnswerRequest,
  SaveAnswerResponse,
} from "@exam/domain";

// ── Command Function Signatures (§3.3) ───────────────────────────
// Type-only signatures — no implementation in this package.

export declare function publishExam(
  ctx: RequestContext,
  examId: string,
): Promise<void>;

export declare function openExam(
  ctx: RequestContext,
  examId: string,
): Promise<void>;

export declare function closeExam(
  ctx: RequestContext,
  examId: string,
): Promise<void>;

export declare function archiveExam(
  ctx: RequestContext,
  examId: string,
): Promise<void>;

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
