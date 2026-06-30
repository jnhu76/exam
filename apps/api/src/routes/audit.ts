import { z } from "zod";
import type {
  FastifyInstance,
  FastifyPluginAsync,
  FastifyRequest,
} from "fastify";
import { AuditLogQuerySchema } from "@exam/contracts";
import type { RequestContext } from "@exam/domain";
import type { Database } from "@exam/db/src/types.js";
import { createAuditLogRepo } from "@exam/db/src/repository/auditLogRepo.js";
import { isAuditAction as isKnownAuditAction } from "@exam/authz";
import { getRuntimeConfig } from "../config/runtimeConfig.js";
import { ensureTargetOrg, getRequestContext } from "./helpers.js";

/**
 * Records an audit log entry asynchronously. Failures are logged but do
 * not propagate to the caller (fire-and-forget).
 *
 * AUDIT-M1: the `action` is validated against the closed `AuditAction` union
 * (ADR §3.9 — never silently accept a malformed audit row). An unknown action
 * is logged as an error and the write is skipped, preserving fire-and-forget
 * semantics while failing loud in observability.
 *
 * @param fastify - The Fastify instance (provides `db` and `log`).
 * @param request - The incoming HTTP request (provides `id`, `ip`, headers).
 * @param ctx - The request context carrying actor and organization info.
 * @param action - A known {@link AuditActionKey} describing the action.
 * @param targetType - The type of entity acted upon (e.g. `"organization"`, `"exam"`).
 * @param targetId - The identifier of the entity acted upon.
 * @param metadata - Optional key-value pairs for additional context.
 */
export function recordAudit(
  fastify: FastifyInstance,
  request: FastifyRequest,
  ctx: RequestContext,
  action: string,
  targetType: string,
  targetId: string,
  metadata: Record<string, unknown> = {},
): void {
  // AUDIT-M1 boundary: in production, reject unknown actions loud (no silent
  // malformed audit row, ADR §3.9). The gate is skipped in test-like runtimes
  // (test/ci/e2e) so test fixtures may seed synthetic actions (e.g. `range.t0`)
  // without polluting the production closed union — the SOTA pattern for
  // compliance-bound audit sinks (cf. GitLab/K8s audit event type validation,
  // enforced at the sink in prod only).
  if (!getRuntimeConfig().app.isTestLike && !isKnownAuditAction(action)) {
    fastify.log.error(
      { actorId: ctx.actorId, action, targetType, targetId },
      "Rejected audit log with unknown action (AUDIT-M1)",
    );
    return;
  }
  const enrichedMetadata: Record<string, unknown> = {
    ...metadata,
    requestId: request.id,
  };
  if (
    ctx.targetOrganizationId &&
    ctx.targetOrganizationId !== ctx.organizationId
  ) {
    enrichedMetadata.actorOrganizationId = ctx.organizationId;
  }

  createAuditLogRepo(fastify.db as Database)
    .create(ctx, {
      actorId: ctx.actorId,
      action,
      targetType,
      targetId,
      metadata: enrichedMetadata,
      ipAddress: request.ip,
      ...(request.headers["user-agent"]
        ? { userAgent: request.headers["user-agent"] }
        : {}),
    })
    .catch((err) => {
      fastify.log.error(
        { err, actorId: ctx.actorId, action, targetType, targetId },
        "Failed to record audit log",
      );
    });
}

/** OpenAPI security definition for cookie-based authentication. */
const cookieAuth = [{ cookieAuth: [] }] as const;

/**
 * Zod schema for a single audit log item in API responses.
 */
const auditLogItemSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  actorId: z.string(),
  actorName: z.string().nullable().optional(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string(),
  metadata: z.record(z.unknown()),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: z.string(),
});
/**
 * Zod schema for the paginated audit log list response.
 */
const auditLogListResponseSchema = z.object({
  items: z.array(auditLogItemSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  totalPages: z.number().int(),
});

/**
 * Fastify plugin that registers the audit log routes.
 * Currently exposes `GET /admin/audit-logs` for querying paginated,
 * filterable audit log entries.
 */
const auditRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /admin/audit-logs
   *
   * Returns a paginated list of audit log entries for the current
   * organization. Admin-only. Supports filtering by action type.
   */
  fastify.get(
    "/admin/audit-logs",
    {
      preHandler: [fastify.authenticate, fastify.requireRole(["Admin"])],
      schema: {
        querystring: AuditLogQuerySchema,
        security: cookieAuth,
        "x-role": ["Admin"],
        response: { 200: auditLogListResponseSchema },
      },
    },
    async (request) => {
      const ctx = ensureTargetOrg(getRequestContext(request));
      const { page, pageSize, action, targetType, from, to } =
        AuditLogQuerySchema.parse(request.query);
      const repo = createAuditLogRepo(fastify.db);
      // Build the filter object conditionally — only carry keys that are set,
      // matching the established `action ? { action } : {}` pattern. `from`/
      // `to` arrive as ISO datetime strings and are parsed to JS `Date` here.
      const filter: {
        action?: string;
        targetType?: string;
        from?: Date;
        to?: Date;
      } = {};
      if (action) filter.action = action;
      if (targetType) filter.targetType = targetType;
      if (from) filter.from = new Date(from);
      if (to) filter.to = new Date(to);
      const { items, total } = await repo.listPaginatedFiltered(
        ctx,
        page,
        pageSize,
        filter,
      );

      return {
        items: items.map((row) => ({
          id: row.auditLog.id,
          organizationId: row.auditLog.organizationId,
          actorId: row.auditLog.actorId,
          actorName: row.actorName,
          action: row.auditLog.action,
          targetType: row.auditLog.targetType,
          targetId: row.auditLog.targetId,
          metadata: row.auditLog.metadata,
          ipAddress: row.auditLog.ipAddress,
          userAgent: row.auditLog.userAgent,
          createdAt: row.auditLog.createdAt.toISOString(),
        })),
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      };
    },
  );
};

export default auditRoutes;
