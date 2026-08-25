/**
 * E2E mutable-state reset (issue #330 root-cause fix, TS side).
 *
 * Contract: `resetE2eState` converges a database toward the canonical E2E
 * baseline by truncating EVERY business table (RESTART IDENTITY CASCADE,
 * migration-metadata tables excluded) so the subsequent seed rebuilds state
 * from zero. It is the "reset" half of reseed = reset + seed; the seed itself
 * (`runE2eSeed` without `reset`) remains an additive upsert by design.
 *
 * Safety: this is a destructive operation, so it is guarded TWICE, both times
 * against the exact full-reset allowlist (`isFullResetTarget`):
 *   1. callers resolve the target from the URL-resolver test branch (whose own
 *      name guard only checks "contains test/e2e/ci" — looser than this one);
 *   2. this function independently asks the SERVER what database the
 *      connection actually lands on (`SELECT current_database()`) and refuses
 *      anything outside the allowlist. The runtime check is authoritative: it
 *      cannot be fooled by a misresolved URL, a stale env var, or a connection
 *      pool aimed at a different database.
 *
 * On refusal it throws — a destructive step must fail closed, never silently
 * skip and let the seed run additively against a database it was supposed to
 * converge.
 *
 * Reuses `truncateBusinessTables` from the vitest worker-DB isolation
 * (`testWorkerDatabase.ts`) so there is exactly ONE truncate-all
 * implementation in the package (same catalog-driven table discovery, same
 * `__drizzle_migrations` exclusion). This module is E2E test infrastructure
 * and may import that test-only module.
 */

import postgres from "postgres";
import type { Database } from "./types.js";
import {
  isFullResetTarget,
  refuseFullResetMessage,
} from "./scripts/destructiveDbNameGuard.js";
import { truncateBusinessTables } from "./testWorkerDatabase.js";

/**
 * Postgres-js Drizzle instances expose the underlying template client as
 * `$client`; the property is added by the `drizzle()` factory's return-type
 * intersection, so it is not part of the `PostgresJsDatabase` interface and
 * must be reached through this narrow structural view.
 */
type WithPgClient = { $client: postgres.Sql };

/**
 * Truncate all business tables in the `public` schema of the database the
 * given Drizzle connection is actually connected to, after verifying that
 * database is a legal full-reset target.
 *
 * @param db - Drizzle database instance (postgres-js driver; the underlying
 *   `sql` client is reached via `db.$client`).
 * @throws When the connected database is not on the full-reset allowlist
 *   (dev `exam`, vitest `exam_test*`, E2E forensic archives
 *   `exam_e2e_w<N>_prior`, or any unrecognized name) or when the TRUNCATE
 *   itself fails.
 */
export async function resetE2eState(db: Database): Promise<void> {
  const client = (db as unknown as WithPgClient).$client;
  const rows = (await client`SELECT current_database() AS db_name`) as Array<{
    db_name: string;
  }>;
  const dbName = rows[0]?.db_name ?? "";
  if (!isFullResetTarget(dbName)) {
    throw new Error(refuseFullResetMessage(dbName));
  }
  await truncateBusinessTables(client, "public");
}
