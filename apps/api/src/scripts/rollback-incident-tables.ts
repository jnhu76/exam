/**
 * Guarded, opt-in rollback of the five exam-incident tables (ADR-014 §14).
 *
 * The migration runner is forward-only: there is no automatic down migration.
 * This script is the executable, pre-activation guard wrapper. The core logic
 * (`rollbackIncidentTables`) lives in `@exam/db` so it can be unit-tested at
 * the db layer without a reverse package dependency. This entrypoint owns only
 * env resolution, the `--confirm` flag, and the database-name safety guard.
 *
 * It runs ONLY when invoked directly with `--confirm`, and ONLY when no
 * `attempt_time_adjustments.incident_id` is non-null. After the first non-null
 * incident correlation write, a destructive DROP is prohibited (it would leave
 * dangling correlation UUIDs with no referential guard); the script fails
 * closed and drops nothing.
 *
 * Invocation:
 *   pnpm db:rollback:incidents -- --confirm
 *
 * Never run by migrate, build, or test. All failure modes (missing env,
 * malformed URL, connection failure, guard trip, close failure) exit non-zero
 * with a clear stderr message; nothing is ever silently dropped.
 */

import { pathToFileURL } from "node:url";
import { createDatabase, rollbackIncidentTables } from "@exam/db";
import { loadRootEnv } from "../config/loadRootEnv.js";
import { resolveDatabaseUrlFromEnv } from "../config/runtimeConfig.js";

/**
 * Extracts the database name from a connection URL. Query params are
 * excluded, a trailing slash is handled, and the final non-empty pathname
 * segment is used (percent-decoded). Throws on a malformed URL.
 */
export function parseDatabaseName(databaseUrl: string): string {
  const parsed = new URL(databaseUrl);
  const lastSegment = parsed.pathname.split("/").filter(Boolean).at(-1) ?? "";
  try {
    return decodeURIComponent(lastSegment);
  } catch {
    // Malformed percent-encoding: fall back to the raw segment so the name
    // guard can still evaluate it.
    return lastSegment;
  }
}

/** Error message for the database-name safety guard. */
function refuseDbName(dbName: string): string {
  return (
    `Refusing to run against database "${dbName}": name must start with ` +
    "exam, or contain e2e/test/ci. Set DATABASE_URL to a guarded target."
  );
}

export async function main(): Promise<void> {
  loadRootEnv();

  const args = process.argv.slice(2);
  if (!args.includes("--confirm")) {
    process.stderr.write(
      "Refusing to run without an explicit --confirm flag.\n" +
        "This script drops the five exam-incident tables. It is opt-in and\n" +
        "never run by migrate, build, or test. Usage:\n" +
        "  pnpm db:rollback:incidents -- --confirm\n",
    );
    process.exitCode = 2;
    return;
  }

  let databaseUrl: string;
  try {
    databaseUrl = resolveDatabaseUrlFromEnv(process.env);
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    process.exitCode = 2;
    return;
  }

  // Database-name safety guard: refuse to target a DB whose name does not
  // contain a recognized signal. This prevents accidental runs against an
  // unknown production-shaped database. URL-based parsing (not string
  // splitting) so query params / trailing slashes cannot confuse the name.
  let dbName: string;
  try {
    dbName = parseDatabaseName(databaseUrl);
  } catch (err) {
    process.stderr.write(`Invalid DATABASE_URL: ${(err as Error).message}\n`);
    process.exitCode = 2;
    return;
  }
  if (!/^(exam|.*e2e|.*test|.*ci)/i.test(dbName)) {
    process.stderr.write(`${refuseDbName(dbName)}\n`);
    process.exitCode = 2;
    return;
  }

  process.stdout.write(`Guarded incident rollback against "${dbName}"...\n`);

  let conn: Awaited<ReturnType<typeof createDatabase>>;
  try {
    conn = await createDatabase(databaseUrl);
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n`);
    process.exitCode = 1;
    return;
  }

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
    try {
      await conn.sql.end();
    } catch (err) {
      process.stderr.write(
        `Failed to close the connection: ${(err as Error).message}\n`,
      );
      // On the success path exitCode is never set, so its default is
      // `undefined` (NOT 0). The loose `=== 0` guard therefore missed the
      // close-failure-after-success case and let the process exit 0, masking a
      // resource-close failure as success. Treat undefined as 0 here so a
      // close failure always surfaces as non-zero, while preserving any
      // already-set non-zero code from an earlier failure path.
      if (process.exitCode === undefined || process.exitCode === 0) {
        process.exitCode = 1;
      }
    }
  }
}

// Real direct-entry guard: run only when this module is the executed script,
// never when imported (e.g. by tests). Rejections are routed to the controlled
// error path (stderr + nonzero exit), so no unhandledRejection can escape.
const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  main().catch((err: unknown) => {
    process.stderr.write(
      `${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exitCode = 1;
  });
}
