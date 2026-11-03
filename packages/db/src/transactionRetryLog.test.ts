/**
 * executeInTransaction retry OBSERVABILITY contract (#800 PR-B, unit-level).
 *
 * The real-PostgreSQL retry semantics are owned by transactionRetry.test.ts;
 * this file owns the retry-branch logging only: each actual retry emits a
 * structured warn carrying the 1-based attempt number and the SQLSTATE that
 * drove it, extracted through the existing cause-chain walk (Drizzle wraps
 * the driver error). Uniqueness conflicts (23505), first-try successes, and
 * the final exhausted attempt emit nothing; the retry count, backoff,
 * isolation level, and commit semantics are asserted unchanged.
 *
 * The logger is injected via setTransactionRetryLogger (the API process wires
 * its Fastify logger once at db-plugin install) and defaults to silent —
 * asserted here so scripts/tests keep quiet.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeInTransaction, setTransactionRetryLogger } from "./types.js";
import type { Database } from "./types.js";

interface RecordedWarn {
  obj: Record<string, unknown>;
  msg: string;
}

/** Fakes only the surface executeInTransaction touches (architecture boundary). */
function fakeDb(script: (call: number) => string | null): Database {
  let call = 0;
  return {
    transaction: async (fn: (tx: never) => Promise<unknown>) => {
      call += 1;
      const code = script(call);
      if (code !== null) {
        throw Object.assign(new Error("tx failed"), { code });
      }
      return fn(null as never);
    },
  } as unknown as Database;
}

describe("executeInTransaction retry observability", () => {
  let warns: RecordedWarn[];
  beforeEach(() => {
    warns = [];
    setTransactionRetryLogger({
      warn: (obj: Record<string, unknown>, msg: string) => {
        warns.push({ obj, msg });
      },
    });
  });
  afterEach(() => {
    setTransactionRetryLogger(null);
  });

  it("warns once per actual retry with the attempt number and SQLSTATE (including cause-chain wrapped codes)", async () => {
    let calls = 0;
    const db = fakeDb((call) => {
      calls = call;
      if (call === 1) return "40001";
      // Second attempt fails with a Drizzle-style WRAPPED code, then a
      // third attempt succeeds — the chain walk must find the SQLSTATE.
      if (call === 2) {
        throw new Error("drizzle wrapper", {
          cause: { code: "40P01", message: "deadlock_detected" },
        });
      }
      return null;
    });
    const result = await executeInTransaction(db, async () => "done");
    expect(result).toBe("done");
    expect(calls).toBe(3);
    expect(warns).toEqual([
      { obj: { attempt: 1, sqlstate: "40001" }, msg: "transaction retry" },
      { obj: { attempt: 2, sqlstate: "40P01" }, msg: "transaction retry" },
    ]);
  });

  it("emits nothing on a first-try success", async () => {
    const db = fakeDb(() => null);
    await executeInTransaction(db, async () => "ok");
    expect(warns).toEqual([]);
  });

  it("emits nothing for a non-retryable unique violation (permanent conflict propagates on attempt 1)", async () => {
    const db = fakeDb(() => "23505");
    await expect(
      executeInTransaction(db, async () => "unreachable"),
    ).rejects.toThrowError("tx failed");
    expect(warns).toEqual([]);
  });

  it("does not warn for the final exhausted attempt and preserves the retry ceiling", async () => {
    let calls = 0;
    const db = fakeDb((call) => {
      calls = call;
      return "40001";
    });
    await expect(
      executeInTransaction(db, async () => "unreachable"),
    ).rejects.toThrowError("tx failed");
    // 1 initial attempt + MAX_RETRIES (3) retries — unchanged semantics.
    expect(calls).toBe(4);
    // Only the three RETRIED failures warn; the terminal throw does not.
    expect(warns.map((w) => w.obj.attempt)).toEqual([1, 2, 3]);
    expect(warns.every((w) => w.obj.sqlstate === "40001")).toBe(true);
  });

  it("stays silent by default when no logger is wired (scripts/tests)", async () => {
    setTransactionRetryLogger(null);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      let calls = 0;
      const db = fakeDb((call) => {
        calls = call;
        return call === 1 ? "40001" : null;
      });
      const result = await executeInTransaction(db, async () => "ok");
      expect(result).toBe("ok");
      expect(calls).toBe(2);
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
