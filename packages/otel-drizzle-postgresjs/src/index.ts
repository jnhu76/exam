/**
 * @exam/otel-drizzle-postgresjs — the independent Drizzle/postgres.js DB
 * telemetry plugin (#964 W2, ADR-028 D3).
 *
 * What it owns (span/metric owners of the W2.1 A/B decision, option B):
 * - ONE span per ACTUALLY-SUBMITTED statement (`db.statement`), via the
 *   driver statement seam (driverStatementSeam.ts — Query.prototype
 *   thenable-consumption patch; the only feasible driver boundary per the
 *   W2.1 real-PG probe). The span opens at submission inside the consumer's
 *   async context (correct parenting) and closes at the statement's settle,
 *   so its duration is the settle window — the only one that contains lock
 *   waits (W2.1 §2.2/§2.5).
 * - Logical transaction spans + per-attempt spans + retry events
 *   (transactionSeam.ts) through `@exam/db`'s SDK-independent observation
 *   seam. Logical transactions are measured ONLY at the transaction
 *   boundary; the statement layer and the logical layer are distinct
 *   measurement points with no double counting (W2.1 §6).
 * - One histogram (`db.client.operation.duration`, seconds) per settled
 *   statement — the initial DB metric vocabulary W4 freezes.
 *
 * What it never emits: statement text, bind parameters, connection URLs,
 * credentials, business payload, error messages. Span status carries no
 * message; SQLSTATE travels as `db.response.status_code` read from the
 * error's cause chain via `@exam/db`'s authoritative walk.
 *
 * Lifecycle: ONE install per process — the first install captures the
 * pristine Query.prototype references (driverStatementSeam.ts) and starts
 * recording. `disable()` stops recording AND restores the pristine prototype
 * methods (the patch is removed, not merely inert); `enable()` re-applies
 * the captured wrappers and resumes recording; both directions are
 * idempotent and the cycle is repeatable (#974). The Off deployment never
 * imports this module (the API runtime loads it behind the telemetry-enabled
 * gate), so Off installs nothing at all.
 */
import {
  metrics,
  SpanKind,
  trace,
  type Meter,
  type Span,
  type Tracer,
} from "@opentelemetry/api";
import type { TransactionSeam } from "@exam/db/observation";
import { findPostgresSqlState } from "@exam/db/types";
import {
  applyStatementSeamPatch,
  installStatementSeam,
  restoreStatementSeamPatch,
  setStatementSeamObserver,
  type InstrumentedQuery,
} from "./driverStatementSeam.js";
import { createTransactionSeam, markSpanError } from "./transactionSeam.js";
import {
  ATTR_CONNECTION_ROLE,
  ATTR_DB_RESPONSE_STATUS_CODE,
  ATTR_DB_SYSTEM,
  ATTR_OUTCOME,
  DB_SYSTEM_POSTGRESQL,
  HISTOGRAM_STATEMENT_DURATION,
  INSTRUMENTATION_SCOPE,
  OUTCOME_ERROR,
  OUTCOME_SUCCESS,
  ROLE_ROOT,
  ROLE_TRANSACTION,
  SPAN_STATEMENT,
  SQLSTATE_UNCLASSIFIED,
  STATEMENT_DURATION_BUCKETS,
} from "./vocabulary.js";

/**
 * Structural view of a postgres.js `Sql` instance — the ONLY surface root
 * registration touches. Reaching the handler closure identity needs one
 * LAZY marker query (`sql.unsafe("select 1")` — created, never consumed,
 * dropped: creation is not submission, W2.1 §2.2), so a root registration
 * performs no network I/O and executes no statement.
 */
export interface RootSqlConnection {
  unsafe: (query: string) => unknown;
}

