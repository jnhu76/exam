import { describe, expect, it } from "vitest";
import { acquireApiRunLease, requiresRunLease } from "./vitest.globalSetup.js";

/**
 * Round-4/5 run-lease wiring contract for `vitest.globalSetup.ts`.
 *
 * Three layers:
 *   - Pure gate tests: `requiresRunLease` mirrors the scope resolver's
 *     isolation-mode semantics (default worker-database) without resolving a
 *     worker identity — the full resolver correctly fails in this pre-worker
 *     process (VITEST=true without VITEST_POOL_ID, the round-3 fail-fast).
 *   - Narrowed-contract regression (round-5): TEST_ADMIN_DATABASE is NOT an
 *     isolation namespace for the run lease. The slot databases the lease
 *     protects are named on the server (VITEST_POOL_ID), so an alien
 *     coordination database would hand out independent leases to two runs
 *     that then collide in the SAME slot databases. Alien values now fail
 *     fast at the exact seam globalSetup uses, deterministically (validation
 *     fires before any connection is opened).
 *   - Two-run conflict, compressed: in worker-database mode the ENCLOSING
 *     vitest invocation already holds the real run lease (its own
 *     globalSetup acquired it on the canonical postgres database and keeps it
 *     until teardown). A second acquire through the same seam IS "run B" — it
 *     must reject IMMEDIATELY (no bounded wait). The round-4 version
 *     redirected both acquires onto a disposable TEST_ADMIN_DATABASE
 *     coordination DB; that redirection was exactly the scope hole round-5
 *     closed, so the regression now asserts against the REAL held lease.
 */

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

describe("acquireApiRunLease — lease scope (the exact globalSetup seam)", () => {
  it("TEST_ADMIN_DATABASE is not an isolation namespace: alien values fail fast (round-5)", async () => {
    await expect(
      acquireApiRunLease({ ...process.env, TEST_ADMIN_DATABASE: "coord_a" }),
    ).rejects.toThrow(/TEST_ADMIN_DATABASE must be unset or "postgres"/);
  });

  it(
    "run B rejects immediately: the enclosing run already holds the real lease",
    { timeout: 30_000 },
    async () => {
      if (!requiresRunLease(process.env)) {
        // file-schema environments hold no lease — prove the happy path
        // (acquire + immediate release on the canonical host) instead.
        const lease = await acquireApiRunLease(process.env);
        await lease.release();
        return;
      }
      const t0 = Date.now();
      await expect(acquireApiRunLease(process.env)).rejects.toThrow(
        /another worker-database test run is already active/,
      );
      // Immediate conflict — one try-lock round-trip, NOT a bounded wait.
      expect(Date.now() - t0).toBeLessThan(2_000);
    },
  );
});
