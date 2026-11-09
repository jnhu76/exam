#!/usr/bin/env node
/**
 * Interleaved A/B load benchmark for the exam-secure-observability-remediation
 * closure (TASK-CONTRACT §6.1).
 *
 * A = frozen master baseline 5140c3dd (worktree perf-baseline, DB
 *     exam_ci_perf_ab_base, server :3311)
 * B = integration-final 5d4b2773 (DB exam_ci_perf_ab_int, server :3312)
 *
 * Per (variant, rep) run: 8 phases, each 6s warmup + 12s measured window.
 * Phases: answers-c1, answers-c8, reject-c8, events-safe-c8, events-miss-c8,
 *         httperr-c8, get-c8, heartbeat-c8
 *
 * Per phase the orchestrator records: client latencies (every request),
 * status codes, server child-process CPU jiffies (from /proc/<pid>/stat),
 * pino stdout bytes + line count, pg_stat_database counters and exact
 * business-table row counts (exam_answer_save_receipts, client_events,
 * audit_logs, exam_attempts).
 *
 * Usage: node load.mjs <variant:base|int> <rep:number> <outdir>
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { performance } from "node:perf_hooks";

const VARIANT = process.argv[2];
const REP = Number(process.argv[3]);
const OUTDIR = process.argv[4];
if (!["base", "int"].includes(VARIANT)) throw new Error("variant must be base|int");

const CFG = {
  base: { port: 3311, db: "exam_ci_perf_ab_base" },
  int: { port: 3312, db: "exam_ci_perf_ab_int" },
}[VARIANT];
const BASE = `http://127.0.0.1:${CFG.port}`;

const WARMUP_MS = 6000;
const MEASURE_MS = 12000;
const SETTLE_MS = 1600; // pg stats collector flush (500ms) + pino sonic-boom drain

const agent = new http.Agent({ keepAlive: true, maxSockets: 64, maxFreeSockets: 64 });

function req(method, p, cookie, body) {
  return new Promise((resolve) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const r = http.request(
      `${BASE}${p}`,
      {
        method,
        agent,
        headers: {
          ...(cookie ? { cookie } : {}),
          ...(payload ? { "content-type": "application/json" } : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try { json = JSON.parse(text); } catch { /* not json */ }
          const sc = res.headers["set-cookie"];
          resolve({
            status: res.statusCode,
            json,
            text,
            requestId: res.headers["x-request-id"] ?? null,
            cookie: sc ? sc.map((v) => v.split(";")[0]).join("; ") : undefined,
          });
        });
      },
    );
    r.on("error", (err) => resolve({ status: 0, json: null, text: String(err), requestId: null }));
    if (payload) r.write(payload);
    r.end();
  });
}

async function login(username) {
  const r = await req("POST", "/api/auth/login", null, { username, password: "candidate123" });
  if (r.status !== 200) throw new Error(`login ${username} failed: ${r.status} ${r.text.slice(0, 200)}`);
  return r.cookie;
}

async function primaryExam(cookie) {
  const r = await req("GET", "/api/candidate/exams", cookie);
  if (r.status !== 200) throw new Error(`exam list failed: ${r.status}`);
  const list = r.json;
  const exam = list.find((e) => e.primaryAction === "resume" || e.primaryAction === "start")
    ?? list.find((e) => e.availabilityStatus === "in_progress")
    ?? list[0];
  return exam;
}

async function snapshot(cookie, attemptId) {
  const r = await req("GET", `/api/candidate/attempts/${attemptId}/take`, cookie);
  if (r.status !== 200) throw new Error(`take snapshot failed: ${r.status} ${r.text.slice(0, 200)}`);
  return r.json;
}

/** Discovery: 3 candidates → (attempt, question) save slots. */
async function discover() {
  const slots = [];
  for (const username of ["candidate1", "candidate2", "candidate3"]) {
    const cookie = await login(username);
    const exam = await primaryExam(cookie);
    let attemptId = exam.latestAttemptId;
    if (exam.primaryAction === "start" || !attemptId) {
      const s = await req("POST", `/api/attempts/${exam.examId}/start`, cookie);
      if (s.status !== 200 && s.status !== 201)
        throw new Error(`start failed for ${username}: ${s.status} ${s.text.slice(0, 200)}`);
      attemptId = s.json.id ?? s.json.attemptId;
    }
    let snap = await snapshot(cookie, attemptId);
    if (snap.attemptStatus !== "in_progress") {
      // resumable/disrupted attempts reject heartbeat & transitions until
      // restored — the real client resumes through the same restore route.
      const res = await req("POST", `/api/attempts/${attemptId}/restore`, cookie);
      if (res.status !== 200)
        throw new Error(`restore failed for ${username}: ${res.status} ${res.text.slice(0, 200)}`);
      snap = await snapshot(cookie, attemptId);
    }
    snap.questions.forEach((q, idx) => {
      slots.push({
        owner: username, cookie, attemptId, attemptStatus: snap.attemptStatus,
        questionId: q.id, qtype: q.type, optionIds: (q.options ?? []).map((o) => o.id),
        version: q.currentVersion ?? 0,
        // high, per-run disjoint clientSeq base: the seed and probes already
        // populated the low seq range; collisions there are idempotent replays
        // (accepted:true with no new receipt) and would poison write counts.
        clientSeq: 500000 + REP * 100000 + slots.length * 50 + idx,
      });
    });
  }
  return slots;
}

