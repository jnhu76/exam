import { createDatabase } from "@exam/db/src/database.js";
import { migratePostgres } from "@exam/db/src/postgres.js";
import { seedDemo } from "@exam/db/src/demo-seed.js";
import { verifyDemoSeed } from "@exam/db/src/demo-seed-verify.js";
import { hashPassword } from "@exam/auth/src/password.js";
import { getRuntimeConfig } from "./config/runtimeConfig.js";

const { database } = getRuntimeConfig();
const conn = await createDatabase(database.url);

process.stdout.write("Running migrations...\n");
await migratePostgres(conn.db);

process.stdout.write("Seeding demo data...\n");
const ids = await seedDemo(conn.db, hashPassword);

process.stdout.write("\nVerifying demo data...\n");
const errors = await verifyDemoSeed(conn.db, ids);
if (errors.length > 0) {
  process.stderr.write(`\nVerification FAILED (${errors.length} errors):\n`);
  for (const e of errors) {
    process.stderr.write(`  FAIL: ${e}\n`);
  }
  await conn.sql.end();
  process.exit(1);
}

process.stdout.write("\nDone! Demo seed verified successfully.\n");
process.stdout.write("\nDemo accounts:\n");
process.stdout.write("  SuperAdmin:  superadmin / admin123\n");
process.stdout.write("  Admin:       admin      / admin123\n");
process.stdout.write("  Teacher:     teacher1   / teacher123\n");
process.stdout.write("  Teacher:     teacher2   / teacher123\n");
process.stdout.write(
  "  Candidate:   candidate1 / candidate123  (in-progress exam)\n",
);
process.stdout.write(
  "  Candidate:   candidate2 / candidate123  (start exam)\n",
);
process.stdout.write(
  "  Candidate:   candidate3 / candidate123  (disrupted/recovery)\n",
);
process.stdout.write(
  "  Candidate:   candidate4 / candidate123  (graded result)\n",
);

await conn.sql.end();
