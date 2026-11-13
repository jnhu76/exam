/**
 * Transaction seam implementation (#964 W2): the plugin's
 * {@link TransactionSeam} for `@exam/db`'s SDK-independent observation seam
 * (packages/db/src/observation.ts).
 *
 * Span tree per executeInTransaction call (logical layer of the W2.1 A/B
 * decision — measurement point = the transaction boundary; statement spans
 * come from the driver seam and nest under these via async context):
 *
 *   db.transaction              (logical — the whole retry loop incl. backoff)
 *   ├─ [event] transaction.retry (one per classified 40001/40P01 retry)
 *   ├─ db.transaction.attempt   (attempt 0; children = its statement spans)
 *   ├─ db.transaction.attempt   (attempt 1 after a retry — same logical parent)
 *   └─ …
 *
 * Retries therefore surface BOTH as controlled events on the logical span
 * and as sibling attempt spans under the same logical parent, while the
 * original `transactionRetryLogger` stdout contract stays untouched
 * (#800 PR-B). Attempt count, backoff, isolation level, and commit/rollback
 * semantics remain owned by executeInTransaction — the wrappers here are
 * measurement-neutral by contract (forward value/error identity unchanged).
 *
 * Containment (ADR-028 D1): every telemetry-only step is guarded — a tracer
 * that throws, a failing attribute write, or a broken event can never replace
 * the wrapped executor's result or error, and retry events never throw into
 * the retry loop.
 */
import {
  context,
  SpanKind,
  SpanStatusCode,
  trace,
  type Span,
  type Tracer,
} from "@opentelemetry/api";
import type {
  TransactionAttemptContext,
  TransactionRetryObservation,
  TransactionSeam,
} from "@exam/db/observation";
import { findPostgresSqlState } from "@exam/db/types";
import {
  ATTR_DB_SYSTEM,
  ATTR_DB_RESPONSE_STATUS_CODE,
  ATTR_RETRY_FAILED_ATTEMPT,
  ATTR_TX_ATTEMPT,
  ATTR_TX_ISOLATION_LEVEL,
  DB_SYSTEM_POSTGRESQL,
  EVENT_TRANSACTION_RETRY,
  INSTRUMENTATION_SCOPE,
  SPAN_TRANSACTION,
  SPAN_TRANSACTION_ATTEMPT,
  SQLSTATE_UNCLASSIFIED,
} from "./vocabulary.js";

/**
 * Marks a span as errored WITHOUT a status message: SQLSTATE goes to the
 * structured attribute (fixed `UNCLASSIFIED` category when the cause chain
 * carries none), never the free-form field (W2.1 §5 constraint 5 —
 * `DrizzleQueryError.message/.query/.params` carry raw SQL + params and are
 * banned from spans; `findPostgresSqlState` reads only `code` fields along
 * the cause chain).
 */
export function markSpanError(span: Span, err: unknown): void {
  const sqlstate = findPostgresSqlState(err);
  span.setAttribute(
    ATTR_DB_RESPONSE_STATUS_CODE,
    sqlstate ?? SQLSTATE_UNCLASSIFIED,
  );
  span.setStatus({ code: SpanStatusCode.ERROR });
}

/** Null-object span for the degraded-tracer path (every operation no-ops). */
function noopSpan(): Span {
  const self: Span = {
    setAttribute: () => self,
    setAttributes: () => self,
    addEvent: () => self,
    setStatus: () => self,
    updateName: () => self,
    end: () => undefined,
    isRecording: () => false,
    recordException: () => undefined,
    addLink: () => self,
    addLinks: () => self,
    spanContext: () => ({
      traceId: "0".repeat(32),
      spanId: "0".repeat(16),
      traceFlags: 0,
      isRemote: false,
    }),
  };
  return self;
}

/** Opens a CLIENT span in the current context and runs `exec` inside it. */
function withSpan<T>(
  tracer: Tracer,
  name: string,
  attributes: Record<string, string | number>,
  exec: (span: Span) => Promise<T>,
): Promise<T> {
  let span: Span;
  let opened = false;
  try {
    span = tracer.startSpan(name, { kind: SpanKind.CLIENT, attributes });
    opened = true;
  } catch {
    // No usable tracer (telemetry degraded): run the executor unobserved.
    span = noopSpan();
  }
  const finish = (): void => {
    if (!opened) return;
    try {
      span.end();
    } catch {
      // Contained: ending a broken span never masks the executor's outcome.
    }
  };
  const observed: Promise<T> = opened
    ? context.with(trace.setSpan(context.active(), span), () => exec(span))
    : exec(span);
  return observed.finally(finish);
}

export class DbTransactionSeam implements TransactionSeam {
  constructor(private readonly tracer: Tracer) {}

  logical<T>(exec: () => Promise<T>): Promise<T> {
    return withSpan(
      this.tracer,
      SPAN_TRANSACTION,
      { [ATTR_DB_SYSTEM]: DB_SYSTEM_POSTGRESQL },
      async (span) => {
        try {
          return await exec();
        } catch (err) {
          // The logical transaction FAILED (non-retryable error or retries
          // exhausted → rolled back). Retried-to-success transactions stay
          // UNSET: the failed attempts carry their own ERROR spans.
          try {
            markSpanError(span, err);
          } catch {
            // Contained: a broken attribute write never replaces the error.
          }
          throw err;
        }
      },
    );
  }

  attempt<T>(
    txContext: TransactionAttemptContext,
    exec: () => Promise<T>,
  ): Promise<T> {
    return withSpan(
      this.tracer,
      SPAN_TRANSACTION_ATTEMPT,
      {
        [ATTR_DB_SYSTEM]: DB_SYSTEM_POSTGRESQL,
        [ATTR_TX_ATTEMPT]: txContext.attempt,
        [ATTR_TX_ISOLATION_LEVEL]: txContext.isolationLevel,
      },
      async (span) => {
        try {
          return await exec();
        } catch (err) {
          try {
            markSpanError(span, err);
          } catch {
            // Contained: a broken attribute write never replaces the error.
          }
          throw err;
        }
      },
    );
  }

  retry(observation: TransactionRetryObservation): void {
    try {
      // The retry loop runs inside the logical span's context (logical()
      // wraps it), so the ACTIVE span IS the same logical parent.
      const logicalSpan = trace.getSpan(context.active());
      logicalSpan?.addEvent(EVENT_TRANSACTION_RETRY, {
        [ATTR_RETRY_FAILED_ATTEMPT]: observation.failedAttempt,
        ...(observation.sqlstate === null
          ? {}
          : { [ATTR_DB_RESPONSE_STATUS_CODE]: observation.sqlstate }),
      });
    } catch {
      // Contained: a broken retry event never enters the retry loop.
    }
  }
}

/** Builds the transaction seam for the given (or the global) tracer. */
export function createTransactionSeam(tracer?: Tracer): TransactionSeam {
  return new DbTransactionSeam(
    tracer ?? trace.getTracer(INSTRUMENTATION_SCOPE),
  );
}
