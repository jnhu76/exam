import type { Database, TenantContext } from "@exam/db/src/types.js";
import type { RequestContext } from "@exam/domain";
import { acquireOrganizationAdvisoryLock } from "@exam/db/src/lock.js";
import { createUserRepo } from "@exam/db/src/repository/userRepo.js";
import { executeInTransaction } from "@exam/db/src/types.js";
import { ValidationError } from "@exam/domain";

/**
 * Runs an authority-mutating callback inside a transaction that holds an
 * organization-scoped advisory lock and enforces the effective-Admin
 * post-condition: after the mutation, the organization must still have at
 * least one active user with an active Admin assignment.
 *
 * This is the unified safety seam for every path that can remove effective
 * Admin authority:
 *   - disabling or deleting a user
 *   - deactivating or deleting an Admin role assignment
 *   - replacing a user's primary role away from Admin
 *
 * The lock prevents concurrent transactions from simultaneously observing
 * count > 1 and each removing a different Admin, which would leave the
 * organization with zero effective Admins (write-skew). The post-condition
 * check guarantees that even if a caller's intent is mis-modeled, the
 * invariant cannot be violated.
 *
 * @param db - Database instance.
 * @param ctx - Tenant or request context carrying the organization anchor.
 * @param mutate - Callback that performs all authority mutations against the
 *   supplied transaction handle. It must not open its own transaction.
 * @returns The value returned by `mutate`.
 * @throws ValidationError with `reason: "LAST_ACTIVE_ADMIN"` if the mutation
 *   would leave the organization with no effective Admin.
 */
export async function mutateWithEffectiveAdminPostcondition<T>(
  db: Database,
  ctx: TenantContext | RequestContext,
  mutate: (tx: Database) => Promise<T>,
): Promise<T> {
  return executeInTransaction(
    db,
    async (tx) => {
      await acquireOrganizationAdvisoryLock(
        tx,
        ctx.organizationId,
        "effective-admin-invariant",
      );

      const result = await mutate(tx);

      const effectiveAdminCount = await createUserRepo(
        tx,
      ).countEffectiveActiveUsersWithRole(ctx, "Admin");

      if (effectiveAdminCount === 0) {
        throw new ValidationError("不能停用或降级最后一位活跃管理员", {
          reason: "LAST_ACTIVE_ADMIN",
        });
      }

      return result;
    },
    "read committed",
  );
}
