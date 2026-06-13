import type { FastifyPluginAsync } from "fastify";
import { AuditLogQuerySchema } from "@exam/contracts";
import { createAuditLogRepo } from "@exam/db/src/repository/auditLogRepo.js";
import { ensureTargetOrg } from "./helpers.js";

const auditAdminRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/admin/audit-logs",
    {
      preHandler: [
        fastify.authenticate,
        fastify.requireRole(["Admin", "SuperAdmin"]),
      ],
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

export default auditAdminRoutes;
