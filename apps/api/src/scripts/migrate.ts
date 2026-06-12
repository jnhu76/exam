import { createDatabase, migratePostgres } from "@exam/db";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  process.stdout.write("No DATABASE_URL set, skipping migration.\n");
  process.exit(0);
}

const conn = await createDatabase(databaseUrl);

process.stdout.write("Running PostgreSQL migrations...\n");
await migratePostgres(conn.db);
await conn.sql.end();

process.stdout.write("Migrations complete.\n");
process.exit(0);
