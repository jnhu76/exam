import { and, desc, eq } from "drizzle-orm";
import type { RequestContext } from "@exam/domain";
import type { Database, TenantContext } from "../types.js";
import { auditLogs } from "../schema/pg.js";
import { createAsyncTenantCrudRepo } from "./baseRepo.js";

export function createAuditLogRepo(db: Database) {
  const base = createAsyncTenantCrudRepo(db, auditLogs);
  return {
    ...base,
    async listPaginatedFiltered(
      ctx: TenantContext | RequestContext,
      page: number,
      pageSize: number,
      filter: { action?: string },
    ): Promise<{
      items: (typeof auditLogs.$inferSelect)[];
      total: number;
    }> {
      const orgId = ctx.targetOrganizationId ?? ctx.organizationId;
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
      const totalRows = await db
        .select({ id: auditLogs.id })
        .from(auditLogs)
        .where(where);
      return { items, total: totalRows.length };
    },
  };
}
