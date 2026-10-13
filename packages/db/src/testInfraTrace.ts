/**
 * Test-infra structured trace V2 (research #774 R3–R5).
 *
 * TEST-ONLY module. Never imported by production code.
 *
 * Opt-in observational tracing for the test-infra lifecycle advisory-lock
 * critical sections (`withTestInfraLifecycleLock` and the DDL helpers that
 * execute inside them). Enabled ONLY when `TEST_INFRA_TRACE=1`. When disabled
 * the module is inert: no extra SQL, no connection-option changes, no
 * AsyncLocalStorage, no scheduler samplers — the traced call sites take
 * byte-identical code paths to the pre-trace implementation.
 *
 * Identity model (the reason this module exists — R1/R2 left
 * EXAM_HOLDER_TO_DDL_IDENTITY unresolved):
 *   - `process_instance_id`  UUIDv4 fixed at module init; one Node process
 *     (vitest worker, globalSetup, or test body) is one trace identity even
 *     if the OS recycles the pid.
 *   - `operation_id`         UUIDv4 per lock critical-section flow (one
 *     bootstrap/precheck + acquire + critical section + release counts as
 *     ONE operation). Nested `withTestInfraLifecycleLock` under an ambient
 *     operation reuses the ambient operation_id (the bootstrap wrapper owns
 *     the whole flow).
 *   - `connection_role`      `lock` (holder session) | `ddl` | `precheck` |
 *     `mig` — one operation fans out to several PostgreSQL sessions; roles
 *     distinguish them.
 *   - Server-side correlation: when tracing is enabled every traced
 *     connection sets `application_name = "exi:<role>:<operation_id>"` at
 *     startup (postgres.js `connection` startup parameter). `pg_stat_activity`
 *     can therefore join a server backend to the operation WITHOUT pid
 *     adjacency, timestamp proximity, or SQL-text matching. The read-back
 *     (`identifyBackend`) is itself a trace-only statement whose result is
 *     recorded in `COORD_BACKEND_IDENTIFIED` / `DDL_CONNECTION_IDENTIFIED`
 *     events, so application_name propagation is verified per connection, not
 *     assumed.
 *
 * Clock domain: every event carries `monotonic_ns` (process-local
 * `process.hrtime.bigint()`, domain `NODE_MONOTONIC`) and `wall_time_utc`
 * (join hint ONLY — never a happens-before edge across processes).
 *
 * Event sink: NDJSON lines to `TEST_INFRA_TRACE_DIR/<per-process file>` when
 * set, else process.stderr. Tests can inject an in-memory sink via
 * `__setTraceSinkForTests`.
 *
 * Process-level scheduler observation (`EVENT_LOOP_SAMPLE`, opt-in with the
 * same master switch) uses Node-native `monitorEventLoopDelay` +
 * `performance.eventLoopUtilization()`. These are PROCESS-level observables:
 * they must never be read as evidence about a specific PostgreSQL backend.
 * GC windows are recorded only in the separate diagnostic mode
 * (`TEST_INFRA_TRACE_GC=1`).
 *
 * Non-goals:
 *   - No production-API tracing responsibility; production modules never
 *     import this file.
 *   - No driver monkey-patching: connections that cannot carry operation
 *     identity simply stay UNRESOLVED (the `missing` array records why).
 *   - No semantic change to lock/DDL behavior in either mode.
 */

import { randomUUID } from "node:crypto";
import { mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  monitorEventLoopDelay,
  performance,
  PerformanceObserver,
} from "node:perf_hooks";
import postgres from "postgres";

// ---------------------------------------------------------------------------
// Opt-in switch + identity
// ---------------------------------------------------------------------------

/** Master switch: tracing is enabled only when TEST_INFRA_TRACE is exactly "1". */
export function isTestInfraTraceEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.TEST_INFRA_TRACE === "1";
}

/** Whether the separate GC diagnostic mode is requested. */
export function isTraceGcDiagnosticEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.TEST_INFRA_TRACE_GC === "1";
}

