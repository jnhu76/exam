import { createDatabase } from "@exam/db/src/database.js";
import { migrateSqlite } from "@exam/db/src/sqlite.js";
import { seedDemo } from "@exam/db/src/demo-seed.js";
import { verifyDemoSeed } from "@exam/db/src/demo-seed-verify.js";
import { hashPassword } from "@exam/auth/src/password.js";

const databaseUrl = process.env.DATABASE_URL ?? "sqlite:./dev.db";
const conn = createDatabase(databaseUrl);
if (conn.kind !== "sqlite") {
  throw new Error("Demo seed verification only supports SQLite databases");
}
migrateSqlite(conn.db);

process.stdout.write("Re-seeding demo data for verification...\n");
const ids = await seedDemo(conn.db, hashPassword);

process.stdout.write("Running verification...\n");
const errors = verifyDemoSeed(conn.db, ids);
if (errors.length > 0) {
  process.stderr.write(`\nVerification FAILED (${errors.length} errors):\n`);
  for (const e of errors) {
    process.stderr.write(`  FAIL: ${e}\n`);
  }
  process.exit(1);
}

process.stdout.write("\nAll verifications passed.\n");
