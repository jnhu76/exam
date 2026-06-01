import { createDatabase } from "@exam/db/src/database.js";
import { migrateSqlite } from "@exam/db/src/sqlite.js";
import { migratePostgres } from "@exam/db/src/postgres.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  process.stdout.write("No DATABASE_URL set, skipping migration.\n");
  process.exit(0);
}

const conn = createDatabase(databaseUrl);

if (conn.kind === "sqlite") {
  process.stdout.write("Running SQLite migrations...\n");
  migrateSqlite(conn.db);
} else if (conn.kind === "pg") {
  process.stdout.write("Running PostgreSQL migrations...\n");
  migratePostgres(conn.db);
}

process.stdout.write("Migrations complete.\n");
