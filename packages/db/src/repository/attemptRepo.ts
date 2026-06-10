import type { AnyDatabase, PostgresDatabase } from "../types.js";
import { isSqlite } from "../types.js";
import {
  examAttempts as sqliteAttempts,
  candidateProfiles as sqliteCandidates,
  users as sqliteUsers,
} from "../schema/sqlite.js";
import {
  examAttempts as pgAttempts,
  candidateProfiles as pgCandidates,
  users as pgUsers,
} from "../schema/pg.js";
import {
  createAsyncTenantCrudRepo,
  resolveOptionalOrganizationId,
} from "./baseRepo.js";
import type { TenantContext } from "../types.js";
import type { RequestContext } from "@exam/domain";
import { and, eq, isNotNull, sql } from "drizzle-orm";

type AttemptSelect = typeof sqliteAttempts.$inferSelect;
type CandidateSelect = typeof sqliteCandidates.$inferSelect;
type UserSelect = typeof sqliteUsers.$inferSelect;

export function createAttemptRepo(db: AnyDatabase) {
  const repo = createAsyncTenantCrudRepo(db, {
    sqlite: sqliteAttempts,
    pg: pgAttempts,
  });

  return {
    ...repo,
    async findActiveByEnrollment(
      ctx: TenantContext | RequestContext,
      enrollmentId: string,
    ): Promise<AttemptSelect | null> {
      const orgId = resolveOptionalOrganizationId(ctx);
      if (isSqlite(db)) {
        return (
          (db
            .select()
            .from(sqliteAttempts)
            .where(
              and(
                eq(sqliteAttempts.organizationId, orgId),
                eq(sqliteAttempts.enrollmentId, enrollmentId),
                eq(sqliteAttempts.status, "in_progress"),
              ),
            )
            .get() as AttemptSelect | undefined) ?? null
        );
      }
      const rows = await (db as PostgresDatabase)
        .select()
        .from(pgAttempts)
        .where(
          and(
            eq(pgAttempts.organizationId, orgId),
            eq(pgAttempts.enrollmentId, enrollmentId),
            eq(pgAttempts.status, "in_progress"),
          ),
        );
      return (rows[0] as AttemptSelect | undefined) ?? null;
    },
    async findByEnrollmentAndAttemptNo(
      ctx: TenantContext | RequestContext,
      enrollmentId: string,
      attemptNo: number,
    ): Promise<AttemptSelect | null> {
      const orgId = resolveOptionalOrganizationId(ctx);
      if (isSqlite(db)) {
        return (
          (db
            .select()
            .from(sqliteAttempts)
            .where(
              and(
                eq(sqliteAttempts.organizationId, orgId),
                eq(sqliteAttempts.enrollmentId, enrollmentId),
                eq(sqliteAttempts.attemptNo, attemptNo),
              ),
            )
            .get() as AttemptSelect | undefined) ?? null
        );
      }
      const rows = await (db as PostgresDatabase)
        .select()
        .from(pgAttempts)
        .where(
          and(
            eq(pgAttempts.organizationId, orgId),
            eq(pgAttempts.enrollmentId, enrollmentId),
            eq(pgAttempts.attemptNo, attemptNo),
          ),
        );
      return (rows[0] as AttemptSelect | undefined) ?? null;
    },
    async findByExamAndCandidate(
      ctx: TenantContext | RequestContext,
      examId: string,
      candidateId: string,
    ): Promise<AttemptSelect[]> {
      const orgId = resolveOptionalOrganizationId(ctx);
      if (isSqlite(db)) {
        return db
          .select()
          .from(sqliteAttempts)
          .where(
            and(
              eq(sqliteAttempts.organizationId, orgId),
              eq(sqliteAttempts.examId, examId),
              eq(sqliteAttempts.candidateId, candidateId),
            ),
          )
          .all() as AttemptSelect[];
      }
      return (await (db as PostgresDatabase)
        .select()
        .from(pgAttempts)
        .where(
          and(
            eq(pgAttempts.organizationId, orgId),
            eq(pgAttempts.examId, examId),
            eq(pgAttempts.candidateId, candidateId),
          ),
        )) as AttemptSelect[];
    },
    async findByIdAndCandidate(
      ctx: TenantContext | RequestContext,
      attemptId: string,
      candidateId: string,
    ): Promise<AttemptSelect | null> {
      const orgId = resolveOptionalOrganizationId(ctx);
      if (isSqlite(db)) {
        return (
          (db
            .select()
            .from(sqliteAttempts)
            .where(
              and(
                eq(sqliteAttempts.organizationId, orgId),
                eq(sqliteAttempts.id, attemptId),
                eq(sqliteAttempts.candidateId, candidateId),
              ),
            )
            .get() as AttemptSelect | undefined) ?? null
        );
      }
      const rows = await (db as PostgresDatabase)
        .select()
        .from(pgAttempts)
        .where(
          and(
            eq(pgAttempts.organizationId, orgId),
            eq(pgAttempts.id, attemptId),
            eq(pgAttempts.candidateId, candidateId),
          ),
        );
      return (rows[0] as AttemptSelect | undefined) ?? null;
    },
    async findActiveByExamAndCandidate(
      ctx: TenantContext | RequestContext,
      examId: string,
      candidateId: string,
    ): Promise<AttemptSelect | null> {
      const orgId = resolveOptionalOrganizationId(ctx);
      if (isSqlite(db)) {
        return (
          (db
            .select()
            .from(sqliteAttempts)
            .where(
              and(
                eq(sqliteAttempts.organizationId, orgId),
                eq(sqliteAttempts.examId, examId),
                eq(sqliteAttempts.candidateId, candidateId),
                eq(sqliteAttempts.status, "in_progress"),
              ),
            )
            .get() as AttemptSelect | undefined) ?? null
        );
      }
      const rows = await (db as PostgresDatabase)
        .select()
        .from(pgAttempts)
        .where(
          and(
            eq(pgAttempts.organizationId, orgId),
            eq(pgAttempts.examId, examId),
            eq(pgAttempts.candidateId, candidateId),
            eq(pgAttempts.status, "in_progress"),
          ),
        );
      return (rows[0] as AttemptSelect | undefined) ?? null;
    },
    async listInProgress(
      ctx: TenantContext | RequestContext,
    ): Promise<AttemptSelect[]> {
      const orgId = resolveOptionalOrganizationId(ctx);
      if (isSqlite(db)) {
        return db
          .select()
          .from(sqliteAttempts)
          .where(
            and(
              eq(sqliteAttempts.organizationId, orgId),
              eq(sqliteAttempts.status, "in_progress"),
            ),
          )
          .all() as AttemptSelect[];
      }
      return (await (db as PostgresDatabase)
        .select()
        .from(pgAttempts)
        .where(
          and(
            eq(pgAttempts.organizationId, orgId),
            eq(pgAttempts.status, "in_progress"),
          ),
        )) as AttemptSelect[];
    },
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
      const baseWhere = and(
        eq(sqliteAttempts.organizationId, orgId),
        eq(sqliteAttempts.examId, examId),
        eq(sqliteAttempts.status, "graded"),
        isNotNull(sqliteAttempts.score),
      );

      let finalWhere = baseWhere;
      if (options.passFilter === "passed") {
        finalWhere = and(baseWhere, eq(sqliteAttempts.passed, true));
      } else if (options.passFilter === "failed") {
        finalWhere = and(baseWhere, eq(sqliteAttempts.passed, false));
      }

      type GradedRow = {
        attempt: AttemptSelect;
        candidateProfile: CandidateSelect;
        candidateUser: UserSelect;
      };

      if (isSqlite(db)) {
        const allResults = db
          .select({
            attempt: sqliteAttempts,
            candidateProfile: sqliteCandidates,
            candidateUser: sqliteUsers,
          })
          .from(sqliteAttempts)
          .innerJoin(
            sqliteCandidates,
            eq(sqliteAttempts.candidateId, sqliteCandidates.id),
          )
          .innerJoin(sqliteUsers, eq(sqliteCandidates.userId, sqliteUsers.id))
          .where(finalWhere)
          .all() as GradedRow[];

        return sortAndPaginateGraded(allResults, options);
      }

      const allResults = (await (db as PostgresDatabase)
        .select({
          attempt: pgAttempts,
          candidateProfile: pgCandidates,
          candidateUser: pgUsers,
        })
        .from(pgAttempts)
        .innerJoin(pgCandidates, eq(pgAttempts.candidateId, pgCandidates.id))
        .innerJoin(pgUsers, eq(pgCandidates.userId, pgUsers.id))
        .where(finalWhere)) as GradedRow[];

      return sortAndPaginateGraded(allResults, options);
    },
    async getGradedStats(ctx: TenantContext | RequestContext, examId: string) {
      const orgId = resolveOptionalOrganizationId(ctx);
      const baseWhere = and(
        eq(sqliteAttempts.organizationId, orgId),
        eq(sqliteAttempts.examId, examId),
        eq(sqliteAttempts.status, "graded"),
        isNotNull(sqliteAttempts.score),
      );

      type StatsRow = {
        count: number;
        avg: number | null;
        max: number | null;
        min: number | null;
        passed: number | null;
      };

      if (isSqlite(db)) {
        const result = db
          .select({
            count: sql<number>`count(*)`,
            avg: sql<number | null>`avg(${sqliteAttempts.score})`,
            max: sql<number | null>`max(${sqliteAttempts.score})`,
            min: sql<number | null>`min(${sqliteAttempts.score})`,
            passed: sql<
              number | null
            >`sum(case when ${sqliteAttempts.passed} = 1 then 1 else 0 end)`,
          })
          .from(sqliteAttempts)
          .where(baseWhere)
          .get() as StatsRow;
        return buildStats(result);
      }
      const rows = await (db as PostgresDatabase)
        .select({
          count: sql<number>`count(*)`,
          avg: sql<number | null>`avg(${pgAttempts.score})`,
          max: sql<number | null>`max(${pgAttempts.score})`,
          min: sql<number | null>`min(${pgAttempts.score})`,
          passed: sql<
            number | null
          >`sum(case when ${pgAttempts.passed} = true then 1 else 0 end)`,
        })
        .from(pgAttempts)
        .where(baseWhere);
      return buildStats(rows[0] as StatsRow);
    },
    async countGradedByExam(
      ctx: TenantContext | RequestContext,
      examId: string,
      options: {
        passFilter?: "all" | "passed" | "failed";
      } = {},
    ) {
      const orgId = resolveOptionalOrganizationId(ctx);
      const baseWhere = and(
        eq(sqliteAttempts.organizationId, orgId),
        eq(sqliteAttempts.examId, examId),
        eq(sqliteAttempts.status, "graded"),
        isNotNull(sqliteAttempts.score),
      );

      let finalWhere = baseWhere;
      if (options.passFilter === "passed") {
        finalWhere = and(baseWhere, eq(sqliteAttempts.passed, true));
      } else if (options.passFilter === "failed") {
        finalWhere = and(baseWhere, eq(sqliteAttempts.passed, false));
      }

      if (isSqlite(db)) {
        const result = db
          .select({ count: sql<number>`count(*)` })
          .from(sqliteAttempts)
          .where(finalWhere)
          .get() as { count: number };
        return result.count;
      }
      const rows = await (db as PostgresDatabase)
        .select({ count: sql<number>`count(*)` })
        .from(pgAttempts)
        .where(finalWhere);
      return (rows[0] as { count: number }).count;
    },
  };
}

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

function buildStats(result: {
  count: number;
  avg: number | null;
  max: number | null;
  min: number | null;
  passed: number | null;
}) {
  const count = result.count ?? 0;
  return {
    totalGraded: count,
    averageScore: result.avg ?? 0,
    maxScore: result.max ?? 0,
    minScore: result.min ?? 0,
    passRate: count > 0 ? (result.passed ?? 0) / count : 0,
  };
}
