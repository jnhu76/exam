/**
 * ADR-007 Phase 3A — PostgreSQL worker-database prototype.
 *
 * TEST-ONLY module. Provides a per-worker PostgreSQL database bootstrap that
 * is an alternative to the legacy per-file schema isolation in
 * `testIsolation.ts`. It is enabled only when
 * `TEST_DB_ISOLATION=worker-database` AND the Phase 2A resolver derives a
 * non-null database name.
 *
 * Lifecycle (all side effects happen inside `setupWorkerTestDatabase`, never
 * at import time):
 *   1. resolve test scope via {@link resolveTestScope}
 *   2. reject if `APP_MODE`/`NODE_ENV` indicates production
 *   3. reject if `dbIsolation !== "worker-database"` (caller bug)
 *   4. ensure the worker database exists (CREATE DATABASE IF MISSING)
 *   5. run Drizzle migrations once (idempotent — Drizzle tracks `__drizzle_
 *      migrations`; re-running is a no-op once up to date)
 *   6. return a {@link WorkerDatabaseHandle} with `resetPostgres()` (TRUNCATE)
 *      and `close()`
 *
 * Non-goals of this PR (see ADR-007 + docs/archive/dev/test-ci-parallelism-plan.md):
 *   - Does NOT enable `fileParallelism: true`.
 *   - Does NOT change default `maxWorkers`.
 *   - Does NOT remove the legacy `file-schema` fallback (`testIsolation.ts`).
 *   - Does NOT migrate the whole `@exam/api` suite onto worker databases.
 *   - Does NOT introduce Redis / BullMQ.
 *   - Does NOT modify production schema / migrations.
 *   - Does NOT claim BUG-FLAKE-001 is fixed.
 *
 * Security:
 *   - Database name comes ONLY from the resolver, which validates it matches
 *     `^[a-z0-9_]+$` and is ≤63 chars. We re-validate here before quoting.
 *   - Identifiers are double-quoted via {@link quotePgIdentifier} after the
 *     regex check. No env value is ever interpolated into a SQL identifier
 *     raw.
 *   - The maintenance-DB existence check uses a bound `$1` parameter
 *     (`SELECT ... WHERE datname = $1`) — that path is parameterized and safe.
 *   - The helper refuses to run in production mode.
 */

import postgres from "postgres";
import { parseAppMode, resolveTestBranchUrl } from "./databaseUrl.js";
import { createPostgresDatabase, migratePostgres } from "./postgres.js";
import {
  computeAdvisoryLockKey,
  resolveTestInfraCoordinationUrl,
  withTestInfraLifecycleLock,
} from "./testInfraLock.js";
import {
  resolveTestScope,
  type ResolvedTestScope,
  type ResolverEnv,
} from "./testScope.js";

/** PostgreSQL identifier charset for derived database names. */
const PG_NAME_SAFE_RE = /^[a-z0-9_]+$/;
/** PostgreSQL identifier length limit (NAMEDATALEN-1 default). */
const PG_NAME_MAX_LEN = 63;

/**
 * Migration-metadata tables that `resetPostgres()` MUST NOT truncate.
 * Drizzle creates `__drizzle_migrations` (and a `__drizzle_migrations` journal
 * in the configured `migrationsSchema`, default `drizzle`). We exclude any
 * table whose name matches this set, regardless of schema.
 */
const MIGRATION_METADATA_TABLES = new Set([
  "__drizzle_migrations",
  "drizzle_migrations",
]);

/**
 * Handle returned by {@link setupWorkerTestDatabase}. Owns the worker DB
 * connection pool and exposes deterministic reset / close.
 */
export interface WorkerDatabaseHandle {
  /** Resolved worker database name (e.g. `exam_test_w1`). */
  databaseName: string;
  /** Full connection URL for the worker database. */
  databaseUrl: string;
  /** The resolved test scope this handle is bound to. */
  scope: ResolvedTestScope;
  /**
   * Truncate all business tables in the target schema (default `public`),
   * excluding migration-metadata tables. Resets sequences via
   * `RESTART IDENTITY`. Safe to call between tests / test files.
   */
  resetPostgres(): Promise<void>;
  /** Close the worker pool. Idempotent. */
  close(): Promise<void>;
}

