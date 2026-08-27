/**
 * Vitest globalSetup: DB availability pre-check + run-level exclusion lease.
 *
 * WHY the pre-check: @exam/api's integration tests (39 files) all use
 * `buildTestApp` in `beforeAll`, which opens a real PostgreSQL connection. When
 * the test DB is unreachable (container stopped, wrong port, slow startup), the
 * FIRST test file's `beforeAll` throws `ECONNREFUSED`, but vitest continues
 * running the file's sibling `it` blocks (see vitest issues #1213 / #1459 —
 * historical behavior). Those siblings then cascade with a misleading
 * `TypeError: Cannot read properties of undefined (reading 'app'/'db')`
 * because `ctx` was never assigned. The result: 60+ files × dozens of tests
 * all "failing" with an error that hides the actual root cause.
 *
 * This globalSetup runs ONCE before any test file and fails fast with a clear
 * message if the test DB host/port is unreachable, so a down-DB surfaces as a
 * single clean abort instead of a 60-file cascade of misleading TypeErrors.
 *
 * WHY the run lease (round-4, 2026-08-27): concurrent local
 * worker-database runs on the same PostgreSQL server are NOT supported — both
 * invocations derive the SAME slot databases (exam_test_w1..wN) from
 * VITEST_POOL_ID, so each run's inter-file truncate boundary would wipe the
 * other run's fixtures mid-test. globalSetup is the right lifecycle layer for
 * that exclusion: it runs ONCE before any worker process exists, and its
 * teardown runs after ALL test files finish — so the lease covers the whole
 * invocation, not one worker's lifetime. A second invocation fails IMMEDIATELY
 * in its own globalSetup with a clear message (no retry loop, no bounded wait:
 * an internal poll here would recreate the exact timeout-coupling failure
 * mode this PR eliminates). CI never contends: every CI job owns its own
 * PostgreSQL service container. A crashed run releases the lease
 * automatically — the lease is a PG session lock, and the session dies with
 * the process.
 *
 * DESIGN CHOICES (pre-check):
 *  - Uses Node's built-in `net` module for a TCP connect probe. This avoids
 *    taking a driver dependency for the probe itself (the lease below uses the
 *    postgres driver owned by @exam/db) and avoids any Postgres-protocol
 *    coupling. We only need to answer "is something accepting connections on
 *    the DB port?" — a TCP handshake is the minimal, version-agnostic check.
 *    A Postgres server that accepts TCP but can't authenticate is still "up
 *    enough" that the tests will get a real, useful error from their own
 *    connection attempt (not the cascade).
 *  - Parses the DB URL with the SAME resolver the test code uses
 *    (resolveTestBranchUrl), so it probes the exact host/port tests will hit —
 *    never DATABASE_URL / the dev DB.
 *  - Retries with backoff (~5s total window). Today each buildTestApp opens its
 *    own connection with a fixed timeout and NO retry, so a slow-starting DB
 *    already flakes. A retrying pre-check waits for the DB to come up, then
 *    hands the tests a ready connection target — net flake risk is LOWER.
 *  - No connection is held open after the probe succeeds (the TCP socket is
 *    destroyed immediately; only the run lease outlives the probe).
 *  - No-op cost when turbo cache hits: `globalSetup` only runs when the `test`
 *    task actually executes. `pnpm verify` on a warm cache replays the cached
 *    result and never invokes this hook.
 *
 * E2E ISOLATION: this hook lives in apps/api's vitest config. E2E runs through
 * @playwright/test (apps/e2e/playwright.config.ts) + scripts/e2e/run-wsl.sh
 * against the dedicated `exam_e2e` database, and never imports this file.
 *
 * @see https://vitest.dev/config/globalsetup
 */
import { createConnection } from "node:net";
import { URL } from "node:url";
import { resolveTestBranchUrl } from "@exam/db/src/databaseUrl.js";
import { acquireTestInfraRunLease } from "@exam/db/src/testInfraLock.js";

const PROBE_TIMEOUT_MS = 2_000;
const RETRY_COUNT = 5;
const RETRY_DELAY_MS = 1_000;

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Returns true if a TCP connection to (host, port) succeeds within the timeout.
 * Resolves false on any connect error / timeout; never throws.
 */
function probeTcp(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.setTimeout(PROBE_TIMEOUT_MS);
    socket.on("error", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

/**
 * Whether this invocation runs in worker-database isolation and therefore
 * needs the run-level exclusion lease. Mirrors `resolveDbIsolation` in
 * `@exam/db/src/testScope.ts` (default `worker-database`; unset/empty = the
 * default) WITHOUT calling the full scope resolver: `resolveTestScope` also
 * resolves the worker identity, which correctly fails in this pre-worker
 * process (VITEST=true without VITEST_POOL_ID — the round-3 fail-fast). Only
 * the raw isolation mode is needed here.
 */
export function requiresRunLease(env: NodeJS.ProcessEnv): boolean {
  const raw = (env.TEST_DB_ISOLATION ?? "").trim();
  return (raw === "" ? "worker-database" : raw) === "worker-database";
}

/**
 * Acquire the run-level exclusion lease for this invocation against the test
 * DB server resolved from `env`. Exported (named) so the two-run conflict
 * regression can exercise the exact seam globalSetup uses.
 */
export async function acquireApiRunLease(env: NodeJS.ProcessEnv) {
  const baseUrl = resolveTestBranchUrl(env);
  return acquireTestInfraRunLease(baseUrl, env);
}

export default async function globalSetup(): Promise<
  (() => Promise<void>) | undefined
> {
  // Resolve the same URL the test code will use. If the URL itself is invalid
  // (missing, non-test name), resolveTestBranchUrl throws a precise error —
  // surface that directly rather than wrapping it.
  const url = resolveTestBranchUrl(process.env);
  const parsed = new URL(url);
  const host = parsed.hostname;
  const port = parsed.port ? Number(parsed.port) : 5432;

  for (let attempt = 1; attempt <= RETRY_COUNT; attempt += 1) {
    const ok = await probeTcp(host, port);
    if (ok) {
      // DB is reachable. In worker-database mode this invocation now claims
      // the server's run lease and holds it until teardown (all files done).
      // A concurrent invocation rejects here, immediately, before any worker
      // process or database state exists.
      if (!requiresRunLease(process.env)) return undefined;
      const lease = await acquireApiRunLease(process.env);
      return async () => {
        await lease.release();
      };
    }
    if (attempt < RETRY_COUNT) {
      await sleep(RETRY_DELAY_MS);
    }
  }

  // All retries exhausted. Throw a clear, actionable error that names the
  // remedy. vitest aborts the run immediately when globalSetup throws.
  throw new Error(
    `[vitest globalSetup] Test database is unreachable after ${RETRY_COUNT} attempts ` +
      `(~${(RETRY_COUNT * RETRY_DELAY_MS) / 1000}s window).\n` +
      `  Target: ${host}:${port} (from TEST_DATABASE_URL)\n` +
      `  Remedy: ensure the Postgres test container is up and healthy.\n` +
      `    pnpm db:up   # starts exam-db-1 (host port: DB_HOST_PORT, default 5432)`,
  );
}
