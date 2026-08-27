import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { acquireApiRunLease, requiresRunLease } from "./vitest.globalSetup.js";
import {
  dropDatabaseIfExists,
  ensureDatabaseExists,
  withDatabaseName,
} from "@exam/db/src/testWorkerDatabase.js";
import { resolveTestDbUrl } from "@exam/db/src/testDb.js";

/**
 * Round-4 run-lease wiring contract for `vitest.globalSetup.ts`.
 *
 * Two layers:
 *   - Pure gate tests: `requiresRunLease` mirrors the scope resolver's
 *     isolation-mode semantics (default worker-database) without resolving a
 *     worker identity — the full resolver correctly fails in this pre-worker
 *     process (VITEST=true without VITEST_POOL_ID, the round-3 fail-fast).
 *   - Two-run conflict regression through the EXACT seam globalSetup uses
 *     (`acquireApiRunLease`): run A holds the lease, run B's acquire must
 *     reject IMMEDIATELY (no bounded wait — the withdrawn per-slot lease
 *     polled 10s and would have recreated the timeout-coupling failure mode),
 *     and release must unblock the next run.
 *
 * The conflict proof targets a DISPOSABLE coordination database
 * (`TEST_ADMIN_DATABASE=exam_test_apirun_<rand>`): the OUTER vitest
 * invocation's real run lease lives on the real coordination DB and must
 * never be touched by this test.
 */

const BASE_URL = resolveTestDbUrl();
const ADMIN_URL = withDatabaseName(BASE_URL, "postgres");

describe("requiresRunLease — isolation-mode gate (pure)", () => {
  it("worker-database is the default: unset / empty / whitespace → lease required", () => {
    expect(requiresRunLease({})).toBe(true);
    expect(requiresRunLease({ TEST_DB_ISOLATION: "" })).toBe(true);
    expect(requiresRunLease({ TEST_DB_ISOLATION: "   " })).toBe(true);
  });

  it("explicit worker-database requires the lease", () => {
    expect(requiresRunLease({ TEST_DB_ISOLATION: "worker-database" })).toBe(
      true,
    );
  });

  it("file-schema skips the lease (legacy per-file-schema isolation owns no slot DBs)", () => {
    expect(requiresRunLease({ TEST_DB_ISOLATION: "file-schema" })).toBe(false);
  });

  it("invalid values skip the lease here; the scope resolver fail-fasts in the workers", () => {
    expect(requiresRunLease({ TEST_DB_ISOLATION: "garbage" })).toBe(false);
  });
});

describe(
  "acquireApiRunLease — two-run conflict (the exact globalSetup seam)",
  // Hang protection only: the lease is one try-lock round-trip; the disposable
  // coordination DB ensure/drop participate in the lifecycle queue.
  { timeout: 30_000 },
  () => {
    const coordDb = `exam_test_apirun_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
    const leaseEnv = () => ({
      ...process.env,
      TEST_ADMIN_DATABASE: coordDb,
    });

    afterAll(async () => {
      await dropDatabaseIfExists(ADMIN_URL, coordDb, { keepMissing: true })
        .then(() => {})
        .catch(() => {
          /* best-effort; disposable fixture */
        });
    }, 30_000);

    it("run B fails immediately while run A holds; release unblocks run B", async () => {
      await ensureDatabaseExists(ADMIN_URL, coordDb);
      const runA = await acquireApiRunLease(leaseEnv());

      const t0 = Date.now();
      await expect(acquireApiRunLease(leaseEnv())).rejects.toThrow(
        /another worker-database test run is already active/,
      );
      // Immediate conflict — one try-lock round-trip, NOT a bounded wait.
      expect(Date.now() - t0).toBeLessThan(2_000);

      await runA.release();
      const runB = await acquireApiRunLease(leaseEnv());
      await runB.release();
    });
  },
);
