#!/usr/bin/env node
/**
 * EXAM-586 RESEARCH ONLY per-cell summarizer (protocol §21-§24).
 *
 * Reads one run directory's raw evidence and writes summary586.json with:
 *  - SUBMIT_BURST HTTP distribution (p50/p90/p95/p99/max) + outcome tallies;
 *  - EXAM586_TIMING decomposition joined on attemptId (acquire proxy, lock,
 *    reconciliation, submit, snapshot, finalize, tx hold/total, retries);
 *  - pg_stat_activity aggregates (active/idle/idle-in-tx maxima, fraction of
 *    samples where active+iit >= effective pool max, wait-event mix);
 *  - lock-wait sampler aggregates;
 *  - docker stats medians/p95/max per container (db/app/web CPU+mem);
 *  - pg_stat_database deltas (xact/rollback/deadlock);
 *  - validity: meta + correctness + 429 + witness presence.
 *
 * Usage: summarize586.mjs <runDir> [moreRunDirs...]  (writes summary586.json
 * into each run dir; pure derivation — raw evidence is never modified)
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const runs = process.argv.slice(2);
if (runs.length === 0) {
  console.error("usage: summarize586.mjs <runDir>...");
  process.exit(2);
}

const quantile = (sorted, p) =>
  sorted.length === 0
    ? null
    : sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
const stats = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  return {
    n: s.length,
    p50: quantile(s, 0.5),
    p90: quantile(s, 0.9),
    p95: quantile(s, 0.95),
    p99: quantile(s, 0.99),
    max: s.length ? s[s.length - 1] : null,
    median: quantile(s, 0.5),
  };
};
const lines = (path) =>
  existsSync(path)
    ? readFileSync(path, "utf8")
        .split("\n")
        .filter((l) => l.length > 0)
    : [];

for (const runDir of runs) {
  const out = { run_dir: runDir };
  try {
    out.meta = JSON.parse(readFileSync(join(runDir, "meta.json"), "utf8"));
  } catch {
    out.meta = null;
  }
  const poolMax =
    out.meta && typeof out.meta.effective_pool_max === "number"
      ? out.meta.effective_pool_max
      : 10; // canonical implicit default (postgres.js max=10)

  // ── Driver samples ──
  const submits = [];
  for (const l of lines(join(runDir, "requests.jsonl"))) {
    let r;
    try {
      r = JSON.parse(l);
    } catch {
      continue;
    }
    if (r.phase === "SUBMIT_BURST") submits.push(r);
  }
  out.http = {
    ...stats(submits.map((r) => r.latency_ms)),
    ok2xx: submits.filter((r) => r.status >= 200 && r.status < 300).length,
    e429: submits.filter((r) => r.status === 429).length,
    e5xx: submits.filter((r) => r.status >= 500).length,
    timeouts: submits.filter((r) => r.timeout).length,
    connErrors: submits.filter((r) => r.status === 0 && !r.timeout).length,
  };

  // ── EXAM586_TIMING decomposition (server-side truth, joined on attemptId) ──
  const timings = [];
  for (const l of lines(join(runDir, "app.log"))) {
    const i = l.indexOf("EXAM586_TIMING ");
    if (i < 0) continue;
    try {
      timings.push(JSON.parse(l.slice(i + "EXAM586_TIMING ".length).trim()));
    } catch {
      /* non-JSON tail (truncated line) — ignore */
    }
  }
  const pick = (key) =>
    timings.map((t) => t[key]).filter((v) => typeof v === "number");
  out.timing = {
    records: timings.length,
    txAcquireProxyMs: stats(pick("txAcquireProxyMs")),
    lockPhaseMs: stats(pick("lockPhaseMs")),
    reconciliationPhaseMs: stats(pick("reconciliationPhaseMs")),
    submitPhaseMs: stats(pick("submitPhaseMs")),
    auditPhaseMs: stats(pick("auditPhaseMs")),
    gradingSnapshotPhaseMs: stats(pick("gradingSnapshotPhaseMs")),
    finalizePhaseMs: stats(pick("finalizePhaseMs")),
    txHoldMs: stats(pick("txHoldMs")),
    txTotalMs: stats(pick("txTotalMs")),
    postCommitReadMs: stats(pick("postCommitReadMs")),
    handlerTotalMs: stats(pick("handlerTotalMs")),
    retriesTotal: timings.reduce((a, t) => a + (t.retries ?? 0), 0),
    txWithRetries: timings.filter((t) => (t.retries ?? 0) > 0).length,
    httpStatusOk: timings.filter((t) => t.httpStatus === 200).length,
  };

  // ── pg_stat_activity sampler ──
  const waitEvents = {};
  for (const l of lines(join(runDir, "pg-activity.jsonl"))) {
    // iso|state|wait_event_type|wait_event|count (several rows per instant)
    const parts = l.split("|");
    if (parts.length !== 5) continue;
    const n = Number(parts[4]);
    if (!Number.isFinite(n)) continue;
    const key = `${parts[1]}/${parts[2]}/${parts[3]}`;
    waitEvents[key] = (waitEvents[key] ?? 0) + 1;
  }
  // Per-instant totals (a sample instant = same timestamp across rows).
  const byInstant = new Map();
  for (const l of lines(join(runDir, "pg-activity.jsonl"))) {
    const parts = l.split("|");
    if (parts.length !== 5) continue;
    const n = Number(parts[4]);
    if (!Number.isFinite(n)) continue;
    const inst = byInstant.get(parts[0]) ?? {
      active: 0,
      idle: 0,
      iit: 0,
      total: 0,
    };
    inst.total += n;
    if (parts[1] === "active") inst.active += n;
    else if (parts[1] === "idle") inst.idle += n;
    else if (parts[1] === "idle in transaction") inst.iit += n;
    byInstant.set(parts[0], inst);
  }
  let satSamples = 0;
  for (const inst of byInstant.values()) {
    if (inst.active + inst.iit >= poolMax) satSamples += 1;
  }
  out.pg = {
    sampleInstants: byInstant.size,
    activeMax: byInstant.size
      ? Math.max(...[...byInstant.values()].map((i) => i.active))
      : null,
    idleMax: byInstant.size
      ? Math.max(...[...byInstant.values()].map((i) => i.idle))
      : null,
    idleInTxMax: byInstant.size
      ? Math.max(...[...byInstant.values()].map((i) => i.iit))
      : null,
    totalMax: byInstant.size
      ? Math.max(...[...byInstant.values()].map((i) => i.total))
      : null,
    satFraction: byInstant.size ? satSamples / byInstant.size : null,
    waitEvents,
  };

  // ── Lock waits ──
  let lockSamples = 0;
  let lockMaxSimultaneous = 0;
  const lockEvents = {};
  for (const l of lines(join(runDir, "pg-locks.jsonl"))) {
    const parts = l.split("|");
    if (parts.length !== 4) continue;
    const n = Number(parts[3]);
    if (!Number.isFinite(n)) continue;
    lockSamples += 1;
    lockMaxSimultaneous = Math.max(lockMaxSimultaneous, n);
    const key = `${parts[1]}/${parts[2]}`;
    lockEvents[key] = (lockEvents[key] ?? 0) + 1;
  }
  out.locks = { lockSamples, lockMaxSimultaneous, lockEvents };

  // ── Docker stats ──
  const cpu = { app: [], db: [], web: [] };
  for (const l of lines(join(runDir, "docker-stats.txt"))) {
    if (l.startsWith("SAMPLE")) continue;
    const [name, cpuPct, mem] = l.split("|");
    if (!cpuPct) continue;
    const key = name?.includes("-app-")
      ? "app"
      : name?.includes("-db-")
        ? "db"
        : name?.includes("-web-")
          ? "web"
          : null;
    if (!key) continue;
    const v = Number.parseFloat(cpuPct.replace("%", ""));
    if (Number.isFinite(v)) cpu[key].push(v);
    void mem;
  }
  out.docker = Object.fromEntries(
    Object.entries(cpu).map(([k, v]) => [k, { cpu: stats(v) }]),
  );

  // ── pg_stat_database deltas ──
  const parseCounters = (f) => {
    const first = lines(join(runDir, f))[0];
    if (!first) return null;
    const v = first.split("|");
    return {
      numbackends: Number(v[1]),
      xact_commit: Number(v[2]),
      xact_rollback: Number(v[3]),
      deadlocks: Number(v[11]),
    };
  };
  const before = parseCounters("pg-before.json");
  const after = parseCounters("pg-after.json");
  out.pgDelta =
    before && after
      ? {
          xact_commit: after.xact_commit - before.xact_commit,
          xact_rollback: after.xact_rollback - before.xact_rollback,
          deadlocks: after.deadlocks - before.deadlocks,
        }
      : null;

  // ── Validity roll-up ──
  let correctness = null;
  try {
    correctness = JSON.parse(
      readFileSync(join(runDir, "correctness.json"), "utf8"),
    );
  } catch {
    /* absent for INVALID runs */
  }
  out.correctness = correctness;
  out.valid =
    out.meta?.status === "valid" &&
    correctness?.pass === true &&
    out.http.e429 === 0 &&
    out.timing.records > 0;
  out.pool = out.meta?.pool_mode ?? null;
  out.scale = out.meta?.scale ?? null;
  out.replicate = out.meta?.replicate ?? null;

  writeFileSync(
    join(runDir, "summary586.json"),
    JSON.stringify(out, null, 2) + "\n",
  );
  console.log(
    `SUMMARY586 ${JSON.stringify({
      run: out.meta?.run_id ?? runDir,
      valid: out.valid,
      pool: out.pool,
      scale: out.scale,
      httpP99: out.http.p99,
      acquireP99: out.timing.txAcquireProxyMs.p99,
      txHoldP99: out.timing.txHoldMs.p99,
      pgActiveMax: out.pg.activeMax,
      satFraction: out.pg.satFraction,
      retries: out.timing.retriesTotal,
    })}`,
  );
}
