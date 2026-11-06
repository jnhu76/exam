/**
 * #885 fault-injection harness — E0..E11.
 *
 * WHAT IS MEASURED vs WHAT IS COUNTERFACTUAL (read this before citing any number):
 *
 *  MEASURED (as-built): the three REAL Fastify plugins are registered on one
 *  app (heartbeat + deadlineScanner + operabilityMonitor). Faults are injected
 *  ONLY through a fake `fastify.db` that reproduces the real drizzle chain
 *  shapes. Every stdout pino JSON line, every module-level metric, every
 *  `operability.*` transition and its `time` stamp is REAL product output.
 *
 *  COUNTERFACTUAL (candidates A/B/C/D): NO product runtime code is modified
 *  (forbidden by the task). A/B/C/D are simulated as pure classifiers fed the
 *  MEASURED per-tick telemetry, reusing the REAL `classifyPersistentBusiness-
 *  Failure`, `createOperabilityTransitionTracker` and the REAL 15s monitor
 *  cadence. Their event counts/latencies are labelled COUNTERFACTUAL
 *  everywhere and are NEVER reported as delivered product behaviour.
 *
 * Time is a controlled fake clock (vi.useFakeTimers({now:T0})); fastify.now()
 * and pino's `time` share it, so detection latency is measured from the fault's
 * actual occurrence, not derived from cadence arithmetic.
 */
import { describe, it, vi } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { Writable } from "node:stream";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  organizations,
  examAttempts,
  attemptInterruptionEvents,
} from "@exam/db/schema/pg";
import heartbeatPlugin, {
  heartbeatMetrics,
} from "../../../apps/api/src/plugins/heartbeat.js";
import deadlineScannerPlugin, {
  deadlineScannerMetrics,
} from "../../../apps/api/src/plugins/deadlineScanner.js";
import operabilityMonitorPlugin, {
  createOperabilityTransitionTracker,
  classifyPersistentBusinessFailure,
  classifyLoopStall,
  OPERABILITY_MONITOR_INTERVAL_MS,
} from "../../../apps/api/src/plugins/operabilityMonitor.js";
import { clientEventRetentionMetrics } from "../../../apps/api/src/plugins/clientEventRetention.js";

const T0 = new Date("2026-09-17T08:00:00Z").getTime();
const STEP_MS = OPERABILITY_MONITOR_INTERVAL_MS; // 15_000, real monitor cadence
const SCANNER_INTERVAL_MS = 30_000; // real default HEARTBEAT_SCAN_INTERVAL_MS
const HERE = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_PATH = path.resolve(HERE, "../results/experiments.json");
const BASELINE_SHA = "f2d44b78136cda1358148dbce891590975d4c88f";
const INSTRUMENT_VERSION = "issue-885-instrument-v2";
const REPO_ROOT = path.resolve(HERE, "../../..");
const PRODUCT_MODULES = [
  "heartbeat",
  "deadlineScanner",
  "operabilityMonitor",
] as const;

