import type { Database } from "../types.js";
import { examAdmissions } from "../schema/pg.js";
import { resolveOptionalOrganizationId } from "./baseRepo.js";
import type { TenantContext } from "../types.js";
import type { RequestContext } from "@exam/domain";
import { and, asc, eq, isNull, lt, or, sql } from "drizzle-orm";

type AdmissionSelect = typeof examAdmissions.$inferSelect;

/** Plain durable membership row (framework-free; the API layer adapts it to
 * the engine's ExamAdmissionRepository interface). */
export interface AdmissionRow {
  id: string;
  organizationId: string;
  examId: string;
  candidateId: string;
  joinedAt: Date;
  admittedAt: Date | null;
  consumedAt: Date | null;
  consumedAttemptId: string | null;
}

function toRecord(row: AdmissionSelect): AdmissionRow {
  return {
    id: row.id,
    organizationId: row.organizationId,
    examId: row.examId,
    candidateId: row.candidateId,
    joinedAt: row.joinedAt,
    admittedAt: row.admittedAt,
    consumedAt: row.consumedAt,
    consumedAttemptId: row.consumedAttemptId,
  };
}

/**
 * #292 — PostgreSQL implementation of the engine's ExamAdmissionRepository.
 *
 * Correctness is carried by DB mechanics, not application `if`s: the partial
 * unique index owns "one ACTIVE membership per (org, exam, candidate)", the
 * CAS updates own write-once admission and single consumption, and callers
 * run the consume inside the attempt-start transaction.
 */
