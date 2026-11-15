#!/usr/bin/env node
/**
 * otel-w964 workflow-attribution benchmark harness (runner).
 *
 * Implements docs/research/observability-workflow-audit/PROTOCOL.md (v1) for
 * the H1/H2/H3/H4 + S0/S1/S2 config set: manifest-driven A/B rounds with one
 * clean server process per (round, config) segment, deterministic re-seed via
 * the repo's own E2E seed lifecycle, a mixed C1-C7 workload (PROTOCOL §3.1),
 * external /proc-based CPU/RSS measurement (PROTOCOL §5), per-op client-side
 * oracles (§4.2), DB terminal-state validation, paired-delta aggregation with
 * the fixed-seed bootstrap CI (§6.3), CPU/heap profiling, and a selftest.
 *
 * Dependencies: Node builtins only. The PostgreSQL driver (`postgres`) is
 * resolved from the repo's existing workspace dependency tree via
 * createRequire (packages/db) — no new package is installed, package.json is
 * never edited. Database lifecycle goes through repo-semantic paths only:
 * `pnpm db:up` owns the PG server (testing.md §2.8), the repo E2E seed entry
 * (`apps/api/src/e2e-seed.ts`, scripts/e2e/run.sh:737 precedent) owns
 * reset+migrate+seed+verify, and guard-checked direct SQL does benchmark-only
 * state prep (PROTOCOL §4.1 explicitly sanctions direct test-DB backdate and
 * state preparation; all business operations run through the HTTP API). The
 * only database ever touched is exam_e2e_w964 (§2.8 E2E worker-DB family,
 * full-reset allowlist in packages/db/src/scripts/destructiveDbNameGuard.ts;
 * slot 964 > the E2E runner's 16-shard cap, so scripts/e2e can never collide).
 * Every connection target is verified with SELECT current_database() before
 * any operation phase — dev `exam` is unreachable by construction
 * (APP_MODE=e2e + TEST_DATABASE_URL only, scripts/e2e/run.sh:155-163 model).
 *
 * Measurement methods (PROTOCOL §5 channels):
 *   - CPU time/op: /proc/<pid>/stat field diff (utime+stime, Linux
 *     USER_HZ=100) across the steady window ÷ steady ops. Black-box.
 *   - RSS: /proc/<pid>/status VmRSS sampled every 1s; summary rssMb is the
 *     steady-window mean; samples.json keeps the full series (slope, max).
 *   - GC: NOT enabled in perf segments — NODE_OPTIONS is scrubbed at launch
 *     because --trace-gc has runtime overhead (PROTOCOL §5 marks it as a
 *     dedicated-channel flag only, never a perf-segment sample).
 *   - Span evidence: H3 TELEMETRY_MEMORY_DUMP_FILE shutdown JSONL witness
 *     (apps/api/src/telemetry/runtime.ts writeMemoryDumpIfConfigured).
 *   - H4 export volume: otlp-sink.js counters (requests/bytes per path).
 *   - Interference: /proc/loadavg per sample (§6.5 hard exclusion at >4.0)
 *     plus monotonic-clock sanity per tick (§6.5 >1s clock jump).
 *
 * Low-frequency legs (PROTOCOL §3.1 budgeted separately, excluded from p99):
 *   - W09: 200 pre-backdated stale attempts auto-submitted by the deadline
 *     scanner; reconciled from DB terminal state in `validate`.
 *   - W11: 10k ≥30d client-events seeded pre-start; the retention plugin's
 *     startup convergence pass (clientEventRetention.ts runPass() at
 *     registration) deletes them; reconciled from DB in `validate`.
 *   - W12 drain: fake-transport outbox loop drains asynchronously; `validate`
 *     asserts total==quota and dead==0; the sent fraction is time-dependent
 *     and reported, not asserted.
 *
 * CLI (exact; the markers are the machine contract, always the LAST line):
 *   runner.js selftest
 *   runner.js round    --manifest <p> --round N --configs A,B[,...] [--concurrency N]
 *   runner.js validate --round N
 *   runner.js aggregate
 *   runner.js profile  --config X --out <dir>
 *
 * The presence of this harness does NOT authorize Stage D-G sampling
 * (PROTOCOL "角色与授权": execution is separately authorized).
 */

import { createRequire } from "node:module";
import net from "node:net";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
  createWriteStream,
} from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID, createHash } from "node:crypto";

// ── 0. constants ─────────────────────────────────────────────────────────

const HERE = pathResolve(dirname(new URL(import.meta.url).pathname));
// v3 data root. The v1 root (out/otel-w964/workflow-audit) holds the R1/R2
// audit evidence and is READ-ONLY from this harness version on — every new
// write (rounds, pilot, campaign, aggregate, registers) lands in v3.
const OUT_ROOT = pathResolve(HERE, "../../../out/otel-w964/workflow-audit-v3");
const ROUNDS_DIR = join(OUT_ROOT, "rounds");
const BOOT_WAIT_MS = 60_000;
const READY_WAIT_MS = 30_000;
const STARTUP_LEGS_WAIT_MS = 30_000; // W11 retention startup-pass window
const SHUTDOWN_BUDGET_MS = 30_000; // PROTOCOL §7.3 T9 / ADR-028
const OP_TIMEOUT_MS = 30_000;
const PROC_SAMPLE_MS = 1_000;
const CLK_TCK = 100; // Linux USER_HZ (PROTOCOL §5 /proc channel)
// PROTOCOL-v4 §2 (Owner adjudication 2026-11-15, option c — external-
// increment redefinition, recorded for Owner review): the v2 §6.5-1
// in-segment bound 4.0 was measured structurally unachievable for this
// workload on this host — maxLoad1 4.86–6.72 at EVERY concurrency
// C∈{1,2,5,10,25,50,100,200} with throughput backend-saturated at
// ~9.7–11.3 ops/s independent of C (pilot register + H1 ladder evidence).
// The interference criterion is now an EXTERNAL INCREMENT over the
// workload's own measured self-load baseline; the absolute cap below is
// the fail-closed backstop. BOTH must hold; either breach voids the
// segment; a breach during formal sampling stops and escalates (no
// second relaxation).
const LOADAVG_HARD_LIMIT = 8.0; // PROTOCOL-v4 §2 in-segment absolute cap
// Entry quiet-machine discipline stays at the v2 §6.5-1 value — PROTOCOL-v4
// redefines only the IN-SEGMENT criterion (external increment over B_self);
// the entry gate is unchanged and NOT relaxed (selftest 5f pins this).
const INTERFERENCE_ENTRY_LIMIT = 4.0; // entry gate (precheck item 4 / §6.1)
const SELF_LOAD_BASELINE = 6.8; // PROTOCOL-v4 §2 B_self: measured clean-condition self-load ceiling (max observed 6.72 covered)
const EXTERNAL_LOAD_INCREMENT_LIMIT = 1.5; // PROTOCOL-v4 §2 maxLoad1 − B_self
const CLOCK_JUMP_LIMIT_MS = 1_000; // PROTOCOL §6.5 hard exclusion
const BOOTSTRAP_RESAMPLES = 10_000; // PROTOCOL §6.3 (frozen)
const BOOTSTRAP_SEED = 20261115; // PROTOCOL §6.3 (frozen)
const BASELINE_CONFIG = "H1";
const CONFIG_ORDER = ["H1", "H2", "H3", "H4", "S0", "S1", "S2"];
// Budget for the first /proc sample after sampler registration, in ticks.
// The sampler samples immediately at registration; this budget only guards
// against a dead PID or a starved event loop (fail-closed, R2-01).
const FIRST_SAMPLE_BUDGET_TICKS = 5;
// Workflow dimension of a segment (PROTOCOL-v3 draft): the mixed C1-C7
// stream, or a single-class isolated stream. aggregateCore emits one row
// group per workflow; "mixed" is the acceptance gear, iso-* rows feed the
// quantile report face and never T1-T4.
const WORKFLOW_ORDER = ["mixed", "iso-C1", "iso-C3", "iso-C5"];
// Isolated gears (PROTOCOL-v3 draft): single-class quota projections of the
// frozen mixed quotas. v3 narrows isolation to the three classes the
// attribution question needs — health (C1), save-accepted (C3),
// submit-grade (C5).
const ISO_CLASSES = [
  { workflow: "iso-C1", quotaKeys: ["c1Health", "c1Ready"] },
  { workflow: "iso-C3", quotaKeys: ["c3SaveAccepted"] },
  { workflow: "iso-C5", quotaKeys: ["c5SubmitFresh", "c5SubmitDuplicate"] },
];
// Campaign suites (PROTOCOL-v3 draft). mixed = the full system-cost suite
// over H0/H1/H2/H3/H4 (H0 gated by the §6.6-3 oracle-equivalence register,
// gate item 7 — fail-closed until that register exists); isolated = the
// single-workflow isolation suite over H1/H2/H4 × the three v3 classes;
// knee = capacity-knee suite over H1/H4 under GRADIENT load (a small ladder
// bracketing K_pilot, not a single gear). knee gear concurrency comes from
// the pilot register (K_pilot); gradient bracket = [⌊K/2⌋, K, min(2K, 200)].
const SUITES = {
  mixed: { configs: ["H0", "H1", "H2", "H3", "H4"], workflow: "mixed" },
  isolated: {
    configs: ["H1", "H2", "H4"],
    workflow: "isolated",
    classes: ISO_CLASSES,
  },
  knee: { configs: ["H1", "H4"], workflow: "mixed", gradient: true },
};
// Knee gradient bracket around K_pilot (PROTOCOL-v3 draft): one gear below,
// the knee itself, one gear above — capped at the pilot ladder's sane ceiling
// and deduped so tiny/limits values collapse cleanly.
function kneeGradientGears(kPilot) {
  const gears = [
    Math.max(1, Math.floor(kPilot / 2)),
    kPilot,
    Math.min(2 * kPilot, PILOT_GEARS.at(-1)),
  ];
  return [...new Set(gears)].sort((a, b) => a - b);
}
const CAMPAIGN_VALID_TARGET = 6; // §6.2: >=6 valid paired replicates per unit
const CAMPAIGN_ATTEMPT_CAP = 8; // stop rule: 6 valid or 8 attempts, whichever first
// Closed-loop throughput semantics (PROTOCOL-v3 draft): the client runs C
// fixed workers over one finite op plan, so ops/s = C / mean latency — a
// saturation metric under fixed concurrency, NOT an open-loop
// constant-arrival-rate latency measurement. Every segment summary carries
// this label so downstream readers cannot misread ops/s as arrival-driven.
const CLOSED_LOOP_SEMANTICS =
  "closed-loop: C fixed workers over a finite plan, ops/s = C/latency — NOT constant-arrival-rate latency";

// ── 1. small utilities ───────────────────────────────────────────────────

function sha256Hex(s) {
  return createHash("sha256").update(s).digest("hex");
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleSeeded(arr, rand) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[idx];
}

function mean(xs) {
  if (xs.length === 0) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function median(xs) {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function segmentRand(seedToken, round, config, phase) {
  const h = sha256Hex(`${seedToken}:r${round}:${config}:${phase}`);
  return mulberry32(Number.parseInt(h.slice(0, 8), 16));
}

/** Percentile bootstrap CI of the median of paired deltas (fixed seed). */
function bootstrapCi(deltas, resamples, seed) {
  const rand = mulberry32(seed);
  const n = deltas.length;
  if (n === 0) return { low: null, high: null };
  const stats = new Array(resamples);
  const buf = new Array(n);
  for (let b = 0; b < resamples; b++) {
    for (let i = 0; i < n; i++) buf[i] = deltas[Math.floor(rand() * n)];
    stats[b] = median(buf);
  }
  const sorted = stats.sort((a, b) => a - b);
  const loIdx = Math.floor(resamples * 0.025);
  const hiIdx = Math.min(resamples - 1, Math.ceil(resamples * 0.975) - 1);
  return { low: sorted[loIdx], high: sorted[hiIdx] };
}

/**
 * Aggregate core — pure so the selftest can exercise it on fixed input.
 * rounds: [{round, segments: [{config, valid, workflow?, summary}]}]
 *
 * Workflow-aware (R2-04 fix): rows are grouped per workflow dimension — the
 * mixed C1-C7 gear and every isolated class label — instead of hardcoding
 * `workflow: "mixed"`. Pairs are only formed WITHIN the same workflow and
 * the same round; a segment without an explicit workflow label is treated
 * as mixed (v1 summaries stay aggregable). The baseline is excluded from
 * rows per workflow group.
 */
function aggregateCore(rounds, { baseline = BASELINE_CONFIG } = {}) {
  const notes = [];
  const byRound = new Map(); // round -> Map(workflow -> {config: summary})
  for (const r of rounds) {
    const valid = new Map();
    for (const seg of r.segments) {
      if (!(seg.valid && seg.summary)) continue;
      const wf = seg.workflow ?? seg.summary.workflow ?? "mixed";
      if (!valid.has(wf)) valid.set(wf, {});
      valid.get(wf)[seg.config] = seg.summary;
    }
    byRound.set(r.round, valid);
  }
  // Known workflows keep PROTOCOL order; unseen labels (future gears) are
  // appended in first-seen order so nothing is silently dropped.
  const workflowOrder = [...WORKFLOW_ORDER];
  for (const [, valid] of byRound)
    for (const wf of valid.keys())
      if (!workflowOrder.includes(wf)) workflowOrder.push(wf);

  const rows = [];
  for (const workflow of workflowOrder) {
    const present = new Set();
    for (const [, valid] of byRound)
      for (const c of Object.keys(valid.get(workflow) ?? {})) present.add(c);
    present.delete(baseline);

    for (const config of CONFIG_ORDER.filter((c) => present.has(c))) {
      const pairs = { cpu: [], p50: [], p95: [], p99: [], rss: [] };
      for (const [, valid] of byRound) {
        const wfSegs = valid.get(workflow) ?? {};
        const base = wfSegs[baseline];
        const cfg = wfSegs[config];
        if (!base || !cfg) continue;
        pairs.cpu.push(
          ((cfg.cpuMsPerOp - base.cpuMsPerOp) / base.cpuMsPerOp) * 100,
        );
        pairs.p50.push(((cfg.p50Ms - base.p50Ms) / base.p50Ms) * 100);
        pairs.p95.push(((cfg.p95Ms - base.p95Ms) / base.p95Ms) * 100);
        pairs.p99.push(((cfg.p99Ms - base.p99Ms) / base.p99Ms) * 100);
        pairs.rss.push(cfg.rssMb - base.rssMb);
      }
      const cpuDeltas = pairs.cpu;
      const n = cpuDeltas.length;
      const ci = bootstrapCi(cpuDeltas, BOOTSTRAP_RESAMPLES, BOOTSTRAP_SEED);
      const round3 = (x) => (x === null ? null : +x.toFixed(3));
      rows.push({
        workflow,
        config,
        comparable: n > 0,
        cpuDeltaPct: round3(median(cpuDeltas)),
        cpuRangePct:
          n > 0
            ? [round3(Math.min(...cpuDeltas)), round3(Math.max(...cpuDeltas))]
            : null,
        p50DeltaPct: round3(median(pairs.p50)),
        p95DeltaPct: round3(median(pairs.p95)),
        p99DeltaPct: round3(median(pairs.p99)),
        rssDeltaMb: round3(median(pairs.rss)),
        ciLow: round3(ci.low),
        ciHigh: round3(ci.high),
        n,
      });
    }
  }

  notes.push(
    `baseline=${baseline}; every row is the paired relative delta vs the same-round ${baseline} segment of the SAME workflow dimension (PROTOCOL §6.3/§7.1); the baseline itself is excluded from rows.`,
  );
  notes.push(
    "ciLow/ciHigh = bootstrap 95% CI of the median paired CPU delta (10,000 resamples, percentile method, fixed seed 20261115, PROTOCOL §6.3). cpuRangePct = paired-delta min–max.",
  );
  notes.push(
    "comparable=false / n=0: no same-round valid baseline pair yet. PROTOCOL §6.4: fewer than 6 valid pairs is UNKNOWN, not PASS; CI containing 0 must be reported INCONCLUSIVE, never 'zero cost'.",
  );
  notes.push(
    "All numbers are WSL2 exploration-grade (PROTOCOL §2 boundary declaration): mechanism attribution only, never production capacity.",
  );
  notes.push(
    "Workflow dimension: mixed = C1-C7 mixed stream (T1-T4 acceptance); iso-* = single-class isolated segments (§3.2/§7.1 quantile report face, never T1-T4). Cross-workflow pairing never happens.",
  );
  return { rows, notes, workflows: workflowOrder };
}

// ── 2. manifest ──────────────────────────────────────────────────────────

// R2-06 portability contract: configs.json carries NO machine-specific
// absolute paths. sourceDir values are repo-root relative ("." = the
// checkout that contains this harness) or ${ENV_NAME} templates resolved at
// load time; the RESOLVED absolute paths are per-run facts and land in
// OUT_ROOT/run-meta/, never back into the manifest. Absolute values remain
// readable for legacy explicit --manifest files (resolved as-is), while the
// selftest portability guard forbids them in the repo-owned configs.json.
const SOURCE_DIR_ENV_TEMPLATE = /^\$\{([A-Z0-9_]+)\}$/;

function resolveSourceDir(value, repoRoot, label) {
  const raw = String(value);
  const tmpl = SOURCE_DIR_ENV_TEMPLATE.exec(raw);
  if (tmpl) {
    const envName = tmpl[1];
    const fromEnv = process.env[envName];
    if (fromEnv && fromEnv.trim() !== "") return pathResolve(fromEnv.trim());
    if (envName === "EXAM_OTEL_H0_SOURCE_DIR") {
      // repo convention: the pre-OTel v0.0.15 checkout is a sibling worktree
      // of the audit tree; env override wins when the layout differs
      return pathResolve(repoRoot, "../exam-otel-h0");
    }
    throw new Error(
      `${label} sourceDir template ${raw} has no binding — set ${envName} or mount the expected checkout`,
    );
  }
  if (raw.startsWith("/")) return pathResolve(raw);
  return pathResolve(repoRoot, raw);
}

/**
 * Repo hygiene guard (R2-06): the COMMITTED configs.json must not carry
 * machine-specific absolute sourceDir values. Legacy explicit manifests may
 * (they resolve as-is); the repo-owned file may not.
 */
function manifestPortabilityProblems(manifestPath) {
  let raw;
  try {
    raw = readFileSync(manifestPath, "utf8");
  } catch (err) {
    return [`manifest unreadable: ${String(err).slice(0, 120)}`];
  }
  const problems = [];
  const m = JSON.parse(raw);
  const check = (label, v) => {
    if (typeof v === "string" && v.startsWith("/")) {
      problems.push(
        `${label}.sourceDir "${v}" is an absolute machine-specific path — use "." / repo-relative or a \${ENV} template (R2-06)`,
      );
    }
  };
  check("manifest", m.sourceDir);
  for (const [name, c] of Object.entries(m.configs ?? {})) {
    check(`config ${name}`, c.sourceDir);
  }
  return problems;
}

function loadManifest(manifestPath) {
  const raw = readFileSync(manifestPath, "utf8");
  const m = JSON.parse(raw);
  // "." and repo-relative paths resolve against the checkout that owns the
  // manifest (configs.json lives at scripts/perf/otel-workflows/ → ../../..
  // is the repo root)
  const repoRoot = pathResolve(dirname(manifestPath), "../../..");
  m.sourceDir = resolveSourceDir(m.sourceDir, repoRoot, "manifest");
  for (const [name, c] of Object.entries(m.configs ?? {})) {
    c.sourceDir = resolveSourceDir(c.sourceDir, repoRoot, `config ${name}`);
  }
  const problems = validateManifestShape(m);
  if (problems.length > 0) {
    throw new Error(`invalid manifest ${manifestPath}: ${problems.join("; ")}`);
  }
  return m;
}

function validateManifestShape(m) {
  const problems = [];
  for (const k of ["sourceDir", "db", "configs", "sharedEnv", "workload"]) {
    if (m[k] === undefined) problems.push(`missing .${k}`);
  }
  if (!m.db || !/^exam_e2e(_w[0-9]+)?$/.test(m.db.name ?? "")) {
    problems.push(
      "db.name must match the §2.8 E2E worker-DB family (exam_e2e_w<N>)",
    );
  }
  const names = Object.keys(m.configs ?? {});
  for (const want of CONFIG_ORDER) {
    if (!names.includes(want)) problems.push(`missing config ${want}`);
  }
  const ports = new Set();
  for (const [name, c] of Object.entries(m.configs ?? {})) {
    for (const k of [
      "sourceDir",
      "buildArtifact",
      "startCommand",
      "port",
      "db",
      "env",
    ]) {
      if (c[k] === undefined) problems.push(`config ${name} missing .${k}`);
    }
    if (c.port !== undefined) {
      if (ports.has(c.port)) problems.push(`duplicate port ${c.port}`);
      ports.add(c.port);
    }
  }
  if (m.configs?.H1?.env?.TELEMETRY_ENABLED !== "false") {
    problems.push(
      "H1 must pin TELEMETRY_ENABLED=false (Off arm, PROTOCOL §1.1)",
    );
  }
  if (m.configs?.H2?.env?.TELEMETRY_ENABLED !== "true") {
    problems.push("H2 must pin TELEMETRY_ENABLED=true");
  }
  const ratio = (c) => m.configs?.[c]?.env?.TELEMETRY_SAMPLE_RATIO;
  if (ratio("S0") !== "0")
    problems.push("S0 must pin TELEMETRY_SAMPLE_RATIO=0 (PROTOCOL §1.3)");
  if (ratio("S1") !== "0.1")
    problems.push("S1 must pin TELEMETRY_SAMPLE_RATIO=0.1");
  if (ratio("S2") !== "1")
    problems.push("S2 must pin TELEMETRY_SAMPLE_RATIO=1");
  const h4 = m.configs?.H4?.env?.TELEMETRY_OTLP_ENDPOINT;
  if (!h4 || !/^http:\/\/127\.0\.0\.1:\$\{SINK_PORT\}$/.test(h4)) {
    problems.push(
      "H4 TELEMETRY_OTLP_ENDPOINT must pair with the ${SINK_PORT} template (runtimeConfig.ts:776-831 pair rule)",
    );
  }
  if (
    m.configs?.H3?.env?.TELEMETRY_MEMORY_DUMP_FILE !==
    "${SEGMENT_DIR}/telemetry-memory-dump.jsonl"
  ) {
    problems.push(
      "H3 must route TELEMETRY_MEMORY_DUMP_FILE into the segment dir",
    );
  }
  return problems;
}

// ── 3. database layer ────────────────────────────────────────────────────

let MANIFEST = null;
let _postgres = null;
/**
 * Directed-test seam: bind the module-global manifest without running main().
 * loadManifest stays side-effect free (offline tooling validates foreign
 * manifests); the CLI path assigns the same global in main().
 */
function setActiveManifest(m) {
  MANIFEST = m;
}
function requirePostgres() {
  if (_postgres) return _postgres;
  const req = createRequire(
    join(MANIFEST.sourceDir, "packages/db/package.json"),
  );
  _postgres = req("postgres");
  return _postgres;
}

function hostPort() {
  return Number(process.env.DB_HOST_PORT || MANIFEST.db.defaultHostPort);
}
// Per-config DB/seed lineage: a config that declares its own sourceDir/db
// (H0 = v0.0.15 tree + dedicated exam_e2e_w150 slot) is authoritative for
// converge and the DB target; the global manifest fields are the fallback
// for every config that shares the master lineage.
function configDbName(configName) {
  return MANIFEST.configs[configName]?.db ?? MANIFEST.db.name;
}
function configSourceDir(configName) {
  return MANIFEST.configs[configName]?.sourceDir ?? MANIFEST.sourceDir;
}
function dbUrlFor(configName) {
  return `postgresql://${MANIFEST.db.user}:${MANIFEST.db.password}@localhost:${hostPort()}/${configDbName(configName)}`;
}
function adminUrlFor() {
  return `postgresql://${MANIFEST.db.user}:${MANIFEST.db.password}@localhost:${hostPort()}/postgres`;
}

/** Open a connection and prove which database it actually landed on. */
async function openVerified(url, expectDbName) {
  const postgres = requirePostgres();
  const sql = postgres(url, { max: 6, connect_timeout: 10, idle_timeout: 5 });
  const rows = await sql`SELECT current_database() AS db`;
  const actual = rows[0]?.db;
  if (expectDbName && actual !== expectDbName) {
    await sql.end({ timeout: 3 });
    throw new Error(
      `connection landed on database "${actual}", expected "${expectDbName}" — refusing to operate (AGENTS.md §6: resolve, then touch)`,
    );
  }
  return sql;
}

async function ensureBenchDatabase(log, configName) {
  const target = configDbName(configName);
  if (!new RegExp(MANIFEST.db.nameGuard).test(target)) {
    throw new Error(`bench DB name "${target}" fails the manifest name guard`);
  }
  let missing = false;
  try {
    const sql = await openVerified(dbUrlFor(configName), target);
    log?.(`database ${target} present (current_database() verified)`);
    await sql.end({ timeout: 3 });
    return;
  } catch (err) {
    if (!/database\s+"[^"]+"\s+does not exist|3D000/.test(String(err)))
      throw err;
    missing = true;
  }
  if (missing) {
    const postgres = requirePostgres();
    const admin = postgres(adminUrlFor(), { max: 1, connect_timeout: 10 });
    try {
      await admin.unsafe(`CREATE DATABASE "${target}"`);
      log?.(
        `created test database ${target} (name-guarded, §2.8 e2e worker family)`,
      );
    } finally {
      await admin.end({ timeout: 3 });
    }
    const verify = await openVerified(dbUrlFor(configName), target);
    await verify.end({ timeout: 3 });
  }
}

/** Repo-owned reset+migrate+seed+demo+verify (scripts/e2e/run.sh:737 path). */
async function convergeSeed(url, logPath, configName) {
  const env = { ...process.env, TEST_DATABASE_URL: url, APP_MODE: "e2e" };
  delete env.DATABASE_URL;
  await runCommand(
    "pnpm",
    ["--filter", "@exam/api", "exec", "tsx", "src/e2e-seed.ts"],
    {
      cwd: configSourceDir(configName),
      env,
      logPath,
      timeoutMs: 600_000,
    },
  );
}

const BENCH = {
  // Must cover buildAttemptPlan's slots one-to-one (2820 for the frozen
  // mixed quotas) — pool isolation (B4) needs one attempt ROW per slot, and
  // post /start is resume semantics: a shared candidate means shared rows,
  // so submit/frozen/closed state prep would terminalize another pool's
  // hot/unchanged slot mid-window. 3000 also covers warmup logins
  // (c0901..c1800) beyond the historical 1200-user pool.
  candidates: 3000,
  teachers: 4,
  password: "otel-w964-bench-pass",
  examTitle: "bench-otel-w964-main",
  candidateName: (i) => `bench-c${String(i).padStart(4, "0")}`,
  teacherName: (i) => `bench-t${String(i).padStart(4, "0")}`,
};

async function getOrgId(sql) {
  const rows =
    await sql`SELECT id FROM organizations ORDER BY created_at LIMIT 1`;
  if (rows.length === 0)
    throw new Error("no organization row — run the e2e-seed converge first");
  return rows[0].id;
}

async function getBenchExamId(sql) {
  const orgId = await getOrgId(sql);
  const rows =
    await sql`SELECT id FROM exams WHERE organization_id = ${orgId} AND title = ${BENCH.examTitle} LIMIT 1`;
  return rows[0]?.id ?? null;
}

/**
 * Deterministic direct-SQL extension of the converged baseline (PROTOCOL
 * §4.1): bench users + role assignments + candidate profiles + teacher course
 * assignments + a cloned objective-only bench exam (auto-grade on submit) +
 * enrollments + the W11 retention fixture. Idempotent.
 */
async function extendSeed(sql, log, configName) {
  const orgId = await getOrgId(sql);
  const authReq = createRequire(
    join(configSourceDir(configName), "packages/auth/package.json"),
  );
  const argon2 = authReq("argon2");
  const passwordHash = await argon2.hash(BENCH.password, {
    type: argon2.argon2id,
  });

  const users = [];
  for (let i = 1; i <= BENCH.candidates; i++) {
    users.push({
      username: BENCH.candidateName(i),
      role: "Candidate",
      email: `${BENCH.candidateName(i)}@bench.example.local`,
    });
  }
  for (let i = 1; i <= BENCH.teachers; i++) {
    users.push({
      username: BENCH.teacherName(i),
      role: "Teacher",
      email: null,
    });
  }
  const userIds = {};
  for (const u of users) {
    const existing =
      await sql`SELECT id FROM users WHERE organization_id = ${orgId} AND username = ${u.username} LIMIT 1`;
    if (existing.length > 0) {
      userIds[u.username] = existing[0].id;
      continue;
    }
    const id = randomUUID();
    userIds[u.username] = id;
    await sql`
      INSERT INTO users (id, organization_id, username, password_hash, name, role, is_active, email, auth_epoch, created_at, updated_at)
      VALUES (${id}, ${orgId}, ${u.username}, ${passwordHash}, ${u.username}, ${u.role}, true, ${u.email}, 0, now(), now())`;
    await sql`
      INSERT INTO user_role_assignments (id, organization_id, user_id, role, is_primary, is_active, created_at, updated_at)
      VALUES (${randomUUID()}, ${orgId}, ${id}, ${u.role}, true, true, now(), now())`;
    if (u.role === "Candidate") {
      await sql`
        INSERT INTO candidate_profiles (id, organization_id, user_id, fields, created_at, updated_at)
        VALUES (${randomUUID()}, ${orgId}, ${id}, '{}', now(), now())`;
    }
  }

  const demoOpen =
    await sql`SELECT * FROM exams WHERE organization_id = ${orgId} AND status = 'published' AND close_at > now() ORDER BY created_at LIMIT 1`;
  if (demoOpen.length === 0)
    throw new Error("no published open exam in the demo baseline to clone");
  const src = demoOpen[0];
  const objectiveTypes = new Set([
    "single_choice",
    "multiple_choice",
    "true_false",
    "fill_blank",
  ]);
  const snapshot = Array.isArray(src.question_snapshot)
    ? src.question_snapshot
    : [];
  const objective = snapshot.filter((q) => objectiveTypes.has(q.type));
  if (objective.length === 0)
    throw new Error("demo exam snapshot has no objective questions");

  let examId;
  const existingExam =
    await sql`SELECT id FROM exams WHERE organization_id = ${orgId} AND title = ${BENCH.examTitle} LIMIT 1`;
  if (existingExam.length > 0) {
    examId = existingExam[0].id;
  } else {
    examId = randomUUID();
    const row = { ...src };
    row.id = examId;
    row.title = BENCH.examTitle;
    row.description =
      "otel-w964 benchmark exam (objective-only clone of the demo open exam)";
    // QuestionSnapshot entries expose the source question id as
    // originalQuestionId (demo-seed snapshot builder), never questionId
    row.question_ids = objective.map((q) => q.originalQuestionId);
    row.question_snapshot = objective;
    row.max_attempts = 1000000;
    row.retake_policy = "unlimited";
    row.status = "published";
    row.open_at = new Date(Date.now() - 24 * 3600 * 1000);
    row.close_at = new Date(Date.now() + 30 * 24 * 3600 * 1000);
    row.sync_started_at = null;
    row.interruption_time_policy = "bounded_grace";
    row.interruption_grace_per_incident_seconds = 60;
    row.interruption_grace_per_attempt_seconds = 300;
    row.created_at = new Date();
    row.updated_at = new Date();
    delete row.results_published_at;
    await sql`INSERT INTO exams ${sql(row, Object.keys(row))}`;
    // teacher_course_assignments.assigned_by carries a FK to users(id) —
    // use the baseline admin as the assigner, never a free-form string
    const admin =
      await sql`SELECT id FROM users WHERE organization_id = ${orgId} AND username = 'admin' LIMIT 1`;
    if (admin.length === 0)
      throw new Error(
        "baseline admin user missing — converge seed must run first",
      );
    for (let i = 1; i <= BENCH.teachers; i++) {
      await sql`
        INSERT INTO teacher_course_assignments
          (id, organization_id, teacher_user_id, course_id, status, assigned_by, assigned_at, created_at, updated_at)
        VALUES (${randomUUID()}, ${orgId}, ${userIds[BENCH.teacherName(i)]}, ${row.course_id}, 'active', ${admin[0].id}, now(), now(), now())
        ON CONFLICT DO NOTHING`;
    }
  }

  for (const u of users.filter((x) => x.role === "Candidate")) {
    const profile =
      await sql`SELECT id FROM candidate_profiles WHERE organization_id = ${orgId} AND user_id = ${userIds[u.username]} LIMIT 1`;
    if (profile.length === 0)
      throw new Error(`candidate profile missing for ${u.username}`);
    await sql`
      INSERT INTO exam_enrollments (id, organization_id, exam_id, candidate_id, status, attempt_count, created_at, updated_at)
      VALUES (${randomUUID()}, ${orgId}, ${examId}, ${profile[0].id}, 'assigned', 0, now(), now())
      ON CONFLICT DO NOTHING`;
  }

  const fillUser = userIds[BENCH.candidateName(1)];
  const already =
    await sql`SELECT count(*)::int AS n FROM client_events WHERE organization_id = ${orgId} AND name = 'bench.retention-fill'`;
  const want = MANIFEST.workload.prepPool.oldClientEventsW11;
  if (already[0].n < want) {
    // client_events.id is an app-generated text PK (schema pg.ts `id()` has
    // no DB default) — synthesize uuid strings in the bulk insert
    await sql`
      INSERT INTO client_events (id, organization_id, user_id, kind, level, name, occurred_at, received_at, metadata)
      SELECT gen_random_uuid()::text, ${orgId}, ${fillUser}, 'log', 'info', 'bench.retention-fill',
             now() - interval '40 days', now() - interval '40 days', '{}'::jsonb
      FROM generate_series(1, ${want - already[0].n})`;
  }

  log?.(
    `extend-seed done (org=${orgId}, exam=${examId}, users=${users.length})`,
  );
  return { orgId, examId, userIds };
}

/**
 * Post-seed checksum: deterministic counts; all segments of a config must
 * match. The org id is a random per-converge surrogate key
 * (packages/db/src/seed.ts randomUUID), so it is reported for traceability
 * but kept OUT of the hash — otherwise every converge would checksum
 * differently and §6.5 hard exclusion 4 could never pass.
 */
async function seedChecksum(sql) {
  const orgId = await getOrgId(sql);
  const one = async (label, query) => [label, (await query)[0]?.n ?? 0];
  const countEntries = Object.fromEntries([
    await one(
      "benchUsers",
      sql`SELECT count(*)::int AS n FROM users WHERE username LIKE 'bench-%'`,
    ),
    await one(
      "benchProfiles",
      sql`SELECT count(*)::int AS n FROM candidate_profiles cp JOIN users u ON u.id = cp.user_id WHERE u.username LIKE 'bench-c%'`,
    ),
    await one(
      "benchExam",
      sql`SELECT count(*)::int AS n FROM exams WHERE title = ${BENCH.examTitle}`,
    ),
    await one(
      "benchEnrollments",
      sql`SELECT count(*)::int AS n FROM exam_enrollments e JOIN exams x ON x.id = e.exam_id WHERE x.title = ${BENCH.examTitle}`,
    ),
    await one(
      "clientEventsTotal",
      sql`SELECT count(*)::int AS n FROM client_events`,
    ),
    await one(
      "retentionFill",
      sql`SELECT count(*)::int AS n FROM client_events WHERE name = 'bench.retention-fill'`,
    ),
    await one("emailOutbox", sql`SELECT count(*)::int AS n FROM email_outbox`),
    await one(
      "passwordResetTokens",
      sql`SELECT count(*)::int AS n FROM password_reset_tokens`,
    ),
    await one(
      "examAttempts",
      sql`SELECT count(*)::int AS n FROM exam_attempts`,
    ),
    await one(
      "submitAudit",
      sql`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'attempt.submit'`,
    ),
    await one(
      "timeAdjustments",
      sql`SELECT count(*)::int AS n FROM attempt_time_adjustments`,
    ),
    await one(
      "interruptions",
      sql`SELECT count(*)::int AS n FROM attempt_interruptions`,
    ),
  ]);
  const entries = { ...countEntries, orgId };
  return { entries, sha256: sha256Hex(JSON.stringify(countEntries)) };
}

/** Disrupted-attempt state prep (PROTOCOL §4.1 direct test-DB writes). */
async function disruptAttempts(sql, orgId, attemptIds) {
  for (const attemptId of attemptIds) {
    const episodeId = randomUUID();
    // Replicates the heartbeat scanner's episode evidence chain
    // (exam-engine attemptCommands.ts disrupt path): episode parent +
    // detected event + pointer/transition. The restore validator requires
    // the detected event's occurredAt to EQUAL attempt.interruptedAt exactly
    // (getTime() compare), so both columns share one timestamp value.
    const interruptedAt = new Date(Date.now() - 5_000);
    const lastActivityAt = new Date(Date.now() - 15_000);
    // FK order: exam_attempts.current_interruption_id references
    // attempt_interruptions(id) — insert the episode FIRST, then point the
    // attempt at it (the episode's own FK to the attempt row is satisfied
    // because the attempt already exists)
    await sql`
      INSERT INTO attempt_interruptions (id, organization_id, attempt_id, created_at)
      VALUES (${episodeId}, ${orgId}, ${attemptId}, ${interruptedAt})`;
    await sql`
      INSERT INTO attempt_interruption_events
        (id, organization_id, attempt_id, interruption_id, event_type, occurred_at,
         observed_last_activity_at, detection_source, timeout_seconds, policy,
         eligible_seconds, time_adjustment_id, actor_id, reason_code, created_at)
      VALUES (${randomUUID()}, ${orgId}, ${attemptId}, ${episodeId}, 'detected', ${interruptedAt},
              ${lastActivityAt}, 'heartbeat_timeout', 7200, 'bounded_grace',
              null, null, null, 'heartbeat_timeout', ${interruptedAt})`;
    await sql`
      UPDATE exam_attempts SET
        status = 'disrupted',
        current_interruption_id = ${episodeId},
        interrupted_at = ${interruptedAt},
        last_activity_at = ${lastActivityAt},
        interruption_time_policy_snapshot = 'bounded_grace',
        interruption_grace_per_incident_seconds_snapshot = 60,
        interruption_grace_per_attempt_seconds_snapshot = 300,
        updated_at = now()
      WHERE id = ${attemptId} AND organization_id = ${orgId}`;
  }
}

async function backdateDeadline(sql, orgId, attemptIds, secondsAgo) {
  for (const attemptId of attemptIds) {
    await sql`
      UPDATE exam_attempts SET deadline_at = now() - (${secondsAgo} || ' seconds')::interval, updated_at = now()
      WHERE id = ${attemptId} AND organization_id = ${orgId}`;
  }
}

/**
 * Terminal-state capture for validate. Runs once per segment, immediately
 * after shutdown and BEFORE the next segment re-seeds (the next segment
 * destroys this state — the capture is the durable evidence).
 */
async function captureTerminalState(sql, hotIds) {
  const orgId = await getOrgId(sql);
  const counts = {};
  const one = async (label, query) => {
    counts[label] = (await query)[0]?.n ?? 0;
  };
  await one(
    "submitAuditTotal",
    sql`SELECT count(*)::int AS n FROM audit_logs WHERE action='attempt.submit'`,
  );
  await one(
    "deadlineSubmitted",
    sql`SELECT count(*)::int AS n FROM exam_attempts WHERE submission_reason='deadline' AND status IN ('submitted','graded')`,
  );
  await one(
    "boundedGraceAdjustments",
    sql`SELECT count(*)::int AS n FROM attempt_time_adjustments WHERE source='bounded_grace'`,
  );
  await one("outboxTotal", sql`SELECT count(*)::int AS n FROM email_outbox`);
  await one(
    "outboxSent",
    sql`SELECT count(*)::int AS n FROM email_outbox WHERE status='sent'`,
  );
  await one(
    "outboxDead",
    sql`SELECT count(*)::int AS n FROM email_outbox WHERE status='dead'`,
  );
  await one(
    "clientEventsTotal",
    sql`SELECT count(*)::int AS n FROM client_events`,
  );
  await one(
    "interruptionsTotal",
    sql`SELECT count(*)::int AS n FROM attempt_interruptions`,
  );
  await one(
    "attemptsInProgress",
    sql`SELECT count(*)::int AS n FROM exam_attempts WHERE status='in_progress'`,
  );
  const receiptRows = hotIds?.length
    ? await sql`
        SELECT attempt_id, count(*)::int AS receipts, max(client_seq)::int AS max_seq
        FROM exam_answer_save_receipts
        WHERE organization_id = ${orgId} AND attempt_id = ANY(${hotIds})
        GROUP BY attempt_id`
    : [];
  return {
    capturedAt: new Date().toISOString(),
    counts,
    hotReceipts: Object.fromEntries(
      receiptRows.map((r) => [
        r.attempt_id,
        { receipts: r.receipts, maxSeq: r.max_seq },
      ]),
    ),
  };
}

// ── 4. process layer ─────────────────────────────────────────────────────

function runCommand(cmd, args, { cwd, env, logPath, timeoutMs = 120_000 }) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(cmd, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      rejectPromise(new Error(`${cmd} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (out += d.toString()));
    child.on("error", (err) => {
      clearTimeout(timer);
      rejectPromise(err);
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      if (logPath) {
        try {
          writeFileSync(logPath, out);
        } catch {
          /* diagnostics only */
        }
      }
      if (code === 0) resolvePromise({ code, out });
      else
        rejectPromise(
          new Error(
            `${cmd} exited code=${code} signal=${signal}\n${out.slice(-4000)}`,
          ),
        );
    });
  });
}

function spawnServer(config, env, outPath, errPath) {
  const parts = config.startCommand.split(" ");
  const child = spawn(parts[0], parts.slice(1), {
    cwd: config.sourceDir,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  trackChild(child, parts.slice(1).join(" "));
  const out = createWriteStream(outPath, { flags: "a" });
  const err = createWriteStream(errPath, { flags: "a" });
  child.stdout.pipe(out);
  child.stderr.pipe(err);
  return { child, out, err };
}

// ── orphan-process defense ───────────────────────────────────────────────
// A killed/aborted runner used to leave its spawned API server (and sink)
// behind: they kept holding the manifest ports (3900-3907/4901) and kept
// burning CPU, which later surfaced both as port collisions and as an entry
// loadavg far above the §6.5 quiet-machine limit for the NEXT invocation.
// Two layers close that hole:
//   1. in-process: every long-lived child is tracked and SIGKILLed from the
//      runner's exit + SIGINT/SIGTERM/SIGHUP paths (own invocations of the
//      same signal handlers re-raise afterwards, preserving exit semantics);
//   2. cross-kill: a detached reaper polls this runner's PID and, once it is
//      gone (SIGKILL cannot run in-process handlers), SIGKILLs the pids
//      recorded in the per-runner state file — but only after verifying the
//      pid's /proc cmdline still carries this run's marker, so a reused pid
//      is never signalled.
const TRACKED_CHILDREN = new Map(); // pid -> { child, marker }
let orphanDefenseInstalled = false;
let childrenStateFile = null;

function childrenStatePath() {
  return (
    childrenStateFile ??
    join(OUT_ROOT, "run-meta", `children-${process.pid}.json`)
  );
}

function writeChildrenState() {
  if (!childrenStateFile) return;
  try {
    writeFileSync(
      childrenStateFile,
      JSON.stringify({
        runnerPid: process.pid,
        runnerCmd: process.argv[1] ?? "",
        childPids: [...TRACKED_CHILDREN.entries()].map(([pid, { marker }]) => ({
          pid,
          marker,
        })),
        updatedAt: new Date().toISOString(),
      }),
    );
  } catch {
    /* best-effort bookkeeping — kill paths must never fail because of it */
  }
}

function trackChild(child, marker) {
  TRACKED_CHILDREN.set(child.pid, { child, marker });
  child.once("exit", () => {
    TRACKED_CHILDREN.delete(child.pid);
    writeChildrenState();
  });
  writeChildrenState();
}

/** Synchronous — safe inside process.on("exit") where await is impossible. */
function killAllTrackedChildren(sig = "SIGKILL") {
  for (const { child } of TRACKED_CHILDREN.values()) {
    try {
      child.kill(sig);
    } catch {
      /* already gone */
    }
  }
}

function installOrphanDefense() {
  if (orphanDefenseInstalled) return;
  orphanDefenseInstalled = true;
  process.on("exit", () => {
    killAllTrackedChildren("SIGKILL");
    if (childrenStateFile) {
      try {
        unlinkSync(childrenStateFile);
      } catch {
        /* normal path already killed the children via exit handlers */
      }
    }
  });
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    const handler = () => {
      killAllTrackedChildren("SIGKILL");
      if (childrenStateFile) {
        try {
          unlinkSync(childrenStateFile);
        } catch {
          /* best-effort */
        }
      }
      // Restore the default disposition and re-raise so this process still
      // dies BY the signal (exit-code semantics preserved for callers) —
      // children are already SIGKILLed above.
      process.removeListener(sig, handler);
      process.kill(process.pid, sig);
    };
    process.on(sig, handler);
  }
}

/**
 * Detached watchdog for the case in-process handlers cannot cover: the
 * runner itself was SIGKILLed (workflow abort path). Polls the parent pid,
 * and on its death SIGKILLs the recorded child pids after verifying each
 * pid's /proc cmdline still carries the recorded marker (pid-reuse guard).
 */
function spawnParentDeathReaper() {
  mkdirSync(join(OUT_ROOT, "run-meta"), { recursive: true });
  childrenStateFile = childrenStatePath();
  writeChildrenState();
  const stateFile = childrenStateFile;
  const runnerCmd = process.argv[1] ?? "";
  const script = `const fs=require("fs");const ppid=${process.pid};const stateFile=${JSON.stringify(stateFile)};
const deadline=Date.now()+8*3600*1000;
const tick=()=>{let alive=true;try{const cmd=fs.readFileSync("/proc/"+ppid+"/cmdline","utf8");
if(!cmd.includes("runner.js"))alive=false;}catch{alive=false;}
if(alive){if(Date.now()>deadline){process.exit(0);}setTimeout(tick,2000);return;}
try{const st=JSON.parse(fs.readFileSync(stateFile,"utf8"));
for(const e of st.childPids||[]){try{const cmd=fs.readFileSync("/proc/"+e.pid+"/cmdline","utf8");
if(e.marker&&cmd.includes(e.marker.split(" ")[0]))process.kill(e.pid,"SIGKILL");}catch{}}}catch{}
process.exit(0);};
tick();`;
  const reaper = spawn(process.execPath, ["-e", script], {
    stdio: "ignore",
    detached: true,
  });
  reaper.unref();
  return reaper;
}

/**
 * Single-instance preflight: every API port this unit will bind must be
 * bindable BEFORE the gate runs. A port already in LISTEN means a previous
 * run's server (or an unrelated process) owns it — sampling would collide at
 * boot or silently share the machine with another experiment. Fail-closed,
 * with the owner pid when ss(8) can identify it.
 */
async function probePortBindable(port, { host = "127.0.0.1" } = {}) {
  return await new Promise((resolveProbe) => {
    const srv = net.createServer();
    srv.once("error", (err) => resolveProbe({ ok: false, code: err.code }));
    srv.once("listening", () => srv.close(() => resolveProbe({ ok: true })));
    srv.listen(port, host);
  });
}

async function portOwnerPid(port) {
  try {
    const { out } = await runCommand("ss", ["-ltnp"], { timeoutMs: 10_000 });
    const line = out
      .split("\n")
      .find((l) => l.includes(`:${port} `) && l.includes("LISTEN"));
    const m = line?.match(/pid=(\d+)/);
    return m ? Number(m[1]) : null;
  } catch {
    return null; // ss unavailable — report the collision without an owner
  }
}

async function preflightPortsProblems({
  ports,
  probe = probePortBindable,
  ownerLookup = portOwnerPid,
}) {
  const problems = [];
  for (const port of ports) {
    const r = await probe(port);
    if (!r.ok) {
      const owner = await ownerLookup(port);
      problems.push(
        `port ${port} already in use${owner ? ` (pid ${owner})` : ""} — a previous run's server or another process owns it; resolve the stale process before sampling (single-instance preflight, fail-closed)`,
      );
    }
  }
  return problems;
}

async function waitHttp(url, { okStatuses = [200], timeoutMs } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (okStatuses.includes(res.status)) return res;
    } catch {
      /* not up yet */
    }
    await sleep(300);
  }
  throw new Error(`timeout waiting for ${url}`);
}

