import { and, count, eq, or, sql } from "drizzle-orm";
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
 * repair command.
 *
 * Counting model (P7-S2 merge-review fix): the anomaly PREDICATES run inside
 * SQL over the FULL candidate set (`status='submitted'` for the tenant), so
 * the reported counts are exact totals no matter how many anomalies exist.
 * The `limit` (default 100) bounds only the returned anomaly SAMPLE, which is
 * ordered by attempt id (stable) so the sample is deterministic. The workset
 * entry count is a scalar subquery evaluated per candidate attempt — the DB
 * never aggregates the tenant's whole grading-entry history into Node.
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

      // Workset entry count per candidate attempt — a scalar subquery so the
      // DB aggregates only rows for attempts the anomaly predicates already
      // consider, never the tenant's whole grading-entry history. `::int`
      // keeps the value a JS number under the postgres driver (int8 decodes
      // as string by default).
      const entryCount = sql<number>`(
        SELECT count(*)::int FROM ${attemptGradingEntries}
        WHERE ${attemptGradingEntries.attemptId} = ${examAttempts.id}
          AND ${attemptGradingEntries.organizationId} = ${orgId}
      )`;
      // Frozen snapshot length. Defensive against non-array legacy JSONB:
      // jsonb_array_length would raise, turning corrupt data into a
      // diagnostics 500 ("healthy system → diagnostics works; corrupt system
      // → diagnostics crashes") instead of a detectable anomaly.
      const snapshotCount = sql<number>`CASE
        WHEN jsonb_typeof(${examAttempts.questionSnapshot}) = 'array'
        THEN jsonb_array_length(${examAttempts.questionSnapshot})
        ELSE 0
      END`;

      const tenantScoped = eq(examAttempts.organizationId, orgId);
      const submitted = eq(examAttempts.status, "submitted");
      const notTerminalized = eq(examAttempts.gradingStatus, "auto_graded");
      const worksetMismatch = sql`${entryCount} <> ${snapshotCount}`;

      // Exact totals over the FULL candidate set — SQL-side aggregates. The
      // counts are never derived from the bounded sample below, so an anomaly
      // beyond the first `limit` rows can never be missed.
      const [notTerminalizedTotal, worksetMismatchTotal] = await Promise.all([
        db
          .select({ n: count() })
          .from(examAttempts)
          .where(and(tenantScoped, submitted, notTerminalized)),
        db
          .select({ n: count() })
          .from(examAttempts)
          .where(and(tenantScoped, submitted, worksetMismatch)),
      ]);

      // Anomaly SAMPLE: only rows matching at least one predicate, in stable
      // attempt-id order, bounded by `limit`. One row can carry both kinds.
      const rows = await db
        .select({
          attemptId: examAttempts.id,
          examId: examAttempts.examId,
          enrollmentId: examAttempts.enrollmentId,
          candidateId: examAttempts.candidateId,
          status: examAttempts.status,
          gradingStatus: examAttempts.gradingStatus,
          submittedAt: examAttempts.submittedAt,
          gradedAt: examAttempts.gradedAt,
          gradingEntries: entryCount,
          snapshotQuestions: snapshotCount,
        })
        .from(examAttempts)
        .where(
          and(tenantScoped, submitted, or(notTerminalized, worksetMismatch)),
        )
        .orderBy(examAttempts.id)
        .limit(limit);

      const anomalies: AttemptIntegrityAnomaly[] = [];
      for (const row of rows) {
        const gradingEntries = Number(row.gradingEntries);
        const snapshotQuestions = Number(row.snapshotQuestions);

        if (row.gradingStatus === "auto_graded") {
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
            gradingEntries,
            snapshotQuestions,
          });
        }
        if (gradingEntries !== snapshotQuestions) {
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
            gradingEntries,
            snapshotQuestions,
          });
        }
        // Cap the sample itself (a row can produce up to two anomalies).
        if (anomalies.length >= limit) {
          break;
        }
      }

      return {
        submittedNotTerminalized: Number(notTerminalizedTotal[0]?.n ?? 0),
        submittedWorksetMismatch: Number(worksetMismatchTotal[0]?.n ?? 0),
        anomalies,
      };
    },
  };
}
