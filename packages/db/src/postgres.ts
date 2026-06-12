import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { schema } from "./schema/pg.js";

export function isPostgresqlUrl(url: string): boolean {
  return url.startsWith("postgresql://") || url.startsWith("postgres://");
}

export interface PostgresDatabaseConnection {
  sql: postgres.Sql;
  db: PostgresJsDatabase<typeof schema>;
}

export async function createPostgresDatabase(
  databaseUrl: string,
): Promise<PostgresDatabaseConnection> {
  const sql = postgres(databaseUrl);
  const db = drizzle(sql, { schema });
  return { sql, db };
}

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

function isDuplicateTableDuringMigration(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as {
    code?: string;
    message?: string;
    cause?: { code?: string };
  };
  return e.code === "42P07" || e.cause?.code === "42P07";
}
