import "fastify";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Permission, RequestContext, Role } from "@exam/domain";
import type { PermissionKey, ResourceResolverKey } from "@exam/authz";

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
      resolverKey: ResourceResolverKey,
      resourceIdKey: string,
    ) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    /**
     * Score-route capability gate (RBAC-SCOPED-AUTHORIZATION-CORRECTIVE-1).
     * Capability + ownership arbitration for `GET /scores/attempts/:attemptId`.
     * Authorizes iff the principal's preset grants ScoreAllView (any same-org
     * attempt) OR ScoreOwnView + the attempt's owner is the actor. Own/all is
     * resolved from the preset + resolved ownership — never a role-name branch.
     * Publication visibility remains the handler's concern (ADR §262/691/697).
     */
    requireScoreCapability: () => (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<void>;
  }
}
