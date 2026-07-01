/**
 * Concrete DB-backed scope resolvers (RBAC runtime activation, PR #3 Step 3).
 *
 * Implements the {@link ScopeResolver} contract from `@exam/authz/resolver`:
 * load the resource, explicitly verify the org anchor (ADR §3.4), and deny on
 * any inconsistency — never fail open (ADR §3.9). Operational failures surface
 * as `resolver_error` so callers map them to 503, not a silent 403.
 *
 * Hot-path budget: ≤2 DB reads (ADR §22.2). attemptRepo.findById returns a row
 * carrying organizationId + examId + candidateId, so the attempt resolver is a
 * single read; the exam resolver is a single read.
 */
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
} from "@exam/authz";

/** Builds the minimal TenantContext a repo needs from a ResolverContext. */
function repoCtx(c: ResolverContext): TenantContext {
  return {
    actorId: c.actorId,
    organizationId: c.organizationId,
    role: "Admin" as never,
    permissions: [],
  };
}

/** Builds an attempt-scope resolver. 1 DB read (attemptRepo.findById). */
export function createAttemptResolver(db: Database): ScopeResolver {
  return {
    key: "attempt",
    async resolve(
      ctx: ResolverContext,
      ref: ResourceRef,
    ): Promise<ResolvedScope | DeniedScope> {
      try {
        const attempt = await createAttemptRepo(db).findById(
          repoCtx(ctx),
          ref.id,
        );
        if (!attempt) {
          return { denied: true, reason: "resource_not_found" };
        }
        // ADR §3.4: explicit org anchor. findById already filters by org, but
        // the rule requires the check to be explicit (defensive against a repo
        // that ever broadens its filter).
        if (attempt.organizationId !== ctx.organizationId) {
          return { denied: true, reason: "organization_mismatch" };
        }
        return {
          scope: Scope.Attempt,
          organizationId: attempt.organizationId,
          resourceId: attempt.id,
          chain: [
            { type: "attempt", id: attempt.id },
            { type: "exam", id: attempt.examId },
          ],
        };
      } catch {
        // Never fail open; surface as resolver_error -> caller maps to 503.
        return { denied: true, reason: "resolver_error" };
      }
    },
  };
}

/** Builds an exam-scope resolver. 1 DB read (examRepo.findById). */
export function createExamResolver(db: Database): ScopeResolver {
  return {
    key: "exam",
    async resolve(
      ctx: ResolverContext,
      ref: ResourceRef,
    ): Promise<ResolvedScope | DeniedScope> {
      try {
        const exam = await createExamRepo(db).findById(repoCtx(ctx), ref.id);
        if (!exam) {
          return { denied: true, reason: "resource_not_found" };
        }
        if (exam.organizationId !== ctx.organizationId) {
          return { denied: true, reason: "organization_mismatch" };
        }
        return {
          scope: Scope.Exam,
          organizationId: exam.organizationId,
          resourceId: exam.id,
          chain: [
            { type: "exam", id: exam.id },
            { type: "course", id: exam.courseId },
          ],
        };
      } catch {
        return { denied: true, reason: "resolver_error" };
      }
    },
  };
}
