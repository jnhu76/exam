import { createDatabase } from "./database.js";
import { resolveTestBranchUrl } from "./databaseUrl.js";
import { migratePostgres } from "./postgres.js";
import { withTestInfraLifecycleLock } from "./testInfraLock.js";
import {
  createTestSchemaUnlocked,
  dropTestSchema,
  generateUniqueSchemaName,
  isTestDbIsolationEnabled,
} from "./testIsolation.js";
import {
  resolveDbIsolationMode,
  resolveDbPackageTestScope,
} from "./testScope.js";
import {
  setupWorkerTestDatabase,
  type WorkerDatabaseHandle,
} from "./testWorkerDatabase.js";
import type { Database } from "./types.js";

/**
 * Resolve the test database URL from environment variables.
 *
 * Delegates to the shared single-source test-branch resolver
 * ({@link resolveTestBranchUrl}) in `databaseUrl.ts`. This function is kept as
 * a stable, named export because 16+ test files import it directly. It is
 * intentionally mode-agnostic: it ALWAYS reads TEST_DATABASE_URL ?? TEST_DB_URL
 * and enforces the test name-safety guard, regardless of APP_MODE.
 *
 * @param env - Process environment to read from (defaults to `process.env`).
 * @returns A validated test database URL.
 * @throws If no test DB URL is set or the database name is unsafe.
 */
export function resolveTestDatabaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return resolveTestBranchUrl(env);
}

/**
 * Canonical test database URL — lazily resolved on first call.
 *
 * MUST NOT be evaluated at module top-level: vitest injects `config.env`
 * (including TEST_DATABASE_URL) into `process.env` only inside test worker
 * processes, not during the main process's module-graph loading phase.
 */
let _testDbUrl: string | undefined;
export function resolveTestDbUrl(): string {
  return (_testDbUrl ??= resolveTestDatabaseUrl());
}

/** Shared database instance (lazy-initialized). */
let _sharedDb: Database | null = null;
/** Shared raw SQL driver (lazy-initialized). */
let _sharedSql: Awaited<ReturnType<typeof createDatabase>>["sql"] | null = null;
/** Whether migrations have been applied to the shared instance. */
let _migrated = false;

/**
 * Returns a shared, migrated test database connection and a cleanup function
 * that tears it down. The connection is lazily created on first call and
 * reused across tests.
 *
 * WARNING: This instance is shared across all callers in the same process.
 * If you need per-file or per-task isolation, use {@link getIsolatedTestDb}
 * instead.
 */
export async function getTestDb(): Promise<{
  db: Database;
  cleanup: () => Promise<void>;
}> {
  if (!_sharedDb) {
    const conn = await createDatabase(resolveTestDbUrl());
    _sharedSql = conn.sql;
    _sharedDb = conn.db;
  }
  if (!_migrated) {
    await migratePostgres(_sharedDb);
    _migrated = true;
  }
  return {
    db: _sharedDb,
    cleanup: async () => {
      if (_sharedSql) {
        await _sharedSql.end();
      }
      _sharedDb = null;
      _sharedSql = null;
      _migrated = false;
    },
  };
}

/**
 * Returns a per-call isolated test database connection with its own PostgreSQL
 * schema and migration. The schema is dropped when `cleanup()` is called.
 *
 * NOTE: This function does NOT run `seed()`. Callers (e.g., `buildTestApp`)
 * must call `seed()` after migration if the test requires seeded data (default
 * org, admin user, candidate user). This avoids pulling password-hashing
 * dependencies into `packages/db`.
 *
 * When {@link isTestDbIsolationEnabled} returns `false`, this falls back to
 * the shared {@link getTestDb} instance (no isolation).
 *
 * @param namespace - Logical test namespace (e.g. `"api"`, `"db"`, `"tenant"`).
 * @returns Database connection in isolated schema + cleanup function, plus the
 *   connection URL / schema name so tests can open a SECOND connection to the
 *   same isolated schema (e.g. deterministic snapshot/concurrency tests).
 */
