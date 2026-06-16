/**
 * Canonical E2E seed entry point for `@exam/db`.
 *
 * Composes baseline `seed()` + `seedDemo()` + `verifyDemoSeed()` so that
 * CI E2E and local Docker E2E share exactly one seed contract.
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
import { seed } from "./seed.js";
import { seedDemo } from "./demo-seed.js";
import { verifyDemoSeed } from "./demo-seed-verify.js";

dotenv.config({ quiet: true });

const isMain =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  let conn:
    | Awaited<ReturnType<typeof import("./database.js").createDatabase>>
    | undefined;
  try {
    const skipMigrate = process.argv.includes("--skip-migrate");

    const { createDatabase } = await import("./database.js");
    const { migratePostgres } = await import("./postgres.js");
    const { hashPassword } = await import("@exam/auth/src/password.js");

    conn = await createDatabase();

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
      throw new Error("Demo seed verification failed");
    }

    process.stdout.write(
      "\nDone! E2E seed credentials:\n" +
        "  Admin:      admin      / admin123\n" +
        "  Candidate:  candidate  / candidate123\n" +
        "  Demo:       candidate1 / candidate123 = in_progress/resume\n" +
        "  Demo:       candidate2 / candidate123 = available/start\n" +
        "  Demo:       candidate3 / candidate123 = resumable/resume\n" +
        "  Demo:       candidate4 / candidate123 = graded/view_result\n",
    );
  } catch (err) {
    process.stderr.write(`E2E seed failed: ${String(err)}\n`);
    process.exitCode = 1;
  } finally {
    await conn?.sql.end();
  }
}
