/**
 * Guarded, opt-in rollback of the five exam-incident tables (ADR-014 §14).
 *
 * The migration runner is forward-only: there is no automatic down migration.
 * This script is the executable, pre-activation guard wrapper. The core logic
 * (`rollbackIncidentTables`) lives in `@exam/db` so it can be unit-tested at
 * the db layer without a reverse package dependency. This entrypoint owns only
 * env resolution, the `--confirm` flag, and the database-name safety guard.
 *
 * It runs ONLY when invoked explicitly with `--confirm`, and ONLY when no
 * `attempt_time_adjustments.incident_id` is non-null. After the first non-null
 * incident correlation write, a destructive DROP is prohibited (it would leave
 * dangling correlation UUIDs with no referential guard); the script fails
 * closed and drops nothing.
 *
 * Invocation:
 *   pnpm db:rollback:incidents -- --confirm
 *
 * Never run by migrate, build, or test.
 */

import { createDatabase, rollbackIncidentTables } from "@exam/db";
import { loadRootEnv } from "../config/loadRootEnv.js";
import { resolveDatabaseUrlFromEnv } from "../config/runtimeConfig.js";

async function main(): Promise<void> {
  loadRootEnv();

  const args = process.argv.slice(2);
  if (!args.includes("--confirm")) {
    process.stderr.write(
      "Refusing to run without an explicit --confirm flag.\n" +
        "This script drops the five exam-incident tables. It is opt-in and\n" +
        "never run by migrate, build, or test. Usage:\n" +
        "  pnpm db:rollback:incidents -- --confirm\n",
    );
    process.exit(2);
  }

  const databaseUrl = resolveDatabaseUrlFromEnv(process.env);

  // Database-name safety guard: refuse to target a DB whose name does not
  // contain a recognized signal. This prevents accidental runs against an
  // unknown production-shaped database.
  const dbName = databaseUrl.split("/").pop() ?? "";
  if (!/^(exam|.*e2e|.*test|.*ci)/i.test(dbName)) {
    process.stderr.write(
      `Refusing to run against database "${dbName}": name must start with ` +
        "exam, or contain e2e/test/ci. Set DATABASE_URL to a guarded target.\n",
    );
    process.exit(2);
  }

  process.stdout.write(`Guarded incident rollback against "${dbName}"...\n`);

  const conn = await createDatabase(databaseUrl);
  try {
    const result = await rollbackIncidentTables(conn.db);
    process.stdout.write(
      `Dropped incident tables ` +
        `(non-null incident_id count before: ${result.nonNullIncidentCount}).\n`,
    );
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    process.exitCode = 1;
  } finally {
    await conn.sql.end();
  }
}

// Run only when invoked directly as a script (not when imported).
void main();
