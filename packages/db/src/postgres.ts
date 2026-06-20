import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { quoteIdent } from "./testIsolation.js";
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
 * @param searchPath - Optional schema name for test isolation. When set,
 *   creates a single-connection pool and sets `search_path` to the given
 *   schema (without `public`, to avoid `CREATE TABLE IF NOT EXISTS` skipping
 *   when tables already exist in the `public` schema).
 */
export async function createPostgresDatabase(
  databaseUrl: string,
  searchPath?: string,
): Promise<PostgresDatabaseConnection> {
  const sql = searchPath
    ? postgres(databaseUrl, { max: 1 })
    : postgres(databaseUrl);
  if (searchPath) {
    // NOTE: deliberately omit `, public` from search_path here, because
    // Drizzle's migration SQL files use `CREATE TABLE IF NOT EXISTS` and
    // PostgreSQL checks the entire search_path for existing relations before
    // creating. If `public` is in the path and the table already exists there,
    // the creation is silently skipped and the isolated schema stays empty.
    // Test queries that need to access the isolated schema AND fall back to
    // public must set search_path explicitly per-connection (e.g. in
    // testHelpers that use the URL's search_path or raw SET after connect).
    await sql.unsafe(`SET search_path TO ${quoteIdent(searchPath)}`);
  }
  const db = drizzle(sql, { schema });
  return { sql, db };
}

/**
 * Options for {@link migratePostgres}.
 */
export interface MigratePostgresOptions {
  /**
   * PostgreSQL schema to store the `__drizzle_migrations` tracking table.
   * When provided, each isolated test schema gets its own migration tracking
   * table, so Drizzle re-applies migrations instead of skipping them (as it
   * would when the shared `drizzle` schema already has the same migration
   * hashes recorded).
   */
  migrationsSchema?: string;
}

/**
 * Runs pending Drizzle migrations against the PostgreSQL database.
 * Silently ignores `42P07` (duplicate table) errors that occur when
 * concurrent workers apply migrations simultaneously.
 * @param db - Drizzle database instance to migrate.
 * @param options - Optional. When `migrationsSchema` is set, Drizzle stores
 *   the `__drizzle_migrations` tracking table in that schema instead of the
 *   shared `drizzle` schema, allowing per-schema isolation.
 */
export async function migratePostgres(
  db: PostgresJsDatabase<typeof schema>,
  options?: MigratePostgresOptions,
): Promise<void> {
  try {
    await migrate(db, {
      migrationsFolder: fileURLToPath(
        new URL("../migrations/postgres", import.meta.url),
      ),
      ...(options?.migrationsSchema
        ? { migrationsSchema: options.migrationsSchema }
        : {}),
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
