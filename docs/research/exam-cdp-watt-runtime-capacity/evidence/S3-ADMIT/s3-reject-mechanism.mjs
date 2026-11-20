#!/usr/bin/env node
/**
 * S3-ADMIT rejection-mechanism runner (RESEARCH ONLY; PROTOCOL §10 S3-ADMIT,
 * PROTOCOL-ADDENDUM §2.4).
 *
 * Mechanism test (NOT a performance sample — PROTOCOL §9.6): exercises the
 * live 503 path of the pre-execution manual-submit admission gate and verifies
 * that a rejected manual submit performed NO business work.
 *
 * Scenarios (API must already run the S3 build with the matching env):
 *   --scenario=timeout   Q_sub large, W_sub=1ms  → 4 admitted, 2× 503
 *                        SUBMIT_BUSY (timeout) while the 4 transactions run.
 *   --scenario=queuefull Q_sub=1, W_sub=15000ms  → 4 admitted, 1 queued
 *                        (admitted later), 1× 503 SUBMIT_BUSY (queue_full).
 *
 * Assertions for every rejected request:
 *   - HTTP 503 with body.error.code === "SUBMIT_BUSY" and Retry-After header;
 *   - attempt still in_progress, submission_reason null, submitted_at null;
 *   - attempt.submit audit rows = 0; save receipts = 0; grading entries = 0.
 * Admitted requests: 200 + graded/manual + audit 1 + 12 grading entries.
 *
 * Usage (cwd=/home/hoo/Source/exam):
 *   node .wt-capacity/docs/research/exam-cdp-watt-runtime-capacity/evidence/S3-ADMIT/s3-reject-mechanism.mjs --run-id=... --scenario=timeout
 */
