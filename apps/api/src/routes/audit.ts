import type { FastifyInstance, FastifyRequest } from "fastify";
import type { RequestContext } from "@exam/domain";
import type { Database } from "@exam/db/src/types.js";
import { createAuditLogRepo } from "@exam/db/src/repository/auditLogRepo.js";

export function recordAudit(
  fastify: FastifyInstance,
  request: FastifyRequest,
  ctx: RequestContext,
  action: string,
  targetType: string,
  targetId: string,
  metadata: Record<string, unknown> = {},
): void {
  const enrichedMetadata: Record<string, unknown> =
    ctx.targetOrganizationId && ctx.targetOrganizationId !== ctx.organizationId
      ? { ...metadata, actorOrganizationId: ctx.organizationId }
      : metadata;

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