/** Raw counters of the statement seam — the benchmark's baseline evidence. */
export interface OtelDbTelemetryDiagnostics {
  /** Statements that reached their first thenable consumption. */
  submissions: number;
  /** Statements whose settle reaction fired. */
  settles: number;
  /** Settled statements classified as errors. */
  errors: number;
  /** Submission counter by connection role. */
  byRole: Record<string, number>;
  /** Distinct scoped handler closures seen (transaction sub-connections). */
  scopedClosures: number;
}

export interface OtelDbTelemetryHandle {
  /**
   * Registers a root pool so its statements are attributed `root` instead of
   * `transaction`. Safe to call once per created pool; the API db plugin
   * calls it right after `createDatabase`.
   */
  registerRootConnection(sql: RootSqlConnection): void;

  /** The seam implementation for `setTransactionSeam` (@exam/db/observation). */
  readonly transactionSeam: TransactionSeam;

  /**
   * Stops recording AND restores the pristine prototype methods (#974 — the
   * patch is removed, not merely inert; @exam/db seam output unchanged).
   * Idempotent.
   */
  disable(): void;

  /**
   * Resumes recording after {@link disable}: re-applies the prototype patch
   * and restores the observer. Idempotent.
   */
  enable(): void;

  /** Whether the observer is currently recording. */
  isEnabled(): boolean;

  /** Raw counters (never reset — the benchmark compares phase deltas). */
  diagnostics(): OtelDbTelemetryDiagnostics;
}

export interface OtelDbTelemetryOptions {
  /** Tracer override for tests; defaults to the global API provider. */
  tracer?: Tracer;
  /** Meter override for tests; defaults to the global API provider. */
  meter?: Meter;
}

let handle: OtelDbTelemetryHandle | null = null;

/** Whether this process has installed the plugin (one decision per process). */
export function isOtelDbTelemetryInstalled(): boolean {
  return handle !== null;
}

/**
 * Installs the plugin: captures the pristine driver prototype references
 * (one decision per process), installs the prototype patch, and builds the
 * transaction seam. Idempotent — a second call returns the SAME handle
 * (repeat-install must not double-patch or double-count; pinned by test).
 *
 * No OTel SDK registered? The global `trace.getTracer`/`metrics.getMeter`
 * return no-op proxies, so install stays safe in any process (the API
 * runtime only calls it behind the On gate anyway).
 */
