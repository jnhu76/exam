import { and, asc, count, desc, eq } from "drizzle-orm";
import type { RequestContext } from "@exam/domain";
import type { Database, TenantContext } from "../types.js";
import { auditLogs } from "../schema/pg.js";
import {
  createAsyncTenantCrudRepo,
  resolveOrganizationId,
} from "./baseRepo.js";

/**
 * Creates a repository for the `auditLogs` table.
 *
 * Extends the base tenant-scoped CRUD repo with paginated filtered listing
 * by action type, scoped to the caller's organization.
 *
 * @param db - Drizzle database connection.
 * @returns Object with base CRUD methods plus `listPaginatedFiltered`.
 */
export function createAuditLogRepo(db: Database) {
  const base = createAsyncTenantCrudRepo(db, auditLogs);
  return {
    ...base,
    /**
     * Lists audit log entries with pagination and optional action filter.
     * Ordered by `createdAt` descending, scoped to the tenant's organization.
     */
    async listPaginatedFiltered(
      ctx: TenantContext | RequestContext,
      page: number,
      pageSize: number,
      filter: { action?: string },
    ): Promise<{
      items: (typeof auditLogs.$inferSelect)[];
      total: number;
    }> {
      const orgId = resolveOrganizationId(ctx);
      const conditions = [eq(auditLogs.organizationId, orgId)];
      if (filter.action) {
        conditions.push(eq(auditLogs.action, filter.action));
      }
      const where =
        conditions.length === 1 ? conditions[0] : and(...conditions);
      const offset = (page - 1) * pageSize;
      const items = await db
        .select()
        .from(auditLogs)
        .where(where)
        .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
        .limit(pageSize)
        .offset(offset);
      const [countResult] = await db
        .select({ total: count() })
        .from(auditLogs)
        .where(where);
      return { items, total: Number(countResult?.total ?? 0) };
    },
    /**
     * Lists all audit log entries for a given target within the tenant's
     * organization, ordered chronologically (oldest-first) for timeline use.
     */
    async listByTarget(
      ctx: TenantContext | RequestContext,
      targetType: string,
      targetId: string,
    ): Promise<(typeof auditLogs.$inferSelect)[]> {
      const orgId = resolveOrganizationId(ctx);
      return db
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.organizationId, orgId),
            eq(auditLogs.targetType, targetType),
            eq(auditLogs.targetId, targetId),
          ),
        )
        .orderBy(asc(auditLogs.createdAt), asc(auditLogs.id));
    },
  };
}
