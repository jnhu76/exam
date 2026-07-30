/**
 * REC-I4-V1 — Deterministic concurrency barrier primitive.
 *
 * A `Deferred` is a one-shot promise that can be resolved or rejected from
 * outside the promise constructor. Useful for coordinating concurrent test
 * transactions: one execution context signals that it has reached a known
 * point, and another context decides when to release it.
 *
 * Every barrier carries a timeout so that stuck tests fail with a clear
 * message rather than hanging indefinitely. A {@link RaceBarrier} additionally
 * exposes {@link RaceBarrier.dispose} so success, failure, and teardown paths
 * can settle every outstanding deferred and clear every timer — preventing the
 * "recovery throws IdempotencyConflictError, so the success deferred is never
 * awaited and times out 10s later" leak.
 */

/**
 * A one-shot promise with external resolve/reject. Created via
 * {@link createDeferred}; do not construct the inner shape directly.
 */
export interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
  /**
   * Returns true once this deferred has been resolved or rejected (settled).
   * Used by {@link RaceBarrier.dispose} to skip already-settled deferreds.
   */
  isSettled(): boolean;
}

/**
 * Creates a {@link Deferred} that rejects with a timeout error after
 * `timeoutMs` milliseconds if neither resolved nor rejected. The timeout
 * error message includes the `label` so a failing test can identify which
 * barrier point was stuck.
 */
export function createDeferred<T>(
  label: string,
  timeoutMs = 10_000,
): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  let settled = false;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  const timer = setTimeout(() => {
    const err = new Error(
      `Barrier timeout [${label}] after ${timeoutMs}ms — ` +
        "the expected signal was never received. This indicates a stuck " +
        "transaction or a missing barrier resolution.",
    );
    reject(err);
  }, timeoutMs);

  const originalResolve = resolve;
  const originalReject = reject;

  const markSettled = () => {
    settled = true;
    clearTimeout(timer);
  };

  return {
    promise: promise.finally(markSettled),
    resolve: (value: T) => {
      markSettled();
      originalResolve(value);
    },
    reject: (error: unknown) => {
      markSettled();
      originalReject(error);
    },
    isSettled: () => settled,
  };
}

/**
 * Observation recorded when a transaction reads the operation ledger and
 * finds no row for the target operationId.
 */
export interface ReadAbsentObservation {
  /** Human-readable label: "T1" or "T2". */
  label: string;
  /** PostgreSQL backend PID of the transaction. */
  pid: number;
  /** Transaction id captured inside the transaction callback. */
  txid: string;
  /** The operationId the transaction was looking for. */
  operationId: string;
  /** The attemptId the grant targets. */
  attemptId: string;
}

/**
 * Observation recorded when a transaction hits a unique violation on the
 * operationId constraint. The `code`/`constraint`/`table` come from the REAL
 * caught PostgreSQL error (extracted by the production matcher), not
 * re-hard-coded by the test.
 */
export interface ViolationObservation {
  /** SQLSTATE (always "23505" for unique violation). */
  code: string;
  /** Exact constraint name from the PostgreSQL error fields. */
  constraint: string;
  /** Optional table name surfaced by the driver. */
  table?: string;
  /** PostgreSQL backend PID of the PRIMARY transaction that violated. */
  pid: number;
  /** Transaction id of the PRIMARY transaction that violated. */
  txid: string;
}

/**
 * Observation recorded when a fresh recovery transaction begins. The txid is
 * captured inside the recovery transaction callback and MUST differ from the
 * primary transaction's txid (the deterministic test asserts this).
 */
export interface RecoveryObservation {
  /** PostgreSQL backend PID (may be same as the original transaction). */
  pid: number;
  /** Transaction id of the fresh recovery transaction. */
  txid: string;
}

/**
 * Observation recorded when a primary transaction commits successfully.
 */
export interface CommitObservation {
  /** PostgreSQL backend PID of the transaction. */
  pid: number;
  /** Transaction id captured inside the transaction callback. */
  txid: string;
  /** The resulting outcome. */
  outcome: string;
}

/**
 * Barrier for the deterministic cross-Attempt operationId race.
 *
 * Two transactions (T1 and T2) each read the operation ledger and find it
 * absent. The barrier holds them until the test controller decides the
 * ordering. The controller ensures T1 commits before T2's insert, so T2
 * deterministically hits the unique constraint and recovers.
 *
 * Note on naming: the recovery path throws `IdempotencyConflictError`, so the
 * "recovery completed" observation is named
 * {@link t2RecoveryRejectedWithConflict} — not `t2RecoveryCompleted` — because
 * "completed" implied success and left an unawaited deferred timing out.
 */
export interface RaceBarrier {
  /** Fired when T1's `findByOperationId` returns null. */
  t1ReadAbsent: Deferred<ReadAbsentObservation>;
  /** Fired when T2's `findByOperationId` returns null. */
  t2ReadAbsent: Deferred<ReadAbsentObservation>;
  /** Resolved by the controller to release T1 past the read-absent gate. */
  releaseT1: Deferred<void>;
  /** Fired when T1's primary transaction has committed. */
  t1PrimaryCommitted: Deferred<CommitObservation>;
  /** Resolved by the controller to release T2 past the read-absent gate. */
  releaseT2: Deferred<void>;
  /** Fired when T2's primary insert hits the unique constraint. */
  t2UniqueViolation: Deferred<ViolationObservation>;
  /** Fired when T2's recovery transaction begins. */
  t2RecoveryStarted: Deferred<RecoveryObservation>;
  /**
   * Fired when T2's recovery transaction resolves to
   * `IdempotencyConflictError`. Resolved by the test after it catches the
   * error (the production module cannot observe its own thrown error).
   */
  t2RecoveryRejectedWithConflict: Deferred<void>;
  /**
   * Settles every outstanding deferred and clears every timer. Call from the
   * test's `finally` (and on any early-return path) so a deferred that was
   * never awaited — e.g. when recovery throws instead of succeeding — cannot
   * time out 10s later and pollute the vitest worker.
   */
  dispose(reason?: string): void;
}

/**
 * Creates a fresh {@link RaceBarrier} with all deferreds initialized.
 */
export function createRaceBarrier(): RaceBarrier {
  const deferreds = {
    t1ReadAbsent: createDeferred<ReadAbsentObservation>("T1 read absent"),
    t2ReadAbsent: createDeferred<ReadAbsentObservation>("T2 read absent"),
    releaseT1: createDeferred<void>("release T1"),
    t1PrimaryCommitted: createDeferred<CommitObservation>("T1 committed"),
    releaseT2: createDeferred<void>("release T2"),
    t2UniqueViolation: createDeferred<ViolationObservation>(
      "T2 unique violation",
    ),
    t2RecoveryStarted: createDeferred<RecoveryObservation>(
      "T2 recovery started",
    ),
    t2RecoveryRejectedWithConflict: createDeferred<void>(
      "T2 recovery rejected with conflict",
    ),
  };

  return {
    ...deferreds,
    dispose(reason = "barrier disposed") {
      for (const d of Object.values(deferreds)) {
        if (!d.isSettled()) {
          // Resolve (not reject) so an unawaited promise can never surface a
          // timeout error into the worker. The test only awaits deferreds it
          // actually wants to assert on; disposing the rest is safe.
          d.resolve(reason as never);
        }
      }
    },
  };
}