import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "../../harness/lib/http.js";
import { CANDIDATE_PASSWORD, PUBLIC_ORIGIN } from "../../harness/lib/config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => /^--([^=]+)=(.*)$/.exec(a)?.slice(1, 3) ?? [a.slice(2), "true"]),
);
const RUN_ID = args["run-id"];
const SCENARIO = args.scenario;
const N = Number(args.n ?? 6);
const BASE = args.base ?? "http://127.0.0.1:8080";
const DB = "exam_550_e2e";
if (!RUN_ID || !["timeout", "queuefull"].includes(SCENARIO)) {
  console.error("usage: --run-id=<id> --scenario=timeout|queuefull [--n=6]");
  process.exit(2);
}
const OUT_DIR = join(__dirname, RUN_ID);
mkdirSync(OUT_DIR, { recursive: true });
const log = (m) => console.log(`[${RUN_ID}] ${m}`);
const results = [];
const samples = [];
function assert(name, expected, actual, pass) {
  results.push({ name, expected, actual, pass });
  log(`${pass ? "PASS" : "FAIL"} ${name}: expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
}

function psql(sql) {
  return new Promise((resolve, reject) => {
    execFile(
      "docker",
      ["exec", "-i", "exam-dev-db-1", "psql", "-U", "exam", "-d", DB, "-X", "-q", "-t", "-A", "-c", sql],
      { maxBuffer: 64 * 1024 * 1024 },
      (err, stdout, stderr) => (err ? reject(new Error(`psql: ${err.message} ${stderr}`)) : resolve(stdout)),
    );
  });
}

async function oracle(username) {
  const row = (
    await psql(
      `SELECT a.id::text, a.status::text, coalesce(a.submission_reason,''),
         coalesce(a.submitted_at::text,''),
         (SELECT count(*) FROM attempt_grading_entries g WHERE g.attempt_id=a.id),
         (SELECT count(*) FROM audit_logs al WHERE al.action='attempt.submit' AND al.target_id=a.id::text),
         (SELECT count(*) FROM exam_answer_save_receipts r WHERE r.attempt_id=a.id),
         coalesce(a.submitted_answers::text,'')
       FROM exam_attempts a
       JOIN candidate_profiles cp ON cp.id=a.candidate_id
       JOIN users u ON u.id=cp.user_id WHERE u.username='${username}'`,
    )
  ).trim();
  const c = row.split("|");
  return {
    attemptId: c[0], status: c[1], reason: c[2], submittedAt: c[3] === "" ? null : c[3],
    entries: Number(c[4]), audits: Number(c[5]), receipts: Number(c[6]), submittedAnswers: c[7],
  };
}

const examId = (await psql(`SELECT id::text FROM exams WHERE title='cap900 same-field S200'`)).trim();
const pool = (
  await psql(
    `SELECT u.username FROM users u
     JOIN candidate_profiles cp ON cp.id=(SELECT id FROM candidate_profiles cp2 WHERE cp2.user_id=u.id LIMIT 1)
     JOIN exam_enrollments e ON e.candidate_id=cp.id AND e.exam_id='${examId}'
     WHERE u.username LIKE 'cap9same-c%' AND NOT EXISTS (
       SELECT 1 FROM exam_attempts a JOIN candidate_profiles cp2 ON cp2.id=a.candidate_id WHERE cp2.user_id=u.id)
     ORDER BY u.username`,
  )
)
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean);
if (pool.length < N) throw new Error(`candidate pool ${pool.length} < ${N}`);

// ── prepare N sessions: login → start (attempt rows exist, none submitted) ──
const sessions = [];
for (const username of pool.slice(0, N)) {
  const client = new Client({ baseUrl: BASE, origin: PUBLIC_ORIGIN, id: username });
  const login = await client.login(username, CANDIDATE_PASSWORD);
  if (login.status !== 200) throw new Error(`login ${username} -> ${login.status}`);
  const start = await client.json("POST", `/api/attempts/${examId}/start`);
  if (start.status !== 201) throw new Error(`start ${username} -> ${start.status} ${start.body.slice(0, 160)}`);
  const attemptId = start.parsed.id;
  sessions.push({ username, client, attemptId });
}
log(`prepared ${sessions.length} attempts`);

// ── fire all submits in the same event-loop turn ────────────────────────────
const fireAt = Date.now() + 300;
await new Promise((r) => setTimeout(r, Math.max(0, fireAt - Date.now())));
const fired = await Promise.all(
  sessions.map(async (s) => {
    const res = await s.client.json("POST", `/api/attempts/${s.attemptId}/submit`);
    let code = null;
    try { code = res.parsed?.error?.code ?? null; } catch { /* ignore */ }
    const rec = {
      username: s.username, attemptId: s.attemptId, status: res.status, code,
      retryAfter: res.headers["retry-after"] ?? null,
      latencyMs: Math.round(res.latencyMs), body: res.body.slice(0, 300),
    };
    samples.push(rec);
    log(`submit ${s.username}: ${res.status} ${code ?? ""} ${rec.latencyMs}ms`);
    return rec;
  }),
);
await new Promise((r) => setTimeout(r, 500));
for (const s of sessions) await s.client.close();

const ok = fired.filter((f) => f.status === 200);
const busy = fired.filter((f) => f.status === 503 && f.code === "SUBMIT_BUSY");
const other = fired.filter((f) => f.status !== 200 && !(f.status === 503 && f.code === "SUBMIT_BUSY"));

const oracles = [];
for (const s of sessions) oracles.push({ username: s.username, ...(await oracle(s.username)) });

assert("all submits answered (no network loss)", N, fired.length, fired.length === N);
assert("only 200 / 503 SUBMIT_BUSY", 0, other.length, other.length === 0);
if (SCENARIO === "timeout") {
  assert("4 admitted + 2 timeout rejections", "4|2", `${ok.length}|${busy.length}`, ok.length === 4 && busy.length === 2);
} else {
  assert("5 admitted (1 via queue) + 1 queue_full rejection", "5|1", `${ok.length}|${busy.length}`, ok.length === 5 && busy.length === 1);
}
assert("every 503 carries Retry-After", busy.length, busy.filter((b) => b.retryAfter !== null).length,
  busy.every((b) => b.retryAfter !== null));

for (const b of busy) {
  const o = oracles.find((x) => x.username === b.username);
  assert(`rejected ${b.code} ${b.username}: attempt untouched`, "in_progress|null|0|0|0",
    `${o.status}|${o.submittedAt}|${o.audits}|${o.receipts}|${o.entries}`,
    o.status === "in_progress" && o.submittedAt === null && o.audits === 0 && o.receipts === 0 && o.entries === 0);
}
for (const f of ok) {
  const o = oracles.find((x) => x.username === f.username);
  assert(`admitted ${f.username}: graded/manual/audit1/entries12`, "graded|manual|1|12",
    `${o.status}|${o.reason}|${o.audits}|${o.entries}`,
    o.status === "graded" && o.reason === "manual" && o.audits === 1 && o.entries === 12);
}

const failed = results.filter((r) => !r.pass);
const out = {
  runId: RUN_ID, scenario: SCENARIO, base: BASE, db: DB, examId, n: N,
  env: {
    SUBMIT_ADMISSION: process.env.SUBMIT_ADMISSION ?? null,
    SUBMIT_ADMISSION_PERMITS: process.env.SUBMIT_ADMISSION_PERMITS ?? null,
    SUBMIT_ADMISSION_QUEUE_CAPACITY: process.env.SUBMIT_ADMISSION_QUEUE_CAPACITY ?? null,
    SUBMIT_ADMISSION_WAIT_BUDGET_MS: process.env.SUBMIT_ADMISSION_WAIT_BUDGET_MS ?? null,
  },
  fired, oracles,
  summary: { total: results.length, failed: failed.length, admitted: ok.length, busy: busy.length },
  results,
};
writeFileSync(join(OUT_DIR, "results.json"), JSON.stringify(out, null, 2) + "\n");
writeFileSync(join(OUT_DIR, "samples.jsonl"), samples.map((s) => JSON.stringify(s)).join("\n") + "\n");
log(`SUMMARY total=${results.length} failed=${failed.length} admitted=${ok.length} busy=${busy.length}`);
process.exit(failed.length === 0 ? 0 : 1);
