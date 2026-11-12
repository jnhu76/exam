/**
 * Clock-sampling semantics of an executeInTransaction retry (R-01 evidence
 * for the /take temporal-sampling decision record).
 *
 * The wrapper re-executes the whole callback after a retryable failure
 * (40001/40P01 — the real-PostgreSQL owner for that contract is
 * transactionRetry.test.ts). Anything the callback reads inside its body is
 * therefore re-read per attempt — including a time authority sampled INSIDE
 * the callback. This test pins the compositional consequence with a scripted
 * clock: two transaction attempts → two clock samples.
 *
 * Route composition fact (static, apps/api/src/routes/attempts.candidate.ts
 * GET /candidate/attempts/:attemptId/take): the operation clock for lazy
 * deadline reconciliation is sampled inside the transaction callback, after
 * the EA lock — so a 40001/40P01 retry of one /take request re-samples the
 * reconciliation instant. Whether that is the normative semantic (vs.
 * capture-once-at-admission-time reused across retries, as start/save/
 * submit/restore do) is an OPEN product/ADR decision — recorded in the #961
 * fix PR; this test only pins the mechanism so the decision lands on
 * characterized ground.
 */
import { describe, expect, it } from "vitest";
import { executeInTransaction, type Database } from "./types.js";

/**
 * Builds a minimal fake transactional database whose transaction body simply
 * invokes the callback. Every invocation increments `transactionCalls`.
 */
function makeFakeDb(transactionCalls: { count: number }): Database {
  return {
    transaction: async (fn: (tx: unknown) => Promise<number>) => {
      transactionCalls.count++;
      // Drizzle passes an isolation-level option; the fake ignores it.
      return fn({});
    },
  } as unknown as Database;
}

describe("executeInTransaction re-samples in-callback clock reads on retry", () => {
  it("re-executes the callback after a synthetic 40001, so an in-callback time sample runs once per attempt", async () => {
    const transactionCalls = { count: 0 };
    const clockSamples: number[] = [];
    // Scripted time authority: a distinct instant per call, so a re-sample is
    // observable as a different value instead of an equal one.
    let clockCalls = 0;
    const scriptedNow = () => ++clockCalls;

    const result = await executeInTransaction(
      makeFakeDb(transactionCalls),
      async () => {
        clockSamples.push(scriptedNow());
        if (clockSamples.length === 1) {
          const err = new Error("serialization_failure") as Error & {
            code: string;
          };
          err.code = "40001";
          throw err;
        }
        return 42;
      },
    );

    expect(result).toBe(42);
    // Two transaction attempts, two callback executions, two clock samples —
    // with distinct instants (1 then 2), proving the retry re-sampled.
    expect(transactionCalls.count).toBe(2);
    expect(clockSamples).toEqual([1, 2]);
  });

  it("samples the clock exactly once for an operation whose single attempt succeeds", async () => {
    const transactionCalls = { count: 0 };
    const clockSamples: number[] = [];
    let clockCalls = 0;
    const scriptedNow = () => ++clockCalls;

    const result = await executeInTransaction(
      makeFakeDb(transactionCalls),
      async () => {
        clockSamples.push(scriptedNow());
        return 7;
      },
    );

    expect(result).toBe(7);
    expect(transactionCalls.count).toBe(1);
    expect(clockSamples).toEqual([1]);
  });
});
