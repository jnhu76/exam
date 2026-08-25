/**
 * Strict database-name safety guard for opt-in DESTRUCTIVE rollback scripts
 * (`rollbackAttemptCommandReceipts`, `rollbackIncidentTables`).
 *
 * The previous guard was a loose regex `/^(exam|.*e2e|.*test|.*ci)/i` that let
 * through names like `examproduction` (`^exam` matches any prefix) or
 * `incident_store` / `decision_db` (`.*ci` matches any name containing the
 * letter pair `ci`). After the guard, the script runs `DROP TABLE` / `DROP
 * INDEX`, so a false-accept is a data-loss bug, not a cosmetic one (review
 * J5-I1C0 PR #261 P1-1).
 *
 * This module replaces that regex with an EXACT allowlist of the names a
 * destructive rollback may legitimately target, per AGENTS.md "Local Database
 * Discipline": the canonical three databases (`exam`, `exam_test`, `exam_e2e`)
 * plus the vitest worker-schemas family `exam_test_w<N>` / `exam_e2e_w<N>` and
 * a CI naming pattern `exam_ci[_-]<suffix>`. Everything else is rejected,
 * including the look-alike counterexamples called out in the review:
 *
 *   - `examproduction`         → reject (not the dev db)
 *   - `precision_prod`         → reject (contains "ci" letters only by accident)
 *   - `incident_store`         → reject (contains "ci" letters only by accident)
 *   - `decision_db`            → reject (contains "ci" letters only by accident)
 *
 * The guard is INTENTIONALLY exact-match, not substring. Adding a new
 * destructive target means extending the allowlist here in one place; both
 * rollback CLI entrypoints import this single source of truth.
 *
 * Layering: this lives in `packages/db` so both `apps/api` rollback scripts can
 * import it without a reverse package dependency, and so the pure guard logic
 * is unit-testable at the db package level without spawning a subprocess.
 */

/**
 * Extract the database name (final non-empty path segment, percent-decoded)
 * from a PostgreSQL connection URL. Query params and trailing slashes are
 * excluded. Throws on a malformed URL and on malformed percent-encoding — a
 * name the guard cannot evaluate reliably must fail closed, never fall back to
 * a raw guess.
 */
export function parseDatabaseName(databaseUrl: string): string {
  const parsed = new URL(databaseUrl);
  const lastSegment = parsed.pathname.split("/").filter(Boolean).at(-1) ?? "";
  try {
    return decodeURIComponent(lastSegment);
  } catch {
    // Malformed percent-encoding: fail closed. A raw-segment fallback could
    // let an unparseable name slip past the database-name safety guard.
    throw new Error(
      `Malformed percent-encoding in DATABASE_URL path segment "${lastSegment}"`,
    );
  }
}

/**
 * Exact allowlist of database names a destructive rollback may target. A name
 * is accepted iff it equals one of the literal entries below OR matches one of
 * the documented patterns (vitest worker schema, CI branch). Substring match is
 * NOT used anywhere: a name like `examproduction` is rejected even though it
 * starts with `exam`.
 */
const LITERAL_ALLOWED = new Set<string>([
  // AGENTS.md "Local Database Discipline" — the canonical three databases.
  "exam",
  "exam_test",
  "exam_e2e",
]);

/**
 * Vitest worker-DB isolation creates `exam_test_w<N>` / `exam_e2e_w<N>` schemas
 * inside the test DB; some CI matrices mirror the same DB names. Allow exactly
 * that family: `exam_test_w12`, `exam_e2e_w0`, etc.
 */
const WORKER_DB_PATTERN = /^exam_(test|e2e)_w\d+$/;

/**
 * CI-branch DBs follow `exam_ci[_-]<suffix>` (e.g. `exam_ci_pr261`,
 * `exam_ci-shard4`). The prefix `exam_ci` is the recognized CI signal; the
 * suffix is free-form but required so a bare `exam_ci` is rejected unless it
 * appears in the literal allowlist (it does not — add it there if a flat
 * `exam_ci` is ever needed).
 */
const CI_DB_PATTERN = /^exam_ci[_-][A-Za-z0-9_-]+$/;

/**
 * True iff `dbName` is on the exact destructive-rollback allowlist. This is the
 * single source of truth shared by both rollback CLI scripts; do NOT inline a
 * regex in the entrypoints.
 */
export function isDestructiveRollbackTarget(dbName: string): boolean {
  if (LITERAL_ALLOWED.has(dbName)) return true;
  return WORKER_DB_PATTERN.test(dbName) || CI_DB_PATTERN.test(dbName);
}

/**
 * Build the refusal message for a rejected database name. Kept here so the two
 * entrypoints cannot drift in their operator-facing wording.
 */
export function refuseDbNameMessage(dbName: string): string {
  return (
    `Refusing to run against database "${dbName}": destructive rollback ` +
    "targets are limited to the canonical dev/test/e2e databases " +
    "(exam, exam_test, exam_e2e) and their vitest worker / CI variants " +
    "(exam_test_w<N>, exam_e2e_w<N>, exam_ci[_-]<suffix>). " +
    "Point DATABASE_URL at a guarded target."
  );
}

/**
 * Exact allowlist for FULL-RESET targets — operations that truncate EVERY
 * business table (the E2E seed's `reset` step, `resetE2eState`). Strictly
 * narrower than the rollback allowlist above, because a full reset destroys
 * all rows, not one incident family:
 *
 *   - `exam_e2e`                       — the canonical E2E database (serial
 *                                        path, CI, Docker e2e entrypoint).
 *   - `exam_e2e_w<N>`                  — the WSL parallel-shard worker DBs.
 *   - `exam_ci[_-]<suffix>`            — CI-branch E2E databases.
 *
 * Explicitly NOT full-reset targets: `exam` (human dev data), `exam_test` /
 * `exam_test_w<N>` (vitest territory — the E2E seed has no business wiping
 * them), and `exam_e2e_w<N>_prior` (failure-forensic archives retained by the
 * E2E runner; they are post-mortem artifacts, never execution state).
 */
const FULL_RESET_LITERALS = new Set<string>(["exam_e2e"]);

/** True iff `dbName` may be fully reset (all business tables truncated). */
export function isFullResetTarget(dbName: string): boolean {
  if (FULL_RESET_LITERALS.has(dbName)) return true;
  // Reuse the exact family patterns, restricted to the e2e/CI branches.
  return /^exam_e2e_w\d+$/.test(dbName) || CI_DB_PATTERN.test(dbName);
}

/** Refusal message for a rejected full-reset target. */
export function refuseFullResetMessage(dbName: string): string {
  return (
    `Refusing to reset database "${dbName}": full-reset targets are limited ` +
    "to the E2E databases (exam_e2e, exam_e2e_w<N>, exam_ci[_-]<suffix>). " +
    "The dev database (exam), the vitest databases (exam_test*), and E2E " +
    "forensic archives (exam_e2e_w<N>_prior) are never full-reset targets."
  );
}
