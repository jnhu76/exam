import { resolveDatabaseUrlFromEnv } from "./databaseUrl.js";
import {
  createPostgresDatabase,
  type CreatePostgresDatabaseOptions,
} from "./postgres.js";

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
 * @param options - Optional connection settings, forwarded verbatim to
 *   {@link createPostgresDatabase}. Its `max` is only consulted when
 *   `searchPath` is NOT set (the searchPath path always pins `max: 1`);
 *   pass `max: 1` when a caller must bind a session-level `SET` to every
 *   statement it issues through a default (non-searchPath) handle.
 * @returns Database connection with `sql` driver and `db` Drizzle instance.
 */
export function createDatabase(
  databaseUrl?: string,
  searchPath?: string,
  options?: CreatePostgresDatabaseOptions,
) {
  const url = databaseUrl ?? resolveDatabaseUrlFromEnv();
  return createPostgresDatabase(url, searchPath, options);
}
