/**
 * E2E seed runner for `@exam/api`.
 *
 * Thin adapter around `@exam/db/e2eSeedOrchestrator.runE2eSeed`. Invoked via
 * the package script `db:seed:e2e` (`tsx src/e2e-seed.ts`) — the single E2E
 * seed entry for host-local E2E (`scripts/e2e/run.sh`) and CI. The image
 * entrypoint never calls it: the RUN_SEED automatic-seed interface was
 * removed (#636).
 *
 * All orchestration logic (reset → migrate → seed → seedDemo → verify) is
 * delegated to the shared orchestrator. This file handles only env loading
 * and connection creation.
 *
 * Contract: this entrypoint CONVERGES the target database to the canonical
 * E2E baseline (`reset: true`). A database that survived a previous run —
 * the persistent serial `exam_e2e`, a failure-retained worker DB, or any
 * reuse — must not leak its leftover mutable state into the next run, so the
 * reseed truncates business tables first. The reset refuses databases
 * outside the e2e full-reset allowlist (see `e2eReset.ts`); running this
 * adapter against the dev `exam` database fails loudly instead of wiping it.
 *
 * Demo accounts produced:
 *   candidate1 / candidate123 = in_progress / resume
 *   candidate2 / candidate123 = available   / start
 *   candidate3 / candidate123 = resumable   / resume
 *   candidate4 / candidate123 = graded      / view_result
 */

import { createDatabase } from "@exam/db/src/database.js";
import { migratePostgres } from "@exam/db/src/postgres.js";
import {
  runE2eSeed,
  buildE2eSeedOutput,
} from "@exam/db/src/e2eSeedOrchestrator.js";
import { seedDemo } from "@exam/db/src/demo-seed.js";
import { hashPassword } from "@exam/auth/src/password.js";
import { createDemoSeedGrader } from "./demo-seed-grader.js";
import { loadRootEnv } from "./config/loadRootEnv.js";
import { getRuntimeConfig } from "./config/runtimeConfig.js";

loadRootEnv();

const skipMigrate = process.argv.includes("--skip-migrate");

const { database } = getRuntimeConfig();
const conn = await createDatabase(database.url);

try {
  const result = await runE2eSeed(conn.db, hashPassword, {
    skipMigrate,
    reset: true,
    migrateFn: async (db) => {
      await migratePostgres(db);
    },
    // Graded demo attempts are closed through the production submit+grade
    // composition (EXSEM-020) — injected via the workflow seam because the
    // orchestrator lives in @exam/db while the composition lives here.
    workflow: {
      seedDemoFn: (db, hashFn) =>
        seedDemo(db, hashFn, createDemoSeedGrader(db)),
    },
  });

  if (!result.ok) {
    process.stderr.write(
      `\nDemo seed verification FAILED (${result.errors.length} errors):\n`,
    );
    for (const e of result.errors) {
      process.stderr.write(`  FAIL: ${e}\n`);
    }
    process.exitCode = 1;
  } else {
    process.stdout.write(buildE2eSeedOutput());
  }
} finally {
  await conn.sql.end();
}
