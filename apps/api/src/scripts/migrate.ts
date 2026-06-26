import { createDatabase, migratePostgres } from "@exam/db";
import { loadRootEnv } from "../config/loadRootEnv.js";
import { resolveDatabaseUrlFromEnv } from "../config/runtimeConfig.js";

loadRootEnv();

// resolveDatabaseUrlFromEnv throws (RuntimeConfigError) when the required DB
// URL is missing for the resolved mode — no separate empty-check needed.
const databaseUrl = resolveDatabaseUrlFromEnv(process.env);
const conn = await createDatabase(databaseUrl);

process.stdout.write("Running PostgreSQL migrations...\n");
await migratePostgres(conn.db);
await conn.sql.end();

process.stdout.write("Migrations complete.\n");
process.exit(0);
