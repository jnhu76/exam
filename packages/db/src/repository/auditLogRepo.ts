import { and, asc, count, desc, eq, gte, lte } from "drizzle-orm";
import type { RequestContext } from "@exam/domain";
import type { Database, TenantContext } from "../types.js";
import { auditLogs } from "../schema/pg.js";
import {
  createAsyncTenantCrudRepo,
  resolveOrganizationId,
} from "./baseRepo.js";

/**
 * Filter options for {@link createAuditLogRepo}.listPaginatedFiltered.
 *
 * - `action` / `targetType` / `targetId`: exact-match string filters.
 * - `from` / `to`: inclusive `createdAt` bounds (JS `Date` against the
 *   `timestamptz` column). Either or both may be omitted.
 */
export interface AuditLogListFilter {
  action?: string;
  targetType?: string;
  targetId?: string;
  from?: Date;
  to?: Date;
}

/**
 * Creates a repository for the `auditLogs` table.
 *
 * Extends the base tenant-scoped CRUD repo with paginated filtered listing
 * by action / targetType / inclusive createdAt range, scoped to the caller's
 * organization.
 *
 * @param db - Drizzle database connection.
 * @returns Object with base CRUD methods plus `listPaginatedFiltered`.
 */
export function createAuditLogRepo(db: Database) {
  const base = createAsyncTenantCrudRepo(db, auditLogs);
  return {
    ...base,
    /**
     * Lists audit log entries with pagination and optional filters
     * (action, targetType, inclusive createdAt range). Ordered by `createdAt`
     * descending, scoped to the tenant's organization.
     */
    async listPaginatedFiltered(
      ctx: TenantContext | RequestContext,
      page: number,
      pageSize: number,
      filter: AuditLogListFilter = {},
    ): Promise<{
      items: (typeof auditLogs.$inferSelect)[];
      total: number;
    }> {
      const orgId = resolveOrganizationId(ctx);
      const conditions = [eq(auditLogs.organizationId, orgId)];
      if (filter.action) {
        conditions.push(eq(auditLogs.action, filter.action));
      }
      if (filter.targetType) {
        conditions.push(eq(auditLogs.targetType, filter.targetType));
      }
      if (filter.targetId) {
        conditions.push(eq(auditLogs.targetId, filter.targetId));
      }
      if (filter.from) {
        conditions.push(gte(auditLogs.createdAt, filter.from));
      }
      if (filter.to) {
        conditions.push(lte(auditLogs.createdAt, filter.to));
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
