import type { Database, TenantContext } from "../types.js";
import { courses, organizations } from "../schema/pg.js";
import {
  createAsyncTenantCrudRepo,
  resolveOrganizationId,
} from "./baseRepo.js";
import type { RequestContext } from "@exam/domain";
import { and, count, eq, inArray, sql, type SQL } from "drizzle-orm";

type CourseSelect = typeof courses.$inferSelect;

async function countCourses(
  db: Database,
  where: SQL<unknown>,
): Promise<number> {
  const rows = await db.select({ value: count() }).from(courses).where(where);
  return rows[0]?.value ?? 0;
}

/** Filter options for listing courses with DB-level filtering. */
export interface CourseListFilters {
  /** Case-insensitive substring search over course `name` or `code`. */
  search?: string;
  /**
   * Restrict the listing to these course ids (issue #286 LIST scope filter).
   * Applied in SQL BEFORE pagination/count — callers pass the actor's active
   * Teacher assignment set (an EMPTY array here yields zero rows by contract).
   */
  courseIds?: string[];
}

/** Creates a tenant-scoped CRUD repository for the `courses` table. */
export function createCourseRepo(db: Database) {
  const repo = createAsyncTenantCrudRepo(db, courses);

  return {
    ...repo,
    /**
     * Authorization chain for the course scope resolver (issue #286): the
     * course row + its organization anchor, org-scoped. Mirrors
     * examRepo.findAuthorizationChain — single query, `.limit(1)`, no
     * error surfacing (the resolver maps null to resource_not_found).
     */
    async findAuthorizationChain(
      ctx: TenantContext | RequestContext,
      courseId: string,
    ) {
      const orgId = resolveOrganizationId(ctx);
      const rows = await db
        .select({
          courseId: courses.id,
          courseOrganizationId: courses.organizationId,
          organizationId: organizations.id,
        })
        .from(courses)
        .leftJoin(organizations, eq(courses.organizationId, organizations.id))
        .where(and(eq(courses.organizationId, orgId), eq(courses.id, courseId)))
        .limit(1);
      return rows[0] ?? null;
    },
    /**
     * Lists courses with optional DB-level filter and pagination.
     * Supports case-insensitive search on `name` and `code`.
     */
    async listFiltered(
      ctx: TenantContext | RequestContext,
      filters: CourseListFilters,
      pagination: { page: number; pageSize: number },
    ): Promise<{ items: CourseSelect[]; total: number }> {
      const orgId = resolveOrganizationId(ctx);
      const conditions = [eq(courses.organizationId, orgId)];

      if (filters.search && filters.search.trim()) {
        const term = filters.search.trim();
        conditions.push(
          sql`(position(lower(${term}) in lower(${courses.name})) > 0 or position(lower(${term}) in lower(${courses.code})) > 0)`,
        );
      }
      if (filters.courseIds) {
        if (filters.courseIds.length === 0) {
          // Scope-contracted empty set: no assigned courses → zero rows
          // (both page and total), never an unfiltered listing.
          return { items: [], total: 0 };
        }
        conditions.push(inArray(courses.id, filters.courseIds));
      }

      const where = and(...conditions)!;
      const offset = (pagination.page - 1) * pagination.pageSize;

      const [items, total] = await Promise.all([
        db
          .select()
          .from(courses)
          .where(where)
          // Tie-break on id so pagination is stable when two courses share a
          // createdAt timestamp (matches the baseRepo ordering contract).
          .orderBy(courses.createdAt, courses.id)
          .limit(pagination.pageSize)
          .offset(offset),
        countCourses(db, where),
      ]);

      return { items: items as CourseSelect[], total };
    },
  };
}