function sha256File(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function gitOutput(args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

function readInstrumentManifest(): {
  version: string;
  files: Array<{ path: string; sha256: string }>;
  manifestSha256: string;
} | null {
  const manifestPath = path.resolve(HERE, "instrument-manifest.json");
  try {
    const raw = readFileSync(manifestPath);
    const parsed = JSON.parse(raw.toString("utf8")) as {
      version: string;
      files: Array<{ path: string; sha256: string }>;
    };
    return {
      version: parsed.version,
      files: parsed.files,
      manifestSha256: createHash("sha256").update(raw).digest("hex"),
    };
  } catch {
    return null;
  }
}

function collectProvenance() {
  const subjectSha = gitOutput(["rev-parse", "HEAD"]);
  const status = gitOutput(["status", "--porcelain"]);
  const productModules = PRODUCT_MODULES.map((name) => {
    const modulePath = realpathSync(
      path.resolve(REPO_ROOT, "apps/api/src/plugins", `${name}.ts`),
    );
    return {
      name,
      path: modulePath,
      sha256: sha256File(modulePath),
    };
  });
  return {
    baselineSha: BASELINE_SHA,
    subjectSha: subjectSha ?? "UNKNOWN",
    subjectDirty: status === null ? "UNKNOWN" : status.length > 0,
    subjectDirtyFiles:
      status === null
        ? null
        : status.length === 0
          ? []
          : status.split("\n").slice(0, 30),
    productModules,
    instrument: {
      version: INSTRUMENT_VERSION,
      manifest: readInstrumentManifest(),
    },
    runtime: {
      node: process.version,
      vitest: (() => {
        try {
          return (
            JSON.parse(
              readFileSync(
                path.resolve(HERE, "node_modules/vitest/package.json"),
                "utf8",
              ),
            ) as { version: string }
          ).version;
        } catch {
          return "UNKNOWN";
        }
      })(),
    },
    command:
      "vitest run --config research/issue-885/harness/vitest.config.ts research/issue-885/harness/",
    generatedAt: null as string | null,
  };
}

type Loop = "heartbeat" | "deadline_scanner";
type ErrorKind = "logic" | "pg";
type TickOutcome = "throw" | "business_failure" | "clean" | "hang";
type TransitionFn = (
  failed: boolean,
) => "raise_failure" | "raise_recovery" | null;

interface Faults {
  /** pingDb AND every organization discovery fail (mandatory dependency gone). */
  dbDown?: boolean;
  /** Both loops' organizationRepo.list() throws a scanner-side logic bug. */
  orgThrows?: ErrorKind | false;
  /** heartbeat listInProgress() throws. */
  hbAttemptThrows?: ErrorKind | false;
  /** deadline scanner listDeadlineCandidates() throws. */
  dlAttemptThrows?: ErrorKind | false;
  /** Every db.transaction() rejects -> per-item business failure (tick settles). */
  txThrows?: boolean;
  /** heartbeat incident-reconciliation query throws (caught per org). */
  hbIncidentThrows?: boolean;
  /** heartbeat discovers one stale in_progress attempt. */
  hbStale?: boolean;
  /** deadline scanner discovers one candidate. */
  dlCandidates?: boolean;
  /** Both loops hang at organization discovery (never settle). */
  hangOrg?: boolean;
}

interface Stats {
  pings: number;
  pingFailures: number;
  orgSelects: number;
  txCalls: number;
  throws: number;
}

interface MonitorRead {
  loop: Loop;
  atMs: number;
  elapsedMs: number;
  value: number;
}

interface Shared {
  faults: Faults;
  stats: Stats;
  lines: string[];
  hangRejects: Array<(e: Error) => void>;
  reads: MonitorRead[];
}

interface LogLine {
  level?: number;
  time?: number;
  event?: string;
  component?: string;
  state?: string;
  msg?: string;
  [k: string]: unknown;
}

interface StepObs {
  step: number;
  tMs: number;
  elapsedMs: number;
  phase: string;
  faults: Faults;
  hbStarted: boolean;
  hbSettled: boolean;
  dlStarted: boolean;
  dlSettled: boolean;
  hbStartedAtMs: number | null;
  hbSettledAtMs: number | null;
  dlStartedAtMs: number | null;
  dlSettledAtMs: number | null;
  hbThrew: boolean;
  dlThrew: boolean;
  hbCleanSettled: boolean;
  dlCleanSettled: boolean;
  hbThrow: number;
  dlThrow: number;
  hbBusinessFail: number;
  dlBusinessFail: number;
  errorLines: number;
  pingDelta: number;
  pingFailDelta: number;
  monitorReads: MonitorRead[];
  operabilityEvents: Array<{
    event: string;
    component: string;
    state: string;
    level: string;
    msg: string;
    time: number;
  }>;
  metrics: {
    hbConsecutiveFailedTicks: number;
    dlConsecutiveFailedTicks: number;
    hbConsecutiveThrowTicks: number;
    dlConsecutiveThrowTicks: number;
    hbLastSettledAt: number | null;
    dlLastSettledAt: number | null;
    hbStallState: string;
    dlStallState: string;
  };
}

interface PhaseObservation {
  label: string;
  startedAtElapsedMs: number;
  endedAtElapsedMs: number;
  faults: Faults;
  restart: boolean;
}

interface FaultEpisode {
  index: number;
  injectedAtElapsedMs: number;
  removedAtElapsedMs: number | null;
  removalReason: "clean" | "signature_change" | "restart" | "open";
  faults: Faults;
  processEpoch: number;
}

interface CfEvent {
  candidate: "A" | "B" | "C" | "D";
  event: string;
  component: Loop;
  state: "failing" | "recovered" | "paged" | "cleared";
  level: string;
  msg: string;
  timeMs: number;
  elapsedMs: number;
  duplicateWithReadiness: boolean;
}

interface CfState {
  a: Record<Loop, number>;
  b: Record<Loop, number>;
  c: Record<Loop, number>;
  d: Record<Loop, number>;
  trackersA: Record<Loop, TransitionFn>;
  trackersB: Record<Loop, TransitionFn>;
  trackersC: Record<Loop, TransitionFn>;
  trackersD: Record<Loop, TransitionFn>;
  readinessOutageActive: boolean;
  events: CfEvent[];
}

interface Phase {
  label: string;
  steps: number;
  faults?: Faults;
  restart?: boolean;
}

interface Scenario {
  id: string;
  ex: string;
  loops: "both" | "heartbeat" | "deadline_scanner" | "shared";
  title: string;
  phases: Phase[];
  expectation: string;
}

interface ScenarioResult {
  scenario: Scenario;
  phases: PhaseObservation[];
  faultEpisodes: FaultEpisode[];
  steps: StepObs[];
  asBuilt: {
    totalErrorLines: number;
    totalThrowTicks: Record<Loop, number>;
    totalBusinessFailureTicks: Record<Loop, number>;
    totalCleanTicks: Record<Loop, number>;
    totalSettledTicks: Record<Loop, number>;
    totalStartedTicks: Record<Loop, number>;
    maxConsecutiveFailedTicks: Record<Loop, number>;
    finalConsecutiveFailedTicks: Record<Loop, number>;
    lastSettledAtSequence: Record<Loop, Array<number | null>>;
    stallStatesSeen: Record<Loop, string[]>;
    operabilityEvents: Array<{
      event: string;
      component: string;
      state: string;
      level: string;
      timeMs: number;
      elapsedMs: number;
      observedAtStepElapsedMs: number;
    }>;
    readinessFailureEvents: number;
    readinessRecoveryEvents: number;
    businessFailureEvents: number;
    backgroundLoopEvents: number;
  };
  counterfactual: {
    events: CfEvent[];
    byCandidate: Record<
      "A" | "B" | "C" | "D",
      {
        failureEvents: number;
        recoveryEvents: number;
        duplicateWithReadiness: number;
        firstFailureElapsedMs: number | null;
        firstRecoveryElapsedMs: number | null;
      }
    >;
  };
}

// ── Fake db: reproduces the exact drizzle chain shapes used by the real repos ──

const ORG = { id: "org-885" };
const STALE = {
  id: "att-stale-885",
  status: "in_progress",
  lastActivityAt: new Date(T0 - 3_600_000),
  organizationId: ORG.id,
};
const CANDIDATE_ROW = {
  attempt: {
    id: "att-cand-885",
    status: "in_progress",
    organizationId: ORG.id,
  },
};

function pgError(message: string, code = "42703"): Error {
  const e = new Error(message) as Error & { code: string; severity: string };
  e.name = "PostgresError";
  e.code = code;
  e.severity = "ERROR";
  return e;
}

function faultError(
  kind: ErrorKind | false | undefined,
  message: string,
): Error {
  if (kind === "pg") return pgError(`error: ${message}`);
  return new Error(message);
}

/** A chain object that is BOTH thenable and has every drizzle builder method. */
function chain(rows: unknown[]): unknown {
  const p = Promise.resolve(rows) as Promise<unknown[]> & {
    where?: () => unknown;
    innerJoin?: () => unknown;
    orderBy?: () => unknown;
    limit?: () => unknown;
  };
  p.where = () => chain(rows);
  p.innerJoin = () => chain(rows);
  p.orderBy = () => chain(rows);
  p.limit = () => chain(rows);
  return p;
}

function makeDb(shared: Shared): unknown {
  return {
    select: (...args: unknown[]) => ({
      from: (table: unknown) => {
        const f = shared.faults;
        if (table === organizations) {
          if (args.length > 0) {
            // createSystemStatsRepo.pingDb(): select({id}).from(orgs).limit(1)
            shared.stats.pings++;
            if (f.dbDown) {
              shared.stats.pingFailures++;
              shared.stats.throws++;
              throw pgError(
                "connection refused (readiness probe)",
                "ECONNREFUSED",
              );
            }
            return chain([{ id: ORG.id }]);
          }
          // createOrganizationRepo(db).list(): select().from(orgs)
          shared.stats.orgSelects++;
          if (f.dbDown) {
            shared.stats.throws++;
            throw pgError(
              "connection refused (organization discovery)",
              "ECONNREFUSED",
            );
          }
          if (f.hangOrg) {
            return new Promise<never>((_resolve, reject) => {
              shared.hangRejects.push(reject);
            });
          }
          if (f.orgThrows) {
            shared.stats.throws++;
            throw faultError(
              f.orgThrows,
              f.orgThrows === "pg"
                ? "permission denied for table organizations (scanner discovery)"
                : "scanner discovery bug: organization row malformed (null id)",
            );
          }
          return chain([ORG]);
        }
        if (table === examAttempts) {
          if (args.length > 0) {
            // listDeadlineCandidates(): select({attempt}).from(attempts).innerJoin().where()
            if (f.dlAttemptThrows) {
              shared.stats.throws++;
              throw faultError(
                f.dlAttemptThrows,
                f.dlAttemptThrows === "pg"
                  ? 'column "deadline_at" does not exist (SQLSTATE 42703)'
                  : "deadline candidate discovery threw (query builder bug)",
              );
            }
            return chain(f.dlCandidates ? [CANDIDATE_ROW] : []);
          }
          // listInProgress(): select().from(attempts).where()
          if (f.hbAttemptThrows) {
            shared.stats.throws++;
            throw faultError(
              f.hbAttemptThrows,
              f.hbAttemptThrows === "pg"
                ? 'column "last_activity_at" does not exist (SQLSTATE 42703)'
                : "stale-attempt discovery threw (query builder bug)",
            );
          }
          return chain(f.hbStale ? [STALE] : []);
        }
        if (table === attemptInterruptionEvents) {
          if (f.hbIncidentThrows) {
            shared.stats.throws++;
            throw pgError(
              "permission denied for table attempt_interruption_events",
              "42501",
            );
          }
          return chain([]);
        }
        // Unhandled table (e.g. incident ledger / arbiter probe): empty result.
        return chain([]);
      },
    }),
    transaction: async () => {
      shared.stats.txCalls++;
      if (shared.faults.txThrows) {
        shared.stats.throws++;
        throw new Error(
          "forced per-item business failure (transaction rejected)",
        );
      }
      return undefined;
    },
  };
}

// ── App + metrics ───────────────────────────────────────────────────────────

let activeReadSink: Shared | null = null;

function resetOptionalCounter(metrics: object, key: string): void {
  const record = metrics as Record<string, unknown>;
  if (key in record) record[key] = 0;
}

function readOptionalCounter(metrics: object, key: string): number {
  const value = (metrics as Record<string, unknown>)[key];
  return typeof value === "number" ? value : 0;
}

/**
 * Read-side observation only. The monitor is the sole reader of the throw
 * counter; instrumenting the getter records the ACTUAL r_j read point (after
 * the readiness await), not the monitor timer trigger. On the frozen baseline
 * the field does not exist, so the probe is skipped rather than fabricating a
 * product field.
 */
function installThrowReadProbe(metrics: object, loop: Loop): void {
  const record = metrics as Record<string, unknown>;
  if (!("consecutiveThrowTicks" in record)) return;
  const descriptor = Object.getOwnPropertyDescriptor(
    record,
    "consecutiveThrowTicks",
  );
  if (descriptor?.get) return;
  let value = readOptionalCounter(metrics, "consecutiveThrowTicks");
  Object.defineProperty(record, "consecutiveThrowTicks", {
    configurable: true,
    enumerable: true,
    get() {
      if (activeReadSink !== null) {
        const atMs = Date.now();
        activeReadSink.reads.push({
          loop,
          atMs,
          elapsedMs: atMs - T0,
          value,
        });
      }
      return value;
    },
    set(next: number) {
      value = next;
    },
  });
}

installThrowReadProbe(heartbeatMetrics, "heartbeat");
installThrowReadProbe(deadlineScannerMetrics, "deadline_scanner");

function resetAllMetrics(): void {
  for (const m of [
    heartbeatMetrics,
    deadlineScannerMetrics,
    clientEventRetentionMetrics,
  ]) {
    m.startedAt = null;
    m.lastStartedAt = null;
    m.lastSettledAt = null;
    m.activeSince = null;
    m.consecutiveFailedTicks = 0;
    resetOptionalCounter(m, "consecutiveThrowTicks");
  }
  heartbeatMetrics.disruptedCount = 0;
  heartbeatMetrics.disruptionFailedCount = 0;
  heartbeatMetrics.incidentReconciliationFailedCount = 0;
  heartbeatMetrics.systemIncidentsCreated = 0;
  heartbeatMetrics.systemIncidentConflicts = 0;
  heartbeatMetrics.lastScanAt = null;
  deadlineScannerMetrics.autoSubmitCount = 0;
  deadlineScannerMetrics.failedCount = 0;
  deadlineScannerMetrics.lastScanAt = null;
  deadlineScannerMetrics.scanIntervalMs = SCANNER_INTERVAL_MS;
}

/**
 * Hold the third (retention) loop in a known-healthy state. It is NOT under
 * study and is not registered; leaving its process-local metrics null would
 * make the REAL monitor classify it as STALLED and emit a confounder alert.
 * 4 x 86_400_000ms staleAfter >> any scenario length, so it stays healthy.
 */
function holdRetentionHealthy(): void {
  clientEventRetentionMetrics.startedAt = new Date(T0);
  clientEventRetentionMetrics.lastStartedAt = new Date(T0);
  clientEventRetentionMetrics.lastSettledAt = new Date(T0);
  clientEventRetentionMetrics.activeSince = null;
  clientEventRetentionMetrics.consecutiveFailedTicks = 0;
  clientEventRetentionMetrics.scanIntervalMs = 86_400_000;
}

async function buildAndRegister(shared: Shared): Promise<FastifyInstance> {
  const stream = new Writable({
    write(chunk, _enc, cb) {
      shared.lines.push(chunk.toString());
      cb();
    },
  });
  const app = Fastify({ logger: { level: "info", stream } });
  app.decorate<unknown>("db", makeDb(shared) as never);
  app.decorate("now", () => new Date(Date.now()));
  await app.register(heartbeatPlugin);
  await app.register(deadlineScannerPlugin);
  await app.register(operabilityMonitorPlugin);
  await app.ready();
  return app;
}

// ── Observation ─────────────────────────────────────────────────────────────

interface Snap {
  linesLen: number;
  readsLen: number;
  hbStartedAt: number | null;
  hbSettledAt: number | null;
  dlStartedAt: number | null;
  dlSettledAt: number | null;
  pings: number;
  pingFailures: number;
}

function snap(shared: Shared): Snap {
  return {
    linesLen: shared.lines.length,
    readsLen: shared.reads.length,
    hbStartedAt: heartbeatMetrics.lastStartedAt?.getTime() ?? null,
    hbSettledAt: heartbeatMetrics.lastSettledAt?.getTime() ?? null,
    dlStartedAt: deadlineScannerMetrics.lastStartedAt?.getTime() ?? null,
    dlSettledAt: deadlineScannerMetrics.lastSettledAt?.getTime() ?? null,
    pings: shared.stats.pings,
    pingFailures: shared.stats.pingFailures,
  };
}

function parseLine(l: string): LogLine {
  try {
    return JSON.parse(l) as LogLine;
  } catch {
    return { msg: l };
  }
}

const HB_CATCH = "Error scanning for disrupted attempts";
const DL_CATCH = "Error scanning for expired attempts";
const HB_BIZ = [
  "Failed to mark stale attempt as disrupted",
  "System incident reconciliation failed for organization",
];
const DL_BIZ = ["Failed to auto-submit expired attempt"];

function observe(
  step: number,
  tMs: number,
  phaseLabel: string,
  faults: Faults,
  before: Snap,
  shared: Shared,
): StepObs {
  const newLines = shared.lines.slice(before.linesLen).map(parseLine);
  const hbStartedAt = heartbeatMetrics.lastStartedAt?.getTime() ?? null;
  const hbSettledAt = heartbeatMetrics.lastSettledAt?.getTime() ?? null;
  const dlStartedAt = deadlineScannerMetrics.lastStartedAt?.getTime() ?? null;
  const dlSettledAt = deadlineScannerMetrics.lastSettledAt?.getTime() ?? null;
  const hbThrow = newLines.filter((l) => l.msg === HB_CATCH).length;
  const dlThrow = newLines.filter((l) => l.msg === DL_CATCH).length;
  const hbSettled = hbSettledAt !== null && hbSettledAt !== before.hbSettledAt;
  const dlSettled = dlSettledAt !== null && dlSettledAt !== before.dlSettledAt;
  const now = new Date(tMs);
  return {
    step,
    tMs,
    elapsedMs: tMs - T0,
    phase: phaseLabel,
    faults: { ...faults },
    hbStarted: hbStartedAt !== null && hbStartedAt !== before.hbStartedAt,
    hbSettled,
    dlStarted: dlStartedAt !== null && dlStartedAt !== before.dlStartedAt,
    dlSettled,
    hbStartedAtMs: hbStartedAt,
    hbSettledAtMs: hbSettledAt,
    dlStartedAtMs: dlStartedAt,
    dlSettledAtMs: dlSettledAt,
    hbThrew: hbThrow > 0,
    dlThrew: dlThrow > 0,
    hbCleanSettled: hbSettled && hbThrow === 0,
    dlCleanSettled: dlSettled && dlThrow === 0,
    hbThrow,
    dlThrow,
    hbBusinessFail: newLines.filter((l) => HB_BIZ.includes(l.msg ?? "")).length,
    dlBusinessFail: newLines.filter((l) => DL_BIZ.includes(l.msg ?? "")).length,
    errorLines: newLines.filter((l) => (l.level ?? 0) >= 50).length,
    pingDelta: shared.stats.pings - before.pings,
    pingFailDelta: shared.stats.pingFailures - before.pingFailures,
    monitorReads: shared.reads.slice(before.readsLen),
    operabilityEvents: newLines
      .filter(
        (
          l,
        ): l is LogLine & { event: string; component: string; state: string } =>
          typeof l.event === "string" &&
          l.event.startsWith("operability.") &&
          typeof l.component === "string" &&
          typeof l.state === "string",
      )
      .map((l) => ({
        event: l.event,
        component: l.component,
        state: l.state,
        level: l.level === 50 ? "error" : "info",
        msg: l.msg ?? "",
        time: l.time ?? tMs,
      })),
    metrics: {
      hbConsecutiveFailedTicks: heartbeatMetrics.consecutiveFailedTicks,
      dlConsecutiveFailedTicks: deadlineScannerMetrics.consecutiveFailedTicks,
      hbConsecutiveThrowTicks: readOptionalCounter(
        heartbeatMetrics,
        "consecutiveThrowTicks",
      ),
      dlConsecutiveThrowTicks: readOptionalCounter(
        deadlineScannerMetrics,
        "consecutiveThrowTicks",
      ),
      hbLastSettledAt: hbSettledAt,
      dlLastSettledAt: dlSettledAt,
      hbStallState: classifyLoopStall(
        heartbeatMetrics,
        SCANNER_INTERVAL_MS,
        now,
      ),
      dlStallState: classifyLoopStall(
        deadlineScannerMetrics,
        SCANNER_INTERVAL_MS,
        now,
      ),
    },
  };
}

function outcome(
  started: boolean,
  settled: boolean,
  throws: number,
  biz: number,
): TickOutcome | null {
  if (throws > 0) return "throw";
  if (started && !settled) return "hang";
  if (settled) return biz > 0 ? "business_failure" : "clean";
  return null;
}

// ── Counterfactual candidates A/B/C/D ───────────────────────────────────────

function makeCfState(): CfState {
  const t = () => createOperabilityTransitionTracker() as TransitionFn;
  return {
    a: { heartbeat: 0, deadline_scanner: 0 },
    b: { heartbeat: 0, deadline_scanner: 0 },
    c: { heartbeat: 0, deadline_scanner: 0 },
    d: { heartbeat: 0, deadline_scanner: 0 },
    trackersA: { heartbeat: t(), deadline_scanner: t() },
    trackersB: { heartbeat: t(), deadline_scanner: t() },
    trackersC: { heartbeat: t(), deadline_scanner: t() },
    trackersD: { heartbeat: t(), deadline_scanner: t() },
    readinessOutageActive: false,
    events: [],
  };
}

function emit(
  cf: CfState,
  candidate: "A" | "B" | "C" | "D",
  component: Loop,
  transition: "raise_failure" | "raise_recovery" | null,
  event: string,
  failingState: "failing" | "paged",
  recoveredState: "recovered" | "cleared",
  msg: string,
  obs: StepObs,
  recoverMsg: string = msg,
): void {
  if (transition === null) return;
  cf.events.push({
    candidate,
    event,
    component,
    state: transition === "raise_failure" ? failingState : recoveredState,
    level: transition === "raise_failure" ? "error" : "info",
    msg: transition === "raise_failure" ? msg : recoverMsg,
    timeMs: obs.tMs,
    elapsedMs: obs.elapsedMs,
    duplicateWithReadiness:
      transition === "raise_failure" && cf.readinessOutageActive,
  });
}

/**
 * Candidate B: a THROW tick increments the EXISTING business_failure run.
 * Candidate C: a THROW tick increments an INDEPENDENT tick-failure run; any
 *              non-throw settled tick clears it.
 * Candidate D: C plus readiness correlation — the tick-failure tracker is
 *              frozen (not consulted) while a readiness outage is active.
 * Candidate A: hypothetical EXTERNAL watcher counting consecutive scanner
 *              catch ERROR lines; "clear" is derived from ABSENCE of logs.
 * Threshold for C/D reuses the REAL BUSINESS_FAILURE_TICK_THRESHOLD (4) as a
 * HYPOTHESIS (same 30s tick cadence), explicitly NOT pre-approved.
 */
function applyCounterfactual(cf: CfState, obs: StepObs): void {
  // Update readiness outage state from the REAL operability.readiness events.
  for (const e of obs.operabilityEvents) {
    if (e.event !== "operability.readiness" || e.component !== "database")
      continue;
    if (e.state === "unavailable") cf.readinessOutageActive = true;
    if (e.state === "recovered") cf.readinessOutageActive = false;
  }

  const outcomes: Record<Loop, TickOutcome | null> = {
    heartbeat: outcome(
      obs.hbStarted,
      obs.hbSettled,
      obs.hbThrow,
      obs.hbBusinessFail,
    ),
    deadline_scanner: outcome(
      obs.dlStarted,
      obs.dlSettled,
      obs.dlThrow,
      obs.dlBusinessFail,
    ),
  };

  for (const loop of ["heartbeat", "deadline_scanner"] as Loop[]) {
    const o = outcomes[loop];
    if (o === null || o === "hang") continue;
    if (o === "throw") {
      cf.a[loop] += 1;
      cf.b[loop] += 1;
      cf.c[loop] += 1;
      cf.d[loop] += 1;
    } else if (o === "business_failure") {
      cf.a[loop] = 0;
      cf.b[loop] += 1;
      cf.c[loop] = 0;
      cf.d[loop] = 0;
    } else {
      cf.a[loop] = 0;
      cf.b[loop] = 0;
      cf.c[loop] = 0;
      cf.d[loop] = 0;
    }
  }

  // Monitor samples ALWAYS occur on the 15s cadence -> every step here.
  if (obs.pingDelta === 0) return;
  const readinessDown = obs.pingFailDelta > 0;

  for (const loop of ["heartbeat", "deadline_scanner"] as Loop[]) {
    const n = cf.b[loop];
    emit(
      cf,
      "B",
      loop,
      cf.trackersB[loop](classifyPersistentBusinessFailure(n)),
      "operability.business_failure",
      "failing",
      "recovered",
      `Critical background loop persistently failing: ${loop} (${n} consecutive ticks with business failures)`,
      obs,
      `Critical background loop business failures cleared: ${loop}`,
    );
    const nc = cf.c[loop];
    emit(
      cf,
      "C",
      loop,
      cf.trackersC[loop](classifyPersistentBusinessFailure(nc)),
      "operability.tick_failure",
      "failing",
      "recovered",
      `Critical background loop tick execution persistently failing: ${loop} (${nc} consecutive ticks threw; cause unknown)`,
      obs,
      `Critical background loop tick exceptions cleared: ${loop} (a settled tick without a throw interrupted the run; business restoration unknown)`,
    );
    // D: freeze the tracker while the mandatory dependency is unavailable.
    if (!readinessDown) {
      const nd = cf.d[loop];
      emit(
        cf,
        "D",
        loop,
        cf.trackersD[loop](classifyPersistentBusinessFailure(nd)),
        "operability.tick_failure",
        "failing",
        "recovered",
        `Critical background loop tick execution persistently failing: ${loop} (${nd} consecutive ticks threw; cause unknown)`,
        obs,
        `Critical background loop tick exceptions cleared: ${loop} (a settled tick without a throw interrupted the run; business restoration unknown)`,
      );
    }
    const na = cf.a[loop];
    emit(
      cf,
      "A",
      loop,
      cf.trackersA[loop](classifyPersistentBusinessFailure(na)),
      "external_watcher.page",
      "paged",
      "cleared",
      `external log-rule page: ${loop} (${na} consecutive scanner ERROR lines)`,
      obs,
      `external log-rule clear: ${loop} (no scanner ERROR line observed; absence-based)`,
    );
  }
}

// ── Scenarios ───────────────────────────────────────────────────────────────

const BASELINE: Phase = { label: "baseline-clean", steps: 2, faults: {} };

function sc(
  id: string,
  ex: string,
  loops: Scenario["loops"],
  title: string,
  expectation: string,
  phases: Phase[],
): Scenario {
  return { id, ex, loops, title, expectation, phases: [BASELINE, ...phases] };
}

const BIZ_HB: Faults = {
  hbStale: true,
  txThrows: true,
  hbIncidentThrows: true,
};
const BIZ_DL: Faults = { dlCandidates: true, txThrows: true };
const BIZ_BOTH: Faults = { ...BIZ_HB, ...BIZ_DL };

const scenarios: Scenario[] = [
  sc(
    "E0-normal-empty-tick",
    "E0",
    "both",
    "Normal empty ticks, no faults",
    "0 ERROR lines, 0 operability.* events, consecutiveFailedTicks stays 0, lastSettledAt advances every scanner tick",
    [{ label: "clean", steps: 12, faults: {} }],
  ),
  sc(
    "E1-db-down-throws",
    "E1",
    "both",
    "DB unavailable; both loops throw every tick (readiness ownership baseline)",
    "1 operability.readiness/database/unavailable, 0 business_failure, 0 background_loop; counter frozen; loops still settle",
    [
      { label: "db-down+throws", steps: 14, faults: { dbDown: true } },
      { label: "db-recovered", steps: 6, faults: {} },
    ],
  ),
  sc(
    "E2-both-org-discovery-logic-throw",
    "E2",
    "both",
    "DB healthy; BOTH loops' organization discovery throws a scanner-side logic bug",
    "readiness healthy; business_failure frozen below 4; background_loop healthy; ONLY per-tick ERROR logs -> #885 gap",
    [
      {
        label: "org-discovery-throws",
        steps: 18,
        faults: { orgThrows: "logic" },
      },
      { label: "cleared", steps: 4, faults: {} },
    ],
  ),
  sc(
    "E2-hb-attempt-discovery-logic-throw",
    "E2",
    "heartbeat",
    "DB healthy; heartbeat listInProgress throws a scanner-side logic bug",
    "heartbeat: no escalation at all; deadline_scanner stays clean (control)",
    [
      {
        label: "hb-attempt-discovery-throws",
        steps: 18,
        faults: { hbAttemptThrows: "logic" },
      },
      { label: "cleared", steps: 4, faults: {} },
    ],
  ),
  sc(
    "E2-dl-attempt-discovery-logic-throw",
    "E2",
    "deadline_scanner",
    "DB healthy; deadline listDeadlineCandidates throws a scanner-side logic bug",
    "deadline_scanner: no escalation at all; heartbeat stays clean (control)",
    [
      {
        label: "dl-attempt-discovery-throws",
        steps: 18,
        faults: { dlAttemptThrows: "logic" },
      },
      { label: "cleared", steps: 4, faults: {} },
    ],
  ),
  sc(
    "E3-hb-pg-query-error",
    "E3",
    "heartbeat",
    "DB probe healthy; heartbeat query throws a PostgreSQL 42703 column error",
    "healthy probe coexists with a DB-ROOT-CAUSE throw -> 'DB healthy => non-DB exception' is invalid; still no escalation",
    [
      {
        label: "hb-pg-query-error",
        steps: 18,
        faults: { hbAttemptThrows: "pg" },
      },
      { label: "cleared", steps: 4, faults: {} },
    ],
  ),
  sc(
    "E3-dl-pg-query-error",
    "E3",
    "deadline_scanner",
    "DB probe healthy; deadline query throws a PostgreSQL 42703 column error",
    "healthy probe coexists with a DB-ROOT-CAUSE throw; still no escalation",
    [
      {
        label: "dl-pg-query-error",
        steps: 18,
        faults: { dlAttemptThrows: "pg" },
      },
      { label: "cleared", steps: 4, faults: {} },
    ],
  ),
  sc(
    "E4-both-business-failures-settle",
    "E4",
    "both",
    "Both loops settle every tick but every business item fails",
    "REAL operability.business_failure failing at >=4 for both loops, then recovered on first clean settle",
    [
      { label: "business-failure-ticks", steps: 14, faults: BIZ_BOTH },
      { label: "clean-recovery", steps: 6, faults: {} },
    ],
  ),
  sc(
    "E5-hb-alternating-biz-and-throw",
    "E5",
    "heartbeat",
    "heartbeat alternates business-failure settles and tick throws",
    "freeze on throws; counter resumes from frozen value; mixed fault types do not form a truthful consecutive run",
    [
      { label: "biz-A", steps: 4, faults: BIZ_HB },
      { label: "throw-A", steps: 6, faults: { hbAttemptThrows: "logic" } },
      { label: "biz-B", steps: 4, faults: BIZ_HB },
      { label: "throw-B", steps: 6, faults: { hbAttemptThrows: "logic" } },
      { label: "biz-C", steps: 8, faults: BIZ_HB },
      { label: "clean", steps: 6, faults: {} },
    ],
  ),
  sc(
    "E5-dl-alternating-biz-and-throw",
    "E5",
    "deadline_scanner",
    "deadline_scanner alternates business-failure settles and tick throws",
    "freeze on throws; counter resumes from frozen value",
    [
      { label: "biz-A", steps: 4, faults: BIZ_DL },
      { label: "throw-A", steps: 6, faults: { dlAttemptThrows: "logic" } },
      { label: "biz-B", steps: 4, faults: BIZ_DL },
      { label: "throw-B", steps: 6, faults: { dlAttemptThrows: "logic" } },
      { label: "biz-C", steps: 8, faults: BIZ_DL },
      { label: "clean", steps: 6, faults: {} },
    ],
  ),
  sc(
    "E5-both-alternating",
    "E5",
    "both",
    "Both loops alternate business-failure settles and tick throws (shared path)",
    "same freeze/resume semantics on the shared monitor cadence",
    [
      { label: "biz-A", steps: 4, faults: BIZ_BOTH },
      { label: "throw-A", steps: 6, faults: { orgThrows: "logic" } },
      { label: "biz-B", steps: 4, faults: BIZ_BOTH },
      { label: "throw-B", steps: 6, faults: { orgThrows: "logic" } },
      { label: "biz-C", steps: 8, faults: BIZ_BOTH },
      { label: "clean", steps: 6, faults: {} },
    ],
  ),
  sc(
    "E6-hb-recover-after-continuous-throws",
    "E6",
    "heartbeat",
    "heartbeat throws continuously, then the fault disappears (clean ticks)",
    "as-built: NO raise and NO recovery (nothing was ever claimed); counterfactual C: raise then recovered on first clean settle",
    [
      {
        label: "continuous-throws",
        steps: 18,
        faults: { hbAttemptThrows: "logic" },
      },
      { label: "clean-recovery", steps: 8, faults: {} },
    ],
  ),
  sc(
    "E6-dl-recover-after-continuous-throws",
    "E6",
    "deadline_scanner",
    "deadline_scanner throws continuously, then the fault disappears",
    "as-built: NO raise and NO recovery; counterfactual C: raise then recovered",
    [
      {
        label: "continuous-throws",
        steps: 18,
        faults: { dlAttemptThrows: "logic" },
      },
      { label: "clean-recovery", steps: 8, faults: {} },
    ],
  ),
  sc(
    "E6-business-failure-recovery",
    "E6",
    "both",
    "REAL business_failure is raised, then a clean settle clears it",
    "measured REAL recovery event; proves recovery semantics of the existing #862 contract",
    [
      { label: "business-failure-ticks", steps: 12, faults: BIZ_BOTH },
      { label: "clean-recovery", steps: 8, faults: {} },
    ],
  ),
  sc(
    "E7-restart-during-continuous-throws",
    "E7",
    "both",
    "Continuous throws, then a simulated process restart (fresh trackers + zeroed process-local counters)",
    "as-built: no alert either side; counterfactual C: re-raise only after the threshold re-accumulates; no carry-over recovery",
    [
      {
        label: "before-restart-continuous-throws",
        steps: 12,
        faults: { orgThrows: "logic" },
      },
      {
        label: "RESTART",
        steps: 0,
        faults: { orgThrows: "logic" },
        restart: true,
      },
      {
        label: "after-restart-continuous-throws",
        steps: 14,
        faults: { orgThrows: "logic" },
      },
      { label: "clean", steps: 6, faults: {} },
    ],
  ),
  sc(
    "E8-desync-short-bursts",
    "E8",
    "both",
    "Fault bursts start just after monitor samples; short bursts end before threshold",
    "measure detection latency from ACTUAL fault occurrence; a 3-tick burst never escalates; a 4+ tick burst escalates on the next monitor sample",
    [
      { label: "3-tick-burst", steps: 6, faults: { orgThrows: "logic" } },
      { label: "clean-gap", steps: 4, faults: {} },
      { label: "8-tick-burst", steps: 16, faults: { orgThrows: "logic" } },
      { label: "clean", steps: 6, faults: {} },
    ],
  ),
  sc(
    "E9-db-down-then-db-up-with-throws",
    "E9",
    "both",
    "Readiness outage AND tick throws together, then DB recovers while throws continue",
    "same-root-cause double-alert risk under B/C; D correlation; after DB recovery the remaining throws are genuinely UNKNOWN-cause",
    [
      {
        label: "db-down-and-throws",
        steps: 10,
        faults: { dbDown: true },
      },
      {
        label: "db-up-but-throws-continue",
        steps: 12,
        faults: { orgThrows: "logic" },
      },
      { label: "clean", steps: 6, faults: {} },
    ],
  ),
  sc(
    "E10-business-failure-then-continuous-throws",
    "E10",
    "both",
    "First enter REAL business_failure, then continuous tick throws (DB healthy)",
    "old business_failure stays 'failing' (frozen counter >= threshold); no recovery is emitted even though business work is no longer being attempted",
    [
      { label: "business-failure-ticks", steps: 12, faults: BIZ_BOTH },
      {
        label: "continuous-throws",
        steps: 14,
        faults: { orgThrows: "logic" },
      },
      { label: "clean", steps: 8, faults: {} },
    ],
  ),
  sc(
    "E11-hung-tick-not-throwing",
    "E11",
    "both",
    "Both loops hang at discovery (never settle) with DB probe healthy",
    "REAL operability.background_loop stalled at 4x interval; NO business_failure; distinct from throwing (which settles)",
    [
      { label: "hung-discovery", steps: 14, faults: { hangOrg: true } },
      { label: "hang-released", steps: 4, faults: {} },
    ],
  ),
  // Added after Reviewer 1's independent objection: a strict consecutive
  // counter is reset by ANY clean settle, so a chronically dead loop that
  // throws 3 ticks and then completes 1 clean tick may NEVER reach the
  // threshold. This is a decision-relevant BOUNDARY, not scope expansion.
  sc(
    "E12-chronic-intermittent-3-throw-1-clean",
    "E12",
    "both",
    "4 repeated cycles: 3 throwing ticks then 1 clean settle (chronically dead loop, intermittent)",
    "BOUNDARY: strict consecutive-throw counter resets every cycle -> no escalation; document as residual false-negative boundary or validate a windowed policy",
    [
      { label: "c1-throws", steps: 6, faults: { orgThrows: "logic" } },
      { label: "c1-clean", steps: 2, faults: {} },
      { label: "c2-throws", steps: 6, faults: { orgThrows: "logic" } },
      { label: "c2-clean", steps: 2, faults: {} },
      { label: "c3-throws", steps: 6, faults: { orgThrows: "logic" } },
      { label: "c3-clean", steps: 2, faults: {} },
      { label: "c4-throws", steps: 6, faults: { orgThrows: "logic" } },
      { label: "c4-clean", steps: 2, faults: {} },
      { label: "clean", steps: 4, faults: {} },
    ],
  ),
];

// ── Runner ──────────────────────────────────────────────────────────────────

/**
 * A phase is a FAULT phase iff it injects at least one fault knob. `hbStale`
 * / `dlCandidates` only create work items; they are not faults by themselves.
 * Derived from the knob object, NOT from label text, so phase naming cannot
 * silently corrupt detection/recovery latency measurement.
 */
function isFaultPhase(faults: Faults | undefined): boolean {
  if (!faults) return false;
  return Boolean(
    faults.dbDown ||
    faults.orgThrows ||
    faults.hbAttemptThrows ||
    faults.dlAttemptThrows ||
    faults.txThrows ||
    faults.hbIncidentThrows ||
    faults.hangOrg,
  );
}

async function runScenario(scenario: Scenario): Promise<ScenarioResult> {
  vi.useFakeTimers({ now: T0 });
  const shared: Shared = {
    faults: {},
    stats: { pings: 0, pingFailures: 0, orgSelects: 0, txCalls: 0, throws: 0 },
    lines: [],
    hangRejects: [],
    reads: [],
  };
  const cf = makeCfState();
  resetAllMetrics();
  holdRetentionHealthy();
  activeReadSink = shared;
  let app = await buildAndRegister(shared);
  const steps: StepObs[] = [];
  const phases: PhaseObservation[] = [];
  const faultEpisodes: FaultEpisode[] = [];
  let currentEpisode: FaultEpisode | null = null;
  let processEpoch = 0;
  let elapsed = 0;
  let stepIdx = 0;

  const sameFaultSignature = (a: Faults, b: Faults) =>
    JSON.stringify(a) === JSON.stringify(b);

  try {
    for (const phase of scenario.phases) {
      const phaseStartedAt = elapsed;
      shared.faults = phase.faults ? { ...phase.faults } : {};

      if (phase.restart) {
        // A restart ends the old process's alert episode and all of its
        // process-local counters. Close the app BEFORE resetting so no old
        // monitor/log write can observe the new process's state.
        if (currentEpisode !== null) {
          currentEpisode.removedAtElapsedMs = phaseStartedAt;
          currentEpisode.removalReason = "restart";
          currentEpisode = null;
        }
        await app.close();
        processEpoch++;
        resetAllMetrics();
        holdRetentionHealthy();
        // Fresh-process trackers for the counterfactual candidates too.
        cf.a = { heartbeat: 0, deadline_scanner: 0 };
        cf.b = { heartbeat: 0, deadline_scanner: 0 };
        cf.c = { heartbeat: 0, deadline_scanner: 0 };
        cf.d = { heartbeat: 0, deadline_scanner: 0 };
        cf.trackersA = {
          heartbeat: createOperabilityTransitionTracker() as TransitionFn,
          deadline_scanner:
            createOperabilityTransitionTracker() as TransitionFn,
        };
        cf.trackersB = {
          heartbeat: createOperabilityTransitionTracker() as TransitionFn,
          deadline_scanner:
            createOperabilityTransitionTracker() as TransitionFn,
        };
        cf.trackersC = {
          heartbeat: createOperabilityTransitionTracker() as TransitionFn,
          deadline_scanner:
            createOperabilityTransitionTracker() as TransitionFn,
        };
        cf.trackersD = {
          heartbeat: createOperabilityTransitionTracker() as TransitionFn,
          deadline_scanner:
            createOperabilityTransitionTracker() as TransitionFn,
        };
        cf.readinessOutageActive = false;
        app = await buildAndRegister(shared);
      }

      // Episode boundaries are recorded when the fault switch actually
      // changes, not reconstructed after the next advance.
      if (isFaultPhase(phase.faults)) {
        if (
          currentEpisode === null ||
          currentEpisode.processEpoch !== processEpoch ||
          !sameFaultSignature(currentEpisode.faults, shared.faults)
        ) {
          if (currentEpisode !== null) {
            currentEpisode.removedAtElapsedMs = phaseStartedAt;
            currentEpisode.removalReason = "signature_change";
          }
          currentEpisode = {
            index: faultEpisodes.length,
            injectedAtElapsedMs: phaseStartedAt,
            removedAtElapsedMs: null,
            removalReason: "open",
            faults: { ...shared.faults },
            processEpoch,
          };
          faultEpisodes.push(currentEpisode);
        }
      } else if (currentEpisode !== null) {
        currentEpisode.removedAtElapsedMs = phaseStartedAt;
        currentEpisode.removalReason = "clean";
        currentEpisode = null;
      }

      for (let i = 0; i < phase.steps; i++) {
        const before = snap(shared);
        await vi.advanceTimersByTimeAsync(STEP_MS);
        elapsed += STEP_MS;
        const obs = observe(
          stepIdx,
          T0 + elapsed,
          phase.label,
          shared.faults,
          before,
          shared,
        );
        steps.push(obs);
        applyCounterfactual(cf, obs);
        stepIdx++;
      }
      phases.push({
        label: phase.label,
        startedAtElapsedMs: phaseStartedAt,
        endedAtElapsedMs: elapsed,
        faults: { ...shared.faults },
        restart: phase.restart === true,
      });
    }
  } finally {
    for (const reject of shared.hangRejects) {
      reject(new Error("test teardown: release hung discovery"));
    }
    await app.close();
    activeReadSink = null;
    vi.useRealTimers();
  }

  // Aggregate as-built facts.
  const totalThrowTicks = { heartbeat: 0, deadline_scanner: 0 };
  const totalBusinessFailureTicks = { heartbeat: 0, deadline_scanner: 0 };
  const totalCleanTicks = { heartbeat: 0, deadline_scanner: 0 };
  const totalSettledTicks = { heartbeat: 0, deadline_scanner: 0 };
  const totalStartedTicks = { heartbeat: 0, deadline_scanner: 0 };
  const maxC = { heartbeat: 0, deadline_scanner: 0 };
  const stallStatesSeen: Record<Loop, string[]> = {
    heartbeat: [],
    deadline_scanner: [],
  };
  const lastSettledAtSequence: Record<Loop, Array<number | null>> = {
    heartbeat: [],
    deadline_scanner: [],
  };
  let totalErrorLines = 0;
  const operabilityEvents: ScenarioResult["asBuilt"]["operabilityEvents"] = [];
  for (const s of steps) {
    totalErrorLines += s.errorLines;
    const os: Record<Loop, TickOutcome | null> = {
      heartbeat: outcome(s.hbStarted, s.hbSettled, s.hbThrow, s.hbBusinessFail),
      deadline_scanner: outcome(
        s.dlStarted,
        s.dlSettled,
        s.dlThrow,
        s.dlBusinessFail,
      ),
    };
    for (const loop of ["heartbeat", "deadline_scanner"] as Loop[]) {
      const o = os[loop];
      if (loop === "heartbeat") {
        if (s.hbStarted) totalStartedTicks.heartbeat++;
        if (s.hbSettled) totalSettledTicks.heartbeat++;
      } else {
        if (s.dlStarted) totalStartedTicks.deadline_scanner++;
        if (s.dlSettled) totalSettledTicks.deadline_scanner++;
      }
      if (o === "throw") totalThrowTicks[loop]++;
      if (o === "business_failure") totalBusinessFailureTicks[loop]++;
      if (o === "clean") totalCleanTicks[loop]++;
      const v =
        loop === "heartbeat"
          ? s.metrics.hbConsecutiveFailedTicks
          : s.metrics.dlConsecutiveFailedTicks;
      maxC[loop] = Math.max(maxC[loop], v);
      const stall =
        loop === "heartbeat" ? s.metrics.hbStallState : s.metrics.dlStallState;
      if (!stallStatesSeen[loop].includes(stall))
        stallStatesSeen[loop].push(stall);
      const ls =
        loop === "heartbeat"
          ? s.metrics.hbLastSettledAt
          : s.metrics.dlLastSettledAt;
      lastSettledAtSequence[loop].push(ls);
    }
    for (const e of s.operabilityEvents) {
      operabilityEvents.push({
        event: e.event,
        component: e.component,
        state: e.state,
        level: e.level,
        // Actual pino emission time on the controlled clock. The observation
        // step is retained separately; it must not replace the event time.
        timeMs: e.time,
        elapsedMs: e.time - T0,
        observedAtStepElapsedMs: s.elapsedMs,
      });
    }
  }

  const byCandidate = {} as ScenarioResult["counterfactual"]["byCandidate"];
  for (const cand of ["A", "B", "C", "D"] as const) {
    const evs = cf.events.filter((e) => e.candidate === cand);
    const failure = evs.filter(
      (e) => e.state === "failing" || e.state === "paged",
    );
    const recovery = evs.filter(
      (e) => e.state === "recovered" || e.state === "cleared",
    );
    byCandidate[cand] = {
      failureEvents: failure.length,
      recoveryEvents: recovery.length,
      duplicateWithReadiness: failure.filter((e) => e.duplicateWithReadiness)
        .length,
      firstFailureElapsedMs: failure.length ? failure[0]!.elapsedMs : null,
      firstRecoveryElapsedMs: recovery.length ? recovery[0]!.elapsedMs : null,
    };
  }

  return {
    scenario,
    phases,
    faultEpisodes,
    steps,
    asBuilt: {
      totalErrorLines,
      totalThrowTicks,
      totalBusinessFailureTicks,
      totalCleanTicks,
      totalSettledTicks,
      totalStartedTicks,
      maxConsecutiveFailedTicks: maxC,
      finalConsecutiveFailedTicks: {
        heartbeat: steps.at(-1)?.metrics.hbConsecutiveFailedTicks ?? 0,
        deadline_scanner: steps.at(-1)?.metrics.dlConsecutiveFailedTicks ?? 0,
      },
      lastSettledAtSequence,
      stallStatesSeen,
      operabilityEvents,
      readinessFailureEvents: operabilityEvents.filter(
        (e) => e.event === "operability.readiness" && e.state === "unavailable",
      ).length,
      readinessRecoveryEvents: operabilityEvents.filter(
        (e) => e.event === "operability.readiness" && e.state === "recovered",
      ).length,
      businessFailureEvents: operabilityEvents.filter(
        (e) => e.event === "operability.business_failure",
      ).length,
      backgroundLoopEvents: operabilityEvents.filter(
        (e) => e.event === "operability.background_loop",
      ).length,
    },
    counterfactual: { events: cf.events, byCandidate },
  };
}

describe("#885 fault-injection experiments (E0..E11)", () => {
  it("runs the full matrix and writes the measured + counterfactual evidence", async () => {
    const results: ScenarioResult[] = [];
    for (const scenario of scenarios) {
      results.push(await runScenario(scenario));
    }
    // The results directory is regenerable and intentionally not committed; a
    // fresh clean-room clone does not have it yet.
    const provenance = collectProvenance();
    provenance.generatedAt = new Date().toISOString();
    mkdirSync(path.dirname(RESULTS_PATH), { recursive: true });
    writeFileSync(
      RESULTS_PATH,
      JSON.stringify(
        {
          ...provenance,
          t0: T0,
          t0Iso: new Date(T0).toISOString(),
          stepMs: STEP_MS,
          scannerIntervalMs: SCANNER_INTERVAL_MS,
          monitorIntervalMs: OPERABILITY_MONITOR_INTERVAL_MS,
          businessFailureTickThreshold: 4,
          scenarioCount: results.length,
          clock:
            "vi.useFakeTimers({now:T0}); fastify.now() and pino time share the controlled clock",
          note: "MEASURED = real plugins + real stdout; COUNTERFACTUAL A/B/C/D = pure classifiers over measured telemetry, NOT product behaviour. subjectSha/subjectDirty identify the source actually imported, not the frozen baseline.",
          results,
        },
        null,
        2,
      ),
    );

    // Compact console transcript (also preserved in RESULTS.md).
    for (const r of results) {
      const a = r.asBuilt;
      const c = r.counterfactual.byCandidate;
      // eslint-disable-next-line no-console
      console.log(
        `[${r.scenario.id}] loops=${r.scenario.loops} ` +
          `errLogs=${a.totalErrorLines} ` +
          `throw(hb/dl)=${a.totalThrowTicks.heartbeat}/${a.totalThrowTicks.deadline_scanner} ` +
          `biz(hb/dl)=${a.totalBusinessFailureTicks.heartbeat}/${a.totalBusinessFailureTicks.deadline_scanner} ` +
          `clean(hb/dl)=${a.totalCleanTicks.heartbeat}/${a.totalCleanTicks.deadline_scanner} ` +
          `maxC(hb/dl)=${a.maxConsecutiveFailedTicks.heartbeat}/${a.maxConsecutiveFailedTicks.deadline_scanner} ` +
          `stall(hb/dl)=${a.stallStatesSeen.heartbeat.join("|")}/${a.stallStatesSeen.deadline_scanner.join("|")} ` +
          `ASBUILT[readiness=${a.readinessFailureEvents}+${a.readinessRecoveryEvents} biz=${a.businessFailureEvents} loop=${a.backgroundLoopEvents}] ` +
          `CF[A=${c.A.failureEvents}/${c.A.recoveryEvents} B=${c.B.failureEvents}/${c.B.recoveryEvents} C=${c.C.failureEvents}/${c.C.recoveryEvents} D=${c.D.failureEvents}/${c.D.recoveryEvents} dupC=${c.C.duplicateWithReadiness}] ` +
          `episodes=${r.faultEpisodes.map((e) => `${e.injectedAtElapsedMs}->${e.removedAtElapsedMs ?? "open"}@p${e.processEpoch}`).join(",") || "-"}`,
      );
    }
  }, 300_000);
});