/** Fixed-per-process identity: same pid across runs ≠ same process instance. */
export const PROCESS_INSTANCE_ID: string = randomUUID();

/** Run id: constant across all processes of one traced invocation. */
export function traceRunId(env: NodeJS.ProcessEnv = process.env): string {
  return (
    env.TEST_INFRA_TRACE_RUN_ID || `adhoc-${PROCESS_INSTANCE_ID.slice(0, 8)}`
  );
}

/** The ONE lifecycle lock key as decimal string (mirrors testInfraLock). */
export type ConnectionRole = "lock" | "ddl" | "precheck" | "mig";

export interface TraceOperation {
  operationId: string;
  /** Decimal string of the advisory-lock key this operation is bound to. */
  lockKey: string;
  /** First external stack frame at operation begin (diagnostic only). */
  caller: string;
  /** Monotonic ns at operation begin. */
  beginMonotonicNs: bigint;
}

// ---------------------------------------------------------------------------
// Event schema V2 + sink
// ---------------------------------------------------------------------------

export type TestInfraTraceEventType =
  | "LOCK_CALL_BEGIN"
  | "COORD_CONNECTION_CREATE"
  | "COORD_BACKEND_IDENTIFIED"
  | "LOCK_REQUEST_DISPATCHED"
  | "LOCK_GRANTED_ACK"
  | "CRITICAL_SECTION_ENTER"
  | "DDL_CONNECTION_IDENTIFIED"
  | "DDL_REQUEST_DISPATCHED"
  | "DDL_RESPONSE_RECEIVED"
  | "CRITICAL_SECTION_EXIT"
  | "UNLOCK_REQUEST_DISPATCHED"
  | "UNLOCK_ACK"
  | "POOL_END_BEGIN"
  | "POOL_END_COMPLETE"
  | "OPERATION_COMPLETED"
  | "OPERATION_FAILED"
  // Process-level observations (never PostgreSQL backend evidence):
  | "EVENT_LOOP_SAMPLE"
  | "NODE_GC_WINDOW";

export interface TestInfraTraceEvent {
  schema_version: 2;
  run_id: string;
  operation_id: string | null;
  process_instance_id: string;
  node_pid: number;
  event_seq: number;
  event_type: TestInfraTraceEventType;
  clock_domain: "NODE_MONOTONIC";
  monotonic_ns: string;
  wall_time_utc: string;
  pg_backend_pid: number | null;
  pg_backend_start: string | null;
  pg_database_oid: number | null;
  connection_role: ConnectionRole | null;
  lock_key: string | null;
  outcome: string | null;
  /** Names of fields unknown at emit time (identity-gap honesty contract). */
  missing: string[];
  // Extension fields (schema requires "at least" the fields above):
  caller?: string;
  sub_operation?: string;
  target?: string;
  duration_ms?: number;
  application_name?: string;
  connection_id?: string;
  eld_mean_ms?: number;
  eld_max_ms?: number;
  eld_p999_ms?: number;
  elu_active_share?: number;
  gc_duration_ms?: number;
  gc_kind?: string;
}

export interface TraceSink {
  (event: TestInfraTraceEvent): void;
}

let seq = 0;
let customSink: TraceSink | null = null;
let processTraceFile: string | null = null;
let processTraceDir: string | null = null;

/** Test seam: replace the process sink (never used outside unit tests). */
export function __setTraceSinkForTests(sink: TraceSink | null): void {
  customSink = sink;
}

function resolveTraceFile(dir: string): string {
  if (processTraceFile === null) {
    processTraceFile = join(
      dir,
      `trace-${PROCESS_INSTANCE_ID.slice(0, 8)}-pid${process.pid}.ndjson`,
    );
    mkdirSync(dir, { recursive: true });
  }
  return processTraceFile;
}

/**
 * Monotonic session counter inside one process. Two connections of the same
 * process are distinguished by connection_id even when their backends recycle
 * the same pid; the value has NO meaning across processes.
 */
