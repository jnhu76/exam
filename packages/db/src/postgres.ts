import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { schema } from "./schema/pg.js";

/** Returns true if the URL uses the `postgresql://` or `postgres://` scheme. */
export function isPostgresqlUrl(url: string): boolean {
  return url.startsWith("postgresql://") || url.startsWith("postgres://");
}

/** A PostgreSQL database connection holding the raw `sql` driver and typed `db` instance. */
export interface PostgresDatabaseConnection {
  sql: postgres.Sql;
  db: PostgresJsDatabase<typeof schema>;
}

/**
 * Opens a PostgreSQL connection via `postgres` and returns a typed Drizzle
 * instance bound to the schema.
 * @param databaseUrl - Full PostgreSQL connection string.
 */
export async function createPostgresDatabase(
  databaseUrl: string,
): Promise<PostgresDatabaseConnection> {
  const sql = postgres(databaseUrl);
  const db = drizzle(sql, { schema });
  return { sql, db };
}

/**
 * Runs pending Drizzle migrations against the PostgreSQL database.
 * Silently ignores `42P07` (duplicate table) errors that occur when
 * concurrent workers apply migrations simultaneously.
 * @param db - Drizzle database instance to migrate.
 */
export async function migratePostgres(
  db: PostgresJsDatabase<typeof schema>,
): Promise<void> {
  try {
    await migrate(db, {
      migrationsFolder: fileURLToPath(
        new URL("../migrations/postgres", import.meta.url),
      ),
    });
  } catch (err: unknown) {
    if (isDuplicateTableDuringMigration(err)) {
      // concurrent worker already applied — safe to ignore
    } else {
      throw err;
    }
  }
}

/** Checks whether an error is a PostgreSQL `42P07` duplicate-table error. */
function isDuplicateTableDuringMigration(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as {
    code?: string;
    message?: string;
    cause?: { code?: string };
  };
  return e.code === "42P07" || e.cause?.code === "42P07";
}