/** Options for {@link setupWorkerTestDatabase}. */
export interface SetupWorkerTestDatabaseOptions {
  /** Environment to read (defaults to `process.env`). */
  env?: ResolverEnv;
  /**
   * Schema to truncate in `resetPostgres()`. Defaults to `public` — the
   * worker-database mode uses database-level isolation, not schema-level, so
   * business tables live in `public` unless a future migration moves them.
   */
  truncateSchema?: string;
}

/**
 * Double-quote a PostgreSQL identifier after strict validation. Escapes any
 * embedded `"` by doubling. MUST only be called on a string that already
 * passed {@link assertPgNameSafe}.
 */
function quotePgIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

/** Validate a derived database name. Throws on any unsafe character/length. */
function assertPgNameSafe(name: string): void {
  if (!PG_NAME_SAFE_RE.test(name)) {
    throw new Error(
      `[testWorkerDatabase] refusing to use unsafe database name: "${name}" (allowed: [a-z0-9_])`,
    );
  }
  if (name.length === 0) {
    throw new Error("[testWorkerDatabase] database name is empty");
  }
  if (name.length > PG_NAME_MAX_LEN) {
    throw new Error(
      `[testWorkerDatabase] database name exceeds ${PG_NAME_MAX_LEN} chars: "${name}"`,
    );
  }
}

/**
 * Reject if the environment looks like production. The helper is test-only.
 * Delegates mode semantics to the single-source `parseAppMode` (APP_MODE is
 * authoritative; NODE_ENV=production is treated as production when APP_MODE
 * is unset).
 */
function assertNotProduction(env: ResolverEnv): void {
  if (parseAppMode(env) === "production") {
    throw new Error(
      "[testWorkerDatabase] refusing to run in production mode (APP_MODE=production or NODE_ENV=production)",
    );
  }
}

/**
 * Resolve the base database URL from environment.
 * Uses TEST_DATABASE_URL or TEST_DB_URL when set (CI / remote / operator
 * special case); otherwise the single-source test-branch resolver constructs
 * a LOCAL URL from DB_HOST_PORT. Never falls back to DATABASE_URL.
 * Validates the postgres protocol FIRST when an explicit URL is present (a
 * worker-specific precondition, checked before name-safety so a malformed
 * scheme is reported as such), then delegates URL + name-safety to the
 * single-source test-branch resolver.
 */
function resolveBaseUrl(env: ResolverEnv): string {
  const raw = env.TEST_DATABASE_URL ?? env.TEST_DB_URL;
  if (
    raw &&
    !raw.startsWith("postgresql://") &&
    !raw.startsWith("postgres://")
  ) {
    throw new Error(
      `[testWorkerDatabase] base database URL must be postgresql:// or postgres://, got: ${raw}`,
    );
  }
  // Protocol-valid (or constructed local URL): delegate to the single-source
  // resolver for the full URL + name-safety guard (test/e2e/ci check).
  return resolveTestBranchUrl(env);
}

/**
 * Replace the pathname of a PostgreSQL connection URL with the given database
 * name, preserving protocol/credentials/host/port/query. Uses `URL` so
 * password special characters are handled by standard URL encoding.
 */
