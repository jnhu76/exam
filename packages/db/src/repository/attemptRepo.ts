import type { Database } from "../types.js";
import { pgNum } from "../types.js";
import { examAttempts, candidateProfiles, users } from "../schema/pg.js";
import {
  createAsyncTenantCrudRepo,
  resolveOptionalOrganizationId,
} from "./baseRepo.js";
import { resolveOrganizationId } from "./baseRepo.js";
import type { TenantContext } from "../types.js";
import type { RequestContext } from "@exam/domain";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";

type AttemptSelect = typeof examAttempts.$inferSelect;
type CandidateSelect = typeof candidateProfiles.$inferSelect;
type UserSelect = typeof users.$inferSelect;

/**
 * Creates the exam attempt repository with CRUD plus lookup methods
 * for finding attempts by enrollment, candidate, and status.
 * @param db - Database instance.
 */
export function createAttemptRepo(db: Database) {
  const repo = createAsyncTenantCrudRepo(db, examAttempts);

  return {
    ...repo,
    /**
     * Finds an attempt by `id` with `FOR UPDATE` row lock, scoped to the tenant.
     * Used for optimistic concurrency during answer saves and submissions.
     */
    async findByIdForUpdate(
      ctx: TenantContext | RequestContext,
      attemptId: string,
    ): Promise<AttemptSelect | null> {
      const orgId = resolveOrganizationId(ctx);
      const rows = await db
        .select()
        .from(examAttempts)
        .for("update")
        .where(
          and(
            eq(examAttempts.organizationId, orgId),
            eq(examAttempts.id, attemptId),
          ),
        );
      return (rows[0] as AttemptSelect | undefined) ?? null;
    },
    /**
     * Finds the most recent active attempt (in_progress or disrupted) for a
     * given enrollment, scoped to the tenant.
     */
    async findActiveByEnrollment(
      ctx: TenantContext | RequestContext,
      enrollmentId: string,
    ): Promise<AttemptSelect | null> {
      const orgId = resolveOptionalOrganizationId(ctx);
      const rows = await db
        .select()
        .from(examAttempts)
        .where(
          and(
            eq(examAttempts.organizationId, orgId),
            eq(examAttempts.enrollmentId, enrollmentId),
            inArray(examAttempts.status, ["in_progress", "disrupted"]),
          ),
        );
      return (rows[0] as AttemptSelect | undefined) ?? null;
    },
    /**
     * Finds an attempt by enrollment ID and attempt number, scoped to the tenant.
     */
    async findByEnrollmentAndAttemptNo(
      ctx: TenantContext | RequestContext,
      enrollmentId: string,
      attemptNo: number,
    ): Promise<AttemptSelect | null> {
      const orgId = resolveOptionalOrganizationId(ctx);
      const rows = await db
        .select()
        .from(examAttempts)
        .where(
          and(
            eq(examAttempts.organizationId, orgId),
            eq(examAttempts.enrollmentId, enrollmentId),
            eq(examAttempts.attemptNo, attemptNo),
          ),
        );
      return (rows[0] as AttemptSelect | undefined) ?? null;
    },
    /**
     * Finds all attempts for a given exam and candidate, scoped to the tenant.
     */
    async findByExamAndCandidate(
      ctx: TenantContext | RequestContext,
      examId: string,
      candidateId: string,
    ): Promise<AttemptSelect[]> {
      const orgId = resolveOptionalOrganizationId(ctx);
      return (await db
        .select()
        .from(examAttempts)
        .where(
          and(
            eq(examAttempts.organizationId, orgId),
            eq(examAttempts.examId, examId),
            eq(examAttempts.candidateId, candidateId),
          ),
        )) as AttemptSelect[];
    },
    /**
     * Finds a specific attempt by ID and candidate profile ID, scoped to the tenant.
     */
    async findByIdAndCandidate(
      ctx: TenantContext | RequestContext,
      attemptId: string,
      candidateId: string,
    ): Promise<AttemptSelect | null> {
      const orgId = resolveOptionalOrganizationId(ctx);
      const rows = await db
        .select()
        .from(examAttempts)
        .where(
          and(
            eq(examAttempts.organizationId, orgId),
            eq(examAttempts.id, attemptId),
            eq(examAttempts.candidateId, candidateId),
          ),
        );
      return (rows[0] as AttemptSelect | undefined) ?? null;
    },
    /**
     * Finds the most recent active attempt (in_progress or disrupted) for a
     * specific exam and candidate, scoped to the tenant.
     */
    async findActiveByExamAndCandidate(
      ctx: TenantContext | RequestContext,
      examId: string,
      candidateId: string,
    ): Promise<AttemptSelect | null> {
      const orgId = resolveOptionalOrganizationId(ctx);
      const rows = await db
        .select()
        .from(examAttempts)
        .where(
          and(
            eq(examAttempts.organizationId, orgId),
            eq(examAttempts.examId, examId),
            eq(examAttempts.candidateId, candidateId),
            inArray(examAttempts.status, ["in_progress", "disrupted"]),
          ),
        );
      return (rows[0] as AttemptSelect | undefined) ?? null;
    },
    /**
     * Lists all in-progress attempts across the tenant organization.
     * Used by heartbeat scanning and proctoring.
     */
    async listInProgress(
      ctx: TenantContext | RequestContext,
    ): Promise<AttemptSelect[]> {
      const orgId = resolveOptionalOrganizationId(ctx);
      return (await db
        .select()
        .from(examAttempts)
        .where(
          and(
            eq(examAttempts.organizationId, orgId),
            eq(examAttempts.status, "in_progress"),
          ),
        )) as AttemptSelect[];
    },
    /**
     * Lists graded attempts for an exam with optional pass/fail filter,
     * sorting, and pagination. Joins with candidate profiles and users
     * to include candidate name.
     */
    async listGradedByExam(
      ctx: TenantContext | RequestContext,
      examId: string,
      options: {
        passFilter?: "all" | "passed" | "failed";
        sortBy?: "score" | "submittedAt" | "candidateName";
        sortOrder?: "asc" | "desc";
        limit?: number;
        offset?: number;
      } = {},
    ) {
      const orgId = resolveOptionalOrganizationId(ctx);
      let baseWhere = and(
        eq(examAttempts.organizationId, orgId),
        eq(examAttempts.examId, examId),
        eq(examAttempts.status, "graded"),
        isNotNull(examAttempts.score),
      );

      if (options.passFilter === "passed") {
        baseWhere = and(baseWhere, eq(examAttempts.passed, true));
      } else if (options.passFilter === "failed") {
        baseWhere = and(baseWhere, eq(examAttempts.passed, false));
      }

      type GradedRow = {
        attempt: AttemptSelect;
        candidateProfile: CandidateSelect;
        candidateUser: UserSelect;
      };

      const allResults = (await db
        .select({
          attempt: examAttempts,
          candidateProfile: candidateProfiles,
          candidateUser: users,
        })
        .from(examAttempts)
        .innerJoin(
          candidateProfiles,
          eq(examAttempts.candidateId, candidateProfiles.id),
        )
        .innerJoin(users, eq(candidateProfiles.userId, users.id))
        .where(baseWhere)) as GradedRow[];

      return sortAndPaginateGraded(allResults, options);
    },
    /**
     * Returns aggregate statistics (count, avg, max, min, pass rate) for
     * graded attempts on a given exam, scoped to the tenant.
     */
    async getGradedStats(ctx: TenantContext | RequestContext, examId: string) {
      const orgId = resolveOptionalOrganizationId(ctx);
      const baseWhere = and(
        eq(examAttempts.organizationId, orgId),
        eq(examAttempts.examId, examId),
        eq(examAttempts.status, "graded"),
        isNotNull(examAttempts.score),
      );

      type StatsRow = {
        count: number;
        avg: number | null;
        max: number | null;
        min: number | null;
        passed: number | null;
      };

      const rows = await db
        .select({
          count: sql<number>`count(*)`,
          avg: sql<number | null>`avg(${examAttempts.score})`,
          max: sql<number | null>`max(${examAttempts.score})`,
          min: sql<number | null>`min(${examAttempts.score})`,
          passed: sql<
            number | null
          >`sum(case when ${examAttempts.passed} = true then 1 else 0 end)`,
        })
        .from(examAttempts)
        .where(baseWhere);
      return buildStats(rows[0] as StatsRow);
    },
    /**
     * Counts graded attempts for an exam with optional pass/fail filter,
     * scoped to the tenant.
     */
    async countGradedByExam(
      ctx: TenantContext | RequestContext,
      examId: string,
      options: {
        passFilter?: "all" | "passed" | "failed";
      } = {},
    ) {
      const orgId = resolveOptionalOrganizationId(ctx);
      let baseWhere = and(
        eq(examAttempts.organizationId, orgId),
        eq(examAttempts.examId, examId),
        eq(examAttempts.status, "graded"),
        isNotNull(examAttempts.score),
      );

      if (options.passFilter === "passed") {
        baseWhere = and(baseWhere, eq(examAttempts.passed, true));
      } else if (options.passFilter === "failed") {
        baseWhere = and(baseWhere, eq(examAttempts.passed, false));
      }

      const rows = await db
        .select({ count: sql<number>`count(*)` })
        .from(examAttempts)
        .where(baseWhere);
      return pgNum((rows[0] as { count: number }).count);
    },
  };
}

