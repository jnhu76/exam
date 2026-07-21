import type { RequestContext, Exam } from "@exam/domain";
import type { Database } from "@exam/db/src/types.js";
import { executeInTransaction } from "@exam/db/src/types.js";
import { createExamRepo } from "@exam/db/src/repository/examRepo.js";
import { checkAndUpdateExamStatus } from "@exam/exam-engine";
import type { ExamRepository } from "@exam/exam-engine";
import { createExamRepoAdapter } from "../adapters/repoAdapters.js";

/**
 * Structured result of an automatic exam status reconciliation.
 *
 * - `changed: false` — no status transition occurred.
 * - `changed: true` — a canonical domain status transition persisted.
 */
export type ReconciliationResult =
  | { exam: Exam; changed: false }
  | {
      exam: Exam;
      changed: true;
      fromStatus: string;
      toStatus: string;
    };

/**
 * Core reconciliation logic shared by read and mutation paths.
 * Calls `checkAndUpdateExamStatus` and returns the canonical domain result.
 */
async function reconcileExamCore(
  repo: ExamRepository,
  examId: string,
  now: Date,
): Promise<ReconciliationResult | null> {
  const result = await checkAndUpdateExamStatus(repo, examId, now);
  if (!result) return null;

  const { exam, transition, previousStatus } = result;

  if (!transition || !previousStatus) {
    return { exam, changed: false };
  }

  return {
    exam,
    changed: true,
    fromStatus: previousStatus,
    toStatus: exam.status,
  };
}

/**
 * Reconcile exam status for read-only entry points (candidate list, detail,
 * start attempt).
 *
 * Use this when the caller is not already inside a transaction. The helper
 * owns a short transaction and row lock so concurrent reconciliation cannot
 * race another status mutation.
 */
export async function reconcileExamForRead(
  db: Database,
  examId: string,
  now: Date,
  ctx: RequestContext,
): Promise<ReconciliationResult | null> {
  return executeInTransaction(db, async (tx) => {
    const repo = createExamRepo(tx);
    const locked = await repo.findByIdForUpdate(ctx, examId);
    if (!locked) return null;
    const result = await reconcileExamCore(
      createExamRepoAdapter(repo, ctx),
      examId,
      now,
    );
    if (!result) return null;

    return result;
  });
}

/**
 * Reconcile exam status for mutation entry points (admin close, extend,
 * cancel, archive, etc.).
 *
 * Use this when the caller already holds a transaction and row-level lock.
 * No transaction or lock is acquired here.
 */
export async function reconcileExamForMutation(
  repo: ExamRepository,
  examId: string,
  now: Date,
): Promise<ReconciliationResult | null> {
  return reconcileExamCore(repo, examId, now);
}