export function withDatabaseName(
  databaseUrl: string,
  databaseName: string,
): string {
  const url = new URL(databaseUrl);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

/**
 * Build the maintenance-DB URL (the server's `postgres` or configured DB) used
 * for the admin connection that runs `CREATE DATABASE`. We connect to the same
 * server as the base URL but target a DB the role is guaranteed to reach for
 * DDL. Delegates to the shared coordination-URL resolver so the advisory lock
 * sessions (and this admin session) all land on the SAME coordination database
 * (`TEST_ADMIN_DATABASE` ?? `postgres`) — advisory locks are database-local,
 * so splitting them across databases would silently break coordination.
 */
function resolveAdminUrl(env: ResolverEnv, baseUrl: string): string {
  return resolveTestInfraCoordinationUrl(baseUrl, env);
}

/**
 * Ensure the worker database exists. Connects to the maintenance DB, checks
 * `pg_database`, and runs `CREATE DATABASE` if missing. Closes the admin
 * connection in a `finally`. Idempotent.
 *
 * NOTE: `CREATE DATABASE` cannot run inside a transaction. `postgres.js`
 * `sql.unsafe(...)` does not wrap in a transaction, so this is safe. The
 * existence check is parameterized (`$1`); the `CREATE DATABASE` identifier
 * is validated + quoted, never raw env.
 *
 * ADR-007 Phase 6D: the existence check + optional `CREATE DATABASE` are wrapped
 * in the cross-process test-infra advisory lock (`withTestInfraLifecycleLock`).
 * Under `@exam/db` coverage, multiple Vitest workers concurrently run
 * `CREATE DATABASE` / `CREATE SCHEMA` / `migratePostgres` against the same PG
 * instance; the lock serializes the heavy catalog DDL so a single CREATE
 * DATABASE cannot be starved past the 5s testTimeout by sibling migration
 * traffic. The lock is acquired on a dedicated admin session and released in
 * `finally`. Ordinary business queries are NOT locked.
 */
export async function ensureDatabaseExists(
  adminUrl: string,
  databaseName: string,
  options: { env?: ResolverEnv } = {},
): Promise<void> {
  assertPgNameSafe(databaseName);
  await withTestInfraLifecycleLock(adminUrl, async () => {
    const admin = postgres(adminUrl);
    try {
      const rows = (await admin`
        SELECT 1 FROM pg_database WHERE datname = ${databaseName}
      `) as Array<{ "?column?": number }>;
      if (rows.length === 0) {
        await admin.unsafe(
          `CREATE DATABASE ${quotePgIdentifier(databaseName)}`,
        );
      }
    } finally {
      await admin.end();
    }
  });
}

/**
 * Drop a database if it exists, terminating any lingering connections first
 * (Phase 6D). `DROP DATABASE` fails if any backend still holds the DB open
 * (leftover pool from a crashed previous run); `pg_terminate_backend` clears
 * them so the drop succeeds. Refuses unsafe names via {@link assertPgNameSafe}.
 *
 * The terminate + drop are wrapped in the test-infra advisory lock so concurrent
 * teardown does not race on the same catalog entries. Errors are surfaced, not
 * swallowed — callers decide whether to treat a missing DB as success.
 *
 * @param adminUrl Maintenance/admin URL for DDL.
 * @param databaseName Database to drop (must pass {@link assertPgNameSafe}).
 * @param options.keepMissing When true (default), a missing DB is NOT an error.
 */
export async function dropDatabaseIfExists(
  adminUrl: string,
  databaseName: string,
  options: { keepMissing?: boolean; env?: ResolverEnv } = {},
): Promise<void> {
  const keepMissing = options.keepMissing ?? true;
  assertPgNameSafe(databaseName);
  await withTestInfraLifecycleLock(adminUrl, async () => {
    const admin = postgres(adminUrl);
    try {
      // Terminate any lingering connections to the target DB so DROP DATABASE
      // cannot fail with "database ... is being accessed by other users".
      // Exclude our own backend pid. Safe to run even if the DB is gone.
      await admin`
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = ${databaseName} AND pid <> pg_backend_pid()
      `;
      try {
        await admin.unsafe(
          `DROP DATABASE IF EXISTS ${quotePgIdentifier(databaseName)}`,
        );
      } catch (err) {
        // `IF EXISTS` already covers the missing case; if keepMissing and the
        // error is specifically "does not exist", it is a no-op. Any other
        // error (e.g. lock conflict) is re-thrown so callers see it.
        if (keepMissing && isDatabaseMissingError(err)) return;
        throw err;
      }
    } finally {
      await admin.end();
    }
  });
}

/** Heuristic: is `err` the "database does not exist" catalog error (3D000)? */
function isDatabaseMissingError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: string; cause?: { code?: string } };
  return e.code === "3D000" || e.cause?.code === "3D000";
}

/**
 * Per-process bootstrap memo: (coordination admin URL, worker URL) → completed
 * ensure+migrate promise.
 *
 * Vitest runs every test file in a fresh isolated worker process, and several
 * files call `buildTestApp()` (→ `setupWorkerTestDatabase`) multiple times per
 * file. Without this memo every call re-acquired the global test-infra
 * advisory lock twice (existence check + migration no-op check) — pure queue
 * load with no work performed. The database for a given worker URL only needs
 * to be ensured + migrated once per process; the promise is shared so
 * concurrent first calls also collapse into one bootstrap. Failures evict the
 * entry so a retry re-runs the bootstrap.
 *
 * The memo key includes the coordination admin URL, not just the worker URL:
 * the bootstrap runs UNDER a coordination authority (its advisory-lock queue).
 * Two calls with the same worker URL but different authorities (e.g. different
 * `TEST_ADMIN_DATABASE` in their envs) must not share bootstrap state — the
 * second call's authority would silently skip its own serialized ensure+migrate
 * and fragment the one-queue guarantee. Same authority + same worker URL ⇒
 * memo hit; any authority change ⇒ fresh bootstrap.
 */
