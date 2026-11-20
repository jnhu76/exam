#!/usr/bin/env node
/**
 * S2-TIMING live-A protocol runner (RESEARCH ONLY; PROTOCOL §10 S2-TIMING,
 * ADDENDUM §2.3 — cases ①①-b/①-b' ③-a/③-b over the REAL nginx ingress).
 *
 * Usage (cwd anywhere; canonical cwd=/home/hoo/Source/exam):
 *   node .wt-capacity/docs/research/exam-cdp-watt-runtime-capacity/evidence/S2-TIMING/s2-live.mjs \
 *        --run-id=S2-LIVE-r1 [--from=0] [--base=http://127.0.0.1:8080]
 *          [--proxy=http://127.0.0.1:8090] [--control=http://127.0.0.1:8091]
 *
 * Instruments:
 *   - real HTTP through nginx (fetch, cookie auth-token; password NEVER logged);
 *   - deterministic serialization barrier: an externally held
 *     `SELECT ... FROM exam_enrollments WHERE id=$1 FOR UPDATE` transaction
 *     (docker exec -i psql, stdin-held; ROLLBACK = release) — save/submit
 *     transactions queue behind it in arrival order (EA lock seam,
 *     attempts.candidate.ts:1017/:155);
 *   - wall clock (Date/ISO + PG now()) AND monotonic clock
 *     (performance.now timeline) recorded per event;
 *   - assertions coded from evidence/S2-TIMING/expected.md (§1/§3) — the
 *     pre-registered expectation table.
 *
 * Candidate pool: unused cap9same-* candidates (no attempt row) of the
 * same-field exam; each case consumes its own candidate (maxAttempts=1).
 */
import { execFile, spawn } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => /^--([^=]+)=(.*)$/.exec(a)?.slice(1, 3) ?? [a.slice(2), "true"]),
);
const RUN_ID = args["run-id"] ?? `S2-LIVE-${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 13)}`;
const FROM = Number(args.from ?? 0);
const BASE = args.base ?? "http://127.0.0.1:8080";
const PROXY = args.proxy ?? "http://127.0.0.1:8090";
const CONTROL = args.control ?? "http://127.0.0.1:8091";
const DB = "exam_550_e2e";
// Synthetic fixture credential — read from the campaign config (pointer, not a
// copy; same pattern as S1-SUBMIT/s1-run.sh:186-188). Never logged/archived.
const PWD = process.env.CANDIDATE_PASSWORD ?? (/CANDIDATE_PASSWORD = "([^"]+)"/.exec(
  readFileSync(join(__dirname, "..", "..", "harness", "lib", "config.ts"), "utf8"),
)?.[1] ?? (() => { throw new Error("CANDIDATE_PASSWORD not found"); })());
const OUT_DIR = join(__dirname, RUN_ID);
mkdirSync(OUT_DIR, { recursive: true });

const t0 = performance.now();
const mono = () => Math.round((performance.now() - t0) * 1000) / 1000;
const wall = () => new Date().toISOString();
const log = (m) => console.log(`[${RUN_ID}] ${m}`);
const samples = [];
function record(ev) { const r = { ...ev, monoAt: mono(), wallAt: wall() }; samples.push(r); log(JSON.stringify(r)); return r; }