/** External /proc sampler (PROTOCOL §5 channels). */
function startProcSampler(pid, outFile, tickMs = PROC_SAMPLE_MS) {
  const samples = [];
  let maxLoad1 = 0;
  let clockJump = false;
  let stopped = false;
  const tick = () => {
    if (stopped) return;
    const t0 = Date.now();
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const closeParen = stat.lastIndexOf(")");
      const fields = stat.slice(closeParen + 2).split(" ");
      const utime = Number(fields[11]); // field 14 (1-based)
      const stime = Number(fields[12]); // field 15 (1-based)
      let rssKb = null;
      try {
        const m = readFileSync(`/proc/${pid}/status`, "utf8").match(
          /^VmRSS:\s+(\d+)\s+kB/m,
        );
        if (m) rssKb = Number(m[1]);
      } catch {
        /* process gone */
      }
      const load1 = Number(readFileSync("/proc/loadavg", "utf8").split(" ")[0]);
      maxLoad1 = Math.max(maxLoad1, load1);
      samples.push({
        t: new Date(t0).toISOString(),
        tMs: t0,
        cpuTicks: utime + stime,
        cpuMs: Math.round(((utime + stime) * 1000) / CLK_TCK),
        rssKb,
        load1,
      });
      if (Math.abs(Date.now() - t0 - tickMs) > CLOCK_JUMP_LIMIT_MS)
        clockJump = true;
    } catch {
      /* process gone; keep last state */
    }
  };
  // INVARIANT (R2-01): the first sample lands at registration (t≈0), not one
  // tick later. Pre-fix, the steady window captured cpuStart ~60ms after the
  // sampler started while the first tick only fired at ~1000ms, so cpuStart
  // was always undefined and every done>0 segment degenerated to the invalid
  // branch ("proc sampler produced no steady-window CPU pair").
  tick();
  const timer = setInterval(tick, tickMs);
  return {
    samples,
    get maxLoad1() {
      return maxLoad1;
    },
    get clockJump() {
      return clockJump;
    },
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      try {
        writeFileSync(
          outFile,
          JSON.stringify({ pid, clkTck: CLK_TCK, samples }),
        );
      } catch {
        /* best-effort */
      }
    },
  };
}

/**
 * Wait until the sampler holds its first valid /proc sample (fail-closed).
 * The steady window must only open on an actual sample (R2-01); if none
 * lands within the budget (dead PID, starved loop), returns not-ok and the
 * segment is judged invalid instead of measuring against a null baseline.
 */
async function waitFirstProcSample(sampler, { budgetMs }) {
  const deadline = Date.now() + budgetMs;
  while (sampler.samples.length === 0 && Date.now() < deadline) {
    await sleep(20);
  }
  const sample = sampler.samples[0] ?? null;
  return sample
    ? { ok: true, sample }
    : {
        ok: false,
        reason: `proc sampler produced no first sample within ${budgetMs}ms — steady window NOT opened (fail-closed, PROTOCOL §5 channel unavailable)`,
      };
}

/**
 * Post-steady-window judgment (PROTOCOL §5 CPU channel + §6.5 fail-closed).
 * Pure; shared by runSegment and the selftest injections so the fail-closed
 * rules have exactly one authoritative implementation:
 *   - no first sample  → invalid (window never opened on real data);
 *   - 0 completed ops  → invalid;
 *   - oracle violations → invalid (PROTOCOL-v2 §4.2: a correctness failure
 *     voids the whole segment, samples must never be trimmed);
 *   - process exited before quota completion → invalid (§3.3 quota window);
 *   - fewer than 2 samples (window shorter than one tick) → invalid: a CPU
 *     differential needs two observation points, a same-tick pair would
 *     silently report a zero cost;
 *   - non-monotonic utime+stime counter → invalid.
 * A valid pair reports exact cpuMsTotal/cpuMsPerOp plus cpuWindowMs — the
 * CPU window is bounded by ACTUAL sample timestamps, not by wall-clock
 * assumptions about when sampling "should" have happened.
 */
function judgeSteadyWindow({
  first,
  samples,
  done,
  planLength,
  procExited,
  oracleErrors,
  tickMs,
}) {
  const reasons = [];
  if (!first?.ok) {
    reasons.push(
      first?.reason ??
        "proc sampler produced no first sample — steady window NOT opened (fail-closed)",
    );
  } else if (done === 0) {
    reasons.push("no steady ops completed");
  }
  if (oracleErrors > 0) {
    reasons.push(
      `${oracleErrors} op(s) violated the per-op oracle (PROTOCOL-v2 §4.2: correctness failure voids the segment)`,
    );
  }
  if (procExited && done < planLength) {
    reasons.push(
      "api process exited before quota completion (PROTOCOL §3.3 segment window)",
    );
  }
  let cpuMsTotal = null;
  let cpuMsPerOp = null;
  let cpuWindowMs = null;
  const cpuStart = first?.ok ? first.sample : null;
  const cpuEnd = samples.length > 0 ? samples[samples.length - 1] : null;
  if (cpuStart && done > 0) {
    if (!cpuEnd || samples.length < 2) {
      reasons.push(
        `steady window closed with ${samples.length} sample(s) (< 2, shorter than one ${tickMs}ms tick) — no CPU differential possible (fail-closed)`,
      );
    } else if (cpuEnd.cpuMs < cpuStart.cpuMs) {
      reasons.push(
        `proc cpu counter non-monotonic (${cpuStart.cpuMs} -> ${cpuEnd.cpuMs} ticks) (fail-closed)`,
      );
    } else {
      cpuMsTotal = cpuEnd.cpuMs - cpuStart.cpuMs;
      cpuMsPerOp = +(cpuMsTotal / done).toFixed(4);
      cpuWindowMs = cpuEnd.tMs - cpuStart.tMs;
    }
  }
  return {
    ok: reasons.length === 0,
    reasons,
    cpuMsTotal,
    cpuMsPerOp,
    cpuWindowMs,
  };
}

async function stopServerGracefully(child) {
  const t0 = Date.now();
  return await new Promise((resolvePromise) => {
    let settled = false;
    const done = (code, signal) => {
      if (!settled) {
        settled = true;
        resolvePromise({ code, signal, ms: Date.now() - t0 });
      }
    };
    child.once("exit", done);
    setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    }, SHUTDOWN_BUDGET_MS + 5_000).unref();
    try {
      child.kill("SIGTERM");
    } catch (err) {
      done(null, String(err));
    }
  });
}

/** Launch env: scrubbed host env + frozen sharedEnv + config env (templated). */
function buildLaunchEnv(
  config,
  { segmentDir, sinkPort, dbUrl, extraNodeFlags },
) {
  const scrubbed = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (
      /^(DATABASE_URL|TEST_DATABASE_URL|TEST_DB_URL|DB_HOST_PORT|REDIS_URL|TELEMETRY_[A-Z_]+|NODE_OPTIONS|APP_PORT|DEV_API_PORT|PUBLIC_WEB_ORIGIN|APP_MODE|NODE_ENV|JWT_SECRET|DEPLOYMENT_MODE|EMAIL_[A-Z_]+|HEARTBEAT_[A-Z_]+|DEADLINE_[A-Z_]+)$/.test(
        k,
      )
    ) {
      continue;
    }
    scrubbed[k] = v;
  }
  const template = (s) =>
    String(s)
      .replaceAll("${SEGMENT_DIR}", segmentDir)
      .replaceAll("${SINK_PORT}", String(sinkPort))
      .replaceAll("${DB_URL}", dbUrl);
  const env = { ...scrubbed };
  for (const [k, v] of Object.entries(MANIFEST.sharedEnv)) {
    if (k === "note") continue;
    env[k] = template(v);
  }
  for (const [k, v] of Object.entries(config.env)) {
    env[k] = template(v);
  }
  env.APP_PORT = String(config.port);
  env.DEV_API_PORT = String(config.port);
  env.PUBLIC_WEB_ORIGIN = `http://localhost:${config.port}`;
  env.TEST_DATABASE_URL = dbUrl; // APP_MODE=e2e resolver takes this branch
  delete env.DATABASE_URL; // run.sh precedent: never leave a dev URL in reach
  if (extraNodeFlags?.length > 0) {
    env.NODE_OPTIONS = extraNodeFlags.join(" ");
  } else {
    delete env.NODE_OPTIONS; // PROTOCOL §5: no --trace-gc in perf segments
  }
  return env;
}

// ── 5. oracle ────────────────────────────────────────────────────────────

const SAVE_REJECT_REASONS = new Set([
  "STALE_VERSION",
  "FUTURE_VERSION",
  "ATTEMPT_ALREADY_SUBMITTED",
  "ATTEMPT_CLOSED",
  "DEADLINE_EXCEEDED",
  "CONFLICTING_PAYLOAD",
  "INVALID_ANSWER",
]);

/**
 * Client-side per-op oracle (PROTOCOL §4.2 判定面: status + business result;
 * transaction/statement counting lives in the DB-side terminal-state checks).
 * Returns violation strings; empty list = the op matches its contract.
 */
function checkOp(rec) {
  const v = [];
  const add = (m) => v.push(m);
  // concurrentSave records carry their own batch-level contract owned by
  // execConcurrentSaveBatch (exactly-one-accepted + STALE_VERSION losers +
  // baseline+1 winner version). The per-record save oracle would misjudge the
  // deterministic losers, so the exemption is scoped to expect.concurrentBatch
  // — it is never a generic bypass (R2-03: correctness assertions were moved,
  // not deleted).
  if (rec.expect?.concurrentBatch) return v;
  const code = rec.statusCode;
  const b = rec.body;
  // saveStale/saveConflicting/saveFuture/saveInvalid/saveClosed share the
  // saveRejected contract (200 accepted:false + reason); normalize before
  // the switch so the oracle switch carries only contract shapes
  const op =
    rec.op.startsWith("save") &&
    !["saveAccepted", "saveReplay"].includes(rec.op)
      ? "saveRejected"
      : rec.op;
  switch (op) {
    case "health":
      if (code !== 200 || b?.status !== "ok")
        add(
          `health: expected 200 {status:"ok"}, got ${code} ${JSON.stringify(b)?.slice(0, 120)}`,
        );
      break;
    case "ready": {
      const gateOk =
        (code === 200 && b?.status === "ready") ||
        (code === 503 && b?.status === "not_ready");
      if (!gateOk) {
        add(
          `ready: expected 200 ready or 503 not_ready gate body, got ${code} ${JSON.stringify(b)?.slice(0, 120)}`,
        );
        break;
      }
      if (code === 200) break;
      // PROTOCOL-v2 §W00 row sanctions "超预算 503 且 body 只含 gate answer"
      // as a CONFORMING outcome: the readiness gate is fail-closed with a
      // 2000ms probe budget (apps/api/src/plugins/operabilityMonitor.ts
      // READINESS_PROBE_BUDGET_MS), so under saturation the probe can exceed
      // its budget while every dependency is actually up — the prior
      // blanket "any non-200 during benchmark" assertion contradicted the
      // frozen row and voided segments for a product-correct response. A
      // FAST 503 (probe completed inside the budget and found a mandatory
      // dependency down) is still a real readiness loss → stays a violation.
      // Legacy records without readyProbeMs cannot prove the over-budget
      // shape → fail-closed (violation).
      if ((rec.readyProbeMs ?? 0) < 2000) {
        add(
          `ready: 503 gate answer arrived in ${rec.readyProbeMs ?? "n/a"}ms (< 2000ms probe budget) — readiness lost without probe-budget expiry`,
        );
      }
      break;
    }
    case "login":
      if (code !== 200 || !b?.id || !Array.isArray(b?.capabilities)) {
        add(
          `login: expected 200 LoginResponse, got ${code} ${JSON.stringify(b)?.slice(0, 120)}`,
        );
      }
      break;
    case "examList":
      if (
        code !== 200 ||
        !Array.isArray(b?.items) ||
        !Number.isInteger(b?.total)
      ) {
        add(
          `examList: expected 200 {items,total,...}, got ${code} ${JSON.stringify(b)?.slice(0, 120)}`,
        );
      }
      break;
    case "saveAccepted":
      if (code !== 200 || b?.accepted !== true) {
        add(
          `saveAccepted: expected 200 accepted:true, got ${code} ${JSON.stringify(b)?.slice(0, 160)}`,
        );
      } else if (b.serverVersion !== rec.expect?.minServerVersion) {
        add(
          `saveAccepted: serverVersion ${b.serverVersion} != expected ${rec.expect.minServerVersion} (versioned protocol)`,
        );
      }
      break;
    case "saveReplay":
      if (code !== 200 || b?.accepted !== true) {
        add(
          `saveReplay: expected 200 accepted:true (idempotent), got ${code} ${JSON.stringify(b)?.slice(0, 160)}`,
        );
      } else if (
        rec.expect?.replayServerVersion !== undefined &&
        b.serverVersion !== rec.expect.replayServerVersion
      ) {
        add(
          `saveReplay: serverVersion changed ${rec.expect.replayServerVersion} -> ${b.serverVersion} (replay must not write)`,
        );
      }
      break;
    case "saveRejected": {
      if (code !== 200 || b?.accepted !== false) {
        add(
          `saveRejected(${rec.expect?.reason ?? "any"}): expected 200 accepted:false, got ${code} ${JSON.stringify(b)?.slice(0, 160)}`,
        );
      } else {
        if (!SAVE_REJECT_REASONS.has(b.reason))
          add(
            `saveRejected: reason "${b.reason}" outside SaveAnswerRejectReasonEnum`,
          );
        if (rec.expect?.reason && b.reason !== rec.expect.reason) {
          add(
            `saveRejected: expected reason ${rec.expect.reason}, got ${b.reason}`,
          );
        }
      }
      break;
    }
    case "submitFresh":
      // LoadAttemptResponse carries no gradingStatus field (contracts
      // attempt.ts:30 comment — the wire state is `status`); the objective-
      // only bench exam must grade inline → status graded, never submitted
      if (code !== 200 || b?.status !== "graded") {
        add(
          `submitFresh: expected 200 auto-graded terminal attempt (status=graded), got ${code} status=${b?.status}`,
        );
      }
      break;
    case "submitDuplicate":
      // duplicate submit: 200, already terminal, zero write (engine
      // alreadyGraded short-circuit, submitAndGradeAttempt.ts:93)
      if (code !== 200 || b?.status !== "graded") {
        add(
          `submitDuplicate: expected 200 already-terminal attempt (status=graded), got ${code} status=${b?.status}`,
        );
      }
      break;
    case "takeFrozen": {
      if (code !== 200 || !b?.attemptId) {
        add(
          `takeFrozen: expected 200 snapshot, got ${code} ${JSON.stringify(b)?.slice(0, 120)}`,
        );
      } else if (b.submittedAt == null) {
        add(
          `takeFrozen: attempt still in_progress (submittedAt=null) — deadline freeze did not happen`,
        );
      } else if (b.effectiveDeadline && b.submittedAt !== b.effectiveDeadline) {
        add(
          `takeFrozen: submittedAt != effectiveDeadline (business deadline authority violated)`,
        );
      }
      break;
    }
    case "takeUnchanged":
      if (code !== 200 || !b?.attemptId) {
        add(
          `takeUnchanged: expected 200 snapshot, got ${code} ${JSON.stringify(b)?.slice(0, 120)}`,
        );
      } else if (b.submittedAt != null || b.attemptStatus !== "in_progress") {
        add(
          `takeUnchanged: attempt mutated (status=${b?.attemptStatus}, submittedAt=${b?.submittedAt})`,
        );
      }
      break;
    case "restore":
      if (
        code !== 200 ||
        !["restored", "already_in_progress", "terminal"].includes(b?.lifecycle)
      ) {
        add(
          `restore: expected 200 lifecycle∈{restored,already_in_progress,terminal}, got ${code} ${JSON.stringify(b?.lifecycle ?? b)?.slice(0, 120)}`,
        );
      }
      break;
    case "heartbeat":
      if (code !== 200 || b?.ok !== true || !b?.serverNow) {
        add(
          `heartbeat: expected 200 {ok:true,serverNow}, got ${code} ${JSON.stringify(b)?.slice(0, 120)}`,
        );
      }
      break;
    case "passwordReset":
      if (code !== 200 || b?.ok !== true) {
        add(
          `passwordReset: expected 200 {ok:true} (constant anti-enumeration body), got ${code} ${JSON.stringify(b)?.slice(0, 120)}`,
        );
      }
      break;
    default:
      add(`unknown op kind ${rec.op}`);
  }
  return v;
}

// ── 6. workload ──────────────────────────────────────────────────────────

class Http {
  constructor(baseUrl, { opTimeoutMs = OP_TIMEOUT_MS } = {}) {
    this.baseUrl = baseUrl;
    this.opTimeoutMs = opTimeoutMs;
    this.sessions = new Map(); // username -> cookie header value
  }
  async login(username, password, { reqId, saveSession = true } = {}) {
    const res = await this.request("POST", "/api/auth/login", {
      body: { username, password },
      reqId,
    });
    const body = await res.json().catch(() => null);
    if (saveSession) {
      for (const c of res.headers.getSetCookie?.() ?? []) {
        const m = c.match(/^auth-token=([^;]+)/);
        if (m) this.sessions.set(username, `auth-token=${m[1]}`);
      }
    }
    return { statusCode: res.status, body };
  }
  authed(username) {
    const cookie = this.sessions.get(username);
    if (!cookie) throw new Error(`no session for ${username}`);
    return cookie;
  }
  async request(method, path, { body, cookie, reqId } = {}) {
    const headers = { "content-type": "application/json" };
    if (cookie) headers.cookie = cookie;
    if (reqId) headers["x-request-id"] = reqId;
    return await fetch(this.baseUrl + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.opTimeoutMs),
    });
  }
}