const bootstrappedWorkerDatabases = new Map<string, Promise<void>>();

function workerBootstrapMemoKey(adminUrl: string, workerUrl: string): string {
  return `${adminUrl} ${workerUrl}`;
}

/**
 * Per-slot-database run lease connections, keyed by database name.
 *
 * See {@link acquireSlotDatabaseLease} for the contract. The connection is
 * deliberately held for the remainder of the process: the session-level
 * advisory lease releases automatically when the process exits (socket close),
 * so a crashed run can never leak its lease.
 */
const slotDatabaseLeases = new Map<string, postgres.Sql>();

/**
 * How long {@link acquireSlotDatabaseLease} waits before failing fast. A
 * sequential same-run slot handoff (previous file's process exiting) resolves
 * in milliseconds; a genuinely concurrent run holds the slot for minutes, so
 * 10s cleanly separates the two. `TEST_SLOT_LEASE_WAIT_MS` may override the
 * budget in tests (shortens the deterministic foreign-holder regression).
 */
const SLOT_LEASE_ACQUIRE_TIMEOUT_MS = 10_000;

/** Advisory-lock key namespace for the per-slot-database run lease. */
const SLOT_LEASE_LOCK_NAME_PREFIX = "exam_test_slot_lease:";

/**
 * Deterministic advisory-lock key for a slot database's run lease. Exported
 * for deterministic regression tests that must hold/release the exact lease
 * key from a foreign session.
 */
export function computeSlotLeaseKey(databaseName: string): bigint {
  return computeAdvisoryLockKey(
    `${SLOT_LEASE_LOCK_NAME_PREFIX}${databaseName}`,
  );
}

/**
 * Acquire the per-slot-database RUN lease, or fail fast.
 *
 * CONTRACT (round-3, 2026-08-27): two independent local Vitest runs on the
 * same PostgreSQL server both derive the same slot database names from
 * `VITEST_POOL_ID` (bounded 1..maxWorkers). Without a guard they would share
 * physical slot DBs CONCURRENTLY — each run's inter-file truncate boundary
 * wipes the other run's fixtures mid-test. Concurrent local worker-database
 * runs are NOT supported (CI shards use separate PG service containers, so
 * they never contend). Instead of inventing a run namespace, this lease makes
 * the existing single-run contract executable: the first process to claim a
 * slot database holds a session-level advisory lease on the coordination DB
 * for its process lifetime; a second process fails fast with a clear message.
 *
 * The lease uses `pg_try_advisory_lock` with a bounded retry loop rather than
 * one immediate try: sequential files within ONE run hand the slot over as
 * the previous worker process exits, and that teardown tail can hold the
 * lease for a few hundred milliseconds. A bounded wait absorbs the legitimate
 * handoff while still failing fast (default 10s) against a real concurrent
 * run.
 */
