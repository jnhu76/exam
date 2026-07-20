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
 *      {@link resolveExamEligibilityScope}.
 *   2. The principal's role preset grants the route permission (ExamTake /
 *      AttemptStart).
 *   3. The actor resolves to a candidate profile under the org anchor AND
 *      the candidate profile's ownerUserId equals the actorId AND the
 *      candidate holds an enrollment for the exam.
 *   4. Otherwise deny — route-specific denial policy declared via
 *      `eligibilityDenialMode`: `resource_not_found` → 404 (anti-enumeration),
 *      `permission_denied` → 403.
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
import type { FastifyBaseLogger, FastifyReply, FastifyRequest } from "fastify";
import type { Database } from "@exam/db/src/types.js";
import { buildErrorResponse } from "../lib/errorResponse.js";
import { type PermissionKey, type ResolverContext } from "@exam/authz";
import type { EligibilityDenialMode } from "../types/fastify-auth.d.js";
import {
  resolveExamEligibilityScope,
  isExamEligibilityDenied,
  type ExamEligibilityResolution,
} from "./resolvers/examEligibilityResolver.js";

/**
 * Capability predicate over the request (RBAC-M10-E). Reads the authoritative
 * `ctx.capabilities` union. Signature matches the other gates.
 */
export type ExamEligibilityAllows = (
  request: FastifyRequest,
  permission: PermissionKey,
) => boolean;

/** Input to the eligibility capability preHandler builder (pure, injectable). */
export interface ExamEligibilityCapabilityInput {
  /** Database handle (injected; built by the authz plugin from fastify.db). */
  db: Database;
  /** Fastify logger (injected; for resolver monitoring events). */
  logger?: FastifyBaseLogger;
  /**
   * Capability predicate (injected; reads ctx.capabilities). Same authority
   * source as {@link requireCapability} — not a role-name branch.
   */
  allows: ExamEligibilityAllows;
}

/**
 * Send a route-specific eligibility denial response.
 *
 * Missing profile, owner mismatch, or missing enrollment map to the
 * route-declared denial policy:
 *   - `resource_not_found` → 404 (anti-enumeration)
 *   - `permission_denied` → 403
 */
function sendEligibilityDenied(
  request: FastifyRequest,
  reply: FastifyReply,
  mode: EligibilityDenialMode,
) {
  if (mode === "resource_not_found") {
    return reply
      .code(404)
      .send(buildErrorResponse(request.id, "RESOURCE_NOT_FOUND"));
  }
  return reply
    .code(403)
    .send(buildErrorResponse(request.id, "PERMISSION_DENIED"));
}

/**
 * Builds a per-route eligibility capability preHandler. The route-specific
 * permission and denial policy are captured at decoration time; the exam id
 * is sourced from request.params at request time. Pure: the DB + preset
 * dependencies are injected, so the ADR §3.9 denial mapping and the
 * eligibility arbitration are unit-testable without DB fixtures.
 */
export function buildExamEligibilityCapabilityPreHandler(
  input: ExamEligibilityCapabilityInput,
): (
  permission: PermissionKey,
  resourceIdKey: string,
  eligibilityDenialMode: EligibilityDenialMode,
) => (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  const { db, logger, allows } = input;
  return (permission, resourceIdKey, denialMode) => async (request, reply) => {
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

    // Resolved under the org anchor. The capability check reads the
    // authoritative ctx.capabilities union (RBAC-M10-E).
    if (!allows(request, permission)) {
      return reply
        .code(403)
        .send(buildErrorResponse(request.id, "PERMISSION_DENIED"));
    }

    // Eligibility enforcement: server-derived candidate profile must exist,
    // the actor must own the profile, and an enrollment must exist.
    // These are the authoritative eligibility boundary (ARCH-A closure).
    const { candidateProfileId, ownerUserId, enrollmentId } =
      resolution.ownership;

    if (candidateProfileId === null) {
      return sendEligibilityDenied(request, reply, denialMode);
    }

    if (ownerUserId !== ctx.actorId) {
      return sendEligibilityDenied(request, reply, denialMode);
    }

    if (enrollmentId === null) {
      return sendEligibilityDenied(request, reply, denialMode);
    }

    // Capability granted + exam resolved under the org anchor + candidate
    // profile + enrollment verified. The handler applies its own exam
    // availability / state / queue admission / attempt-count guards.
  };
}
