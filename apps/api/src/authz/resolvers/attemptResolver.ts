/**
 * Concrete DB-backed scope resolvers (RBAC runtime activation, PR #3 Step 3).
 *
 * Implements the {@link ScopeResolver} contract from `@exam/authz/resolver`:
 * load the resource, explicitly verify the org anchor (ADR §3.4), and deny on
 * any inconsistency — never fail open (ADR §3.9). Operational failures are
 * logged and surface as `resolver_error` so callers map them to 503, not a
 * silent 403.
 *
 * Hot-path budget: ≤2 DB reads (ADR §22.2). attemptRepo.findById returns a row
 * carrying organizationId + examId + candidateId, so the attempt resolver is a
 * single read; the exam resolver is a single read.
 */
import type { FastifyBaseLogger } from "fastify";
import type { Database, TenantContext } from "@exam/db/src/types.js";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { createExamRepo } from "@exam/db/src/repository/examRepo.js";
import {
  Scope,
  type ResolverContext,
  type ResourceRef,
  type ResolvedScope,
  type DeniedScope,
  type ScopeResolver,
  type ScopeType,
  type ResourceType,
} from "@exam/authz";

/**
 * Builds the minimal TenantContext a repo needs from a ResolverContext.
 *
 * `role`/`permissions` here are NOT a real authorization decision — the repo's
 * `findById` only consumes `organizationId` for tenant scoping (it does not
 * branch on role/permissions). The values are placeholders required to satisfy
 * the `TenantContext` shape; the actual authorization happens in
 * `requireCapability` + this resolver, not in the repo.
 */
function repoCtx(c: ResolverContext): TenantContext {
  return {
    actorId: c.actorId,
    organizationId: c.organizationId,
    role: "Admin" as never,
    permissions: [],
  };
}

/** A loaded tenant row carrying its parent id (for the resolution chain). */
interface LoadedRow {
  id: string;
  organizationId: string;
  parentId: string;
}

/**
 * Shared resolution skeleton for a single tenant resource (attempt/exam).
 * Loads by id (1 read), explicitly verifies the org anchor, and returns the
 * resolved scope + parent chain. Used by both factories below to avoid
 * duplication.
 */
async function resolveTenantResource(args: {
  db: Database;
  logger: FastifyBaseLogger | undefined;
  ctx: ResolverContext;
  ref: ResourceRef;
  scope: ScopeType;
  childType: ResourceType;
  parentType: ResourceType;
  load: (
    db: Database,
    ctx: TenantContext,
    id: string,
  ) => Promise<LoadedRow | null>;
}): Promise<ResolvedScope | DeniedScope> {
  try {
    const row = await args.load(args.db, repoCtx(args.ctx), args.ref.id);
    if (!row) {
      return { denied: true, reason: "resource_not_found" };
    }
    // ADR §3.4: explicit org anchor. findById already filters by org, but the
    // rule requires the check to be explicit (defensive against a repo that
    // ever broadens its filter).
    if (row.organizationId !== args.ctx.organizationId) {
      return { denied: true, reason: "organization_mismatch" };
    }
    return {
      scope: args.scope,
      organizationId: row.organizationId,
      resourceId: row.id,
      chain: [
        { type: args.childType, id: row.id },
        { type: args.parentType, id: row.parentId },
      ],
    };
  } catch (err) {
    // Never fail open; log + surface as resolver_error -> caller maps to 503.
    args.logger?.error(
      { err, resolver: args.childType, resourceId: args.ref.id },
      "authz resolver DB error",
    );
    return { denied: true, reason: "resolver_error" };
  }
}

/** Builds an attempt-scope resolver. 1 DB read (attemptRepo.findById). */
export function createAttemptResolver(
  db: Database,
  logger?: FastifyBaseLogger,
): ScopeResolver {
  return {
    key: "attempt",
    async resolve(ctx, ref): Promise<ResolvedScope | DeniedScope> {
      return resolveTenantResource({
        db,
        logger,
        ctx,
        ref,
        scope: Scope.Attempt,
        childType: "attempt",
        parentType: "exam",
        load: async (database, tenantCtx, id) => {
          const a = await createAttemptRepo(database).findById(tenantCtx, id);
          return a
            ? { id: a.id, organizationId: a.organizationId, parentId: a.examId }
            : null;
        },
      });
    },
  };
}

/** Builds an exam-scope resolver. 1 DB read (examRepo.findById). */
export function createExamResolver(
  db: Database,
  logger?: FastifyBaseLogger,
): ScopeResolver {
  return {
    key: "exam",
    async resolve(ctx, ref): Promise<ResolvedScope | DeniedScope> {
      return resolveTenantResource({
        db,
        logger,
        ctx,
        ref,
        scope: Scope.Exam,
        childType: "exam",
        parentType: "course",
        load: async (database, tenantCtx, id) => {
          const e = await createExamRepo(database).findById(tenantCtx, id);
          return e
            ? {
                id: e.id,
                organizationId: e.organizationId,
                parentId: e.courseId,
              }
            : null;
        },
      });
    },
  };
}
