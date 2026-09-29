#!/usr/bin/env node
/**
 * EXAM-586 RESEARCH ONLY load driver (Issue #586, protocol §20).
 *
 * Adapts the #550 lifecycle-harness driver law to the Fedora production
 * Docker topology. Runs INSIDE a one-off container on the exam-net bridge;
 * every measured candidate binds a DISTINCT secondary source IP so per-IP
 * identities survive to nginx ($remote_addr → replaced XFF → trusted-proxy
 * walk). Real HTTP against the real stack, per-candidate session state,
 * nothing hidden, no automatic retries.
 *
 * Modes:
 *   driver.mjs setup   — admin login → course + 12 questions + warmup exam +
 *                        main exam → publish → writes exams.json
 *   driver.mjs measure — warmup flow → LOGIN → START → ANSWERS → STABILIZE →
 *                        SUBMIT_BURST (the treatment) → requests.jsonl +
 *                        driver-summary.json
 *
 * Input (bind-mounted at RUN_DIR): org.json, exams.json (setup output),
 * candidates.json (host-seeded fixture manifest). This driver NEVER touches
 * PostgreSQL — all durable oracles are host-side (protocol: PG unpublished).
 */
import http from "node:http";
import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const RUN_DIR = process.env.RUN_DIR ?? "/data/run";
const BASE_URL = process.env.BASE_URL ?? "http://web";
const ORIGIN = process.env.ORIGIN ?? "";
const MODE = process.argv[2] ?? "measure";
const RUN_ID = process.env.RUN_ID ?? "run";
const N = Number(process.env.N ?? "0");
const POOL_DESC = process.env.POOL_DESC ?? "unset";
const SCALE = N;
const CLIENT_TIMEOUT_MS = Number(process.env.CLIENT_TIMEOUT_MS ?? "60000");
const STABILIZE_MS = Number(process.env.STABILIZE_MS ?? "10000");
const ANSWER_WAVE = 20;

const QUESTION_COUNT = 12;
/** Deterministic workload (03-method.md): candidate i question q answer. */
const answerOf = (i, q) => (i + q) % 2 === 0;

const readJson = (name) =>
  JSON.parse(readFileSync(join(RUN_DIR, name), "utf8"));

