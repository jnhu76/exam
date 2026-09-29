/**
 * EXAM-586 RESEARCH ONLY / NON_CANONICAL (#586).
 *
 * This module exists ONLY on the research/586-fedora-pool-1 branch image for
 * the Issue #586 controlled pressure experiment. It must never be adopted
 * into product behavior:
 *
 * - `EXAM_586_RESEARCH_POOL_MAX` (unset | 10 | 20 | 30): when unset, callers
 *   execute the exact canonical postgres.js constructor path; when set to an
 *   allowed value, that value is passed as an explicit postgres.js `max`.
 *   It is NOT a supported product setting and must never graduate into
 *   settings.ts / .env.production.example (protocol §8).
 * - `EXAM_586_TIMING=1`: neutral submit-phase timing. Only performance.now()
 *   stamps into a bounded per-request record (AsyncLocalStorage). The single
 *   structured `EXAM586_TIMING` line is emitted AFTER the transaction fully
 *   resolves; no postgres.js Query object is ever wrapped, awaited or
 *   intercepted (EXAM-550-CORRECTIVE-1 measurement-neutrality law: touching
 *   a lazy Query SUBMITS it and changes scheduling).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";

export const RESEARCH_586_POOL_ENV = "EXAM_586_RESEARCH_POOL_MAX";
export const RESEARCH_586_TIMING_ENV = "EXAM_586_TIMING";

const ALLOWED_POOL_VALUES = new Set(["10", "20", "30"]);

/**
 * Parses the research pool seam value. Returns `null` for unset/empty
 * (canonical implicit-default mode), the numeric cap for "10"/"20"/"30",
 * and THROWS for anything else — the experiment must never silently fall
 * back to canonical behavior on a mistyped value (protocol §8).
 */
export function parseResearch586PoolMax(
  raw: string | undefined | null,
): number | null {
  if (raw === undefined || raw === null || raw.trim() === "") return null;
  const value = raw.trim();
  if (!ALLOWED_POOL_VALUES.has(value)) {
    throw new Error(
      `${RESEARCH_586_POOL_ENV}: invalid value "${raw}" — allowed: unset, 10, 20, 30`,
    );
  }
  return Number(value);
}

export function isResearch586TimingEnabled(): boolean {
  return process.env[RESEARCH_586_TIMING_ENV] === "1";
}

/**
 * Startup config witness: logs the seam mode so every run's evidence records
 * which pool path actually executed (protocol §28 pool-value verification).
 */
export function logResearch586PoolMode(effectiveMax: number | null): void {
  const line = `EXAM586_POOL ${JSON.stringify({
    env: process.env[RESEARCH_586_POOL_ENV] ?? null,
    mode: effectiveMax === null ? "canonical_implicit" : "research_explicit",
    effectivePoolMax: effectiveMax ?? "postgres.js_default",
  })}`;
  console.log(line);
}

interface Research586Record {
  tRequestStart: number;
  marks: Record<string, number>;
  /** executeInTransaction re-invokes its callback per retry; count them. */
  txInvocations: number;
  attemptId: string | null;
  emitted: boolean;
}

const als = new AsyncLocalStorage<Research586Record>();

/** Begins the request-scoped record. No-op unless research timing is on. */
export function beginResearch586Submit(): void {
  if (!isResearch586TimingEnabled()) return;
  als.enterWith({
    tRequestStart: performance.now(),
    marks: Object.create(null) as Record<string, number>,
    txInvocations: 0,
    attemptId: null,
    emitted: false,
  });
}

/** Marks a named instant. Cheap no-op when disabled or outside the route. */
export function markResearch586(name: string): void {
  const record = als.getStore();
  if (record) record.marks[name] = performance.now();
}

/** Counts one executeInTransaction callback invocation (= retry witness). */
export function countResearch586TxInvocation(): void {
  const record = als.getStore();
  if (record) record.txInvocations += 1;
}

/** Attaches the attempt id so driver samples join on attemptId. */
export function setResearch586AttemptId(attemptId: string): void {
  const record = als.getStore();
  if (record) record.attemptId = attemptId;
}

function markOf(record: Research586Record, name: string): number | null {
  const value = record.marks[name];
  return value === undefined ? null : value;
}

/** Duration between two marks in ms; null when either endpoint is absent. */
function spanMs(
  record: Research586Record,
  from: string,
  to: string,
): number | null {
  const a = markOf(record, from);
  const b = markOf(record, to);
  return a === null || b === null ? null : b - a;
}

export interface Research586SubmitEndInfo {
  reqId: string;
  /** HTTP status when known on the success path; null on thrown errors. */
  httpStatus: number | null;
}

/**
 * Emits exactly one EXAM586_TIMING line for this submit request, AFTER the
 * transaction fully resolved (success or throw). Emits nothing when the
 * research mode is disabled or the request never began a record.
 */
export function endResearch586Submit(info: Research586SubmitEndInfo): void {
  const record = als.getStore();
  if (!record || record.emitted) return;
  record.emitted = true;
  const line = `EXAM586_TIMING ${JSON.stringify({
    reqId: info.reqId,
    attemptId: record.attemptId,
    httpStatus: info.httpStatus,
    tRequestStartEpochMs:
      Date.now() - (performance.now() - record.tRequestStart),
    txAcquireProxyMs: spanMs(record, "beforeTx", "txEnter"),
    lockPhaseMs: spanMs(record, "beforeLock", "afterLock"),
    reconciliationPhaseMs: spanMs(
      record,
      "beforeReconciliation",
      "afterReconciliation",
    ),
    submitPhaseMs: spanMs(record, "beforeSubmitAttempt", "afterSubmitAttempt"),
    auditPhaseMs: spanMs(record, "beforeAudit", "afterAudit"),
    gradingSnapshotPhaseMs: spanMs(
      record,
      "beforeGradingSnapshot",
      "afterGradingSnapshot",
    ),
    finalizePhaseMs: spanMs(record, "beforeFinalize", "afterFinalize"),
    txHoldMs: spanMs(record, "txEnter", "txExit"),
    txTotalMs: spanMs(record, "beforeTx", "txResolved"),
    postCommitReadMs: spanMs(
      record,
      "beforePostCommitRead",
      "afterPostCommitRead",
    ),
    handlerTotalMs: performance.now() - record.tRequestStart,
    txInvocations: record.txInvocations,
    retries: Math.max(0, record.txInvocations - 1),
  })}`;
  console.log(line);
}
