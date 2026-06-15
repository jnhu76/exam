import { createDatabase, migratePostgres } from "@exam/db";
import { loadRootEnv } from "../config/loadRootEnv.js";
import { resolveDatabaseUrlFromEnv } from "../config/runtimeConfig.js";

loadRootEnv();

let databaseUrl: string;
try {
  databaseUrl = resolveDatabaseUrlFromEnv(process.env);
} catch (err) {
  process.stderr.write(`FATAL: ${(err as Error).message}\n`);
  process.exit(1);
}

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
