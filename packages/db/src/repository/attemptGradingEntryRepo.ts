import type { Database } from "../types.js";
import {
  attemptGradingEntries,
  examAttempts,
  exams,
  candidateProfiles,
  users,
} from "../schema/pg.js";
import {
  createAsyncTenantCrudRepo,
  resolveOrganizationId,
} from "./baseRepo.js";
import type { TenantContext } from "../types.js";
import type {
  AttemptGradingEntry,
  GradingEntryMode,
  GradingEntryStatus,
  RequestContext,
} from "@exam/domain";
import { randomUUID } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";

type AttemptGradingEntrySelect = (typeof attemptGradingEntries)["$inferSelect"];

/**
 * Input shape for bulk-inserting grading workset entries at submit-freeze
 * time (P3-L0-2E). One entry per frozen question.
 */
export interface AttemptGradingEntryBulkInsertInput {
  attemptId: string;
  questionId: string;
  gradingMode: GradingEntryMode;
  status: GradingEntryStatus;
  maxScore: number;
  earnedScore: number | null;
  candidateAnswer: unknown;
  standardAnswer: unknown;
  correct: boolean | null;
}

/**
 * Input shape for updating a manual grading entry from pending_manual to
 * completed_manual.
 */
export interface ManualScoreUpdateInput {
  attemptId: string;
  questionId: string;
  earnedScore: number;
  maxScore: number;
  comment: string;
  gradedBy: string;
  gradedAt: Date;
  now: Date;
}

/**
 * Creates the attempt-grading-entry repository (P3-L0-2E). This is the single
 * durable grading truth surface. All grading queue, manual scoring, and
 * terminal aggregation reads/writes flow through here.
 *
 * Every method receives a tenant context and is scoped to `organizationId`.
 */
