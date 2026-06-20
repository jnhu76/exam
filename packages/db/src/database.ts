import { createPostgresDatabase } from "./postgres.js";

/** Resolved database connection type returned by {@link createDatabase}. */
export type DatabaseConnection = Awaited<ReturnType<typeof createDatabase>>;

/**
 * Creates a database connection using the provided URL, defaulting to the
 * `DATABASE_URL` environment variable or a local PostgreSQL instance.
 * @param databaseUrl - PG connection URL (optional, defaults to DATABASE_URL or localhost).
 * @param searchPath - Optional schema name to set as search_path (test isolation).
 * @returns Database connection with `sql` driver and `db` Drizzle instance.
 */
export function createDatabase(
  databaseUrl = process.env.DATABASE_URL ??
    "postgresql://exam:exam@localhost:5432/exam",
  searchPath?: string,
) {
  return createPostgresDatabase(databaseUrl, searchPath);
}