async function acquireSlotDatabaseLease(
  env: ResolverEnv,
  adminUrl: string,
  databaseName: string,
): Promise<void> {
  if (slotDatabaseLeases.has(databaseName)) return;
  const key = computeSlotLeaseKey(databaseName);
  const lease = postgres(adminUrl, { max: 1 });
  const rawWait = Number(env.TEST_SLOT_LEASE_WAIT_MS);
  const waitMs =
    Number.isFinite(rawWait) && rawWait >= 0
      ? rawWait
      : SLOT_LEASE_ACQUIRE_TIMEOUT_MS;
  const deadline = Date.now() + waitMs;
  try {
    for (;;) {
      const rows = (await lease.unsafe(
        "SELECT pg_try_advisory_lock($1) AS ok",
        [key.toString()],
      )) as Array<{ ok: boolean }>;
      if (rows[0]?.ok === true) {
        slotDatabaseLeases.set(databaseName, lease);
        return;
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `[testWorkerDatabase] slot database "${databaseName}" is in use by another test run on this PostgreSQL server. ` +
            `Concurrent local worker-database runs are not supported: both runs derive the same slot database names from VITEST_POOL_ID. ` +
            `Wait for the other run to finish, or point TEST_DATABASE_URL at a separate PostgreSQL instance.`,
        );
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  } catch (err) {
    await lease.end().catch(() => {});
    throw err;
  }
}

function ensureWorkerDatabaseBootstrapped(
  adminUrl: string,
  workerUrl: string,
  databaseName: string,
  env: ResolverEnv,
): Promise<void> {
  const memoKey = workerBootstrapMemoKey(adminUrl, workerUrl);
  let bootstrap = bootstrappedWorkerDatabases.get(memoKey);
  if (!bootstrap) {
    bootstrap = (async () => {
      await ensureDatabaseExists(adminUrl, databaseName, { env });
      const conn = await createPostgresDatabase(workerUrl);
      try {
        await withTestInfraLifecycleLock(
          adminUrl,
          () => migratePostgres(conn.db),
          { env },
        );
      } finally {
        await conn.sql.end();
      }
    })().catch((err: unknown) => {
      bootstrappedWorkerDatabases.delete(memoKey);
      throw err;
    });
    bootstrappedWorkerDatabases.set(memoKey, bootstrap);
  }
  return bootstrap;
}

/**
 * Set up a worker-scoped test database. See module docstring for the full
 * lifecycle. Throws with a clear message on any config / DDL / migration
 * failure; never swallows errors.
 *
 * @returns a {@link WorkerDatabaseHandle}. Caller MUST call `close()` in
 *   teardown to release the pool.
 */
export async function setupWorkerTestDatabase(
  options?: SetupWorkerTestDatabaseOptions,
): Promise<WorkerDatabaseHandle> {
  const env = options?.env ?? process.env;
  const truncateSchema = options?.truncateSchema ?? "public";

  assertNotProduction(env);

  const scope = resolveTestScope(env);
  if (scope.dbIsolation !== "worker-database") {
    throw new Error(
      `[testWorkerDatabase] expected TEST_DB_ISOLATION=worker-database, got "${scope.dbIsolation}"`,
    );
  }
  if (scope.postgresDatabaseName === null) {
    // Defensive: resolver guarantees non-null under worker-database, but
    // guard explicitly in case of future changes.
    throw new Error(
      "[testWorkerDatabase] resolver returned null database name under worker-database mode",
    );
  }

  const databaseName = scope.postgresDatabaseName;
  const baseUrl = resolveBaseUrl(env);
  const adminUrl = resolveAdminUrl(env, baseUrl);
  const workerUrl = withDatabaseName(baseUrl, databaseName);

  // Claim the slot database for this process BEFORE any lifecycle work: this
  // is the single-run contract's executable boundary (see
  // acquireSlotDatabaseLease). Fails fast if another run already owns it.
  await acquireSlotDatabaseLease(env, adminUrl, databaseName);
  await ensureWorkerDatabaseBootstrapped(
    adminUrl,
    workerUrl,
    databaseName,
    env,
  );
  const conn = await createPostgresDatabase(workerUrl);

  let closed = false;
  return {
    databaseName,
    databaseUrl: workerUrl,
    scope,
    async resetPostgres() {
      await truncateBusinessTables(conn.sql, truncateSchema);
    },
    async close() {
      if (closed) return;
      closed = true;
      await conn.sql.end();
    },
  };
}

/**
 * Truncate all base tables in `targetSchema` except migration-metadata tables.
 * Uses `RESTART IDENTITY CASCADE`. Throws on failure — never silently falls
 * back to `DROP SCHEMA`. If there are no business tables, returns silently.
 *
 * Table names come from the `pg_tables` catalog and are quote-escaped; they
 * are not interpolated from env.
 */
export async function truncateBusinessTables(
  sql: postgres.Sql,
  targetSchema: string,
): Promise<void> {
  if (!PG_NAME_SAFE_RE.test(targetSchema)) {
    throw new Error(
      `[testWorkerDatabase] refusing to truncate unsafe schema: "${targetSchema}"`,
    );
  }
  const rows = (await sql`
    SELECT tablename FROM pg_tables WHERE schemaname = ${targetSchema}
  `) as Array<{ tablename: string }>;
  const targets = rows
    .map((r) => r.tablename)
    .filter((name) => !MIGRATION_METADATA_TABLES.has(name));
  if (targets.length === 0) return;
  // All names originate from the catalog (not env), but we still escape `"`
  // defensively and quote every identifier.
  const quotedSchema = quotePgIdentifier(targetSchema);
  const list = targets
    .map((name) => `${quotedSchema}.${quotePgIdentifier(name)}`)
    .join(", ");
  await sql.unsafe(`TRUNCATE ${list} RESTART IDENTITY CASCADE`);
}
