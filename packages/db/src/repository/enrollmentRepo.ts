import type { Database } from "../types.js";
import { examEnrollments } from "../schema/pg.js";
import {
  createAsyncTenantCrudRepo,
  resolveOptionalOrganizationId,
} from "./baseRepo.js";
import type { TenantContext } from "../types.js";
import type { RequestContext } from "@exam/domain";
import { and, eq } from "drizzle-orm";

export function createEnrollmentRepo(db: Database) {
  const repo = createAsyncTenantCrudRepo(db, examEnrollments);

  return {
    ...repo,
    async findByExamAndCandidate(
      ctx: TenantContext | RequestContext,
      examId: string,
      candidateId: string,
    ) {
      const orgId = resolveOptionalOrganizationId(ctx);
      const rows = await db
        .select()
        .from(examEnrollments)
        .where(
          and(
            eq(examEnrollments.organizationId, orgId),
            eq(examEnrollments.examId, examId),
            eq(examEnrollments.candidateId, candidateId),
          ),
        );
      return (
        (rows[0] as typeof examEnrollments.$inferSelect | undefined) ?? null
      );
    },
    async findByExamAndCandidateForUpdate(
      ctx: TenantContext | RequestContext,
      examId: string,
      candidateId: string,
    ) {
      const orgId = resolveOptionalOrganizationId(ctx);
      const rows = await db
        .select()
        .from(examEnrollments)
        .for("update")
        .where(
          and(
            eq(examEnrollments.organizationId, orgId),
            eq(examEnrollments.examId, examId),
            eq(examEnrollments.candidateId, candidateId),
          ),
        );
      return (
        (rows[0] as typeof examEnrollments.$inferSelect | undefined) ?? null
      );
    },
    async findByCandidate(
      ctx: TenantContext | RequestContext,
      candidateId: string,
    ) {
      const orgId = resolveOptionalOrganizationId(ctx);
      return (await db
        .select()
        .from(examEnrollments)
        .where(
          and(
            eq(examEnrollments.organizationId, orgId),
            eq(examEnrollments.candidateId, candidateId),
          ),
        )) as (typeof examEnrollments.$inferSelect)[];
    },
  };
}
