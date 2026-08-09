import { and, count, eq } from "drizzle-orm";
import { examAttempts, attemptGradingEntries } from "../schema/pg.js";
import { resolveOrganizationId } from "./baseRepo.js";
import type { Database, TenantContext } from "../types.js";

/**
 * P7-S2 Phase 7 — read-only attempt-integrity anomaly detection.
 *
 * Detects durable attempt shapes that the CURRENT runtime cannot produce
 * (proven by the P7-S2 crash-atomicity suite: submit freeze, workset
 * materialization, grading classification, and terminalization all commit in
 * ONE transaction). These rows can only exist via legacy versions, old bugs,
 * manual SQL, or backfill scripts:
 *
 *  - `submitted_not_terminalized`: `status='submitted' AND
 *    grading_status='auto_graded'` — the submit freeze committed but terminal
 *    grading never ran (submit+grade are one transaction today). The
 *    documented canonical repair is a re-invocation of the production
 *    submit+grade orchestrator, which grades a `submitted` attempt
 *    idempotently without re-submitting.
 *
 *  - `submitted_workset_mismatch`: `status='submitted'` with a grading
 *    workset entry count that differs from the frozen `question_snapshot`
 *    length — the workset must be materialized at the submit freeze barrier.
 *
 * Strictly READ-ONLY: this repo never mutates rows and never repairs.
 * Detection output carries enough identity (attempt/exam/enrollment ids,
 * timestamps, expected vs actual counts) for a human or a later canonical
 * repair command. Bounded to the first `limit` anomalies (default 100).
 */
export interface AttemptIntegrityAnomaly {
  kind: "submitted_not_terminalized" | "submitted_workset_mismatch";
  attemptId: string;
  examId: string;
  enrollmentId: string;
  candidateId: string;
  status: string;
  gradingStatus: string | null;
  submittedAt: Date | null;
  gradedAt: Date | null;
  gradingEntries: number;
  snapshotQuestions: number;
}

export interface AttemptIntegrityReport {
  submittedNotTerminalized: number;
  submittedWorksetMismatch: number;
  anomalies: AttemptIntegrityAnomaly[];
}

/** Creates the read-only attempt-integrity diagnostics repository. */
export function createIntegrityDiagnosticsRepo(db: Database) {
  return {
    /**
     * Finds attempt-integrity anomalies for the tenant, read-only.
     * Never throws for empty state; returns zeroed counts.
     */
    async findAttemptAnomalies(
      ctx: TenantContext,
      opts: { limit?: number } = {},
    ): Promise<AttemptIntegrityReport> {
      const orgId = resolveOrganizationId(ctx);
      const limit = Math.min(Math.max(opts.limit ?? 100, 1), 1000);

      // Workset entry counts per attempt (one row per attempt with entries).
      const entryCounts = await db
        .select({
          attemptId: attemptGradingEntries.attemptId,
          entryCount: count(),
        })
        .from(attemptGradingEntries)
        .where(eq(attemptGradingEntries.organizationId, orgId))
        .groupBy(attemptGradingEntries.attemptId);

      const countByAttempt = new Map(
        entryCounts.map((r) => [r.attemptId, Number(r.entryCount)]),
      );

      // All submitted attempts (the only status both anomalies can carry).
      const submitted = await db
        .select({
          attemptId: examAttempts.id,
          examId: examAttempts.examId,
          enrollmentId: examAttempts.enrollmentId,
          candidateId: examAttempts.candidateId,
          status: examAttempts.status,
          gradingStatus: examAttempts.gradingStatus,
          submittedAt: examAttempts.submittedAt,
          gradedAt: examAttempts.gradedAt,
          questionSnapshot: examAttempts.questionSnapshot,
        })
        .from(examAttempts)
        .where(
          and(
            eq(examAttempts.organizationId, orgId),
            eq(examAttempts.status, "submitted"),
          ),
        )
        .limit(limit);

      const anomalies: AttemptIntegrityAnomaly[] = [];
      let submittedNotTerminalized = 0;
      let submittedWorksetMismatch = 0;

      for (const row of submitted) {
        const snapshotCount = Array.isArray(row.questionSnapshot)
          ? row.questionSnapshot.length
          : 0;
        const entryCount = countByAttempt.get(row.attemptId) ?? 0;

        if (row.gradingStatus === "auto_graded") {
          submittedNotTerminalized += 1;
          anomalies.push({
            kind: "submitted_not_terminalized",
            attemptId: row.attemptId,
            examId: row.examId,
            enrollmentId: row.enrollmentId,
            candidateId: row.candidateId,
            status: row.status,
            gradingStatus: row.gradingStatus,
            submittedAt: row.submittedAt,
            gradedAt: row.gradedAt,
            gradingEntries: entryCount,
            snapshotQuestions: snapshotCount,
          });
        }
        if (entryCount !== snapshotCount) {
          submittedWorksetMismatch += 1;
          anomalies.push({
            kind: "submitted_workset_mismatch",
            attemptId: row.attemptId,
            examId: row.examId,
            enrollmentId: row.enrollmentId,
            candidateId: row.candidateId,
            status: row.status,
            gradingStatus: row.gradingStatus,
            submittedAt: row.submittedAt,
            gradedAt: row.gradedAt,
            gradingEntries: entryCount,
            snapshotQuestions: snapshotCount,
          });
        }
      }

      return { submittedNotTerminalized, submittedWorksetMismatch, anomalies };
    },
  };
}
