import { createDatabase } from "@exam/db/src/database.js";
import { migratePostgres } from "@exam/db/src/postgres.js";
import { seed } from "@exam/db/src/seed.js";
import { hashPassword } from "@exam/auth/src/password.js";
import { loadRootEnv } from "./config/loadRootEnv.js";
import { getRuntimeConfig } from "./config/runtimeConfig.js";

loadRootEnv();

const skipMigrate = process.argv.includes("--skip-migrate");

const { database } = getRuntimeConfig();
const conn = await createDatabase(database.url);

if (!skipMigrate) {
  process.stdout.write("Running migrations...\n");
  await migratePostgres(conn.db);
} else {
  process.stdout.write("Skipping migrations (--skip-migrate)\n");
}

process.stdout.write("Seeding database...\n");
await seed(conn.db, hashPassword);
process.stdout.write(
  "\nDone! Phase 1 dev/test seed credentials:\n" +
    "  Admin:      admin / admin123\n" +
    "  Candidate:  candidate / candidate123\n" +
    "  Candidate:  candidate2 / candidate123\n",
);

await conn.sql.end();
