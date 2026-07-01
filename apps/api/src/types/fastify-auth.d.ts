import "fastify";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Permission, RequestContext, Role } from "@exam/domain";
import type { PermissionKey } from "@exam/authz";

declare module "fastify" {
  interface FastifyRequest {
    ctx?: RequestContext;
  }

  interface FastifyInstance {
    authenticate: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<void>;
    requireRole: (
      roles: Role[],
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requirePermission: (
      permission: Permission,
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /** Phase 3 capability gate (RBAC runtime activation, PR #3). */
    requireCapability: (
      permission: PermissionKey,
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