let connectionCounter = 0;

export function monotonicNs(): bigint {
  return process.hrtime.bigint();
}

export function emit(
  eventType: TestInfraTraceEventType,
  op: TraceOperation | null,
  fields: Partial<TestInfraTraceEvent> & { missing?: string[] } = {},
): void {
  const enabled = isTestInfraTraceEnabled();
  if (!enabled) return;
  const { missing, ...rest } = fields;
  const event: TestInfraTraceEvent = {
    schema_version: 2,
    run_id: traceRunId(),
    operation_id: op ? op.operationId : null,
    process_instance_id: PROCESS_INSTANCE_ID,
    node_pid: process.pid,
    event_seq: seq++,
    event_type: eventType,
    clock_domain: "NODE_MONOTONIC",
    monotonic_ns: monotonicNs().toString(),
    wall_time_utc: new Date().toISOString(),
    pg_backend_pid: null,
    pg_backend_start: null,
    pg_database_oid: null,
    connection_role: null,
    lock_key: op ? op.lockKey : null,
    outcome: null,
    missing: missing ?? [],
    ...rest,
  };

  if (customSink !== null) {
    customSink(event);
    return;
  }
  const dir = process.env.TEST_INFRA_TRACE_DIR;
  const line = `${JSON.stringify(event)}\n`;
  if (dir) {
    appendFileSync(resolveTraceFile(dir), line);
  } else {
    process.stderr.write(line);
  }
}

// ---------------------------------------------------------------------------
// AsyncLocalStorage operation context
// ---------------------------------------------------------------------------

const operationStorage = new AsyncLocalStorage<TraceOperation>();

/**
 * Run `fn` with `op` as the ambient trace operation. DDL helpers executed
 * inside `fn` read the context to annotate their connections. When tracing is
 * disabled this is never called (the storage stays uninitialized).
 */
export function runWithTraceOperation<T>(
  op: TraceOperation,
  fn: () => Promise<T>,
): Promise<T> {
  return operationStorage.run(op, fn);
}

/** Ambient operation of the current async context, if any (tracing only). */
export function currentTraceOperation(): TraceOperation | null {
  return operationStorage.getStore() ?? null;
}

/** Create a fresh operation identity for one lock critical-section flow. */
export function beginLockOperation(
  caller: string,
  lockKey: string,
): TraceOperation {
  return {
    operationId: randomUUID(),
    lockKey,
    caller,
    beginMonotonicNs: monotonicNs(),
  };
}

// ---------------------------------------------------------------------------
// Connection identity: application_name encoding + backend read-back
// ---------------------------------------------------------------------------

/**
 * application_name is NAMEDATALEN-1 = 63 bytes server-side. Encoding
 * `exi:<role>:<uuid>` stays within the limit (prefix 5 + role ≤ 8 + 1 + 36).
 */
export function traceApplicationName(
  role: ConnectionRole,
  operationId: string,
): string {
  return `exi:${role}:${operationId}`;
}

/** Decode an application_name encoded by {@link traceApplicationName}. */
export function decodeTraceApplicationName(
  appName: string | null | undefined,
): { role: ConnectionRole; operationId: string } | null {
  if (!appName || !appName.startsWith("exi:")) return null;
  const rest = appName.slice(4);
  const sep = rest.indexOf(":");
  if (sep === -1) return null;
  const role = rest.slice(0, sep);
  const operationId = rest.slice(sep + 1);
  if (
    (role !== "lock" &&
      role !== "ddl" &&
      role !== "precheck" &&
      role !== "mig") ||
    operationId.length === 0
  ) {
    return null;
  }
  return { role: role as ConnectionRole, operationId };
}

/**
 * The ONLY sanctioned cross-process join key: (process_instance_id,
 * operation_id). Backend pids recycle, adjacent pids are coincidence, and
 * wall-time proximity is not a happens-before edge — analysis and oracles
 * must group events by this key and nothing else.
 */
