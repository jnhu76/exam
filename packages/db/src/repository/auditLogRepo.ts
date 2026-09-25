import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";
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
 * Filter options for the audit-log query repo.
 *
 * - `action` / `targetType` / `targetId` / `actorId`: exact-match filters.
 * - `from` / `to`: inclusive `createdAt` bounds (JS `Date` against the
 *   `timestamptz` column). Either or both may be omitted.
 */
export interface AuditLogListFilter {
  action?: string;
  targetType?: string;
  targetId?: string;
  actorId?: string;
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
     * Counts audit log entries matching a filter, scoped to the tenant.
     */
    async countFiltered(
      ctx: TenantContext | RequestContext,
      filter: AuditLogListFilter = {},
    ): Promise<number> {
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
      if (filter.actorId) {
        conditions.push(eq(auditLogs.actorId, filter.actorId));
      }
      if (filter.from) {
        conditions.push(gte(auditLogs.createdAt, filter.from));
      }
      if (filter.to) {
        conditions.push(lte(auditLogs.createdAt, filter.to));
      }
      const where =
        conditions.length === 1 ? conditions[0] : and(...conditions);
      const [countResult] = await db
        .select({ total: count() })
        .from(auditLogs)
        .where(where);
      return Number(countResult?.total ?? 0);
    },

    /**
     * Counts audit log entries matching a filter AND restricted to specific
     * actions. Used by the merged timeline to get an accurate total of
     * timeline-relevant audit rows without fetching them all into memory.
     */
    async countFilteredByActions(
      ctx: TenantContext | RequestContext,
      filter: AuditLogListFilter = {},
      actions: string[],
    ): Promise<number> {
      if (actions.length === 0) return 0;
      const orgId = resolveOrganizationId(ctx);
      const conditions = [eq(auditLogs.organizationId, orgId)];
      if (filter.targetType) {
        conditions.push(eq(auditLogs.targetType, filter.targetType));
      }
      if (filter.targetId) {
        conditions.push(eq(auditLogs.targetId, filter.targetId));
      }
      conditions.push(inArray(auditLogs.action, actions));
      const where =
        conditions.length === 1 ? conditions[0] : and(...conditions);
      const [countResult] = await db
        .select({ total: count() })
        .from(auditLogs)
        .where(where);
      return Number(countResult?.total ?? 0);
    },

    /**
     * Lists the newest `prefixSize` audit rows matching the filter AND
     * restricted to `actions`, newest first. Used by the merged proctor
     * timeline as the audit PREFIX fetch.
     *
     * INVARIANT: the admission predicate here (org scope AND target
     * filters AND action IN (...)) must stay semantically IDENTICAL to
     * `countFilteredByActions` — list admission and count admission are one
     * predicate. The action filter is applied in SQL BEFORE ORDER BY/LIMIT so
     * the window contains admitted rows only: irrelevant rows can never crowd
     * admitted rows out of the fetch (an in-memory post-filter after LIMIT
     * would under-fill pages and break pagination math).
     *
     * OWNERSHIP: `prefixSize` is caller-owned (derived from the validated
     * page/limit contract and the admitted row count). It is deliberately NOT
     * clamped to the external page-size bound — the route schema owns that
     * bound; clamping here would truncate the merged timeline's window.
     */
    async listTimelinePrefixByActions(
      ctx: TenantContext | RequestContext,
      filter: AuditLogListFilter = {},
      actions: string[],
      prefixSize: number,
    ): Promise<Array<AuditLogRowWithActor & { sortKeyUs: number }>> {
      if (actions.length === 0) return [];
      const orgId = resolveOrganizationId(ctx);
      const limit = Math.max(0, Math.floor(prefixSize));
      if (limit === 0) return [];
      const conditions = [eq(auditLogs.organizationId, orgId)];
      if (filter.targetType) {
        conditions.push(eq(auditLogs.targetType, filter.targetType));
      }
      if (filter.targetId) {
        conditions.push(eq(auditLogs.targetId, filter.targetId));
      }
      conditions.push(inArray(auditLogs.action, actions));
      const where =
        conditions.length === 1 ? conditions[0] : and(...conditions);
      // WHY sortKeyUs: full-precision epoch-µs key for the merged timeline.
      // `created_at` is DB-defaulted (µs clock); a JS Date
      // (ms) merge key would fabricate ties between µs-distinct rows and
      // let the merge disagree with THIS query's DB order inside one
      // source — duplicating/dropping rows at page boundaries. Epoch µs
      // < 2^53 → exact as a JS number.
      return db
        .select({
          auditLog: auditLogs,
          actorName: users.name,
          sortKeyUs: sql<number>`(extract(epoch from ${auditLogs.createdAt}) * 1000000)::double precision`,
        })
        .from(auditLogs)
        .leftJoin(users, eq(users.id, auditLogs.actorId))
        .where(where)
        .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
        .limit(limit);
    },

