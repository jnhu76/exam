/**
 * Own-attempt resource resolver (RBAC-M10-A, archetype C/D).
 *
 * Implements ADR §Resource Resolver Matrix row `own_attempt`:
 *
 *   own_attempt -> attempt -> candidate + exam | resolveOwnAttemptScope |
 *                  attempt.view_own / attempt.start / attempt.answer.save /
 *                  attempt.submit / attempt.heartbeat.send / attempt.restore
 *                  | source of truth: attempt ownership
 *
 * **Responsibility:** validates the resource chain (attempt→exam→course→org),
 * verifies the organization anchor, and returns **ownership facts**
 * (`candidateProfiles.userId`). The resolver does NOT map non-owner to HTTP 404;
 * it returns the ownership facts for the own-attempt capability preHandler.
 *
 * The own-attempt capability preHandler (ownAttemptCapability.ts) compares
 * `ownerUserId === ctx.actorId` and maps non-owner to HTTP 404 (anti-enumeration).
 *
 * Integrity rules honored (resolver.ts top-of-file): full parent chain loaded;
 * explicit organization anchor (ADR §3.4); deny-on-inconsistency (ADR §22.1);
 * never fail open; operational errors surface as `resolver_error` (ADR §3.9).
 */
import type { FastifyBaseLogger } from "fastify";
import type { Database, TenantContext } from "@exam/db/src/types.js";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import {
  Scope,
  type ResolverContext,
  type DeniedScope,
  type ResourceType,
} from "@exam/authz";

/** Ownership facts the own-attempt preHandler needs to arbitrate ownership. */
export interface OwnAttemptOwnership {
  /** The attempt's candidate profile id (FK on exam_attempts.candidateId). */
  candidateId: string | null;
  /**
   * The user id that owns the candidate profile (`candidateProfiles.userId`).
   * This is the identity compared against `ctx.actorId`. Null when the
   * candidate profile or its user link is missing.
   */
  ownerUserId: string | null;
}

/**
 * A resolved own-attempt scope. Superset of `ResolvedScope` carrying the
 * ownership block; only the own-attempt preHandler consumes the ownership
 * fields.
 */
export interface OwnAttemptResolvedScope {
  scope: typeof Scope.OwnAttempt;
  organizationId: string;
  resourceId: string;
  chain: ReadonlyArray<{ type: ResourceType; id: string }>;
  ownership: OwnAttemptOwnership;
}

export type OwnAttemptResolution = OwnAttemptResolvedScope | DeniedScope;

/** Type guard: an own-attempt resolution is a denial. */
export function isOwnAttemptDenied(r: OwnAttemptResolution): r is DeniedScope {
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

interface LoadedOwnAttemptChain {
  resourceId: string;
  resourceOrganizationId: string;
  candidateId: string | null;
  ownerUserId: string | null;
  candidateProfileOrganizationId: string | null;
  organizationIds: readonly (string | null)[];
  chain: readonly {
    type: ResourceType;
    id: string | null;
    linkedId?: string | null;
  }[];
}

function materializeChain(
  nodes: readonly LoadedOwnAttemptChain["chain"][number][],
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
 * Resolves an own-attempt resource: loads the attempt→candidate+exam→course→org
 * chain from PostgreSQL, validates the organization anchor and parent
 * integrity, and returns the ownership facts on success. Denies per ADR §3.9 on
 * any failure.
 *
 * @param db - Database handle (injected for testability).
 * @param logger - Fastify logger for monitoring inconsistency warnings.
 * @param ctx - Resolver context (actor + organization anchor).
 * @param attemptId - The attempt id from the route params.
 */
export async function resolveOwnAttemptScope(
  db: Database,
  logger: FastifyBaseLogger | undefined,
  ctx: ResolverContext,
  attemptId: string,
): Promise<OwnAttemptResolution> {
  try {
    const row = await createAttemptRepo(db).findOwnAttemptChain(
      repoCtx(ctx),
      attemptId,
    );
    if (!row) {
      return { denied: true, reason: "resource_not_found" };
    }
    const loaded: LoadedOwnAttemptChain = {
      resourceId: row.attemptId,
      resourceOrganizationId: row.attemptOrganizationId,
      candidateId: row.candidateId,
      ownerUserId: row.ownerUserId,
      candidateProfileOrganizationId: row.candidateProfileOrganizationId,
      organizationIds: [
        row.attemptOrganizationId,
        row.examOrganizationId,
        row.courseOrganizationId,
        row.organizationId,
        row.candidateProfileOrganizationId,
      ],
      chain: [
        { type: "attempt", id: row.attemptId },
        { type: "exam", id: row.examId, linkedId: row.linkedExamId },
        { type: "course", id: row.courseId, linkedId: row.linkedCourseId },
      ],
    };
    const chain = materializeChain(loaded.chain);
    // Core chain: attempt, exam, course, organization must all be present and
    // consistent. The candidate profile is LEFT JOINed (optional), so its org
    // can be null — that's an existence fact, not a chain integrity failure.
    const coreOrgIds = [
      loaded.organizationIds[0], // attempt
      loaded.organizationIds[1], // exam
      loaded.organizationIds[2], // course
      loaded.organizationIds[3], // organization
    ];
    if (!chain || coreOrgIds.some((id) => id === null)) {
      logger?.warn(
        {
          resolver: "own_attempt",
          resourceId: attemptId,
          reason: "broken_parent_chain",
          chain: loaded.chain,
          organizationIds: loaded.organizationIds,
        },
        "authz own-attempt resolver parent-chain inconsistency",
      );
      return { denied: true, reason: "broken_parent_chain" };
    }
    if (coreOrgIds.some((id) => id !== ctx.organizationId)) {
      logger?.warn(
        {
          resolver: "own_attempt",
          resourceId: attemptId,
          reason: "organization_mismatch",
          chain: loaded.chain,
          organizationIds: loaded.organizationIds,
        },
        "authz own-attempt resolver organization-anchor mismatch",
      );
      return { denied: true, reason: "organization_mismatch" };
    }
    // Candidate profile organization integrity: if the profile exists (non-null
    // id), its org must match the core org anchor. A null profile org is handled
    // as an existence fact by the capability preHandler, not a chain failure.
    // Only check if the field is actually present in the loaded data.
    if (
      loaded.candidateProfileOrganizationId !== undefined &&
      loaded.candidateProfileOrganizationId !== null &&
      loaded.candidateProfileOrganizationId !== ctx.organizationId
    ) {
      logger?.warn(
        {
          resolver: "own_attempt",
          resourceId: attemptId,
          reason: "organization_mismatch",
          candidateProfileOrganizationId: loaded.candidateProfileOrganizationId,
        },
        "authz own-attempt resolver candidate profile organization mismatch",
      );
      return { denied: true, reason: "organization_mismatch" };
    }
    return {
      scope: Scope.OwnAttempt,
      organizationId: loaded.resourceOrganizationId,
      resourceId: loaded.resourceId,
      chain,
      ownership: {
        candidateId: loaded.candidateId,
        ownerUserId: loaded.ownerUserId,
      },
    };
  } catch (err) {
    logger?.error(
      { err, resolver: "own_attempt", resourceId: attemptId },
      "authz own-attempt resolver DB error",
    );
    return { denied: true, reason: "resolver_error" };
  }
}