export async function getIsolatedTestDb(namespace: string): Promise<{
  db: Database;
  cleanup: () => Promise<void>;
  databaseUrl?: string;
  schemaName?: string;
}> {
  if (!isTestDbIsolationEnabled()) {
    return getTestDb();
  }

  const baseUrl = resolveTestDbUrl();
  const schemaName = generateUniqueSchemaName(namespace);
  // Connect BEFORE the critical section: `SET search_path` tolerates a
  // not-yet-created schema, and keeping the pool setup outside the lock
  // shrinks the critical section to CREATE SCHEMA + migrate only. A connect
  // failure needs no cleanup (nothing created yet).
  const conn = await createDatabase(baseUrl, schemaName);
  try {
    // CREATE SCHEMA + migrate run in ONE advisory-lock critical section.
    // Splitting them into two acquisitions made every setup pay the global
    // DDL queue wait twice; under parallel workers that alone could consume
    // most of a test's default budget (median wait ~0.7s, p95 ~2.7s measured
    // on packages/db coverage — see docs/standards/test-flakes.md).
    await withTestInfraLifecycleLock(baseUrl, async () => {
      await createTestSchemaUnlocked(baseUrl, schemaName);
      await migratePostgres(conn.db, { migrationsSchema: schemaName });
    });
  } catch (err) {
    await conn.sql.end().catch(() => {});
    await dropTestSchema(baseUrl, schemaName).catch(() => {});
    throw err;
  }

  return {
    db: conn.db,
    databaseUrl: baseUrl,
    schemaName,
    cleanup: async () => {
      try {
        await conn.sql.end();
      } finally {
        // Ensure schema is dropped even if sql.end() throws
        await dropTestSchema(baseUrl, schemaName).catch(() => {});
      }
    },
  };
}

/**
 * Worker-scoped shared test database for ORDINARY @exam/db tests (#648).
 *
 * MODE-AWARE ordinary-test adapter — the single seam that knows
 * `TEST_DB_ISOLATION`:
 *
 *   - `worker-database` (default): reuse the package's own persistent
 *     worker-slot database (`exam_test_db_w{VITEST_POOL_ID}`, see
 *     `resolveDbPackageTestScope`) via the existing worker-database bootstrap
 *     in `testWorkerDatabase.ts`. The slot is ensured + migrated once per
 *     physical slot (server-side precheck, lock-free on warm slots), then
 *     reused across test files with a TRUNCATE reset boundary — instead of
 *     paying `CREATE SCHEMA + full migrate + DROP SCHEMA` per file the way
 *     {@link getIsolatedTestDb} does.
 *
 *   - `file-schema` (supported restricted-role mode — testing.md §2): the
 *     helper transparently delegates to {@link getIsolatedTestDb} with the
 *     fixed internal namespace below (fresh schema + migrate per file,
 *     dropped on cleanup). No package worker database is created or
 *     connected to, so a no-CREATEDB role over an explicit
 *     TEST_DATABASE_URL keeps working unchanged.
 *
 * Callers must NOT branch on the mode — that is this helper's entire job;
 * converted ordinary tests are mode-agnostic by contract.
 *
 * Contract (identical in both modes; mirrors the API `buildTestApp` reset
 * boundary):
 *   - FIRST use in THIS Vitest file: worker mode reuses/bootstraps the
 *     package slot then `resetPostgres()` (TRUNCATE business tables, RESTART
 *     IDENTITY CASCADE, migration metadata preserved) so the file starts
 *     from a clean business DB regardless of what a predecessor file or run
 *     left on the slot. File-schema mode needs no reset — a freshly created
 *     + migrated schema IS clean by construction.
 *   - Later calls in the SAME file share the same connection and do NOT
 *     truncate again — a file may retain rows across several fixtures, so
 *     per-call truncation is forbidden. A file needing mutually isolated
 *     fixtures must stay on {@link getIsolatedTestDb}.
 *   - `cleanup()` closes this file's connection (and, in file-schema mode,
 *     drops the per-file schema); in worker mode the physical slot database
 *     is deliberately NOT dropped — its persistence across files/runs is the
 *     optimization. A post-cleanup call in the same file reconnects without
 *     another reset (same once-per-file rule).
 *
 * Process/isolation basis: Vitest 4 (forks pool, `isolate: true`, the
 * package default) executes every test file in a fresh worker process with a
 * fresh module registry, so the module-local fixture/reset-once facts below
 * have FILE lifetime; the cross-file/cross-process facts are the
 * server-side bootstrap precheck plus the reset boundary itself.
 *
 * Both modes run a max:1 connection pool (the fresh-schema path always did;
 * the worker path pins it), so converted tests keep the same serialized
 * statement execution shape they were written against. The helper does NOT
 * run seed(); callers build their own fixtures through repositories.
 * Concurrency ownership (worker mode): the package-db run lease
 * (`exam_test_db_worker_database_run`, held by `packages/db/vitest.globalSetup.ts`
 * only in worker-database mode) excludes a second simultaneous @exam/db
 * invocation on the same server.
 */
