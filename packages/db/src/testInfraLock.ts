/**
 * ADR-007 Phase 6D — test-infra advisory lock for heavy DDL/migration lifecycle.
 *
 * TEST-ONLY module. Never imported by production code.
 *
 * Problem it solves (BUG-FLAKE-001 physical-DB-lifecycle sub-class):
 *   Under `@exam/db` coverage, up to 13 Vitest test files run in parallel
 *   against the same PostgreSQL instance. Several of them execute heavy DDL /
 *   migration lifecycle in their setup/teardown:
 *     - `testWorkerDatabase.test.ts`  → `CREATE DATABASE` + `migratePostgres`
 *     - `seed.test.ts` / `demo-seed.test.ts` / `testCleanup.test.ts` /
 *       `testIsolation.test.ts` → `CREATE SCHEMA` + `migratePostgres`
 *   With no coordination, these heavy operations contend on the same PG engine
 *   (catalog locks, connection slots, IO). Under v8 coverage instrumentation
 *   the timing amplification can push a single `CREATE DATABASE` / migrate past
 *   the default 5s testTimeout — manifesting as the
 *   `ensureDatabaseExists > creates the database if missing` flake.
 *
 * Mitigation:
 *   Wrap ONLY the heavy test-infra lifecycle sections (database ensure/drop,
 *   schema create+migrate) in a single cluster-wide PostgreSQL advisory lock so
 *   that across all Vitest workers (separate Node processes) at most one worker
 *   performs heavy DDL/migration at a time. Ordinary business queries are NOT
 *   locked, so the bulk of each test still runs in parallel.
 *
 * Why a PostgreSQL advisory lock (not a JS mutex):
 *   A JS mutex only serializes within one Node process. Vitest file-parallelism
 *   spawns multiple processes, each with its own module graph, so a JS mutex
 *   would not coordinate across them. A PG advisory lock is held in the shared
 *   PostgreSQL server and therefore serializes across all test processes on the
 *   same instance.
 *
 * Semantics:
 *   - `pg_advisory_lock(bigint)` is a session-level, non-transactional,
 *     re-entrant-from-different-sessions-blocking lock. It blocks the caller
 *     until acquired, and MUST be released with `pg_advisory_unlock(bigint)` on
 *     the SAME session that acquired it. We therefore acquire and release on a
 *     single dedicated admin connection within one `withTestInfraLifecycleLock`
 *     call, and release in a `finally`.
 *
 * Non-goals:
 *   - Does NOT enable `fileParallelism: true` for apps/api.
 *   - Does NOT change default `maxWorkers`.
 *   - Does NOT lock ordinary business queries.
 *   - Does NOT claim BUG-FLAKE-001 is globally closed.
 *   - Does NOT change production code paths.
 */

import postgres from "postgres";

/**
 * Deterministic 64-bit advisory-lock key for all test-infra heavy lifecycle.
 *
 * Derived from a stable, human-readable name (`exam_test_infra_lifecycle`)
 * via FNV-1a so the key is reproducible and grep-able. We split the name into
 * two 32-bit halves (FNV-1a over the first and second half of the string) and
 * combine into one signed bigint accepted by `pg_advisory_lock(bigint)`.
 *
 * `pg_advisory_lock(bigint)` takes a single 64-bit key; the value is treated as
 * signed in the C boundary, so we keep it within int64 range.
 */
const TEST_INFRA_LIFECYCLE_LOCK_NAME = "exam_test_infra_lifecycle";

/**
 * FNV-1a (32-bit) hash of a string into an unsigned 32-bit integer, returned as
 * a signed 32-bit (bitwise forces signedness) so two halves can be combined.
 */
function fnv1a32(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    // FNV multiplier 0x01000193; keep in 32-bit via Math.imul + unsigned >>> 0.
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h | 0; // to signed int32
}

/**
 * Stable 64-bit advisory-lock key for test-infra lifecycle. Computed once from
 * the fixed lock name; exported for tests/diagnostics.
 */
export const TEST_INFRA_LIFECYCLE_LOCK_KEY: bigint = computeLockKey(
  TEST_INFRA_LIFECYCLE_LOCK_NAME,
);

/** Combine two FNV-1a halves into one signed bigint lock key. */
function computeLockKey(name: string): bigint {
  const mid = Math.floor(name.length / 2);
  const hi = fnv1a32(name.slice(0, mid)) >>> 0; // unsigned 32-bit
  const lo = fnv1a32(name.slice(mid)) >>> 0; // unsigned 32-bit
  // (hi << 32) | lo  as a signed 64-bit. BigInt math keeps precision.
  const combined = (BigInt(hi) << 32n) | BigInt(lo);
  // Fold into signed int64 range (PostgreSQL accepts the numeric value).
  return combined;
}

/** Acquire the session-level advisory lock on `sql` (blocking). */
async function acquireAdvisoryLock(
  sql: postgres.Sql,
  key: bigint,
): Promise<void> {
  await sql.unsafe("SELECT pg_advisory_lock($1)", [key.toString()]);
}

/** Release the session-level advisory lock on `sql`. Must be same session. */
async function releaseAdvisoryLock(
  sql: postgres.Sql,
  key: bigint,
): Promise<void> {
  await sql.unsafe("SELECT pg_advisory_unlock($1)", [key.toString()]);
}

/**
 * Run `fn` while holding the cross-process test-infra advisory lock.
 *
 * Opens a dedicated admin connection, acquires the lock (blocking until the
 * lock is free — this is the serialization point across workers), runs `fn`,
 * and always releases the lock in `finally` (even on throw).
 *
 * The `fn` receives nothing; it should perform the heavy DDL/migration via its
 * OWN connections (the lock connection is dedicated and not exposed). The lock
 * is held for the duration of `fn` regardless of which connections `fn` uses —
 * coordination is by key identity in the PG server, not by connection.
 *
 * @param adminUrl Maintenance/admin URL used only to host the advisory lock
 *   session. This connection is opened and closed within the call.
 * @param fn Heavy lifecycle body. Runs while the lock is held.
 */
export async function withTestInfraLifecycleLock<T>(
  adminUrl: string,
  fn: () => Promise<T>,
): Promise<T> {
  const admin = postgres(adminUrl, { max: 1 });
  await acquireAdvisoryLock(admin, TEST_INFRA_LIFECYCLE_LOCK_KEY);
  try {
    return await fn();
  } finally {
    try {
      await releaseAdvisoryLock(admin, TEST_INFRA_LIFECYCLE_LOCK_KEY);
    } finally {
      await admin.end();
    }
  }
}

/** Re-export the lock key computation for tests/diagnostics. */
export function getTestInfraLifecycleLockKey(): bigint {
  return TEST_INFRA_LIFECYCLE_LOCK_KEY;
}
