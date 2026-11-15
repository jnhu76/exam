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
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  createWriteStream,
} from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { randomUUID, createHash } from "node:crypto";

// ── 0. constants ─────────────────────────────────────────────────────────

const HERE = pathResolve(dirname(new URL(import.meta.url).pathname));
const OUT_ROOT = pathResolve(HERE, "../../../out/otel-w964/workflow-audit");
const ROUNDS_DIR = join(OUT_ROOT, "rounds");
const BOOT_WAIT_MS = 60_000;
const READY_WAIT_MS = 30_000;
const STARTUP_LEGS_WAIT_MS = 30_000; // W11 retention startup-pass window
const SHUTDOWN_BUDGET_MS = 30_000; // PROTOCOL §7.3 T9 / ADR-028
const OP_TIMEOUT_MS = 30_000;
const PROC_SAMPLE_MS = 1_000;
const CLK_TCK = 100; // Linux USER_HZ (PROTOCOL §5 /proc channel)
const LOADAVG_HARD_LIMIT = 4.0; // PROTOCOL §6.5 hard exclusion
const CLOCK_JUMP_LIMIT_MS = 1_000; // PROTOCOL §6.5 hard exclusion
const BOOTSTRAP_RESAMPLES = 10_000; // PROTOCOL §6.3 (frozen)
const BOOTSTRAP_SEED = 20261115; // PROTOCOL §6.3 (frozen)
const BASELINE_CONFIG = "H1";
const CONFIG_ORDER = ["H1", "H2", "H3", "H4", "S0", "S1", "S2"];

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
 * rounds: [{round, segments: [{config, valid, summary}]}]
 */