/** Sorts and paginates joined graded-attempt results in memory. */
function sortAndPaginateGraded(
  allResults: Array<{
    attempt: AttemptSelect;
    candidateProfile: CandidateSelect;
    candidateUser: UserSelect;
  }>,
  options: {
    sortBy?: "score" | "submittedAt" | "candidateName";
    sortOrder?: "asc" | "desc";
    limit?: number;
    offset?: number;
  },
) {
  const sortBy = options.sortBy ?? "submittedAt";
  const sortDir = options.sortOrder === "asc" ? 1 : -1;
  allResults.sort((a, b) => {
    if (sortBy === "score") {
      return ((a.attempt.score ?? 0) - (b.attempt.score ?? 0)) * sortDir;
    }
    if (sortBy === "candidateName") {
      return a.candidateUser.name.localeCompare(b.candidateUser.name) * sortDir;
    }
    const aTime = a.attempt.submittedAt?.getTime() ?? 0;
    const bTime = b.attempt.submittedAt?.getTime() ?? 0;
    return (aTime - bTime) * sortDir;
  });

  const offset = options.offset ?? 0;
  const limit = options.limit;
  if (limit != null) {
    return allResults.slice(offset, offset + limit);
  }
  return allResults.slice(offset);
}

/** Builds a stats summary from raw aggregate query results. */
function buildStats(result: {
  count: number;
  avg: number | null;
  max: number | null;
  min: number | null;
  passed: number | null;
}) {
  const count = pgNum(result.count);
  const passed = pgNum(result.passed);
  const built = {
    totalGraded: count,
    averageScore: pgNum(result.avg),
    maxScore: pgNum(result.max),
    minScore: pgNum(result.min),
    passRate: count > 0 ? passed / count : 0,
  };
  return built;
}
