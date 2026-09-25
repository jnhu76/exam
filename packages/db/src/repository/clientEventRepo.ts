import { randomUUID } from "node:crypto";
import { and, eq, inArray, lt, sql, desc } from "drizzle-orm";
import type { RequestContext } from "@exam/domain";
import type { Database, TenantContext } from "../types.js";
import { clientEvents } from "../schema/pg.js";
import { resolveOrganizationId } from "./baseRepo.js";

/**
 * Input shape for a single client-event row to persist. The caller (API
 * route) is responsible for supplying `organizationId`, `userId`, and
 * `receivedAt` from server state — never from the client payload — and for
 * redacting sensitive fields from `metadata`.
 */
export interface ClientEventInsert {
  userId: string | null;
  attemptId: string | null;
  examId: string | null;
  questionId: string | null;
  kind: string;
  level: string;
  name: string;
  route: string | null;
  occurredAt: Date;
  receivedAt: Date;
  clientSessionId: string | null;
  metadata: Record<string, unknown>;
  userAgent: string | null;
}

/**
 * Safe projection of a client-event row for the proctor timeline. Returns the
 * raw `metadata` blob here (the API service applies a per-event-name allowlist
 * projection before it leaves the server, so only non-sensitive fields reach
 * the response). No `userId`/`userAgent`.
 *
 * `receivedAt` (server-owned) is the timeline ORDERING authority;
 * `occurredAt` (client-asserted) is carried for display only.
 */
export interface ClientEventTimelineRow {
  id: string;
  occurredAt: Date;
  receivedAt: Date;
  name: string;
  level: string;
  kind: string;
  route: string | null;
  metadata: Record<string, unknown>;
}

/**
 * Creates a repository for the `clientEvents` table.
 *
 * Unlike the standard tenant CRUD factory, this table has no
 * `createdAt`/`updatedAt` columns (it carries `occurredAt` / `receivedAt`
 * instead), so the write path is bespoke. All writes are scoped to the
 * caller's `organizationId` resolved from the request/tenant context —
 * callers cannot inject their own organization.
 *
 * @param db - Drizzle database connection.
 */
