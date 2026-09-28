/**
 * Vitest globalSetup: test-database readiness for @exam/db.
 *
 * Applies the SAME ownership contract as apps/api's globalSetup via
 * `prepareTestDatabase` (@exam/db):
 *   - explicit TEST_DATABASE_URL → must already exist; a missing database
 *     fails fast with a clear error instead of cascading through the
 *     DB-backed test files;
 *   - implicit local target → `exam_test` is self-provisioned when missing
 *     (this is the path that makes a fresh `pnpm db:up` volume work for
 *     `pnpm test` with no initdb SQL).
 *
 * DIFFERENCE from apps/api: @exam/db's suite is mixed (pure resolver tests +
 * PG-integration tests). The PG-integration files self-skip via their
 * `PG_DESCRIBE` reachability guards when PostgreSQL is down, and that
 * contract must keep working — so an UNREACHABLE server is a soft skip here
 * (warning only), while a reachable server with a missing/misconfigured
 * target database is a hard fail-fast.
 *
 * PACKAGE-DB RUN LEASE (#648): once the server is reachable, this invocation
 * claims the package-db worker-slot namespace (`exam_test_db_w*`) for the
 * whole run by holding `acquireDbPackageRunLease` until the global teardown.
 * Ordinary @exam/db tests reuse those persistent slots (migrate once +
 * `resetPostgres()` per file), so a second simultaneous @exam/db run on the
 * same server would truncate this run's fixtures mid-file and is rejected
 * immediately in its own globalSetup. The lease is a DIFFERENT key from the
 * API run lease (`exam_test_worker_database_run`), which must stay untouched:
 * the API lease's contract tests run inside this package and would fail
 * against their own enclosing run if this globalSetup held the API identity.
 * A crashed run releases automatically — the lease is a PG session lock.
 *
 * No worker-DB sweep here: the package slot databases (exam_test_db_w1..wN,
 * N bounded by maxWorkers/VITEST_POOL_ID) persist across runs by design —
 * their reuse is the optimization. The worker-DB lifecycle tests create
 * uniquely-named, self-cleaned fixtures outside the slot namespace.
 *
 * @see https://vitest.dev/config/globalsetup
 */
import { createConnection } from "node:net";
import { URL } from "node:url";
import { resolveTestBranchUrl } from "./src/databaseUrl.js";
import { acquireDbPackageRunLease } from "./src/testInfraLock.js";
import { prepareTestDatabase } from "./src/testDbBootstrap.js";

const PROBE_TIMEOUT_MS = 2_000;
const RETRY_COUNT = 5;
const RETRY_DELAY_MS = 1_000;

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

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

export default async function globalSetup(): Promise<
  (() => Promise<void>) | undefined
> {
  // Invalid URL (unsafe test DB name) is a hard configuration error even
  // before any probing — surface it directly.
  const url = resolveTestBranchUrl(process.env);
  const parsed = new URL(url);
  const host = parsed.hostname;
  const port = parsed.port ? Number(parsed.port) : 5432;

  for (let attempt = 1; attempt <= RETRY_COUNT; attempt += 1) {
    if (await probeTcp(host, port)) {
      // Server is up: enforce the ownership contract (self-provision the
      // implicit local exam_test / fail fast on a missing explicit DB).
      await prepareTestDatabase();
      // Claim the package-db worker-slot namespace for this whole invocation
      // (released by the teardown after all test files finish). A concurrent
      // @exam/db run rejects here, immediately, before any worker exists.
      const lease = await acquireDbPackageRunLease(url, process.env);
      return async () => {
        await lease.release();
      };
    }
    if (attempt < RETRY_COUNT) await sleep(RETRY_DELAY_MS);
  }

  process.stdout.write(
    `[vitest globalSetup] WARN: test database server ${host}:${port} unreachable — ` +
      `continuing without bootstrap (PG-guarded suites self-skip; unguarded ` +
      `DB-dependent suites will fail with connection errors).\n`,
  );
}
