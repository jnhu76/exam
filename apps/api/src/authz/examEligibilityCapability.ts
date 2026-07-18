/**
 * Candidate exam-eligibility capability preHandler (RBAC-M10-A, archetype B).
 *
 * Resource-aware authorization for the candidate exam-eligibility routes:
 *
 *   GET /candidate/exams/:examId         (ExamTake)
 *   POST /attempts/:examId/queue         (AttemptStart)
 *   POST /attempts/:examId/start         (AttemptStart)
 *
 * These routes reference an exam (and an enrollment) but NO attempt exists
 * yet (directive §4 archetype B). The authorization decision is **capability +
 * eligibility**, never role-name (directive §6.1). A principal is authorized
 * iff, in order:
 *
 *   1. The exam resolves under the actor's organization anchor (ADR §3.4) via
 *      {@link resolveExamEligibilityScope}. Denials map per ADR §3.9.
 *   2. The principal's role preset grants the route permission (ExamTake /
 *      AttemptStart) AND the actor resolves to a candidate profile under the
 *      org anchor AND that profile holds an enrollment for the exam.
 *   3. Otherwise deny — anti-enumeration: a candidate with no profile or no
 *      enrollment for this exam returns 404, not 403, matching the proven
 *      `candidateOwnership.test.ts` convention ("A sees no detail for an exam
 *      enrolled only to B -> 404").
 *
 * The start route never trusts a client-supplied `candidateId` (directive
 * §6.3): the candidate profile is server-derived from `ctx.actorId` inside the
 * resolver.
 *
 * **RBAC ≠ state machine** (directive §6.5 / ADR §22.3): exam availability
 * window, latestStartOffset, queue admission, and attempt-count limits are
 * RUNTIME STATE and remain in the handler / exam-engine. This preHandler
 * answers ONLY "may this actor see/start this exam at all".
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
  resolveExamEligibilityScope,
  isExamEligibilityDenied,
  type ExamEligibilityResolution,
} from "./resolvers/examEligibilityResolver.js";

/** Input to the eligibility capability preHandler builder (pure, injectable). */
export interface ExamEligibilityCapabilityInput {
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
 * Builds a per-route eligibility capability preHandler. The route-specific
 * permission is captured at decoration time; the exam id is sourced from
 * request.params at request time. Pure: the DB + preset dependencies are
 * injected, so the ADR §3.9 denial mapping and the eligibility arbitration are
 * unit-testable without DB fixtures.
 */
export function buildExamEligibilityCapabilityPreHandler(
  input: ExamEligibilityCapabilityInput,
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
    const examId = params[resourceIdKey];
    if (!examId) {
      request.log.error(
        { route: request.url, resourceIdKey, permission },
        "authz exam-eligibility capability resource id missing on params",
      );
      return reply
        .code(503)
        .send(buildErrorResponse(request.id, "AUTHZ_UNAVAILABLE"));
    }

    const resolverCtx: ResolverContext = {
      actorId: ctx.actorId,
      organizationId: ctx.organizationId,
    };
    const resolution: ExamEligibilityResolution =
      await resolveExamEligibilityScope(db, logger, resolverCtx, examId);

    if (isExamEligibilityDenied(resolution)) {
      // ADR §3.9 deny mapping.
      switch (resolution.reason) {
        case "resource_not_found":
          // Anti-enumeration: a missing exam (or an exam the actor has no
          // profile/enrollment for) is the handler's canonical 404.
          return reply
            .code(404)
            .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
        case "organization_mismatch":
        case "broken_parent_chain":
          return reply
            .code(403)
            .send(buildErrorResponse(request.id, "PERMISSION_DENIED"));
        case "resolver_error":
          return reply
            .code(503)
            .send(buildErrorResponse(request.id, "AUTHZ_UNAVAILABLE"));
        default:
          return reply
            .code(503)
            .send(buildErrorResponse(request.id, "AUTHZ_UNAVAILABLE"));
      }
    }

    // Resolved under the org anchor. Capability + eligibility arbitration:
    // role preset must grant the route permission AND the actor must have a
    // candidate profile AND an enrollment for this exam. No ctx.role branch.
    const role = ctx.role as RoleKey;
    if (!allows(role, permission)) {
      return reply
        .code(403)
        .send(buildErrorResponse(request.id, "PERMISSION_DENIED"));
    }
    const hasProfile = resolution.ownership.candidateProfileId !== null;
    const hasEnrollment = resolution.ownership.enrollmentId !== null;
    if (hasProfile && hasEnrollment) {
      return;
    }
    // Eligible role but no candidate profile / no enrollment. Anti-enumeration:
    // 404 (not 403) so a candidate probing an exam they're not enrolled in
    // cannot distinguish "exists but not enrolled" from "does not exist".
    return reply
      .code(404)
      .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
  };
}
