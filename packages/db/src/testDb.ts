import { createDatabase } from "./database.js";
import { resolveTestBranchUrl } from "./databaseUrl.js";
import { migratePostgres } from "./postgres.js";
import {
  isTestDbIsolationEnabled,
  setupIsolatedTestDb,
  type IsolatedTestDb,
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

/** Canonical test database URL — resolved once at module load. */
export const TEST_DB_URL = resolveTestDatabaseUrl();

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
    const conn = await createDatabase(TEST_DB_URL);
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
 * @returns Database connection in isolated schema + cleanup function.
 */
export async function getIsolatedTestDb(namespace: string): Promise<{
  db: Database;
  cleanup: () => Promise<void>;
}> {
  if (!isTestDbIsolationEnabled()) {
    return getTestDb();
  }

  const iso = await setupIsolatedTestDb({
    namespace,
    databaseUrl: TEST_DB_URL,
  });
  let conn: Awaited<ReturnType<typeof createDatabase>>;
  try {
    conn = await createDatabase(iso.databaseUrl, iso.schemaName);
    await migratePostgres(conn.db, { migrationsSchema: iso.schemaName });
  } catch (err) {
    await iso.cleanup();
    throw err;
  }

  return {
    db: conn.db,
    cleanup: async () => {
      try {
        await conn.sql.end();
      } finally {
        // Ensure schema is dropped even if sql.end() throws
        await iso.cleanup();
      }
    },
  };
}
