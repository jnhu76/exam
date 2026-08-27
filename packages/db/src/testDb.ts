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
