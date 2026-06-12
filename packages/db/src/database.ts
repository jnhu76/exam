import { createPostgresDatabase } from "./postgres.js";

export type DatabaseConnection = Awaited<ReturnType<typeof createDatabase>>;

export function createDatabase(
  databaseUrl = process.env.DATABASE_URL ??
    "postgresql://exam:exam@localhost:5432/exam",
) {
  return createPostgresDatabase(databaseUrl);
}
