import type { Database } from "../types.js";
import { candidateProfiles, examEnrollments, exams } from "../schema/pg.js";
import {
  createAsyncTenantCrudRepo,
  resolveOptionalOrganizationId,
} from "./baseRepo.js";
import type { TenantContext } from "../types.js";
import type { RequestContext } from "@exam/domain";
import { and, count, eq, exists, inArray } from "drizzle-orm";

/** Creates a tenant-scoped CRUD repository for `candidateProfiles` with user lookup. */
export function createCandidateRepo(db: Database) {
  const repo = createAsyncTenantCrudRepo(db, candidateProfiles);

  /**
   * Batch-loads candidate profiles by id, scoped to the tenant. Empty input
   * returns []. Used by the result_published recipient composition
   * (P5-N1-I2) to resolve candidateProfile -> userId without an N+1.
   */
  async function findByIds(
    ctx: TenantContext | RequestContext,
    candidateIds: string[],
  ) {
    if (candidateIds.length === 0) return [];
    const orgId = resolveOptionalOrganizationId(ctx);
    const rows = await db
      .select()
      .from(candidateProfiles)
      .where(
        and(
          eq(candidateProfiles.organizationId, orgId),
          inArray(candidateProfiles.id, candidateIds),
        ),
      );
    return rows as (typeof candidateProfiles.$inferSelect)[];
  }

  return {
    ...repo,
    findByIds,
    /**
     * Finds a candidate profile by the associated user ID, scoped to the tenant.
     */
    async findByUserId(ctx: TenantContext | RequestContext, userId: string) {
      const orgId = resolveOptionalOrganizationId(ctx);
      const rows = await db
        .select()
        .from(candidateProfiles)
        .where(
          and(
            eq(candidateProfiles.organizationId, orgId),
            eq(candidateProfiles.userId, userId),
          ),
        );
      return (
        (rows[0] as typeof candidateProfiles.$inferSelect | undefined) ?? null
      );
    },
    /**
     * Candidates restricted to the given course scope with pagination
     * (issue #286 §3F): a candidate is in scope when it has an ENROLLMENT
     * whose exam's course is one of `courseIds` (EXISTS, SQL-side, applied
     * BEFORE limit/offset and the total count — never post-pagination). An
     * EMPTY course-id set yields `{ items: [], total: 0 }` by contract.
     * Ordering matches the generic listPaginated (createdAt, id).
     */
    async listByCourseScopePaginated(
      ctx: TenantContext | RequestContext,
      courseIds: string[],
      page: number,
      pageSize: number,
    ): Promise<{
      items: (typeof candidateProfiles.$inferSelect)[];
      total: number;
    }> {
      if (courseIds.length === 0) return { items: [], total: 0 };
      const orgId = resolveOptionalOrganizationId(ctx);
      const where = and(
        eq(candidateProfiles.organizationId, orgId),
        exists(
          db
            .select({ id: examEnrollments.id })
            .from(examEnrollments)
            .innerJoin(exams, eq(examEnrollments.examId, exams.id))
            .where(
              and(
                eq(examEnrollments.organizationId, orgId),
                eq(exams.organizationId, orgId),
                eq(examEnrollments.candidateId, candidateProfiles.id),
                inArray(exams.courseId, courseIds),
              ),
            ),
        ),
      )!;
      const offset = (page - 1) * pageSize;
      const [items, totalRows] = await Promise.all([
        db
          .select()
          .from(candidateProfiles)
          .where(where)
          .orderBy(candidateProfiles.createdAt, candidateProfiles.id)
          .limit(pageSize)
          .offset(offset),
        db.select({ value: count() }).from(candidateProfiles).where(where),
      ]);
      return {
        items: items as (typeof candidateProfiles.$inferSelect)[],
        total: Number(totalRows[0]?.value ?? 0),
      };
    },
  };
}