const results = []; // {case, assertion, expected, actual, pass}
function assert(caseName, name, expected, actual, pass) {
  results.push({ case: caseName, assertion: name, expected, actual, pass });
  log(`${pass ? "PASS" : "FAIL"} ${caseName}·${name}: expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
  return pass;
}

// ── PG helpers (docker exec psql; the research harness owns exam_550_e2e) ──
function psql(sql) {
  return new Promise((resolve, reject) => {
    execFile("docker", ["exec", "-i", "exam-dev-db-1", "psql", "-U", "exam", "-d", DB, "-X", "-q", "-t", "-A", "-c", sql], { maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`psql: ${err.message} ${stderr}`)); else resolve(stdout);
    });
  });
}
const pgNow = async () => (await psql("SELECT now()::text")).trim();

/** Deterministic barrier: hold `exam_enrollments.id FOR UPDATE` until release().
 *  The psql session stays idle-in-transaction after acquiring the lock (NO
 *  pg_sleep — a sleeping statement would queue ahead of the release ROLLBACK,
 *  as diagnosed on the first run); release writes ROLLBACK which executes
 *  immediately. A 120s watchdog rollbacks if release never comes. */
function holdEnrollmentLock(enrollmentId) {
  const child = spawn("docker", ["exec", "-i", "exam-dev-db-1", "psql", "-U", "exam", "-d", DB, "-X", "-q"], { stdio: ["pipe", "pipe", "inherit"] });
  const ready = new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error("barrier lock timeout")), 10_000);
    child.stdout.on("data", (c) => {
      buf += c.toString();
      if (buf.includes("LOCKED")) { clearTimeout(timer); resolve(); }
    });
    child.on("error", reject);
  });
  child.stdin.write(`BEGIN; SELECT 'LOCKED' FROM exam_enrollments WHERE id = '${enrollmentId}' FOR UPDATE;\n`);
  const watchdog = setTimeout(() => {
    record({ ev: "barrier-watchdog-rollback", enrollmentId });
    try { child.stdin.write("ROLLBACK;\n"); child.stdin.end(); } catch { /* already gone */ }
  }, 120_000);
  const release = async () => {
    clearTimeout(watchdog);
    child.stdin.write("ROLLBACK;\n");
    child.stdin.end();
    record({ ev: "barrier-released", enrollmentId });
    await new Promise((r) => child.on("exit", r));
  };
  return { ready, release };
}

// ── HTTP helpers ────────────────────────────────────────────────────────────
async function api(base, method, path, { cookie, body, timeoutMs = 30_000 } = {}) {
  const startedAt = mono();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort("timeout"), timeoutMs);
  try {
    const res = await fetch(base + path, {
      method, signal: ctl.signal,
      // Origin must be the canonical public origin even when the request
      // transits the isolated proxy (:8090 → nginx) — the API's origin check
      // compares against PUBLIC_WEB_ORIGIN (r2 run: proxied submit → 403).
      headers: { accept: "application/json", origin: BASE, referer: `${BASE}/`, ...(cookie ? { cookie } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let setCookie = res.headers.get("set-cookie");
    return { status: res.status, body: text.slice(0, 4000), setCookie, latencyMs: mono() - startedAt, at: mono(), wallAt: wall() };
  } catch (e) {
    return { status: 0, body: "", errorClass: String(e?.cause?.code ?? e?.message ?? e).slice(0, 80), latencyMs: mono() - startedAt, at: mono(), wallAt: wall() };
  } finally { clearTimeout(timer); }
}
async function login(base, username) {
  const r = await api(base, "POST", "/api/auth/login", { body: { username, password: PWD } });
  if (r.status !== 200) throw new Error(`login ${username} → ${r.status} ${r.body}`);
  const cookie = (r.setCookie ?? "").split(";")[0];
  record({ ev: "login", username, status: r.status, latencyMs: r.latencyMs });
  return cookie;
}
async function startAttempt(base, cookie, examId) {
  const r = await api(base, "POST", `/api/attempts/${examId}/start`, { cookie });
  if (![200, 201].includes(r.status)) throw new Error(`start → ${r.status} ${r.body}`);
  const attemptId = JSON.parse(r.body).id;
  const take = await api(base, "GET", `/api/candidate/attempts/${attemptId}/take`, { cookie });
  const snap = JSON.parse(take.body);
  record({ ev: "start", attemptId, status: r.status, takeStatus: take.status, questions: snap.questions?.length });
  return { attemptId, questions: snap.questions.map((q) => q.id), snapshot: snap };
}
function saveBody(attemptId, questionId, answer, clientSeq, baseVersion) {
  return { attemptId, questionId, answer, clientSeq, clientSavedAt: new Date().toISOString(), baseVersion };
}

// ── DB oracle (已保存 / 已提交 / 已评分 separately) ──────────────────────────
async function oracle(username) {
  const out = {};
  out.saved = (await psql(
    `SELECT coalesce(string_agg(client_seq::text, ',' ORDER BY client_seq),'') FROM exam_answer_save_receipts r
     JOIN exam_attempts a ON a.id=r.attempt_id JOIN candidate_profiles cp ON cp.id=a.candidate_id
     JOIN users u ON u.id=cp.user_id WHERE u.username='${username}'`)).trim();
  const row = (await psql(
    `SELECT a.id::text, a.status::text, coalesce(a.submission_reason,''), coalesce(a.submitted_at::text,''),
       (SELECT count(*) FROM attempt_grading_entries g WHERE g.attempt_id=a.id),
       (SELECT count(*) FROM audit_logs al WHERE al.action='attempt.submit' AND al.target_id=a.id::text),
       coalesce(a.answers::text,''), coalesce(a.submitted_answers::text,''),
       (SELECT coalesce(e.final_score::text,'') FROM exam_enrollments e WHERE e.id=a.enrollment_id)
     FROM exam_attempts a JOIN candidate_profiles cp ON cp.id=a.candidate_id
     JOIN users u ON u.id=cp.user_id WHERE u.username='${username}'`)).trim();
  const cols = row.split("|");
  out.attempt = {
    id: cols[0], status: cols[1], submissionReason: cols[2], submittedAt: cols[3],
    gradingEntries: Number(cols[4]), submitAudits: Number(cols[5]),
    answers: cols[6], submittedAnswers: cols[7], finalScore: cols[8],
  };
  return out;
}
/** Frozen/draft answer lookup. Draft `answers` = [{answer,version,questionId}];
 *  frozen `submitted_answers` = {answers:[{value,questionId}]} (measured r2). */
const answerOf = (json, qid) => {
  try {
    const parsed = JSON.parse(json ?? "[]");
    const arr = Array.isArray(parsed) ? parsed : (parsed?.answers ?? []);
    const f = arr.find((x) => x.questionId === qid);
    if (!f) return null;
    return "answer" in f ? f.answer : f.value;
  } catch { return "unparseable"; }
};

async function controlProxy(method, path, body) {
  const res = await fetch(CONTROL + path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.text() };
}

// ── candidate pool ──────────────────────────────────────────────────────────
async function pickCandidates(n, from) {
  const examId = (await psql(`SELECT id::text FROM exams WHERE title='cap900 same-field S200'`)).trim();
  const q = await psql(
    `SELECT u.username FROM users u
     JOIN candidate_profiles cp ON cp.id = (SELECT id FROM candidate_profiles cp2 WHERE cp2.user_id=u.id LIMIT 1)
     JOIN exam_enrollments e ON e.candidate_id=cp.id AND e.exam_id='${examId}'
     WHERE u.username LIKE 'cap9same-c%' AND NOT EXISTS (
       SELECT 1 FROM exam_attempts a JOIN candidate_profiles cp2 ON cp2.id=a.candidate_id WHERE cp2.user_id=u.id)
     ORDER BY u.username`);
  const all = q.split("\n").map((s) => s.trim()).filter(Boolean);
  const picked = all.slice(from, from + n);
  if (picked.length < n) throw new Error(`need ${n} unused candidates, got ${picked.length} (from=${from})`);
  const ids = {};
  for (const u of picked) {
    ids[u] = {
      enrollmentId: (await psql(`SELECT e.id::text FROM exam_enrollments e JOIN candidate_profiles cp ON cp.id=e.candidate_id JOIN users uu ON uu.id=cp.user_id WHERE uu.username='${u}'`)).trim(),
      candidateId: (await psql(`SELECT cp.id::text FROM candidate_profiles cp JOIN users uu ON uu.id=cp.user_id WHERE uu.username='${u}'`)).trim(),
    };
  }
  return { examId, picked, ids };
}

// ── main ────────────────────────────────────────────────────────────────────
const CASES = [];
let examId = null; let cand = null; let candInfo = null;

async function main() {
  record({ ev: "run-start", base: BASE, db: DB, pgNow: await pgNow() });
  const health = await api(BASE, "GET", "/api/health");
  if (health.status !== 200) throw new Error(`nginx/api health ${health.status}`);
  ({ examId, picked: cand, ids: candInfo } = await pickCandidates(5, FROM));
  record({ ev: "pool", examId, candidates: cand });

  // ═══ Case ①-a: last change saved (receipt confirmed) then submit ═══
  {
    const C = "①-a save-ok-then-submit";
    const u = cand[0];
    const cookie = await login(BASE, u);
    const { attemptId, questions } = await startAttempt(BASE, cookie, examId);
    const q1 = questions[0];
    const s1 = await api(BASE, "POST", `/api/attempts/${attemptId}/answers/${q1}`, { cookie, body: saveBody(attemptId, q1, true, 1, 0) });
    const s2 = await api(BASE, "POST", `/api/attempts/${attemptId}/answers/${q1}`, { cookie, body: saveBody(attemptId, q1, false, 2, JSON.parse(s1.body).serverVersion) });
    record({ ev: "case1-saves", s1: { status: s1.status, body: s1.body.slice(0, 200) }, s2: { status: s2.status, body: s2.body.slice(0, 200) } });
    const sendWall = wall();
    const sub = await api(BASE, "POST", `/api/attempts/${attemptId}/submit`, { cookie });
    record({ ev: "case1-submit", status: sub.status, latencyMs: sub.latencyMs, body: sub.body.slice(0, 300), sendWall });
    const o = await oracle(u);
    const frozen = answerOf(o.attempt.submittedAnswers, q1);
    assert(C, "saves accepted v1/v2", "accepted x2", JSON.parse(s1.body).accepted === true && JSON.parse(s2.body).accepted === true, JSON.parse(s1.body).accepted === true && JSON.parse(s2.body).accepted === true);
    assert(C, "receipts [1,2]", "1,2", o.saved, o.saved === "1,2");
    assert(C, "submit 200", 200, sub.status, sub.status === 200);
    assert(C, "status graded", "graded", o.attempt.status, o.attempt.status === "graded");
    assert(C, "reason manual", "manual", o.attempt.submissionReason, o.attempt.submissionReason === "manual");
    // route-entry sample: send ≤ submittedAt ≤ client-recv (生产取时=route 入口)
    {
      const st = new Date(o.attempt.submittedAt).getTime();
      const pass = st >= new Date(sendWall).getTime() - 5 && st <= new Date(sub.wallAt).getTime();
      assert(C, "submittedAt in [send,recv] (route-entry now)", "send<=submittedAt<=recv",
        `send=${sendWall} db=${o.attempt.submittedAt} recv=${sub.wallAt}`, pass);
    }
    assert(C, "frozen answer = v2(false)", false, frozen, frozen === false);
    assert(C, "grading entries 12", 12, o.attempt.gradingEntries, o.attempt.gradingEntries === 12);
    assert(C, "submit audit exactly 1", 1, o.attempt.submitAudits, o.attempt.submitAudits === 1);
    assert(C, "finalScore written (已评分)", "non-empty", o.attempt.finalScore, o.attempt.finalScore !== "");
    CASES.push({ case: C, user: u, attemptId, oracle: o });
  }

  // ═══ Case ①-b: save in-flight + submit; SAVE acquires locks first ═══
  {
    const C = "①-b save-first-lock";
    const u = cand[1];
    const cookie = await login(BASE, u);
    const { attemptId, questions } = await startAttempt(BASE, cookie, examId);
    const q1 = questions[0];
    await api(BASE, "POST", `/api/attempts/${attemptId}/answers/${q1}`, { cookie, body: saveBody(attemptId, q1, true, 1, 0) });
    const barrier = holdEnrollmentLock(candInfo[u].enrollmentId);
    await barrier.ready;
    record({ ev: "barrier-held", user: u });
    const saveP = api(BASE, "POST", `/api/attempts/${attemptId}/answers/${q1}`, { cookie, body: saveBody(attemptId, q1, false, 2, 1) });
    await new Promise((r) => setTimeout(r, 300)); // save's lock request queued first
    const subP = api(BASE, "POST", `/api/attempts/${attemptId}/submit`, { cookie });
    record({ ev: "both-fired-save-then-submit", user: u });
    await new Promise((r) => setTimeout(r, 500));
    await barrier.release();
    const [sv, sub] = [await saveP, await subP];
    record({ ev: "case1b-done", save: { status: sv.status, body: sv.body.slice(0, 200) }, submit: { status: sub.status } });
    const o = await oracle(u);
    const frozen = answerOf(o.attempt.submittedAnswers, q1);
    const svBody = (() => { try { return JSON.parse(sv.body); } catch { return {}; } })();
    assert(C, "save accepted v2 after barrier", true, svBody.accepted === true, svBody.accepted === true);
    assert(C, "submit 200", 200, sub.status, sub.status === 200);
    assert(C, "frozen answer = in-flight v2(false)", false, frozen, frozen === false);
    assert(C, "receipts [1,2]", "1,2", o.saved, o.saved === "1,2");
    assert(C, "status graded / reason manual", "graded|manual", `${o.attempt.status}|${o.attempt.submissionReason}`, o.attempt.status === "graded" && o.attempt.submissionReason === "manual");
    assert(C, "audit exactly 1", 1, o.attempt.submitAudits, o.attempt.submitAudits === 1);
    CASES.push({ case: C, user: u, attemptId, oracle: o });
  }

  // ═══ Case ①-b': save in-flight + submit; SUBMIT acquires locks first ═══
  {
    const C = "①-b' submit-first-lock";
    const u = cand[2];
    const cookie = await login(BASE, u);
    const { attemptId, questions } = await startAttempt(BASE, cookie, examId);
    const q1 = questions[0];
    await api(BASE, "POST", `/api/attempts/${attemptId}/answers/${q1}`, { cookie, body: saveBody(attemptId, q1, true, 1, 0) });
    const barrier = holdEnrollmentLock(candInfo[u].enrollmentId);
    await barrier.ready;
    const subP = api(BASE, "POST", `/api/attempts/${attemptId}/submit`, { cookie });
    await new Promise((r) => setTimeout(r, 300)); // submit's lock request queued first
    const saveP = api(BASE, "POST", `/api/attempts/${attemptId}/answers/${q1}`, { cookie, body: saveBody(attemptId, q1, false, 2, 1) });
    await new Promise((r) => setTimeout(r, 500));
    await barrier.release();
    const [sub, sv] = [await subP, await saveP];
    record({ ev: "case1b2-done", submit: { status: sub.status }, save: { status: sv.status, body: sv.body.slice(0, 250) } });
    const o = await oracle(u);
    const frozen = answerOf(o.attempt.submittedAnswers, q1);
    const svBody = (() => { try { return JSON.parse(sv.body); } catch { return {}; } })();
    assert(C, "submit 200 first", 200, sub.status, sub.status === 200);
    assert(C, "late save = HTTP 200 + accepted:false (200≠已保存)", { status: 200, accepted: false },
      { status: sv.status, accepted: svBody.accepted }, sv.status === 200 && svBody.accepted === false);
    assert(C, "late save reason ATTEMPT_ALREADY_SUBMITTED", "ATTEMPT_ALREADY_SUBMITTED", svBody.reason, svBody.reason === "ATTEMPT_ALREADY_SUBMITTED");
    // PREDICTION-CORRECTED (r2): expected.md §1①-b' predicted serverVersion=1;
    // the code contract hardcodes serverVersion:0 for the status-guard
    // rejection (answerProtocol.ts:159-166). Assertion pins the code contract.
    assert(C, "serverVersion 0 on status-guard rejection (answerProtocol.ts:160)", 0, svBody.serverVersion, svBody.serverVersion === 0);
    assert(C, "frozen answer stays v1(true)", true, frozen, frozen === true);
    assert(C, "receipts [1] only (v2 never saved)", "1", o.saved, o.saved === "1");
    assert(C, "status graded / reason manual", "graded|manual", `${o.attempt.status}|${o.attempt.submissionReason}`, o.attempt.status === "graded" && o.attempt.submissionReason === "manual");
    assert(C, "audit exactly 1", 1, o.attempt.submitAudits, o.attempt.submitAudits === 1);
    CASES.push({ case: C, user: u, attemptId, oracle: o });
  }

  // ═══ Case ③-a: same attempt double POST submit ═══
  {
    const C = "③-a double-submit-POST";
    const u = cand[3];
    const cookie = await login(BASE, u);
    const { attemptId, questions } = await startAttempt(BASE, cookie, examId);
    const q1 = questions[0];
    await api(BASE, "POST", `/api/attempts/${attemptId}/answers/${q1}`, { cookie, body: saveBody(attemptId, q1, true, 1, 0) });
    const barrier = holdEnrollmentLock(candInfo[u].enrollmentId);
    await barrier.ready;
    const a = api(BASE, "POST", `/api/attempts/${attemptId}/submit`, { cookie });
    await new Promise((r) => setTimeout(r, 250));
    const b = api(BASE, "POST", `/api/attempts/${attemptId}/submit`, { cookie });
    await new Promise((r) => setTimeout(r, 400));
    await barrier.release();
    const [ra, rb] = [await a, await b];
    record({ ev: "case3a-done", first: { status: ra.status }, second: { status: rb.status } });
    const o = await oracle(u);
    const subAt = o.attempt.submittedAt;
    // orchestrator outcome classification from the API log (#1007 line, one per completed POST)
    const logLines = (() => {
      try {
        return readFileSync(join(__dirname, "..", "..", "harness", "logs", "api.log"), "utf8")
          .split("\n").filter((l) => l.includes("attempt.submit.completed") && l.includes(attemptId));
      } catch { return []; }
    })();
    const outcomes = logLines.map((l) => /"outcome":"([a-z_]+)"/.exec(l)?.[1]).filter(Boolean);
    record({ ev: "case3a-outcomes", outcomes });
    assert(C, "both POSTs → 200", [200, 200], [ra.status, rb.status], ra.status === 200 && rb.status === 200);
    assert(C, "audit exactly 1 (unique business effect)", 1, o.attempt.submitAudits, o.attempt.submitAudits === 1);
    assert(C, "grading entries 12 (single scoring)", 12, o.attempt.gradingEntries, o.attempt.gradingEntries === 12);
    assert(C, "status graded / reason manual", "graded|manual", `${o.attempt.status}|${o.attempt.submissionReason}`, o.attempt.status === "graded" && o.attempt.submissionReason === "manual");
    assert(C, "log outcomes {graded, replay_no_change}", ["graded", "replay_no_change"], outcomes,
      outcomes.length === 2 && outcomes.includes("graded") && outcomes.includes("replay_no_change"));
    assert(C, "submittedAt single value", "one ts", subAt, subAt !== "" && subAt !== null);
    CASES.push({ case: C, user: u, attemptId, oracle: o, firstStatus: ra.status, secondStatus: rb.status, outcomes });
  }

  // ═══ Case ③-b: submitted but response lost (via isolated proxy) ═══
  {
    const C = "③-b response-lost-recovery";
    const u = cand[4];
    const cookie = await login(BASE, u);
    const { attemptId, questions } = await startAttempt(BASE, cookie, examId);
    const q1 = questions[0];
    await api(BASE, "POST", `/api/attempts/${attemptId}/answers/${q1}`, { cookie, body: saveBody(attemptId, q1, true, 1, 0) });
    const ruleId = `swallow-${attemptId.slice(0, 8)}`;
    let ctl = await controlProxy("POST", "/rule", { id: ruleId, match: `/attempts/${attemptId}/submit`, action: "swallow-response" });
    if (ctl.status !== 200) throw new Error(`proxy rule set failed: ${ctl.status} ${ctl.body} (is s2-proxy.mjs running on ${CONTROL}?)`);
    const subP = api(PROXY, "POST", `/api/attempts/${attemptId}/submit`, { cookie });
    await new Promise((r) => setTimeout(r, 1500)); // request forwarded, response captured
    const evs = JSON.parse((await controlProxy("GET", "/events")).body).events;
    const captured = evs.find((e) => e.rule === ruleId && e.ev === "response-captured");
    record({ ev: "case3b-response-captured", captured: captured ?? null });
    ctl = await controlProxy("POST", "/release", { id: ruleId, deliver: false });
    const sub = await subP; // client observes connection reset — no HTTP response
    record({ ev: "case3b-client-view", status: sub.status, errorClass: sub.errorClass });
    // authoritative recovery read (direct nginx, same session)
    const read1 = await api(BASE, "GET", `/api/attempts/${attemptId}`, { cookie });
    const oBefore = await oracle(u);
    const subAtBefore = oBefore.attempt.submittedAt;
    // retry submit (idempotence)
    const retry = await api(BASE, "POST", `/api/attempts/${attemptId}/submit`, { cookie });
    const o = await oracle(u);
    const read1Body = (() => { try { return JSON.parse(read1.body); } catch { return {}; } })();
    assert(C, "client saw connection loss (status 0 / reset)", true, sub.status === 0, sub.status === 0);
    assert(C, "response was captured at proxy (server committed)", true, Boolean(captured), Boolean(captured));
    assert(C, "captured status line 200", "HTTP/1.1 200", captured?.statusLine, (captured?.statusLine ?? "").includes("200"));
    assert(C, "authoritative read shows graded", "graded", read1Body.status, read1Body.status === "graded");
    assert(C, "retry POST 200 idempotent", 200, retry.status, retry.status === 200);
    assert(C, "audit still exactly 1 after retry", 1, o.attempt.submitAudits, o.attempt.submitAudits === 1);
    assert(C, "grading entries 12 single scoring", 12, o.attempt.gradingEntries, o.attempt.gradingEntries === 12);
    assert(C, "submittedAt unchanged by retry", subAtBefore, o.attempt.submittedAt, o.attempt.submittedAt === subAtBefore);
    CASES.push({ case: C, user: u, attemptId, oracle: o, clientView: sub.errorClass, recoveryReadStatus: read1Body.status, retryStatus: retry.status });
  }

  record({ ev: "run-end", pgNow: await pgNow() });
  const failed = results.filter((r) => !r.pass);
  const summary = { runId: RUN_ID, base: BASE, db: DB, total: results.length, failed: failed.length, cases: CASES.length };
  writeFileSync(join(OUT_DIR, "samples.jsonl"), samples.map((s) => JSON.stringify(s)).join("\n") + "\n");
  writeFileSync(join(OUT_DIR, "assertions.json"), JSON.stringify({ summary, results }, null, 2) + "\n");
  writeFileSync(join(OUT_DIR, "cases.json"), JSON.stringify(CASES, null, 2) + "\n");
  log(`SUMMARY ${JSON.stringify(summary)}`);
  process.exitCode = failed.length === 0 ? 0 : 1;
}

main().catch((e) => { log(`FATAL ${String(e?.stack ?? e)}`); process.exit(2); });
