/**
 * SDK-independent observation seam for technical telemetry (#964 W2,
 * ADR-028 D3). This module is the ONLY surface a telemetry component needs
 * from the `@exam/db` package: plain TypeScript types plus a module-scoped
 * registration setter, shaped like {@link setTransactionRetryLogger} next
 * door. `@exam/db`
 * keeps zero knowledge of OpenTelemetry — the seam never imports it.
 *
 * MEASUREMENT-NEUTRALITY CONTRACT (the reason this seam exists at all): an
 * implementation of {@link TransactionSeam} wraps transaction execution to
 * observe it. The contract it MUST uphold, pinned by the plugin's real-PG
 * regression suite (packages/otel-drizzle-postgresjs):
 *
 * - `logical`/`attempt` forward the executor's fulfilled value and rejected
 *   error IDENTITY-unchanged (no swallowing, no wrapping, no reordering);
 * - neither method retries, re-times, or otherwise alters execution — the
 *   retry loop, backoff, isolation level, and commit semantics stay owned by
 *   {@link executeInTransaction} (types.ts);
 * - the seam never throws into the database path: telemetry-internal errors
 *   are contained by the implementation (ADR-028 D1 — telemetry failures
 *   never change business results).
 *
 * Wiring: the API process registers the seam once at telemetry init (On
 * mode) and clears it at telemetry shutdown. With no seam registered the
 * execution path is byte-for-byte the pre-seam behavior (asserted by the
 * existing packages/db suite, which runs seam-less).
 */

/** Inputs describing ONE `db.transaction` attempt inside the retry loop. */
export interface TransactionAttemptContext {
  /** 0-based attempt index; `0` is the first try (before any backoff). */
  readonly attempt: number;
  /** Isolation level the attempt runs under (drives the real 40001/40P01 mix). */
  readonly isolationLevel: "read committed" | "repeatable read";
}

/**
 * A retry the wrapper classified as transient (40001/40P01) and is about to
 * schedule. Emitted ONCE per actual retry, alongside the existing
 * `transactionRetryLogger` warn (which keeps its stdout contract unchanged).
 */
export interface TransactionRetryObservation {
  /** 1-based number of the attempt that FAILED (the retry being announced). */
  readonly failedAttempt: number;
  /** The SQLSTATE that drove the retry, or null when classification found none. */
  readonly sqlstate: string | null;
}

/**
 * Observation seam around {@link executeInTransaction}. The two wrapper
 * methods nest: `logical` spans the WHOLE retry loop (all attempts plus
 * backoff), `attempt` spans ONE `db.transaction` execution inside it — so a
 * retry surfaces as sibling attempt wrappers under the same logical wrapper.
 */
export interface TransactionSeam {
  /**
   * Wraps one whole `executeInTransaction` call (every retry attempt of one
   * logical transaction). MUST return the executor's value / rethrow its
   * error unchanged.
   */
  logical<T>(exec: () => Promise<T>): Promise<T>;

  /**
   * Wraps ONE `db.transaction` attempt. MUST return the executor's value /
   * rethrow its error unchanged (rollback and retry classification happen
   * outside, in the wrapper).
   */
  attempt<T>(
    context: TransactionAttemptContext,
    exec: () => Promise<T>,
  ): Promise<T>;

  /**
   * Announces one classified retry. Called synchronously between attempts,
   * right after the structured retry warn (types.ts) of the same event.
   */
  retry(observation: TransactionRetryObservation): void;
}

// Module-scoped like transactionRetryLogger: one registration per process,
// no per-call plumbing. Silent (null) by default so scripts and tests keep
// the seam-less path.
let transactionSeam: TransactionSeam | null = null;

/**
 * Registers the process-wide transaction seam (or `null` to restore the
 * seam-less path). One writer per process: the API telemetry runtime at
 * init/shutdown.
 */
export function setTransactionSeam(seam: TransactionSeam | null): void {
  transactionSeam = seam;
}

/** The registered seam, or `null` when telemetry is Off (seam-less path). */
export function getTransactionSeam(): TransactionSeam | null {
  return transactionSeam;
}