/** Deterministic prep plan: which slots get an attempt, owned by whom. */
function buildAttemptPlan(prepPool) {
  const slots = [];
  const push = (kind, n) => {
    for (let i = 0; i < n; i++) slots.push({ kind, index: i });
  };
  push("hot", prepPool.hotAttemptsC3);
  push("submit", prepPool.submitAttemptsC5);
  push("frozen", prepPool.frozenAttemptsW08);
  push("unchanged", prepPool.unchangedAttemptsW08);
  push("disrupted", prepPool.disruptedAttemptsW06);
  push("staleW09", prepPool.staleAttemptsW09);
  push("closed", prepPool.closedAttemptsC4);
  // INVARIANT (B4 pool isolation): one DISTINCT candidate per slot. Post
  // /start is resume semantics — a candidate with a live in_progress attempt
  // gets that SAME row back, so per-candidate slots would alias pool rows and
  // one pool's state prep (submit/freeze/backdate) would terminalize another
  // pool's in-window slot. Sequential slot→candidate mapping guarantees
  // disjoint rows as long as BENCH.candidates ≥ slots.length (fixture math
  // enforces this; 2820 slots vs 3000 candidates on the frozen quotas).
  return slots.map((s, i) => ({
    ...s,
    slotKey: `${s.kind}-${s.index}`,
    username: BENCH.candidateName(i + 1),
  }));
}

async function mapLimited(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, Math.max(1, items.length)) },
    async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        results[i] = await fn(items[i], i);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

/**
 * Data prep (unmeasured, PROTOCOL §3: W02 start is the prep mechanism;
 * §4.1: backdate/disrupt state prep by direct SQL). Returns the workload
 * state the measured stream needs.
 */
async function runPrep({ http, sql, plan, prep, examId }) {
  const log = [];
  const orgId = await getOrgId(sql);
  const usernames = [...new Set(plan.map((s) => s.username))];
  const teacherUsernames = Array.from({ length: BENCH.teachers }, (_, i) =>
    BENCH.teacherName(i + 1),
  );
  await mapLimited(
    [...usernames, ...teacherUsernames],
    20,
    async (username) => {
      const res = await http.login(username, BENCH.password, {
        reqId: randomUUID(),
      });
      if (res.statusCode !== 200)
        throw new Error(
          `prep login failed for ${username}: ${res.statusCode} ${JSON.stringify(res.body).slice(0, 120)}`,
        );
    },
  );
  log.push(`sessions=${usernames.length + teacherUsernames.length}`);

  const attemptIds = {};
  const ownerOf = {};
  for (const slot of plan) {
    ownerOf[slot.slotKey] = slot.username;
  }
  await mapLimited(plan, 16, async (slot) => {
    const res = await http.request("POST", `/api/attempts/${examId}/start`, {
      cookie: http.authed(slot.username),
      reqId: randomUUID(),
    });
    const body = await res.json().catch(() => null);
    if (![200, 201].includes(res.status) || !body?.id) {
      throw new Error(
        `prep start failed for ${slot.slotKey}: ${res.status} ${JSON.stringify(body).slice(0, 200)}`,
      );
    }
    attemptIds[slot.slotKey] = body.id;
  });
  log.push(`attempts=${Object.keys(attemptIds).length}`);

  const ids = (kind) =>
    Object.entries(attemptIds)
      .filter(([k]) => k.startsWith(kind + "-"))
      .map(([, v]) => v)
      .sort();
  const hotAttemptIds = ids("hot");
  const submitAttemptIds = ids("submit");
  const frozenAttemptIds = ids("frozen");
  const unchangedAttemptIds = ids("unchanged");
  const disruptedAttemptIds = ids("disrupted");
  const staleAttemptIds = ids("staleW09");
  const closedAttemptIds = ids("closed");
  // attemptId → owner username (parallel starts mean attemptIds[0] of a kind
  // is completion order, not slot order — every per-attempt request MUST
  // resolve the owner through this map; ownership gates 404 existentially)
  const ownerByAttempt = {};
  const closedOwnerOf = {};
  for (const [slotKey, attemptId] of Object.entries(attemptIds)) {
    ownerByAttempt[attemptId] = ownerOf[slotKey];
    if (slotKey.startsWith("closed-"))
      closedOwnerOf[attemptId] = ownerOf[slotKey];
  }

  // frozen-question grammar for saves: read it from a real take snapshot
  const take0 = await http.request(
    "GET",
    `/api/candidate/attempts/${hotAttemptIds[0]}/take`,
    {
      cookie: http.authed(ownerByAttempt[hotAttemptIds[0]]),
      reqId: randomUUID(),
    },
  );
  const take0Body = await take0.json().catch(() => null);
  // first question with a choice grammar (fill_blank/true_false carry no
  // options; the measured save loop needs an option-id answer)
  const q0 = take0Body?.questions?.find((q) => (q.options?.length ?? 0) > 0);
  const answerOptionId = q0?.options?.[0]?.id ?? null;
  const altAnswerOptionId = q0?.options?.[1]?.id ?? "NOT_AN_OPTION";
  if (!answerOptionId)
    throw new Error(
      `take snapshot has no options — cannot build grammar-valid answers (take status ${take0.status}, questions ${take0Body?.questions?.length ?? "n/a"})`,
    );
  // CandidateTakeQuestionSchema exposes the question id as `id` (contracts
  // attempt.ts:1149), not questionId
  const questionId = q0.id;
  log.push(`question=${questionId} answer=${answerOptionId}`);

  // one accepted save per hot attempt so STALE/CONFLICT/FUTURE ops always run
  // against a non-empty receipt history regardless of stream shuffle order
  for (const attemptId of hotAttemptIds) {
    const st = { seq: 1, version: 0, lastAnswer: answerOptionId };
    const res = await http.request(
      "POST",
      `/api/attempts/${attemptId}/answers/${questionId}`,
      {
        cookie: http.authed(ownerByAttempt[attemptId]),
        body: {
          attemptId,
          questionId,
          answer: answerOptionId,
          clientSeq: st.seq,
          clientSavedAt: new Date().toISOString(),
          baseVersion: 0,
        },
        reqId: randomUUID(),
      },
    );
    const body = await res.json().catch(() => null);
    if (body?.accepted !== true)
      throw new Error(
        `prep save failed for ${attemptId}: ${res.status} ${JSON.stringify(body).slice(0, 200)}`,
      );
    st.version = body.serverVersion;
    hotSaveState.set(attemptId, st);
  }

  // direct state prep
  await disruptAttempts(sql, orgId, disruptedAttemptIds);
  // W09 stale pool is NOT expired here (B4 background-interference
  // isolation): backdating 200 in_progress attempts into the past made the
  // deadline scanner discover and auto-submit them DURING the measured
  // window — prep data consumed by a background loop inside the metering
  // window. The pool stays in the frozen fixture math (§3.1) as in_progress
  // attempts with a natural future deadline, inert for every standard gear.
  // Real auto-submit is exercised exclusively by the dedicated `w09`
  // command: its own pool, a controlled deadline, its own segment.
  // closed pool: backdate + one take each → terminal before the stream
  await backdateDeadline(sql, orgId, closedAttemptIds, 1);
  for (const attemptId of closedAttemptIds) {
    const owner = closedOwnerOf[attemptId];
    const res = await http.request(
      "GET",
      `/api/candidate/attempts/${attemptId}/take`,
      {
        cookie: http.authed(owner),
        reqId: randomUUID(),
      },
    );
    const body = await res.json().catch(() => null);
    if (body?.submittedAt == null)
      throw new Error(
        `prep freeze failed for ${attemptId}: ${JSON.stringify(body).slice(0, 160)}`,
      );
  }
  log.push(
    `disrupted=${disruptedAttemptIds.length} staleW09=${staleAttemptIds.length} (inert, future deadline) closed=${closedAttemptIds.length}`,
  );

  return {
    orgId,
    questionId,
    answerOptionId,
    altAnswerOptionId,
    hotAttemptIds,
    submitAttemptIds,
    frozenAttemptIds,
    unchangedAttemptIds,
    disruptedAttemptIds,
    staleAttemptIds,
    closedAttemptIds,
    closedOwnerOf,
    ownerOf: Object.fromEntries(
      Object.entries(attemptIds).map(([slotKey, id]) => [id, ownerOf[slotKey]]),
    ),
    teacherUsernames,
    usernames,
    log,
  };
}

// save-protocol state (attempt -> {seq, version, lastAnswer}); module-level
// because the hot-pool seed saves in runPrep and the measured stream share it.
const hotSaveState = new Map();

// ── per-attempt save serialization (R2-03 / B4) ──────────────────────────
// INVARIANT: one attempt's client save state (hotSaveState entry) is
// single-writer. execOp runs under C≥2 concurrent workers over one shuffled
// plan, so every read-modify-write of that state that spans the HTTP await
// MUST hold this per-attempt lock; otherwise two workers snapshot the same
// (seq, version), both send the same clientSeq, and the server's loser comes
// back STALE_VERSION — a harness interleaving artifact the oracle would
// misreport as a product violation (B4 race, reproduced in b4-repro/).
// Keyed by attemptId: ops on DIFFERENT attempts still interleave, so the
// stream stays genuinely concurrent. Chain tails swallow predecessor errors
// so one failed op can never poison the next waiter. Entries persist for the
// process lifetime (O(attempts touched), bounded by per-segment pool sizes).
const saveLocks = new Map();
function withAttemptSaveLock(attemptId, fn) {
  const prev = saveLocks.get(attemptId) ?? Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  saveLocks.set(
    attemptId,
    run.catch(() => {}),
  );
  return run;
}

/**
 * concurrent-save experiment class (R2-03): deliberately issues K independent
 * same-attempt saves WITHOUT the per-attempt serialization the standard
 * stream owns, modeling K real clients that all base on one snapshot.
 * Engine prediction (packages/exam-engine/src/answerProtocol.ts): exactly one
 * save wins (FRESH clientSeq + current baseVersion); every loser is
 * STALE_VERSION (fresh clientSeq, baseVersion behind). OWNERSHIP: this class
 * is NOT part of buildOpPlan or any standard stream — same-attempt save
 * concurrency belongs exclusively here, and a batch must not run concurrently
 * with standard save ops on the same attempt. The batch-level oracle below
 * owns the class's assertions (per-record checkOp would misjudge the losers;
 * that exemption is scoped to expect.concurrentBatch, never a free pass).
 */
async function execConcurrentSaveBatch(
  ctx,
  { batchSize = 4, attemptId = null } = {},
) {
  const { http, prep } = ctx;
  const id = attemptId ?? prep.hotAttemptIds[0];
  const owner = prep.ownerOf[id];
  const reqId = randomUUID();
  const baseline = await withAttemptSaveLock(id, () => {
    const st = hotSaveState.get(id) ?? {
      seq: 0,
      version: 0,
      lastAnswer: prep.answerOptionId,
    };
    return { seq: st.seq, version: st.version };
  });
  const clientSavedAt = new Date().toISOString();
  const t0 = performance.now();
  const settled = await Promise.all(
    Array.from({ length: batchSize }, async (_, i) => {
      const rec = {
        op: "concurrentSave",
        reqId,
        t: Date.now() - ctx.t0,
        attemptId: id,
        clientSeq: baseline.seq + 1 + i,
        expect: { concurrentBatch: true },
      };
      try {
        const res = await http.request(
          "POST",
          `/api/attempts/${id}/answers/${prep.questionId}`,
          {
            cookie: http.authed(owner),
            body: {
              attemptId: id,
              questionId: prep.questionId,
              answer: prep.answerOptionId,
              clientSeq: baseline.seq + 1 + i,
              clientSavedAt,
              baseVersion: baseline.version,
            },
            reqId: `${reqId}-${i}`,
          },
        );
        rec.statusCode = res.status;
        rec.body = await res.json().catch(() => null);
      } catch (err) {
        rec.statusCode = 0;
        rec.error = String(err).slice(0, 300);
      }
      return rec;
    }),
  );
  const batchMs = +(performance.now() - t0).toFixed(3);
  const accepted = settled.filter((r) => r.body?.accepted === true);
  const losers = settled.filter((r) => r.body && r.body.accepted === false);
  const violations = [];
  if (accepted.length !== 1) {
    violations.push(
      `concurrentSave batch on ${id}: expected exactly 1 accepted save, got ${accepted.length}`,
    );
  }
  for (const l of losers) {
    if (l.body?.reason !== "STALE_VERSION") {
      violations.push(
        `concurrentSave loser expected STALE_VERSION, got ${l.body?.reason ?? JSON.stringify(l.body)?.slice(0, 120)}`,
      );
    }
  }
  const winner = accepted[0];
  if (winner) {
    if (winner.body?.serverVersion !== baseline.version + 1) {
      violations.push(
        `concurrentSave winner version ${winner.body?.serverVersion} != baseline+1 (${baseline.version + 1})`,
      );
    }
    if (
      winner.clientSeq < baseline.seq + 1 ||
      winner.clientSeq > baseline.seq + batchSize
    ) {
      violations.push(
        `concurrentSave winner seq ${winner.clientSeq} outside the batch window [${baseline.seq + 1},${baseline.seq + batchSize}]`,
      );
    }
  }
  // Reconcile client state from the winner ONLY. Losers recorded no clientSeq
  // (a rejected fresh seq is never stored server-side), so seq advances to the
  // winner's seq and version to baseline+1 — last-writer-wins over the shared
  // state here would re-introduce exactly the B4 drift this class isolates.
  await withAttemptSaveLock(id, () => {
    if (winner) {
      const st = hotSaveState.get(id) ?? {
        seq: 0,
        version: 0,
        lastAnswer: prep.answerOptionId,
      };
      st.seq = winner.clientSeq;
      st.version = winner.body.serverVersion;
      hotSaveState.set(id, st);
    }
  });
  const recs = settled.map((r) => ({
    ...r,
    violations: r.error ? [`transport: ${r.error}`] : checkOp(r),
  }));
  return {
    recs,
    violations,
    batchMs,
    baseline,
    batchSize,
    winnerSeq: winner?.clientSeq ?? null,
    winnerVersion: winner?.body?.serverVersion ?? null,
  };
}

/** Build the steady-window op plan (mixed quota stream, PROTOCOL §3.1). */
function buildOpPlan(quotas) {
  const q = quotas;
  const ops = [];
  const push = (n, factory) => {
    for (let i = 0; i < n; i++) ops.push(factory(i));
  };
  push(q.c1Health, () => ({ kind: "health" }));
  push(q.c1Ready, () => ({ kind: "ready" }));
  push(q.c2Login, (i) => ({
    kind: "login",
    username: BENCH.candidateName((i % 1000) + 1),
  }));
  push(q.c2ExamList, () => ({ kind: "examList" }));
  push(q.c3SaveAccepted, () => ({ kind: "saveAccepted" }));
  push(q.c4Replay, () => ({ kind: "saveReplay" }));
  push(q.c4Stale, () => ({ kind: "saveStale" }));
  push(q.c4Conflicting, () => ({ kind: "saveConflicting" }));
  push(q.c4Other, (i) => ({
    kind: ["saveFuture", "saveInvalid", "saveClosed"][i % 3],
  }));
  push(q.c5SubmitFresh, (i) => ({ kind: "submitFresh", slotIndex: i }));
  push(q.c5SubmitDuplicate, (i) => ({ kind: "submitDuplicate", slotIndex: i }));
  push(q.c6TakeFrozen, (i) => ({
    kind: "takeFrozen",
    slotIndex: i,
    // backdate immediately before the take (untimed harness-side state prep)
    prepare: async (ctx) =>
      await backdateDeadline(
        ctx.sql,
        ctx.prep.orgId,
        [ctx.prep.frozenAttemptIds[i]],
        1,
      ),
  }));
  push(q.c6TakeUnchanged, (i) => ({ kind: "takeUnchanged", slotIndex: i }));
  push(q.c6Restore, (i) => ({ kind: "restore", slotIndex: i }));
  push(q.c7Heartbeat, () => ({ kind: "heartbeat" }));
  push(q.c7PasswordReset, (i) => ({
    kind: "passwordReset",
    username: BENCH.candidateName(i + 1),
  }));
  return ops;
}

/**
 * Expected workload derived from the REAL buildOpPlan output (R2-02 fix):
 * totalOps and the per-kind distribution are read off the plan the runner
 * will actually execute, never re-summed from quota keys. The manifest has
 * both the C4 group total (c4Rejects=1000) and its four sub-quotas
 * (300/400/200/100); a naive sum over all 17 keys double-counts the group
 * total and yields 12000 — the historical PERFORMANCE-REPORT §3 error.
 * buildOpPlan only reads the 16 per-kind keys, so expectedOps is 11000.
 * Single source of truth: the gate, the selftest and campaign/isolated
 * planners all call this.
 */
function expectedWorkload(quotas) {
  const plan = buildOpPlan(quotas);
  const byKind = {};
  for (const op of plan) byKind[op.kind] = (byKind[op.kind] ?? 0) + 1;
  return { totalOps: plan.length, byKind };
}

/** Gate item 1: the plan shape must match the frozen quota semantics. */
function workloadPlanProblems(quotas) {
  const problems = [];
  const wl = expectedWorkload(quotas);
  if (
    quotas.c4Replay + quotas.c4Stale + quotas.c4Conflicting + quotas.c4Other !==
    quotas.c4Rejects
  ) {
    problems.push(
      "C4 sub-quotas must sum to c4Rejects (PROTOCOL §3.1 C4: 300/400/200/100)",
    );
  }
  // totalOps must equal the sum of the 16 per-kind quota keys — the parent
  // c4Rejects key must never be added on top (R2-02: that produced 12000).
  const perKindSum = Object.keys(quotas)
    .filter((k) => k !== "c4Rejects")
    .reduce((a, k) => a + (quotas[k] ?? 0), 0);
  if (wl.totalOps !== perKindSum) {
    problems.push(
      `buildOpPlan produced ${wl.totalOps} ops but the per-kind quota keys sum to ${perKindSum} — plan/quota drift`,
    );
  }
  // c4Other rotation: saveFuture+saveInvalid+saveClosed must exhaust c4Other
  const otherSum =
    (wl.byKind.saveFuture ?? 0) +
    (wl.byKind.saveInvalid ?? 0) +
    (wl.byKind.saveClosed ?? 0);
  if (quotas.c4Other !== undefined && otherSum !== quotas.c4Other) {
    problems.push(
      `c4Other rotation built ${otherSum} ops, expected ${quotas.c4Other}`,
    );
  }
  return problems;
}

/** Execute one op. Returns the raw record (violations from the oracle). */
async function execOp(op, ctx) {
  const { http, prep } = ctx;
  const reqId = randomUUID();
  const rec = { op: op.kind, reqId, t: Date.now() - ctx.t0 };
  const cursor = (name) => {
    const v = ctx.cursors[name] ?? 0;
    ctx.cursors[name] = v + 1;
    return v;
  };
  try {
    if (op.kind === "health") {
      const res = await http.request("GET", "/api/health", { reqId });
      rec.statusCode = res.status;
      rec.body = await res.json().catch(() => null);
    } else if (op.kind === "ready") {
      const readyProbeStart = performance.now();
      const res = await http.request("GET", "/api/ready", { reqId });
      rec.statusCode = res.status;
      rec.body = await res.json().catch(() => null);
      // Request-scoped duration for the §W00 over-budget-503 contract (the
      // readiness gate 503s when its 2000ms probe budget expires; a FAST 503
      // means the probe completed and found a dependency down — see checkOp).
      rec.readyProbeMs = +(performance.now() - readyProbeStart).toFixed(3);
    } else if (op.kind === "login") {
      const res = await http.login(op.username, BENCH.password, {
        reqId,
        saveSession: false,
      });
      rec.statusCode = res.statusCode;
      rec.body = res.body;
    } else if (op.kind === "examList") {
      const teacher =
        prep.teacherUsernames[cursor("teacher") % prep.teacherUsernames.length];
      const res = await http.request("GET", "/api/exams?page=1&pageSize=20", {
        cookie: http.authed(teacher),
        reqId,
      });
      rec.statusCode = res.status;
      rec.body = await res.json().catch(() => null);
    } else if (op.kind.startsWith("save")) {
      const hotIds = prep.hotAttemptIds;
      const pickedId = hotIds[cursor("hot") % hotIds.length];
      // saveClosed targets the frozen-closed pool, never the hot state machine
      const targetId =
        op.kind === "saveClosed"
          ? prep.closedAttemptIds[
              cursor("closed") % prep.closedAttemptIds.length
            ]
          : pickedId;
      rec.attemptId = targetId;
      const owner =
        op.kind === "saveClosed"
          ? prep.closedOwnerOf[targetId]
          : prep.ownerOf[pickedId];
      // R2-03/B4 ownership rule: one attempt's client save state is
      // single-writer. Request build, HTTP await AND receipt reconciliation
      // all happen inside the per-attempt lock — the read-modify-write spans
      // the await, and two workers snapshotting the same (seq, version) would
      // manufacture a STALE_VERSION the product never caused. Ops on
      // different attempts do not share a lock and still interleave.
      const sent = await withAttemptSaveLock(targetId, async () => {
        const st =
          op.kind === "saveClosed"
            ? { seq: 1, version: 0, lastAnswer: prep.answerOptionId }
            : (hotSaveState.get(pickedId) ?? {
                seq: 0,
                version: 0,
                lastAnswer: prep.answerOptionId,
              });
        let body;
        let expect = {};
        const clientSavedAt = new Date().toISOString();
        if (op.kind === "saveAccepted") {
          st.seq += 1;
          body = {
            attemptId: targetId,
            questionId: prep.questionId,
            answer: prep.answerOptionId,
            clientSeq: st.seq,
            clientSavedAt,
            baseVersion: st.version,
          };
          expect.minServerVersion = st.version + 1;
        } else if (op.kind === "saveReplay") {
          // replay the last accepted (seq, payload) → accepted, zero write
          if (st.seq === 0) {
            st.seq = 1;
            body = {
              attemptId: targetId,
              questionId: prep.questionId,
              answer: prep.answerOptionId,
              clientSeq: st.seq,
              clientSavedAt,
              baseVersion: st.version,
            };
            expect.minServerVersion = st.version + 1;
          } else {
            body = {
              attemptId: targetId,
              questionId: prep.questionId,
              answer: st.lastAnswer,
              clientSeq: st.seq,
              clientSavedAt,
              baseVersion: st.version,
            };
            expect.replayServerVersion = st.version;
          }
        } else if (op.kind === "saveStale") {
          // engine semantics (answerProtocol.ts): STALE_VERSION fires on a
          // FRESH clientSeq whose baseVersion is BEHIND the current version —
          // a known clientSeq with a different payload is CONFLICTING_PAYLOAD
          body = {
            attemptId: targetId,
            questionId: prep.questionId,
            answer: prep.altAnswerOptionId,
            clientSeq: st.seq + 1,
            clientSavedAt,
            baseVersion: Math.max(0, st.version - 1),
          };
          expect.reason = "STALE_VERSION";
        } else if (op.kind === "saveConflicting") {
          body = {
            attemptId: targetId,
            questionId: prep.questionId,
            answer: prep.altAnswerOptionId,
            clientSeq: st.seq,
            clientSavedAt,
            baseVersion: st.version,
          };
          expect.reason = "CONFLICTING_PAYLOAD";
        } else if (op.kind === "saveFuture") {
          // FUTURE_VERSION fires when baseVersion claims a version ahead of
          // the server (fresh clientSeq, future baseVersion)
          body = {
            attemptId: targetId,
            questionId: prep.questionId,
            answer: prep.answerOptionId,
            clientSeq: st.seq + 1,
            clientSavedAt,
            baseVersion: st.version + 999,
          };
          expect.reason = "FUTURE_VERSION";
        } else if (op.kind === "saveInvalid") {
          body = {
            attemptId: targetId,
            questionId: prep.questionId,
            answer: "NOT_AN_OPTION",
            clientSeq: st.seq,
            clientSavedAt,
            baseVersion: st.version,
          };
          expect.reason = "INVALID_ANSWER";
        } else if (op.kind === "saveClosed") {
          body = {
            attemptId: targetId,
            questionId: prep.questionId,
            answer: prep.answerOptionId,
            clientSeq: 1,
            clientSavedAt,
            baseVersion: 0,
          };
          expect.reason = "ATTEMPT_ALREADY_SUBMITTED";
        }
        rec.clientSeq = body.clientSeq;
        const res = await http.request(
          "POST",
          `/api/attempts/${body.attemptId}/answers/${prep.questionId}`,
          { cookie: http.authed(owner), body, reqId },
        );
        rec.statusCode = res.status;
        rec.body = await res.json().catch(() => null);
        rec.expect = expect;
        if (rec.body?.accepted === true) {
          st.version = rec.body.serverVersion;
          st.lastAnswer = body.answer;
        }
        // only hot-attempt ops own a hotSaveState entry — saveClosed must not
        // alias a closed attempt id onto a hot attempt's state object
        if (op.kind !== "saveClosed") hotSaveState.set(pickedId, st);
        return { expect };
      });
      rec.expect = sent.expect;
    } else if (op.kind === "submitFresh" || op.kind === "submitDuplicate") {
      const attemptId = prep.submitAttemptIds[op.slotIndex];
      const res = await http.request(
        "POST",
        `/api/attempts/${attemptId}/submit`,
        {
          cookie: http.authed(prep.ownerOf[attemptId]),
          reqId,
        },
      );
      rec.statusCode = res.status;
      rec.body = await res.json().catch(() => null);
    } else if (op.kind === "takeFrozen") {
      const attemptId = prep.frozenAttemptIds[op.slotIndex];
      const res = await http.request(
        "GET",
        `/api/candidate/attempts/${attemptId}/take`,
        {
          cookie: http.authed(prep.ownerOf[attemptId]),
          reqId,
        },
      );
      rec.statusCode = res.status;
      rec.body = await res.json().catch(() => null);
    } else if (op.kind === "takeUnchanged") {
      const attemptId =
        prep.unchangedAttemptIds[
          cursor("unchanged") % prep.unchangedAttemptIds.length
        ];
      const res = await http.request(
        "GET",
        `/api/candidate/attempts/${attemptId}/take`,
        {
          cookie: http.authed(prep.ownerOf[attemptId]),
          reqId,
        },
      );
      rec.statusCode = res.status;
      rec.body = await res.json().catch(() => null);
    } else if (op.kind === "restore") {
      const attemptId = prep.disruptedAttemptIds[op.slotIndex];
      const res = await http.request(
        "POST",
        `/api/attempts/${attemptId}/restore`,
        {
          cookie: http.authed(prep.ownerOf[attemptId]),
          reqId,
        },
      );
      rec.statusCode = res.status;
      rec.body = await res.json().catch(() => null);
    } else if (op.kind === "heartbeat") {
      // rotate over attempts that stay in_progress for the whole segment
      const inProgress = [...prep.hotAttemptIds, ...prep.unchangedAttemptIds];
      const attemptId = inProgress[cursor("heartbeat") % inProgress.length];
      const res = await http.request(
        "POST",
        `/api/attempts/${attemptId}/heartbeat`,
        {
          cookie: http.authed(prep.ownerOf[attemptId]),
          reqId,
        },
      );
      rec.statusCode = res.status;
      rec.body = await res.json().catch(() => null);
    } else if (op.kind === "passwordReset") {
      const res = await http.request(
        "POST",
        "/api/auth/password-reset/request",
        {
          body: { username: op.username },
          reqId,
        },
      );
      rec.statusCode = res.status;
      rec.body = await res.json().catch(() => null);
    } else {
      rec.statusCode = 0;
      rec.body = null;
    }
  } catch (err) {
    rec.statusCode = rec.statusCode ?? 0;
    rec.error = String(err).slice(0, 300);
  }
  rec.violations = rec.error ? [`transport: ${rec.error}`] : checkOp(rec);
  return rec;
}

// ── 7. segment runner ────────────────────────────────────────────────────

// Per-config seed checksum continuity (PROTOCOL §6.5 hard exclusion 4): every
// segment of the SAME config must converge to the byte-identical initial
// state across rounds. Configs with separate seed lineages (H0's v0.0.15
// tree) legitimately checksum differently from the master arms, so the
// baseline is keyed by config, not global.
const roundState = { checksums: {} };