function aggregateCore(rounds, { baseline = BASELINE_CONFIG } = {}) {
  const notes = [];
  const byRound = new Map();
  for (const r of rounds) {
    const valid = {};
    for (const seg of r.segments) {
      if (seg.valid && seg.summary) valid[seg.config] = seg.summary;
    }
    byRound.set(r.round, valid);
  }
  const present = new Set();
  for (const v of byRound.values())
    for (const c of Object.keys(v)) present.add(c);
  present.delete(baseline);

  const rows = [];
  for (const config of CONFIG_ORDER.filter((c) => present.has(c))) {
    const pairs = { cpu: [], p50: [], p95: [], p99: [], rss: [] };
    for (const [, valid] of byRound) {
      const base = valid[baseline];
      const cfg = valid[config];
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
      workflow: "mixed",
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

  notes.push(
    `baseline=${baseline}; every row is the paired relative delta vs the same-round ${baseline} segment (PROTOCOL §6.3/§7.1); the baseline itself is excluded from rows.`,
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
  return { rows, notes };
}

// ── 2. manifest ──────────────────────────────────────────────────────────

function loadManifest(manifestPath) {
  const raw = readFileSync(manifestPath, "utf8");
  const m = JSON.parse(raw);
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
  candidates: 1200,
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
  const out = createWriteStream(outPath, { flags: "a" });
  const err = createWriteStream(errPath, { flags: "a" });
  child.stdout.pipe(out);
  child.stderr.pipe(err);
  return { child, out, err };
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
  const timer = setInterval(() => {
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
        t: new Date().toISOString(),
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
  }, tickMs);
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
      if (!gateOk)
        add(
          `ready: expected 200 ready or 503 not_ready gate body, got ${code} ${JSON.stringify(b)?.slice(0, 120)}`,
        );
      else if (code !== 200)
        add(`ready: non-200 readiness during benchmark (gate=${code})`);
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
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
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
      signal: AbortSignal.timeout(OP_TIMEOUT_MS),
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
  return slots.map((s, i) => ({
    ...s,
    slotKey: `${s.kind}-${s.index}`,
    username: BENCH.candidateName((i % BENCH.candidates) + 1),
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
  await backdateDeadline(sql, orgId, staleAttemptIds, 30);
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
    `disrupted=${disruptedAttemptIds.length} staleW09=${staleAttemptIds.length} closed=${closedAttemptIds.length}`,
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
      const res = await http.request("GET", "/api/ready", { reqId });
      rec.statusCode = res.status;
      rec.body = await res.json().catch(() => null);
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
      const attemptId = hotIds[cursor("hot") % hotIds.length];
      const owner = prep.ownerOf[attemptId];
      const st = hotSaveState.get(attemptId) ?? {
        seq: 0,
        version: 0,
        lastAnswer: prep.answerOptionId,
      };
      let body;
      let expect = {};
      const clientSavedAt = new Date().toISOString();
      if (op.kind === "saveAccepted") {
        st.seq += 1;
        body = {
          attemptId,
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
            attemptId,
            questionId: prep.questionId,
            answer: prep.answerOptionId,
            clientSeq: st.seq,
            clientSavedAt,
            baseVersion: st.version,
          };
          expect.minServerVersion = st.version + 1;
        } else {
          body = {
            attemptId,
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
          attemptId,
          questionId: prep.questionId,
          answer: prep.altAnswerOptionId,
          clientSeq: st.seq + 1,
          clientSavedAt,
          baseVersion: Math.max(0, st.version - 1),
        };
        expect.reason = "STALE_VERSION";
      } else if (op.kind === "saveConflicting") {
        body = {
          attemptId,
          questionId: prep.questionId,
          answer: prep.altAnswerOptionId,
          clientSeq: st.seq,
          clientSavedAt,
          baseVersion: st.version,
        };
        expect.reason = "CONFLICTING_PAYLOAD";
      } else if (op.kind === "saveFuture") {
        // FUTURE_VERSION fires when baseVersion claims a version ahead of the
        // server (fresh clientSeq, future baseVersion)
        body = {
          attemptId,
          questionId: prep.questionId,
          answer: prep.answerOptionId,
          clientSeq: st.seq + 1,
          clientSavedAt,
          baseVersion: st.version + 999,
        };
        expect.reason = "FUTURE_VERSION";
      } else if (op.kind === "saveInvalid") {
        body = {
          attemptId,
          questionId: prep.questionId,
          answer: "NOT_AN_OPTION",
          clientSeq: st.seq,
          clientSavedAt,
          baseVersion: st.version,
        };
        expect.reason = "INVALID_ANSWER";
      } else if (op.kind === "saveClosed") {
        const closedId =
          prep.closedAttemptIds[
            cursor("closed") % prep.closedAttemptIds.length
          ];
        body = {
          attemptId: closedId,
          questionId: prep.questionId,
          answer: prep.answerOptionId,
          clientSeq: 1,
          clientSavedAt,
          baseVersion: 0,
        };
        expect.reason = "ATTEMPT_ALREADY_SUBMITTED";
      }
      rec.attemptId = body.attemptId;
      rec.clientSeq = body.clientSeq;
      const effectiveOwner =
        op.kind === "saveClosed" ? prep.closedOwnerOf[body.attemptId] : owner;
      const res = await http.request(
        "POST",
        `/api/attempts/${body.attemptId}/answers/${prep.questionId}`,
        { cookie: http.authed(effectiveOwner), body, reqId },
      );
      rec.statusCode = res.status;
      rec.body = await res.json().catch(() => null);
      rec.expect = expect;
      if (rec.body?.accepted === true) {
        st.version = rec.body.serverVersion;
        st.lastAnswer = body.answer;
      }
      hotSaveState.set(body.attemptId, st);
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
}) {
  const config = MANIFEST.configs[configName];
  const dbUrl = dbUrlFor(configName);
  const dbName = configDbName(configName);
  const notes = [];
  const seg = {
    round,
    config: configName,
    segmentDir,
    valid: false,
    invalidReasons: [],
    notes,
  };
  const baseUrl = `http://127.0.0.1:${config.port}`;
  const http = new Http(baseUrl);
  mkdirSync(segmentDir, { recursive: true });

  const finish = () => {
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

    const ctx = {
      http,
      sql,
      prep,
      t0: Date.now(),
      cursors: {},
      concurrency,
    };

    // ── 5. warmup: 500 ops or 60s, first to arrive (PROTOCOL §3.3) ──
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

    // ── 6. steady window: quota stream (mixed), C=10 main gear ──
    const opPlan = shuffleSeeded(
      buildOpPlan(MANIFEST.workload.quotas),
      segmentRand(MANIFEST.workload.seedToken, round, configName, "steady"),
    );
    sampler = startProcSampler(child.pid, join(segmentDir, "samples.json"));
    await sleep(60); // let the first steady-window sample land
    const cpuStart = sampler.samples[sampler.samples.length - 1];
    const steadyStart = Date.now();
    let done = 0;
    let errors = 0;
    const latencies = [];
    let windowExceeded = false;
    await runOpStream(opPlan, concurrency, async (op) => {
      if (op.prepare) await op.prepare(ctx);
      const opStart = performance.now();
      const rec = await execOp(op, ctx);
      rec.ms = +(performance.now() - opStart).toFixed(3);
      latencies.push(rec.ms);
      done++;
      if (rec.violations.length > 0) errors++;
      writeOp(rec);
      if (
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
    const cpuEnd = sampler.samples[sampler.samples.length - 1];
    seg.ops = done;
    seg.errors = errors;
    seg.errorRate = done > 0 ? +(errors / done).toFixed(5) : null;
    const sorted = [...latencies].sort((a, b) => a - b);
    seg.p50Ms = +percentile(sorted, 50).toFixed(3);
    seg.p95Ms = +percentile(sorted, 95).toFixed(3);
    seg.p99Ms = +percentile(sorted, 99).toFixed(3);
    seg.wallSeconds = +((Date.now() - steadyStart) / 1000).toFixed(3);
    seg.throughputOpsPerSec = +(done / seg.wallSeconds).toFixed(3);
    if (cpuStart && cpuEnd && done > 0) {
      seg.cpuMsTotal = cpuEnd.cpuMs - cpuStart.cpuMs;
      seg.cpuMsPerOp = +((cpuEnd.cpuMs - cpuStart.cpuMs) / done).toFixed(4);
    } else if (done === 0) {
      seg.invalidReasons.push("no steady ops completed");
    } else {
      seg.invalidReasons.push(
        "proc sampler produced no steady-window CPU pair",
      );
    }
    const rssSeries = sampler.samples
      .filter((s) => s.rssKb != null)
      .map((s) => s.rssKb / 1024);
    seg.rssMb = rssSeries.length ? +mean(rssSeries).toFixed(2) : null;
    seg.rssMaxMb = rssSeries.length ? +Math.max(...rssSeries).toFixed(2) : null;

    // ── PROTOCOL §6.5 hard exclusions ──
    if (sampler.maxLoad1 > LOADAVG_HARD_LIMIT) {
      seg.invalidReasons.push(
        `1m loadavg ${sampler.maxLoad1} > ${LOADAVG_HARD_LIMIT} inside segment (§6.5 exclusion 1)`,
      );
    }
    if (sampler.clockJump) {
      seg.invalidReasons.push(
        `sampler clock jump > ${CLOCK_JUMP_LIMIT_MS}ms (§6.5 exclusion 3)`,
      );
    }
    sampler.stop();

    // ── 7. shutdown: SIGTERM → wall time + exit code (T9 budget) ──
    seg.shutdown = await stopServerGracefully(child);
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
    return {
      violations,
      responses: recs.map((r) => ({ op: r.op, code: r.statusCode })),
    };
  } catch (err) {
    violations.push(
      `smoke failure: ${String(err?.stack ?? err).slice(0, 400)}`,
    );
    return { violations, responses: [] };
  } finally {
    await stopServerGracefully(server.child);
    if (sql) await sql.end({ timeout: 3 }).catch(() => {});
  }
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

  // 3. fixture math: quotas, pools, naming, §2.8 DB family
  try {
    const q = MANIFEST.workload.quotas;
    const p = MANIFEST.workload.prepPool;
    const problems = [];
    if (q.c4Replay + q.c4Stale + q.c4Conflicting + q.c4Other !== q.c4Rejects) {
      problems.push(
        "C4 sub-quotas must sum to c4Rejects (PROTOCOL §3.1 C4: 300/400/200/100)",
      );
    }
    if (
      q.c4Replay !== 300 ||
      q.c4Stale !== 400 ||
      q.c4Conflicting !== 200 ||
      q.c4Other !== 100
    ) {
      problems.push(
        "C4 sub-quota split must be exactly 300/400/200/100 (PROTOCOL §3.1 C4)",
      );
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
        problems.push(
          `plan slot ${kind}: built ${byKind[kind]}, expected ${n}`,
        );
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
    const totalOps =
      q.c1Health +
      q.c1Ready +
      q.c2Login +
      q.c2ExamList +
      q.c3SaveAccepted +
      q.c4Rejects +
      q.c5SubmitFresh +
      q.c5SubmitDuplicate +
      q.c6TakeFrozen +
      q.c6TakeUnchanged +
      q.c6Restore +
      q.c7Heartbeat +
      q.c7PasswordReset;
    if (!/^exam_e2e(_w[0-9]+)?$/.test(MANIFEST.db.name))
      problems.push("bench DB outside the §2.8 e2e worker family");
    add(
      "fixture-math",
      problems.length === 0,
      problems.join("; ") ||
        `totalOps=${totalOps}, plan=${plan.length} attempts over ${owners} owners, C4 split 300/400/200/100, W09=200, W11=10000, db=${MANIFEST.db.name} in §2.8 family`,
    );
  } catch (err) {
    add("fixture-math", false, String(err));
  }

  // 4. oracle flags intentionally-injected bad samples, accepts good shapes
  try {
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
    ];
    const falseNeg = good.filter((r) => checkOp(r).length !== 0);
    const falsePos = bad.filter((r) => checkOp(r.rec).length === 0);
    const ok = falseNeg.length === 0 && falsePos.length === 0;
    add(
      "oracle-bad-sample",
      ok,
      ok
        ? `14 good shapes accepted; ${bad.length} injected bad samples all flagged (${bad.map((b) => b.why).join("; ")})`
        : `false-negatives=${falseNeg.map((r) => r.op).join(",") || "none"}; missed bad samples: ${falsePos.map((b) => b.why).join("; ") || "none"}`,
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
      const { violations, responses } = await liveSmoke({
        bootDir: "/tmp/otel-w964-selftest",
        dbUrl,
      });
      add(
        "oracle-live-smoke",
        violations.length === 0,
        violations.length === 0
          ? `19-op miniature over every stream op kind against a real H1 boot: zero oracle violations (${responses.length} ops, all contracts matched)`
          : `${violations.length} violation(s): ${violations.slice(0, 6).join(" | ")}`,
      );
    } catch (err) {
      add("oracle-live-smoke", false, String(err));
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

async function cmdRound({ round, configs, concurrency, gcObserve }) {
  if (!Array.isArray(configs) || configs.length === 0) {
    throw new Error("round needs --configs A,B[,…]");
  }
  for (const c of configs) {
    if (!MANIFEST.configs[c])
      throw new Error(`unknown config "${c}" in manifest`);
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
  return { round, results: markerResults, driftNotes: driftNotes.join(" | ") };
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
  runner.js round --manifest <p> --round N --configs A,B[,...] [--concurrency N]
  runner.js validate --round N
  runner.js aggregate
  runner.js profile --config X --out <dir>`;

async function main() {
  const cli = parseCli(process.argv.slice(2));
  const cmd = cli._[0];
  let exitCode = 0;
  let lastLine = "";

  try {
    MANIFEST = loadManifest(cli.manifest ?? join(HERE, "configs.json"));

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
      } = await cmdRound({
        round,
        configs,
        concurrency:
          Number.isInteger(concurrencyNum) && concurrencyNum > 0
            ? concurrencyNum
            : undefined,
        gcObserve: cli["gc-observe"] === true,
      });
      lastLine = `###SUMMARY###${JSON.stringify({ round: r, results, driftNotes })}`;
      exitCode = 0;
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
        ...agg.rows
          .filter((r) => r.cpuRangePct)
          .map(
            (r) =>
              `[${r.config}] paired CPU delta range (min–max): ${r.cpuRangePct[0]}% … ${r.cpuRangePct[1]}% (PROTOCOL §6.3 reporting)`,
          ),
      ];
      lastLine = `###AGG###${JSON.stringify({ rows, notes })}`;
      exitCode = 0;
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

main();
