/**
 * E2E seed entry point for `@exam/db`.
 *
 * Thin adapter around `e2eSeedOrchestrator.runE2eSeed`. Handles env
 * loading and database connection; delegates all orchestration to the
 * shared function.
 *
 * Demo accounts produced (passwords identical):
 *   candidate1 / candidate123 = in_progress / resume
 *   candidate2 / candidate123 = available   / start
 *   candidate3 / candidate123 = resumable   / resume
 *   candidate4 / candidate123 = graded      / view_result
 *
 * Idempotent: running this twice does not duplicate users/exams/attempts.
 *
 * Usage:
 *   pnpm --filter @exam/db db:seed:e2e
 *   pnpm --filter @exam/db db:seed:e2e -- --skip-migrate
 */

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { createDatabase } from "./database.js";
import { runE2eSeed, buildE2eSeedOutput } from "./e2eSeedOrchestrator.js";
import { hashPassword } from "@exam/auth/src/password.js";

dotenv.config({ quiet: true });

const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  let conn: Awaited<ReturnType<typeof createDatabase>> | undefined;
  try {
    const skipMigrate = process.argv.includes("--skip-migrate");

    conn = await createDatabase();

    const result = await runE2eSeed(conn.db, hashPassword, {
      skipMigrate,
      migrateFn: async (db) => {
        const { migratePostgres } = await import("./postgres.js");
        await migratePostgres(db as Parameters<typeof migratePostgres>[0]);
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
  } catch (err) {
    process.stderr.write(`E2E seed failed: ${String(err)}\n`);
    process.exitCode = 1;
  } finally {
    await conn?.sql.end();
  }
}
