import { createDatabase } from "@exam/db/src/database.js";
import { migratePostgres } from "@exam/db/src/postgres.js";
import { seedDemo } from "@exam/db/src/demo-seed.js";
import { verifyDemoSeed } from "@exam/db/src/demo-seed-verify.js";
import { hashPassword } from "@exam/auth/src/password.js";
import { loadRootEnv } from "./config/loadRootEnv.js";
import { getRuntimeConfig } from "./config/runtimeConfig.js";

loadRootEnv();

const { database } = getRuntimeConfig();
const conn = await createDatabase(database.url);

process.stdout.write("Running migrations...\n");
await migratePostgres(conn.db);

process.stdout.write("Re-seeding demo data for verification...\n");
const ids = await seedDemo(conn.db, hashPassword);

process.stdout.write("Running verification...\n");
const errors = await verifyDemoSeed(conn.db, ids);
if (errors.length > 0) {
  process.stderr.write(`\nVerification FAILED (${errors.length} errors):\n`);
  for (const e of errors) {
    process.stderr.write(`  FAIL: ${e}\n`);
  }
  await conn.sql.end();
  process.exit(1);
}

process.stdout.write("\nAll verifications passed.\n");
await conn.sql.end();
