import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import {
  drizzle,
  type BetterSQLite3Database,
} from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { sqliteSchema } from "./schema/sqlite.js";

export interface SqliteDatabaseConnection {
  client: Database.Database;
  db: BetterSQLite3Database<typeof sqliteSchema>;
}

export function createSqliteDatabase(
  filename: string,
): SqliteDatabaseConnection {
  const client = new Database(filename);
  client.pragma("foreign_keys = ON");

  return {
    client,
    db: drizzle(client, { schema: sqliteSchema }),
  };
}

export { type SqliteDatabase } from "./types.js";

export function migrateSqlite(
  db: BetterSQLite3Database<typeof sqliteSchema>,
): void {
  migrate(db, {
    migrationsFolder: fileURLToPath(
      new URL("../migrations/sqlite", import.meta.url),
    ),
  });
}
