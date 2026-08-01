import type { FastifyBaseLogger } from "fastify";
import type { Database, TenantContext } from "@exam/db/src/types.js";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { createExamRepo } from "@exam/db/src/repository/examRepo.js";
import {
  Scope,
  type ResolverContext,
  type ResolvedScope,
  type DeniedScope,
  type ScopeResolver,
  type ResourceResolverKey,
  type ResourceType,
  type ScopeType,
} from "@exam/authz";

interface ChainNode {
  type: ResourceType;
  id: string | null;
  linkedId?: string | null;
}

interface LoadedAuthorizationChain {
  resourceId: string;
  resourceOrganizationId: string;
  organizationIds: readonly (string | null)[];
  chain: readonly ChainNode[];
}

function repoCtx(ctx: ResolverContext): TenantContext {
  return {
    actorId: ctx.actorId,
    organizationId: ctx.organizationId,
    role: "Admin" as TenantContext["role"],
    permissions: [],
  };
}

function materializeChain(
  nodes: readonly ChainNode[],
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

function denyInconsistentChain(
  logger: FastifyBaseLogger | undefined,
  resolver: ResourceResolverKey,
  resourceId: string,
  reason: "organization_mismatch" | "broken_parent_chain",
  loaded: LoadedAuthorizationChain,
): DeniedScope {
  logger?.warn(
    {
      resolver,
      resourceId,
      reason,
      chain: loaded.chain,
      organizationIds: loaded.organizationIds,
    },
    "authz resolver parent-chain inconsistency",
  );
  return { denied: true, reason };
}

export async function resolveAuthorizationChain(args: {
  logger: FastifyBaseLogger | undefined;
  ctx: ResolverContext;
  resourceId: string;
  resolver: ResourceResolverKey;
  scope: ScopeType;
  load: () => Promise<LoadedAuthorizationChain | null>;
}): Promise<ResolvedScope | DeniedScope> {
  try {
    const loaded = await args.load();
    if (!loaded) {
      return { denied: true, reason: "resource_not_found" };
    }
    const chain = materializeChain(loaded.chain);
    if (!chain || loaded.organizationIds.some((id) => id === null)) {
      return denyInconsistentChain(
        args.logger,
        args.resolver,
        args.resourceId,
        "broken_parent_chain",
        loaded,
      );
    }
    if (loaded.organizationIds.some((id) => id !== args.ctx.organizationId)) {
      return denyInconsistentChain(
        args.logger,
        args.resolver,
        args.resourceId,
        "organization_mismatch",
        loaded,
      );
    }
    return {
      scope: args.scope,
      organizationId: loaded.resourceOrganizationId,
      resourceId: loaded.resourceId,
      chain,
    };
  } catch (err) {
    args.logger?.error(
      { err, resolver: args.resolver, resourceId: args.resourceId },
      "authz resolver DB error",
    );
    return { denied: true, reason: "resolver_error" };
  }
}

export function createAttemptResolver(
  db: Database,
  logger?: FastifyBaseLogger,
): ScopeResolver {
  return {
    key: "attempt",
    async resolve(ctx, ref): Promise<ResolvedScope | DeniedScope> {
      return resolveAuthorizationChain({
        logger,
        ctx,
        resourceId: ref.id,
        resolver: "attempt",
        scope: Scope.Attempt,
        load: async () => {
          const row = await createAttemptRepo(db).findAuthorizationChain(
            repoCtx(ctx),
            ref.id,
          );
          return row
            ? {
                resourceId: row.attemptId,
                resourceOrganizationId: row.attemptOrganizationId,
                organizationIds: [
                  row.attemptOrganizationId,
                  row.examOrganizationId,
                  row.courseOrganizationId,
                  row.organizationId,
                ],
                chain: [
                  { type: "attempt", id: row.attemptId },
                  { type: "exam", id: row.examId, linkedId: row.linkedExamId },
                  {
                    type: "course",
                    id: row.courseId,
                    linkedId: row.linkedCourseId,
                  },
                ],
              }
            : null;
        },
      });
    },
  };
}

export function createExamResolver(
  db: Database,
  logger?: FastifyBaseLogger,
): ScopeResolver {
  return {
    key: "exam",
    async resolve(ctx, ref): Promise<ResolvedScope | DeniedScope> {
      return resolveAuthorizationChain({
        logger,
        ctx,
        resourceId: ref.id,
        resolver: "exam",
        scope: Scope.Exam,
        load: async () => {
          const row = await createExamRepo(db).findAuthorizationChain(
            repoCtx(ctx),
            ref.id,
          );
          return row
            ? {
                resourceId: row.examId,
                resourceOrganizationId: row.examOrganizationId,
                organizationIds: [
                  row.examOrganizationId,
                  row.courseOrganizationId,
                  row.organizationId,
                ],
                chain: [
                  { type: "exam", id: row.examId },
                  {
                    type: "course",
                    id: row.courseId,
                    linkedId: row.linkedCourseId,
                  },
                ],
              }
            : null;
        },
      });
    },
  };
}
