import { createDatabase, migratePostgres } from "@exam/db";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  process.stderr.write(
    "FATAL: DATABASE_URL is required for migrations. Set it in your environment or .env file.\n",
  );
  process.exit(1);
}

const conn = await createDatabase(databaseUrl);

process.stdout.write("Running PostgreSQL migrations...\n");
await migratePostgres(conn.db);
await conn.sql.end();

process.stdout.write("Migrations complete.\n");
process.exit(0);
