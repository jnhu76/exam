/**
 * Test database bootstrap — the single ownership seam for "is the test
 * database there before the run starts?".
 *
 * Ownership contract (the ONE table that decides behavior):
 *
 *                       PostgreSQL server
 *                              |
 *                +-------------+-------------+
 *                |                           |
 *        explicit test URL           implicit local URL
 *   (TEST_DATABASE_URL / TEST_DB_URL)  (constructed from DB_HOST_PORT,
 *                |                       always `exam_test`)
 *        operator-owned DB              Exam-owned convenience DB
 *                |                           |
 *      MUST already exist             MAY self-provision
 *                |                           |
 *    verify + FAIL FAST if absent     ensure -> migrate -> test
 *
 * Rules:
 *   1. An explicit URL means database existence belongs to the environment /
 *      operator. The bootstrap NEVER issues CREATE DATABASE for it. External
 *      CI / shared databases may intentionally use a restricted role without
 *      CREATEDB — no privilege escalation, no fallback, fail fast instead.
 *   2. The implicit local URL is Exam's convenience target. The bootstrap
 *      ensures it exists (reusing the canonical `ensureDatabaseExists` +
 *      coordination-URL + advisory-lock primitives — no second DDL path).
 *   3. Never runs in production mode.
 *   4. Preserves the test DB name-safety guard (via `resolveTestBranchUrl`).
 *   5. Idempotent and memoized per resolved URL per process, so wiring it
 *      into a vitest globalSetup costs one catalog check per RUN, not per
 *      test file.
 *
 * Schema stays production-migration authority: this module only touches
 * database EXISTENCE. Migrations are run by the existing test-isolation /
 * worker-database helpers after this returns.
 *
 * TEST-ONLY module. Never imported by production code.
 */

import postgres from "postgres";
import {
  isExplicitTestDbUrl,
  parseAppMode,
  resolveTestBranchUrl,
} from "./databaseUrl.js";
import { resolveTestInfraCoordinationUrl } from "./testInfraLock.js";
import {
  ensureDatabaseExists,
  isDatabaseMissingError,
} from "./testWorkerDatabase.js";

/** Options for {@link prepareTestDatabase}. */
export interface PrepareTestDatabaseOptions {
  /**
   * Environment to read (defaults to `process.env`). Tests inject fixtures;
   * the vitest globalSetup files use the default.
   */
  env?: NodeJS.ProcessEnv;
  /**
   * Bypass the per-URL memo. Needed by tests that must exercise the DDL path
   * repeatedly (idempotency / concurrency) against the same URL.
   */
  bypassMemo?: boolean;
}

/** What {@link prepareTestDatabase} did (or found). Pure data; safe to log. */
export type TestDbBootstrapOutcome =
  | {
      /** The target is an operator-supplied URL and its database is present. */
      kind: "explicit-verified";
      databaseName: string;
      databaseUrl: string;
    }
  | {
      /** The target is the implicit local convenience DB; ensured present. */
      kind: "implicit-ensured";
      databaseName: string;
      databaseUrl: string;
    };

/** Extract the database name (path segment) from a PostgreSQL URL. */
function databaseNameOf(url: string): string {
  return new URL(url).pathname.replace(/^\//, "").split(/[/?]/)[0] ?? "";
}

/** Per-resolved-URL memo so a run-level bootstrap executes at most once. */
const _memoizedByUrl = new Map<string, Promise<TestDbBootstrapOutcome>>();

/** Connect directly to the target database and run a trivial query. */
async function probeTargetDatabase(databaseUrl: string): Promise<void> {
  const sql = postgres(databaseUrl, { max: 1, connect_timeout: 5 });
  try {
    await sql`SELECT 1`;
  } finally {
    await sql.end();
  }
}

/**
 * Make the resolved test database ready according to the ownership contract.
 *
 * - production mode → throws (test-only helper, never auto-creates there);
 * - explicit URL    → verifies the database is connectable; if missing,
 *   throws a clear fail-fast error (no CREATE, no fallback);
 * - implicit local  → `ensureDatabaseExists` on the coordination URL
 *   (idempotent, advisory-locked, identifier-validated).
 *
 * The name-safety guard from `resolveTestBranchUrl` applies to both branches,
 * so an unsafe test database name fails here exactly as it fails in the test
 * bodies.
 *
 * @throws on production mode, unsafe names, unreachable server (connection
 *   error from the probe), or an explicit URL whose database is missing.
 */
export async function prepareTestDatabase(
  options?: PrepareTestDatabaseOptions,
): Promise<TestDbBootstrapOutcome> {
  const env = options?.env ?? process.env;

  if (parseAppMode(env) === "production") {
    throw new Error(
      "[prepareTestDatabase] refusing to run in production mode " +
        "(APP_MODE=production or NODE_ENV=production). " +
        "The test database bootstrap is test-only.",
    );
  }

  // Applies the test name-safety guard and constructs the implicit local URL.
  const databaseUrl = resolveTestBranchUrl(env);
  const databaseName = databaseNameOf(databaseUrl);

  const run = async (): Promise<TestDbBootstrapOutcome> => {
    if (isExplicitTestDbUrl(env)) {
      try {
        await probeTargetDatabase(databaseUrl);
      } catch (err) {
        if (isDatabaseMissingError(err)) {
          throw new Error(
            `[prepareTestDatabase] explicit test URL targets database ` +
              `"${databaseName}" which does not exist on ` +
              `${new URL(databaseUrl).host}.\n` +
              `  An explicit TEST_DATABASE_URL / TEST_DB_URL is operator-owned: ` +
              `the harness will not create it, migrate it, or fall back to ` +
              `another database.\n` +
              `  Fix: create the database on that server, or unset ` +
              `TEST_DATABASE_URL / TEST_DB_URL to use the implicit local ` +
              `exam_test (auto-provisioned on DB_HOST_PORT).`,
          );
        }
        throw err;
      }
      return { kind: "explicit-verified", databaseName, databaseUrl };
    }

    // Implicit local convenience target: Exam owns existence. Reuse the ONE
    // canonical ensure path (identifier validation + advisory lock + catalog
    // check) — no second CREATE DATABASE implementation.
    const adminUrl = resolveTestInfraCoordinationUrl(databaseUrl, env);
    await ensureDatabaseExists(adminUrl, databaseName);
    return { kind: "implicit-ensured", databaseName, databaseUrl };
  };

  if (options?.bypassMemo) return run();
  let cached = _memoizedByUrl.get(databaseUrl);
  if (cached === undefined) {
    // Evict on rejection so a transient failure is retried on the next call
    // instead of replaying the cached error for the rest of the process.
    cached = run().catch((err: unknown) => {
      _memoizedByUrl.delete(databaseUrl);
      throw err;
    });
    _memoizedByUrl.set(databaseUrl, cached);
  }
  return cached;
}

/** Test hook: forget memoized outcomes (used to re-exercise DDL paths). */
export function __resetTestDbBootstrapMemoForTests(): void {
  _memoizedByUrl.clear();
}
