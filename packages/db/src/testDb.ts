import { createDatabase } from "./database.js";
import { migratePostgres } from "./postgres.js";
import type { Database } from "./types.js";

/** Database URL for the test database, defaults to `exam_test`. */
const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://exam:exam@localhost:5432/exam_test";

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
