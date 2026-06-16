/**
 * Canonical E2E seed runner for `@exam/api`.
 *
 * Identical contract to `pnpm --filter @exam/db db:seed:e2e`, but lives inside
 * `apps/api` so it is included in the Docker runtime image's `dist/` and can
 * be invoked from `docker-entrypoint.sh`.
 *
 * Workflow:
 *   1. Run baseline seed (admin / candidate / candidate2)
 *   2. Run demo seed (candidate1..4 + courses + exams + attempts)
 *   3. Verify demo seed structure (idempotent)
 *
 * Demo accounts produced:
 *   candidate1 / candidate123 = in_progress / resume
 *   candidate2 / candidate123 = available   / start
 *   candidate3 / candidate123 = resumable   / resume
 *   candidate4 / candidate123 = graded      / view_result
 */

import { createDatabase } from "@exam/db/src/database.js";
import { migratePostgres } from "@exam/db/src/postgres.js";
import { seed } from "@exam/db/src/seed.js";
import { seedDemo } from "@exam/db/src/demo-seed.js";
import { verifyDemoSeed } from "@exam/db/src/demo-seed-verify.js";
import { hashPassword } from "@exam/auth/src/password.js";
import { loadRootEnv } from "./config/loadRootEnv.js";
import { getRuntimeConfig } from "./config/runtimeConfig.js";

loadRootEnv();

const skipMigrate = process.argv.includes("--skip-migrate");

const { database } = getRuntimeConfig();
const conn = await createDatabase(database.url);

try {
  if (!skipMigrate) {
    process.stdout.write("Running migrations...\n");
    await migratePostgres(conn.db);
  } else {
    process.stdout.write("Skipping migrations (--skip-migrate)\n");
  }

  process.stdout.write("Running baseline seed...\n");
  await seed(conn.db, hashPassword);

  process.stdout.write("Running demo seed...\n");
  const ids = await seedDemo(conn.db, hashPassword);

  process.stdout.write("Verifying demo seed...\n");
  const errors = await verifyDemoSeed(conn.db, ids);
  if (errors.length > 0) {
    process.stderr.write(
      `\nDemo seed verification FAILED (${errors.length} errors):\n`,
    );
    for (const e of errors) {
      process.stderr.write(`  FAIL: ${e}\n`);
    }
    process.exitCode = 1;
  } else {
    process.stdout.write(
      "\nDone! E2E seed credentials:\n" +
        "  Admin:      admin      / admin123\n" +
        "  Candidate:  candidate  / candidate123\n" +
        "  Demo:       candidate1 / candidate123 = in_progress/resume\n" +
        "  Demo:       candidate2 / candidate123 = available/start\n" +
        "  Demo:       candidate3 / candidate123 = resumable/resume\n" +
        "  Demo:       candidate4 / candidate123 = graded/view_result\n",
    );
  }
} finally {
  await conn.sql.end();
}