export interface WorkerScopedTestDb {
  /** Drizzle binding over the fixture's connection pool. */
  db: Database;
  /** Connection URL: the package slot database (worker mode) or the base test database (file-schema mode). */
  databaseUrl: string;
  /** Worker mode only: package slot database name (e.g. `exam_test_db_w1`). */
  databaseName?: string | undefined;
  /** File-schema mode only: per-file isolated schema name. */
  schemaName?: string | undefined;
  /** Close this file's connection (file-schema mode also drops the schema). Idempotent. */
  cleanup: () => Promise<void>;
}

/**
 * Fixed internal namespace for the file-schema fallback delegation. Derived
 * deterministically from the helper contract (never an operator env var, never
 * a random caller-provided string); `getIsolatedTestDb` appends its own
 * per-call unique suffix, so every file gets a distinct schema.
 */
const DB_PACKAGE_FILE_SCHEMA_NAMESPACE = "db-worker-scoped";

let _workerScopedFixture: Promise<WorkerScopedTestDb> | undefined;
/** FILE-lifetime fact: this file's first fixture use already reset the slot. */
let _workerScopedResetPerformed = false;

export async function getWorkerScopedTestDb(): Promise<WorkerScopedTestDb> {
  if (!_workerScopedFixture) {
    const attempt = openWorkerScopedFixture();
    // A failed open must not stay cached for the file's remaining calls
    // (mirrors the bootstrap memo's delete-on-error): evict only if this
    // attempt is still the cached one, so a later successful open is never
    // displaced by a stale rejection.
    attempt.catch(() => {
      if (_workerScopedFixture === attempt) {
        _workerScopedFixture = undefined;
      }
    });
    _workerScopedFixture = attempt;
  }
  return _workerScopedFixture;
}

async function openWorkerScopedFixture(): Promise<WorkerScopedTestDb> {
  if (resolveDbIsolationMode() === "file-schema") {
    return openFileSchemaFixture();
  }
  const handle: WorkerDatabaseHandle = await setupWorkerTestDatabase({
    scope: resolveDbPackageTestScope(),
  });
  if (!_workerScopedResetPerformed) {
    await handle.resetPostgres();
    _workerScopedResetPerformed = true;
  }
  return {
    db: handle.db,
    databaseUrl: handle.databaseUrl,
    databaseName: handle.databaseName,
    cleanup: async () => {
      _workerScopedFixture = undefined;
      await handle.close();
    },
  };
}

/**
 * file-schema branch of the adapter: delegate to the existing fresh-schema
 * mechanism instead of duplicating CREATE SCHEMA / migrate / DROP SCHEMA.
 * See {@link getWorkerScopedTestDb} for the shared contract.
 */
async function openFileSchemaFixture(): Promise<WorkerScopedTestDb> {
  const isolated = await getIsolatedTestDb(DB_PACKAGE_FILE_SCHEMA_NAMESPACE);
  return {
    db: isolated.db,
    // getIsolatedTestDb returns the base URL it resolved; the ?? is
    // type-completeness for its isolation-disabled fallback shape, which
    // cannot occur in file-schema mode.
    databaseUrl: isolated.databaseUrl ?? resolveTestDbUrl(),
    schemaName: isolated.schemaName,
    cleanup: async () => {
      _workerScopedFixture = undefined;
      await isolated.cleanup();
    },
  };
}