export function traceIdentityKey(event: {
  process_instance_id: string;
  operation_id: string | null;
}): string {
  return `${event.process_instance_id}|${event.operation_id ?? "-"}`;
}

export interface BackendIdentity {
  pid: number;
  postmasterStart: string;
  databaseOid: number;
  applicationNameReadback: string | null;
}

/**
 * TRACE-ONLY statement: identify the backend behind `sql` and verify the
 * session's application_name as the SERVER sees it. Never called when
 * tracing is disabled.
 */
export async function identifyBackend(
  sql: postgres.Sql,
  role: ConnectionRole,
  op: TraceOperation,
  connectionId: string,
  eventType: "COORD_BACKEND_IDENTIFIED" | "DDL_CONNECTION_IDENTIFIED",
): Promise<BackendIdentity | null> {
  try {
    const rows = (await sql.unsafe(
      "SELECT pg_backend_pid() AS pid, pg_postmaster_start_time()::text AS pm_start, " +
        "(SELECT oid FROM pg_database WHERE datname = current_database()) AS db_oid, " +
        "current_setting('application_name') AS app_name",
    )) as Array<{
      pid: number;
      pm_start: string;
      db_oid: number;
      app_name: string;
    }>;
    const row = rows[0];
    if (!row) {
      emit(eventType, op, {
        connection_role: role,
        connection_id: connectionId,
        outcome: "empty_readback",
        missing: ["pg_backend_pid", "pg_backend_start", "pg_database_oid"],
      });
      return null;
    }
    const identity: BackendIdentity = {
      pid: Number(row.pid),
      postmasterStart: String(row.pm_start),
      databaseOid: Number(row.db_oid),
      applicationNameReadback:
        row.app_name === null ? null : String(row.app_name),
    };
    const expectedApp = traceApplicationName(role, op.operationId);
    const missing: string[] = [];
    if (identity.applicationNameReadback !== expectedApp) {
      // The server does not see the intended application_name — the
      // server-side join for THIS connection is unresolved, not inferred.
      missing.push("application_name_verification");
    }
    emit(eventType, op, {
      pg_backend_pid: identity.pid,
      pg_backend_start: identity.postmasterStart,
      pg_database_oid: identity.databaseOid,
      connection_role: role,
      connection_id: connectionId,
      ...(identity.applicationNameReadback !== null
        ? { application_name: identity.applicationNameReadback }
        : {}),
      outcome: missing.length === 0 ? "identified" : "identity_partial",
      missing,
    });
    return identity;
  } catch (err) {
    emit(eventType, op, {
      connection_role: role,
      connection_id: connectionId,
      outcome: `identify_failed:${errName(err)}`,
      missing: ["pg_backend_pid", "pg_backend_start", "pg_database_oid"],
    });
    return null;
  }
}

function errName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

export interface TracedConnectOptions {
  max?: number;
  /** Additional postgres.js options (merged AFTER the trace connection block). */
  override?: Parameters<typeof postgres>[1];
}

/**
 * TRACE-AWARE connect helper. When an ambient trace operation exists, the
 * connection carries `exi:<role>:<operation_id>` as its startup
 * application_name; when there is no ambient operation or tracing is off,
 * this is exactly `postgres(url, override)` with the repo's default options.
 *
 * Returns the Sql plus the trace connection_id ("" when untraced).
 */
export function postgresWithTraceIdentity(
  url: string,
  role: ConnectionRole,
  options: TracedConnectOptions = {},
): { sql: postgres.Sql; connectionId: string } {
  const ambient = currentTraceOperation();
  const connectionId = ambient ? `c${connectionCounter++}` : "";
  if (ambient && isTestInfraTraceEnabled()) {
    if (role === "lock") {
      emit("COORD_CONNECTION_CREATE", ambient, {
        connection_role: role,
        connection_id: connectionId,
        application_name: traceApplicationName(role, ambient.operationId),
        outcome: "connecting",
      });
    }
    // Non-lock roles are identified by the read-back in `identifyBackend`
    // (DDL_CONNECTION_IDENTIFIED) — no premature event here.
    return {
      sql: postgres(url, {
        ...options.override,
        ...(options.max !== undefined ? { max: options.max } : {}),
        connection: {
          application_name: traceApplicationName(role, ambient.operationId),
        },
      }),
      connectionId,
    };
  }
  return {
    sql: postgres(
      url,
      options.override ??
        (options.max !== undefined ? { max: options.max } : {}),
    ),
    connectionId: "",
  };
}

