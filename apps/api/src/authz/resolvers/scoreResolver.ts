/**
 * Score resource resolver (RBAC-SCOPED-AUTHORIZATION-CORRECTIVE-1).
 *
 * Implements ADR §Resource Resolver Matrix row `score`:
 *
 *   score -> attempt -> candidate + exam | resolveScoreScope |
 *           score.own.view / score.all.view | source of truth: attempt ownership
 *
 * Unlike the attempt/exam resolvers (which answer only "does this resource
 * resolve under the actor's org anchor?"), the score resolver must also surface
 * the **ownership fact** — `candidateProfiles.userId` — because the score
 * capability preHandler arbitrates `score.all.view` (any same-org attempt) vs
 * `score.own.view` (attempt whose owner is the actor) without role-name
 * branching (ADR §scope table L444; directive §1).
 *
 * The closed `ResolvedScope` type does not carry ownership, so this resolver
 * returns a {@link ScoreResolvedScope} — a superset of `ResolvedScope` with an
 * `ownership` block. The score preHandler is the sole consumer; the generic
 * `requireScopedCapability` decorator is not used for the score route.
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

/** Ownership facts the score preHandler needs to arbitrate own vs all. */
export interface ScoreOwnership {
  /** The attempt's candidate profile id (FK on exam_attempts.candidateId). */
  candidateId: string | null;
  /**
   * The user id that owns the candidate profile (`candidateProfiles.userId`).
   * This is the identity compared against `ctx.actorId` for `score.own.view`.
   * Null when the candidate profile or its user link is missing.
   */
  ownerUserId: string | null;
}

/**
 * A resolved score scope. Superset of `ResolvedScope` carrying the ownership
 * block; only the score preHandler consumes the ownership fields.
 */
export interface ScoreResolvedScope {
  scope: typeof Scope.OwnScore;
  organizationId: string;
  resourceId: string;
  chain: ReadonlyArray<{ type: ResourceType; id: string }>;
  ownership: ScoreOwnership;
}

export type ScoreResolution = ScoreResolvedScope | DeniedScope;

/** Type guard: a score resolution is a denial. */
export function isScoreDenied(r: ScoreResolution): r is DeniedScope {
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

interface LoadedScoreChain {
  resourceId: string;
  resourceOrganizationId: string;
  candidateId: string | null;
  ownerUserId: string | null;
  organizationIds: readonly (string | null)[];
  chain: readonly {
    type: ResourceType;
    id: string | null;
    linkedId?: string | null;
  }[];
}

function materializeChain(
  nodes: readonly LoadedScoreChain["chain"][number][],
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
 * Resolves a score resource: loads the attempt→candidate+exam→course→org chain
 * from PostgreSQL, validates the organization anchor and parent integrity, and
 * returns the ownership facts on success. Denies per ADR §3.9 on any failure.
 *
 * @param db - Database handle (injected for testability).
 * @param logger - Fastify logger for monitoring inconsistency warnings.
 * @param ctx - Resolver context (actor + organization anchor).
 * @param attemptId - The attempt id from the route params.
 */
export async function resolveScoreScope(
  db: Database,
  logger: FastifyBaseLogger | undefined,
  ctx: ResolverContext,
  attemptId: string,
): Promise<ScoreResolution> {
  try {
    const row = await createAttemptRepo(db).findScoreOwnershipChain(
      repoCtx(ctx),
      attemptId,
    );
    if (!row) {
      return { denied: true, reason: "resource_not_found" };
    }
    const loaded: LoadedScoreChain = {
      resourceId: row.attemptId,
      resourceOrganizationId: row.attemptOrganizationId,
      candidateId: row.candidateId,
      ownerUserId: row.ownerUserId,
      organizationIds: [
        row.attemptOrganizationId,
        row.examOrganizationId,
        row.courseOrganizationId,
        row.organizationId,
      ],
      chain: [
        { type: "attempt", id: row.attemptId },
        { type: "exam", id: row.examId, linkedId: row.linkedExamId },
        { type: "course", id: row.courseId, linkedId: row.linkedCourseId },
      ],
    };
    const chain = materializeChain(loaded.chain);
    if (!chain || loaded.organizationIds.some((id) => id === null)) {
      logger?.warn(
        {
          resolver: "score",
          resourceId: attemptId,
          reason: "broken_parent_chain",
          chain: loaded.chain,
          organizationIds: loaded.organizationIds,
        },
        "authz score resolver parent-chain inconsistency",
      );
      return { denied: true, reason: "broken_parent_chain" };
    }
    if (loaded.organizationIds.some((id) => id !== ctx.organizationId)) {
      logger?.warn(
        {
          resolver: "score",
          resourceId: attemptId,
          reason: "organization_mismatch",
          chain: loaded.chain,
          organizationIds: loaded.organizationIds,
        },
        "authz score resolver organization-anchor mismatch",
      );
      return { denied: true, reason: "organization_mismatch" };
    }
    return {
      scope: Scope.OwnScore,
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
      { err, resolver: "score", resourceId: attemptId },
      "authz score resolver DB error",
    );
    return { denied: true, reason: "resolver_error" };
  }
}
