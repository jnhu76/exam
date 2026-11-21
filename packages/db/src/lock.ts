import { sql } from "drizzle-orm";
import type { Database } from "./types.js";

/**
 * Identifies a family of organization-scoped advisory locks.
 *
 * INVARIANT: every invariant family owns exactly ONE kind, and every seam
 * guarding that family MUST acquire that same kind — splitting one family
 * across kinds lets two concurrent mutations run under different locks and
 * reintroduces write-skew. The Admin↔Maintainer exclusion post-condition
 * (ADR-017 D14) and the last-effective-Admin post-condition are only
 * race-safe because every authority mutation for an organization serializes
 * on `authority-invariants`.
 *
 * `candidate-identity` is a deliberately DISJOINT family, not a split of the
 * authority family: it serializes candidate identity-field configuration
 * (at most one unique field; an org with candidates keeps it) against
 * candidate creation. Candidate creation holds no authority lock, so
 * folding it into `authority-invariants` would add serialization between
 * unrelated invariants without guarding any shared one.
 */
export type OrganizationLockKind =
  | "authority-invariants"
  | "candidate-identity";

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
