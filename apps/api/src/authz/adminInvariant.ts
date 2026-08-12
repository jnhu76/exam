import type {
  Database,
  TenantContext,
  TransactionDatabase,
} from "@exam/db/src/types.js";
import type { RequestContext } from "@exam/domain";
import { acquireOrganizationAdvisoryLock } from "@exam/db/src/lock.js";
import { createUserRepo } from "@exam/db/src/repository/userRepo.js";
import { createUserRoleAssignmentRepo } from "@exam/db/src/repository/userRoleAssignmentRepo.js";
import { executeInTransaction } from "@exam/db/src/types.js";
import { ValidationError } from "@exam/domain";

/**
 * Runs an authority-mutating callback inside a transaction that holds the
 * organization-scoped authority advisory lock and enforces both authority
 * post-conditions:
 *
 *   1. (P7-E2A, ADR-017 D14) ADMIN / MAINTAINER MUTUAL EXCLUSION — no actor
 *      may hold active Admin + active Maintainer assignments; and
 *   2. the effective-Admin post-condition — the organization must still have
 *      at least one active user with an active Admin assignment.
 *
 * This is the unified safety seam for every path that can change effective
 * authority:
 *   - creating a user with a primary role
 *   - assigning / activating / promoting a role
 *   - replacing a user's primary role away from Admin
 *   - disabling or deleting a user, deactivating or deleting an assignment
 *
 * The lock (SHARED with {@link mutateWithAuthorityInvariants} via the single
 * `authority-invariants` lock family) prevents concurrent transactions from
 * simultaneously observing consistent snapshots and each committing a
 * different half of an invariant violation (write-skew). The post-condition
 * checks guarantee that even if a caller's intent is mis-modeled, the
 * invariants cannot be violated.
 *
 * @param db - Database instance.
 * @param ctx - Tenant or request context carrying the organization anchor.
 * @param mutate - Callback that performs all authority mutations against the
 *   supplied transaction handle. It must not open its own transaction.
 * @returns The value returned by `mutate`.
 * @throws ValidationError with `reason: "ADMIN_MAINTAINER_EXCLUSION"` if the
 *   mutation would create an actor holding both active Admin and active
 *   Maintainer assignments; `reason: "LAST_ACTIVE_ADMIN"` if the mutation
 *   would leave the organization with no effective Admin.
 */
export async function mutateWithEffectiveAdminPostcondition<T>(
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
        throw new ValidationError("同一账号不能同时拥有管理员与维护者身份", {
          reason: "ADMIN_MAINTAINER_EXCLUSION",
          userId: violations[0]!.userId,
        });
      }

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
