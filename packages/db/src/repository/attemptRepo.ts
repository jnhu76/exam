import type { SqliteDatabase } from "../sqlite.js";
import { examAttempts } from "../schema/sqlite.js";
import { createTenantCrudRepo } from "./baseRepo.js";
import type { RequestContext } from "@exam/domain";
import { and, eq } from "drizzle-orm";

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
  };
}
