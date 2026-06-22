import type { Database } from "../types.js";
import { manualGradingEntries } from "../schema/pg.js";
import { createAsyncTenantCrudRepo } from "./baseRepo.js";
import { resolveOrganizationId } from "./baseRepo.js";
import type { TenantContext } from "../types.js";
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@exam/domain";
import { and, asc, eq } from "drizzle-orm";

type ManualGradingEntrySelect = (typeof manualGradingEntries)["$inferSelect"];

/** Input shape for upserting a manual grading entry (P2D-J3). */
export interface ManualGradingEntryUpsertInput {
  attemptId: string;
  questionId: string;
  score: number;
  maxScore: number;
  comment: string;
  gradedBy: string;
  gradedAt: Date;
  /** Timestamp for updatedAt; must be supplied by the caller (ADR-006). */
  now: Date;
}

/**
 * Creates the manual-grading-entry repository. Read operations are exposed
 * directly; the write path is `upsert` (P2D-J3) — the J2 model layer deferred
 * all writes to the grading command layer. `upsert` targets the
 * `(attemptId, questionId)` unique index so re-grading overwrites the prior
 * score rather than rejecting the duplicate.
 */
export function createManualGradingRepo(db: Database) {
  const repo = createAsyncTenantCrudRepo(db, manualGradingEntries);

  return {
    // Read-only CRUD surface (create/update/delete deliberately omitted;
    // `upsert` below is the single write path).
    findById: repo.findById,
    list: repo.list,
    count: repo.count,
    listPaginated: repo.listPaginated,
    /**
     * Lists all manual grading entries for an attempt, scoped to the tenant.
     * Ordered by questionId for deterministic results.
     */
    async findByAttempt(
      ctx: TenantContext | RequestContext,
      attemptId: string,
    ): Promise<ManualGradingEntrySelect[]> {
      const orgId = resolveOrganizationId(ctx);
      return db
        .select()
        .from(manualGradingEntries)
        .where(
          and(
            eq(manualGradingEntries.organizationId, orgId),
            eq(manualGradingEntries.attemptId, attemptId),
          ),
        )
        .orderBy(asc(manualGradingEntries.questionId));
    },
    /**
     * Finds the single manual grading entry for a given attempt + question,
     * scoped to the tenant. Returns null when no entry exists yet.
     */
    async findByAttemptAndQuestion(
      ctx: TenantContext | RequestContext,
      attemptId: string,
      questionId: string,
    ): Promise<ManualGradingEntrySelect | null> {
      const orgId = resolveOrganizationId(ctx);
      const rows = await db
        .select()
        .from(manualGradingEntries)
        .where(
          and(
            eq(manualGradingEntries.organizationId, orgId),
            eq(manualGradingEntries.attemptId, attemptId),
            eq(manualGradingEntries.questionId, questionId),
          ),
        );
      return (rows[0] as ManualGradingEntrySelect | undefined) ?? null;
    },
    /**
     * Inserts or updates the manual grading entry for a single
     * (attemptId, questionId). On conflict (re-grade) it overwrites score,
     * maxScore, comment, gradedBy, gradedAt, and bumps updatedAt. The row is
     * scoped to the tenant's organizationId. Returns the persisted row.
     *
     * Callers must run this inside a transaction that has locked the attempt
     * row (findByIdForUpdate) for concurrency safety (P2D-J3 §17/§18).
     */
    async upsert(
      ctx: TenantContext | RequestContext,
      input: ManualGradingEntryUpsertInput,
    ): Promise<ManualGradingEntrySelect> {
      const orgId = resolveOrganizationId(ctx);
      const inserted = await db
        .insert(manualGradingEntries)
        .values({
          id: randomUUID(),
          organizationId: orgId,
          attemptId: input.attemptId,
          questionId: input.questionId,
          score: input.score,
          maxScore: input.maxScore,
          comment: input.comment,
          gradedBy: input.gradedBy,
          gradedAt: input.gradedAt,
          updatedAt: input.now,
        })
        .onConflictDoUpdate({
          target: [
            manualGradingEntries.attemptId,
            manualGradingEntries.questionId,
          ],
          set: {
            score: input.score,
            maxScore: input.maxScore,
            comment: input.comment,
            gradedBy: input.gradedBy,
            gradedAt: input.gradedAt,
            updatedAt: input.now,
          },
        })
        .returning();
      return inserted[0] as ManualGradingEntrySelect;
    },
  };
}