export function createClientEventRepo(db: Database) {
  return {
    /**
     * Inserts a batch of client events, all scoped to the context's
     * organization. Each row gets a fresh server-generated `id`. This is a
     * single bulk insert for efficiency.
     *
     * @returns The number of rows inserted.
     */
    async createMany(
      ctx: TenantContext | RequestContext,
      rows: ClientEventInsert[],
    ): Promise<number> {
      if (rows.length === 0) return 0;
      const organizationId = resolveOrganizationId(ctx);
      const values = rows.map((row) => ({
        id: randomUUID(),
        organizationId,
        userId: row.userId,
        attemptId: row.attemptId,
        examId: row.examId,
        questionId: row.questionId,
        kind: row.kind,
        level: row.level,
        name: row.name,
        route: row.route,
        occurredAt: row.occurredAt,
        receivedAt: row.receivedAt,
        clientSessionId: row.clientSessionId,
        metadata: row.metadata,
        userAgent: row.userAgent,
      }));
      await db.insert(clientEvents).values(values);
      return values.length;
    },

    /**
     * Counts client events grouped by `(attemptId, name)` for one exam, filtered
     * to the given event names. Used by the proctor monitoring service to
     * compute per-attempt counts (visibility_lost, browser_offline, save/submit
     * failures, etc.). Org-scoped via the context.
     *
     * @returns Map<attemptId, Map<eventName, count>>. Attempts/names with zero
     *   matching events are absent (callers treat absence as 0).
     */
    async countByNamesForExam(
      ctx: TenantContext | RequestContext,
      examId: string,
      names: string[],
    ): Promise<Map<string, Map<string, number>>> {
      const organizationId = resolveOrganizationId(ctx);
      if (names.length === 0) return new Map();
      const rows = await db
        .select({
          attemptId: clientEvents.attemptId,
          name: clientEvents.name,
          count: sql<number>`count(*)::int`,
        })
        .from(clientEvents)
        .where(
          and(
            eq(clientEvents.organizationId, organizationId),
            eq(clientEvents.examId, examId),
            inArray(clientEvents.name, names),
          ),
        )
        .groupBy(clientEvents.attemptId, clientEvents.name);

      const result = new Map<string, Map<string, number>>();
      for (const row of rows) {
        if (!row.attemptId) continue; // events without an attemptId are irrelevant here
        let perAttempt = result.get(row.attemptId);
        if (!perAttempt) {
          perAttempt = new Map<string, number>();
          result.set(row.attemptId, perAttempt);
        }
        perAttempt.set(row.name, Number(row.count));
      }
      return result;
    },

    /**
     * Lists the newest `prefixSize` client events for one attempt (offset 0),
     * newest first. Used by the merged proctor timeline as the client-event
     * PREFIX fetch. Org-scoped via the context. Returns safe columns PLUS the
     * raw `metadata` blob; the API service applies a per-event-name allowlist
     * projection before responding, so only non-sensitive fields reach the
     * proctor view.
     *
     * INVARIANT: ordering authority is the server-owned `receivedAt`
     * with `id` as the deterministic tiebreaker — never the client-asserted
     * `occurredAt`, which a malicious client can set to any instant to
     * hijack the timeline head/tail or pagination. Backed by
     * `client_events_org_attempt_received_at_idx`.
     *
     * OWNERSHIP: `prefixSize` is caller-owned (derived from the validated
     * page/limit contract and the admitted row count). It is deliberately NOT
     * clamped to the external page-size bound — the route schema owns that
     * bound; clamping here would truncate the merged timeline's window.
     */
    async listTimelinePrefixByAttempt(
      ctx: TenantContext | RequestContext,
      attemptId: string,
      prefixSize: number,
    ): Promise<Array<ClientEventTimelineRow & { sortKeyUs: number }>> {
      const organizationId = resolveOrganizationId(ctx);
      const limit = Math.max(0, Math.floor(prefixSize));
      if (limit === 0) return [];
      const rows = await db
        .select({
          id: clientEvents.id,
          occurredAt: clientEvents.occurredAt,
          receivedAt: clientEvents.receivedAt,
          // WHY sortKeyUs: the merged timeline sorts on this full-precision
          // epoch-µs key. JS Date (getTime) truncates timestamptz to
          // milliseconds, fabricating ties between µs-distinct rows; sorting
          // on the truncated key would let the merge disagree with THIS
          // query's DB order inside one source and duplicate/drop rows at
          // page boundaries. Epoch µs < 2^53 → exact as a JS number.
          sortKeyUs: sql<number>`(extract(epoch from ${clientEvents.receivedAt}) * 1000000)::double precision`,
          name: clientEvents.name,
          level: clientEvents.level,
          kind: clientEvents.kind,
          route: clientEvents.route,
          metadata: clientEvents.metadata,
        })
        .from(clientEvents)
        .where(
          and(
            eq(clientEvents.organizationId, organizationId),
            eq(clientEvents.attemptId, attemptId),
          ),
        )
        .orderBy(desc(clientEvents.receivedAt), desc(clientEvents.id))
        .limit(limit);
      return rows;
    },

    /**
     * Counts client events for one attempt, scoped to the tenant.
     */
    async countByAttempt(
      ctx: TenantContext | RequestContext,
      attemptId: string,
    ): Promise<number> {
      const organizationId = resolveOrganizationId(ctx);
      const rows = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(clientEvents)
        .where(
          and(
            eq(clientEvents.organizationId, organizationId),
            eq(clientEvents.attemptId, attemptId),
          ),
        );
      return Number(rows[0]?.count ?? 0);
    },

    /**
     * Deletes client events for the context's organization whose server-owned
     * `receivedAt` is strictly older than `cutoff`. THE retention primitive
     * for `client_events`: the horizon is owned by the application-level
     * retention executor (`CLIENT_EVENT_RETENTION_DAYS`), not a per-tenant
     * setting.
     *
     * Boundary semantics: `receivedAt < cutoff` deletes; `receivedAt == cutoff`
     * and newer are kept (strict inequality — a cutoff computed as
     * `now - horizon` retains exactly the horizon-old row).
     *
     * Idempotent and restart-safe by construction (pure convergence delete).
     * Backed by `client_events_org_received_at_idx`. Never touches any other
     * table; authoritative records (audit logs, attempts, retention_runs) have
     * independent lifecycle.
     *
     * @returns The number of rows deleted.
     */
    async deleteOlderThan(
      ctx: TenantContext | RequestContext,
      cutoff: Date,
    ): Promise<number> {
      const organizationId = resolveOrganizationId(ctx);
      const deleted = await db
        .delete(clientEvents)
        .where(
          and(
            eq(clientEvents.organizationId, organizationId),
            lt(clientEvents.receivedAt, cutoff),
          ),
        )
        .returning({ id: clientEvents.id });
      return deleted.length;
    },

    /**
     * For one exam, maps each attemptId to the most-recent `receivedAt` among
     * its client events. Used to populate `lastClientEventAt` on the proctor
     * status rows. Org-scoped via the context.
     */
    async lastReceivedAtForExam(
      ctx: TenantContext | RequestContext,
      examId: string,
    ): Promise<Map<string, Date>> {
      const organizationId = resolveOrganizationId(ctx);
      const rows = await db
        .select({
          attemptId: clientEvents.attemptId,
          last: sql<Date>`max(${clientEvents.receivedAt})`,
        })
        .from(clientEvents)
        .where(
          and(
            eq(clientEvents.organizationId, organizationId),
            eq(clientEvents.examId, examId),
          ),
        )
        .groupBy(clientEvents.attemptId);

      const result = new Map<string, Date>();
      for (const row of rows) {
        if (!row.attemptId || !row.last) continue;
        result.set(row.attemptId, new Date(row.last));
      }
      return result;
    },
  };
}
