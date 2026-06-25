import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql, desc } from "drizzle-orm";
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
 */
export interface ClientEventTimelineRow {
  id: string;
  occurredAt: Date;
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
     * Lists the most-recent client events for one attempt, newest first. Used
     * for the proctor event timeline. Returns safe columns PLUS the raw
     * `metadata` blob; the API service applies a per-event-name allowlist
     * projection before responding, so only non-sensitive fields reach the
     * proctor view. Org-scoped via the context.
     */
    async listRecentByAttempt(
      ctx: TenantContext | RequestContext,
      attemptId: string,
      opts: { limit: number },
    ): Promise<ClientEventTimelineRow[]> {
      const organizationId = resolveOrganizationId(ctx);
      const limit = Math.max(1, Math.min(opts.limit, 100));
      const rows = await db
        .select({
          id: clientEvents.id,
          occurredAt: clientEvents.occurredAt,
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
        .orderBy(desc(clientEvents.occurredAt))
        .limit(limit);
      return rows as ClientEventTimelineRow[];
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
