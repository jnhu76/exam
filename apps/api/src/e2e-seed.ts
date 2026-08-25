/**
 * E2E seed runner for `@exam/api`.
 *
 * Thin adapter around `@exam/db/e2eSeedOrchestrator.runE2eSeed`. Lives
 * inside `apps/api` so it is compiled into the Docker image's `dist/` and can
 * be invoked from `docker-entrypoint.sh`.
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
import { hashPassword } from "@exam/auth/src/password.js";
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
