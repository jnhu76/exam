import { describe, expect, it } from "vitest";
import { resolveParallelism } from "../vitest.parallelism.js";

/**
 * Config-contract tests for the @exam/api parallelism gate
 * (apps/api/vitest.parallelism.ts). These invariants used to live only in a
 * comment block inside vitest.config.ts; round-3 made them executable.
 */
function env(overrides: Record<string, string | undefined>) {
  const e: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(overrides)) {
    if (v !== undefined) e[k] = v;
  }
  return e as NodeJS.ProcessEnv;
}

describe("resolveParallelism — default serial", () => {
  it("returns serial when API_TEST_MAX_WORKERS is absent", () => {
    expect(resolveParallelism(env({}))).toEqual({ fileParallelism: false });
  });

  it("returns serial when API_TEST_MAX_WORKERS is empty/whitespace", () => {
    expect(resolveParallelism(env({ API_TEST_MAX_WORKERS: "  " }))).toEqual({
      fileParallelism: false,
    });
  });
});

describe("resolveParallelism — parallel opt-in", () => {
  it("enables parallel with maxWorkers=2 under worker-database mode", () => {
    expect(
      resolveParallelism(
        env({
          API_TEST_MAX_WORKERS: "2",
          TEST_DB_ISOLATION: "worker-database",
        }),
      ),
    ).toEqual({ fileParallelism: true, maxWorkers: 2 });
  });

  it("accepts maxWorkers=1 (single parallel worker)", () => {
    expect(
      resolveParallelism(
        env({
          API_TEST_MAX_WORKERS: "1",
          TEST_DB_ISOLATION: "worker-database",
        }),
      ),
    ).toEqual({ fileParallelism: true, maxWorkers: 1 });
  });

  it("rejects API_TEST_MAX_WORKERS without worker-database mode", () => {
    expect(() =>
      resolveParallelism(env({ API_TEST_MAX_WORKERS: "4" })),
    ).toThrow(/requires TEST_DB_ISOLATION=worker-database/);
    expect(() =>
      resolveParallelism(
        env({ API_TEST_MAX_WORKERS: "4", TEST_DB_ISOLATION: "file-schema" }),
      ),
    ).toThrow(/BUG-FLAKE-001/);
  });

  it("rejects non-integer / zero / negative maxWorkers (fail fast, no silent serial)", () => {
    for (const bad of ["abc", "0", "-1", "1.5"]) {
      expect(() =>
        resolveParallelism(
          env({
            API_TEST_MAX_WORKERS: bad,
            TEST_DB_ISOLATION: "worker-database",
          }),
        ),
      ).toThrow(/positive integer/);
    }
  });
});

describe("resolveParallelism — TEST_WORKER_ID × parallel guard (round-3)", () => {
  it("rejects an explicit TEST_WORKER_ID when maxWorkers > 1, before any test starts", () => {
    // Reason: resolveWorkerId gives TEST_WORKER_ID top precedence, so a fixed
    // id would collapse every concurrent slot onto ONE physical worker DB.
    expect(() =>
      resolveParallelism(
        env({
          API_TEST_MAX_WORKERS: "2",
          TEST_DB_ISOLATION: "worker-database",
          TEST_WORKER_ID: "1",
        }),
      ),
    ).toThrow(/TEST_WORKER_ID must not be set when API_TEST_MAX_WORKERS=2 > 1/);
  });

  it("keeps serial debugging supported: TEST_WORKER_ID + maxWorkers=1", () => {
    expect(
      resolveParallelism(
        env({
          API_TEST_MAX_WORKERS: "1",
          TEST_DB_ISOLATION: "worker-database",
          TEST_WORKER_ID: "1",
        }),
      ),
    ).toEqual({ fileParallelism: true, maxWorkers: 1 });
  });

  it("keeps the documented serial path: TEST_WORKER_ID without API_TEST_MAX_WORKERS", () => {
    expect(
      resolveParallelism(
        env({
          TEST_DB_ISOLATION: "worker-database",
          TEST_WORKER_ID: "1",
        }),
      ),
    ).toEqual({ fileParallelism: false });
  });

  it("treats an empty TEST_WORKER_ID as not set (testScope rejects empties separately)", () => {
    expect(() =>
      resolveParallelism(
        env({
          API_TEST_MAX_WORKERS: "4",
          TEST_DB_ISOLATION: "worker-database",
          TEST_WORKER_ID: "   ",
        }),
      ),
    ).not.toThrow();
  });
});
