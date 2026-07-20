/**
 * Candidate-context capability preHandler (RBAC-M10-A, archetype A).
 *
 * Authorization for the candidate-context list route:
 *
 *   GET /candidate/exams     (ExamTake)
 *
 * This route supplies no existing attempt resource and no specific exam — it
 * is a candidate-context list (directive §4 archetype A). The required
 * boundary (directive §4.A):
 *
 *   authenticated actor
 *     → organization
 *     → server-resolved candidate profile
 *     → query constrained to that profile/context
 *
 * The authorization decision is the route permission (ExamTake, held only by
 * the Candidate preset) plus the organization anchor implicit in the
 * authenticated ctx. There is **no resource resolver** — the query is scoped to
 * the candidate profile in the handler (`enrollmentRepo.findByCandidate`),
 * which is retained as defense-in-depth (directive §6.6). A generic attempt
 * resolver is not appropriate because no attempt exists (directive §4.A).
 *
 * This preserves the existing public contract: a Candidate with no candidate
 * profile row (or no enrollments) still receives 200 + empty list — the legacy
 * `requireRole(["Candidate"])` did not reject this case either, and the
 * handler returns `[]`. The capability check (Candidate preset holds ExamTake)
 * is the strict capability analogue of the legacy role check.
 *
 * **RBAC ≠ state machine** (directive §6.5): nothing stateful applies to a
 * pure list route.
 */
import type { FastifyReply, FastifyRequest } from "fastify";
import { buildErrorResponse } from "../lib/errorResponse.js";
import { type PermissionKey } from "@exam/authz";

/**
 * Capability predicate over the request (RBAC-M10-E). Reads the authoritative
 * `ctx.capabilities` union. Signature matches the scoped / score / own-attempt
 * / exam-eligibility gates.
 */
export type CandidateContextAllows = (
  request: FastifyRequest,
  permission: PermissionKey,
) => boolean;

/**
 * Builds the candidate-context capability preHandler. Pure: the capability
 * predicate is injected, matching {@link requireCapability}'s contract. The
 * decorator attaches runtime metadata `{ kind: "candidate_context", permission }`
 * so conformance tests can distinguish this archetype from generic `scoped`.
 */
export function buildCandidateContextCapabilityPreHandler(
  allows: CandidateContextAllows,
): (
  permission: PermissionKey,
) => (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return (permission) => async (request, reply) => {
    const ctx = request.ctx;
    if (!ctx) {
      return reply
        .code(401)
        .send(buildErrorResponse(request.id, "AUTH_REQUIRED"));
    }
    if (!allows(request, permission)) {
      return reply
        .code(403)
        .send(buildErrorResponse(request.id, "PERMISSION_DENIED"));
    }
    // Capability granted. The handler scopes the list to the candidate
    // profile (defense-in-depth); no DB resolver is needed here.
  };
}