async function runSegment({
  configName,
  round,
  segmentDir,
  sinkPort,
  concurrency,
  workflow: workflowArg,
  opPlan: opPlanOverride,
  opTimeoutMs,
}) {
  const config = MANIFEST.configs[configName];
  const dbUrl = dbUrlFor(configName);
  const dbName = configDbName(configName);
  // Workflow dimension (R2-04): mixed C1-C7 stream by default; campaign
  // isolated gears pass an explicit iso-* label + a single-class opPlan.
  const workflow = workflowArg ?? MANIFEST.workload.mode ?? "mixed";
  const notes = [];
  const segT0 = Date.now();
  const seg = {
    round,
    config: configName,
    workflow,
    concurrency,
    segmentDir,
    valid: false,
    invalidReasons: [],
    throughputSemantics: CLOSED_LOOP_SEMANTICS,
    notes,
  };
  const baseUrl = `http://127.0.0.1:${config.port}`;
  const http = new Http(baseUrl, { opTimeoutMs });
  mkdirSync(segmentDir, { recursive: true });

  const finish = () => {
    if (tShutdownDone !== null) seg.collectMs = Date.now() - tShutdownDone;
    seg.valid = seg.invalidReasons.length === 0;
    try {
      writeFileSync(
        join(segmentDir, "segment-summary.json"),
        JSON.stringify(seg, null, 2),
      );
    } catch {
      /* round.json still records the outcome */
    }
    return seg;
  };

  let sql = null;
  let sampler = null;
  let server = null;
  let prep = null;
  let tShutdownDone = null;
  const opsWriter = createWriteStream(join(segmentDir, "ops.jsonl"), {
    flags: "w",
  });
  const writeOp = (rec) => opsWriter.write(JSON.stringify(rec) + "\n");

  const closeOps = () =>
    new Promise((r) => {
      opsWriter.end();
      opsWriter.once("finish", r);
      opsWriter.once("error", r);
    });

  const abortEarly = async () => {
    if (sampler) sampler.stop();
    if (sql) await sql.end({ timeout: 3 }).catch(() => {});
    await closeOps();
    return finish();
  };

  try {
    // ── 1. re-seed to the byte-identical initial state (PROTOCOL §4.1) ──
    try {
      await convergeSeed(
        dbUrl,
        join(segmentDir, "seed-converge.log"),
        configName,
      );
    } catch (err) {
      seg.invalidReasons.push(
        `seed converge failed: ${String(err).slice(0, 300)}`,
      );
      return await abortEarly();
    }
    sql = await openVerified(dbUrl, dbName);
    const ext = await extendSeed(
      sql,
      (m) => notes.push(`seed: ${m}`),
      configName,
    );
    const checksum = await seedChecksum(sql);
    seg.seedChecksum = checksum.sha256;
    seg.seedCounts = checksum.entries;
    if (
      roundState.checksums[configName] &&
      roundState.checksums[configName] !== checksum.sha256
    ) {
      seg.invalidReasons.push(
        `seed checksum mismatch: expected ${roundState.checksums[configName]}, got ${checksum.sha256} (PROTOCOL §6.5 hard exclusion 4)`,
      );
      return await abortEarly();
    }
    roundState.checksums[configName] = checksum.sha256;

    // ── 2. independent clean process (PROTOCOL §3.3/§6.1) ──
    const env = buildLaunchEnv(config, { segmentDir, sinkPort, dbUrl });
    server = spawnServer(
      config,
      env,
      join(segmentDir, "server-out.log"),
      join(segmentDir, "server-err.log"),
    );
    const child = server.child;
    seg.pid = child.pid;
    seg.launchEnvHash = sha256Hex(
      JSON.stringify(
        Object.entries(env)
          .filter(
            ([k]) =>
              k.startsWith("TELEMETRY_") ||
              ["APP_MODE", "APP_PORT", "TEST_DATABASE_URL"].includes(k),
          )
          .sort(),
      ),
    );

    // ── 3. boot: health → ready → startup legs (W11 retention pass) ──
    await waitHttp(`${baseUrl}/api/health`, { timeoutMs: BOOT_WAIT_MS });
    await waitHttp(`${baseUrl}/api/ready`, { timeoutMs: READY_WAIT_MS });
    const retentionDeadline = Date.now() + STARTUP_LEGS_WAIT_MS;
    let retentionRows = -1;
    while (Date.now() < retentionDeadline) {
      retentionRows = (
        await sql`SELECT count(*)::int AS n FROM client_events`
      )[0].n;
      if (retentionRows === 0) break;
      await sleep(1000);
    }
    seg.w11RetentionRowsAfterBoot = retentionRows;
    if (retentionRows === 0) {
      notes.push(
        "W11: retention startup pass deleted the ≥30d fixture (rows==0 after boot)",
      );
    } else {
      notes.push(
        `W11: retention startup pass left ${retentionRows} rows after ${STARTUP_LEGS_WAIT_MS / 1000}s (soft evidence, reconciled again in validate)`,
      );
    }

    // ── 4. data prep (unmeasured) ──
    const plan = buildAttemptPlan(MANIFEST.workload.prepPool);
    prep = await runPrep({ http, sql, plan, examId: ext.examId });
    notes.push(...prep.log.map((l) => `prep: ${l}`));

    // B4 background-interference guard (fail-closed): an in_progress attempt
    // sitting on an expired deadline at window entry IS prep data the
    // deadline scanner will consume mid-window (background writes racing the
    // metered stream). The only sanctioned exception is the dedicated `w09`
    // scenario, which expires its own pool in its own segment AFTER this
    // checkpoint — never inside a mixed/isolated/knee gear.
    const expiredAtEntry = (
      await sql`SELECT count(*)::int AS n FROM exam_attempts
               WHERE organization_id = ${prep.orgId}
                 AND status = 'in_progress' AND deadline_at < now()`
    )[0].n;
    seg.expiredInProgressAtWindowEntry = expiredAtEntry;
    if (expiredAtEntry > 0) {
      seg.invalidReasons.push(
        `background-interference: ${expiredAtEntry} in_progress attempt(s) with expired deadline at window entry — deadline scanner would consume them mid-segment`,
      );
    }

    const ctx = {
      http,
      sql,
      prep,
      t0: Date.now(),
      cursors: {},
      concurrency,
    };

    // ── 5. warmup: 500 ops or 60s, first to arrive (PROTOCOL §3.3) ──
    const warmupT0 = Date.now();
    const warmupKinds = ["health", "ready", "login", "examList"];
    const warmupPlan = shuffleSeeded(
      Array.from({ length: MANIFEST.workload.warmupMaxOps }, (_, i) => ({
        kind: warmupKinds[i % warmupKinds.length],
        username: BENCH.candidateName((i % 900) + 901),
      })),
      segmentRand(MANIFEST.workload.seedToken, round, configName, "warmup"),
    );
    const warmDeadline = Date.now() + MANIFEST.workload.warmupMaxSeconds * 1000;
    seg.warmupOps = await runOpStream(warmupPlan, concurrency, async (op) => {
      if (Date.now() > warmDeadline) return false;
      writeOp(await execOp(op, ctx));
      return true;
    });
    seg.warmupSeconds = +((Date.now() - warmupT0) / 1000).toFixed(3);

    // ── 6. steady window: quota stream (mixed) or single-class stream
    //    (isolated), C=10 main gear ──
    const opPlan = shuffleSeeded(
      opPlanOverride ?? buildOpPlan(MANIFEST.workload.quotas),
      segmentRand(
        MANIFEST.workload.seedToken,
        round,
        configName,
        workflow === "mixed" ? "steady" : `steady:${workflow}`,
      ),
    );
    const steadyIsMixed = workflow === "mixed";
    sampler = startProcSampler(child.pid, join(segmentDir, "samples.json"));
    // R2-01: the steady window opens ONLY on an actual first /proc sample and
    // its boundary is that sample's timestamp — never an assumed "the first
    // tick must have landed by now" sleep (the pre-fix sleep(60) + immediate
    // capture guaranteed cpuStart === undefined).
    const first = await waitFirstProcSample(sampler, {
      budgetMs: PROC_SAMPLE_MS * FIRST_SAMPLE_BUDGET_TICKS,
    });
    const steadyStart = first.ok ? first.sample.tMs : null;
    // PROTOCOL-v3 §4.2 轮窗算术 inputs: overhead (seed→window-open wall,
    // warmup recorded separately) and s_sc (shutdown+collect) must be
    // measured, not assumed — recorded per segment for the pilot register.
    seg.preSteadySeconds =
      steadyStart !== null ? +((steadyStart - segT0) / 1000).toFixed(3) : null;
    let procExited = false;
    const onProcExit = () => {
      procExited = true;
    };
    child.once("exit", onProcExit);
    let done = 0;
    let errors = 0;
    const latencies = [];
    let windowExceeded = false;
    if (first.ok) {
      await runOpStream(opPlan, concurrency, async (op) => {
        if (op.prepare) await op.prepare(ctx);
        const opStart = performance.now();
        const rec = await execOp(op, ctx);
        rec.ms = +(performance.now() - opStart).toFixed(3);
        latencies.push(rec.ms);
        done++;
        if (rec.violations.length > 0) errors++;
        writeOp(rec);
        // The 180s cap is a mixed-gear rule (PROTOCOL-v2 §3.3-4); isolated
        // gears run a quota-completion window instead.
        if (
          steadyIsMixed &&
          !windowExceeded &&
          Date.now() - steadyStart > MANIFEST.workload.steadyMaxSeconds * 1000
        ) {
          windowExceeded = true;
          seg.invalidReasons.push(
            `steady window exceeded ${MANIFEST.workload.steadyMaxSeconds}s before quota completion (PROTOCOL §3.3: segment invalid)`,
          );
          return false;
        }
        return !windowExceeded;
      });
    }
    child.off("exit", onProcExit);
    // Fail-closed steady-window judgment: single authoritative implementation,
    // shared with the selftest injections (first/last sample validity, oracle
    // violations, early exit, same-tick windows, counter monotonicity).
    const judged = judgeSteadyWindow({
      first,
      samples: sampler.samples,
      done,
      planLength: opPlan.length,
      procExited,
      oracleErrors: errors,
      tickMs: PROC_SAMPLE_MS,
    });
    seg.ops = done;
    seg.errors = errors;
    seg.errorRate = done > 0 ? +(errors / done).toFixed(5) : null;
    const sorted = [...latencies].sort((a, b) => a - b);
    seg.p50Ms = sorted.length ? +percentile(sorted, 50).toFixed(3) : null;
    seg.p95Ms = sorted.length ? +percentile(sorted, 95).toFixed(3) : null;
    seg.p99Ms = sorted.length ? +percentile(sorted, 99).toFixed(3) : null;
    seg.wallSeconds =
      steadyStart !== null
        ? +((Date.now() - steadyStart) / 1000).toFixed(3)
        : null;
    seg.throughputOpsPerSec =
      seg.wallSeconds !== null && seg.wallSeconds > 0
        ? +(done / seg.wallSeconds).toFixed(3)
        : null;
    seg.cpuMsTotal = judged.cpuMsTotal;
    seg.cpuMsPerOp = judged.cpuMsPerOp;
    seg.cpuWindowMs = judged.cpuWindowMs;
    for (const reason of judged.reasons) seg.invalidReasons.push(reason);
    const rssSeries = sampler.samples
      .filter((s) => s.rssKb != null)
      .map((s) => s.rssKb / 1024);
    seg.rssMb = rssSeries.length ? +mean(rssSeries).toFixed(2) : null;
    seg.rssMaxMb = rssSeries.length ? +Math.max(...rssSeries).toFixed(2) : null;

    // ── PROTOCOL-v4 §2 interference criteria: absolute cap AND external
    //    increment over B_self, both must hold (either breach → invalid) ──
    if (sampler.maxLoad1 > LOADAVG_HARD_LIMIT) {
      seg.invalidReasons.push(
        `1m loadavg ${sampler.maxLoad1} > ${LOADAVG_HARD_LIMIT} inside segment (§6.5 exclusion 1 / PROTOCOL-v4 §2 absolute cap)`,
      );
    }
    const externalLoadIncrement = +(
      sampler.maxLoad1 - SELF_LOAD_BASELINE
    ).toFixed(2);
    seg.externalLoadIncrement = externalLoadIncrement;
    if (externalLoadIncrement > EXTERNAL_LOAD_INCREMENT_LIMIT) {
      seg.invalidReasons.push(
        `external load increment ${externalLoadIncrement} > ${EXTERNAL_LOAD_INCREMENT_LIMIT} inside segment (in-window maxLoad1 − B_self ${SELF_LOAD_BASELINE}; PROTOCOL-v4 §2)`,
      );
    }
    if (sampler.clockJump) {
      seg.invalidReasons.push(
        `sampler clock jump > ${CLOCK_JUMP_LIMIT_MS}ms (§6.5 exclusion 3)`,
      );
    }
    seg.maxLoad1 = sampler.maxLoad1;
    sampler.stop();

    // ── 7. shutdown: SIGTERM → wall time + exit code (T9 budget) ──
    seg.shutdown = await stopServerGracefully(child);
    tShutdownDone = Date.now();
    if (seg.shutdown.ms > SHUTDOWN_BUDGET_MS) {
      notes.push(
        `shutdown ${seg.shutdown.ms}ms > ${SHUTDOWN_BUDGET_MS}ms budget (T9 finding; recorded, not segment-invalidating)`,
      );
    }
  } catch (err) {
    seg.invalidReasons.push(
      `segment failure: ${String(err?.stack ?? err).slice(0, 500)}`,
    );
    if (sampler) sampler.stop();
  }

  // ── 8. H3 dump witness / H4 sink counters ──
  const dumpFile = MANIFEST.configs[configName].env.TELEMETRY_MEMORY_DUMP_FILE
    ? MANIFEST.configs[configName].env.TELEMETRY_MEMORY_DUMP_FILE.replaceAll(
        "${SEGMENT_DIR}",
        segmentDir,
      )
    : null;
  if (dumpFile) {
    if (existsSync(dumpFile)) {
      try {
        const lines = readFileSync(dumpFile, "utf8")
          .split("\n")
          .filter(Boolean);
        seg.h3DumpSpans = lines.length;
        seg.h3DumpParsedOk = lines.every((l) => {
          try {
            JSON.parse(l);
            return true;
          } catch {
            return false;
          }
        });
        if (!seg.h3DumpParsedOk)
          notes.push(
            "H3: dump file contains non-JSONL lines (PROTOCOL 附录B-4)",
          );
      } catch (err) {
        notes.push(`H3: dump read failed: ${String(err).slice(0, 120)}`);
      }
    } else {
      notes.push("H3: no dump file written at shutdown (witness missing)");
    }
  }
  if (sinkPort) {
    try {
      const res = await fetch(`http://127.0.0.1:${sinkPort}/_counters`, {
        signal: AbortSignal.timeout(3000),
      });
      seg.sinkCounters = await res.json();
    } catch (err) {
      notes.push(`H4: sink counters unavailable: ${String(err).slice(0, 120)}`);
    }
  }

  // ── 9. terminal-state capture BEFORE the next segment re-seeds ──
  if (sql) {
    try {
      seg.terminalState = await captureTerminalState(
        sql,
        prep?.hotAttemptIds ?? [],
      );
    } catch (err) {
      notes.push(`terminal-state capture failed: ${String(err).slice(0, 200)}`);
    }
    await sql.end({ timeout: 3 }).catch(() => {});
  }
  if (!server) {
    await closeOps();
    return finish();
  }
  if (!seg.shutdown) {
    seg.shutdown = await stopServerGracefully(server.child);
    tShutdownDone = Date.now();
  }
  await closeOps();
  return finish();
}

async function runOpStream(plan, concurrency, fn) {
  let idx = 0;
  let completed = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, plan.length || 1) },
    async () => {
      while (true) {
        const i = idx++;
        if (i >= plan.length) return;
        const cont = await fn(plan[i]);
        completed++;
        if (cont === false) {
          idx = plan.length;
          return;
        }
      }
    },
  );
  await Promise.all(workers);
  return completed;
}

// ── 8. commands ──────────────────────────────────────────────────────────

/**
 * Live smoke: boot H1, run a miniature of every op kind against the real
 * engine, assert zero oracle violations, shut down. This is what proves the
 * oracle's engine-mapping assumptions (FUTURE_VERSION vs ACCEPTED, restore
 * lifecycle vocabulary, freeze semantics) before any real sampling.
 */
async function liveSmoke({ bootDir, dbUrl }) {
  const violations = [];
  const config = MANIFEST.configs.H1;
  const env = buildLaunchEnv(config, {
    segmentDir: bootDir,
    sinkPort: MANIFEST.sink.port,
    dbUrl,
  });
  const server = spawnServer(
    config,
    env,
    join(bootDir, "smoke-out.log"),
    join(bootDir, "smoke-err.log"),
  );
  const http = new Http(`http://127.0.0.1:${config.port}`);
  let sql = null;
  try {
    await waitHttp(`http://127.0.0.1:${config.port}/api/health`, {
      timeoutMs: BOOT_WAIT_MS,
    });
    await waitHttp(`http://127.0.0.1:${config.port}/api/ready`, {
      timeoutMs: READY_WAIT_MS,
    });
    sql = await openVerified(dbUrl, MANIFEST.db.name);
    const examId = await getBenchExamId(sql);
    if (!examId)
      throw new Error(
        "bench exam missing — extendSeed must run before the smoke",
      );
    const tinyPool = {
      hotAttemptsC3: 2,
      submitAttemptsC5: 3,
      frozenAttemptsW08: 2,
      unchangedAttemptsW08: 1,
      disruptedAttemptsW06: 1,
      staleAttemptsW09: 2,
      closedAttemptsC4: 1,
    };
    const plan = buildAttemptPlan(tinyPool);
    const prep = await runPrep({ http, sql, plan, examId });
    const ctx = { http, sql, prep, t0: Date.now(), cursors: {} };
    const quota = MANIFEST.workload.quotas;
    const ops = [
      { kind: "health" },
      { kind: "ready" },
      { kind: "examList" },
      { kind: "login", username: BENCH.candidateName(1101) },
      { kind: "saveAccepted" },
      { kind: "saveAccepted" },
      { kind: "saveReplay" },
      { kind: "saveStale" },
      { kind: "saveConflicting" },
      { kind: "saveFuture" },
      { kind: "saveInvalid" },
      { kind: "saveClosed" },
      { kind: "submitFresh", slotIndex: 0 },
      { kind: "submitDuplicate", slotIndex: 0 },
      {
        kind: "takeFrozen",
        slotIndex: 0,
        prepare: async (c) =>
          await backdateDeadline(
            c.sql,
            c.prep.orgId,
            [c.prep.frozenAttemptIds[0]],
            1,
          ),
      },
      { kind: "takeUnchanged", slotIndex: 0 },
      { kind: "restore", slotIndex: 0 },
      { kind: "heartbeat" },
      { kind: "passwordReset", username: BENCH.candidateName(1200) },
    ];
    // quota-shape sanity: every op kind the stream uses is smoke-covered
    const kinds = new Set(buildOpPlan(quota).map((o) => o.kind));
    const smokeKinds = new Set(ops.map((o) => o.kind));
    for (const k of kinds) {
      if (!smokeKinds.has(k))
        violations.push(`smoke does not cover op kind ${k}`);
    }
    const recs = [];
    for (const op of ops) {
      if (op.prepare) await op.prepare(ctx);
      const rec = await execOp(op, ctx);
      recs.push(rec);
      for (const v of rec.violations) violations.push(`${rec.op}: ${v}`);
    }

    // ── R2-03/B4 regression phases (same boot, zero extra cost) ──
    const phases = {
      isolation: { expiredInProgress: null },
      serialOwnership: null,
      concurrentBatch: null,
    };
    // background isolation: prep must leave NO in_progress attempt on an
    // expired deadline — the scanner would consume that data mid-window
    phases.isolation.expiredInProgress = (
      await sql`SELECT count(*)::int AS n FROM exam_attempts
               WHERE organization_id = ${prep.orgId}
                 AND status = 'in_progress' AND deadline_at < now()`
    )[0].n;
    if (phases.isolation.expiredInProgress > 0) {
      violations.push(
        `background-isolation: ${phases.isolation.expiredInProgress} in_progress attempt(s) with expired deadline after prep`,
      );
    }
    // serial ownership: same-attempt concurrent saves through the REAL
    // execOp + runOpStream path — the per-attempt lock must turn all of
    // them into accepted writes with a contiguous version chain
    const raceCtx = {
      ...ctx,
      prep: { ...prep, hotAttemptIds: [prep.hotAttemptIds[0]] },
      cursors: {},
    };
    const raceOps = Array.from({ length: 6 }, () => ({
      kind: "saveAccepted",
    }));
    const raceRecs = [];
    await runOpStream(raceOps, 4, async (op) => {
      raceRecs.push(await execOp(op, raceCtx));
      return true;
    });
    const raceVersions = raceRecs
      .filter((r) => r.body?.accepted === true)
      .map((r) => r.body.serverVersion);
    const raceViolations = raceRecs.flatMap((r) => r.violations);
    for (const v of raceViolations) violations.push(`serial-ownership: ${v}`);
    phases.serialOwnership = {
      ops: raceOps.length,
      accepted: raceVersions.length,
      versionChain: raceVersions,
      violations: raceViolations.length,
    };
    // concurrent-save class: deliberate same-attempt concurrency under the
    // batch-level engine contract (exactly 1 winner, STALE losers)
    const batch = await execConcurrentSaveBatch(ctx, { batchSize: 4 });
    for (const v of batch.violations) violations.push(`concurrent-save: ${v}`);
    phases.concurrentBatch = {
      batchSize: batch.batchSize,
      baseline: batch.baseline,
      winnerSeq: batch.winnerSeq,
      winnerVersion: batch.winnerVersion,
      accepted: batch.recs.filter((r) => r.body?.accepted === true).length,
      violations: batch.violations.length,
    };
    return {
      violations,
      responses: recs.map((r) => ({ op: r.op, code: r.statusCode })),
      phases,
    };
  } catch (err) {
    violations.push(
      `smoke failure: ${String(err?.stack ?? err).slice(0, 400)}`,
    );
    return { violations, responses: [], phases: null };
  } finally {
    await stopServerGracefully(server.child);
    if (sql) await sql.end({ timeout: 3 }).catch(() => {});
  }
}

/**
 * Fixture math problems (frozen quotas, prep pools, §2.8 DB family) — one
 * authoritative implementation shared by the selftest and precheck gate
 * item 2. Returns {problems, plan, owners, totalOps}; totalOps comes from
 * expectedWorkload (real buildOpPlan), never from re-summing quota keys.
 */
function fixtureProblems(q, p, dbName = null) {
  const problems = [];
  if (q.c4Replay + q.c4Stale + q.c4Conflicting + q.c4Other !== q.c4Rejects) {
    problems.push(
      "C4 sub-quotas must sum to c4Rejects (PROTOCOL §3.1 C4 composition 3:4:2:1)",
    );
  }
  // PROTOCOL-v4 §3: quotas may be equal-ratio scaled by the pre-freeze
  // backfill; the frozen invariant is the 3:4:2:1 composition within ±1
  // per-child rounding slack (children-sum == c4Rejects asserted above).
  for (const [value, share, name] of [
    [q.c4Replay, 0.3, "c4Replay"],
    [q.c4Stale, 0.4, "c4Stale"],
    [q.c4Conflicting, 0.2, "c4Conflicting"],
    [q.c4Other, 0.1, "c4Other"],
  ]) {
    const want = q.c4Rejects * share;
    if (Math.abs(value - want) > 1) {
      problems.push(
        `C4 composition drift: ${name}=${value} vs 3:4:2:1 share ${+want.toFixed(2)} of c4Rejects ${q.c4Rejects} (±1 rounding slack, PROTOCOL-v4 §3)`,
      );
    }
  }
  const plan = buildAttemptPlan(p);
  const byKind = {};
  for (const s of plan) byKind[s.kind] = (byKind[s.kind] ?? 0) + 1;
  const want = {
    hot: p.hotAttemptsC3,
    submit: p.submitAttemptsC5,
    frozen: p.frozenAttemptsW08,
    unchanged: p.unchangedAttemptsW08,
    disrupted: p.disruptedAttemptsW06,
    staleW09: p.staleAttemptsW09,
    closed: p.closedAttemptsC4,
  };
  for (const [kind, n] of Object.entries(want)) {
    if (byKind[kind] !== n)
      problems.push(`plan slot ${kind}: built ${byKind[kind]}, expected ${n}`);
  }
  if (p.frozenAttemptsW08 < q.c6TakeFrozen)
    problems.push("frozen pool smaller than frozen-take quota");
  if (p.disruptedAttemptsW06 < q.c6Restore)
    problems.push("disrupted pool smaller than restore quota");
  if (p.submitAttemptsC5 < q.c5SubmitFresh + q.c5SubmitDuplicate)
    problems.push("submit pool smaller than submit quota");
  if (p.staleAttemptsW09 !== 200)
    problems.push("W09 stale pool must be exactly 200 (PROTOCOL §3.1 C6)");
  if (p.oldClientEventsW11 !== 10000)
    problems.push(
      "W11 retention fixture must be exactly 10000 rows (PROTOCOL §3.1 C7)",
    );
  if (BENCH.candidates < q.c7PasswordReset)
    problems.push(
      "candidate pool smaller than password-reset quota (60s cooldown needs fresh usernames)",
    );
  const owners = new Set(plan.map((s) => s.username)).size;
  if (owners > BENCH.candidates)
    problems.push("attempt plan needs more owners than the candidate pool");
  // B4 pool isolation: every slot must own a DISTINCT candidate (one attempt
  // row per slot). Shared candidates alias rows across pools (post /start is
  // resume semantics), so submit/frozen/closed state prep terminalizes other
  // pools' in-window slots — the historical B4 background-terminalization.
  if (owners !== plan.length)
    problems.push(
      `attempt plan aliases candidates across pools (${plan.length} slots over ${owners} owners) — pool isolation requires one attempt row per slot`,
    );
  if (p.benchCandidates !== undefined && p.benchCandidates !== BENCH.candidates)
    problems.push(
      `manifest prepPool.benchCandidates (${p.benchCandidates}) != harness BENCH.candidates (${BENCH.candidates}) — the fixture sizes must agree`,
    );
  if (dbName !== null && !/^exam_e2e(_w[0-9]+)?$/.test(dbName))
    problems.push("bench DB outside the §2.8 e2e worker family");
  const totalOps = expectedWorkload(q).totalOps;
  return { problems, plan, owners, totalOps };
}

/**
 * Oracle injection check — one authoritative implementation shared by the
 * selftest and precheck gate item 2. Good shapes must pass untouched, the
 * intentionally-injected bad samples must all be flagged.
 */
function oracleInjectionProblems() {
  const good = [
    { op: "health", statusCode: 200, body: { status: "ok" } },
    { op: "ready", statusCode: 200, body: { status: "ready" } },
    { op: "login", statusCode: 200, body: { id: "x", capabilities: [] } },
    { op: "examList", statusCode: 200, body: { items: [], total: 0 } },
    {
      op: "saveAccepted",
      statusCode: 200,
      body: {
        accepted: true,
        serverVersion: 5,
        savedAt: "2026-01-01T00:00:00Z",
      },
      expect: { minServerVersion: 5 },
    },
    {
      op: "saveReplay",
      statusCode: 200,
      body: { accepted: true, serverVersion: 4 },
      expect: { replayServerVersion: 4 },
    },
    {
      op: "saveRejected",
      statusCode: 200,
      body: { accepted: false, reason: "STALE_VERSION" },
      expect: { reason: "STALE_VERSION" },
    },
    {
      op: "submitFresh",
      statusCode: 200,
      body: { status: "graded" },
    },
    {
      op: "submitDuplicate",
      statusCode: 200,
      body: { status: "graded" },
    },
    {
      op: "takeFrozen",
      statusCode: 200,
      body: {
        attemptId: "a",
        submittedAt: "2026-01-01T00:00:00Z",
        effectiveDeadline: "2026-01-01T00:00:00Z",
      },
    },
    {
      op: "takeUnchanged",
      statusCode: 200,
      body: {
        attemptId: "a",
        attemptStatus: "in_progress",
        submittedAt: null,
      },
    },
    { op: "restore", statusCode: 200, body: { lifecycle: "restored" } },
    {
      op: "heartbeat",
      statusCode: 200,
      body: { ok: true, serverNow: "2026-01-01T00:00:00Z" },
    },
    { op: "passwordReset", statusCode: 200, body: { ok: true } },
    {
      // PROTOCOL-v2 §W00 row: "超预算 503 且 body 只含 gate answer" conforms
      // (probe budget 2000ms expired under saturation, dependencies up)
      op: "ready",
      statusCode: 503,
      body: { status: "not_ready" },
      readyProbeMs: 2050.1,
    },
  ];
  const bad = [
    {
      rec: {
        op: "saveAccepted",
        statusCode: 200,
        body: { accepted: true, serverVersion: 5 },
        expect: { minServerVersion: 6 },
      },
      why: "accepted save without version increment",
    },
    {
      rec: {
        op: "saveReplay",
        statusCode: 200,
        body: { accepted: true, serverVersion: 7 },
        expect: { replayServerVersion: 4 },
      },
      why: "replay that wrote a new version",
    },
    {
      rec: {
        op: "saveRejected",
        statusCode: 200,
        body: { accepted: false, reason: "MADE_UP_REASON" },
        expect: {},
      },
      why: "reason outside the frozen enum",
    },
    {
      rec: {
        op: "saveRejected",
        statusCode: 200,
        body: { accepted: false, reason: "INVALID_ANSWER" },
        expect: { reason: "STALE_VERSION" },
      },
      why: "wrong reject reason",
    },
    {
      rec: { op: "health", statusCode: 500, body: null },
      why: "unexpected 500",
    },
    {
      rec: {
        op: "takeFrozen",
        statusCode: 200,
        body: {
          attemptId: "a",
          submittedAt: null,
          effectiveDeadline: "2026-01-01T00:00:00Z",
        },
      },
      why: "deadline freeze did not happen",
    },
    {
      rec: {
        op: "takeFrozen",
        statusCode: 200,
        body: {
          attemptId: "a",
          submittedAt: "2026-01-02T00:00:00Z",
          effectiveDeadline: "2026-01-01T00:00:00Z",
        },
      },
      why: "submittedAt drifted from the business deadline",
    },
    {
      rec: {
        op: "takeUnchanged",
        statusCode: 200,
        body: {
          attemptId: "a",
          attemptStatus: "submitted",
          submittedAt: "2026-01-01T00:00:00Z",
        },
      },
      why: "unchanged take mutated the attempt",
    },
    {
      rec: { op: "restore", statusCode: 200, body: { lifecycle: "banana" } },
      why: "lifecycle outside the frozen union",
    },
    {
      rec: { op: "passwordReset", statusCode: 200, body: { ok: false } },
      why: "anti-enumeration body broken",
    },
    {
      rec: {
        op: "ready",
        statusCode: 503,
        body: { status: "not_ready" },
        readyProbeMs: 45.2,
      },
      why: "fast 503 — probe completed inside budget and found a dependency down",
    },
  ];
  const falseNeg = good.filter((r) => checkOp(r).length !== 0);
  const falsePos = bad.filter((r) => checkOp(r.rec).length === 0);
  const problems = [];
  for (const r of falseNeg) problems.push(`good shape flagged: ${r.op}`);
  for (const b of falsePos) problems.push(`bad sample missed: ${b.why}`);
  return { problems, goodCount: good.length, bad };
}

