import "fastify";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Permission, RequestContext, Role } from "@exam/domain";
import type { PermissionKey, ResourceResolverKey } from "@exam/authz";
import type { RuntimeRequestContext } from "./requestContext.js";

/**
 * Route-specific eligibility denial policy for exam-eligibility routes.
 *
 * - `resource_not_found`: missing profile/enrollment → 404 (anti-enumeration).
 * - `permission_denied`: missing profile/enrollment → 403.
 */
export type EligibilityDenialMode = "resource_not_found" | "permission_denied";

/**
 * Metadata attached to preHandler functions returned by the authz decorators.
 * Used by introspection tests to verify the correct kind of gate is wired at
 * runtime (RBAC-SCOPED-AUTHORIZATION-CORRECTIVE-2, Finding 2; extended for the
 * 4 candidate-runtime archetypes in RBAC-M10-A).
 *
 * Per directive §7, an ownership/eligibility/context gate gets an explicit
 * kind distinct from generic `scoped` (org-anchor-only). The candidate-runtime
 * kinds are:
 *   - candidate_context: archetype A (candidate-context list, preset-only).
 *   - exam_eligibility: archetype B (exam + server-derived candidate profile
 *     + enrollment; no attempt yet).
 *   - own_attempt: archetype C/D (own-attempt ownership: candidateProfiles.userId
 *     === actorId).
 */
export type AuthzMetadata =
  | { kind: "flat"; permission: PermissionKey }
  | {
      kind: "scoped";
      permission: PermissionKey;
      resolverKey: ResourceResolverKey;
      resourceIdKey: string;
    }
  | { kind: "candidate_context"; permission: PermissionKey }
  | {
      kind: "exam_eligibility";
      permission: PermissionKey;
      resourceIdKey: string;
      eligibilityDenialMode: EligibilityDenialMode;
    }
  | {
      kind: "own_attempt";
      permission: PermissionKey;
      resourceIdKey: string;
    };

/**
 * PreHandler function with runtime-observable authz metadata.
 * The function is callable by Fastify; the `authz` property is for test
 * introspection (cross-org integration test + onRoute capture).
 */
export interface AuthzPreHandler {
  (request: FastifyRequest, reply: FastifyReply): Promise<void>;
  authz: AuthzMetadata;
}

declare module "fastify" {
  interface FastifyRequest {
    /**
     * The runtime request context. On authenticated requests this is a
     * {@link RuntimeRequestContext} (carrying `roles` + `capabilities`).
     * Typed as the base {@link RequestContext} for callers that only need
     * the base fields; capability gates cast to RuntimeRequestContext.
     */
    ctx?: RuntimeRequestContext;
    /**
     * Score preHandler's authoritative own/all decision (RBAC-M10-E). Set
     * ONLY by `requireScoreCapability`'s preHandler after it arbitrates
     * ScoreAllView vs ScoreOwnView+ownership. Consumed by the score
     * publication handler to decide visibility — NEVER defaults; a missing
     * signal is a wiring bug and surfaces as 503 AUTHZ_UNAVAILABLE (P1-4).
     */
    scoreView?: "own" | "all";
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
    requireCapability: (permission: PermissionKey) => AuthzPreHandler;
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
    ) => AuthzPreHandler;
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
    /**
     * Candidate-context capability gate (RBAC-M10-A archetype A). Preset-only
     * gate for `GET /candidate/exams` — the query is scoped to the candidate
     * profile in the handler (defense-in-depth). No DB resolver. Replies 401
     * if no ctx, 403 if the preset lacks the permission. Attaches runtime
     * metadata `{ kind: "candidate_context", permission }`.
     */
    requireCandidateContext: (permission: PermissionKey) => AuthzPreHandler;
    /**
     * Candidate exam-eligibility gate (RBAC-M10-A archetype B). Capability +
     * eligibility for exam detail / queue / start. The exam must resolve under
     * the org anchor (ADR §3.4) AND the actor must resolve to a candidate
     * profile with an enrollment for the exam — server-derived, no client
     * candidateId trust. Anti-enumeration: missing exam / no enrollment -> 404.
     * Attaches runtime metadata `{ kind: "exam_eligibility", permission,
     * resourceIdKey, eligibilityDenialMode }`.
     */
    requireExamEligibility: (
      permission: PermissionKey,
      resourceIdKey: string,
      eligibilityDenialMode: EligibilityDenialMode,
    ) => AuthzPreHandler;
    /**
     * Own-attempt capability gate (RBAC-M10-A archetype C/D). Capability +
     * ownership for attempt view / take / answer-save / submit / heartbeat /
     * restore. The attempt must resolve under the org anchor AND its owner
     * (`candidateProfiles.userId`) must equal the actor. Anti-enumeration:
     * cross-candidate probe -> 404 (not 403). Attaches runtime metadata
     * `{ kind: "own_attempt", permission, resourceIdKey }`.
     */
    requireOwnAttempt: (
      permission: PermissionKey,
      resourceIdKey: string,
    ) => AuthzPreHandler;
  }
}
