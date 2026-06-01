import type { SqliteDatabase } from "../sqlite.js";
import { examEnrollments } from "../schema/sqlite.js";
import { createTenantCrudRepo } from "./baseRepo.js";
import type { RequestContext } from "@exam/domain";
import { and, eq } from "drizzle-orm";

export function createEnrollmentRepo(db: SqliteDatabase) {
  const repo = createTenantCrudRepo(db, examEnrollments);

  return {
    ...repo,
    findByExamAndCandidate(
      ctx: RequestContext,
      examId: string,
      candidateId: string,
    ) {
      const orgId = ctx.targetOrganizationId ?? ctx.organizationId;
      return (
        (db
          .select()
          .from(examEnrollments)
          .where(
            and(
              eq(examEnrollments.organizationId, orgId),
              eq(examEnrollments.examId, examId),
              eq(examEnrollments.candidateId, candidateId),
            ),
          )
          .get() as typeof examEnrollments.$inferSelect | undefined) ?? null
      );
    },
    findByCandidate(ctx: RequestContext, candidateId: string) {
      const orgId = ctx.targetOrganizationId ?? ctx.organizationId;
      return db
        .select()
        .from(examEnrollments)
        .where(
          and(
            eq(examEnrollments.organizationId, orgId),
            eq(examEnrollments.candidateId, candidateId),
          ),
        )
        .all() as (typeof examEnrollments.$inferSelect)[];
    },
  };
}