async function cmdSelftest() {
  const checks = [];
  const add = (name, ok, detail) =>
    checks.push({ name, ok, detail: String(detail).slice(0, 500) });

  // 1. postgres driver resolvable from the repo tree (zero new dependencies)
  try {
    const postgres = requirePostgres();
    add(
      "postgres-driver-from-repo-deps",
      typeof postgres === "function",
      "resolved via createRequire from packages/db node_modules — no new dependency installed",
    );
  } catch (err) {
    add("postgres-driver-from-repo-deps", false, String(err));
  }

  // 2. manifest parseable + shape + arm/dimension distinctions
  try {
    const problems = validateManifestShape(MANIFEST);
    add(
      "manifest-parseable",
      problems.length === 0,
      problems.join("; ") ||
        `${Object.keys(MANIFEST.configs).length} configs OK (H1 off / H2 on-none / H3 memory / H4 otlp-paired / S0=0 / S1=0.1 / S2=1)`,
    );
  } catch (err) {
    add("manifest-parseable", false, String(err));
  }

  // 2b. R2-06 portability: the repo-owned configs.json carries no absolute
  //     sourceDir paths; "." resolves to the checkout that owns the runner;
  //     the H0 template resolves via env or the sibling-worktree convention
  //     (the H0 checkout itself may legitimately be absent — gate item 5
  //     enforces its presence at sampling time, not here).
  try {
    const manifestPath = join(HERE, "configs.json");
    const problems = manifestPortabilityProblems(manifestPath);
    const expectedRoot = pathResolve(HERE, "../../..");
    if (MANIFEST.sourceDir !== expectedRoot) {
      problems.push(
        `global sourceDir resolved to ${MANIFEST.sourceDir}, expected ${expectedRoot}`,
      );
    }
    const h0 = MANIFEST.configs.H0;
    const h0Expected =
      process.env.EXAM_OTEL_H0_SOURCE_DIR?.trim() ||
      pathResolve(expectedRoot, "../exam-otel-h0");
    if (!h0 || h0.sourceDir !== h0Expected) {
      problems.push(
        `H0 sourceDir resolved to ${h0?.sourceDir}, expected ${h0Expected} (env EXAM_OTEL_H0_SOURCE_DIR or sibling convention)`,
      );
    }
    if (!h0 || h0.commitSha !== "cb1e614fe087e7ac158deef4a4de7f29268de292") {
      problems.push(
        `H0 lineage commitSha ${h0?.commitSha} != cb1e614fe087e7ac158deef4a4de7f29268de292 — the pre-OTel lineage must pin its own SHA`,
      );
    }
    add(
      "portability-manifest",
      problems.length === 0,
      problems.join("; ") ||
        `configs.json has zero absolute sourceDir paths; "." resolves to ${expectedRoot}; H0 → ${h0?.sourceDir} (template) with its own cb1e614f lineage`,
    );
  } catch (err) {
    add("portability-manifest", false, String(err));
  }

  // 2c. campaign suites match the PROTOCOL-v3 draft composition (fail-closed
  //     against drift) + the knee gradient bracket math
  try {
    const problems = [];
    const wantMixed = ["H0", "H1", "H2", "H3", "H4"];
    if (JSON.stringify(SUITES.mixed.configs) !== JSON.stringify(wantMixed)) {
      problems.push(
        `mixed configs ${JSON.stringify(SUITES.mixed.configs)} != ${JSON.stringify(wantMixed)} (v3 draft: system-total-cost suite)`,
      );
    }
    const wantIsoConfigs = ["H1", "H2", "H4"];
    if (
      JSON.stringify(SUITES.isolated.configs) !== JSON.stringify(wantIsoConfigs)
    ) {
      problems.push(
        `isolated configs ${JSON.stringify(SUITES.isolated.configs)} != ${JSON.stringify(wantIsoConfigs)}`,
      );
    }
    const wantIsoClasses = ["iso-C1", "iso-C3", "iso-C5"];
    if (
      JSON.stringify(SUITES.isolated.classes.map((c) => c.workflow)) !==
      JSON.stringify(wantIsoClasses)
    ) {
      problems.push(
        `isolated classes ${JSON.stringify(SUITES.isolated.classes.map((c) => c.workflow))} != ${JSON.stringify(wantIsoClasses)} (v3 draft: health / save-accepted / submit-grade)`,
      );
    }
    if (
      JSON.stringify(WORKFLOW_ORDER) !==
      JSON.stringify(["mixed", "iso-C1", "iso-C3", "iso-C5"])
    ) {
      problems.push(`WORKFLOW_ORDER drift: ${JSON.stringify(WORKFLOW_ORDER)}`);
    }
    if (
      !SUITES.knee.gradient ||
      JSON.stringify(SUITES.knee.configs) !== JSON.stringify(["H1", "H4"])
    ) {
      problems.push(
        `knee suite must be H1/H4 gradient, got ${JSON.stringify(SUITES.knee)}`,
      );
    }
    if (JSON.stringify(kneeGradientGears(25)) !== JSON.stringify([12, 25, 50]))
      problems.push(
        `kneeGradientGears(25) = ${JSON.stringify(kneeGradientGears(25))}, expected [12,25,50]`,
      );
    if (JSON.stringify(kneeGradientGears(200)) !== JSON.stringify([100, 200]))
      problems.push(
        `kneeGradientGears(200) = ${JSON.stringify(kneeGradientGears(200))}, expected [100,200] (2K capped at the ladder ceiling)`,
      );
    if (JSON.stringify(kneeGradientGears(1)) !== JSON.stringify([1, 2]))
      problems.push(
        `kneeGradientGears(1) = ${JSON.stringify(kneeGradientGears(1))}, expected [1,2] (brackets collapse/dedupe)`,
      );
    add(
      "suites-v3-composition",
      problems.length === 0,
      problems.join("; ") ||
        `mixed=${JSON.stringify(SUITES.mixed.configs)} (H0 gated by the §6.6-3 register), isolated=H1/H2/H4 × iso-C1/C3/C5, knee=H1/H4 gradient bracket [⌊K/2⌋,K,min(2K,200)] with dedupe/cap verified on K=1/25/200`,
    );
  } catch (err) {
    add("suites-v3-composition", false, String(err));
  }

  // 3. fixture math: quotas, pools, naming, §2.8 DB family + expectedOps
  //    derived from the REAL buildOpPlan (R2-02: 11000, parent c4Rejects
  //    quota never double-counted into 12000)
  try {
    const q = MANIFEST.workload.quotas;
    const p = MANIFEST.workload.prepPool;
    const { problems, plan, owners, totalOps } = fixtureProblems(
      q,
      p,
      MANIFEST.db.name,
    );
    const wl = expectedWorkload(q);
    const naiveAllKeysSum = Object.values(q).reduce((a, b) => a + b, 0);
    // PROTOCOL-v4 §3: quotas may be backfill-scaled; the invariant is that
    // buildOpPlan reads exactly the 16 per-kind keys (never the c4Rejects
    // group total on top — the historical 12000 double-count), so
    // expectedOps must equal the leaf-key sum whatever its value.
    const leafQuotaSum =
      q.c1Health +
      q.c1Ready +
      q.c2Login +
      q.c2ExamList +
      q.c3SaveAccepted +
      q.c4Replay +
      q.c4Stale +
      q.c4Conflicting +
      q.c4Other +
      q.c5SubmitFresh +
      q.c5SubmitDuplicate +
      q.c6TakeFrozen +
      q.c6TakeUnchanged +
      q.c6Restore +
      q.c7Heartbeat +
      q.c7PasswordReset;
    if (wl.totalOps !== leafQuotaSum)
      problems.push(
        `expectedOps=${wl.totalOps} != leaf-key quota sum ${leafQuotaSum} — buildOpPlan must read exactly the 16 per-kind keys (12000 was the naive all-keys sum double-counting c4Rejects)`,
      );
    if (naiveAllKeysSum - wl.totalOps !== q.c4Rejects)
      problems.push(
        `naive all-keys sum ${naiveAllKeysSum} minus expectedOps ${wl.totalOps} != c4Rejects ${q.c4Rejects} — double-count invariant broken`,
      );
    add(
      "fixture-math",
      problems.length === 0,
      problems.join("; ") ||
        `expectedOps=${totalOps} (buildOpPlan-derived = leaf-key sum; naive all-keys sum=${naiveAllKeysSum} double-counts c4Rejects=${q.c4Rejects}), plan=${plan.length} attempts over ${owners} owners, C4 split ${q.c4Replay}/${q.c4Stale}/${q.c4Conflicting}/${q.c4Other}, W09=200, W11=10000, db=${MANIFEST.db.name} in §2.8 family`,
    );
  } catch (err) {
    add("fixture-math", false, String(err));
  }

  // 4. oracle flags intentionally-injected bad samples, accepts good shapes
  try {
    const { problems, goodCount, bad } = oracleInjectionProblems();
    add(
      "oracle-bad-sample",
      problems.length === 0,
      problems.join("; ") ||
        `${goodCount} good shapes accepted; ${bad.length} injected bad samples all flagged (${bad.map((b) => b.why).join("; ")})`,
    );
  } catch (err) {
    add("oracle-bad-sample", false, String(err));
  }

  // 5. aggregation on fixed input gives the closed-form output
  try {
    const mk = (cpu, p99, rss) => ({
      cpuMsPerOp: cpu,
      p50Ms: cpu,
      p95Ms: cpu,
      p99Ms: p99,
      rssMb: rss,
    });
    const rounds = [
      {
        round: 1,
        segments: [
          { config: "H1", valid: true, summary: mk(100, 10, 200) },
          { config: "H2", valid: true, summary: mk(105, 12, 210) },
          { config: "H4", valid: true, summary: mk(110, 13, 220) },
        ],
      },
      {
        round: 2,
        segments: [
          { config: "H1", valid: true, summary: mk(101, 10, 200) },
          { config: "H2", valid: true, summary: mk(103, 11, 212) },
          { config: "H4", valid: false, summary: mk(999, 99, 999) },
        ],
      },
      {
        round: 3,
        segments: [
          { config: "H1", valid: true, summary: mk(99, 10, 200) },
          { config: "H2", valid: true, summary: mk(108, 12, 208) },
        ],
      },
    ];
    const a1 = aggregateCore(rounds);
    const a2 = aggregateCore(rounds);
    const h2 = a1.rows.find((r) => r.config === "H2");
    const h4 = a1.rows.find((r) => r.config === "H4");
    const problems = [];
    // H2 CPU deltas vs H1: +5.000%, +1.980%, +9.091% → median +5.000
    if (h2.n !== 3) problems.push(`H2 n=${h2.n}, expected 3`);
    if (Math.abs(h2.cpuDeltaPct - 5.0) > 0.01)
      problems.push(
        `H2 cpuDeltaPct=${h2.cpuDeltaPct}, expected 5.0 (median of +5.000/+1.980/+9.091)`,
      );
    if (
      !h2.cpuRangePct ||
      Math.abs(h2.cpuRangePct[0] - 1.98) > 0.01 ||
      Math.abs(h2.cpuRangePct[1] - 9.091) > 0.01
    ) {
      problems.push(
        `H2 cpuRangePct=${JSON.stringify(h2.cpuRangePct)}, expected [1.98, 9.091]`,
      );
    }
    if (h4.n !== 1)
      problems.push(`H4 n=${h4.n}, expected 1 (invalid segments excluded)`);
    if (Math.abs(h4.cpuDeltaPct - 10.0) > 0.01)
      problems.push(`H4 cpuDeltaPct=${h4.cpuDeltaPct}, expected 10.0`);
    if (!(h2.ciLow <= h2.cpuDeltaPct && h2.cpuDeltaPct <= h2.ciHigh)) {
      problems.push(
        `H2 CI [${h2.ciLow},${h2.ciHigh}] does not contain the median ${h2.cpuDeltaPct}`,
      );
    }
    if (JSON.stringify(a1) !== JSON.stringify(a2))
      problems.push("aggregate not deterministic under the fixed seed");
    add(
      "aggregation-fixed-input",
      problems.length === 0,
      problems.join("; ") ||
        `H2 median=+${h2.cpuDeltaPct}% range=[${h2.cpuRangePct}] CI=[${h2.ciLow},${h2.ciHigh}] n=3; H4 n=1 with invalid round-2 segment excluded; fixed-seed deterministic`,
    );
  } catch (err) {
    add("aggregation-fixed-input", false, String(err));
  }

  // 5b. expectedOps derived from the REAL buildOpPlan (R2-02): plan length
  //     and the full by-kind distribution, plus the double-count invariant.
  try {
    const q = MANIFEST.workload.quotas;
    const wl = expectedWorkload(q);
    const problems = [];
    // c4Other i%3 rotation over q.c4Other ops: the remainder lands on the
    // first kind (34/33/33 at 100; scale-aware per PROTOCOL-v4 §3)
    const c4n = q.c4Other;
    const c4third = Math.floor(c4n / 3);
    const wantByKind = {
      health: q.c1Health,
      ready: q.c1Ready,
      login: q.c2Login,
      examList: q.c2ExamList,
      saveAccepted: q.c3SaveAccepted,
      saveReplay: q.c4Replay,
      saveStale: q.c4Stale,
      saveConflicting: q.c4Conflicting,
      saveFuture: c4n - 2 * c4third,
      saveInvalid: c4third,
      saveClosed: c4third,
      submitFresh: q.c5SubmitFresh,
      submitDuplicate: q.c5SubmitDuplicate,
      takeFrozen: q.c6TakeFrozen,
      takeUnchanged: q.c6TakeUnchanged,
      restore: q.c6Restore,
      heartbeat: q.c7Heartbeat,
      passwordReset: q.c7PasswordReset,
    };
    if (JSON.stringify(wl.byKind) !== JSON.stringify(wantByKind))
      problems.push(
        `byKind mismatch: ${JSON.stringify(wl.byKind)} vs ${JSON.stringify(wantByKind)}`,
      );
    const leafQuotaSum =
      q.c1Health +
      q.c1Ready +
      q.c2Login +
      q.c2ExamList +
      q.c3SaveAccepted +
      q.c4Replay +
      q.c4Stale +
      q.c4Conflicting +
      q.c4Other +
      q.c5SubmitFresh +
      q.c5SubmitDuplicate +
      q.c6TakeFrozen +
      q.c6TakeUnchanged +
      q.c6Restore +
      q.c7Heartbeat +
      q.c7PasswordReset;
    if (wl.totalOps !== leafQuotaSum)
      problems.push(
        `expectedOps=${wl.totalOps} != leaf-key quota sum ${leafQuotaSum} (the naive all-keys sum double-counts c4Rejects)`,
      );
    const naiveAllKeysSum = Object.values(q).reduce((a, b) => a + b, 0);
    if (naiveAllKeysSum - wl.totalOps !== q.c4Rejects)
      problems.push(
        "double-count invariant broken: naive sum − expectedOps ≠ c4Rejects",
      );
    const isoCases = [
      [
        "iso-C1",
        { c1Health: q.c1Health, c1Ready: q.c1Ready },
        { health: q.c1Health, ready: q.c1Ready },
      ],
      [
        "iso-C3",
        { c3SaveAccepted: q.c3SaveAccepted },
        { saveAccepted: q.c3SaveAccepted },
      ],
      [
        "iso-C5",
        {
          c5SubmitFresh: q.c5SubmitFresh,
          c5SubmitDuplicate: q.c5SubmitDuplicate,
        },
        { submitFresh: q.c5SubmitFresh, submitDuplicate: q.c5SubmitDuplicate },
      ],
    ];
    for (const [label, sub, wantIso] of isoCases) {
      const iso = expectedWorkload(sub);
      if (JSON.stringify(iso.byKind) !== JSON.stringify(wantIso))
        problems.push(
          `isolated ${label} plan mismatch: ${JSON.stringify(iso.byKind)}`,
        );
    }
    if (workloadPlanProblems(q).length !== 0)
      problems.push("workloadPlanProblems flagged the healthy quotas");
    const mutated = { ...q, c4Rejects: 999 };
    if (workloadPlanProblems(mutated).length === 0)
      problems.push("workloadPlanProblems accepted a broken c4 group total");
    add(
      "expectedops-plan-distribution",
      problems.length === 0,
      problems.join("; ") ||
        `expectedOps=${wl.totalOps}=leaf-key sum from buildOpPlan (naive all-keys sum=${naiveAllKeysSum}, delta=c4Rejects=${q.c4Rejects}); 18-kind distribution exact incl. c4Other rotation ${wl.byKind.saveFuture}/${wl.byKind.saveInvalid}/${wl.byKind.saveClosed}; all three v3 isolated projections exact`,
    );
  } catch (err) {
    add("expectedops-plan-distribution", false, String(err));
  }

  // 5c. sampler first-sample regression (R2-01): against a LIVE process the
  //     first sample must land at registration (t≈0), not one tick later.
  try {
    const dir = "/tmp/otel-w964-selftest";
    mkdirSync(dir, { recursive: true });
    const problems = [];
    const child = spawn(process.execPath, ["-e", "setTimeout(()=>{}, 2500)"], {
      stdio: "ignore",
    });
    const t0 = Date.now();
    const sampler = startProcSampler(
      child.pid,
      join(dir, "sampler-regression.json"),
      200,
    );
    const first = await waitFirstProcSample(sampler, { budgetMs: 2000 });
    const elapsed = Date.now() - t0;
    if (!first.ok) {
      problems.push(first.reason);
    } else {
      if (elapsed > 100)
        problems.push(
          `first sample took ${elapsed}ms (>100ms) — registration-time sampling regressed (R2-01)`,
        );
      if (typeof first.sample.tMs !== "number")
        problems.push(
          "sample.tMs missing — steady boundary cannot use actual sample time",
        );
      if (first.sample.cpuMs < 0)
        problems.push("negative cpuMs in live sample");
      const deadline = Date.now() + 600;
      while (sampler.samples.length < 2 && Date.now() < deadline)
        await sleep(10);
      if (sampler.samples.length < 2)
        problems.push("second sample missing within 600ms");
      else if (sampler.samples[1].cpuMs < sampler.samples[0].cpuMs)
        problems.push("cpu counter non-monotonic in live probe");
    }
    sampler.stop();
    child.kill("SIGKILL");
    add(
      "sampler-first-sample-regression",
      problems.length === 0,
      problems.join("; ") ||
        `first sample at t+${elapsed}ms (registration-time tick), tMs present, cpu counter monotonic across live ticks`,
    );
  } catch (err) {
    add("sampler-first-sample-regression", false, String(err));
  }

  // 5d. CPU-pair fail-closed injection matrix (R2-01): short-period window,
  //     delayed sampling, early process exit — plus a healthy control.
  try {
    const dir = "/tmp/otel-w964-selftest";
    mkdirSync(dir, { recursive: true });
    const problems = [];
    const liveDummy = (ms, script = null) =>
      spawn(process.execPath, ["-e", script ?? `setTimeout(()=>{}, ${ms})`], {
        stdio: "ignore",
      });

    // (a) short-period: stream finishes inside one tick → fail-closed invalid
    {
      const child = liveDummy(3000);
      const sampler = startProcSampler(
        child.pid,
        join(dir, "inj-short.json"),
        500,
      );
      const first = await waitFirstProcSample(sampler, { budgetMs: 2000 });
      for (let i = 0; i < 5; i++) await sleep(8); // window ≪ tick
      const judged = judgeSteadyWindow({
        first,
        samples: sampler.samples,
        done: 5,
        planLength: 5,
        procExited: false,
        oracleErrors: 0,
        tickMs: 500,
      });
      if (judged.ok)
        problems.push("short-period segment judged VALID — must fail closed");
      if (!judged.reasons.some((r) => r.includes("(< 2")))
        problems.push(
          `short-period reason missing: ${JSON.stringify(judged.reasons)}`,
        );
      sampler.stop();
      child.kill("SIGKILL");
    }

    // (b) no-first-sample: the /proc target is already dead (the real scenario
    //     the first-sample budget guards: PID gone / channel unavailable) →
    //     the window must never open → fail-closed invalid
    {
      const child = liveDummy(0, "process.exit(0)");
      await new Promise((r) => child.once("exit", r));
      // confirm /proc/<pid> is really gone before arming the sampler (guards
      // against PID reuse giving the probe a stranger's samples)
      const goneDeadline = Date.now() + 2000;
      while (Date.now() < goneDeadline) {
        try {
          readFileSync(`/proc/${child.pid}/stat`, "utf8");
          await sleep(20);
        } catch {
          break;
        }
      }
      const sampler = startProcSampler(
        child.pid,
        join(dir, "inj-delayed.json"),
        200,
      );
      const first = await waitFirstProcSample(sampler, { budgetMs: 300 });
      const judged = judgeSteadyWindow({
        first,
        samples: sampler.samples,
        done: 3,
        planLength: 10,
        procExited: false,
        oracleErrors: 0,
        tickMs: 200,
      });
      if (judged.ok)
        problems.push(
          "no-first-sample segment judged VALID — must fail closed",
        );
      if (!judged.reasons.some((r) => r.includes("no first sample")))
        problems.push(
          `no-first-sample reason missing: ${JSON.stringify(judged.reasons)}`,
        );
      sampler.stop();
    }

    // (c) early process exit: the process dies mid-window; ops that hit the
    //     dead process produce oracle violations → invalid. Also pins the
    //     exited-before-quota reason for the stream-stopped-early variant.
    {
      const child = liveDummy(300, "setTimeout(()=>process.exit(0), 300)");
      const sampler = startProcSampler(
        child.pid,
        join(dir, "inj-exit.json"),
        100,
      );
      const first = await waitFirstProcSample(sampler, { budgetMs: 1500 });
      let procExited = false;
      child.once("exit", () => {
        procExited = true;
      });
      let done = 0;
      let oracleErrors = 0;
      for (let i = 0; i < 10; i++) {
        await sleep(40);
        done += 1;
        if (procExited) oracleErrors += 1; // transport-failure analogue
      }
      await new Promise((r) => {
        if (procExited) r();
        else child.once("exit", r);
        setTimeout(r, 1000).unref();
      });
      const judged = judgeSteadyWindow({
        first,
        samples: sampler.samples,
        done,
        planLength: 10,
        procExited,
        oracleErrors,
        tickMs: 100,
      });
      if (judged.ok)
        problems.push("early-exit segment judged VALID — must fail closed");
      if (!judged.reasons.some((r) => r.includes("per-op oracle")))
        problems.push(
          `early-exit oracle reason missing: ${JSON.stringify(judged.reasons)}`,
        );
      if (
        done === 10 &&
        judged.reasons.some((r) => r.includes("exited before quota"))
      )
        problems.push(
          "exit reason must not fire when the quota still completed",
        );
      const stoppedEarly = judgeSteadyWindow({
        first,
        samples: sampler.samples,
        done: 4,
        planLength: 10,
        procExited: true,
        oracleErrors: 0,
        tickMs: 100,
      });
      if (
        !stoppedEarly.reasons.some((r) =>
          r.includes("exited before quota completion"),
        )
      )
        problems.push(
          `exited-before-quota reason missing: ${JSON.stringify(stoppedEarly.reasons)}`,
        );
      sampler.stop();
    }

    // (d) healthy control: process alive across the whole window → valid pair
    {
      const child = liveDummy(3000);
      const sampler = startProcSampler(
        child.pid,
        join(dir, "inj-healthy.json"),
        200,
      );
      const first = await waitFirstProcSample(sampler, { budgetMs: 1500 });
      const wallStart = Date.now();
      let done = 0;
      for (let i = 0; i < 12; i++) {
        await sleep(150);
        done += 1;
      }
      const judged = judgeSteadyWindow({
        first,
        samples: sampler.samples,
        done,
        planLength: 12,
        procExited: false,
        oracleErrors: 0,
        tickMs: 200,
      });
      if (!judged.ok)
        problems.push(
          `healthy control judged INVALID: ${JSON.stringify(judged.reasons)}`,
        );
      else {
        if (judged.cpuMsTotal < 0) problems.push("negative cpuMsTotal");
        if (typeof judged.cpuMsPerOp !== "number")
          problems.push("cpuMsPerOp missing in healthy control");
        if (judged.cpuWindowMs < 1500)
          problems.push(
            `cpuWindowMs=${judged.cpuWindowMs} < streamed wall (~${Date.now() - wallStart}ms)`,
          );
      }
      sampler.stop();
      child.kill("SIGKILL");
    }

    add(
      "cpu-pair-failclosed-injection",
      problems.length === 0,
      problems.join("; ") ||
        "short-period (1 sample) / delayed-sampling (no first sample within budget) / early-exit (oracle violations + exited-before-quota) all fail closed; healthy control yields an exact CPU pair over real sample timestamps",
    );
  } catch (err) {
    add("cpu-pair-failclosed-injection", false, String(err));
  }

  // 5e. aggregation across workflow dimensions (R2-04): hand-computed paired
  //     medians per workflow group, no cross-workflow contamination, and an
  //     independently reimplemented fixed-seed bootstrap CI as counterfactual.
  try {
    const mk = (cpu, p99, rss) => ({
      cpuMsPerOp: cpu,
      p50Ms: cpu,
      p95Ms: cpu,
      p99Ms: p99,
      rssMb: rss,
    });
    const rounds = [
      {
        round: 1,
        segments: [
          {
            config: "H1",
            valid: true,
            workflow: "mixed",
            summary: mk(100, 10, 200),
          },
          {
            config: "H2",
            valid: true,
            workflow: "mixed",
            summary: mk(105, 12, 210),
          },
          {
            config: "H1",
            valid: true,
            workflow: "iso-C3",
            summary: mk(200, 40, 300),
          },
          {
            config: "H2",
            valid: true,
            workflow: "iso-C3",
            summary: mk(230, 44, 310),
          },
        ],
      },
      {
        round: 2,
        segments: [
          {
            config: "H1",
            valid: true,
            workflow: "mixed",
            summary: mk(101, 10, 200),
          },
          {
            config: "H2",
            valid: true,
            workflow: "mixed",
            summary: mk(103, 11, 212),
          },
          {
            config: "H1",
            valid: true,
            workflow: "iso-C3",
            summary: mk(210, 40, 300),
          },
          {
            config: "H2",
            valid: false,
            workflow: "iso-C3",
            summary: mk(999, 99, 999),
          },
        ],
      },
    ];
    const agg = aggregateCore(rounds);
    const problems = [];
    const mixed = agg.rows.find(
      (r) => r.workflow === "mixed" && r.config === "H2",
    );
    const iso = agg.rows.find(
      (r) => r.workflow === "iso-C3" && r.config === "H2",
    );
    if (!mixed || !iso) problems.push("workflow-grouped rows missing");
    if (mixed && mixed.n !== 2) problems.push(`mixed n=${mixed.n}, expected 2`);
    // hand-computed: cpu deltas +5.000 / +1.980198 → median 3.490; p99 +20/+10 → 15; rss 10/12 → 11
    if (mixed && mixed.cpuDeltaPct !== 3.49)
      problems.push(`mixed cpuDeltaPct=${mixed.cpuDeltaPct}, expected 3.49`);
    if (mixed && mixed.p99DeltaPct !== 15)
      problems.push(`mixed p99DeltaPct=${mixed.p99DeltaPct}, expected 15`);
    if (mixed && mixed.rssDeltaMb !== 11)
      problems.push(`mixed rssDeltaMb=${mixed.rssDeltaMb}, expected 11`);
    // hand-computed iso-C3: single valid pair +15.000 exactly; invalid round-2 excluded
    if (iso && (iso.n !== 1 || iso.cpuDeltaPct !== 15))
      problems.push(
        `iso-C3 n=${iso?.n} cpuDeltaPct=${iso?.cpuDeltaPct}, expected n=1 +15`,
      );
    if (iso && iso.p99DeltaPct !== 10)
      problems.push(
        `iso-C3 p99DeltaPct=${iso?.p99DeltaPct}, expected 10 (no cross-workflow feed from mixed)`,
      );
    if (agg.rows.some((r) => r.config === "H1"))
      problems.push("baseline H1 leaked into rows");
    const again = aggregateCore(rounds);
    if (JSON.stringify(agg) !== JSON.stringify(again))
      problems.push("aggregate not deterministic under the fixed seed");
    // independent bootstrap CI reimplementation (counterfactual): same frozen
    // algorithm + seed must reproduce ciLow/ciHigh exactly
    const deltas = [5.0, ((103 - 101) / 101) * 100];
    const refBootstrap = (xs) => {
      let a = BOOTSTRAP_SEED >>> 0;
      const rand = () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      const med = (arr) => {
        const s = [...arr].sort((p, q2) => p - q2);
        const m = Math.floor(s.length / 2);
        return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
      };
      const stats = [];
      const buf = new Array(xs.length);
      for (let b = 0; b < BOOTSTRAP_RESAMPLES; b++) {
        for (let i = 0; i < xs.length; i++)
          buf[i] = xs[Math.floor(rand() * xs.length)];
        stats.push(med(buf));
      }
      stats.sort((p, q2) => p - q2);
      return {
        low: stats[Math.floor(BOOTSTRAP_RESAMPLES * 0.025)],
        high: stats[
          Math.min(
            BOOTSTRAP_RESAMPLES - 1,
            Math.ceil(BOOTSTRAP_RESAMPLES * 0.975) - 1,
          )
        ],
      };
    };
    const ref = refBootstrap(deltas);
    if (
      mixed &&
      (mixed.ciLow !== +ref.low.toFixed(3) ||
        mixed.ciHigh !== +ref.high.toFixed(3))
    )
      problems.push(
        `CI mismatch vs independent reimplementation: [${mixed.ciLow},${mixed.ciHigh}] vs [${ref.low.toFixed(3)},${ref.high.toFixed(3)}]`,
      );
    add(
      "aggregate-workflow-dimensions",
      problems.length === 0,
      problems.join("; ") ||
        `mixed H2 median=+3.49% p99=+15 rss=+11 n=2; iso-C3 H2 n=1 +15.000% (invalid excluded, no cross-workflow feed); CI=[${mixed?.ciLow},${mixed?.ciHigh}] matches an independently reimplemented fixed-seed bootstrap; deterministic`,
    );
  } catch (err) {
    add("aggregate-workflow-dimensions", false, String(err));
  }

  // 5f. pre-check gate: healthy inputs pass all 7 items; injected
  //     counterexamples prove each item rejects (fail-closed).
  try {
    const problems = [];
    const healthy = await precheckGate({
      configs: ["H1", "H2"],
      suite: "mixed",
      workflow: "mixed",
      concurrency: 10,
    });
    if (!healthy.ok)
      problems.push(
        `healthy gate rejected: ${healthy.checks
          .filter((c) => !c.ok)
          .map((c) => `${c.item}: ${c.detail}`)
          .join(" | ")}`,
      );
    if (healthy.checks.length !== 7)
      problems.push(`gate has ${healthy.checks.length} items, expected 7`);
    const rejectWith = async (mutate, item, extra = {}) => {
      const m = JSON.parse(JSON.stringify(MANIFEST));
      mutate(m);
      const g = await precheckGate({
        configs: ["H1"],
        suite: "mixed",
        workflow: "mixed",
        concurrency: 10,
        manifest: m,
        ...extra,
      });
      const c = g.checks.find((x) => x.item === item);
      if (!c || c.ok !== false)
        problems.push(`gate did NOT reject ${item}: ${JSON.stringify(c)}`);
    };
    await rejectWith((m) => {
      m.workload.quotas.c4Rejects = 999;
    }, "workload-plan-count");
    await rejectWith((m) => {
      m.workload.prepPool.staleAttemptsW09 = 199;
    }, "fixture-oracle");
    await rejectWith((m) => {
      m.commitSha = "0".repeat(40);
    }, "source-sha-env");
    await rejectWith((m) => {
      m.db.name = "exam";
    }, "db-isolation");
    await rejectWith(() => {}, "interference", { load1Override: 5.0 });
    {
      const g = await precheckGate({
        configs: ["H1", "H0"],
        suite: "mixed",
        workflow: "mixed",
        concurrency: MANIFEST.workload.concurrency,
        equivalenceRegister: null,
      });
      const c = g.checks.find((x) => x.item === "h0-comparability");
      if (!c || c.ok !== false)
        problems.push("gate did NOT reject H0 without an equivalence register");
    }
    {
      const reg = {
        verified: true,
        workloads: { W01: 3, W03: 3, W05: 3, W08: 3 },
      };
      const frozenGear = MANIFEST.workload.concurrency;
      const gOk = await precheckGate({
        configs: ["H1", "H0"],
        suite: "mixed",
        workflow: "mixed",
        concurrency: frozenGear,
        equivalenceRegister: reg,
      });
      const cOk = gOk.checks.find((x) => x.item === "h0-comparability");
      if (!cOk || cOk.ok !== true)
        problems.push(
          `gate rejected H0 WITH a verified register at the frozen gear: ${JSON.stringify(cOk)}`,
        );
      // Gear discipline: H0 measurement rows join ONLY the manifest-frozen
      // mixed gear (PROTOCOL-v4 §3 P_CONC freeze) — any other concurrency
      // must still be rejected even with a verified register.
      const gGear = await precheckGate({
        configs: ["H1", "H0"],
        suite: "mixed",
        workflow: "mixed",
        concurrency: frozenGear === 10 ? 9 : 10,
        equivalenceRegister: reg,
      });
      const cGear = gGear.checks.find((x) => x.item === "h0-comparability");
      if (!cGear || cGear.ok !== false)
        problems.push(
          `gate did NOT reject H0 at a non-frozen gear: ${JSON.stringify(cGear)}`,
        );
      // Producer mode: the §6.6-3 equivalence suite legitimately runs H0
      // BEFORE any register exists (it produces the register); every other
      // gate item still applies to its segments.
      const gProd = await precheckGate({
        configs: ["H1", "H0"],
        suite: "equivalence",
        workflow: "mixed",
        concurrency: frozenGear,
        equivalenceRegister: null,
      });
      const cProd = gProd.checks.find((x) => x.item === "h0-comparability");
      if (!cProd || cProd.ok !== true)
        problems.push(
          `gate rejected the §6.6-3 equivalence producer suite: ${JSON.stringify(cProd)}`,
        );
      const gIso = await precheckGate({
        configs: ["H1", "H0"],
        suite: "isolated",
        workflow: "iso-C3",
        concurrency: frozenGear,
        equivalenceRegister: reg,
      });
      const cIso = gIso.checks.find((x) => x.item === "h0-comparability");
      if (!cIso || cIso.ok !== false)
        problems.push("gate did NOT reject H0 inside an isolated suite");
    }
    add(
      "precheck-gate-counterexamples",
      problems.length === 0,
      problems.join("; ") ||
        `healthy pair passes all 7 items; injected counterexamples rejected: broken c4 quotas → workload-plan-count, stale-pool 199 → fixture-oracle, unknown commitSha → source-sha-env, dev db "exam" → db-isolation, loadavg 5.0 → interference, H0 without §6.6-3 register → h0-comparability, H0 at a non-frozen gear → h0-comparability (verified register at the frozen P_CONC passes; equivalence producer suite passes pre-register; H0 in isolated suite rejects)`,
    );
  } catch (err) {
    add("precheck-gate-counterexamples", false, String(err));
  }

  // 5g. pilot ladder judgment (PROTOCOL-v3 §4.3 rule 3 + §4.1 mechanical
  //     rule): quota-exceeded gears are the designed recon outcome under the
  //     pre-backfill manifest; structural reasons stop the ladder;
  //     sampler-channel breakage fails cpuSamplesValid; in-window load
  //     eliminates that gear's knee faces; K_pilot is derived from the p99
  //     shape even when the gears are quota-exceeded (the pre-fix criterion
  //     required ladder.every(valid), which under the oversized placeholder
  //     quota could never pass — the counterfactual is baked into case A).
  try {
    const problems = [];
    const row = (concurrency, p99Ms, reasons = []) => ({
      concurrency,
      valid: reasons.length === 0,
      p99Ms,
      invalidReasons: reasons,
    });
    const q = (s) =>
      `steady window exceeded ${s}s before quota completion (PROTOCOL §3.3: segment invalid)`;
    // Case A: all four gears quota-exceeded → pilot proceeds (recon data
    // recorded); this is exactly the pre-backfill manifest condition.
    const a = judgePilotLadder([
      row(25, 810, [q(180)]),
      row(50, 920, [q(180)]),
      row(100, 1400, [q(180)]),
      row(200, 2900, [q(180)]),
    ]);
    if (a.structuralStop !== null)
      problems.push(
        `case A: quota-exceeded judged structural: ${JSON.stringify(a.structuralStop)}`,
      );
    if (a.cpuSamplesValid !== true)
      problems.push(
        `case A: cpuSamplesValid=${a.cpuSamplesValid}, expected true`,
      );
    if (a.kPilot !== 100)
      problems.push(
        `case A: kPilot=${a.kPilot}, expected 100 (p99 2900 > 2×1400 at c200 → previous gear c100)`,
      );
    // Case B: oracle violation = structural → ladder stops.
    const b = judgePilotLadder([
      row(25, 800),
      row(50, 850, [
        "3 op(s) violated the per-op oracle (PROTOCOL-v2 §4.2: correctness failure voids the segment)",
      ]),
    ]);
    if (b.structuralStop === null || b.structuralStop.gear !== 50)
      problems.push(
        `case B: oracle violation not a structural stop: ${JSON.stringify(b.structuralStop)}`,
      );
    // Case C: sampler channel breakage → cpuSamplesValid false AND stop.
    const c = judgePilotLadder([
      row(25, null, [
        "proc sampler produced no first sample — steady window NOT opened (fail-closed)",
      ]),
    ]);
    if (c.cpuSamplesValid !== false)
      problems.push(
        `case C: cpuSamplesValid=${c.cpuSamplesValid}, expected false`,
      );
    if (c.structuralStop === null)
      problems.push("case C: sampler breakage did not stop the ladder");
    // Case D: in-window load1 over the hard limit → gear eliminated, ladder continues.
    const d = judgePilotLadder([
      row(25, 800),
      row(50, 860, ["1m loadavg 6.31 > 4 inside segment (§6.5 exclusion 1)"]),
      row(100, 1500),
    ]);
    if (d.structuralStop !== null)
      problems.push(
        `case D: in-window load judged structural: ${JSON.stringify(d.structuralStop)}`,
      );
    if (JSON.stringify(d.loadEliminatedGears) !== JSON.stringify([50]))
      problems.push(
        `case D: loadEliminatedGears=${JSON.stringify(d.loadEliminatedGears)}, expected [50]`,
      );
    // Case E: mixed reasons on one gear classify into the right buckets.
    const e = classifyPilotGearReasons([
      q(180),
      "1m loadavg 5.2 > 4 inside segment (§6.5 exclusion 1)",
      "api process exited before quota completion (PROTOCOL §3.3 segment window)",
    ]);
    if (
      e.quotaExceeded.length !== 1 ||
      e.loadShape.length !== 1 ||
      e.structural.length !== 1
    )
      problems.push(
        `case E: buckets mismatch: q=${e.quotaExceeded.length} load=${e.loadShape.length} structural=${e.structural.length}`,
      );
    add(
      "pilot-ladder-rule3-injection",
      problems.length === 0,
      problems.join("; ") ||
        `A: 4× quota-exceeded → ok recon (kPilot=100 from p99 shape); B: oracle violation → structural stop at c50; C: sampler breakage → cpuSamplesValid=false + stop; D: in-window load → gear c50 eliminated, ladder continues; E: mixed reasons classify 1/1/1`,
    );
  } catch (err) {
    add("pilot-ladder-rule3-injection", false, String(err));
  }

  // 5h. port preflight (single-instance defense): an occupied port is a
  //     fail-closed problem with an owner note; a free port passes. Injected
  //     probe/ownerLookup keep the selftest free of real binds.
  try {
    const problems = [];
    const occupied = await preflightPortsProblems({
      ports: [3901, 3902],
      probe: async (port) =>
        port === 3901 ? { ok: false, code: "EADDRINUSE" } : { ok: true },
      ownerLookup: async (port) => (port === 3901 ? 424242 : null),
    });
    if (occupied.length !== 1)
      problems.push(`occupied: ${occupied.length} problems, expected 1`);
    if (
      !occupied[0]?.includes("port 3901") ||
      !occupied[0]?.includes("pid 424242")
    )
      problems.push(`occupied message lacks port/pid: ${occupied[0]}`);
    const free = await preflightPortsProblems({
      ports: [3901, 4901],
      probe: async () => ({ ok: true }),
      ownerLookup: async () => null,
    });
    if (free.length !== 0)
      problems.push(`free ports flagged: ${JSON.stringify(free)}`);
    add(
      "port-preflight-injection",
      problems.length === 0,
      problems.join("; ") ||
        "occupied 3901 (EADDRINUSE, pid 424242) → fail-closed problem naming port+owner; free 3901/4901 → no problems",
    );
  } catch (err) {
    add("port-preflight-injection", false, String(err));
  }

  // 6. stack can start: §2.8 server reachable, bench DB ensured, repo seed
  //    converge + harness extend + checksum, live oracle smoke, then H1/H2/H3
  //    boots with real health/readiness and the H3 dump seam.
  const stackProblems = [];
  const dbUrl = dbUrlFor();
  let seeded = false;
  try {
    const pgPort = hostPort();
    let dbReachable = false;
    try {
      const postgres = requirePostgres();
      const probe = postgres(
        `postgresql://${MANIFEST.db.user}:${MANIFEST.db.password}@localhost:${pgPort}/postgres`,
        { max: 1, connect_timeout: 5 },
      );
      try {
        await probe`SELECT 1`;
        dbReachable = true;
      } finally {
        await probe.end({ timeout: 3 });
      }
    } catch {
      dbReachable = false;
    }
    if (!dbReachable) {
      stackProblems.push(
        `PG not reachable on localhost:${pgPort} — the §2.8 server comes from \`pnpm db:up\` (docker-compose.dev.yml)`,
      );
    } else {
      await ensureBenchDatabase(() => {});
      await convergeSeed(dbUrl, "/tmp/otel-w964-selftest-converge.log");
      const sql = await openVerified(dbUrl, MANIFEST.db.name);
      try {
        await extendSeed(sql, () => {});
        const checksum = await seedChecksum(sql);
        seeded = true;
        add(
          "seed-converge-extend-checksum",
          true,
          `converge + extend OK; checksum=${checksum.sha256.slice(0, 12)}… counts=${JSON.stringify(checksum.entries)}`,
        );
      } catch (err) {
        add("seed-converge-extend-checksum", false, String(err));
      } finally {
        await sql.end({ timeout: 3 });
      }
    }
  } catch (err) {
    stackProblems.push(String(err).slice(0, 300));
  }

  if (seeded) {
    try {
      mkdirSync("/tmp/otel-w964-selftest", { recursive: true });
      const { violations, responses, phases } = await liveSmoke({
        bootDir: "/tmp/otel-w964-selftest",
        dbUrl,
      });
      add(
        "oracle-live-smoke",
        violations.length === 0,
        violations.length === 0
          ? `19-op miniature + R2-03 phases against a real H1 boot: zero oracle violations (${responses.length} ops, all contracts matched)`
          : `${violations.length} violation(s): ${violations.slice(0, 6).join(" | ")}`,
      );
      // B4 background-interference isolation: prep must leave no in_progress
      // attempt on an expired deadline (the scanner would consume it mid-window)
      add(
        "background-isolation",
        (phases?.isolation?.expiredInProgress ?? 1) === 0,
        `in_progress attempts with expired deadline after prep: ${phases?.isolation?.expiredInProgress ?? "UNKNOWN"} (must be 0 — the W09 pool stays future-deadline in standard prep; real auto-submit lives in the dedicated w09 command)`,
      );
      // R2-03 serial ownership: same-attempt concurrent saves through the real
      // execOp/runOpStream path — zero false positives, contiguous versions
      add(
        "save-serial-ownership",
        !!phases?.serialOwnership &&
          phases.serialOwnership.violations === 0 &&
          phases.serialOwnership.accepted === phases.serialOwnership.ops,
        `6 same-attempt concurrent saveAccepted (C=4, real stream path): ${phases?.serialOwnership?.accepted ?? "?"}/${phases?.serialOwnership?.ops ?? "?"} accepted, version chain ${JSON.stringify(phases?.serialOwnership?.versionChain ?? [])}, ${phases?.serialOwnership?.violations ?? "?"} violations (per-attempt lock ownership)`,
      );
      // concurrent-save class: deliberate same-attempt concurrency under the
      // batch-level engine contract — exactly 1 winner, STALE_VERSION losers
      add(
        "concurrent-save-class",
        !!phases?.concurrentBatch &&
          phases.concurrentBatch.violations === 0 &&
          phases.concurrentBatch.accepted === 1,
        `batch of ${phases?.concurrentBatch?.batchSize ?? "?"} unserialized same-attempt saves: baseline ${JSON.stringify(phases?.concurrentBatch?.baseline ?? {})}, winner seq ${phases?.concurrentBatch?.winnerSeq ?? "?"} → v${phases?.concurrentBatch?.winnerVersion ?? "?"}, ${phases?.concurrentBatch?.accepted ?? "?"} accepted, ${phases?.concurrentBatch?.violations ?? "?"} batch violations (exactly-one-winner contract, dedicated class outside the standard stream)`,
      );
    } catch (err) {
      add("oracle-live-smoke", false, String(err));
      add("background-isolation", false, String(err));
      add("save-serial-ownership", false, String(err));
      add("concurrent-save-class", false, String(err));
    }
    try {
      mkdirSync("/tmp/otel-w964-selftest", { recursive: true });
      for (const cfgName of ["H1", "H2", "H3"]) {
        const config = MANIFEST.configs[cfgName];
        const env = buildLaunchEnv(config, {
          segmentDir: "/tmp/otel-w964-selftest",
          sinkPort: MANIFEST.sink.port,
          dbUrl,
        });
        const server = spawnServer(
          config,
          env,
          "/tmp/otel-w964-selftest/boot-out.log",
          "/tmp/otel-w964-selftest/boot-err.log",
        );
        let bootErr = "";
        server.child.stderr.on("data", (d) => (bootErr += d.toString()));
        try {
          const baseUrl = `http://127.0.0.1:${config.port}`;
          await waitHttp(`${baseUrl}/api/health`, { timeoutMs: BOOT_WAIT_MS });
          await waitHttp(`${baseUrl}/api/ready`, { timeoutMs: READY_WAIT_MS });
          const shutdown = await stopServerGracefully(server.child);
          const dumpFile = (
            config.env.TELEMETRY_MEMORY_DUMP_FILE ?? ""
          ).replaceAll("${SEGMENT_DIR}", "/tmp/otel-w964-selftest");
          const dumpOk =
            cfgName !== "H3" ||
            (existsSync(dumpFile) &&
              readFileSync(dumpFile, "utf8").trim().length > 0);
          const ok =
            shutdown.code === 0 && shutdown.ms <= SHUTDOWN_BUDGET_MS && dumpOk;
          add(
            `boot-${cfgName}`,
            ok,
            `health+ready OK; SIGTERM→exit ${shutdown.ms}ms code=${shutdown.code}` +
              (cfgName === "H3"
                ? dumpOk
                  ? "; memory-dump witness written + parseable"
                  : "; DUMP FILE MISSING"
                : ""),
          );
        } catch (err) {
          server.child.kill("SIGKILL");
          add(
            `boot-${cfgName}`,
            false,
            `${String(err).slice(0, 200)} | stderr tail: ${bootErr.slice(-300)}`,
          );
        }
      }
    } catch (err) {
      add("boot-H1", false, String(err));
    }
  }

  const bootChecks = checks.filter((c) => c.name.startsWith("boot-"));
  add(
    "stack-can-start",
    stackProblems.length === 0 &&
      bootChecks.length === 3 &&
      bootChecks.every((c) => c.ok),
    stackProblems.join("; ") ||
      (bootChecks.length === 3 && bootChecks.every((c) => c.ok)
        ? "db verified (current_database) + seed + H1/H2/H3 boots all OK"
        : `boot checks: ${bootChecks.map((c) => `${c.name}=${c.ok}`).join(", ")}`),
  );

  const ok = checks.every((c) => c.ok);
  return { ok, checks };
}

