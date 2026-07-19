/**
 * Score route capability preHandler (RBAC-SCOPED-AUTHORIZATION-CORRECTIVE-1).
 *
 * Resource-aware authorization for `GET /scores/attempts/:attemptId`. This is
 * the capability-driven replacement for the legacy `requireRole(["Candidate",
 * "Admin"])` gate, implementing ADR §scope table L444 + §L619-620:
 *
 *   score.own.view OR score.all.view  @  own_score / attempt scope
 *
 * The authorization decision is **capability + ownership**, never role-name.
 * A principal is authorized iff, in order:
 *
 *   1. The attempt resolves under the actor's organization anchor (ADR §3.4)
 *      via {@link resolveScoreScope}. Denials map per ADR §3.9 (404 for
 *      resource_not_found to preserve anti-enumeration; 403 for org/chain
 *      inconsistency; 503 for operational failure — never fail open).
 *   2. The principal's role preset grants `ScoreAllView` → allow (broadest
 *      grant; any same-org attempt). OR
 *   3. The principal's role preset grants `ScoreOwnView` AND the attempt's
 *      owner (`candidateProfiles.userId`) equals the actor → allow.
 *   4. Otherwise deny as 403 PERMISSION_DENIED.
 *
 * The principal's effective permission set is resolved from the role preset
 * (`presetAllows`, the same single source `requireCapability` consults) — NOT
 * from a role-string branch. If a principal ever holds both grants, the
 * `ScoreAllView` path wins (it is strictly broader).
 *
 * **Publication visibility is a separate concern** (ADR §262/691/697: RBAC
 * does not replace the state machine). This preHandler answers only "may this
 * principal access this attempt at all." The handler's `computeResultVisibility`
 * continues to decide which fields are visible based on `ResultPublicationMode`
 * and grading state — that logic is intentionally untouched here.
 */
import type { FastifyReply, FastifyRequest } from "fastify";
import type { FastifyBaseLogger } from "fastify";
import type { Database } from "@exam/db/src/types.js";
import { buildErrorResponse } from "../lib/errorResponse.js";
import {
  Permission,
  type PermissionKey,
  type ResolverContext,
} from "@exam/authz";
import {
  resolveScoreScope,
  isScoreDenied,
  type ScoreResolution,
} from "./resolvers/scoreResolver.js";

/**
 * Capability predicate over the request (RBAC-M10-E). Reads the authoritative
 * `ctx.capabilities` union resolved at authenticate time. Signature matches
 * the scoped / candidate-context / own-attempt / exam-eligibility gates so all
 * five switch authority in lockstep.
 */
export type ScoreCapabilityAllows = (
  request: FastifyRequest,
  permission: PermissionKey,
) => boolean;

/** Input to the score capability preHandler builder (pure, injectable). */
export interface ScoreCapabilityInput {
  /** Database handle (injected; built by the authz plugin from fastify.db). */
  db: Database;
  /** Fastify logger (injected; for resolver monitoring events). */
  logger?: FastifyBaseLogger;
  /**
   * Capability predicate (injected; reads ctx.capabilities). Same authority
   * source as {@link requireCapability} — not a role-name branch.
   */
  allows: ScoreCapabilityAllows;
}

/** The route param key carrying the attempt id (fixed for the score route). */
const ATTEMPT_ID_PARAM = "attemptId";

/**
 * Builds the score capability preHandler. Pure: the DB + preset dependencies
 * are injected, so the ADR §3.9 denial mapping and the own/all arbitration are
 * unit-testable without DB fixtures (the resolver is stubbed at the repo layer).
 */
export function buildScoreCapabilityPreHandler(
  input: ScoreCapabilityInput,
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  const { db, logger, allows } = input;
  return async (request, reply) => {
    const ctx = request.ctx;
    if (!ctx) {
      return reply
        .code(401)
        .send(buildErrorResponse(request.id, "AUTH_REQUIRED"));
    }

    const params = (request.params ?? {}) as Record<string, string>;
    const attemptId = params[ATTEMPT_ID_PARAM];
    if (!attemptId) {
      request.log.error(
        { route: request.url, resourceIdKey: ATTEMPT_ID_PARAM },
        "authz score capability resource id missing on params",
      );
      return reply
        .code(503)
        .send(buildErrorResponse(request.id, "AUTHZ_UNAVAILABLE"));
    }

    const resolverCtx: ResolverContext = {
      actorId: ctx.actorId,
      organizationId: ctx.organizationId,
    };
    const resolution: ScoreResolution = await resolveScoreScope(
      db,
      logger,
      resolverCtx,
      attemptId,
    );

    if (isScoreDenied(resolution)) {
      // ADR §3.9 deny mapping (mirrors scopedCapability.ts:129-155).
      switch (resolution.reason) {
        case "resource_not_found":
          // Anti-enumeration: a missing attempt is the handler's canonical 404,
          // not an authz 403 (p4-mvp-rbac-route-matrix §L).
          return reply
            .code(404)
            .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
        case "organization_mismatch":
        case "ownership_mismatch":
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

    // Resolved under the org anchor. Now arbitrate own vs all by CAPABILITY
    // (read from ctx.capabilities — the authoritative assignment union).
    // No ctx.role === "..." branch: the decision is purely perm + ownership.
    // ScoreAllView wins (strictly broader) — matching the prior arbitration
    // order. A multi-role actor reaching here via ScoreAllView gets "all".
    if (allows(request, Permission.ScoreAllView)) {
      request.scoreView = "all";
      return;
    }
    if (allows(request, Permission.ScoreOwnView)) {
      // Own-only: the attempt's owner must be the actor.
      const ownerUserId = resolution.ownership.ownerUserId;
      if (ownerUserId !== null && ownerUserId === ctx.actorId) {
        request.scoreView = "own";
        return;
      }
      // Own-view holder but not the owner. Anti-enumeration: return 404 (not
      // 403) so a candidate probing another candidate's attemptId cannot
      // distinguish "exists but not mine" from "does not exist".
      return reply
        .code(404)
        .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
    }

    // Principal holds neither score capability. Deny as 403 (this is a genuine
    // capability denial, not an ownership ambiguity — e.g. Grader/Proctor
    // hitting a candidate-only route).
    return reply
      .code(403)
      .send(buildErrorResponse(request.id, "PERMISSION_DENIED"));
  };
}
