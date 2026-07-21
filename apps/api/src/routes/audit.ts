import { z } from "zod";
import type { FastifyPluginAsync } from "fastify";
import { AuditLogQuerySchema } from "@exam/contracts";
import { createAuditLogQueryRepo } from "@exam/db/src/repository/auditLogRepo.js";
import { ensureTargetOrg, getRequestContext } from "./helpers.js";
import { Permission } from "@exam/authz";

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
      preHandler: [
        fastify.authenticate,
        fastify.requireCapability(Permission.AuditLogView),
      ],
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
      const repo = createAuditLogQueryRepo(fastify.db);
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
