/**
 * Role-assignment sync helper (RBAC-M8).
 *
 * Enforces the migration invariant: `users.role` is a compatibility cache that
 * MUST stay in sync with the user's primary active assignment (ADR migration
 * window). Every write path that can change the primary active role calls
 * {@link syncUsersRoleFromPrimary} after the assignment mutation so the cache
 * matches. The last-admin postcondition (`adminInvariant.ts`) reads active
 * assignments via `countEffectiveActiveUsersWithRole` — NOT `users.role`.
 * This sync keeps the `users.role` compatibility cache consistent with the
 * primary assignment for legacy display paths.
 */
import type { Database } from "@exam/db/src/types.js";
import type { RequestContext } from "@exam/domain";
import { createUserRoleAssignmentRepo } from "@exam/db/src/repository/userRoleAssignmentRepo.js";
import { createUserRepo } from "@exam/db/src/repository/userRepo.js";

/**
 * Sets `users.role` to the user's current primary active assignment role
 * (or leaves it unchanged if there is no primary active assignment). Returns
 * the role written, or null if no primary active assignment exists.
 *
 * P7-RBAC-REMEDIATION F-06 (ACCEPTED, P3 — display-only): when no primary
 * active assignment exists, `users.role` is left at its previous value. This
 * is a cosmetic staleness only: the value is a compatibility cache that NO
 * authorization decision reads (authority is the union of active assignment
 * presets, resolved per request in `deriveAssignmentAuthority`), and the actor
 * is locked out (login fails closed with `no_active_assignments` / 401). It is
 * NOT cleared to a sentinel because `users.role` is `text NOT NULL` and the
 * user-list response serializes it through `AssignableRoleSchema`; a
 * non-assignable marker would break that contract. A full "honest display"
 * fix (list derives the shown role from active assignments) is future IA work;
 * it is not required before P7-F and never widens authority.
 */
export async function syncUsersRoleFromPrimary(
  db: Database,
  ctx: RequestContext,
  userId: string,
): Promise<string | null> {
  const assignmentRepo = createUserRoleAssignmentRepo(db);
  const userRepo = createUserRepo(db);
  const primary = await assignmentRepo.findPrimaryActiveForUser(ctx, userId);
  if (!primary) return null;
  await userRepo.update(ctx, userId, { role: primary.role });
  return primary.role;
}
