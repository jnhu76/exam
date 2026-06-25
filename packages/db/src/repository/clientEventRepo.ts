import { randomUUID } from "node:crypto";
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
  };
}