// ---------------------------------------------------------------------------
// Sub-operation wrapper (per-SQL phase decomposition)
// ---------------------------------------------------------------------------

/**
 * Emit DDL_REQUEST_DISPATCHED / DDL_RESPONSE_RECEIVED around one awaited
 * step of the critical section. `tag` is a stable short operation tag (e.g.
 * "CREATE_DATABASE"); SQL text is never recorded.
 */
export async function withTraceSubOperation<T>(
  tag: string,
  fn: () => Promise<T>,
  target?: string,
): Promise<T> {
  const op = currentTraceOperation();
  if (!op) return fn();
  emit("DDL_REQUEST_DISPATCHED", op, {
    sub_operation: tag,
    ...(target !== undefined ? { target } : {}),
  });
  try {
    const result = await fn();
    emit("DDL_RESPONSE_RECEIVED", op, {
      sub_operation: tag,
      outcome: "ok",
    });
    return result;
  } catch (err) {
    emit("DDL_RESPONSE_RECEIVED", op, {
      sub_operation: tag,
      outcome: `error:${errName(err)}`,
    });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Process-level scheduler observation (Node-native, process scope only)
// ---------------------------------------------------------------------------

const schedulerState = { started: false };

/**
 * Start the opt-in event-loop observer (and GC windows when the separate
 * diagnostic flag is set). Called once per process at first traced emission;
 * timers are unref'd so they never keep a worker process alive.
 */
export function startSchedulerObserver(): void {
  if (schedulerState.started || !isTestInfraTraceEnabled()) return;
  schedulerState.started = true;

  const eld = monitorEventLoopDelay({ resolution: 20 });
  eld.enable();
  let lastElu = performance.eventLoopUtilization();
  let lastSampleNs = monotonicNs();

  const timer = setInterval(() => {
    const nowNs = monotonicNs();
    const windowMs = Number(nowNs - lastSampleNs) / 1e6;
    lastSampleNs = nowNs;
    const elu = performance.eventLoopUtilization(lastElu);
    lastElu = elu;
    // Node reports cumulative delay statistics; snapshot without reset().
    const meanMs = eld.mean / 1e6;
    const maxMs = eld.max / 1e6;
    const p999Ms = eld.percentile(99.9) / 1e6;
    emit("EVENT_LOOP_SAMPLE", null, {
      eld_mean_ms: meanMs,
      eld_max_ms: maxMs,
      eld_p999_ms: p999Ms,
      elu_active_share: elu.utilization,
      outcome: `window_ms=${windowMs.toFixed(0)}`,
      missing: [],
    });
  }, 1000);
  timer.unref?.();

  if (isTraceGcDiagnosticEnabled()) {
    try {
      const gcObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          emit("NODE_GC_WINDOW", null, {
            gc_duration_ms: entry.duration,
            gc_kind: String(
              (entry as unknown as { detail?: { kind?: string } }).detail
                ?.kind ??
                (entry as unknown as { kind?: string }).kind ??
                "unknown",
            ),
            outcome: "gc",
          });
        }
      });
      gcObserver.observe({ entryTypes: ["gc"] });
    } catch {
      // GC observation unsupported in this runtime: process-level diagnostic
      // only, absence is recorded by never emitting NODE_GC_WINDOW.
    }
  }
}

/** Ensure the observer starts when tracing is enabled (idempotent, cheap). */
export function ensureSchedulerObserver(): void {
  if (isTestInfraTraceEnabled()) startSchedulerObserver();
}
