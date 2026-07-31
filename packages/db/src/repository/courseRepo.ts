import type { Database, TenantContext } from "../types.js";
import { courses } from "../schema/pg.js";
import {
  createAsyncTenantCrudRepo,
  resolveOrganizationId,
} from "./baseRepo.js";
import type { RequestContext } from "@exam/domain";
import { and, count, eq, sql, type SQL } from "drizzle-orm";

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
}

/** Creates a tenant-scoped CRUD repository for the `courses` table. */
export function createCourseRepo(db: Database) {
  const repo = createAsyncTenantCrudRepo(db, courses);

  return {
    ...repo,
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

      const where = and(...conditions)!;
      const offset = (pagination.page - 1) * pagination.pageSize;

      const [items, total] = await Promise.all([
        db
          .select()
          .from(courses)
          .where(where)
          .orderBy(courses.createdAt)
          .limit(pagination.pageSize)
          .offset(offset),
        countCourses(db, where),
      ]);

      return { items: items as CourseSelect[], total };
    },
  };
}
