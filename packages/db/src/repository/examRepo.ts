import type { Database } from "../types.js";
import { courses, exams, organizations } from "../schema/pg.js";
import {
  createAsyncTenantCrudRepo,
  resolveOrganizationId,
} from "./baseRepo.js";
import type { TenantContext } from "../types.js";
import type { RequestContext } from "@exam/domain";
import { and, eq } from "drizzle-orm";

type ExamSelect = typeof exams.$inferSelect;

/**
 * Creates the tenant-scoped repository for the `exams` table. Extends the
 * generic CRUD repo with a row-locked lookup used by admin operations.
 */
export function createExamRepo(db: Database) {
  const repo = createAsyncTenantCrudRepo(db, exams);

  return {
    ...repo,
    async findAuthorizationChain(
      ctx: TenantContext | RequestContext,
      examId: string,
    ) {
      const orgId = resolveOrganizationId(ctx);
      const rows = await db
        .select({
          examId: exams.id,
          examOrganizationId: exams.organizationId,
          linkedCourseId: exams.courseId,
          courseId: courses.id,
          courseOrganizationId: courses.organizationId,
          organizationId: organizations.id,
        })
        .from(exams)
        .leftJoin(courses, eq(exams.courseId, courses.id))
        .leftJoin(organizations, eq(courses.organizationId, organizations.id))
        .where(and(eq(exams.organizationId, orgId), eq(exams.id, examId)))
        .limit(1);
      return rows[0] ?? null;
    },
    /**
     * Finds an exam by `id` with `FOR UPDATE` row lock, scoped to the tenant.
     *
     * ADR-005 construction hard rule: every admin operation (close, extend,
     * unpublish, archive, ...) must lock the exam row before reconciling and
     * mutating, so no concurrent admin op or scanner races the decision.
     */
    async findByIdForUpdate(
      ctx: TenantContext | RequestContext,
      examId: string,
    ): Promise<ExamSelect | null> {
      const orgId = resolveOrganizationId(ctx);
      const rows = await db
        .select()
        .from(exams)
        .for("update")
        .where(and(eq(exams.organizationId, orgId), eq(exams.id, examId)));
      return (rows[0] as ExamSelect | undefined) ?? null;
    },
  };
}