export function installOtelDbTelemetry(
  options: OtelDbTelemetryOptions = {},
): OtelDbTelemetryHandle {
  if (handle) return handle;

  installStatementSeam();

  const tracer = options.tracer ?? trace.getTracer(INSTRUMENTATION_SCOPE);
  const meter = options.meter ?? metrics.getMeter(INSTRUMENTATION_SCOPE);
  const transactionSeam = createTransactionSeam(tracer);

  let durationHistogram: {
    record: (value: number, attrs: Record<string, string>) => void;
  } | null;
  try {
    const histogram = meter.createHistogram(HISTOGRAM_STATEMENT_DURATION, {
      description:
        "Duration of submitted postgres.js statements (submission → settle)",
      unit: "s",
      advice: { explicitBucketBoundaries: [...STATEMENT_DURATION_BUCKETS] },
    });
    durationHistogram = histogram;
  } catch {
    // A broken meter degrades to span-only observation (ADR-028 D1).
    durationHistogram = null;
  }

  // handler closure → role. Registered root pools are known; EVERY other
  // closure is a transaction sub-connection (`sql.begin` scope — the probe's
  // auto-tagged scoped-handler-N) or a reserved sub-connection.
  const rootClosures = new Set<unknown>();
  const scopedClosures = new Set<unknown>();
  const diagnostics: OtelDbTelemetryDiagnostics = {
    submissions: 0,
    settles: 0,
    errors: 0,
    byRole: {},
    scopedClosures: 0,
  };
  let recording = true;

  const recordStatementDuration = (
    role: string,
    outcome: string,
    sqlstate: string | null,
    durationSec: number,
  ): void => {
    if (!durationHistogram) return;
    durationHistogram.record(durationSec, {
      [ATTR_DB_SYSTEM]: DB_SYSTEM_POSTGRESQL,
      [ATTR_CONNECTION_ROLE]: role,
      [ATTR_OUTCOME]: outcome,
      ...(sqlstate === null
        ? {}
        : { [ATTR_DB_RESPONSE_STATUS_CODE]: sqlstate }),
    });
  };

  const observeStatement = (query: InstrumentedQuery): void => {
    diagnostics.submissions += 1;
    const isRoot = rootClosures.has(query.handler);
    const role = isRoot ? ROLE_ROOT : ROLE_TRANSACTION;
    if (!isRoot && !scopedClosures.has(query.handler)) {
      // First sight of this scoped closure (one per sql.begin scope).
      scopedClosures.add(query.handler);
      diagnostics.scopedClosures += 1;
    }
    diagnostics.byRole[role] = (diagnostics.byRole[role] ?? 0) + 1;

    const span = tracer.startSpan(SPAN_STATEMENT, {
      kind: SpanKind.CLIENT,
      attributes: {
        [ATTR_DB_SYSTEM]: DB_SYSTEM_POSTGRESQL,
        [ATTR_CONNECTION_ROLE]: role,
      },
    });
    const submittedAt = performance.now();

    // Settle watch: a native reaction multiplexed on the ALREADY-submitted
    // Query instance — attaching it never re-submits (the probe's
    // multi-consumer single-count proof, W2.1 §6) and never touches the
    // consumer's own reaction. The consumer keeps receiving the result or
    // error identity unchanged.
    // INVARIANT: both callbacks are fully contained — a throw here would
    // surface as an unhandled rejection of the derived native promise, and
    // the derived promise must settle quietly (no rethrow).
    Promise.prototype.then.call(
      query as unknown as Promise<unknown>,
      (result: unknown) => {
        try {
          diagnostics.settles += 1;
          const durationSec = (performance.now() - submittedAt) / 1000;
          span.setAttribute(ATTR_OUTCOME, OUTCOME_SUCCESS);
          recordStatementDuration(role, OUTCOME_SUCCESS, null, durationSec);
          span.end();
        } catch {
          // Contained — see INVARIANT above.
        }
        return result;
      },
      (err: unknown) => {
        try {
          diagnostics.settles += 1;
          diagnostics.errors += 1;
          const sqlstate = findPostgresSqlState(err);
          const durationSec = (performance.now() - submittedAt) / 1000;
          span.setAttribute(ATTR_OUTCOME, OUTCOME_ERROR);
          markSpanError(span, err);
          recordStatementDuration(
            role,
            OUTCOME_ERROR,
            sqlstate ?? SQLSTATE_UNCLASSIFIED,
            durationSec,
          );
          span.end();
        } catch {
          // Contained — see INVARIANT above.
        }
        // No rethrow: the derived promise of THIS reaction must settle
        // quietly; the consumer's own rejection path is untouched.
      },
    );
  };

  setStatementSeamObserver(observeStatement);

  handle = {
    registerRootConnection(sql: RootSqlConnection): void {
      // Lazy marker query: created, its handler closure read, DROPPED.
      // Never consumed → never submitted (W2.1 §2.2 / S3), so a root
      // registration executes nothing on the pool.
      const marker = sql.unsafe("select 1") as { handler: unknown };
      rootClosures.add(marker.handler);
    },
    transactionSeam,
    disable(): void {
      recording = false;
      setStatementSeamObserver(null);
      restoreStatementSeamPatch();
    },
    enable(): void {
      recording = true;
      applyStatementSeamPatch();
      setStatementSeamObserver(observeStatement);
    },
    isEnabled(): boolean {
      return recording;
    },
    diagnostics(): OtelDbTelemetryDiagnostics {
      return {
        submissions: diagnostics.submissions,
        settles: diagnostics.settles,
        errors: diagnostics.errors,
        byRole: { ...diagnostics.byRole },
        scopedClosures: diagnostics.scopedClosures,
      };
    },
  };

  return handle;
}
