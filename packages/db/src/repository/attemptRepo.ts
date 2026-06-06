import type { SqliteDatabase } from "../sqlite.js";
import { examAttempts, candidateProfiles, users } from "../schema/sqlite.js";
import { createTenantCrudRepo } from "./baseRepo.js";
import type { RequestContext } from "@exam/domain";
import { and, eq, asc, desc, isNotNull, sql } from "drizzle-orm";

export function createAttemptRepo(db: SqliteDatabase) {
  const repo = createTenantCrudRepo(db, examAttempts);

  return {
    ...repo,
    findActiveByEnrollment(ctx: RequestContext, enrollmentId: string) {
      const orgId = ctx.targetOrganizationId ?? ctx.organizationId;
      return (
        (db
          .select()
          .from(examAttempts)
          .where(
            and(
              eq(examAttempts.organizationId, orgId),
              eq(examAttempts.enrollmentId, enrollmentId),
              eq(examAttempts.status, "in_progress"),
            ),
          )
          .get() as typeof examAttempts.$inferSelect | undefined) ?? null
      );
    },
    findByEnrollmentAndAttemptNo(
      ctx: RequestContext,
      enrollmentId: string,
      attemptNo: number,
    ) {
      const orgId = ctx.targetOrganizationId ?? ctx.organizationId;
      return (
        (db
          .select()
          .from(examAttempts)
          .where(
            and(
              eq(examAttempts.organizationId, orgId),
              eq(examAttempts.enrollmentId, enrollmentId),
              eq(examAttempts.attemptNo, attemptNo),
            ),
          )
          .get() as typeof examAttempts.$inferSelect | undefined) ?? null
      );
    },
    findByExamAndCandidate(
      ctx: RequestContext,
      examId: string,
      candidateId: string,
    ) {
      const orgId = ctx.targetOrganizationId ?? ctx.organizationId;
      return db
        .select()
        .from(examAttempts)
        .where(
          and(
            eq(examAttempts.organizationId, orgId),
            eq(examAttempts.examId, examId),
            eq(examAttempts.candidateId, candidateId),
          ),
        )
        .all() as (typeof examAttempts.$inferSelect)[];
    },
    findByIdAndCandidate(
      ctx: RequestContext,
      attemptId: string,
      candidateId: string,
    ) {
      const orgId = ctx.targetOrganizationId ?? ctx.organizationId;
      return (
        (db
          .select()
          .from(examAttempts)
          .where(
            and(
              eq(examAttempts.organizationId, orgId),
              eq(examAttempts.id, attemptId),
              eq(examAttempts.candidateId, candidateId),
            ),
          )
          .get() as typeof examAttempts.$inferSelect | undefined) ?? null
      );
    },
    findActiveByExamAndCandidate(
      ctx: RequestContext,
      examId: string,
      candidateId: string,
    ) {
      const orgId = ctx.targetOrganizationId ?? ctx.organizationId;
      return (
        (db
          .select()
          .from(examAttempts)
          .where(
            and(
              eq(examAttempts.organizationId, orgId),
              eq(examAttempts.examId, examId),
              eq(examAttempts.candidateId, candidateId),
              eq(examAttempts.status, "in_progress"),
            ),
          )
          .get() as typeof examAttempts.$inferSelect | undefined) ?? null
      );
    },
    listInProgress(ctx: RequestContext) {
      const orgId = ctx.targetOrganizationId ?? ctx.organizationId;
      return db
        .select()
        .from(examAttempts)
        .where(
          and(
            eq(examAttempts.organizationId, orgId),
            eq(examAttempts.status, "in_progress"),
          ),
        )
        .all() as (typeof examAttempts.$inferSelect)[];
    },
    listGradedByExam(
      ctx: RequestContext,
      examId: string,
      options: {
        passFilter?: "all" | "passed" | "failed";
        sortBy?: "score" | "submittedAt" | "candidateName";
        sortOrder?: "asc" | "desc";
        limit?: number;
        offset?: number;
      } = {},
    ) {
      const orgId = ctx.targetOrganizationId ?? ctx.organizationId;
      const baseWhere = and(
        eq(examAttempts.organizationId, orgId),
        eq(examAttempts.examId, examId),
        eq(examAttempts.status, "graded"),
        isNotNull(examAttempts.score),
      );

      let finalWhere = baseWhere;
      if (options.passFilter === "passed") {
        finalWhere = and(baseWhere, eq(examAttempts.passed, true));
      } else if (options.passFilter === "failed") {
        finalWhere = and(baseWhere, eq(examAttempts.passed, false));
      }

      const allResults = (db as any)
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
        .where(finalWhere)
        .all() as Array<{
        attempt: typeof examAttempts.$inferSelect;
        candidateProfile: typeof candidateProfiles.$inferSelect;
        candidateUser: typeof users.$inferSelect;
      }>;

      // Sort
      const sortBy = options.sortBy ?? "submittedAt";
      const sortDir = options.sortOrder === "asc" ? 1 : -1;
      allResults.sort((a, b) => {
        if (sortBy === "score") {
          return ((a.attempt.score ?? 0) - (b.attempt.score ?? 0)) * sortDir;
        }
        if (sortBy === "candidateName") {
          return (
            a.candidateUser.name.localeCompare(b.candidateUser.name) * sortDir
          );
        }
        const aTime = a.attempt.submittedAt?.getTime() ?? 0;
        const bTime = b.attempt.submittedAt?.getTime() ?? 0;
        return (aTime - bTime) * sortDir;
      });

      // Paginate
      const offset = options.offset ?? 0;
      const limit = options.limit;
      if (limit != null) {
        return allResults.slice(offset, offset + limit);
      }
      return allResults.slice(offset);
    },
    getGradedStats(ctx: RequestContext, examId: string) {
      const orgId = ctx.targetOrganizationId ?? ctx.organizationId;
      const baseWhere = and(
        eq(examAttempts.organizationId, orgId),
        eq(examAttempts.examId, examId),
        eq(examAttempts.status, "graded"),
        isNotNull(examAttempts.score),
      );
      const result = (db as any)
        .select({
          count: sql`count(*)`.as("count"),
          avg: sql`avg(${examAttempts.score})`.as("avg"),
          max: sql`max(${examAttempts.score})`.as("max"),
          min: sql`min(${examAttempts.score})`.as("min"),
          passed:
            sql`sum(case when ${examAttempts.passed} = 1 then 1 else 0 end)`.as(
              "passed",
            ),
        })
        .from(examAttempts)
        .where(baseWhere)
        .get() as {
        count: number;
        avg: number | null;
        max: number | null;
        min: number | null;
        passed: number | null;
      };
      const count = result.count ?? 0;
      return {
        totalGraded: count,
        averageScore: result.avg ?? 0,
        maxScore: result.max ?? 0,
        minScore: result.min ?? 0,
        passRate: count > 0 ? (result.passed ?? 0) / count : 0,
      };
    },
    countGradedByExam(
      ctx: RequestContext,
      examId: string,
      options: {
        passFilter?: "all" | "passed" | "failed";
      } = {},
    ) {
      const orgId = ctx.targetOrganizationId ?? ctx.organizationId;
      const baseWhere = and(
        eq(examAttempts.organizationId, orgId),
        eq(examAttempts.examId, examId),
        eq(examAttempts.status, "graded"),
        isNotNull(examAttempts.score),
      );

      let finalWhere = baseWhere;
      if (options.passFilter === "passed") {
        finalWhere = and(baseWhere, eq(examAttempts.passed, true));
      } else if (options.passFilter === "failed") {
        finalWhere = and(baseWhere, eq(examAttempts.passed, false));
      }

      const result = (db as any)
        .select({ count: sql`count(*)` as any })
        .from(examAttempts)
        .where(finalWhere)
        .get() as { count: number };

      return result.count;
    },
  };
}
