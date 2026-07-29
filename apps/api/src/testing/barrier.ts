/**
 * REC-I4-V1 — Deterministic concurrency barrier primitive.
 *
 * A `Deferred` is a one-shot promise that can be resolved or rejected from
 * outside the promise constructor. Useful for coordinating concurrent test
 * transactions: one execution context signals that it has reached a known
 * point, and another context decides when to release it.
 *
 * Every barrier carries a timeout so that stuck tests fail with a clear
 * message rather than hanging indefinitely.
 */

export interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
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

  return {
    promise: promise.finally(() => clearTimeout(timer)),
    resolve: (value: T) => {
      clearTimeout(timer);
      originalResolve(value);
    },
    reject: (error: unknown) => {
      clearTimeout(timer);
      originalReject(error);
    },
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
  /** The operationId the transaction was looking for. */
  operationId: string;
  /** The attemptId the grant targets. */
  attemptId: string;
}

/**
 * Observation recorded when a transaction hits a unique violation on the
 * operationId constraint.
 */
export interface ViolationObservation {
  /** SQLSTATE (always "23505" for unique violation). */
  code: string;
  /** Exact constraint name from the PostgreSQL catalog. */
  constraint: string;
  /** PostgreSQL backend PID of the transaction. */
  pid: number;
}

/**
 * Observation recorded when a fresh recovery transaction begins.
 */
export interface RecoveryObservation {
  /** PostgreSQL backend PID (may be same as the original transaction). */
  pid: number;
}

/**
 * Observation recorded when a transaction commits successfully.
 */
export interface CommitObservation {
  /** PostgreSQL backend PID of the transaction. */
  pid: number;
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
 */
export interface RaceBarrier {
  /** Fired when T1's `findByOperationId` returns null. */
  t1ReadAbsent: Deferred<ReadAbsentObservation>;
  /** Fired when T2's `findByOperationId` returns null. */
  t2ReadAbsent: Deferred<ReadAbsentObservation>;
  /** Resolved by the controller to release T1 past the barrier. */
  releaseT1: Deferred<void>;
  /** Fired when T1's transaction has committed. */
  t1Committed: Deferred<CommitObservation>;
  /** Resolved by the controller to release T2 past the barrier. */
  releaseT2: Deferred<void>;
  /** Fired when T2's insert hits the unique constraint. */
  t2UniqueViolation: Deferred<ViolationObservation>;
  /** Fired when T2's recovery transaction begins. */
  t2RecoveryStarted: Deferred<RecoveryObservation>;
  /** Fired when T2's recovery transaction has completed. */
  t2RecoveryCompleted: Deferred<CommitObservation>;
}

/**
 * Creates a fresh {@link RaceBarrier} with all deferreds initialized.
 */
export function createRaceBarrier(): RaceBarrier {
  return {
    t1ReadAbsent: createDeferred<ReadAbsentObservation>("T1 read absent"),
    t2ReadAbsent: createDeferred<ReadAbsentObservation>("T2 read absent"),
    releaseT1: createDeferred<void>("release T1"),
    t1Committed: createDeferred<CommitObservation>("T1 committed"),
    releaseT2: createDeferred<void>("release T2"),
    t2UniqueViolation: createDeferred<ViolationObservation>(
      "T2 unique violation",
    ),
    t2RecoveryStarted: createDeferred<RecoveryObservation>(
      "T2 recovery started",
    ),
    t2RecoveryCompleted: createDeferred<CommitObservation>(
      "T2 recovery completed",
    ),
  };
}
