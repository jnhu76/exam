/**
 * Parallelism contract for the @exam/api vitest run (extracted from
 * vitest.config.ts so the invariants are unit-testable).
 *
 * Rules (ADR-007 Phase 5A/5B + round-3 contract):
 *   1. Default is SERIAL (fileParallelism: false). Parallel is opt-in via a
 *      positive-integer `API_TEST_MAX_WORKERS` AND
 *      `TEST_DB_ISOLATION=worker-database` (per-worker PG databases).
 *   2. `API_TEST_MAX_WORKERS` set without worker-database mode → THROW
 *      (parallel against shared schema would reintroduce BUG-FLAKE-001).
 *   3. Non-numeric / ≤0 / non-integer `API_TEST_MAX_WORKERS` → THROW
 *      (fail fast instead of silently degrading to serial).
 *   4. `TEST_WORKER_ID` explicitly set together with maxWorkers > 1 → THROW
 *      BEFORE any test starts. resolveWorkerId() gives TEST_WORKER_ID the
 *      highest precedence; if it were fixed (e.g. "1") while files run in
 *      parallel, EVERY concurrent slot would resolve the same physical worker
 *      database (exam_test_w1) and destroy per-slot isolation. Serial
 *      debugging (maxWorkers absent or 1 + TEST_WORKER_ID) stays supported —
 *      that is the documented contract in vitest.config.ts.
 */
export interface ResolvedParallelism {
  fileParallelism: boolean;
  maxWorkers?: number;
}

/** Returns true when TEST_WORKER_ID is set to a non-empty value. */
function hasExplicitTestWorkerId(env: NodeJS.ProcessEnv): boolean {
  const raw = env.TEST_WORKER_ID;
  return raw !== undefined && raw.trim().length > 0;
}

export function resolveParallelism(
  env: NodeJS.ProcessEnv,
): ResolvedParallelism {
  const dbIsolation = env.TEST_DB_ISOLATION?.trim();
  const rawMax = env.API_TEST_MAX_WORKERS?.trim();

  // No opt-in → legacy serial default.
  if (rawMax === undefined || rawMax === "") {
    return { fileParallelism: false };
  }
  // API_TEST_MAX_WORKERS is set. Require worker-database mode; reject otherwise
  // rather than silently running parallel against shared schema.
  if (dbIsolation !== "worker-database") {
    throw new Error(
      `[vitest.config] API_TEST_MAX_WORKERS=${rawMax} requires TEST_DB_ISOLATION=worker-database ` +
        `(got TEST_DB_ISOLATION=${JSON.stringify(dbIsolation)}). ` +
        `Parallel file-schema mode would reintroduce BUG-FLAKE-001. ` +
        `Unset API_TEST_MAX_WORKERS for serial, or set TEST_DB_ISOLATION=worker-database.`,
    );
  }
  const parsed = Number(rawMax);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(
      `[vitest.config] API_TEST_MAX_WORKERS must be a positive integer (got ${JSON.stringify(rawMax)}).`,
    );
  }
  // A fixed TEST_WORKER_ID under real parallelism collapses every concurrent
  // slot onto ONE physical worker database — the isolation contract must fail
  // before tests start, not corrupt state mid-run.
  if (parsed > 1 && hasExplicitTestWorkerId(env)) {
    throw new Error(
      `[vitest.config] TEST_WORKER_ID must not be set when API_TEST_MAX_WORKERS=${parsed} > 1: ` +
        `the explicit override wins over the runner-injected VITEST_POOL_ID slot id, so every concurrent ` +
        `slot would resolve the SAME physical worker database and destroy per-slot isolation. ` +
        `For serial debugging, unset API_TEST_MAX_WORKERS (or set it to 1) and keep TEST_WORKER_ID.`,
    );
  }
  return { fileParallelism: true, maxWorkers: parsed };
}
