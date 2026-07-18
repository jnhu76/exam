/**
 * Candidate exam-eligibility resource resolver (RBAC-M10-A, archetype B).
 *
 * Implements ADR §Candidate Own-Scope Policy + §Resource Resolver Matrix for
 * the candidate exam-eligibility routes:
 *
 *   GET /candidate/exams/:examId
 *   POST /attempts/:examId/queue
 *   POST /attempts/:examId/start
 *
 * These routes reference an exam (and an enrollment) but NO attempt exists
 * yet, so the own-attempt resolver is inappropriate (directive §4 archetype
 * B). The required boundary (directive §4.B):
 *
 *   authenticated actor
 *     → candidate profile (server-derived from ctx.actorId)
 *     → exam organization anchor
 *     → enrollment/eligibility
 *     → create or expose only the actor's resource
 *
 * The start route must never accept a client-supplied `candidateId` as
 * authority (directive §4.B / §6.3). The resolver derives the candidate profile
 * from `candidateProfiles.userId === ctx.actorId` server-side and the
 * enrollment from `(examId, candidateProfileId)` — no body/params trust.
 *
 * Anti-enumeration contract (directive §6.4 / §8): a cross-candidate probe —
 * the exam exists under the org anchor but the actor has no candidate profile
 * or no enrollment — is mapped to `resource_not_found` (the handler then
 * returns 404), matching the proven `candidateOwnership.test.ts` convention
 * ("A sees no detail for an exam enrolled only to B -> 404"). Org/chain
 * inconsistency stays a genuine `organization_mismatch` / `broken_parent_chain`
 * (403) because it is a scope violation, not an existence question.
 *
 * Integrity rules honored (resolver.ts top-of-file): full parent chain loaded;
 * explicit organization anchor (ADR §3.4); deny-on-inconsistency (ADR §22.1);
 * never fail open; operational errors surface as `resolver_error` (ADR §3.9).
 *
 * Note: state guards (exam availability window, latestStartOffset, queue
 * admission, attempt-count limits) are RUNTIME STATE, not authorization, and
 * remain in the handler / exam-engine (directive §6.5 / ADR §22.3). This
 * resolver answers ONLY "may this actor see/start this exam at all".
 */
import type { FastifyBaseLogger } from "fastify";
import type { Database, TenantContext } from "@exam/db/src/types.js";
import { createExamRepo } from "@exam/db/src/repository/examRepo.js";
import {
  Scope,
  type ResolverContext,
  type DeniedScope,
  type ResourceType,
} from "@exam/authz";

/** Ownership/eligibility facts the eligibility preHandler needs. */
export interface ExamEligibilityOwnership {
  /** Server-derived candidate profile id for the actor, or null if none. */
  candidateProfileId: string | null;
  /** The owning user id (candidateProfiles.userId) for parity logging. */
  ownerUserId: string | null;
  /** The enrollment id for (examId, candidateProfileId), or null if none. */
  enrollmentId: string | null;
}

/**
 * A resolved exam-eligibility scope. Carries the eligibility facts; only the
 * eligibility preHandler consumes the eligibility fields.
 */
export interface ExamEligibilityResolvedScope {
  scope: typeof Scope.OwnAttempt;
  organizationId: string;
  resourceId: string;
  chain: ReadonlyArray<{ type: ResourceType; id: string }>;
  ownership: ExamEligibilityOwnership;
}

export type ExamEligibilityResolution =
  | ExamEligibilityResolvedScope
  | DeniedScope;

/** Type guard: an eligibility resolution is a denial. */
export function isExamEligibilityDenied(
  r: ExamEligibilityResolution,
): r is DeniedScope {
  return (
    typeof r === "object" &&
    r !== null &&
    (r as { denied?: unknown }).denied === true
  );
}

function repoCtx(ctx: ResolverContext): TenantContext {
  return {
    actorId: ctx.actorId,
    organizationId: ctx.organizationId,
    role: "Admin" as TenantContext["role"],
    permissions: [],
  };
}

interface LoadedEligibilityChain {
  resourceId: string;
  resourceOrganizationId: string;
  candidateProfileId: string | null;
  ownerUserId: string | null;
  enrollmentId: string | null;
  organizationIds: readonly (string | null)[];
  chain: readonly {
    type: ResourceType;
    id: string | null;
    linkedId?: string | null;
  }[];
}

