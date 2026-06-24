import type { Database } from "../types.js";
import { questions } from "../schema/pg.js";
import {
  createAsyncTenantCrudRepo,
  resolveOrganizationId,
} from "./baseRepo.js";
import type { TenantContext } from "../types.js";
import type { RequestContext } from "@exam/domain";
import { and, eq, sql } from "drizzle-orm";

type QuestionSelect = typeof questions.$inferSelect;

/** Filter options for listing questions with DB-level filtering. */
export interface QuestionListFilters {
  courseId?: string;
  type?: string;
  difficulty?: number;
  tags?: string[];
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

      const where = and(...conditions);
      const offset = (pagination.page - 1) * pagination.pageSize;

      const [items, totalRows] = await Promise.all([
        db
          .select()
          .from(questions)
          .where(where)
          .orderBy(questions.createdAt)
          .limit(pagination.pageSize)
          .offset(offset),
        db
          .select({ value: sql<number>`count(*)` })
          .from(questions)
          .where(where),
      ]);

      return {
        items: items as QuestionSelect[],
        total: Number(totalRows[0]?.value ?? 0),
      };
    },
  };
}
