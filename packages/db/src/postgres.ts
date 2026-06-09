import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { pgSchema } from "./schema/pg.js";

export interface PostgresDatabaseConnection {
  kind: "pg";
  sql: postgres.Sql;
  db: PostgresJsDatabase<typeof pgSchema>;
}

export function isPostgresqlUrl(url: string): boolean {
  return url.startsWith("postgresql://") || url.startsWith("postgres://");
}

export function createPostgresDatabase(
  databaseUrl: string,
): PostgresDatabaseConnection {
  const sql = postgres(databaseUrl);
  const db = drizzle(sql, { schema: pgSchema });
  return { kind: "pg", sql, db };
}

export async function migratePostgres(
  db: PostgresJsDatabase<typeof pgSchema>,
): Promise<void> {
  await migrate(db, {
    migrationsFolder: fileURLToPath(
      new URL("../migrations/postgres", import.meta.url),
    ),
  });
}
