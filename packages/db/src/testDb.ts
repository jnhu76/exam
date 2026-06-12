import { createDatabase } from "./database.js";
import { migratePostgres } from "./postgres.js";
import type { Database } from "./types.js";

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://exam:exam@localhost:5432/exam_test";

let _sharedDb: Database | null = null;
let _sharedSql: Awaited<ReturnType<typeof createDatabase>>["sql"] | null = null;
let _migrated = false;

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
