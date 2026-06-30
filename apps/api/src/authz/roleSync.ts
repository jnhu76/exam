/**
 * Role-assignment sync helper (RBAC-M8).
 *
 * Enforces the migration invariant: `users.role` is a compatibility cache that
 * MUST stay in sync with the user's primary active assignment (ADR migration
 * window). Every write path that can change the primary active role calls
 * {@link syncUsersRoleFromPrimary} after the assignment mutation so the cache
 * matches. The last-admin guard still reads `users.role` (read path not
 * migrated in this PR), so this sync is what keeps the guard correct.
 */
import type { Database } from "@exam/db/src/types.js";
import type { RequestContext } from "@exam/domain";
import { createUserRoleAssignmentRepo } from "@exam/db/src/repository/userRoleAssignmentRepo.js";
import { createUserRepo } from "@exam/db/src/repository/userRepo.js";

/**
 * Sets `users.role` to the user's current primary active assignment role
 * (or leaves it unchanged if there is no primary active assignment). Returns
 * the role written, or null if no primary active assignment exists.
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
