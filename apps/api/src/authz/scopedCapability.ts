/**
 * Resource-aware capability preHandler (RBAC-M10-finish, P4-2A).
 *
 * Composes the flat role-preset capability check (auth.ts `requireCapability`)
 * with a registered scope resolver (attemptResolver / examResolver), and maps
 * resolver denials per ADR §3.9 (AuthZ Failure Mode Invariant):
 *
 *   resource_not_found      -> 404  (anti-enumeration; canonical not-found)
 *   organization_mismatch   -> 403  (scope inconsistency, never allow)
 *   ownership_mismatch      -> 403
 *   broken_parent_chain     -> 403
 *   resolver_error          -> 503 AUTHZ_UNAVAILABLE (never fail open; never
 *                              masquerade an operational failure as 403)
 *
 * The capability (preset) denial stays 403 PERMISSION_DENIED, identical to the
 * base `requireCapability` decorator — this preHandler is a strict superset of
 * it, so flipping a route from `requireCapability` to `requireScopedCapability`
 * cannot widen access; it only adds the resource-aware layer.
 *
 * ADR §10.3 (legacy stays authoritative during shadow) is unaffected: this
 * preHandler does not run shadow — it is the live capability+resolver gate on
 * routes that have already flipped off `requireRole`.
 *
 * Source of truth: `docs/phase3/rbac/adr-scoped-rbac-architecture.md` §3.9,
 * §Resource Resolver Matrix, §3.4 (organization anchor).
 */
import type { FastifyReply, FastifyRequest } from "fastify";
import { buildErrorResponse } from "../lib/errorResponse.js";
import {
  isScopeDenied,
  type PermissionKey,
  type ResourceRef,
  type ResourceResolverKey,
  type ScopeResolver,
} from "@exam/authz";

/** A resolver lookup keyed by ResolverKey (built by the Fastify plugin).
 *  Partial: a deployment registers only the resolver families its flipped
 *  routes reference (attempt/exam today); an unregistered key surfaces as 503
 *  AUTHZ_UNAVAILABLE at runtime (never fail open). */
export type ResolverRegistry = Partial<
  Record<ResourceResolverKey, ScopeResolver>
>;

/** Predicate that decides the flat role-preset capability verdict. */
export type PresetAllows = (
  request: FastifyRequest,
  permission: PermissionKey,
) => boolean;

/** Input to the resource-aware preHandler builder. */
export interface ScopedCapabilityInput {
  /** The Phase 3 permission this route requires. */
  permission: PermissionKey;
  /** Which registered resolver reduces the resource to a scope. */
  resolverKey: ResourceResolverKey;
  /** The request.params key carrying the resource id (e.g. "attemptId"). */
  resourceIdKey: string;
  /** Resolver lookup (injected; built by the authz plugin from fastify.db). */
  resolvers: ResolverRegistry;
  /** Flat role-preset predicate (injected; wraps @exam/authz permissionsForRole). */
  presetAllows: PresetAllows;
}

/**
 * Builds the resource-aware capability preHandler. Pure: all dependencies
 * (resolvers, preset predicate) are injected, so the ADR §3.9 denial mapping
 * is unit-testable without DB fixtures.
 *
 * Order: preset check first (cheap, 0 DB reads) -> resolver (≤2 DB reads per
 * ADR §22.2). A preset denial never reaches the resolver.
 */
export function buildScopedCapabilityPreHandler(
  input: ScopedCapabilityInput,
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  const { permission, resolverKey, resourceIdKey, resolvers, presetAllows } =
    input;
  return async (request, reply) => {
    const ctx = request.ctx;
    if (!ctx) {
      return reply
        .code(401)
        .send(buildErrorResponse(request.id, "AUTH_REQUIRED"));
    }

    // Stage 1: flat role-preset capability (identical to requireCapability).
    if (!presetAllows(request, permission)) {
      return reply
        .code(403)
        .send(buildErrorResponse(request.id, "PERMISSION_DENIED"));
    }

    // Stage 2: resource-aware scope resolution. The resource id is sourced
    // from request.params per the route's registry resource spec.
    const resolver = resolvers[resolverKey];
    if (!resolver) {
      // Configuration error: a route declared a resolver no plugin registered.
      // Never fail open (ADR §3.9); surface as 503 so it is not masked as 403.
      request.log.error(
        { resolverKey, permission, route: request.url },
        "authz scoped-capability resolver not registered",
      );
      return reply
        .code(503)
        .send(buildErrorResponse(request.id, "AUTHZ_UNAVAILABLE"));
    }

    const params = (request.params ?? {}) as Record<string, string>;
    const resourceId = params[resourceIdKey];
    if (!resourceId) {
      // No resource id on the request (mis-declared route). Fail closed.
      request.log.error(
        { resolverKey, permission, resourceIdKey, route: request.url },
        "authz scoped-capability resource id missing on params",
      );
      return reply
        .code(503)
        .send(buildErrorResponse(request.id, "AUTHZ_UNAVAILABLE"));
    }

    const resourceRef: ResourceRef = { type: resolverKey, id: resourceId };
    const resolution = await resolver.resolve(
      { actorId: ctx.actorId, organizationId: ctx.organizationId },
      resourceRef,
    );

    if (isScopeDenied(resolution)) {
      // ADR §3.9 deny mapping.
      switch (resolution.reason) {
        case "resource_not_found":
          // Preserve the anti-enumeration norm: a missing resource is the
          // handler's canonical 404, not an authz 403.
          return reply
            .code(404)
            .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
        case "organization_mismatch":
        case "ownership_mismatch":
        case "broken_parent_chain":
          // Scope inconsistency: never allow. 403 (ADR §3.9 allows 403/409;
          // 403 keeps it indistinguishable from a capability denial for an
          // unprivileged actor, avoiding existence leak).
          return reply
            .code(403)
            .send(buildErrorResponse(request.id, "PERMISSION_DENIED"));
        case "resolver_error":
          // Operational failure: never fail open, never masquerade as 403.
          return reply
            .code(503)
            .send(buildErrorResponse(request.id, "AUTHZ_UNAVAILABLE"));
        default:
          // Unknown deny reason: fail closed as 503 (defensive; ADR §3.9).
          return reply
            .code(503)
            .send(buildErrorResponse(request.id, "AUTHZ_UNAVAILABLE"));
      }
    }

    // Resolved scope: pass the gate. The handler runs and applies its own
    // business-state + organization predicates (defense-in-depth, ADR §3.4).
  };
}
