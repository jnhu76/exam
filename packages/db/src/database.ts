import { createPostgresDatabase } from "./postgres.js";

/** Resolved database connection type returned by {@link createDatabase}. */
export type DatabaseConnection = Awaited<ReturnType<typeof createDatabase>>;

/**
 * Creates a database connection using the provided URL, defaulting to the
 * `DATABASE_URL` environment variable or a local PostgreSQL instance.
 * @returns Database connection with `sql` driver and `db` Drizzle instance.
 */
export function createDatabase(
  databaseUrl = process.env.DATABASE_URL ??
    "postgresql://exam:exam@localhost:5432/exam",
) {
  return createPostgresDatabase(databaseUrl);
}
