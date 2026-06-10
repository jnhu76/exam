import { createDatabase, migrateSqlite, migratePostgres } from "@exam/db";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  process.stdout.write("No DATABASE_URL set, skipping migration.\n");
  process.exit(0);
}

const conn = createDatabase(databaseUrl);

if (conn.kind === "sqlite") {
  process.stdout.write("Running SQLite migrations...\n");
  await migrateSqlite(conn.db);
} else if (conn.kind === "pg") {
  process.stdout.write("Running PostgreSQL migrations...\n");
  await migratePostgres(conn.db);
  await conn.sql.end();
}

process.stdout.write("Migrations complete.\n");
process.exit(0);
