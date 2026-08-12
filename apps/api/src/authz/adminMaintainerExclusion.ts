import type {
  Database,
  TenantContext,
  TransactionDatabase,
} from "@exam/db/src/types.js";
import type { RequestContext } from "@exam/domain";
import { acquireOrganizationAdvisoryLock } from "@exam/db/src/lock.js";
import { createUserRoleAssignmentRepo } from "@exam/db/src/repository/userRoleAssignmentRepo.js";
import { executeInTransaction } from "@exam/db/src/types.js";
import { ValidationError } from "@exam/domain";

/**
 * P7-E2A (ADR-017 D14) — ADMIN / MAINTAINER MUTUAL EXCLUSION.
 *
 * `mutateWithAuthorityInvariants` is the canonical mutation seam for every
 * path that can create, activate, promote, or replace a role assignment
 * (user creation, assignment create, assignment activate, promote to
 * primary, replace primary role, seed/backfill). It runs the mutation inside
 * one transaction under the organization advisory lock and enforces the
 * invariant as a post-condition:
 *
 *   no human actor may hold active Admin AND active Maintainer assignments
 *   at the same time (Admin ∩ Maintainer = ∅).
 *
 * The advisory lock serializes concurrent authority mutations for the same
 * organization, so two transactions cannot each insert one of the two roles
 * for the same actor (write-skew): at most one side commits.
 *
 * Lock-family note: the fence is only sound if EVERY authority mutation
 * serializes on the SAME lock kind. `mutateWithEffectiveAdminPostcondition`
 * (adminInvariant.ts) shares this lock kind by design.
 *
 * @param db - Database instance.
 * @param ctx - Tenant or request context carrying the organization anchor.
 * @param mutate - Callback performing all authority mutations against the
 *   supplied transaction handle. It must not open its own transaction.
 * @returns The value returned by `mutate`.
 * @throws ValidationError with `reason: "ADMIN_MAINTAINER_EXCLUSION"` if the
 *   mutation would leave the organization with an actor holding both active
 *   Admin and active Maintainer assignments.
 */
export async function mutateWithAuthorityInvariants<T>(
  db: Database,
  ctx: TenantContext | RequestContext,
  mutate: (tx: TransactionDatabase) => Promise<T>,
): Promise<T> {
  return executeInTransaction(
    db,
    async (tx) => {
      await acquireOrganizationAdvisoryLock(
        tx,
        ctx.organizationId,
        "authority-invariants",
      );

      const result = await mutate(tx);

      const violations =
        await createUserRoleAssignmentRepo(
          tx,
        ).findAdminMaintainerExclusionViolations(ctx);
      if (violations.length > 0) {
        const v = violations[0]!;
        throw new ValidationError("同一账号不能同时拥有管理员与维护者身份", {
          reason: "ADMIN_MAINTAINER_EXCLUSION",
          userId: v.userId,
          adminAssignmentId: v.adminAssignmentId,
          maintainerAssignmentId: v.maintainerAssignmentId,
        });
      }

      return result;
    },
    // "read committed" is LOAD-BEARING here: the post-condition must see the
    // latest committed rows after the advisory lock is granted. Under
    // REPEATABLE READ the transaction snapshot is taken at its first
    // statement (before the lock wait), so the post-condition would miss a
    // concurrently committed assignment and both transactions could commit —
    // the exact write-skew D14 forbids.
    "read committed",
  );
}