async function startSink(port, mode) {
  const child = spawn(
    process.execPath,
    [join(HERE, "otlp-sink.js"), "--mode", mode, "--port", String(port)],
    {
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  trackChild(child, "otlp-sink.js");
  await waitHttp(`http://127.0.0.1:${port}/_health`, { timeoutMs: 10_000 });
  return { child, port };
}

async function stopSink(sink) {
  await new Promise((r) => {
    sink.child.once("exit", () => r());
    try {
      sink.child.kill("SIGTERM");
    } catch {
      /* already gone */
    }
    setTimeout(r, 3000).unref();
  });
}

// ── 8a. segment pre-check gate (round/campaign entry, 7 mandatory items) ──
//
// Fail-closed: any failing item rejects the round/campaign BEFORE any segment
// runs. Every item has one authoritative pure/async helper so the selftest
// counterexamples exercise the same code the gate runs.

/** Gate item 4 comparator (pure; callers feed real /proc readings). */
function interferenceProblems({ load1, clockJumpMs = 0 }) {
  const problems = [];
  if (!(load1 <= INTERFERENCE_ENTRY_LIMIT)) {
    problems.push(
      `1m loadavg ${load1} > ${INTERFERENCE_ENTRY_LIMIT} at entry (PROTOCOL §6.5 exclusion 1 / §6.1 quiet-machine)`,
    );
  }
  if (clockJumpMs > CLOCK_JUMP_LIMIT_MS) {
    problems.push(
      `clock jump ${clockJumpMs}ms > ${CLOCK_JUMP_LIMIT_MS}ms at entry (§6.5 exclusion 3)`,
    );
  }
  return problems;
}

/**
 * §6.1 quiet-machine entry wait: the residual load of the previous segment
 * (co-located runner) decays with the 1-min average, so poll within a
 * bounded budget instead of deferring on our own tail — an immediate defer
 * starved back-to-back units (deferrals >= 3 → attempt cap) with zero
 * external interference. The entry criterion itself is unchanged: whatever
 * load1 this returns still goes through interferenceProblems fail-closed.
 */
async function waitForQuietLoad1({
  budgetMs = 5 * 60_000,
  pollMs = 10_000,
  now = () => Date.now(),
  pause = (ms) => sleep(ms),
  readLoad1 = () => Number(readFileSync("/proc/loadavg", "utf8").split(" ")[0]),
} = {}) {
  const deadline = now() + budgetMs;
  let load1 = readLoad1();
  while (!(load1 <= INTERFERENCE_ENTRY_LIMIT) && now() < deadline) {
    await pause(pollMs);
    load1 = readLoad1();
  }
  return load1;
}

/**
 * Gate item 3: prove the /proc channel can produce a valid first+last sample
 * pair BEFORE burning a segment. Spawns a throwaway probe process and runs
 * the real sampler against it.
 */
async function procChannelProblems({ tickMs = 200, probeMs = 900 } = {}) {
  const problems = [];
  const child = spawn(
    process.execPath,
    ["-e", `setTimeout(()=>{}, ${probeMs})`],
    { stdio: "ignore" },
  );
  const outFile = join(
    "/tmp",
    `otel-w964-proc-channel-probe-${process.pid}-${Date.now()}.json`,
  );
  const sampler = startProcSampler(child.pid, outFile, tickMs);
  try {
    const first = await waitFirstProcSample(sampler, {
      budgetMs: tickMs * FIRST_SAMPLE_BUDGET_TICKS,
    });
    if (!first.ok) {
      problems.push(first.reason);
    } else {
      const deadline = Date.now() + probeMs + tickMs * 3;
      while (sampler.samples.length < 2 && Date.now() < deadline) {
        await sleep(20);
      }
      if (sampler.samples.length < 2) {
        problems.push(
          `probe produced ${sampler.samples.length} sample(s) (< 2) — the channel cannot produce a CPU differential`,
        );
      } else {
        const a = sampler.samples[0];
        const b = sampler.samples[sampler.samples.length - 1];
        if (b.cpuMs < a.cpuMs) {
          problems.push(
            `probe cpu counter non-monotonic (${a.cpuMs} -> ${b.cpuMs} ticks)`,
          );
        }
        if (b.rssKb == null) {
          problems.push("probe could not read VmRSS from /proc/<pid>/status");
        }
      }
    }
  } finally {
    sampler.stop();
    child.kill("SIGKILL");
  }
  return problems;
}

/**
 * Gate item 5: the product tree (apps/, packages/) at the worktree HEAD must
 * be byte-identical to manifest.commitSha. Harness/doc commits on top of the
 * pinned product SHA are fine; product drift is not — re-pin before sampling.
 */
async function sourceShaProblems({ sourceDir, commitSha }) {
  const problems = [];
  if (!commitSha) {
    problems.push("manifest.commitSha missing");
    return problems;
  }
  if (!existsSync(sourceDir)) {
    problems.push(
      `sourceDir "${sourceDir}" does not exist on this host — mount the pinned checkout or point the ${"${ENV}"} template/sibling convention at it (R2-06 portability: absence is fail-closed, never silent)`,
    );
    return problems;
  }
  try {
    await runCommand(
      "git",
      ["rev-parse", "--verify", `${commitSha}^{commit}`],
      { cwd: sourceDir, timeoutMs: 15_000 },
    );
  } catch (err) {
    problems.push(
      `manifest.commitSha ${String(commitSha).slice(0, 12)} not resolvable in ${sourceDir}: ${String(err).slice(0, 160)}`,
    );
    return problems;
  }
  try {
    const { out } = await runCommand(
      "git",
      ["diff", "--name-only", commitSha, "HEAD", "--", "apps", "packages"],
      { cwd: sourceDir, timeoutMs: 15_000 },
    );
    const drifted = out
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (drifted.length > 0) {
      problems.push(
        `product tree drifted since ${String(commitSha).slice(0, 12)}: ${drifted.slice(0, 5).join(", ")}${drifted.length > 5 ? " …" : ""} — re-pin manifest.commitSha before sampling`,
      );
    }
  } catch (err) {
    problems.push(`git diff probe failed: ${String(err).slice(0, 160)}`);
  }
  return problems;
}

/** Gate item 6: every touched DB stays inside the §2.8 e2e worker family. */
function dbIsolationProblems(manifest, configs) {
  const problems = [];
  const family = /^exam_e2e(_w[0-9]+)?$/;
  if (!family.test(manifest.db.name ?? "")) {
    problems.push(
      `global db.name "${manifest.db.name}" outside the §2.8 e2e worker family (exam_e2e_w<N>)`,
    );
  }
  if (manifest.db.fullResetAllowed !== true) {
    problems.push(
      "manifest.db.fullResetAllowed must be explicitly true (§2.8 full-reset contract)",
    );
  }
  for (const c of configs) {
    const entry = manifest.configs[c];
    const name = entry?.db ?? manifest.db.name;
    if (!family.test(name)) {
      problems.push(
        `config ${c} db "${name}" outside the §2.8 e2e worker family`,
      );
    }
    if (entry?.sourceDir && entry.sourceDir !== manifest.sourceDir) {
      if (name === manifest.db.name) {
        problems.push(
          `config ${c} overrides sourceDir but reuses the global DB slot "${name}" — a separate lineage must pin its own slot`,
        );
      }
    }
  }
  return problems;
}

/**
 * R2-06 run metadata: resolved absolute paths, pinned SHAs and host facts
 * are per-run observations — they are written to OUT_ROOT/run-meta/
 * (gitignored) and never stored in the manifest. A metadata write failure
 * must never break a run.
 */
function writeRunMeta(command, extra = {}) {
  try {
    const dir = join(OUT_ROOT, "run-meta");
    mkdirSync(dir, { recursive: true });
    let load1 = null;
    try {
      load1 = Number(readFileSync("/proc/loadavg", "utf8").split(" ")[0]);
    } catch {
      /* non-Linux host */
    }
    const meta = {
      command,
      writtenAt: new Date().toISOString(),
      pid: process.pid,
      host: {
        platform: `${process.platform}/${process.arch}`,
        node: process.version,
        loadavg1: load1,
      },
      manifest: MANIFEST
        ? {
            globalSourceDir: MANIFEST.sourceDir,
            commitSha: MANIFEST.commitSha,
            db: MANIFEST.db.name,
            configs: Object.fromEntries(
              Object.entries(MANIFEST.configs).map(([k, v]) => [
                k,
                {
                  sourceDir: v.sourceDir,
                  commitSha: v.commitSha ?? MANIFEST.commitSha,
                  db: v.db ?? MANIFEST.db.name,
                  port: v.port,
                },
              ]),
            ),
          }
        : null,
      ...extra,
    };
    const file = join(dir, `${Date.now()}-pid${process.pid}-${command}.json`);
    writeFileSync(file, JSON.stringify(meta, null, 2));
    return { file, meta };
  } catch {
    return null;
  }
}

function readH0Register() {
  try {
    const p = join(OUT_ROOT, "h0-equivalence.json");
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Gate item 7: H0 may only join the sanctioned participation modes AND only
 * after the §6.6-3 oracle-equivalence register (≥3 verified segments per
 * workload) exists — otherwise every H0 row would be NON_COMPARABLE and the
 * honest answer is to refuse the run, not to emit unlabeled numbers.
 *
 * Sanctioned modes (PROTOCOL-v2 §6.2): the mixed gear and the §6.6-3 oracle
 * equivalence verification. The `equivalence` suite is the register PRODUCER
 * — the register requirement cannot gate the segments that create the
 * register (chicken-and-egg), so in producer mode this item enforces only
 * mode membership + gear discipline; every other gate item still applies.
 */
function h0ComparabilityProblems({
  configs,
  suite,
  concurrency,
  equivalenceRegister,
  gearConcurrency,
}) {
  const problems = [];
  if (!configs.includes("H0")) return problems;
  const producerMode = suite === "equivalence";
  if (suite !== "mixed" && !producerMode) {
    problems.push(
      `H0 participates only in the mixed gear and the §6.6-3 equivalence producer (PROTOCOL-v2 §6.2); suite=${suite}`,
    );
  }
  // INVARIANT: H0 measurement rows join the mixed unit only at the
  // manifest-frozen gear. The hardcoded v2 §3.4 "typical gear C=10" value was
  // superseded on the concurrency axis by the PROTOCOL-v4 §3 parameter freeze
  // (P_CONC=1, Owner adjudication §1.3-4: backend saturation is
  // C-independent, the ladder measured no feasible gear at the old 4.0 cap,
  // manifest workload.concurrency pins the frozen gear) — the v4 §4
  // inheritance keeps the v3 §6.1 item-7 spec, which carries NO concurrency
  // literal. The guard still refuses any gear other than the frozen one.
  if (
    concurrency !== undefined &&
    gearConcurrency !== undefined &&
    concurrency !== gearConcurrency
  ) {
    problems.push(
      `H0 joins only the frozen mixed gear P_CONC=${gearConcurrency} (PROTOCOL-v4 §3 parameter freeze; v2 §3.4 typical C=10 superseded); concurrency=${concurrency}`,
    );
  }
  if (configs.some((c) => c === "S0" || c === "S1")) {
    problems.push(
      "S-dimension arms (S0/S1) alongside H0 are NON_COMPARABLE (PROTOCOL-v2 §6.6-2)",
    );
  }
  if (producerMode) return problems;
  const reg = equivalenceRegister ?? readH0Register();
  if (!reg || reg.verified !== true) {
    problems.push(
      "H0 oracle-equivalence register missing/unverified — run the §6.6-3 equivalence set (≥3 segments per workload) first; H0 rows would be NON_COMPARABLE",
    );
  } else {
    const gaps = ["W01", "W03", "W05", "W08"].filter(
      (w) => (reg.workloads?.[w] ?? 0) < 3,
    );
    if (gaps.length > 0) {
      problems.push(
        `equivalence register covers <3 segments for ${gaps.join(", ")} (PROTOCOL-v2 §6.6-3)`,
      );
    }
  }
  return problems;
}

/**
 * Segment pre-check gate — 7 mandatory items, enforced at round/campaign
 * entry. Rejects fail-closed before any segment runs.
 */
async function precheckGate({
  configs,
  suite = "mixed",
  workflow = "mixed",
  concurrency,
  manifest,
  load1Override,
  clockJumpOverride,
  equivalenceRegister,
}) {
  // Default manifest resolution: the CLI-loaded manifest, else the repo
  // configs.json (directed tests import this module without running main).
  const m = manifest ?? MANIFEST ?? loadManifest(join(HERE, "configs.json"));
  const checks = [];
  const add = (item, problems, passDetail) =>
    checks.push({
      item,
      ok: problems.length === 0,
      detail: String(problems.join("; ") || passDetail).slice(0, 400),
    });

  // 1. workload plan count correct (R2-02: derived from the real buildOpPlan;
  //    the c4Rejects parent quota must never be double-counted)
  const wl = expectedWorkload(m.workload.quotas);
  add(
    "workload-plan-count",
    workloadPlanProblems(m.workload.quotas),
    `expectedOps=${wl.totalOps} derived from buildOpPlan (naive all-keys sum would double-count c4Rejects=${m.workload.quotas.c4Rejects})`,
  );

  // 2. fixture + oracle correct
  const fixture = fixtureProblems(
    m.workload.quotas,
    m.workload.prepPool,
    m.db.name,
  );
  const oracle = oracleInjectionProblems();
  add(
    "fixture-oracle",
    [...fixture.problems, ...oracle.problems],
    `pools cover quotas (plan=${fixture.plan.length} attempts over ${fixture.owners} owners); oracle accepts ${oracle.goodCount} good shapes and flags ${oracle.bad.length} injected bad samples`,
  );

  // 3. CPU first/last sample channel works (real /proc probe)
  const p3 = await procChannelProblems({});
  add(
    "proc-channel",
    p3,
    "live /proc probe produced a monotonic first+last sample pair with VmRSS readable",
  );

  // 4. external interference inside the protocol allowance
  const load1 =
    load1Override ??
    Number(readFileSync("/proc/loadavg", "utf8").split(" ")[0]);
  add(
    "interference",
    interferenceProblems({ load1, clockJumpMs: clockJumpOverride ?? 0 }),
    `entry loadavg=${load1} ≤ ${INTERFERENCE_ENTRY_LIMIT} (§6.5/§6.1; PROTOCOL-v4 entry discipline unchanged)`,
  );

  // 5. source SHA / environment consistency — per lineage: a config may pin
  // its own sourceDir + commitSha (H0 = pre-OTel tree at cb1e614f), so every
  // distinct (sourceDir, commitSha) pair in the unit is checked, not just the
  // global one
  const lineages = new Map();
  for (const c of configs) {
    const entry = m.configs[c] ?? {};
    const dir = entry.sourceDir ?? m.sourceDir;
    const sha = entry.commitSha ?? m.commitSha;
    lineages.set(`${dir}@${sha}`, { sourceDir: dir, commitSha: sha });
  }
  const p5 = (
    await Promise.all([...lineages.values()].map(sourceShaProblems))
  ).flat();
  add(
    "source-sha-env",
    p5,
    `product tree (apps/, packages/) byte-identical to ${lineages.size} pinned lineage(s): ${[...lineages.keys()].map((k) => k.split("@")[1].slice(0, 10)).join(", ")}`,
  );

  // 6. experimental database isolation
  add(
    "db-isolation",
    dbIsolationProblems(m, configs),
    "every segment DB inside the §2.8 exam_e2e_w<N> family with explicit fullResetAllowed",
  );

  // 7. workload type vs H0 comparability verified
  add(
    "h0-comparability",
    h0ComparabilityProblems({
      configs,
      suite,
      concurrency,
      equivalenceRegister,
      gearConcurrency: m.workload?.concurrency,
    }),
    configs.includes("H0")
      ? "H0 comparability verified via the §6.6-3 register (mixed gear at the manifest-frozen P_CONC; equivalence suite = register producer)"
      : "H0 not in this unit — item trivially satisfied",
  );

  return { ok: checks.every((c) => c.ok), checks };
}

async function cmdRound({ round, configs, concurrency, gcObserve }) {
  if (!Array.isArray(configs) || configs.length === 0) {
    throw new Error("round needs --configs A,B[,…]");
  }
  for (const c of configs) {
    if (!MANIFEST.configs[c])
      throw new Error(`unknown config "${c}" in manifest`);
  }
  // Single-instance preflight (fail-closed, operational abort — not a gate
  // judgment): every API port this round binds (plus the sink port when an
  // OTLP config participates) must be free BEFORE the gate. A port already
  // in LISTEN means a previous run's server or another experiment is live.
  const preflightProblems = await preflightPortsProblems({
    ports: [
      ...configs.map((c) => MANIFEST.configs[c].port),
      ...(configs.some((c) => MANIFEST.configs[c].env.TELEMETRY_OTLP_ENDPOINT)
        ? [MANIFEST.sink.port]
        : []),
    ],
  });
  if (preflightProblems.length > 0) {
    throw new Error(
      `port preflight rejected — round not started: ${preflightProblems.join("; ")}`,
    );
  }
  // Mandatory round-entry pre-check gate (7 items). Fail-closed: no segment
  // runs until every item passes.
  const gate = await precheckGate({
    configs,
    suite: "round",
    workflow: MANIFEST.workload.mode ?? "mixed",
    concurrency: concurrency ?? MANIFEST.workload.concurrency,
  });
  if (!gate.ok) {
    return {
      round,
      gate,
      results: [],
      driftNotes: `precheck gate rejected — no segment started: ${gate.checks
        .filter((c) => !c.ok)
        .map((c) => `${c.item}: ${c.detail}`)
        .join(" | ")}`,
    };
  }
  mkdirSync(ROUNDS_DIR, { recursive: true });
  const roundDir = join(ROUNDS_DIR, `round-${round}`);
  mkdirSync(roundDir, { recursive: true });
  // PROTOCOL §6.1: rotate the config order across rounds (round 0 = pilot
  // rotates by configs.length-1; normalized modulo keeps this exact for ≥1)
  const shift =
    (((round - 1) % configs.length) + configs.length) % configs.length;
  const rotated = [...configs.slice(shift), ...configs.slice(0, shift)];
  const results = [];
  const driftNotes = [];

  let sink = null;
  if (rotated.some((c) => MANIFEST.configs[c].env.TELEMETRY_OTLP_ENDPOINT)) {
    sink = await startSink(MANIFEST.sink.port, MANIFEST.sink.mode);
  }
  if (gcObserve) {
    driftNotes.push(
      "GC observation is a sidecar-only channel (--trace-gc has runtime overhead, PROTOCOL §5); perf segments in this run carry no NODE_OPTIONS flags.",
    );
  }

  try {
    for (const configName of rotated) {
      const segmentDir = join(roundDir, configName);
      const startedAt = new Date().toISOString();
      const seg = await runSegment({
        configName,
        round,
        segmentDir,
        sinkPort: sink?.port ?? null,
        concurrency: concurrency ?? MANIFEST.workload.concurrency,
      });
      seg.startedAt = startedAt;
      results.push(seg);
      driftNotes.push(...(seg.notes ?? []).map((n) => `[${configName}] ${n}`));
      for (const reason of seg.invalidReasons ?? []) {
        driftNotes.push(`[${configName}] INVALID: ${reason}`);
      }
      writeFileSync(
        join(roundDir, "round.json"),
        JSON.stringify({ round, order: rotated, results }, null, 2),
      );
    }
  } finally {
    if (sink) await stopSink(sink);
  }

  const markerResults = results.map((seg) => ({
    config: seg.config,
    valid: seg.valid,
    ops: seg.ops ?? 0,
    errors: seg.errors ?? 0,
    cpuMsPerOp: seg.cpuMsPerOp ?? null,
    p50Ms: seg.p50Ms ?? null,
    p95Ms: seg.p95Ms ?? null,
    p99Ms: seg.p99Ms ?? null,
    rssMb: seg.rssMb ?? null,
  }));
  return {
    round,
    gate: { ok: true },
    throughputSemantics: CLOSED_LOOP_SEMANTICS,
    results: markerResults,
    driftNotes: driftNotes.join(" | "),
  };
}

async function cmdValidate({ round }) {
  const roundDir = join(ROUNDS_DIR, `round-${round}`);
  const violations = [];
  const warnings = [];
  if (!existsSync(roundDir)) {
    return {
      valid: false,
      violations: [
        { check: "round-dir", detail: `no round dir at ${roundDir}` },
      ],
      warnings,
    };
  }
  const roundIndex = JSON.parse(
    readFileSync(join(roundDir, "round.json"), "utf8"),
  );
  let lastValidSeg = null;
  for (const segMeta of roundIndex.results ?? []) {
    const segDir = join(roundDir, segMeta.config);
    const segPath = join(segDir, "segment-summary.json");
    if (!existsSync(segPath)) {
      violations.push({
        config: segMeta.config,
        check: "segment-summary",
        detail: "missing segment-summary.json",
      });
      continue;
    }
    const seg = JSON.parse(readFileSync(segPath, "utf8"));
    if (!seg.valid) {
      violations.push({
        config: seg.config,
        check: "segment-validity",
        detail: `segment invalid: ${(seg.invalidReasons ?? []).join("; ")}`,
      });
      continue;
    }
    lastValidSeg = { seg, segDir, config: segMeta.config };

    // (a) re-run the per-op oracle over the raw JSONL
    const opsPath = join(segDir, "ops.jsonl");
    if (!existsSync(opsPath)) {
      violations.push({
        config: seg.config,
        check: "ops-jsonl",
        detail: "missing ops.jsonl",
      });
      continue;
    }
    const lines = readFileSync(opsPath, "utf8").split("\n").filter(Boolean);
    let bad = 0;
    const samples = [];
    for (const line of lines) {
      let rec;
      try {
        rec = JSON.parse(line);
      } catch {
        bad++;
        violations.push({
          config: seg.config,
          check: "ops-jsonl",
          detail: "unparseable op line",
        });
        continue;
      }
      if ((rec.violations ?? []).length > 0) {
        bad++;
        if (samples.length < 3) samples.push(`${rec.op}: ${rec.violations[0]}`);
      }
    }
    if (bad !== (seg.errors ?? 0)) {
      violations.push({
        config: seg.config,
        check: "oracle-recount",
        detail: `ops.jsonl has ${bad} violating ops but the summary recorded errors=${seg.errors} (samples: ${samples.join(" | ")})`,
      });
    }
    if (lines.length !== (seg.ops ?? 0)) {
      violations.push({
        config: seg.config,
        check: "ops-count",
        detail: `ops.jsonl lines=${lines.length}, summary ops=${seg.ops}`,
      });
    }

    // (b) terminal-state assertions from the captured snapshot
    const ts = seg.terminalState;
    if (!ts) {
      violations.push({
        config: seg.config,
        check: "terminal-state",
        detail: "capture missing",
      });
      continue;
    }
    const c = ts.counts ?? {};
    const q = MANIFEST.workload.quotas;
    const p = MANIFEST.workload.prepPool;
    const baselineSubmitAudit = seg.seedCounts?.submitAudit ?? 0;
    const submitDelta = (c.submitAuditTotal ?? 0) - baselineSubmitAudit;
    // W05: exactly one attempt.submit audit per fresh candidate submit.
    // Duplicates are zero-write; deadline auto-submit is audit-free (W08 row).
    const expectSubmitDelta = q.c5SubmitFresh + p.closedAttemptsC4;
    if (submitDelta !== expectSubmitDelta) {
      violations.push({
        config: seg.config,
        check: "W05-submit-audit",
        detail: `attempt.submit audit delta=${submitDelta}, expected ${expectSubmitDelta} (fresh submits ${q.c5SubmitFresh} + prep-frozen closed pool ${p.closedAttemptsC4}; duplicates zero-write, auto-submit audit-free)`,
      });
    }
    // W08+W09: take-frozen + scanner auto-submits + prep-closed pool
    const deadlineMin =
      q.c6TakeFrozen + p.staleAttemptsW09 + p.closedAttemptsC4;
    if ((c.deadlineSubmitted ?? 0) < deadlineMin) {
      violations.push({
        config: seg.config,
        check: "W08/W09-deadline-submitted",
        detail: `deadline-submitted=${c.deadlineSubmitted}, expected >= ${deadlineMin}`,
      });
    }
    // W06: exactly one bounded_grace adjustment per restored episode
    const expectAdjust = q.c6Restore + p.closedAttemptsC4;
    if ((c.boundedGraceAdjustments ?? 0) !== expectAdjust) {
      violations.push({
        config: seg.config,
        check: "W06-bounded-grace-adjustments",
        detail: `bounded_grace adjustments=${c.boundedGraceAdjustments}, expected ${expectAdjust} (one per restored/frozen episode)`,
      });
    }
    // W12: one outbox row per reset request; fake transport never dead-letters
    if (
      (c.outboxTotal ?? 0) !== q.c7PasswordReset ||
      (c.outboxDead ?? 0) !== 0
    ) {
      violations.push({
        config: seg.config,
        check: "W12-outbox",
        detail: `outbox total=${c.outboxTotal} (expected ${q.c7PasswordReset}), dead=${c.outboxDead} (expected 0); sent=${c.outboxSent} (drain fraction is shutdown-timing dependent, reported not asserted)`,
      });
    }
    // W11: retention emptied the ≥30d fixture at boot; nothing ingests in v1
    if ((c.clientEventsTotal ?? 0) > 0) {
      violations.push({
        config: seg.config,
        check: "W11-retention",
        detail: `client_events=${c.clientEventsTotal} at segment end, expected 0 (10k-row ≥30d fixture deleted by the startup pass; no ingest ops in this harness version)`,
      });
    }
    // C3: receipt rows exist for the accepted-save share of each hot attempt
    const receiptEntries = Object.values(ts.hotReceipts ?? {});
    if (receiptEntries.length > 0) {
      const expectedMin =
        Math.floor(q.c3SaveAccepted / Math.max(1, p.hotAttemptsC3)) + 1; // +1 prep save
      const thin = receiptEntries.filter(
        (r) => r.receipts < expectedMin - 2,
      ).length;
      if (thin > 0) {
        violations.push({
          config: seg.config,
          check: "C3-receipts",
          detail: `${thin}/${receiptEntries.length} hot attempts have fewer receipt rows than the accepted-save share (~${expectedMin}); receipts are missing`,
        });
      }
    }
  }

  // (c) live DB recheck — only meaningful for the LAST valid segment (later
  // segments re-seed and destroy earlier terminal state; the per-segment
  // captures above are the evidence for those).
  if (lastValidSeg?.seg.terminalState) {
    try {
      const sql = await openVerified(
        dbUrlFor(lastValidSeg.config),
        configDbName(lastValidSeg.config),
      );
      try {
        const live = await captureTerminalState(sql, []);
        const probes = [
          [
            "submitAuditTotal",
            live.counts.submitAuditTotal,
            lastValidSeg.seg.terminalState.counts.submitAuditTotal,
          ],
          [
            "deadlineSubmitted",
            live.counts.deadlineSubmitted,
            lastValidSeg.seg.terminalState.counts.deadlineSubmitted,
          ],
          [
            "outboxTotal",
            live.counts.outboxTotal,
            lastValidSeg.seg.terminalState.counts.outboxTotal,
          ],
        ];
        const mismatched = probes.filter(([l, a, b]) => a !== b);
        if (mismatched.length > 0) {
          warnings.push(
            `live DB no longer holds round-${round} terminal state (a later round re-seeded) — captured per-segment snapshots remain the evidence. Mismatched probes: ${mismatched.map(([l, a, b]) => `${l} live=${a} captured=${b}`).join(", ")}`,
          );
        }
      } finally {
        await sql.end({ timeout: 3 });
      }
    } catch (err) {
      warnings.push(
        `live DB recheck unavailable: ${String(err).slice(0, 160)}`,
      );
    }
  }
  return { valid: violations.length === 0, violations, warnings };
}

async function cmdAggregate() {
  const rounds = [];
  let pilotExcluded = false;
  if (existsSync(ROUNDS_DIR)) {
    for (const name of readdirSync(ROUNDS_DIR).sort()) {
      if (!/^round-\d+$/.test(name)) continue;
      // Round 0 is the pilot round: it proves the end-to-end walkthrough but
      // never enters the formal paired statistics (rounding contract: pilot
      // data is excluded from aggregate rows and CI).
      if (name === "round-0") {
        pilotExcluded = true;
        continue;
      }
      const idxPath = join(ROUNDS_DIR, name, "round.json");
      if (!existsSync(idxPath)) continue;
      const idx = JSON.parse(readFileSync(idxPath, "utf8"));
      const segments = [];
      for (const segMeta of idx.results ?? []) {
        const segPath = join(
          ROUNDS_DIR,
          name,
          segMeta.config,
          "segment-summary.json",
        );
        if (!existsSync(segPath)) continue;
        const seg = JSON.parse(readFileSync(segPath, "utf8"));
        segments.push({
          config: segMeta.config,
          valid: seg.valid === true,
          summary: seg,
        });
      }
      rounds.push({ round: idx.round, segments });
    }
  }
  const agg = aggregateCore(rounds);
  for (const r of rounds) {
    for (const s of r.segments) {
      if (!s.valid)
        agg.notes.push(
          `round ${r.round} [${s.config}] excluded (invalid segment: ${(s.summary.invalidReasons ?? []).join("; ") || "unknown"})`,
        );
    }
  }
  if (rounds.length === 0)
    agg.notes.push(
      `no rounds found under ${ROUNDS_DIR} — nothing to aggregate`,
    );
  if (pilotExcluded)
    agg.notes.push(
      "round 0 (pilot) present but excluded from formal aggregation — pilot data never enters statistics",
    );
  const pairsNote = agg.rows
    .filter((r) => r.n > 0 && r.n < 6)
    .map(
      (r) =>
        `[${r.config}] n=${r.n} < 6 valid pairs → UNKNOWN per PROTOCOL §6.4 (sampling is separately authorized; this harness build has not run Stage D-G)`,
    );
  if (pairsNote.length > 0) agg.notes.push(...pairsNote);
  return agg;
}

async function cmdProfile({ configName, outDir }) {
  const config = MANIFEST.configs[configName];
  if (!config) throw new Error(`unknown config ${configName}`);
  mkdirSync(outDir, { recursive: true });
  const dbUrl = dbUrlFor(configName);
  const dbName = configDbName(configName);
  await ensureBenchDatabase(() => {}, configName);
  await convergeSeed(dbUrl, join(outDir, "seed-converge.log"), configName);
  const sql0 = await openVerified(dbUrl, dbName);
  let examId;
  try {
    examId = (await extendSeed(sql0, () => {})).examId;
  } finally {
    await sql0.end({ timeout: 3 });
  }
  const env = buildLaunchEnv(config, {
    segmentDir: outDir,
    sinkPort: MANIFEST.sink.port,
    dbUrl,
    extraNodeFlags: [
      "--cpu-prof",
      `--cpu-prof-dir=${outDir}`,
      "--heap-prof",
      `--heap-prof-dir=${outDir}`,
    ],
  });
  const server = spawnServer(
    config,
    env,
    join(outDir, "profile-out.log"),
    join(outDir, "profile-err.log"),
  );
  const http = new Http(`http://127.0.0.1:${config.port}`);
  try {
    await waitHttp(`http://127.0.0.1:${config.port}/api/health`, {
      timeoutMs: BOOT_WAIT_MS,
    });
    await waitHttp(`http://127.0.0.1:${config.port}/api/ready`, {
      timeoutMs: READY_WAIT_MS,
    });
    const sql = await openVerified(dbUrl, dbName);
    try {
      const tinyPool = {
        hotAttemptsC3: 4,
        submitAttemptsC5: 4,
        frozenAttemptsW08: 4,
        unchangedAttemptsW08: 2,
        disruptedAttemptsW06: 2,
        staleAttemptsW09: 2,
        closedAttemptsC4: 2,
      };
      const plan = buildAttemptPlan(tinyPool);
      const prep = await runPrep({ http, sql, plan, examId });
      const ctx = { http, sql, prep, t0: Date.now(), cursors: {} };
      const fixedOps = [];
      for (let i = 0; i < 200; i++) fixedOps.push({ kind: "health" });
      for (let i = 0; i < 100; i++) fixedOps.push({ kind: "ready" });
      for (let i = 0; i < 100; i++)
        fixedOps.push({
          kind: "login",
          username: BENCH.candidateName((i % 100) + 1),
        });
      for (let i = 0; i < 100; i++) fixedOps.push({ kind: "examList" });
      for (let i = 0; i < 100; i++) fixedOps.push({ kind: "saveAccepted" });
      for (let i = 0; i < 100; i++) fixedOps.push({ kind: "heartbeat" });
      for (let i = 0; i < 100; i++)
        fixedOps.push({
          kind: "passwordReset",
          username: BENCH.candidateName(i + 1),
        });
      shuffleSeeded(fixedOps, mulberry32(42));
      let stop = false;
      await runOpStream(fixedOps, 8, async (op) => {
        if (stop) return false;
        if (op.prepare) await op.prepare(ctx);
        await execOp(op, ctx);
        return true;
      });
    } finally {
      await sql.end({ timeout: 3 });
    }
  } finally {
    await stopServerGracefully(server.child);
  }
  const files = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(cpuprofile|heapprofile)$/.test(e.name)) files.push(p);
    }
  };
  walk(outDir);
  return { config: configName, out: outDir, files };
}

// ── 8c. pilot / campaign (PROTOCOL-v2 §3.2/§3.4 skeletons) ───────────────
//
// This phase's contract is the pre-check gate plus the sampling closed loop.
// Segment execution reuses runSegment unchanged; Stage D-G sampling remains
// separately authorized (PROTOCOL 角色与授权) — the commands run the gate,
// then execute real segments only when actually invoked.

const PILOT_GEARS = [25, 50, 100, 200]; // PROTOCOL-v2 §3.4 (frozen ladder)

// Client op budget for PILOT LADDER gears only. The 30s default (OP_TIMEOUT_MS)
// manufactures phantom oracle violations in the saturated recon regime: at
// c100 the server's queueing pushes single ops past 30s, the client aborts
// them mid-flight, the abandoned server-side writes still commit (or land
// late), and every later op on the same attempt then sees a drifted client
// state — measured 2026-11-15: 92/92 non-transport oracle violations in the
// c100 gear followed a same-attempt transport timeout, and every "violation"
// body was a contract-conformant STALE_VERSION rejection (the product
// correctly rejecting drifted client state). No protocol clause freezes the
// client op budget (the 30s figures in PROTOCOL*.md are the T9 shutdown
// budget, the W09 tick, and fault-injection reads — grep-verified). Formal
// round/campaign segments keep 30s: the typical gear (C=10) ran sub-second
// op latencies in v1 (~30x headroom). Segment wall time stays bounded by the
// warmup/steady windows plus at most one op budget of tail per worker.
// 240s = 1.33× P_STEADY, comfortably above the c100 observed 55.9s max op.
const LADDER_OP_TIMEOUT_MS = 240_000;

// ── pilot ladder judgment (PROTOCOL-v3 §4.3 rule 3, §4.1 mechanical rule) ──
//
// Under the PRE-backfill manifest the quota is deliberately oversized
// (11000 ops vs steadyMaxSeconds=180 — the §4.2/§5 backfill input), so a
// ladder gear finishing "steady window exceeded … before quota completion"
// is the DESIGNED outcome of reconnaissance: the ladder reads the p99/load1
// shape, not quota completion. Any OTHER invalid reason is structural
// (seed, sampler channel, oracle, server exit, checksum, background
// interference, …) — per §4.3 rule 3 the ladder stops; it is never partially
// reused. An in-window `1m loadavg … inside segment` reason is the §4.1
// mechanical rule's own recon outcome: that gear's knee faces are
// eliminated (recorded) while the ladder continues. One authoritative pure
// classifier so cmdPilot and the selftest injection matrix run the same
// code. Formal round/campaign segment semantics are untouched — this
// tolerance exists ONLY for pilot ladder rows.
const PILOT_QUOTA_EXCEEDED_PREFIX = "steady window exceeded";
// PROTOCOL-v4 §2: both in-window interference breach reasons are
// environmental (load-shape) recon outcomes — the gear's knee faces are
// eliminated while the ladder continues; neither is structural.
const PILOT_LOAD_SHAPE_PREFIXES = ["1m loadavg", "external load increment"];
const PILOT_SAMPLER_CHANNEL_PREFIXES = [
  "proc sampler produced no first sample",
  "steady window closed with", // "< 2 samples, no CPU differential"
  "proc cpu counter non-monotonic",
  "sampler clock jump",
];

function classifyPilotGearReasons(reasons = []) {
  const quotaExceeded = reasons.filter((r) =>
    r.startsWith(PILOT_QUOTA_EXCEEDED_PREFIX),
  );
  const loadShape = reasons.filter((r) =>
    PILOT_LOAD_SHAPE_PREFIXES.some((p) => r.startsWith(p)),
  );
  const samplerChannel = reasons.filter((r) =>
    PILOT_SAMPLER_CHANNEL_PREFIXES.some((p) => r.startsWith(p)),
  );
  const structural = reasons.filter(
    (r) =>
      !quotaExceeded.includes(r) &&
      !loadShape.includes(r) &&
      !samplerChannel.includes(r),
  );
  return { quotaExceeded, loadShape, samplerChannel, structural };
}

/** Single authoritative pilot-ladder judgment (cmdPilot + selftest share it). */
function judgePilotLadder(rows) {
  const gears = rows.map((r) => ({
    ...r,
    ...classifyPilotGearReasons(r.invalidReasons ?? []),
  }));
  let structuralStop = null;
  for (const g of gears) {
    const blocking = [...g.samplerChannel, ...g.structural];
    if (blocking.length > 0) {
      structuralStop = { gear: g.concurrency, reasons: blocking };
      break;
    }
  }
  // §4.2 K_pilot: the gear BEFORE the first gear whose p99 more than doubles
  // vs its predecessor. p99 shape is the recon signal — a quota-exceeded
  // gear still measured real latencies (§4.3 rule 3), so usability requires
  // a non-null p99 and a non-structural segment, not quota completion.
  let kPilot = null;
  for (let i = 1; i < gears.length && kPilot === null; i++) {
    const usable = (g) =>
      g.p99Ms !== null &&
      g.p99Ms !== undefined &&
      g.structural.length === 0 &&
      g.samplerChannel.length === 0;
    if (
      usable(gears[i - 1]) &&
      usable(gears[i]) &&
      gears[i].p99Ms > 2 * gears[i - 1].p99Ms
    ) {
      kPilot = PILOT_GEARS[i - 1];
    }
  }
  const cpuSamplesValid =
    gears.length > 0 && gears.every((g) => g.samplerChannel.length === 0);
  return {
    gears,
    structuralStop,
    kPilot,
    cpuSamplesValid,
    quotaExceededGears: gears
      .filter((g) => g.quotaExceeded.length > 0)
      .map((g) => g.concurrency),
    loadEliminatedGears: gears
      .filter((g) => g.loadShape.length > 0)
      .map((g) => g.concurrency),
  };
}

/**
 * Pilot: H1 mixed gear, one segment per ladder gear, round 0 convention
 * (pilot data never enters aggregate). K_pilot = the gear BEFORE the first
 * gear whose p99 more than doubles vs its predecessor; if no knee appears,
 * it is NOT auto-derived — the §3.4 resource-exhaustion fallback analysis is
 * left to the operator and the register records that explicitly.
 *
 * ok = port preflight clean + gate.ok + every gear ran with NO structural
 * invalid reason (quota-exceeded and in-window-load gears are recorded
 * recon outcomes, PROTOCOL-v3 §4.3 rule 3 / §4.1) + the /proc CPU channel
 * valid in every gear. The payload also carries the measured per-gear
 * throughput, load stats and the H1-only preliminary backfill triple the
 * workflow/protocol designer consumes (PROTOCOL-v3 §4.2/§5) — measurement
 * output, not a judgment change.
 */
async function cmdPilot({ configName }) {
  if (!MANIFEST.configs[configName]) {
    throw new Error(`unknown config "${configName}"`);
  }
  const notes = [];
  const entryLoad1 = Number(
    readFileSync("/proc/loadavg", "utf8").split(" ")[0],
  );
  // Single-instance preflight BEFORE the gate: an occupied API port means a
  // previous run's server (or another experiment) is live — fail fast with
  // an actionable reason instead of a confusing mid-run collision.
  const preflight = {
    ok: false,
    problems: await preflightPortsProblems({
      ports: [MANIFEST.configs[configName].port],
    }),
  };
  preflight.ok = preflight.problems.length === 0;
  if (!preflight.ok) {
    notes.push("port preflight rejected — pilot not started");
  }
  const gate = preflight.ok
    ? await precheckGate({
        configs: [configName],
        suite: "pilot",
        workflow: "mixed",
        concurrency: PILOT_GEARS[0],
      })
    : { ok: true, checks: [] }; // gate skipped: preflight already failed
  if (preflight.ok && !gate.ok) {
    notes.push("precheck gate rejected — pilot not started");
  }
  const ladder = [];
  let kPilot = null;
  let judgment = null;
  if (preflight.ok && gate.ok) {
    const pilotDir = join(OUT_ROOT, "pilot");
    mkdirSync(pilotDir, { recursive: true });
    for (let i = 0; i < PILOT_GEARS.length; i++) {
      const c = PILOT_GEARS[i];
      const seg = await runSegment({
        configName,
        round: 0,
        segmentDir: join(pilotDir, `c${c}`),
        sinkPort: null,
        concurrency: c,
        opTimeoutMs: LADDER_OP_TIMEOUT_MS,
      });
      const cls = classifyPilotGearReasons(seg.invalidReasons ?? []);
      ladder.push({
        concurrency: c,
        valid: seg.valid,
        ops: seg.ops ?? 0,
        p99Ms: seg.p99Ms ?? null,
        throughputOpsPerSec: seg.throughputOpsPerSec ?? null,
        maxLoad1: seg.maxLoad1 ?? null,
        cpuMsPerOp: seg.cpuMsPerOp ?? null,
        preSteadySeconds: seg.preSteadySeconds ?? null,
        warmupSeconds: seg.warmupSeconds ?? null,
        shutdownMs: seg.shutdown?.ms ?? null,
        collectMs: seg.collectMs ?? null,
        quotaExceededExpected: cls.quotaExceeded.length > 0,
        invalidReasons: seg.invalidReasons ?? [],
      });
      if (cls.structural.length > 0 || cls.samplerChannel.length > 0) {
        notes.push(
          `gear c${c} structural invalid (PROTOCOL-v3 §4.3 rule 3) — ladder stopped, full ladder rerun required after the fix: ${[...cls.samplerChannel, ...cls.structural].join("; ")}`,
        );
        break;
      }
      if (cls.loadShape.length > 0) {
        notes.push(
          `gear c${c} in-window load1 > ${LOADAVG_HARD_LIMIT} — knee gradient faces at this gear eliminated (PROTOCOL-v3 §4.1 mechanical rule)`,
        );
      }
    }
    judgment = judgePilotLadder(ladder);
    kPilot = judgment.kPilot;
    if (judgment.loadEliminatedGears.length > 0) {
      notes.push(
        `knee-gradient gears eliminated by in-window load: c${judgment.loadEliminatedGears.join(", c")}`,
      );
    }
    if (judgment.quotaExceededGears.length > 0) {
      notes.push(
        `quota-exceeded gears recorded as the designed recon outcome (PROTOCOL-v3 §4.3 rule 3): c${judgment.quotaExceededGears.join(", c")} — P_QUOTA backfill comes from throughput below`,
      );
    }
    if (kPilot === null) {
      notes.push(
        "no >2x p99 knee observed in the ladder — K_pilot needs the §3.4 resource-exhaustion fallback analysis before knee-gear sampling (not auto-derived)",
      );
    }
  }
  // PROTOCOL-v3 §4.2/§5 backfill inputs measured this run (H1-only
  // preliminary — the min-over-arms rule needs H2/H4 round-0 probes, so the
  // quotaOps figure below is a ceiling estimate pending those probes).
  const throughput = ladder.map((l) => ({
    concurrency: l.concurrency,
    ops: l.ops,
    throughputOpsPerSec: l.throughputOpsPerSec,
    valid: l.valid,
    quotaExceededExpected: l.quotaExceededExpected,
    maxLoad1: l.maxLoad1,
  }));
  const steadyCandidate = MANIFEST.workload.steadyMaxSeconds;
  const yBest = Math.max(
    0,
    ...ladder
      .map((l) => l.throughputOpsPerSec ?? 0)
      .filter((v) => Number.isFinite(v)),
  );
  const overheads = ladder
    .map((l) => (l.preSteadySeconds ?? 0) - (l.warmupSeconds ?? 0))
    .filter((v) => Number.isFinite(v) && v > 0);
  const sSc = ladder
    .map((l) => ((l.shutdownMs ?? 0) + (l.collectMs ?? 0)) / 1000)
    .filter((v) => Number.isFinite(v) && v > 0);
  const overheadMax = overheads.length ? Math.max(...overheads) : null;
  const sScMax = sSc.length ? Math.max(...sSc) : null;
  // §4.2 轮窗算术: 5 × (overhead + 60 + P_STEADY + s_sc) ≤ 2700 — shrink the
  // candidate if the measured fixed costs break it.
  let recommendedSteady = steadyCandidate;
  if (overheadMax !== null && sScMax !== null) {
    const budget = 2700 / 5 - overheadMax - 60 - sScMax;
    if (budget < recommendedSteady)
      recommendedSteady = Math.max(30, Math.floor(budget));
  }
  const recommended = {
    steadyMaxSeconds: recommendedSteady,
    quotaOps: yBest > 0 ? Math.floor(0.8 * yBest * recommendedSteady) : 0,
    concurrency: MANIFEST.workload.concurrency,
    basis: [
      `H1-only preliminary (PROTOCOL-v3 §4.2): quotaOps = floor(0.8 × ŷ_max=${yBest || "n/a"} ops/s × P_STEADY=${recommendedSteady}s) — min-over-arms backfill still requires H2/H4 round-0 probes before freeze`,
      `轮窗算术 (§4.2/§5): measured overhead=${overheadMax ?? "n/a"}s (converge+extend+boot+prep, warmup excluded), s_sc=${sScMax ?? "n/a"}s (shutdown+collect) → P_STEADY budget ${overheadMax !== null && sScMax !== null ? Math.floor(2700 / 5 - overheadMax - 60 - sScMax) : "n/a"}s`,
      `P_CONC left at manifest value ${MANIFEST.workload.concurrency}: the pilot ladder is knee reconnaissance only; a P_CONC backfill must be covered by its own probe + confirmation segments (PROTOCOL-v3 §5)`,
    ],
  };
  const loadStats = `entry loadavg=${entryLoad1}; gears maxLoad1=${ladder
    .map((l) => `c${l.concurrency}=${l.maxLoad1 ?? "n/a"}`)
    .join(" ")} (in-window limit ${LOADAVG_HARD_LIMIT})`;
  const ok =
    preflight.ok &&
    gate.ok &&
    ladder.length === PILOT_GEARS.length &&
    judgment !== null &&
    judgment.structuralStop === null &&
    judgment.cpuSamplesValid;
  const violations = [
    ...preflight.problems,
    ...(gate.ok
      ? []
      : gate.checks.filter((c) => !c.ok).map((c) => `${c.item}: ${c.detail}`)),
    ...(judgment?.structuralStop ? judgment.structuralStop.reasons : []),
  ];
  try {
    writeFileSync(
      join(OUT_ROOT, "pilot.json"),
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          config: configName,
          ok,
          preflight,
          ladder,
          kPilot,
          throughput,
          recommended,
          cpuSamplesValid: judgment?.cpuSamplesValid ?? false,
          loadStats,
          violations,
          notes,
        },
        null,
        2,
      ),
    );
  } catch {
    /* marker JSON is the machine contract */
  }
  return {
    ok,
    preflight,
    gate,
    config: configName,
    ladder,
    kPilot,
    throughput,
    recommended,
    cpuSamplesValid: judgment?.cpuSamplesValid ?? false,
    loadStats,
    violations,
    notes,
  };
}

