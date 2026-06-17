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
import { ensureTargetOrg } from "./helpers.js";

/**
 * Records an audit log entry asynchronously. Failures are logged but do
 * not propagate to the caller (fire-and-forget).
 *
 * @param fastify - The Fastify instance (provides `db` and `log`).
 * @param request - The incoming HTTP request (provides `id`, `ip`, headers).
 * @param ctx - The request context carrying actor and organization info.
 * @param action - A string describing the action performed (e.g. `"branding.update"`).
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
      const ctx = ensureTargetOrg(request.ctx!);
      const { page, pageSize, action } = AuditLogQuerySchema.parse(
        request.query,
      );
      const repo = createAuditLogRepo(fastify.db);
      const { items, total } = await repo.listPaginatedFiltered(
        ctx,
        page,
        pageSize,
        action ? { action } : {},
      );

      return {
        items: items.map((row) => ({
          id: row.id,
          organizationId: row.organizationId,
          actorId: row.actorId,
          action: row.action,
          targetType: row.targetType,
          targetId: row.targetId,
          metadata: row.metadata,
          ipAddress: row.ipAddress,
          userAgent: row.userAgent,
          createdAt: row.createdAt.toISOString(),
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