// ── HTTP client (one keep-alive socket per candidate, bound source IP) ──
class Client {
  constructor({ id, localAddress }) {
    this.id = id;
    this.cookie = null;
    this.agent = new http.Agent({
      keepAlive: true,
      maxSockets: 1,
      keepAliveMsecs: 4000,
      maxFreeSockets: 1,
    });
    this.localAddress = localAddress;
  }
  setCookieFrom(headers) {
    const set = headers["set-cookie"];
    if (!set) return;
    for (const c of set) {
      const m = /^auth-token=([^;]+)/.exec(c);
      if (m) this.cookie = m[1];
    }
  }
  request(method, path, body) {
    const started = performance.now();
    return new Promise((resolve) => {
      const url = new URL(path, BASE_URL);
      const payload =
        body === undefined ? null : Buffer.from(JSON.stringify(body));
      const req = http.request(
        url,
        {
          method,
          agent: this.agent,
          localAddress: this.localAddress,
          headers: {
            ...(payload === null
              ? {}
              : {
                  "content-type": "application/json",
                  "content-length": payload.length,
                }),
            ...(ORIGIN === "" ? {} : { origin: ORIGIN }),
            ...(this.cookie === null
              ? {}
              : { cookie: `auth-token=${this.cookie}` }),
          },
        },
        (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            resolve({
              status: res.statusCode ?? 0,
              body: Buffer.concat(chunks).toString("utf8"),
              headers: res.headers,
              latencyMs: performance.now() - started,
              timedOut: false,
            });
          });
        },
      );
      req.setTimeout(CLIENT_TIMEOUT_MS, () =>
        req.destroy(new Error("client-timeout")),
      );
      req.on("error", (err) => {
        const timedOut = err.message === "client-timeout";
        resolve({
          status: 0,
          body: "",
          headers: {},
          latencyMs: performance.now() - started,
          timedOut,
          errorClass: timedOut
            ? "timeout"
            : String(err.code ?? err.message).slice(0, 60),
        });
      });
      if (payload !== null) req.write(payload);
      req.end();
    });
  }
  async json(method, path, body) {
    const res = await this.request(method, path, body);
    let parsed = null;
    try {
      parsed = res.body.length > 0 ? JSON.parse(res.body) : null;
    } catch {
      parsed = null;
    }
    return { ...res, parsed };
  }
  async login(username, password) {
    const res = await this.json("POST", "/api/auth/login", {
      username,
      password,
    });
    if (res.status === 200) this.setCookieFrom(res.headers);
    return res;
  }
  close() {
    this.agent.destroy();
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errorClassOf = (r) =>
  r.errorClass === "timeout"
    ? "timeout"
    : r.errorClass
      ? `conn:${r.errorClass}`
      : r.status === 429
        ? "rate_limited"
        : r.status >= 500
          ? "server_5xx"
          : r.status >= 400
            ? `http_${r.status}`
            : null;

class Samples {
  constructor(path) {
    this.path = path;
    this.buf = [];
    if (existsSync(path)) appendFileSync(path, "");
  }
  write(rec) {
    this.buf.push(JSON.stringify(rec));
    if (this.buf.length >= 200) this.flushSync();
  }
  flushSync() {
    if (this.buf.length === 0) return;
    appendFileSync(this.path, this.buf.join("\n") + "\n");
    this.buf = [];
  }
}

function phaseTally(results) {
  const by = (f) => results.filter(f).length;
  const lat = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  const q = (p) =>
    lat.length
      ? lat[Math.min(lat.length - 1, Math.floor(p * lat.length))]
      : null;
  return {
    total: results.length,
    ok2xx: by((r) => r.status >= 200 && r.status < 300),
    e429: by((r) => r.status === 429),
    e5xx: by((r) => r.status >= 500),
    timeouts: by((r) => r.timedOut === true),
    connErrors: by((r) => r.status === 0 && r.timedOut !== true),
    p50: q(0.5),
    p95: q(0.95),
    p99: q(0.99),
    max: lat.length ? lat[lat.length - 1] : null,
  };
}

function extractQuestionIds(parsed) {
  const body = parsed ?? {};
  if (Array.isArray(body.questionSnapshot)) {
    return body.questionSnapshot
      .map((q) => q.originalQuestionId ?? "")
      .filter((x) => x.length > 0);
  }
  if (Array.isArray(body.questions))
    return body.questions.map((q) => q.id ?? "").filter((x) => x.length > 0);
  if (Array.isArray(body.attempt?.questionIds)) return body.attempt.questionIds;
  throw new Error(
    `cannot locate question ids in start response keys=${Object.keys(body).join(",")}`,
  );
}

function fail(msg) {
  console.error(`DRIVER_FATAL ${JSON.stringify({ run: RUN_ID, msg })}`);
  process.exit(3);
}

// ─────────────────────────── setup mode ───────────────────────────
async function setup() {
  const { orgId } = readJson("org.json");
  const adminSpec = readJson("admin.json");
  const admin = new Client({ id: "admin" });
  const login = await admin.login(adminSpec.username, adminSpec.password);
  if (login.status !== 200)
    fail(`admin login ${login.status} ${login.body.slice(0, 200)}`);

  const stamp = Date.now();
  const course = await admin.json("POST", "/api/courses", {
    name: `586-${RUN_ID}`.slice(0, 80),
    code: `586-${stamp}`,
    description: "",
  });
  if (course.status !== 201)
    fail(`course ${course.status} ${course.body.slice(0, 200)}`);
  const courseId = course.parsed.id;

  const questionIds = [];
  for (let q = 0; q < QUESTION_COUNT; q++) {
    // Deterministic standard answers: question q → (q mod 2) === 0 (§03-method).
    const res = await admin.json("POST", "/api/questions", {
      courseId,
      type: "true_false",
      content: `586-Q${q}`,
      standardAnswer: q % 2 === 0,
      score: 10,
    });
    if (res.status !== 201)
      fail(`question ${res.status} ${res.body.slice(0, 200)}`);
    questionIds.push(res.parsed.id);
  }

  async function createExam(title) {
    const res = await admin.json("POST", "/api/exams", {
      title,
      description: "",
      courseId,
      timingMode: "timed_window",
      durationMinutes: 90,
      openAt: new Date(Date.now() - 3_600_000).toISOString(),
      closeAt: new Date(Date.now() + 86_400_000).toISOString(),
      passingScore: 60,
      totalScore: 120,
      questionSelectionMode: "manual",
      questionIds,
      resultPublicationMode: "immediate",
      controlFlags: {
        shuffleQuestions: false,
        shuffleOptions: false,
        detectTabSwitch: false,
        disableCopyPaste: false,
        requireQueue: false,
        showResultImmediately: true,
      },
      retakePolicy: "unlimited",
      scoreStrategy: "highest",
      maxAttempts: 1,
      interruptionTimePolicy: "strict",
    });
    if (res.status !== 201)
      fail(`exam ${res.status} ${res.body.slice(0, 200)}`);
    const examId = res.parsed.id;
    const pub = await admin.json("POST", `/api/exams/${examId}/publish`, {});
    if (pub.status !== 200)
      fail(`publish ${pub.status} ${pub.body.slice(0, 200)}`);
    return examId;
  }

  const warmupExamId = await createExam(`warmup-${RUN_ID}`.slice(0, 80));
  const examId = await createExam(
    `586 ${RUN_ID} p${POOL_DESC} S${SCALE}`.slice(0, 100),
  );
  writeFileSync(
    join(RUN_DIR, "exams.json"),
    JSON.stringify({ courseId, questionIds, warmupExamId, examId }, null, 2) +
      "\n",
  );
  console.log(`DRIVER_SETUP_OK ${JSON.stringify({ examId, warmupExamId })}`);
}

// ─────────────────────────── measure mode ──────────────────────────
async function measure() {
  if (!N) fail("measure requires N");
  const { warmup } = readJson("candidates.json");
  const candidates = readJson("candidates.json").candidates;
  if (candidates.length !== N)
    fail(`candidate population mismatch ${candidates.length} != ${N}`);

  const samples = new Samples(join(RUN_DIR, "requests.jsonl"));
  const base = { run_id: RUN_ID, pool: POOL_DESC, n: SCALE };
  const record = (r, candidate, endpoint, phase) =>
    samples.write({
      ...base,
      ts: new Date().toISOString(),
      candidate,
      endpoint,
      phase,
      status: r.status,
      latency_ms: Math.round(r.latencyMs * 1000) / 1000,
      timeout: r.timedOut === true,
      error_class: errorClassOf(r),
      retry_count: 0,
    });

  // ── WARMUP (phase "setup", never treatment) ──
  const { questionIds, warmupExamId, examId } = readJson("exams.json");
  const warm = new Client({ id: "warmup" });
  const wLogin = await warm.login(warmup.username, warmup.password);
  if (wLogin.status !== 200) fail(`warmup login ${wLogin.status}`);
  record(wLogin, "warmup", "POST /api/auth/login", "setup");
  const wStart = await warm.json("POST", `/api/attempts/${warmupExamId}/start`);
  if (wStart.status !== 201)
    fail(`warmup start ${wStart.status} ${wStart.body.slice(0, 200)}`);
  const wAttempt = wStart.parsed.id;
  const wQids = extractQuestionIds(wStart.parsed);
  const wSave = await warm.json(
    "POST",
    `/api/attempts/${wAttempt}/answers/${wQids[0]}`,
    {
      attemptId: wAttempt,
      questionId: wQids[0],
      answer: true,
      clientSeq: 1,
      clientSavedAt: new Date().toISOString(),
      baseVersion: 0,
    },
  );
  if (wSave.status !== 200 || wSave.parsed?.accepted !== true)
    fail(`warmup save ${wSave.status} ${wSave.body.slice(0, 200)}`);
  const wBeat = await warm.json("POST", `/api/attempts/${wAttempt}/heartbeat`);
  if (wBeat.status !== 200) fail(`warmup heartbeat ${wBeat.status}`);
  const wSubmit = await warm.json("POST", `/api/attempts/${wAttempt}/submit`);
  if (wSubmit.status !== 200)
    fail(`warmup submit ${wSubmit.status} ${wSubmit.body.slice(0, 300)}`);
  record(wSubmit, "warmup", "POST /api/attempts/:id/submit", "setup");
  warm.close();
  await sleep(STABILIZE_MS);

  // ── Candidate clients (distinct bound source IPs) ──
  const states = candidates.map((c, i) => ({
    i,
    username: c.username,
    password: c.password,
    client: new Client({ id: `c${i}`, localAddress: c.ip }),
    attemptId: null,
    questionIds: [],
    clientSeq: 0,
  }));

  // ── LOGIN_BURST (recorded, not the treatment) ──
  let phase = "LOGIN_BURST";
  const tLogin = performance.now();
  const logins = await Promise.all(
    states.map((s) => s.client.login(s.username, s.password)),
  );
  logins.forEach((r, i) =>
    record(r, states[i].username, "POST /api/auth/login", phase),
  );
  const loginWallMs = Math.round(performance.now() - tLogin);
  const loginOk = logins.filter((r) => r.status === 200).length;
  if (loginOk !== N) {
    samples.flushSync();
    fail(
      `login burst incomplete: ${loginOk}/${N} (429=${logins.filter((r) => r.status === 429).length})`,
    );
  }
  await sleep(500);

  // ── START_BURST ──
  phase = "START_BURST";
  const starts = await Promise.all(
    states.map((s) => s.client.json("POST", `/api/attempts/${examId}/start`)),
  );
  starts.forEach((r, i) =>
    record(r, states[i].username, "POST /api/attempts/:examId/start", phase),
  );
  for (let i = 0; i < N; i++) {
    if (starts[i].status !== 201 && starts[i].status !== 200) {
      samples.flushSync();
      fail(
        `start failed for ${i}: ${starts[i].status} ${starts[i].body.slice(0, 200)}`,
      );
    }
    states[i].attemptId = starts[i].parsed.id;
    states[i].questionIds = extractQuestionIds(starts[i].parsed);
    if (states[i].questionIds.length !== QUESTION_COUNT) {
      samples.flushSync();
      fail(`start for ${i} returned ${states[i].questionIds.length} questions`);
    }
  }

  // ── ANSWER_PHASE: every candidate answers all 12 questions once (waves) ──
  phase = "ANSWER_PHASE";
  let saveRejections = 0;
  for (let off = 0; off < N; off += ANSWER_WAVE) {
    const wave = states.slice(off, off + ANSWER_WAVE);
    await Promise.all(
      wave.map(async (s) => {
        for (const qid of s.questionIds) {
          s.clientSeq += 1;
          const r = await s.client.json(
            "POST",
            `/api/attempts/${s.attemptId}/answers/${qid}`,
            {
              attemptId: s.attemptId,
              questionId: qid,
              answer: answerOf(s.i, s.questionIds.indexOf(qid)),
              clientSeq: s.clientSeq,
              clientSavedAt: new Date().toISOString(),
              baseVersion: 0,
            },
          );
          const accepted = r.status === 200 && r.parsed?.accepted === true;
          if (!accepted) saveRejections += 1;
          record(r, s.username, "POST /api/attempts/:id/answers/:qid", phase);
          if (r.status === 429) break;
        }
      }),
    );
  }
  if (saveRejections !== 0) {
    samples.flushSync();
    fail(`${saveRejections} answer saves not accepted — workload deviation`);
  }

  // ── STABILIZE (fixed, identical everywhere) ──
  phase = "STABILIZE";
  await sleep(STABILIZE_MS);

  // ── SUBMIT_BURST — THE TREATMENT ──
  phase = "SUBMIT_BURST";
  const tSubmit = performance.now();
  const submits = await Promise.all(
    states.map((s) =>
      s.client.json("POST", `/api/attempts/${s.attemptId}/submit`),
    ),
  );
  const submitWallMs = Math.round(performance.now() - tSubmit);
  submits.forEach((r, i) =>
    record(
      r,
      states[i].username,
      "POST /api/attempts/:id/submit",
      "SUBMIT_BURST",
    ),
  );

  states.forEach((s) => s.client.close());
  samples.flushSync();

  const summary = {
    run_id: RUN_ID,
    pool: POOL_DESC,
    n: SCALE,
    loginWallMs,
    submitWallMs,
    LOGIN_BURST: phaseTally(logins),
    START_BURST: phaseTally(starts),
    SUBMIT_BURST: phaseTally(submits),
    submit429: submits.filter((r) => r.status === 429).length,
    finished_at: new Date().toISOString(),
  };
  writeFileSync(
    join(RUN_DIR, "driver-summary.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );
  console.log(
    `DRIVER_MEASURE_OK ${JSON.stringify({ submitWallMs, SUBMIT_BURST: summary.SUBMIT_BURST })}`,
  );
}

MODE === "setup" ? setup() : measure();
