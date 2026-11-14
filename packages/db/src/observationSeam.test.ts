/**
 * Observation-seam contract of executeInTransaction (#964 W2, unit-level).
 *
 * The real-PostgreSQL telemetry behavior is owned by the plugin suite
 * (packages/otel-drizzle-postgresjs); this file owns the seam PLUMBING:
 * when a seam is registered the loop/attempts/retries are handed over in
 * the documented shape (logical once per call, attempt per try with the
 * 0-based index and isolation level, retry next to the #800 PR-B warn),
 * and values/errors pass through IDENTITY-unchanged. With no seam — the
 * default for every script and the pre-seam behavior of every existing
 * caller — nothing is observed and the retry semantics are the ones
 * transactionRetry.test.ts already pins.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getTransactionSeam,
  setTransactionSeam,
  type TransactionAttemptContext,
  type TransactionRetryObservation,
  type TransactionSeam,
} from "./observation.js";
import { executeInTransaction, setTransactionRetryLogger } from "./types.js";
import type { Database } from "./types.js";

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

interface Recording {
  logical: number;
  attempts: TransactionAttemptContext[];
  retries: TransactionRetryObservation[];
}

function recordingSeam(): { seam: TransactionSeam; rec: Recording } {
  const rec: Recording = { logical: 0, attempts: [], retries: [] };
  return {
    rec,
    seam: {
      logical: (exec) => {
        rec.logical += 1;
        return exec();
      },
      attempt: (context, exec) => {
        rec.attempts.push(context);
        return exec();
      },
      retry: (observation) => {
        rec.retries.push(observation);
      },
    },
  };
}

describe("executeInTransaction observation seam", () => {
  beforeEach(() => {
    expect(getTransactionSeam()).toBeNull();
    setTransactionRetryLogger(null);
  });

  afterEach(() => {
    setTransactionSeam(null);
    setTransactionRetryLogger(null);
  });

  it("hands the loop to logical once and each try to attempt with index + isolation", async () => {
    const { seam, rec } = recordingSeam();
    setTransactionSeam(seam);
    const db = fakeDb((call) => (call === 1 ? "40001" : null));

    const result = await executeInTransaction(
      db,
      async () => "ok",
      "read committed",
    );

    expect(result).toBe("ok");
    expect(rec.logical).toBe(1);
    expect(rec.attempts.map((a) => [a.attempt, a.isolationLevel])).toEqual([
      [0, "read committed"],
      [1, "read committed"],
    ]);
    expect(rec.retries).toEqual([{ failedAttempt: 1, sqlstate: "40001" }]);
  });

  it("passes values and errors through identity-unchanged (success and rollback)", async () => {
    const { seam } = recordingSeam();
    setTransactionSeam(seam);

    const value = { marker: Symbol("w22") };
    const got = await executeInTransaction(
      fakeDb(() => null),
      async () => value,
    );
    expect(got).toBe(value);

    const sentinel = new Error("w22-sentinel");
    let caught: unknown;
    await executeInTransaction(
      fakeDb(() => null),
      async () => {
        throw sentinel;
      },
    ).catch((err: unknown) => {
      caught = err;
    });
    expect(caught).toBe(sentinel);
  });

  it("keeps the retry ceiling and backoff semantics with a seam registered", async () => {
    const { seam, rec } = recordingSeam();
    setTransactionSeam(seam);
    let calls = 0;
    const db = fakeDb(() => {
      calls += 1;
      return "40P01";
    });

    await expect(
      executeInTransaction(db, async () => "unreachable"),
    ).rejects.toThrowError("tx failed");

    // 1 initial attempt + MAX_RETRIES (3) retries — unchanged semantics.
    expect(calls).toBe(4);
    expect(rec.attempts.map((a) => a.attempt)).toEqual([0, 1, 2, 3]);
    expect(rec.retries.map((r) => [r.failedAttempt, r.sqlstate])).toEqual([
      [1, "40P01"],
      [2, "40P01"],
      [3, "40P01"],
    ]);
  });

  it("emits nothing and runs the seam-less path when no seam is registered", async () => {
    let calls = 0;
    const db = fakeDb((call) => {
      calls = call;
      return call === 1 ? "40001" : null;
    });
    const result = await executeInTransaction(db, async () => "ok");
    expect(result).toBe("ok");
    expect(calls).toBe(2);
    expect(getTransactionSeam()).toBeNull();
  });
});