/**
 * Campaign skeleton: config interleaving in rotating sweeps, the 7-item gate
 * at entry plus a per-segment interference recheck, per-unit valid counting
 * with the 6-valid/8-attempt stop rule, and a ###CAMPAIGN### summary.
 * Units: config (mixed/knee) or config×isolated-class. Segments land under
 * campaign-<suite>/ with an incremental campaign.json progress record.
 */
async function cmdCampaign({ suite, concurrency, target }) {
  const def = SUITES[suite];
  if (!def) {
    throw new Error(`unknown suite "${suite}" (mixed|isolated|knee)`);
  }
  const notes = [];
  let gearConcurrency = concurrency;
  if (suite === "knee" && !gearConcurrency) {
    let kPilot = null;
    try {
      const reg = JSON.parse(
        readFileSync(join(OUT_ROOT, "pilot.json"), "utf8"),
      );
      kPilot = reg.kPilot ?? null;
    } catch {
      /* register absent */
    }
    if (!kPilot) {
      return {
        ok: false,
        suite,
        workflow: def.workflow,
        units: {},
        rounds: [],
        gate: {
          ok: false,
          checks: [
            {
              item: "knee-gear",
              ok: false,
              detail:
                "K_pilot not established — run `pilot --config H1` first or pass --concurrency (PROTOCOL-v2 §3.4: knee gear runs at C=K_pilot)",
            },
          ],
        },
        notes: ["campaign not started"],
      };
    }
    gearConcurrency = kPilot;
  }

  // Units and their segment plans. knee (gradient) fans out to config×gear —
  // PROTOCOL-v3 draft: capacity-knee evidence needs the bracket around
  // K_pilot, not one gear; --concurrency pins a single gear instead.
  const userPinned = concurrency != null;
  let gears = null;
  if (def.gradient) {
    gears = userPinned ? [gearConcurrency] : kneeGradientGears(gearConcurrency);
    notes.push(
      `knee gradient gears: ${gears.join(", ")} (bracket [⌊K/2⌋, K, min(2K,200)] around K_pilot; ${userPinned ? "--concurrency pinned a single gear" : "derived from the pilot register"})`,
    );
  }
  const unitsToRun = [];
  if (def.classes) {
    for (const cls of def.classes) {
      for (const c of def.configs) {
        unitsToRun.push({
          config: c,
          wfLabel: cls.workflow,
          quotaKeys: cls.quotaKeys,
          gear: null,
        });
      }
    }
  } else if (def.gradient) {
    for (const c of def.configs) {
      for (const g of gears) {
        unitsToRun.push({ config: c, wfLabel: null, quotaKeys: null, gear: g });
      }
    }
  } else {
    for (const c of def.configs) {
      unitsToRun.push({
        config: c,
        wfLabel: null,
        quotaKeys: null,
        gear: null,
      });
    }
  }
  const keyOf = (config, wfLabel, gear) =>
    wfLabel ? `${config}:${wfLabel}` : gear ? `${config}@c${gear}` : config;
  // Append-replicate session (v2 §6.4 追加 replicate channel): --target N
  // with N in (6, 12] resumes a completed campaign to tighten CIs — the
  // direction is tightening only, prior sweeps/notes are preserved and the
  // sweep counter continues after the last on-disk sweep (existing sweep
  // dirs are never rewritten). The 12-attempt ceiling is the v2 §6.4
  // sampling budget; the decision + reason go into the notes run record.
  const validTarget =
    Number.isInteger(target) && target > CAMPAIGN_VALID_TARGET && target <= 12
      ? target
      : CAMPAIGN_VALID_TARGET;
  const attemptCap =
    validTarget > CAMPAIGN_VALID_TARGET ? 12 : CAMPAIGN_ATTEMPT_CAP;
  const units = new Map();
  for (const u of unitsToRun) {
    units.set(keyOf(u.config, u.wfLabel, u.gear), {
      config: u.config,
      workflow: u.wfLabel ?? def.workflow,
      gear: u.gear,
      valid: 0,
      attempts: 0,
      deferrals: 0,
      reasons: [],
    });
  }

  // Single-instance preflight (fail-closed, operational abort — not a gate
  // judgment): every API port any unit of this suite binds, plus the sink
  // port when an OTLP config participates, must be free BEFORE the gate.
  const campaignPreflight = await preflightPortsProblems({
    ports: [
      ...def.configs.map((c) => MANIFEST.configs[c].port),
      ...(def.configs.some(
        (c) => MANIFEST.configs[c].env.TELEMETRY_OTLP_ENDPOINT,
      )
        ? [MANIFEST.sink.port]
        : []),
    ],
  });
  if (campaignPreflight.length > 0) {
    throw new Error(
      `port preflight rejected — campaign not started: ${campaignPreflight.join("; ")}`,
    );
  }

  const gate = await precheckGate({
    configs: def.configs,
    suite,
    workflow: def.workflow,
    concurrency: gearConcurrency ?? MANIFEST.workload.concurrency,
  });
  let rounds = [];
  if (!gate.ok) {
    notes.push("precheck gate rejected — campaign not started");
    return {
      ok: false,
      suite,
      workflow: def.workflow,
      units: Object.fromEntries(units),
      rounds,
      gate,
      notes,
    };
  }

  const suiteDir = join(OUT_ROOT, `campaign-${suite}`);
  mkdirSync(suiteDir, { recursive: true });
  // Resume (append-replicate session only): restore unit counters, prior
  // rounds and notes from the on-disk campaign.json so the append builds
  // on the recorded state instead of restarting at zero.
  let startSweep = 1;
  const priorMarkerPath = join(suiteDir, "campaign.json");
  if (validTarget === CAMPAIGN_VALID_TARGET && existsSync(priorMarkerPath)) {
    // Fresh runs must never overwrite recorded campaign state — archive the
    // directory first (superseded-runN) or resume via --target.
    return {
      ok: false,
      suite,
      workflow: def.workflow,
      units: Object.fromEntries(units),
      rounds: [],
      gate: {
        ok: false,
        checks: [
          {
            item: "fresh-run-guard",
            ok: false,
            detail: `${priorMarkerPath} already records a campaign — archive it (e.g. campaign-${suite}-superseded-runN) or append replicates with --target 7..12`,
          },
        ],
      },
      notes: ["fresh run refused — prior campaign state present"],
    };
  }
  if (validTarget > CAMPAIGN_VALID_TARGET) {
    const priorPath = join(suiteDir, "campaign.json");
    let prior = null;
    try {
      prior = JSON.parse(readFileSync(priorPath, "utf8"));
    } catch {
      /* no prior state — append without a base is refused below */
    }
    if (!prior || prior.suite !== suite || !prior.units) {
      return {
        ok: false,
        suite,
        workflow: def.workflow,
        units: Object.fromEntries(units),
        rounds: [],
        gate: {
          ok: false,
          checks: [
            {
              item: "append-base",
              ok: false,
              detail: `--target ${validTarget} requires an existing completed campaign.json for suite "${suite}" (v2 §6.4 append channel)`,
            },
          ],
        },
        notes: ["append refused — no prior campaign state"],
      };
    }
    for (const [k, st] of Object.entries(prior.units)) {
      if (units.has(k)) units.set(k, st);
    }
    rounds = Array.isArray(prior.rounds) ? prior.rounds : [];
    notes.push(
      ...prior.notes,
      `append-replicate session: target ${validTarget} valid per unit (v2 §6.4 追加 replicate, CI-tightening only); prior state resumed (units/rounds/notes preserved); attempt ceiling 12 per the v2 §6.4 sampling budget`,
    );
    startSweep = rounds.reduce((m, r) => Math.max(m, r.sweep ?? 0), 0) + 1;
  }
  const needsSink = (list) =>
    list.some((u) => MANIFEST.configs[u.config].env.TELEMETRY_OTLP_ENDPOINT);
  const MAX_SWEEPS = 24; // starvation guard: deferrals never consume attempts
  let sweep = startSweep - 1;
  while (true) {
    const pending = unitsToRun.filter((u) => {
      const st = units.get(keyOf(u.config, u.wfLabel, u.gear));
      return st.valid < validTarget && st.attempts < attemptCap;
    });
    if (pending.length === 0) break;
    if (sweep >= MAX_SWEEPS) {
      notes.push(
        `sweep cap ${MAX_SWEEPS} reached with units still pending — stopping (starvation guard)`,
      );
      break;
    }
    sweep += 1;
    // §6.1 interleave: rotate the pending order every sweep.
    const shift =
      (((sweep - 1) % pending.length) + pending.length) % pending.length;
    const ordered = [...pending.slice(shift), ...pending.slice(0, shift)];
    const sweepSegments = [];
    let sink = null;
    if (needsSink(ordered)) {
      sink = await startSink(MANIFEST.sink.port, MANIFEST.sink.mode);
    }
    try {
      for (const u of ordered) {
        const unitKey = keyOf(u.config, u.wfLabel, u.gear);
        const st = units.get(unitKey);
        // Per-segment precheck: interference recheck before spawning; a
        // deferral does NOT burn an attempt, three consecutive deferrals
        // starve the unit out. waitForQuietLoad1 first rides out the
        // previous segment's residual load within its budget.
        const load1 = await waitForQuietLoad1();
        const interference = interferenceProblems({ load1 });
        if (interference.length > 0) {
          st.deferrals += 1;
          notes.push(
            `[${unitKey}] sweep ${sweep} deferred: ${interference.join("; ")}`,
          );
          if (st.deferrals >= 3) {
            st.attempts = CAMPAIGN_ATTEMPT_CAP;
            st.reasons.push(
              "starved by repeated interference recheck failures",
            );
          }
          continue;
        }
        st.attempts += 1;
        const seg = await runSegment({
          configName: u.config,
          round: sweep,
          segmentDir: join(
            suiteDir,
            `sweep-${sweep}`,
            `${u.config}${u.wfLabel ? `-${u.wfLabel}` : ""}${u.gear ? `-c${u.gear}` : ""}`,
          ),
          sinkPort: sink?.port ?? null,
          concurrency:
            u.gear ?? gearConcurrency ?? MANIFEST.workload.concurrency,
          workflow: u.wfLabel ?? def.workflow,
          opPlan: u.quotaKeys
            ? buildOpPlan(
                Object.fromEntries(
                  u.quotaKeys.map((k) => [k, MANIFEST.workload.quotas[k]]),
                ),
              )
            : undefined,
        });
        if (seg.valid) st.valid += 1;
        else {
          st.reasons.push(
            `sweep ${sweep}: ${(seg.invalidReasons ?? []).join("; ")}`,
          );
        }
        sweepSegments.push({
          unit: unitKey,
          config: u.config,
          workflow: seg.workflow,
          concurrency: seg.concurrency ?? u.gear ?? null,
          valid: seg.valid,
          ops: seg.ops ?? 0,
          cpuMsPerOp: seg.cpuMsPerOp ?? null,
          p99Ms: seg.p99Ms ?? null,
          invalidReasons: seg.invalidReasons ?? [],
        });
      }
    } finally {
      if (sink) await stopSink(sink);
    }
    rounds.push({ sweep, segments: sweepSegments });
    try {
      writeFileSync(
        join(suiteDir, "campaign.json"),
        JSON.stringify(
          {
            suite,
            generatedAt: new Date().toISOString(),
            units: Object.fromEntries(units),
            rounds,
            notes,
          },
          null,
          2,
        ),
      );
    } catch {
      /* marker JSON is the machine contract */
    }
  }

  const allValid = [...units.values()].every((s) => s.valid >= validTarget);
  const anyCapped = [...units.values()].some(
    (s) => s.valid < validTarget && s.attempts >= attemptCap,
  );
  const stoppedReason = allValid
    ? `all units reached ${validTarget} valid segments${validTarget > CAMPAIGN_VALID_TARGET ? " (append-replicate session)" : ""}`
    : anyCapped
      ? `attempt cap ${attemptCap} reached for some unit(s) before ${validTarget} valid — those units stay UNKNOWN per PROTOCOL-v2 §6.4`
      : "sweep cap reached (starvation guard)";
  return {
    ok: allValid,
    suite,
    workflow: def.workflow,
    gears: gears ?? null,
    gearConcurrency: gearConcurrency ?? MANIFEST.workload.concurrency,
    throughputSemantics: CLOSED_LOOP_SEMANTICS,
    units: Object.fromEntries(units),
    rounds,
    gate,
    stoppedReason,
    notes,
  };
}

