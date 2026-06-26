import { resolveDatabaseUrlFromEnv } from "./databaseUrl.js";
import { createPostgresDatabase } from "./postgres.js";

/** Resolved database connection type returned by {@link createDatabase}. */
export type DatabaseConnection = Awaited<ReturnType<typeof createDatabase>>;

/**
 * Creates a database connection using the provided URL. When no URL is given,
 * resolves it from the environment via the single-source resolver
 * ({@link resolveDatabaseUrlFromEnv}); a missing DATABASE_URL fails fast
 * rather than silently connecting to a guessed localhost instance.
 *
 * @param databaseUrl - PG connection URL (optional; defaults to the resolved env URL).
 * @param searchPath - Optional schema name to set as search_path (test isolation).
 * @returns Database connection with `sql` driver and `db` Drizzle instance.
 */
export function createDatabase(databaseUrl?: string, searchPath?: string) {
  const url = databaseUrl ?? resolveDatabaseUrlFromEnv();
  return createPostgresDatabase(url, searchPath);
}
