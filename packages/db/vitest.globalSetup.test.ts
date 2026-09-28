import postgres from "postgres";
import { describe, expect, it } from "vitest";
import { resolveTestBranchUrl } from "./src/databaseUrl.js";
import { acquireDbPackageRunLease } from "./src/testInfraLock.js";
import { resolveDbIsolationMode } from "./src/testScope.js";
import globalSetup from "./vitest.globalSetup.js";

/**
 * #648 P1-1 — run-lease gating in `packages/db/vitest.globalSetup.ts`.
 *
 * The package worker-slot run lease (`exam_test_db_worker_database_run`)
 * exists to exclude a second simultaneous @exam/db invocation from the SHARED
 * persistent slot databases. A `TEST_DB_ISOLATION=file-schema` invocation
 * owns no package worker slots (its ordinary tests run on per-file schemas),
 * so it must NOT take the lease — otherwise a supported no-CREATEDB
 * file-schema run would be rejected (or would reject others) for slots it
 * never touches.
 *
 * The proofs replay the REAL globalSetup against the live server and branch
 * on the enclosing invocation's mode, mirroring the compressed two-run
 * conflict pattern in `apps/api/vitest.globalSetup.test.ts`:
 *   - enclosing worker-database run already HOLDS the package lease — a
 *     worker-mode replay must reject immediately at the same seam;
 *   - enclosing file-schema run holds nothing — a worker-mode replay acquires
 *     (and releases) the lease, and a file-schema replay takes no lease at
 *     all while leaving the enclosing run's state untouched.
 */

const BASE_URL = resolveTestBranchUrl(process.env);

async function pgReachable(url: string): Promise<boolean> {
  const conn = postgres(url, { connect_timeout: 2 });
  try {
    await conn`SELECT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await conn.end();
  }
}

const PG_UP = await pgReachable(BASE_URL);
const PG_DESCRIBE = PG_UP ? describe : describe.skip;

function saveMode(): string | undefined {
  return process.env.TEST_DB_ISOLATION;
}

function restoreMode(orig: string | undefined): void {
  if (orig === undefined) {
    delete process.env.TEST_DB_ISOLATION;
  } else {
    process.env.TEST_DB_ISOLATION = orig;
  }
}

PG_DESCRIBE(
  "globalSetup — package run lease gated on TEST_DB_ISOLATION (#648 P1-1)",
  { timeout: 30_000 },
  () => {
    it(
      "file-schema invocation takes NO package run lease",
      { timeout: 30_000 },
      async () => {
        const enclosingWorkerMode =
          resolveDbIsolationMode(process.env) === "worker-database";
        const orig = saveMode();
        let teardown: (() => Promise<void>) | undefined;
        process.env.TEST_DB_ISOLATION = "file-schema";
        try {
          teardown = await globalSetup();
        } finally {
          restoreMode(orig);
        }
        expect(teardown).toBeUndefined();

        const url = resolveTestBranchUrl(process.env);
        if (enclosingWorkerMode) {
          // The enclosing run holds the package lease; a lease attempt by the
          // replay would have REJECTED against it, so returning cleanly
          // already proves no lease was taken. The enclosing lease must also
          // still be held (the replay neither took nor released it).
          await expect(
            acquireDbPackageRunLease(url, process.env),
          ).rejects.toThrow(/another @exam\/db test run is already active/);
        } else {
          // Nothing holds the lease: the file-schema replay left it FREE.
          const lease = await acquireDbPackageRunLease(url, process.env);
          await lease.release();
        }
      },
    );

    it(
      "worker-database invocation still acquires the package run lease",
      { timeout: 30_000 },
      async () => {
        const orig = saveMode();
        process.env.TEST_DB_ISOLATION = "worker-database";
        let teardown: (() => Promise<void>) | undefined;
        try {
          try {
            teardown = await globalSetup();
          } catch (err) {
            // Enclosing worker-database run already holds the lease — the
            // exact two-run conflict at the real globalSetup seam.
            expect(String(err)).toMatch(
              /another @exam\/db test run is already active/,
            );
            return;
          }
          // Enclosing run holds nothing (file-schema): our replay ACQUIRED
          // the lease — prove it via an immediately-rejected second acquire,
          // then release through the returned teardown.
          const url = resolveTestBranchUrl(process.env);
          const t0 = Date.now();
          await expect(
            acquireDbPackageRunLease(url, process.env),
          ).rejects.toThrow(/another @exam\/db test run is already active/);
          expect(Date.now() - t0).toBeLessThan(2_000);
          await teardown?.();
        } finally {
          restoreMode(orig);
        }
      },
    );
  },
);
