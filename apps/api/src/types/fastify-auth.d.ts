import "fastify";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Permission, RequestContext, Role } from "@exam/domain";
import type { PermissionKey, ResolverKey } from "@exam/authz";

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
    /**
     * Resource-aware capability gate (RBAC-M10-finish, P4-2A). Strict superset
     * of requireCapability: same preset check, plus a DB-backed scope resolver
     * that verifies the resource's organization anchor + existence (ADR §3.4,
     * §3.9). Resolver denial mapping: resource_not_found -> 404;
     * org/ownership/broken-chain -> 403; resolver_error -> 503 AUTHZ_UNAVAILABLE.
     */
    requireScopedCapability: (
      permission: PermissionKey,
      resolverKey: ResolverKey,
      resourceIdKey: string,
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