/**
 * W09 dedicated scenario (B4 background-interference isolation): the REAL
 * deadline-scanner auto-submit path, exercised in its OWN segment on its OWN
 * pool with a controlled deadline — never inside a measured gear. Lifecycle:
 * converge+extend → boot → standard prep (sentinel pools stay future-deadline;
 * the isolation guard proves nothing sits expired at entry) → the dedicated
 * W09 pool gets deadline = now()+delay, i.e. it crosses expiry INSIDE the
 * observation window → wait scan ticks → DB assertions: every pool attempt
 * terminal with submission_reason='deadline', every newly-terminal attempt
 * OUTSIDE the pool counted as scanner leakage, metering sentinels untouched.
 * Output: ###W09### marker + OUT_ROOT/w09/w09-<config>.json + run-meta.
 */
async function cmdW09({
  configName,
  pool = 20,
  delaySeconds = 3,
  waitSeconds,
}) {
  if (!MANIFEST.configs[configName]) {
    throw new Error(`unknown config "${configName}"`);
  }
  const violations = [];
  const files = [];
  const meta = writeRunMeta("w09", { config: configName, pool, delaySeconds });
  if (meta?.file) files.push(meta.file);
  const gate = await precheckGate({
    configs: [configName],
    suite: "w09",
    workflow: "w09-autosubmit",
    concurrency: MANIFEST.workload.concurrency,
  });
  const scanIntervalMs = Number(
    MANIFEST.sharedEnv.DEADLINE_SCAN_INTERVAL_MS ?? 5000,
  );
  const wait =
    waitSeconds ?? Math.ceil(delaySeconds + (3 * scanIntervalMs) / 1000 + 2);
  const result = {
    ok: false,
    suite: "w09",
    config: configName,
    pool,
    delaySeconds,
    waitSeconds: wait,
    gate,
    poolAttempts: null,
    sentinels: null,
    untouchedOk: null,
    violations,
    files,
    startedAt: new Date().toISOString(),
  };
  if (!gate.ok) {
    violations.push("precheck gate rejected — w09 scenario not started");
    return result;
  }
  const config = MANIFEST.configs[configName];
  const dbUrl = dbUrlFor(configName);
  const dbName = configDbName(configName);
  const dir = join(OUT_ROOT, "w09");
  mkdirSync(dir, { recursive: true });
  const bootDir = join(dir, `boot-${configName}-${Date.now()}`);
  mkdirSync(bootDir, { recursive: true });
  let sql = null;
  let server = null;
  try {
    await ensureBenchDatabase(() => {}, configName);
    await convergeSeed(dbUrl, join(bootDir, "seed-converge.log"), configName);
    sql = await openVerified(dbUrl, dbName);
    await extendSeed(sql, () => {}, configName);
    const env = buildLaunchEnv(config, {
      segmentDir: bootDir,
      sinkPort: MANIFEST.sink.port,
      dbUrl,
    });
    server = spawnServer(
      config,
      env,
      join(bootDir, "server-out.log"),
      join(bootDir, "server-err.log"),
    );
    const http = new Http(`http://127.0.0.1:${config.port}`);
    await waitHttp(`http://127.0.0.1:${config.port}/api/health`, {
      timeoutMs: BOOT_WAIT_MS,
    });
    await waitHttp(`http://127.0.0.1:${config.port}/api/ready`, {
      timeoutMs: READY_WAIT_MS,
    });
    const examId = await getBenchExamId(sql);
    if (!examId) throw new Error("bench exam missing after converge+extend");
    // metering sentinels (hot/unchanged) model the pools a measured gear
    // would own; the W09 pool is the dedicated scenario's own attempts
    const prepPool = {
      hotAttemptsC3: 2,
      unchangedAttemptsW08: 2,
      submitAttemptsC5: 1,
      frozenAttemptsW08: 1,
      disruptedAttemptsW06: 1,
      staleAttemptsW09: pool,
      closedAttemptsC4: 1,
    };
    const prep = await runPrep({
      http,
      sql,
      plan: buildAttemptPlan(prepPool),
      examId,
    });
    // isolation checkpoint: standard prep must leave NOTHING expired
    const expiredAtEntry = (
      await sql`SELECT count(*)::int AS n FROM exam_attempts
               WHERE organization_id = ${prep.orgId}
                 AND status = 'in_progress' AND deadline_at < now()`
    )[0].n;
    if (expiredAtEntry > 0) {
      violations.push(
        `isolation: ${expiredAtEntry} in_progress attempt(s) expired BEFORE the scenario armed — prep data would leak to the scanner`,
      );
    }
    // everything in_progress at expiry time; anything that turns terminal
    // after this point must belong to the dedicated pool
    const preExpiryInProgress = (
      await sql`SELECT id FROM exam_attempts
                WHERE organization_id = ${prep.orgId} AND status = 'in_progress'`
    ).map((r) => r.id);
    const poolSet = new Set(prep.staleAttemptIds);
    // arm: controlled FUTURE deadline — the pool crosses expiry together,
    // inside the observation window (a past deadline would burn part of the
    // pool before the first tick and make the per-attempt evidence ragged)
    for (const attemptId of prep.staleAttemptIds) {
      await sql`
        UPDATE exam_attempts
        SET deadline_at = now() + (${delaySeconds} || ' seconds')::interval,
            updated_at = now()
        WHERE id = ${attemptId} AND organization_id = ${prep.orgId}`;
    }
    const waitUntil = Date.now() + wait * 1000;
    while (Date.now() < waitUntil) await sleep(500);

    const poolRows = await sql`
      SELECT id, status, submission_reason, submitted_at
      FROM exam_attempts WHERE id = ANY(${prep.staleAttemptIds})`;
    const poolBad = poolRows.filter(
      (r) =>
        !["submitted", "graded"].includes(r.status) ||
        r.submission_reason !== "deadline" ||
        r.submitted_at == null,
    );
    if (poolBad.length > 0) {
      violations.push(
        `pool not fully deadline-terminal: ${JSON.stringify(poolBad).slice(0, 300)}`,
      );
    }
    const nowTerminal = new Set(
      (
        await sql`SELECT id FROM exam_attempts
                  WHERE organization_id = ${prep.orgId} AND status <> 'in_progress'`
      ).map((r) => r.id),
    );
    const outside = [...nowTerminal].filter(
      (id) => preExpiryInProgress.includes(id) && !poolSet.has(id),
    );
    if (outside.length > 0) {
      violations.push(
        `scanner terminalized ${outside.length} attempt(s) OUTSIDE the dedicated W09 pool (metering-pool leakage)`,
      );
    }
    const sentinelIds = [...prep.hotAttemptIds, ...prep.unchangedAttemptIds];
    const sentinelRows = await sql`
      SELECT id, status, submitted_at, deadline_at
      FROM exam_attempts WHERE id = ANY(${sentinelIds})`;
    const sentinelBad = sentinelRows.filter(
      (r) =>
        r.status !== "in_progress" ||
        r.submitted_at != null ||
        new Date(r.deadline_at) <= new Date(),
    );
    if (sentinelBad.length > 0) {
      violations.push(
        `metering sentinels touched: ${JSON.stringify(sentinelBad.map((r) => r.id)).slice(0, 200)}`,
      );
    }
    result.poolAttempts = {
      total: prep.staleAttemptIds.length,
      deadlineTerminal: poolRows.length - poolBad.length,
      deadlineReasonCount: poolRows.filter(
        (r) => r.submission_reason === "deadline",
      ).length,
    };
    result.sentinels = {
      total: sentinelIds.length,
      untouched: sentinelRows.length - sentinelBad.length,
    };
    result.untouchedOk = outside.length === 0;
    result.ok = violations.length === 0;
  } catch (err) {
    violations.push(`w09 failure: ${String(err?.stack ?? err).slice(0, 400)}`);
  } finally {
    if (server) {
      await stopServerGracefully(server.child).catch(() => {});
      server.out.end();
      server.err.end();
    }
    if (sql) await sql.end({ timeout: 3 }).catch(() => {});
  }
  try {
    const outFile = join(OUT_ROOT, "w09", `w09-${configName}.json`);
    writeFileSync(outFile, JSON.stringify(result, null, 2));
    files.push(outFile);
  } catch {
    /* marker JSON is the machine contract */
  }
  result.files = files;
  return result;
}

// ── 8b. §6.6-3 oracle-equivalence register producer ─────────────────────

// Register workloads and their op-kind bindings (PROTOCOL-v2 §6.6-3 gate
// list; WORKFLOW-INVENTORY §1 rows: W01 auth/exam-list, W03 save-accepted,
// W05 submit+grade, W08 take deadline reconcile). Terminal checks reuse the
// validate-command expectations, evaluated against the SAME frozen quotas on
// BOTH lineages — that equality of the §4.2 oracle face across the two SHAs
// is exactly the §6.6-3 semantic-equivalence question.
const EQUIVALENCE_WORKLOADS = [
  { id: "W01", opKinds: ["login", "examList"], terminal: [] },
  {
    id: "W03",
    opKinds: ["saveAccepted", "saveReplay"],
    terminal: ["c3-receipts"],
  },
  {
    id: "W05",
    opKinds: ["submitFresh", "submitDuplicate"],
    terminal: ["w05-submit-audit"],
  },
  {
    id: "W08",
    opKinds: ["takeFrozen", "takeUnchanged"],
    terminal: ["w08-deadline-submitted"],
  },
];

/** Load a segment's ops.jsonl and reduce it to per-register-workload oracle
 * verdicts: per kind {total, violating, samples}. Violations carry the
 * differing oracle fields a §6.6-3 divergence record needs. */
function equivalenceOracleReport(segmentDir) {
  const report = {};
  for (const w of EQUIVALENCE_WORKLOADS) {
    report[w.id] = { opKinds: w.opKinds, total: 0, violating: 0, samples: [] };
  }
  const byKind = new Map(
    EQUIVALENCE_WORKLOADS.flatMap((w) => w.opKinds.map((k) => [k, w.id])),
  );
  const lines = readFileSync(join(segmentDir, "ops.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean);
  for (const line of lines) {
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    const wid = byKind.get(rec.op);
    if (!wid) continue;
    const entry = report[wid];
    entry.total += 1;
    const v = rec.violations ?? [];
    if (v.length > 0) {
      entry.violating += 1;
      if (entry.samples.length < 5) entry.samples.push(`${rec.op}: ${v[0]}`);
    }
  }
  return report;
}

/** §6.6-3 terminal face: schedule-INVARIANT terminal-state fields per register
 * workload. The §6.6-3 comparison is cross-SHA field agreement under the
 * identical frozen quotas — NOT the validate command's absolute expectations:
 * as-built, deadline auto-submit is audit-free (W08 row), the W09 pool stays
 * future-deadline inert in standard prep (B4 isolation, runPrep), and
 * per-attempt receipt distribution varies with the per-config seeded shuffle
 * (only the schedule-invariant total is comparable). Stale absolute checks
 * belong to validate's own follow-up, not to this register. */
function equivalenceTerminalFields(seg) {
  if (!seg.terminalState) return null;
  const c = seg.terminalState.counts ?? {};
  const hotReceiptsTotal = Object.values(
    seg.terminalState.hotReceipts ?? {},
  ).reduce((a, r) => a + (r.receipts ?? 0), 0);
  return {
    W03: { hotReceiptsTotal },
    W05: {
      submitAuditDelta:
        (c.submitAuditTotal ?? 0) - (seg.seedCounts?.submitAudit ?? 0),
    },
    W08: { deadlineSubmitted: c.deadlineSubmitted ?? 0 },
  };
}

/**
 * §6.6-3 equivalence register producer (PROTOCOL-v2 §6.6-3; v3 §8.2-3;
 * inherited by v4 §4). Runs paired H0/H1 segments over distinct rounds,
 * measures BOTH lineages against the identical §4.2 oracle face (per-op
 * oracle + terminal-state expectations), and writes
 * out/otel-w964/workflow-audit-v3/h0-equivalence.json — the register gate
 * item 7 consumes before any H0 measurement row is accepted.
 *
 * Fail-closed: infra-invalid segments are voided and re-run (§6.4 补跑, sweep
 * cap); ANY oracle divergence on a valid pair marks that workload
 * NON_COMPARABLE, records the differing fields, and the register stays
 * verified:false — the honest exit, never unlabeled numbers.
 */
async function cmdEquivalence({
  rounds = 3,
  concurrency,
  maxSweeps = 24,
} = {}) {
  const configs = ["H0", "H1"];
  const gear = concurrency ?? MANIFEST.workload.concurrency;
  const notes = [];
  const suiteDir = join(OUT_ROOT, "equivalence");
  const registerPath = join(OUT_ROOT, "h0-equivalence.json");
  const status = Object.fromEntries(
    EQUIVALENCE_WORKLOADS.map((w) => [
      w.id,
      { verifiedPairs: 0, rounds: [], divergences: [], nonComparable: false },
    ]),
  );
  const roundRecords = [];
  const lineages = Object.fromEntries(
    configs.map((c) => [
      c,
      {
        sourceDir: configSourceDir(c),
        commitSha: MANIFEST.configs[c].commitSha ?? MANIFEST.commitSha,
        db: configDbName(c),
        port: MANIFEST.configs[c].port,
      },
    ]),
  );
  let diverged = false;
  let verified = false;

  const buildRegister = () => ({
    protocol:
      "PROTOCOL-v2 §6.6-3 (v3 §8.2-3, inherited verbatim by v4 §4): ≥3 verified oracle segments per workload per SHA, cross-round; any field mismatch → NON_COMPARABLE",
    generatedAt: new Date().toISOString(),
    gear: {
      concurrency: gear,
      frozenPConc: MANIFEST.workload.concurrency,
      quotaOps: expectedWorkload(MANIFEST.workload.quotas).totalOps,
      steadyMaxSeconds: MANIFEST.workload.steadyMaxSeconds,
    },
    lineages,
    targetRoundsPerWorkload: rounds,
    workloads: Object.fromEntries(
      EQUIVALENCE_WORKLOADS.map((w) => [w.id, status[w.id].verifiedPairs]),
    ),
    verified,
    workloadStatus: status,
    rounds: roundRecords,
    notes,
  });
  const writeRegister = () => {
    mkdirSync(OUT_ROOT, { recursive: true });
    writeFileSync(registerPath, JSON.stringify(buildRegister(), null, 2));
  };

  // Single-instance preflight + the full gate. Producer mode: item 7
  // enforces mode membership + gear discipline but cannot demand the
  // register its own segments produce (see h0ComparabilityProblems).
  const preflightProblems = await preflightPortsProblems({
    ports: [
      ...configs.map((c) => MANIFEST.configs[c].port),
      ...(configs.some((c) => MANIFEST.configs[c].env.TELEMETRY_OTLP_ENDPOINT)
        ? [MANIFEST.sink.port]
        : []),
    ],
  });
  if (preflightProblems.length > 0) {
    throw new Error(
      `port preflight rejected — equivalence not started: ${preflightProblems.join("; ")}`,
    );
  }
  const gate = await precheckGate({
    configs,
    suite: "equivalence",
    workflow: "mixed",
    concurrency: gear,
  });
  if (!gate.ok) {
    return {
      ok: false,
      registerPath,
      register: null,
      gate,
      rounds: [],
      notes: ["precheck gate rejected — equivalence not started"],
    };
  }
  mkdirSync(suiteDir, { recursive: true });
  for (const c of configs) await ensureBenchDatabase(() => {}, c);

  for (let sweep = 1; sweep <= maxSweeps; sweep++) {
    const pending = EQUIVALENCE_WORKLOADS.filter(
      (w) => !status[w.id].nonComparable && status[w.id].verifiedPairs < rounds,
    );
    if (pending.length === 0) {
      verified = true;
      break;
    }
    // §6.1 interleave: rotate the config order every sweep.
    const shift =
      (((sweep - 1) % configs.length) + configs.length) % configs.length;
    const ordered = [...configs.slice(shift), ...configs.slice(0, shift)];
    const roundDir = join(suiteDir, `round-${sweep}`);
    const segs = {};
    for (const configName of ordered) {
      segs[configName] = await runSegment({
        configName,
        round: sweep,
        segmentDir: join(roundDir, configName),
        sinkPort: null,
        concurrency: gear,
      });
    }
    const record = { sweep, order: ordered, segments: {}, verdicts: {} };
    for (const c of configs) {
      const seg = segs[c];
      record.segments[c] = {
        dir: join(roundDir, c),
        valid: seg.valid === true,
        invalidReasons: seg.invalidReasons ?? [],
        ops: seg.ops ?? 0,
        errors: seg.errors ?? 0,
        p99Ms: seg.p99Ms ?? null,
        maxLoad1: seg.maxLoad1 ?? null,
        externalLoadIncrement: seg.externalLoadIncrement ?? null,
      };
    }
    if (!diverged) {
      const reports = Object.fromEntries(
        configs.map((c) => [c, equivalenceOracleReport(join(roundDir, c))]),
      );
      record.oracle = reports;
      // §4.2: an INVALID segment is voided wholesale — its partial data (a
      // window-exceeded stream cut mid-plan, an aborted capture) enters NO
      // judgment, least of all a cross-SHA comparison where both sides must
      // reflect the same complete quota. Divergence verdicts are computed on
      // verified pairs only; voided pairs re-run (§6.4 补跑) with their void
      // reasons and any violation samples preserved in the round record.
      const bothValid = configs.every((c) => segs[c].valid === true);
      if (!bothValid) {
        const voided = configs
          .filter((c) => !segs[c].valid)
          .map(
            (c) =>
              `${c} voided: ${(segs[c].invalidReasons ?? []).join("; ")}` +
              (configs.some(
                (d) =>
                  reports[d] &&
                  EQUIVALENCE_WORKLOADS.some(
                    (w) => reports[d][w.id].violating > 0,
                  ),
              )
                ? " (register-workload op violations present in voided data — see record.oracle; rerun governs per §6.4)"
                : ""),
          );
        record.verdicts.retriable = voided;
        notes.push(`sweep ${sweep} voided (§6.4 补跑): ${voided.join(" | ")}`);
      } else {
        const fields = Object.fromEntries(
          configs.map((c) => [c, equivalenceTerminalFields(segs[c])]),
        );
        record.terminalFields = fields;
        // A register-workload oracle violation or a cross-SHA terminal-field
        // mismatch on a VERIFIED pair is a §6.6-3 divergence: fail that
        // workload, record the differing fields (非确定性/偶发分歧按 fail).
        const divergenceProblems = [];
        for (const c of configs) {
          for (const w of EQUIVALENCE_WORKLOADS) {
            const rep = reports[c][w.id];
            if (rep.violating > 0) {
              divergenceProblems.push({
                workload: w.id,
                config: c,
                detail: `${w.id} oracle violations on ${c}: ${rep.samples.join(" | ")}`,
              });
            }
          }
        }
        const captureMissing = fields.H0 === null || fields.H1 === null;
        if (captureMissing) {
          // Evidence channel lost on an otherwise-valid pair — §6.4 补跑.
          record.verdicts.retriable = ["terminal-state capture missing"];
          notes.push(
            `sweep ${sweep} voided (§6.4 补跑): terminal-state capture missing on at least one lineage`,
          );
        } else {
          for (const w of EQUIVALENCE_WORKLOADS) {
            for (const k of Object.keys(fields.H0[w.id] ?? {})) {
              const a = fields.H0[w.id][k];
              const b = fields.H1[w.id][k];
              if (a !== b) {
                divergenceProblems.push({
                  workload: w.id,
                  config: "H0≠H1",
                  detail: `${w.id} terminal field ${k} mismatch: H0=${a}, H1=${b}`,
                });
              }
            }
          }
          if (divergenceProblems.length > 0) {
            diverged = true;
            verified = false;
            for (const { workload, config, detail } of divergenceProblems) {
              status[workload].nonComparable = true;
              status[workload].divergences.push({ sweep, config, detail });
            }
            record.verdicts.stop =
              "oracle divergence — register unverified (§6.6-3 fail rule)";
            notes.push(
              `sweep ${sweep}: ${divergenceProblems.length} oracle divergence(s) — workload(s) marked NON_COMPARABLE (§6.6-3)`,
            );
          } else {
            for (const w of EQUIVALENCE_WORKLOADS) {
              if (status[w.id].nonComparable) continue;
              status[w.id].verifiedPairs += 1;
              status[w.id].rounds.push(sweep);
              record.verdicts[w.id] = `verified pair (sweep ${sweep})`;
            }
          }
        }
      }
    }
    roundRecords.push(record);
    writeRegister();
    if (diverged) break;
  }
  if (!diverged) {
    verified = EQUIVALENCE_WORKLOADS.every(
      (w) => status[w.id].verifiedPairs >= rounds,
    );
    if (!verified) {
      notes.push(
        `sweep cap ${maxSweeps} reached before ${rounds} verified pair(s) per workload — register stays unverified (fail-closed)`,
      );
    }
  }
  writeRegister();
  return {
    ok: verified === true,
    registerPath,
    register: buildRegister(),
    gate,
    rounds: roundRecords,
    notes,
  };
}

// ── 9. CLI dispatch ──────────────────────────────────────────────────────

function parseCli(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else {
        out[key] = true;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

const USAGE = `usage:
  runner.js selftest
  runner.js round    --manifest <p> --round N --configs A,B[,...] [--concurrency N]
  runner.js validate --round N
  runner.js aggregate
  runner.js pilot    --config X [--attempt N]
  runner.js campaign --suite mixed|isolated|knee [--concurrency N] [--target N]
  runner.js equivalence [--rounds N] [--concurrency N]
  runner.js w09      --config X [--pool N] [--delay-seconds S] [--wait-seconds S]
  runner.js profile  --config X --out <dir>
  (--target N ∈ (6,12] resumes a recorded campaign as a v2 §6.4
   append-replicate session; a fresh run is refused while campaign.json exists)
  (--attempt N / --retry N are accepted and ignored on all commands: the caller's retry marker)`;

async function main() {
  const cli = parseCli(process.argv.slice(2));
  const cmd = cli._[0];
  let exitCode = 0;
  let lastLine = "";

  try {
    MANIFEST = loadManifest(cli.manifest ?? join(HERE, "configs.json"));
    // R2-06: resolved paths/SHAs/host facts are run metadata (gitignored
    // out/run-meta/) — one record per invocation, never stored in-repo
    writeRunMeta(cmd ?? "unknown", { argv: process.argv.slice(2) });

    // Orphan defense: long-lived children (API server, sink) are tracked and
    // killed from exit/signal paths; the detached reaper covers the
    // SIGKILLed-runner case (workflow abort) that in-process handlers cannot.
    installOrphanDefense();
    if (
      [
        "pilot",
        "round",
        "campaign",
        "selftest",
        "w09",
        "profile",
        "equivalence",
      ].includes(cmd)
    ) {
      spawnParentDeathReaper();
    }

    if (cmd === "selftest") {
      const { ok, checks } = await cmdSelftest();
      lastLine = `###SELFTEST###${JSON.stringify({ ok, checks })}`;
      exitCode = ok ? 0 : 1;
    } else if (cmd === "round") {
      const round = Number(cli.round);
      if (!Number.isInteger(round) || round < 0)
        throw new Error("--round N (>=0) required — 0 is the pilot round");
      const configs = String(cli.configs ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const concurrencyNum = Number(cli.concurrency);
      const {
        results,
        driftNotes,
        round: r,
        gate,
      } = await cmdRound({
        round,
        configs,
        concurrency:
          Number.isInteger(concurrencyNum) && concurrencyNum > 0
            ? concurrencyNum
            : undefined,
        gcObserve: cli["gc-observe"] === true,
      });
      lastLine = `###SUMMARY###${JSON.stringify({ round: r, results, driftNotes, gate })}`;
      exitCode = results.length === 0 && gate?.ok === false ? 1 : 0;
    } else if (cmd === "validate") {
      const round = Number(cli.round);
      if (!Number.isInteger(round) || round < 0)
        throw new Error("--round N (>=0) required — 0 is the pilot round");
      const { valid, violations, warnings } = await cmdValidate({ round });
      for (const w of warnings) process.stdout.write(`[warn] ${w}\n`);
      lastLine = `###VALIDATE###${JSON.stringify({ valid, violations })}`;
      exitCode = valid ? 0 : 1;
    } else if (cmd === "aggregate") {
      mkdirSync(OUT_ROOT, { recursive: true });
      const agg = await cmdAggregate();
      writeFileSync(
        join(OUT_ROOT, "aggregate.json"),
        JSON.stringify(
          { generatedAt: new Date().toISOString(), ...agg },
          null,
          2,
        ),
      );
      const rows = agg.rows.map(({ cpuRangePct, ...r }) => r);
      const notes = [
        ...agg.notes,
        `throughput semantics: ${CLOSED_LOOP_SEMANTICS}`,
        ...agg.rows
          .filter((r) => r.cpuRangePct)
          .map(
            (r) =>
              `[${r.config}] paired CPU delta range (min–max): ${r.cpuRangePct[0]}% … ${r.cpuRangePct[1]}% (PROTOCOL §6.3 reporting)`,
          ),
      ];
      lastLine = `###AGG###${JSON.stringify({ rows, notes })}`;
      exitCode = 0;
    } else if (cmd === "pilot") {
      if (typeof cli.config !== "string")
        throw new Error("--config X required");
      mkdirSync(OUT_ROOT, { recursive: true });
      const result = await cmdPilot({ configName: cli.config });
      lastLine = `###PILOT###${JSON.stringify(result)}`;
      exitCode = result.ok ? 0 : 1;
    } else if (cmd === "campaign") {
      if (typeof cli.suite !== "string")
        throw new Error("--suite mixed|isolated|knee required");
      const campaignConc = Number(cli.concurrency);
      const campaignTarget = Number(cli.target);
      if (
        cli.target !== undefined &&
        !(
          Number.isInteger(campaignTarget) &&
          campaignTarget > 6 &&
          campaignTarget <= 12
        )
      )
        throw new Error(
          "--target N must be an integer in (6, 12] (v2 §6.4 append-replicate channel)",
        );
      const result = await cmdCampaign({
        suite: cli.suite,
        concurrency:
          Number.isInteger(campaignConc) && campaignConc > 0
            ? campaignConc
            : undefined,
        target:
          Number.isInteger(campaignTarget) && campaignTarget > 0
            ? campaignTarget
            : undefined,
      });
      lastLine = `###CAMPAIGN###${JSON.stringify(result)}`;
      exitCode = result.ok ? 0 : 1;
    } else if (cmd === "equivalence") {
      const eqRounds = Number(cli.rounds);
      const eqConc = Number(cli.concurrency);
      const eqSweeps = Number(cli["max-sweeps"]);
      const result = await cmdEquivalence({
        rounds: Number.isInteger(eqRounds) && eqRounds > 0 ? eqRounds : 3,
        concurrency:
          Number.isInteger(eqConc) && eqConc > 0 ? eqConc : undefined,
        maxSweeps: Number.isInteger(eqSweeps) && eqSweeps > 0 ? eqSweeps : 24,
      });
      lastLine = `###EQUIVALENCE###${JSON.stringify(result)}`;
      exitCode = result.ok ? 0 : 1;
    } else if (cmd === "w09") {
      if (typeof cli.config !== "string")
        throw new Error("--config X required");
      mkdirSync(OUT_ROOT, { recursive: true });
      const w09Pool = Number(cli.pool);
      const w09Delay = Number(cli["delay-seconds"]);
      const w09Wait = Number(cli["wait-seconds"]);
      const result = await cmdW09({
        configName: cli.config,
        pool: Number.isInteger(w09Pool) && w09Pool > 0 ? w09Pool : undefined,
        delaySeconds:
          Number.isFinite(w09Delay) && w09Delay >= 0 ? w09Delay : undefined,
        waitSeconds:
          Number.isInteger(w09Wait) && w09Wait > 0 ? w09Wait : undefined,
      });
      lastLine = `###W09###${JSON.stringify(result)}`;
      exitCode = result.ok ? 0 : 1;
    } else if (cmd === "profile") {
      if (typeof cli.config !== "string")
        throw new Error("--config X required");
      if (typeof cli.out !== "string") throw new Error("--out <dir> required");
      const result = await cmdProfile({
        configName: cli.config,
        outDir: pathResolve(cli.out),
      });
      process.stdout.write(
        JSON.stringify({ event: "profile.done", ...result }) + "\n",
      );
      exitCode = result.files.length > 0 ? 0 : 1;
      lastLine = JSON.stringify({
        event: "profile.done",
        config: result.config,
        files: result.files.length,
      });
    } else {
      process.stdout.write(USAGE + "\n");
      exitCode = 2;
      lastLine =
        "###RUNNER-ERROR###" +
        JSON.stringify({ error: `unknown command "${cmd ?? ""}"` });
    }
  } catch (err) {
    process.stderr.write(`runner: ${String(err?.stack ?? err)}\n`);
    exitCode = 1;
    lastLine = `###RUNNER-ERROR###${JSON.stringify({ error: String(err?.message ?? err).slice(0, 500) })}`;
  }

  process.stdout.write(lastLine + "\n");
  process.exit(exitCode);
}

// ── 10. exports (directed-test surface; the CLI contract is unchanged) ───

export {
  aggregateCore,
  // BENCH/Http/runPrep/execOp and the boot/db helpers below are the
  // directed-test surface: b4-race-test.mjs drives the REAL execOp/runOpStream
  // path so the race repro never re-implements the code under test.
  BENCH,
  bootstrapCi,
  buildAttemptPlan,
  buildLaunchEnv,
  checkOp,
  buildOpPlan,
  configDbName,
  convergeSeed,
  dbIsolationProblems,
  dbUrlFor,
  ensureBenchDatabase,
  execConcurrentSaveBatch,
  execOp,
  expectedWorkload,
  extendSeed,
  fixtureProblems,
  getBenchExamId,
  h0ComparabilityProblems,
  Http,
  interferenceProblems,
  ISO_CLASSES,
  classifyPilotGearReasons,
  judgePilotLadder,
  judgeSteadyWindow,
  PILOT_GEARS,
  preflightPortsProblems,
  probePortBindable,
  loadManifest,
  mulberry32,
  openVerified,
  oracleInjectionProblems,
  OUT_ROOT,
  precheckGate,
  procChannelProblems,
  runOpStream,
  runPrep,
  setActiveManifest,
  BOOTSTRAP_RESAMPLES,
  BOOTSTRAP_SEED,
  sourceShaProblems,
  spawnServer,
  startProcSampler,
  stopServerGracefully,
  SUITES,
  waitFirstProcSample,
  waitHttp,
  waitForQuietLoad1,
  withAttemptSaveLock,
  workloadPlanProblems,
  WORKFLOW_ORDER,
};

// Run only when executed directly. Importing this module (directed tests,
// offline tooling) must stay side-effect free.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