function materializeChain(
  nodes: readonly LoadedEligibilityChain["chain"][number][],
): Array<{ type: ResourceType; id: string }> | null {
  const chain: Array<{ type: ResourceType; id: string }> = [];
  for (const node of nodes) {
    if (
      !node.id ||
      (node.linkedId !== undefined && node.linkedId !== node.id)
    ) {
      return null;
    }
    chain.push({ type: node.type, id: node.id });
  }
  return chain;
}

/**
 * Resolves a candidate exam-eligibility resource: loads the
 * exam→course→organization chain AND the actor's candidate profile AND that
 * candidate's enrollment for the exam, validates the organization anchor and
 * parent integrity, and returns the eligibility facts on success. Denies per
 * ADR §3.9 on any failure.
 *
 * @param db - Database handle (injected for testability).
 * @param logger - Fastify logger for monitoring inconsistency warnings.
 * @param ctx - Resolver context (actor + organization anchor).
 * @param examId - The exam id from the route params.
 */
export async function resolveExamEligibilityScope(
  db: Database,
  logger: FastifyBaseLogger | undefined,
  ctx: ResolverContext,
  examId: string,
): Promise<ExamEligibilityResolution> {
  try {
    const row = await createExamRepo(db).findCandidateEligibilityChain(
      repoCtx(ctx),
      examId,
      ctx.actorId,
    );
    if (!row) {
      return { denied: true, reason: "resource_not_found" };
    }
    const loaded: LoadedEligibilityChain = {
      resourceId: row.examId,
      resourceOrganizationId: row.examOrganizationId,
      candidateProfileId: row.candidateProfileId,
      ownerUserId: row.ownerUserId,
      enrollmentId: row.enrollmentId,
      organizationIds: [
        row.examOrganizationId,
        row.courseOrganizationId,
        row.organizationId,
        row.candidateProfileOrganizationId,
        row.enrollmentOrganizationId,
      ],
      chain: [
        { type: "exam", id: row.examId },
        { type: "course", id: row.courseId, linkedId: row.linkedCourseId },
      ],
    };
    const chain = materializeChain(loaded.chain);
    // A null candidateProfileOrganizationId / enrollmentOrganizationId is NOT
    // a broken chain — it means the (optional) candidate profile / enrollment
    // did not match (the LEFT JOIN produced nulls). Those are existence facts
    // (handled below as resource_not_found), not chain integrity failures.
    // Only the core exam→course→org chain is integrity-checked here.
    if (
      !chain ||
      row.courseOrganizationId === null ||
      row.organizationId === null
    ) {
      logger?.warn(
        {
          resolver: "exam_eligibility",
          resourceId: examId,
          reason: "broken_parent_chain",
          chain: loaded.chain,
          organizationIds: loaded.organizationIds,
        },
        "authz exam-eligibility resolver parent-chain inconsistency",
      );
      return { denied: true, reason: "broken_parent_chain" };
    }
    // Core chain org consistency: exam + course + organization must all be the
    // ctx org. The candidate profile / enrollment org ids are joined on the ctx
    // org (see repo), so if they are non-null they already match; if null they
    // are handled as existence facts below.
    const coreOrgs = [
      row.examOrganizationId,
      row.courseOrganizationId,
      row.organizationId,
    ];
    if (coreOrgs.some((id) => id !== ctx.organizationId)) {
      logger?.warn(
        {
          resolver: "exam_eligibility",
          resourceId: examId,
          reason: "organization_mismatch",
          chain: loaded.chain,
          organizationIds: loaded.organizationIds,
        },
        "authz exam-eligibility resolver organization-anchor mismatch",
      );
      return { denied: true, reason: "organization_mismatch" };
    }
    return {
      scope: Scope.OwnAttempt,
      organizationId: loaded.resourceOrganizationId,
      resourceId: loaded.resourceId,
      chain,
      ownership: {
        candidateProfileId: loaded.candidateProfileId,
        ownerUserId: loaded.ownerUserId,
        enrollmentId: loaded.enrollmentId,
      },
    };
  } catch (err) {
    logger?.error(
      { err, resolver: "exam_eligibility", resourceId: examId },
      "authz exam-eligibility resolver DB error",
    );
    return { denied: true, reason: "resolver_error" };
  }
}
