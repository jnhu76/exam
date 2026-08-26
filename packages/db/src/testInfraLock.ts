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
 *   schema create+migrate) in a single PostgreSQL advisory lock so that across
 *   all Vitest workers (separate Node processes) at most one worker performs
 *   heavy DDL/migration at a time. Ordinary business queries are NOT locked, so
 *   the bulk of each test still runs in parallel.
 *
 * Why a PostgreSQL advisory lock (not a JS mutex):
 *   A JS mutex only serializes within one Node process. Vitest file-parallelism
 *   spawns multiple processes, each with its own module graph, so a JS mutex
 *   would not coordinate across them. A PG advisory lock is held in the shared
 *   PostgreSQL server and therefore serializes across all test processes on the
 *   same instance.
 *
 * PostgreSQL advisory locks are DATABASE-LOCAL, not cluster-wide: a
 * `pg_advisory_lock` key only coordinates among sessions connected to the SAME
 * database. Test-infra callers historically locked while connected to
 * different databases (`exam_test` for schema lifecycle, `postgres` for
 * database lifecycle, worker DBs for worker-database lifecycle), so their
 * locks never coordinated with each other even though the key matched.
 * `withTestInfraLifecycleLock` therefore normalizes every caller onto ONE
 * coordination database via {@link resolveTestInfraCoordinationUrl}
 * (TEST_ADMIN_DATABASE, default `postgres`) before acquiring the lock.
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
 * Resolve the canonical test-infra coordination database URL.
 *
 * PostgreSQL advisory locks are database-local, so every test-infra lifecycle
 * lock must be hosted on the SAME database or the lock cannot coordinate
 * callers that connect to different databases. This helper maps any caller
 * URL onto the one coordination database:
 *
 *   - protocol: postgres:// or postgresql:// only (rejects anything else);
 *   - host / port / credentials: inherited from the input URL;
 *   - database pathname: replaced with `TEST_ADMIN_DATABASE`
 *     (default `postgres`);
 *   - query params: `options` / `search_path` removed (a lock session must not
 *     inherit a caller's isolated search_path); other params preserved.
 *
 * The coordination database name is validated against `^[a-zA-Z0-9_]+$` and
 * the PostgreSQL identifier length limit (63) so an env value can never be
 * interpolated into a SQL identifier raw.
 *
 * @param inputDatabaseUrl - Any caller-provided PG URL (any database).
 * @param env - Environment used to resolve TEST_ADMIN_DATABASE (defaults to
 *   `process.env`).
 * @throws When the protocol is unsupported or the coordination database name
 *   is unsafe.
 */
export function resolveTestInfraCoordinationUrl(
  inputDatabaseUrl: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  if (
    !inputDatabaseUrl.startsWith("postgres://") &&
    !inputDatabaseUrl.startsWith("postgresql://")
  ) {
    throw new Error(
      `[testInfraLock] coordination URL must be postgres:// or postgresql://, got: ${inputDatabaseUrl}`,
    );
  }
  const coordinationDatabase = env.TEST_ADMIN_DATABASE ?? "postgres";
  if (!/^[a-zA-Z0-9_]+$/.test(coordinationDatabase)) {
    throw new Error(
      `[testInfraLock] unsafe TEST_ADMIN_DATABASE "${coordinationDatabase}" (allowed: [a-zA-Z0-9_])`,
    );
  }
  if (coordinationDatabase.length === 0) {
    throw new Error("[testInfraLock] TEST_ADMIN_DATABASE must not be empty");
  }
  if (coordinationDatabase.length > 63) {
    throw new Error(
      `[testInfraLock] TEST_ADMIN_DATABASE exceeds 63 chars: "${coordinationDatabase}"`,
    );
  }
  const url = new URL(inputDatabaseUrl);
  url.pathname = `/${coordinationDatabase}`;
  // Strip search_path / options so the lock session never inherits an isolated
  // schema's search_path. Keep unrelated params (e.g. sslmode).
  const retained: Array<[string, string]> = [];
  for (const [key, value] of url.searchParams.entries()) {
    if (key !== "options" && key !== "search_path") {
      retained.push([key, value]);
    }
  }
  url.search = "";
  for (const [key, value] of retained) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

/**
 * Deterministic 64-bit advisory-lock key base for all test-infra heavy
 * lifecycle, split by resource class (see {@link TestInfraLockClass}).
 *
 * Derived from a stable, human-readable name via FNV-1a so the key is
 * reproducible and grep-able. We split the name into two 32-bit halves
 * (FNV-1a over the first and second half of the string) and combine into one
 * signed bigint accepted by `pg_advisory_lock(bigint)`.
 *
 * `pg_advisory_lock(bigint)` takes a single 64-bit key; the value is treated
 * as signed in the C boundary, so we keep it within int64 range.
 */
const TEST_INFRA_LIFECYCLE_LOCK_NAME = "exam_test_infra_lifecycle";

/**
 * Resource class of a lifecycle critical section.
 *
 * `schema` — CREATE/DROP SCHEMA + Drizzle migrations (high frequency,
 *   ~200 acquisitions per packages/db coverage run, holds ~30-900ms).
 * `database` — CREATE/DROP DATABASE (low frequency, and the observed
 *   long-tail outlier class: a pathological DROP DATABASE held the single
 *   shared key for 23.4s on WSL2 I/O, starved every queued schema setup past
 *   the 10s hookTimeout, and cascaded 6 suite failures — 2026-08-26 audit,
 *   docs/standards/test-flakes.md).
 *
 * Cross-class coordination that Phase 6D wanted (physical DB DDL not fighting
 * migration traffic on the engine) is carried by the participating tests'
 * deterministic-queue hang-protection budgets (lifecycle suites use 30s);
 * the key split exists so one class's outlier can no longer block the other
 * class's entire queue.
 */
export type TestInfraLockClass = "schema" | "database";

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
 * Stable 64-bit advisory-lock key for the SCHEMA lifecycle class (back-compat
 * export — the pre-split single key). Computed once from the fixed lock name;
 * exported for tests/diagnostics.
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
  // Fold into signed int64 range: pg_advisory_lock(bigint) is signed at the
  // C boundary, and an unsigned combined value above 2^63-1 is rejected by
  // PostgreSQL as "out of range for type bigint". asIntN is a no-op for
  // values already in range, so pre-split keys are unchanged.
  return BigInt.asIntN(64, combined);
}

/** Total acquisitions this process (diagnostics + regression tests). */
let acquisitionCount = 0;

/** Number of times this process acquired the lifecycle lock. */
export function getTestInfraLockAcquisitionCount(): number {
  return acquisitionCount;
}

/** Acquire the session-level advisory lock on `sql` (blocking). */
async function acquireAdvisoryLock(
  sql: postgres.Sql,
  key: bigint,
): Promise<void> {
  await sql.unsafe("SELECT pg_advisory_lock($1)", [key.toString()]);
  acquisitionCount++;
}

/** Release the session-level advisory lock on `sql`. Must be same session. */
async function releaseAdvisoryLock(
  sql: postgres.Sql,
  key: bigint,
): Promise<void> {
  await sql.unsafe("SELECT pg_advisory_unlock($1)", [key.toString()]);
}

/** Options for {@link withTestInfraLifecycleLock}. */
export interface TestInfraLifecycleLockOptions {
  /** Which resource class this critical section belongs to. */
  lockClass?: TestInfraLockClass;
}

/**
 * Run `fn` while holding the cross-process test-infra advisory lock.
 *
 * Opens a dedicated admin connection, acquires the lock (blocking until the
 * lock is free — this is the serialization point across workers) for the
 * chosen {@link TestInfraLockClass} key, runs `fn`, and always releases the
 * lock in `finally` (even on throw). Callers whose critical section is a
 * physical CREATE/DROP DATABASE MUST pass `lockClass: "database"` so a
 * long-tail database DDL outlier cannot block the high-frequency schema
 * lifecycle queue (and vice versa).
 *
 * PostgreSQL advisory locks are database-local. The `adminUrl` is normalized
 * via {@link resolveTestInfraCoordinationUrl} so ALL callers — regardless of
 * which database they otherwise connect to (`exam_test`, `postgres`, a worker
 * database) — coordinate on the SAME coordination database.
 *
 * The `fn` receives nothing; it should perform the heavy DDL/migration via its
 * OWN connections (the lock connection is dedicated and not exposed). The lock
 * is held for the duration of `fn` regardless of which connections `fn` uses —
 * coordination is by key identity in the PG server, not by connection.
 *
 * @param adminUrl Maintenance/admin URL used only to host the advisory lock
 * session. This connection is opened and closed within the call.
 * @param fn Heavy lifecycle body. Runs while the lock is held.
 * @param options.lockClass Resource class whose key to acquire.
 */
export async function withTestInfraLifecycleLock<T>(
  adminUrl: string,
  fn: () => Promise<T>,
  options?: TestInfraLifecycleLockOptions,
): Promise<T> {
  const lockClass = options?.lockClass ?? "schema";
  const key = getTestInfraLifecycleLockKey(lockClass);
  const trace = process.env.TEST_INFRA_TRACE === "1";
  const t0 = trace ? performance.now() : 0;
  const caller = trace ? firstExternalFrame() : "";
  const coordinationUrl = resolveTestInfraCoordinationUrl(adminUrl);
  const admin = postgres(coordinationUrl, { max: 1 });
  await acquireAdvisoryLock(admin, key);
  if (trace) {
    process.stderr.write(
      `[infra-lock] pid=${process.pid} class=${lockClass} acquired wait=${(performance.now() - t0).toFixed(0)}ms caller=${caller}\n`,
    );
  }
  const tHold = trace ? performance.now() : 0;
  try {
    return await fn();
  } finally {
    try {
      await releaseAdvisoryLock(admin, key);
    } finally {
      await admin.end();
      if (trace) {
        process.stderr.write(
          `[infra-lock] pid=${process.pid} class=${lockClass} released hold=${(performance.now() - tHold).toFixed(0)}ms caller=${caller}\n`,
        );
      }
    }
  }
}

/** First stack frame outside this module, for TEST_INFRA_TRACE diagnostics. */
function firstExternalFrame(): string {
  const stack = new Error().stack ?? "";
  for (const line of stack.split("\n")) {
    if (line.includes("testInfraLock")) continue;
    if (line.includes("at ")) return line.trim().slice(3, 83);
  }
  return "unknown";
}

/** Re-export the lock key computation for tests/diagnostics. */
export function getTestInfraLifecycleLockKey(
  lockClass: TestInfraLockClass = "schema",
): bigint {
  return lockClass === "schema"
    ? TEST_INFRA_LIFECYCLE_LOCK_KEY
    : computeLockKey(`${TEST_INFRA_LIFECYCLE_LOCK_NAME}_db`);
}