export function createExamAdmissionRepo(db: Database) {
  return {
    /**
     * Idempotent join: returns the existing ACTIVE row when present;
     * otherwise inserts a fresh membership. Concurrent duplicate joins
     * converge on ONE durable membership: the partial-unique arbiter absorbs
     * the conflict, and the two documented retryable interleavings are
     * handled in place — 23505 (loser re-reads the winner's row) and 40001
     * ("could not serialize access due to concurrent update", the
     * speculative-insertion race PostgreSQL documents as retryable).
     */
    async joinActive(
      ctx: TenantContext | RequestContext,
      input: {
        organizationId: string;
        examId: string;
        candidateId: string;
        joinedAt: Date;
      },
    ): Promise<AdmissionRow> {
      void resolveOptionalOrganizationId(ctx);
      const readActive = async (): Promise<AdmissionRow | null> => {
        const existing = await db
          .select()
          .from(examAdmissions)
          .where(
            and(
              eq(examAdmissions.organizationId, input.organizationId),
              eq(examAdmissions.examId, input.examId),
              eq(examAdmissions.candidateId, input.candidateId),
              isNull(examAdmissions.consumedAt),
            ),
          )
          .limit(1);
        return existing[0] ? toRecord(existing[0]) : null;
      };

      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const inserted = await db
            .insert(examAdmissions)
            .values({
              id: crypto.randomUUID(),
              organizationId: input.organizationId,
              examId: input.examId,
              candidateId: input.candidateId,
              joinedAt: input.joinedAt,
            })
            .onConflictDoNothing({
              target: [
                examAdmissions.organizationId,
                examAdmissions.examId,
                examAdmissions.candidateId,
              ],
              where: sql`consumed_at IS NULL`,
            })
            .returning();
          if (inserted[0]) {
            return toRecord(inserted[0]);
          }
          const existing = await readActive();
          if (existing) {
            return existing;
          }
          // Arbiter matched a row that was consumed between conflict and
          // read: loop and insert a fresh membership.
        } catch (err) {
          // Drizzle wraps driver errors — walk the cause chain for the
          // driver's SQLSTATE (same traversal the API error boundary uses).
          let current: unknown = err;
          let code: string | undefined;
          while (current && typeof current === "object") {
            code = (current as { code?: string }).code;
            if (code) break;
            current = (current as { cause?: unknown }).cause;
          }
          if (code !== "40001" && code !== "23505") {
            throw err;
          }
          const existing = await readActive();
          if (existing) {
            return existing;
          }
        }
      }
      throw new Error("exam_admissions: joinActive did not converge");
    },

    async findActive(
      ctx: TenantContext | RequestContext,
      organizationId: string,
      examId: string,
      candidateId: string,
    ): Promise<AdmissionRow | null> {
      void resolveOptionalOrganizationId(ctx);
      const rows = await db
        .select()
        .from(examAdmissions)
        .where(
          and(
            eq(examAdmissions.organizationId, organizationId),
            eq(examAdmissions.examId, examId),
            eq(examAdmissions.candidateId, candidateId),
            isNull(examAdmissions.consumedAt),
          ),
        )
        .limit(1);
      return rows[0] ? toRecord(rows[0]) : null;
    },

    async earliestActiveJoinedAt(
      ctx: TenantContext | RequestContext,
      organizationId: string,
      examId: string,
    ): Promise<Date | null> {
      void resolveOptionalOrganizationId(ctx);
      const rows = await db
        .select({ joinedAt: examAdmissions.joinedAt })
        .from(examAdmissions)
        .where(
          and(
            eq(examAdmissions.organizationId, organizationId),
            eq(examAdmissions.examId, examId),
            isNull(examAdmissions.consumedAt),
          ),
        )
        .orderBy(asc(examAdmissions.joinedAt), asc(examAdmissions.id))
        .limit(1);
      return rows[0]?.joinedAt ?? null;
    },

    async countActiveAhead(
      ctx: TenantContext | RequestContext,
      organizationId: string,
      examId: string,
      joinedAt: Date,
      id: string,
    ): Promise<number> {
      void resolveOptionalOrganizationId(ctx);
      const rows = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(examAdmissions)
        .where(
          and(
            eq(examAdmissions.organizationId, organizationId),
            eq(examAdmissions.examId, examId),
            isNull(examAdmissions.consumedAt),
            // Durable ordering key: (joined_at, id) — stable tie-breaker.
            or(
              lt(examAdmissions.joinedAt, joinedAt),
              and(
                eq(examAdmissions.joinedAt, joinedAt),
                lt(examAdmissions.id, id),
              ),
            ),
          ),
        );
      return rows[0]?.count ?? 0;
    },

    async admitOnce(
      ctx: TenantContext | RequestContext,
      id: string,
      admittedAt: Date,
    ): Promise<AdmissionRow | null> {
      void resolveOptionalOrganizationId(ctx);
      const rows = await db
        .update(examAdmissions)
        .set({ admittedAt, updatedAt: admittedAt })
        .where(
          and(eq(examAdmissions.id, id), isNull(examAdmissions.admittedAt)),
        )
        .returning();
      return rows[0] ? toRecord(rows[0]) : null;
    },

    async consumeActive(
      ctx: TenantContext | RequestContext,
      organizationId: string,
      examId: string,
      candidateId: string,
      consumedAt: Date,
      attemptId: string,
    ): Promise<AdmissionRow | null> {
      void resolveOptionalOrganizationId(ctx);
      const rows = await db
        .update(examAdmissions)
        .set({
          consumedAt,
          consumedAttemptId: attemptId,
          updatedAt: consumedAt,
        })
        .where(
          and(
            eq(examAdmissions.organizationId, organizationId),
            eq(examAdmissions.examId, examId),
            eq(examAdmissions.candidateId, candidateId),
            isNull(examAdmissions.consumedAt),
          ),
        )
        .returning();
      return rows[0] ? toRecord(rows[0]) : null;
    },

    async listByExam(
      ctx: TenantContext | RequestContext,
      organizationId: string,
      examId: string,
    ): Promise<AdmissionRow[]> {
      void resolveOptionalOrganizationId(ctx);
      const rows = await db
        .select()
        .from(examAdmissions)
        .where(
          and(
            eq(examAdmissions.organizationId, organizationId),
            eq(examAdmissions.examId, examId),
          ),
        )
        .orderBy(asc(examAdmissions.joinedAt), asc(examAdmissions.id));
      return rows.map(toRecord);
    },
  };
}

export type ExamAdmissionRepo = ReturnType<typeof createExamAdmissionRepo>;
