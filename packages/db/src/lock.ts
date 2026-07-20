import { sql } from "drizzle-orm";
import type { Database } from "./types.js";

/** Identifies a family of organization-scoped advisory locks. */
export type OrganizationLockKind = "effective-admin-invariant";

/**
 * Acquires a PostgreSQL transaction-scoped advisory lock for the given
 * organization and lock family.
 *
 * The lock is automatically released at COMMIT/ROLLBACK. Uses two integer
 * keys: the first is a fixed namespace hash, the second is derived from the
 * organization id. Hash collisions only cause additional serialization and
 * never weaken the invariant.
 *
 * @param tx - Transaction handle.
 * @param organizationId - Organization identifier.
 * @param kind - Lock family.
 */
export async function acquireOrganizationAdvisoryLock(
  tx: Database,
  organizationId: string,
  kind: OrganizationLockKind,
): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${kind}), hashtext(${organizationId}))`,
  );
}