function nextAnswer(slot) {
  switch (slot.qtype) {
    case "single_choice":
      return slot.optionIds[slot.clientSeq % Math.max(1, slot.optionIds.length)] ?? "A";
    case "multiple_choice":
      return slot.optionIds.slice(0, 2);
    case "true_false":
      return slot.clientSeq % 2 === 0;
    default:
      // fill_blank (single_line) / text_response: plain string payload
      return `perf-blank-${slot.clientSeq}`;
  }
}

/* ---------------- metrics plumbing ---------------- */

function serverChildPid() {
  const launcher = Number(fs.readFileSync(`/tmp/perf-ab/logs/${VARIANT}.pid`, "utf8").trim());
  const children = fs.readFileSync(`/proc/${launcher}/task/${launcher}/children`, "utf8").trim();
  const first = Number(children.split(" ")[0]);
  if (!Number.isFinite(first) || first <= 0) throw new Error("no server child pid");
  return first;
}

function cpuJiffies(pid) {
  const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
  // field 14 utime, 15 stime (1-indexed after comm in parens)
  const rest = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  return Number(rest[11]) + Number(rest[12]); // utime + stime
}

const PINO_LOG = `/tmp/perf-ab/logs/${VARIANT}.pino.log`;
function logStat() {
  const st = fs.statSync(PINO_LOG);
  return { size: st.size, mtime: st.mtimeMs };
}

function psql(sql) {
  return execSync(
    `docker exec exam-dev-db-1 psql -U exam -d ${CFG.db} -tA -F'|' -c ${JSON.stringify(sql)}`,
    { encoding: "utf8" },
  ).trim();
}

function pgSnapshot() {
  const rows = psql(
    "SELECT xact_commit, xact_rollback, tup_inserted, tup_updated, tup_deleted " +
      "FROM pg_stat_database WHERE datname = '" + CFG.db + "'",
  );
  const [xc, xr, ti, tu, td] = rows.split("|").map(Number);
  return { xact_commit: xc, xact_rollback: xr, tup_inserted: ti, tup_updated: tu, tup_deleted: td };
}

