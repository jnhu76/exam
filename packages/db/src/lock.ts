import { sql } from "drizzle-orm";
import type { Database } from "./types.js";

/**
 * Identifies a family of organization-scoped advisory locks.
 *
 * All authority-mutation seams MUST use the SAME kind: the Admin↔Maintainer
 * exclusion post-condition (P7-E2A, ADR-017 D14) and the last-effective-Admin
 * post-condition are only race-safe when every authority mutation for an
 * organization serializes on one lock. Adding a second kind for a second
 * invariant would let two concurrent mutations run under different locks and
 * reintroduce write-skew.
 */
export type OrganizationLockKind = "authority-invariants";

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
