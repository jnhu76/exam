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

      const results: any[] = [];
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
        .all();

      return allResults as Array<{
        attempt: typeof examAttempts.$inferSelect;
        candidateProfile: typeof candidateProfiles.$inferSelect;
        candidateUser: typeof users.$inferSelect;
      }>;
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
