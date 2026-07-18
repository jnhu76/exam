/**
 * Own-attempt capability preHandler (RBAC-M10-A, archetype C/D).
 *
 * Resource-aware authorization for the candidate own-attempt routes:
 *
 *   GET /attempts/:id                                  (AttemptViewOwn)
 *   GET /candidate/attempts/:attemptId/take            (AttemptViewOwn)
 *   POST /attempts/:attemptId/answers/:questionId      (AttemptAnswerSave)
 *   POST /attempts/:attemptId/submit                   (AttemptSubmit)
 *   POST /attempts/:attemptId/heartbeat                (AttemptHeartbeatSend)
 *   POST /attempts/:attemptId/restore                  (AttemptRestore)
 *
 * The authorization decision is **capability + ownership**, never role-name
 * (directive §6.1). A principal is authorized iff, in order:
 *
 *   1. The attempt resolves under the actor's organization anchor (ADR §3.4)
 *      via {@link resolveOwnAttemptScope}. Denials map per ADR §3.9 (404 for
 *      resource_not_found — anti-enumeration; 403 for org/chain inconsistency;
 *      503 for operational failure — never fail open).
 *   2. The principal's role preset grants the route's permission (AttemptViewOwn /
 *      AttemptAnswerSave / AttemptSubmit / AttemptHeartbeatSend / AttemptRestore)
 *      AND the attempt's owner (`candidateProfiles.userId`) equals the actor.
 *   3. Otherwise deny — anti-enumeration: a cross-candidate probe (attempt
 *      exists under the org but is not owned by the actor) returns 404, not
 *      403, matching the proven `candidateOwnership.test.ts` convention
 *      ("A cannot read B's attempt -> 404") and Corrective-1's score-route
 *      pattern.
 *
 * **RBAC ≠ state machine** (ADR §262/697, directive §6.5): this preHandler
 * answers only "may this actor access this attempt at all". The handler's
 * existing status / deadline / protocol / version / reconciliation guards are
 * intentionally untouched and remain the authority for runtime legality.
 */
import type { FastifyReply, FastifyRequest } from "fastify";
import type { FastifyBaseLogger } from "fastify";
import type { Database } from "@exam/db/src/types.js";
import { buildErrorResponse } from "../lib/errorResponse.js";
import {
  type PermissionKey,
  type RoleKey,
  type ResolverContext,
} from "@exam/authz";
import {
  resolveOwnAttemptScope,
  isOwnAttemptDenied,
  type OwnAttemptResolution,
} from "./resolvers/ownAttemptResolver.js";

/** Input to the own-attempt capability preHandler builder (pure, injectable). */
export interface OwnAttemptCapabilityInput {
  /** Database handle (injected; built by the authz plugin from fastify.db). */
  db: Database;
  /** Fastify logger (injected; for resolver monitoring events). */
  logger?: FastifyBaseLogger;
  /**
   * Flat role-preset predicate (injected; wraps @exam/authz presetAllows).
   * Same source as {@link requireCapability} — not a role-name branch.
   */
  presetAllows: (role: RoleKey, permission: PermissionKey) => boolean;
}

/**
 * Builds a per-route own-attempt capability preHandler. The route-specific
 * permission is captured at decoration time; the attempt id is sourced from
 * request.params at request time. Pure: the DB + preset dependencies are
 * injected, so the ADR §3.9 denial mapping and the ownership arbitration are
 * unit-testable without DB fixtures (the resolver is stubbed at the repo layer).
 */
export function buildOwnAttemptCapabilityPreHandler(
  input: OwnAttemptCapabilityInput,
): (
  permission: PermissionKey,
  resourceIdKey: string,
) => (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  const { db, logger, presetAllows: allows } = input;
  return (permission, resourceIdKey) => async (request, reply) => {
    const ctx = request.ctx;
    if (!ctx) {
      return reply
        .code(401)
        .send(buildErrorResponse(request.id, "AUTH_REQUIRED"));
    }

    const params = (request.params ?? {}) as Record<string, string>;
    const attemptId = params[resourceIdKey];
    if (!attemptId) {
      request.log.error(
        { route: request.url, resourceIdKey, permission },
        "authz own-attempt capability resource id missing on params",
      );
      return reply
        .code(503)
        .send(buildErrorResponse(request.id, "AUTHZ_UNAVAILABLE"));
    }

    const resolverCtx: ResolverContext = {
      actorId: ctx.actorId,
      organizationId: ctx.organizationId,
    };
    const resolution: OwnAttemptResolution = await resolveOwnAttemptScope(
      db,
      logger,
      resolverCtx,
      attemptId,
    );

    if (isOwnAttemptDenied(resolution)) {
      // ADR §3.9 deny mapping (mirrors scoreCapability.ts:107-134).
      switch (resolution.reason) {
        case "resource_not_found":
          // Anti-enumeration: a missing attempt is the handler's canonical
          // 404, not an authz 403.
          return reply
            .code(404)
            .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
        case "organization_mismatch":
        case "broken_parent_chain":
          // Scope inconsistency: never allow. 403 keeps it indistinguishable
          // from a capability denial for an unprivileged actor (no leak).
          return reply
            .code(403)
            .send(buildErrorResponse(request.id, "PERMISSION_DENIED"));
        case "resolver_error":
          // Operational failure: never fail open, never masquerade as 403.
          return reply
            .code(503)
            .send(buildErrorResponse(request.id, "AUTHZ_UNAVAILABLE"));
        default:
          return reply
            .code(503)
            .send(buildErrorResponse(request.id, "AUTHZ_UNAVAILABLE"));
      }
    }

    // Resolved under the org anchor. Capability + ownership arbitration: the
    // role preset must grant the route permission AND the attempt owner must
    // be the actor. No ctx.role === "..." branch.
    const role = ctx.role as RoleKey;
    if (!allows(role, permission)) {
      return reply
        .code(403)
        .send(buildErrorResponse(request.id, "PERMISSION_DENIED"));
    }
    const ownerUserId = resolution.ownership.ownerUserId;
    if (ownerUserId !== null && ownerUserId === ctx.actorId) {
      return;
    }
    // Capability holder but not the owner. Anti-enumeration: return 404 (not
    // 403) so a candidate probing another candidate's attemptId cannot
    // distinguish "exists but not mine" from "does not exist". Matches the
    // documented cross-candidate convention (candidateOwnership.test.ts) and
    // the score-route precedent.
    return reply
      .code(404)
      .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
  };
}