export function createAttemptGradingEntryRepo(db: Database) {
  const repo = createAsyncTenantCrudRepo(db, attemptGradingEntries);

  return {
    findById: repo.findById,

    /**
     * Lists all grading entries for an attempt, scoped to the tenant.
     * Ordered by `questionId` for deterministic aggregation.
     */
    async findByAttempt(
      ctx: TenantContext | RequestContext,
      attemptId: string,
    ): Promise<AttemptGradingEntrySelect[]> {
      const orgId = resolveOrganizationId(ctx);
      return db
        .select()
        .from(attemptGradingEntries)
        .where(
          and(
            eq(attemptGradingEntries.organizationId, orgId),
            eq(attemptGradingEntries.attemptId, attemptId),
          ),
        )
        .orderBy(asc(attemptGradingEntries.questionId));
    },

    /**
     * Finds the single grading entry for a given attempt + question, scoped
     * to the tenant. Returns null when no entry exists.
     */
    async findByAttemptAndQuestion(
      ctx: TenantContext | RequestContext,
      attemptId: string,
      questionId: string,
    ): Promise<AttemptGradingEntrySelect | null> {
      const orgId = resolveOrganizationId(ctx);
      const rows = await db
        .select()
        .from(attemptGradingEntries)
        .where(
          and(
            eq(attemptGradingEntries.organizationId, orgId),
            eq(attemptGradingEntries.attemptId, attemptId),
            eq(attemptGradingEntries.questionId, questionId),
          ),
        );
      return (rows[0] as AttemptGradingEntrySelect | undefined) ?? null;
    },

    /**
     * Bulk-inserts the materialized grading workset for an attempt at
     * submit-freeze time. Exactly one entry per frozen question. Must be
     * called inside the submit transaction holding the attempt row lock.
     *
     * Throws on unique-constraint violation if entries already exist for
     * this attempt (retry must not duplicate work — the caller checks for
     * existing entries first or wraps in a transaction that has already
     * verified the attempt is not yet submitted).
     */
    async bulkCreate(
      ctx: TenantContext | RequestContext,
      inputs: AttemptGradingEntryBulkInsertInput[],
    ): Promise<AttemptGradingEntrySelect[]> {
      if (inputs.length === 0) return [];
      const orgId = resolveOrganizationId(ctx);
      const rows = inputs.map((input) => ({
        id: randomUUID(),
        organizationId: orgId,
        attemptId: input.attemptId,
        questionId: input.questionId,
        gradingMode: input.gradingMode,
        status: input.status,
        maxScore: input.maxScore,
        earnedScore: input.earnedScore,
        candidateAnswer: input.candidateAnswer,
        standardAnswer: input.standardAnswer,
        correct: input.correct,
        comment: "",
        gradedBy: null,
        gradedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));
      const inserted = await db
        .insert(attemptGradingEntries)
        .values(rows)
        .returning();
      return inserted as AttemptGradingEntrySelect[];
    },

    /**
     * Updates a pending_manual entry to completed_manual with the grader's
     * awarded score, comment, and identity. Targets exactly one row by the
     * unique (attemptId, questionId) constraint, scoped to the tenant. Must be
     * called inside a transaction holding the attempt row lock.
     *
     * Slice 3 authoritative manual-score write path: the manual grading command
     * reads the entry first (fail-closed when missing, reject when gradingMode
     * != manual, reject when status != pending_manual per Slice 3C) and then
     * calls this to UPDATE the SAME entry. No second row is ever created. The
     * command guarantees the entry is pending when this is called; this repo
     * method does not itself enforce the pending → completed transition guard.
     */
    async completeManualEntry(
      ctx: TenantContext | RequestContext,
      input: ManualScoreUpdateInput,
    ): Promise<AttemptGradingEntrySelect | null> {
      const orgId = resolveOrganizationId(ctx);
      const updated = await db
        .update(attemptGradingEntries)
        .set({
          status: "completed_manual" as GradingEntryStatus,
          earnedScore: input.earnedScore,
          correct: input.earnedScore >= input.maxScore,
          comment: input.comment,
          gradedBy: input.gradedBy,
          gradedAt: input.gradedAt,
          updatedAt: input.now,
        })
        .where(
          and(
            eq(attemptGradingEntries.organizationId, orgId),
            eq(attemptGradingEntries.attemptId, input.attemptId),
            eq(attemptGradingEntries.questionId, input.questionId),
          ),
        )
        .returning();
      return (updated[0] as AttemptGradingEntrySelect | undefined) ?? null;
    },

    /**
     * Counts the remaining pending_manual manual-mode entries for an attempt,
     * scoped to the tenant. The manual grading command uses this to detect
     * terminal completion (when the last manual question is scored).
     */
    async countPendingManualForAttempt(
      ctx: TenantContext | RequestContext,
      attemptId: string,
    ): Promise<number> {
      const orgId = resolveOrganizationId(ctx);
      const rows = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(attemptGradingEntries)
        .where(
          and(
            eq(attemptGradingEntries.organizationId, orgId),
            eq(attemptGradingEntries.attemptId, attemptId),
            eq(attemptGradingEntries.gradingMode, "manual" as GradingEntryMode),
            eq(
              attemptGradingEntries.status,
              "pending_manual" as GradingEntryStatus,
            ),
          ),
        );
      return Number((rows[0] as { count: number } | undefined)?.count ?? 0);
    },

    /**
     * Lists attempts that have at least one pending_manual grading entry,
     * joining with exam/candidate/user for the queue view. The work items
     * themselves are durable rows in `attempt_grading_entries`; this query
     * groups them by attempt for the API response.
     *
     * Scoped to the tenant; optionally filtered to one exam.
     */
    async listPendingManualQueue(
      ctx: TenantContext | RequestContext,
      options: { examId?: string; limit?: number; offset?: number } = {},
    ) {
      const orgId = resolveOrganizationId(ctx);
      const conditions = [
        eq(attemptGradingEntries.organizationId, orgId),
        eq(attemptGradingEntries.gradingMode, "manual" as GradingEntryMode),
        eq(
          attemptGradingEntries.status,
          "pending_manual" as GradingEntryStatus,
        ),
      ];
      if (options.examId) {
        conditions.push(eq(examAttempts.examId, options.examId));
      }

      const baseQuery = db
        .select({
          attempt: examAttempts,
          exam: exams,
          candidateProfile: candidateProfiles,
          candidateUser: users,
          pendingCount: sql<number>`count(${attemptGradingEntries.id})::int`,
        })
        .from(attemptGradingEntries)
        .innerJoin(
          examAttempts,
          eq(attemptGradingEntries.attemptId, examAttempts.id),
        )
        .innerJoin(exams, eq(examAttempts.examId, exams.id))
        .innerJoin(
          candidateProfiles,
          eq(examAttempts.candidateId, candidateProfiles.id),
        )
        .innerJoin(users, eq(candidateProfiles.userId, users.id))
        .where(and(...conditions))
        .groupBy(examAttempts.id, exams.id, candidateProfiles.id, users.id)
        .orderBy(examAttempts.submittedAt);

      const rows = options.limit
        ? await baseQuery.limit(options.limit).offset(options.offset ?? 0)
        : await baseQuery.offset(options.offset ?? 0);
      return rows as Array<{
        attempt: (typeof examAttempts)["$inferSelect"];
        exam: (typeof exams)["$inferSelect"];
        candidateProfile: (typeof candidateProfiles)["$inferSelect"];
        candidateUser: (typeof users)["$inferSelect"];
        pendingCount: number;
      }>;
    },

    /**
     * Counts distinct attempts that have at least one pending_manual grading
     * entry, scoped to the tenant; optionally filtered to one exam.
     */
    async countPendingManualQueue(
      ctx: TenantContext | RequestContext,
      options: { examId?: string } = {},
    ): Promise<number> {
      const orgId = resolveOrganizationId(ctx);
      const conditions = [
        eq(attemptGradingEntries.organizationId, orgId),
        eq(attemptGradingEntries.gradingMode, "manual" as GradingEntryMode),
        eq(
          attemptGradingEntries.status,
          "pending_manual" as GradingEntryStatus,
        ),
      ];
      if (options.examId) {
        conditions.push(eq(examAttempts.examId, options.examId));
      }
      const rows = await db
        .select({
          count: sql<number>`count(DISTINCT ${attemptGradingEntries.attemptId})`,
        })
        .from(attemptGradingEntries)
        .innerJoin(
          examAttempts,
          eq(attemptGradingEntries.attemptId, examAttempts.id),
        )
        .where(and(...conditions));
      return Number((rows[0] as { count: number }).count);
    },
  };
}

/** Type guard: narrows a DB row to the domain {@link AttemptGradingEntry}. */
export function toDomainEntry(
  row: AttemptGradingEntrySelect,
): AttemptGradingEntry {
  return {
    id: row.id,
    organizationId: row.organizationId,
    attemptId: row.attemptId,
    questionId: row.questionId,
    gradingMode: row.gradingMode as GradingEntryMode,
    status: row.status as GradingEntryStatus,
    maxScore: row.maxScore,
    earnedScore: row.earnedScore,
    candidateAnswer: row.candidateAnswer,
    standardAnswer: row.standardAnswer,
    correct: row.correct,
    comment: row.comment,
    gradedBy: row.gradedBy,
    gradedAt: row.gradedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