    /**
     * Lists audit log entries matching a filter, newest first, bounded to the
     * external page size. Used by the admin audit-log list route — NOT by the
     * merged proctor timeline (which must admit actions in SQL before LIMIT;
     * see listTimelinePrefixByActions).
     */
    async listFiltered(
      ctx: TenantContext | RequestContext,
      filter: AuditLogListFilter = {},
      opts: { limit: number; offset?: number } = { limit: 20 },
    ): Promise<AuditLogRowWithActor[]> {
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
      if (filter.actorId) {
        conditions.push(eq(auditLogs.actorId, filter.actorId));
      }
      if (filter.from) {
        conditions.push(gte(auditLogs.createdAt, filter.from));
      }
      if (filter.to) {
        conditions.push(lte(auditLogs.createdAt, filter.to));
      }
      const where =
        conditions.length === 1 ? conditions[0] : and(...conditions);
      const limit = Math.max(1, Math.min(opts.limit, 100));
      const offset = Math.max(0, opts.offset ?? 0);
      return db
        .select({
          auditLog: auditLogs,
          actorName: users.name,
        })
        .from(auditLogs)
        .leftJoin(users, eq(users.id, auditLogs.actorId))
        .where(where)
        .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
        .limit(limit)
        .offset(offset);
    },

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
      if (filter.actorId) {
        conditions.push(eq(auditLogs.actorId, filter.actorId));
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
     * Lists audit log entries with bounded KEYSET-cursor pagination.
     *
     * Ordering is `(created_at DESC, id DESC)` — the `id` tiebreaker makes the
     * order total and stable even for rows sharing an exact `created_at`
     * instant. `after` is the decoded cursor of the last row of the previous
     * page; rows strictly before it (in the ordering) are returned. Fetches
     * `limit + 1` rows so the caller learns `hasMore` without a second query
     * and never skips/duplicates rows when new inserts land between pages.
     */
    async listKeysetFiltered(
      ctx: TenantContext | RequestContext,
      params: {
        limit: number;
        filter?: AuditLogListFilter;
        after?: { createdAt: Date; id: string };
      },
    ): Promise<{
      items: AuditLogRowWithActor[];
      hasMore: boolean;
    }> {
      const orgId = resolveOrganizationId(ctx);
      const filter = params.filter ?? {};
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
      if (filter.actorId) {
        conditions.push(eq(auditLogs.actorId, filter.actorId));
      }
      if (filter.from) {
        conditions.push(gte(auditLogs.createdAt, filter.from));
      }
      if (filter.to) {
        conditions.push(lte(auditLogs.createdAt, filter.to));
      }
      if (params.after) {
        // Keyset predicate: strictly "before" the cursor row in the
        // (created_at DESC, id DESC) ordering.
        const after = params.after;
        const afterPredicate = or(
          lt(auditLogs.createdAt, after.createdAt),
          and(
            eq(auditLogs.createdAt, after.createdAt),
            lt(auditLogs.id, after.id),
          ),
        );
        if (afterPredicate) {
          conditions.push(afterPredicate);
        }
      }
      const where =
        conditions.length === 1 ? conditions[0] : and(...conditions);
      const rows = await db
        .select({
          auditLog: auditLogs,
          actorName: users.name,
        })
        .from(auditLogs)
        .leftJoin(users, eq(users.id, auditLogs.actorId))
        .where(where)
        .orderBy(desc(auditLogs.createdAt), desc(auditLogs.id))
        .limit(params.limit + 1);
      const hasMore = rows.length > params.limit;
      return {
        items: hasMore ? rows.slice(0, params.limit) : rows,
        hasMore,
      };
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
