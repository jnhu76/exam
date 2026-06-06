import type { RequestContext, ExamAttempt, ScoreResult } from "@exam/domain";

export declare function loadAttempt(
  ctx: RequestContext,
  attemptId: string,
): Promise<ExamAttempt>;

export declare function gradeAttempt(
  ctx: RequestContext,
  attemptId: string,
): Promise<ScoreResult>;

export declare function voidAttempt(
  ctx: RequestContext,
  attemptId: string,
  reason: string,
): Promise<void>;