function tableCounts() {
  const out = {};
  for (const t of ["exam_answer_save_receipts", "client_events", "audit_logs", "exam_attempts"]) {
    out[t] = Number(psql(`SELECT count(*) FROM ${t}`));
  }
  return out;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

/* ---------------- phase drivers ---------------- */

class Recorder {
  constructor() {
    this.lat = [];
    this.statuses = {};
    this.errBytes = 0;
    this.resBytes = 0;
    this.headerRequestIdPresent = 0;
    this.acceptedTrue = 0;
    this.acceptedFalse = 0;
    this.rejectReasons = {};
    this.recording = false;
  }
  observe(r, t0) {
    this.resBytes += (r.text ?? "").length;
    if (this.recording) {
      this.lat.push(performance.now() - t0);
      this.statuses[r.status] = (this.statuses[r.status] ?? 0) + 1;
      if (r.requestId) this.headerRequestIdPresent++;
      const j = r.json;
      if (j && typeof j === "object") {
        if (j.accepted === true) this.acceptedTrue++;
        if (j.accepted === false) {
          this.acceptedFalse++;
          const reason = j.reason ?? "UNKNOWN";
          this.rejectReasons[reason] = (this.rejectReasons[reason] ?? 0) + 1;
        }
      }
    }
  }
}

async function driveLoop(stopAt, worker, rec) {
  while (performance.now() < stopAt) {
    const t0 = performance.now();
    const r = await worker();
    rec.observe(r, t0);
  }
}

/** Runs one phase: warmup + measured window, metrics at boundaries. */
async function runPhase(name, concurrency, workerFactory, ctx) {
  const rec = new Recorder();
  const ctxList = Array.isArray(ctx) ? ctx : [ctx];
  const workers = Array.from(
    { length: concurrency },
    (_, i) => workerFactory(ctxList[i % ctxList.length]),
  );
  // warmup (not recorded)
  rec.recording = false;
  const warmStop = performance.now() + WARMUP_MS;
  await Promise.all(workers.map((w) => driveLoop(warmStop, w, rec)));
  // boundary + measured window
  await new Promise((r) => setTimeout(r, 200));
  const pid = serverChildPid();
  const cpu0 = cpuJiffies(pid);
  const log0 = logStat();
  const pg0 = pgSnapshot();
  const tc0 = tableCounts();
  const t0Wall = Date.now();
  rec.recording = true;
  const stop = performance.now() + MEASURE_MS;
  await Promise.all(workers.map((w) => driveLoop(stop, w, rec)));
  const t1Wall = Date.now();
  await new Promise((r) => setTimeout(r, SETTLE_MS));
  const cpu1 = cpuJiffies(pid);
  const log1 = logStat();
  const pg1 = pgSnapshot();
  const tc1 = tableCounts();

  const latSorted = [...rec.lat].sort((a, b) => a - b);
  const n = rec.lat.length;
  const phase = {
    variant: VARIANT, rep: REP, phase: name, concurrency,
    wall_ms: t1Wall - t0Wall, ts0: t0Wall, ts1: t1Wall,
    n, rps: n / ((t1Wall - t0Wall) / 1000),
    statuses: rec.statuses,
    acceptedTrue: rec.acceptedTrue, acceptedFalse: rec.acceptedFalse,
    rejectReasons: rec.rejectReasons,
    headerRequestIdPresent: rec.headerRequestIdPresent,
    p50: percentile(latSorted, 50), p95: percentile(latSorted, 95), p99: percentile(latSorted, 99),
    latMin: latSorted[0] ?? null, latMax: latSorted[latSorted.length - 1] ?? null,
    cpuJiffies: cpu1 - cpu0, cpuMsPerReq: ((cpu1 - cpu0) * 10) / Math.max(1, n),
    pinoBytes: log1.size - log0.size,
    pinoBytesPerReq: (log1.size - log0.size) / Math.max(1, n),
    pg: {
      xact_commit: pg1.xact_commit - pg0.xact_commit,
      xact_rollback: pg1.xact_rollback - pg0.xact_rollback,
      tup_inserted: pg1.tup_inserted - pg0.tup_inserted,
      tup_updated: pg1.tup_updated - pg0.tup_updated,
      tup_deleted: pg1.tup_deleted - pg0.tup_deleted,
    },
    xactPerReq: (pg1.xact_commit - pg0.xact_commit) / Math.max(1, n),
    tables: Object.fromEntries(
      Object.keys(tc1).map((k) => [k, tc1[k] - tc0[k]]),
    ),
  };
  console.log(
    `[${VARIANT} rep${REP}] ${name}: n=${n} rps=${phase.rps.toFixed(1)} ` +
      `p50=${phase.p50?.toFixed(1)} p95=${phase.p95?.toFixed(1)} p99=${phase.p99?.toFixed(1)} ` +
      `cpu=${phase.cpuMsPerReq.toFixed(2)}ms/req pino=${phase.pinoBytesPerReq.toFixed(1)}B/req ` +
      `xact/req=${phase.xactPerReq.toFixed(2)} receipts=${phase.tables.exam_answer_save_receipts} ` +
      `ce=${phase.tables.client_events} statuses=${JSON.stringify(phase.statuses)} ` +
      `accT=${phase.acceptedTrue} accF=${phase.acceptedFalse}`,
  );
  return phase;
}

/* ---------------- workers ---------------- */

function saveAnswerWorker(slotRef, { mode }) {
  // mode "chain": version-chained accepted:true saves (resync on unexpected reject)
  // mode "reject": baseVersion far in the future -> accepted:false FUTURE_VERSION
  return async () => {
    const s = slotRef.slot;
    s.clientSeq += 1;
    const body = {
      attemptId: s.attemptId,
      questionId: s.questionId,
      answer: nextAnswer(s),
      clientSeq: s.clientSeq,
      clientSavedAt: new Date().toISOString(),
      baseVersion: mode === "reject" ? s.version + 999 : s.version,
    };
    const r = await req(
      "POST",
      `/api/attempts/${s.attemptId}/answers/${s.questionId}`,
      s.cookie, body,
    );
    if (mode === "chain" && r.json && typeof r.json === "object") {
      if (r.json.accepted === true && Number.isInteger(r.json.serverVersion)) {
        s.version = r.json.serverVersion;
      } else if (r.json.accepted === false && Number.isInteger(r.json.serverVersion)) {
        s.version = r.json.serverVersion; // resync after conflict, keep chaining
      }
    }
    return r;
  };
}

function eventsWorker(slotRef, { routeMode }) {
  let i = 0;
  return async () => {
    const s = slotRef.slot;
    i += 1;
    const events = Array.from({ length: 10 }, (_, k) => ({
      kind: "log",
      level: "info",
      name: "perf.load.event",
      occurredAt: new Date().toISOString(),
      route:
        routeMode === "safe"
          ? `/exam/${s.attemptId}/take`
          : `/totally/unknown/seg${i % 97}/seg${k}/deep?q=${i}`,
      attemptId: s.attemptId,
      metadata: { i, k },
    }));
    return req("POST", "/api/client-events", s.cookie, { events });
  };
}

function getWorker(slotRef) {
  return async () => req("GET", `/api/attempts/${slotRef.slot.attemptId}`, slotRef.slot.cookie);
}

function heartbeatWorker(slotRef) {
  return async () => req("POST", `/api/attempts/${slotRef.slot.attemptId}/heartbeat`, slotRef.slot.cookie);
}

function httpErrWorker(slotRef) {
  return async () => req("GET", `/api/perf/no-such-route-${slotRef.slot.clientSeq % 7}`, slotRef.slot.cookie);
}

/* ---------------- main ---------------- */

const slots = await discover();
console.log(`[${VARIANT}] discovered ${slots.length} save slots across 3 candidates`);
fs.writeFileSync(path.join(OUTDIR, `discovery-${VARIANT}-rep${REP}.json`), JSON.stringify({
  variant: VARIANT,
  slots: slots.map((s) => ({ owner: s.owner, attemptId: s.attemptId, questionId: s.questionId, type: s.qtype, version: s.version, status: s.attemptStatus })),
}, null, 2));

const phases = [];
const slotRefs = slots.map((slot) => ({ slot }));

// workerFactory(slotRef) is called once per concurrent worker.
const byOwner = new Map();
for (const s of slots) {
  if (!byOwner.has(s.owner)) byOwner.set(s.owner, []);
  byOwner.get(s.owner).push(s);
}
// One lane per attempt: round-robins that attempt's questions, chaining
// per-question versions (matches the domain's per-attempt serialization).
function attemptLaneWorker(ownerSlots) {
  let i = -1;
  return async () => {
    i = (i + 1) % ownerSlots.length;
    const s = ownerSlots[i];
    s.clientSeq += 1;
    const body = {
      attemptId: s.attemptId,
      questionId: s.questionId,
      answer: nextAnswer(s),
      clientSeq: s.clientSeq,
      clientSavedAt: new Date().toISOString(),
      baseVersion: s.version,
    };
    const r = await req("POST", `/api/attempts/${s.attemptId}/answers/${s.questionId}`, s.cookie, body);
    if (r.json && typeof r.json === "object" && Number.isInteger(r.json.serverVersion)) {
      if (r.json.accepted === true || r.json.accepted === false) s.version = r.json.serverVersion;
    }
    return r;
  };
}
const ownerLanes = [...byOwner.values()]; // 3 lanes, one per candidate attempt

phases.push(await runPhase("answers-c1", 1, () => saveAnswerWorker({ slot: slots[0] }, { mode: "chain" }), null));
phases.push(await runPhase("answers-c3", 3, (grp) => attemptLaneWorker(grp), ownerLanes));
phases.push(await runPhase("answers-c8", 8, (s) => saveAnswerWorker(s, { mode: "chain" }), slotRefs.slice(0, 8)));
phases.push(await runPhase("reject-c8", 8, (s) => saveAnswerWorker(s, { mode: "reject" }), slotRefs.slice(8, 16)));
phases.push(await runPhase("events-safe-c8", 8, (s) => eventsWorker(s, { routeMode: "safe" }), slotRefs.slice(0, 8)));
phases.push(await runPhase("events-miss-c8", 8, (s) => eventsWorker(s, { routeMode: "miss" }), slotRefs.slice(8, 16)));
phases.push(await runPhase("get-c8", 8, (s) => getWorker(s), slotRefs.slice(0, 8)));
phases.push(await runPhase("heartbeat-c3", 3, (s) => heartbeatWorker(s), byOwner ? [...byOwner.values()].map((g) => ({ slot: g[0] })) : []));
phases.push(await runPhase("httperr-c8", 8, (s) => httpErrWorker(s), slotRefs.slice(0, 8)));

fs.writeFileSync(
  path.join(OUTDIR, `phases-${VARIANT}-rep${REP}.json`),
  JSON.stringify({ variant: VARIANT, rep: REP, generatedAt: new Date().toISOString(), phases }, null, 2),
);
console.log(`[${VARIANT} rep${REP}] done -> ${path.join(OUTDIR, `phases-${VARIANT}-rep${REP}.json`)}`);
process.exit(0);
