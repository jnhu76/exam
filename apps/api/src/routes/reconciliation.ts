import type { FastifyInstance, FastifyRequest } from "fastify";
import type { RequestContext, Exam } from "@exam/domain";
import { checkAndUpdateExamStatus } from "@exam/exam-engine";
import type { ExamRepository } from "@exam/exam-engine";
import { recordAudit } from "./audit.js";

/**
 * Structured result of an automatic exam status reconciliation.
 *
 * - `changed: false` — no status transition occurred; no audit written.
 * - `changed: true` — one or two status transitions persisted; `auditActions`
 *   lists the audit action(s) the caller should record (after tx for
 *   mutations, immediately for reads).
 */
export type ReconciliationResult =
  | { exam: Exam; changed: false }
  | {
      exam: Exam;
      changed: true;
      fromStatus: string;
      toStatus: string;
      auditActions: string[];
    };

/**
 * Core reconciliation logic shared by read and mutation paths.
 * Calls `checkAndUpdateExamStatus`, computes audit actions per J2.7 policy,
 * but does NOT record audits — callers decide when/how to record.
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

  const auditActions: string[] = [];

  // J2.7 double-transition edge case: published → open → closed in one pass.
  // `transition` is "closed" (the last one), but we need to emit both audits.
  if (previousStatus === "published" && transition === "closed") {
    auditActions.push("exam.open", "exam.closed");
  } else {
    auditActions.push(`exam.${transition}`);
  }

  return {
    exam,
    changed: true,
    fromStatus: previousStatus,
    toStatus: exam.status,
    auditActions,
  };
}

/**
 * Reconcile exam status for read-only entry points (candidate list, detail,
 * start attempt). Records audit immediately if a transition occurred.
 *
 * Use this when the caller is NOT inside a transaction and does not hold
 * a row-level lock. No transaction or lock is acquired here.
 */
export async function reconcileExamForRead(
  repo: ExamRepository,
  examId: string,
  now: Date,
  fastify: FastifyInstance,
  request: FastifyRequest,
  ctx: RequestContext,
): Promise<ReconciliationResult | null> {
  const result = await reconcileExamCore(repo, examId, now);
  if (!result) return null;

  if (result.changed) {
    for (const action of result.auditActions) {
      recordAudit(fastify, request, ctx, action, "exam", examId);
    }
  }

  return result;
}

/**
 * Reconcile exam status for mutation entry points (admin close, extend,
 * cancel, archive, etc.). Returns audit actions for the caller to record
 * AFTER the transaction commits.
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
