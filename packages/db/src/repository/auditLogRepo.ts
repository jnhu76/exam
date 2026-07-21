import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, gte, lte } from "drizzle-orm";
import type { RequestContext } from "@exam/domain";
import type { Database, TenantContext } from "../types.js";
import { auditLogs, users } from "../schema/pg.js";
import { resolveOrganizationId } from "./baseRepo.js";

/** An audit-log row enriched with the actor's display name (when resolvable). */
export interface AuditLogRowWithActor {
  auditLog: typeof auditLogs.$inferSelect;
  actorName: string | null;
}

/**
 * Filter options for {@link createAuditLogQueryRepo}.listPaginatedFiltered.
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
 * Validated append-only event accepted by the audit storage boundary.
 */
export interface AuditLogInsert<Action extends string> {
  actorId: string;
  action: Action;
  targetType: string;
  targetId: string;
  metadata: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

export interface AuditLogWriter<Action extends string> {
  insert(
    ctx: TenantContext | RequestContext,
    event: AuditLogInsert<Action>,
  ): Promise<void>;
}

export function createAuditLogWriter<Action extends string>(
  db: Database,
): AuditLogWriter<Action> {
  return {
    async insert(ctx, event) {
      await db.insert(auditLogs).values({
        id: randomUUID(),
        organizationId: resolveOrganizationId(ctx),
        ...event,
      });
    },
  };
}

export function createAuditLogQueryRepo(db: Database) {
  return {
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
      items: AuditLogRowWithActor[];
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
        .select({
          auditLog: auditLogs,
          actorName: users.name,
        })
        .from(auditLogs)
        .leftJoin(users, eq(users.id, auditLogs.actorId))
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
    ): Promise<AuditLogRowWithActor[]> {
      const orgId = resolveOrganizationId(ctx);
      return db
        .select({
          auditLog: auditLogs,
          actorName: users.name,
        })
        .from(auditLogs)
        .leftJoin(users, eq(users.id, auditLogs.actorId))
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

export const createAuditLogRepo = createAuditLogQueryRepo;
