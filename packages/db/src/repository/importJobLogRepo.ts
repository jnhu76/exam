import { randomUUID } from "node:crypto";
import type { Database, TenantContext } from "../types.js";
import { importJobLogs } from "../schema/pg.js";
import { resolveOrganizationId } from "./baseRepo.js";
import { and, count, desc, eq } from "drizzle-orm";

type ImportJobLogSelect = typeof importJobLogs.$inferSelect;

/**
 * Input for creating an import job log row.
 *
 * `createdCount` / `updatedCount` / `errors` are import-result COUNTS (how
 * many rows were created/updated/errored in this import run), NOT timestamps.
 */
export interface CreateImportJobLogInput {
  type: string;
  status: string;
  total: number;
  createdCount: number;
  updatedCount: number;
  errors: number;
  metadata: Record<string, unknown>;
  errorsDetail?: Array<{ row: number; code: string; message: string }> | null;
}

/**
 * Creates a repository for the `import_job_logs` table — an append-only log of
 * import-run summaries used by admins to review import history and diagnose
 * issues. Rows are written once per import run and never updated.
 *
 * All operations are scoped to the caller's organization (single-tenant
 * boundary): every query filters by `organizationId` resolved from the ctx.
 *
 * @param db - Drizzle database connection.
 * @returns Repository with `create` and `list` methods.
 */
export function createImportJobLogRepo(db: Database) {
  return {
    /**
     * Creates a new import job log row.
     *
     * @param ctx - Tenant context; `organizationId` is resolved from it.
     * @param input - Import-result summary (counts + optional error detail).
     * @returns The persisted log row.
     */
    async create(
      ctx: TenantContext,
      input: CreateImportJobLogInput,
    ): Promise<ImportJobLogSelect> {
      const id = randomUUID();
      const [row] = await db
        .insert(importJobLogs)
        .values({
          id,
          organizationId: resolveOrganizationId(ctx),
          ...input,
          errorsDetail: input.errorsDetail ?? null,
        })
        .returning();
      return row!;
    },

    /**
     * Lists import job logs for the caller's organization, newest-first, with
     * optional filtering by import type. Pagination is page/pageSize based.
     *
     * @param ctx - Tenant context; `organizationId` is resolved from it.
     * @param page - 1-based page number.
     * @param pageSize - Number of rows per page.
     * @param type - Optional import type filter ("candidate" | "question").
     * @returns The page of log rows and the total matching count.
     */
    async list(
      ctx: TenantContext,
      page: number,
      pageSize: number,
      type?: string,
    ): Promise<{ items: ImportJobLogSelect[]; total: number }> {
      const orgId = resolveOrganizationId(ctx);
      const conditions = [eq(importJobLogs.organizationId, orgId)];
      if (type) {
        conditions.push(eq(importJobLogs.type, type));
      }
      const where = and(...conditions);
      const items = await db
        .select()
        .from(importJobLogs)
        .where(where)
        .orderBy(desc(importJobLogs.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize);
      const [totalResult] = await db
        .select({ value: count() })
        .from(importJobLogs)
        .where(where);
      return { items, total: Number(totalResult!.value) };
    },
  };
}
