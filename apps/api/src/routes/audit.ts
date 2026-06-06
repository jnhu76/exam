import type { FastifyInstance, FastifyRequest } from "fastify";
import type { RequestContext } from "@exam/domain";
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
  createAuditLogRepo(fastify.db).create(ctx, {
    actorId: ctx.actorId,
    action,
    targetType,
    targetId,
    metadata,
    ipAddress: request.ip,
    ...(request.headers["user-agent"]
      ? { userAgent: request.headers["user-agent"] }
      : {}),
  });
}
