import type { Database } from "../types.js";
import { courses, organizations, questions } from "../schema/pg.js";
import {
  createAsyncTenantCrudRepo,
  resolveOrganizationId,
} from "./baseRepo.js";
import type { TenantContext } from "../types.js";
import type { RequestContext } from "@exam/domain";
import { and, count, eq, sql, type SQL } from "drizzle-orm";

type QuestionSelect = typeof questions.$inferSelect;

async function countQuestions(
  db: Database,
  where: SQL<unknown>,
): Promise<number> {
  const rows = await db.select({ value: count() }).from(questions).where(where);
  return rows[0]?.value ?? 0;
}

/** Filter options for listing questions with DB-level filtering. */
export interface QuestionListFilters {
  courseId?: string;
  type?: string;
  difficulty?: number;
  tags?: string[];
  /** Case-insensitive substring search over question `content` (trimmed). */
  search?: string;
}

/**
 * Creates a tenant-scoped CRUD repository for the `questions` table,
 * with an additional `listFiltered` method that pushes filtering to SQL.
 */
export function createQuestionRepo(db: Database) {
  const repo = createAsyncTenantCrudRepo(db, questions);

  return {
    ...repo,
    /**
     * Authorization chain for the question scope resolver (issue #286):
     * question → course → organization, org-scoped. Mirrors
     * examRepo.findAuthorizationChain; a null course id surfaces through the
     * resolver as a broken parent chain (never silently allowed).
     */
    async findAuthorizationChain(
      ctx: TenantContext | RequestContext,
      questionId: string,
    ) {
      const orgId = resolveOrganizationId(ctx);
      const rows = await db
        .select({
          questionId: questions.id,
          questionOrganizationId: questions.organizationId,
          linkedCourseId: questions.courseId,
          courseId: courses.id,
          courseOrganizationId: courses.organizationId,
          organizationId: organizations.id,
        })
        .from(questions)
        .leftJoin(courses, eq(questions.courseId, courses.id))
        .leftJoin(organizations, eq(courses.organizationId, organizations.id))
        .where(
          and(
            eq(questions.organizationId, orgId),
            eq(questions.id, questionId),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    },
    /**
     * Lists questions with optional DB-level filters and pagination.
     * Filtering is done in SQL rather than in-memory for performance.
     */
    async listFiltered(
      ctx: TenantContext | RequestContext,
      filters: QuestionListFilters,
      pagination: { page: number; pageSize: number },
    ): Promise<{ items: QuestionSelect[]; total: number }> {
      const orgId = resolveOrganizationId(ctx);
      const conditions = [eq(questions.organizationId, orgId)];

      if (filters.courseId) {
        conditions.push(eq(questions.courseId, filters.courseId));
      }
      if (filters.type) {
        conditions.push(eq(questions.type, filters.type));
      }
      if (filters.difficulty !== undefined) {
        conditions.push(eq(questions.difficulty, filters.difficulty));
      }
      if (filters.tags && filters.tags.length > 0) {
        for (const tag of filters.tags) {
          conditions.push(
            sql`${questions.tags} @> ${JSON.stringify([tag])}::jsonb`,
          );
        }
      }
      // Server-side search: case-insensitive substring match on `content`.
      // Mirrors the former client predicate (content.toLowerCase().includes(
      // search.toLowerCase())) but applies to the full dataset before count +
      // pagination. We use POSITION(lower(content) IN lower($term)) > 0 rather
      // than ILIKE so the user term needs NO wildcard escaping — a search for
      // "a_b" or "100%" matches literally, never as a LIKE pattern. (For full
      // Unicode case-folding a pg_trgm index would be needed — deferred, see
      // token-semantic-audit performance note.) Empty/whitespace search is a
      // no-op (matches the client's empty-string behavior).
      if (filters.search && filters.search.trim()) {
        const term = filters.search.trim();
        // POSITION(substr IN str): returns 1-based index of substr in str, 0 if
        // absent. We search for the (lowercased) term INSIDE the (lowercased)
        // content. No LIKE wildcard escaping needed — term matches literally.
        conditions.push(
          sql`position(lower(${term}) in lower(${questions.content})) > 0`,
        );
      }

      const where = and(...conditions)!;
      const offset = (pagination.page - 1) * pagination.pageSize;

      const [items, total] = await Promise.all([
        db
          .select()
          .from(questions)
          .where(where)
          .orderBy(questions.createdAt)
          .limit(pagination.pageSize)
          .offset(offset),
        countQuestions(db, where),
      ]);

      return { items: items as QuestionSelect[], total };
    },

    /**
     * Returns the distinct set of tag strings used by any question in the
     * tenant, sorted ascending. Backs the admin tag-filter vocabulary
     * endpoint (issue 182). The jsonb_array_elements argument is guarded by a
     * CASE at the expansion site, so a legacy non-array tags value cannot
     * break the listing regardless of planner qual placement; null and empty
     * elements are excluded so the vocabulary only contains real tags.
     */
    async listAllTags(ctx: TenantContext | RequestContext): Promise<string[]> {
      const orgId = resolveOrganizationId(ctx);
      const rows = await db.execute<{ tag: string }>(sql`
        select distinct tag_value #>> '{}' as tag
        from ${questions},
          jsonb_array_elements(
            case when jsonb_typeof(${questions.tags}) = 'array'
                 then ${questions.tags}
                 else '[]'::jsonb end
          ) as tag_value
        where ${questions.organizationId} = ${orgId}
          and (tag_value #>> '{}') is not null
          and (tag_value #>> '{}') <> ''
        order by tag
      `);
      return rows.map((row) => row.tag);
    },

    /**
     * Returns the count of questions belonging to a specific course,
     * scoped to the tenant. Used by course deletion guard.
     */
    async countByCourseId(
      ctx: TenantContext | RequestContext,
      courseId: string,
    ): Promise<number> {
      const orgId = resolveOrganizationId(ctx);
      const where = and(
        eq(questions.organizationId, orgId),
        eq(questions.courseId, courseId),
      )!;
      return countQuestions(db, where);
    },
  };
}
