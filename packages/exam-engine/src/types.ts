import type { RequestContext, ExamAttempt, ScoreResult } from "@exam/domain";

/** Loads an exam attempt by ID within the given request context. */
export declare function loadAttempt(
  ctx: RequestContext,
  attemptId: string,
): Promise<ExamAttempt>;

/** Grades an exam attempt by ID within the given request context. */
export declare function gradeAttempt(
  ctx: RequestContext,
  attemptId: string,
): Promise<ScoreResult>;

/** Voids an exam attempt with a reason, marking it as no longer valid. */
export declare function voidAttempt(
  ctx: RequestContext,
  attemptId: string,
  reason: string,
): Promise<void>;
