/**
 * #550 canonical lifecycle run (RESEARCH ONLY) — one scale N, one repetition.
 *
 * Phases (02-methodology.md §Scale matrix, reconnect before submit so the
 * restore path exercises a genuinely in-progress attempt):
 *   A LOGIN_BURST → B START_BURST → C/D/E STEADY (save + heartbeat + proctor
 *   reads) → G RECONNECT (silence → restore burst → take → first save) →
 *   F SUBMIT_BURST → durable oracles.
 *
 * Run from anywhere in the repo (paths derive from this file's location):
 *   HARNESS=$(git rev-parse --show-toplevel)/docs/research/exam-550-final-capacity-reproof-1/harness
 *   pnpm --filter @exam/db exec tsx "$HARNESS/run-lifecycle.ts" \
 *     --n=100 --rep=1 --steady=90 --scenario=lifecycle
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import {
  ADMISSION_BATCH_SIZE,
  API_ORIGIN,
  BASE_SHA,
  RESULTS_DIR,
  RUN_DB_URL,
  args,
} from "./lib/config.js";
import {
  attemptStatusCounts,
  answersMatchDurable,
  countDuplicates,
  duplicateTerminalTransitions,
  examTiming,
  freshRunDatabase,
  seedCandidates,
} from "./lib/db.js";
import { Client, JsonlWriter, sleep, type HttpResponse } from "./lib/http.js";
import {
  loginAdmin,
  startApi,
  startObservers,
  stopActiveApi,
  waitReady,
  type ObserverHandle,
} from "./lib/runtime.js";
import {
  sampleFrom,
  summarizePhase,
  type PhaseSummary,
} from "./lib/summary.js";

interface CandidateState {
  id: string;
  username: string;
  client: Client;
  attemptId: string | null;
  questionIds: string[];
  clientSeq: number;
  /** Per-question server answer version (the save protocol's version scope). */
  versions: Map<string, number>;
  answers: Map<string, unknown>;
  lastSaved: { questionId: string; answer: unknown } | null;
}

const cfg = args();
const N = Number(cfg.n ?? 20);
const REP = Number(cfg.rep ?? 1);
const STEADY_S = Number(cfg.steady ?? 90);
const SCENARIO = cfg.scenario ?? "lifecycle";
const TOPOLOGY = cfg.topology ?? "DIRECT_LAN";
const RUN_ID = `${SCENARIO}-S${N}-r${REP}-${new Date()
  .toISOString()
  .replace(/[:.]/g, "-")}`;
const RESULTS_SUB = join(RESULTS_DIR, RUN_ID);

async function main(): Promise<void> {
  mkdirSync(RESULTS_SUB, { recursive: true });
  const samples = new JsonlWriter(join(RESULTS_SUB, "samples.jsonl"));
  const conn = await freshRunDatabase();
  const orgRow = await conn.sql.unsafe(
    `SELECT id::text AS id FROM organizations ORDER BY created_at LIMIT 1`,
  );
  const orgId = orgRow[0].id as string;

  const api = startApi({
    mode: "e2e",
    dbUrl: RUN_DB_URL,
    runId: RUN_ID,
  });
  await waitReady(api.baseUrl);
  const admin = await loginAdmin(api);

  // ── Setup via canonical admin HTTP API (never measured): course, questions,
  // warmup exam, main exam (requireQueue=false), publish. ──
  const course = await admin.json("POST", "/api/courses", {
    name: `550-${RUN_ID}`,
    code: `550-${Date.now()}`,
    description: "",
  });
  if (course.status !== 201) throw new Error(`course: ${course.status}`);
  const courseId = (course.parsed as { id: string }).id;
  const questionIds: string[] = [];
  for (let i = 0; i < 12; i++) {
    const q = await admin.json("POST", "/api/questions", {
      courseId,
      type: "true_false",
      content: `Q${i}`,
      standardAnswer: i % 2 === 0,
      score: 10,
    });
    if (q.status !== 201) throw new Error(`question: ${q.status}`);
    questionIds.push((q.parsed as { id: string }).id);
  }

  async function createExam(title: string): Promise<string> {
    const res = await admin.json("POST", "/api/exams", {
      title,
      description: "",
      courseId,
      timingMode: "timed_window",
      durationMinutes: 90,
      openAt: new Date(Date.now() - 3600_000).toISOString(),
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
      throw new Error(`exam: ${res.status} ${res.body.slice(0, 300)}`);
    const examId = (res.parsed as { id: string }).id;
    const pub = await admin.json("POST", `/api/exams/${examId}/publish`, {});
    if (pub.status !== 200) throw new Error(`publish: ${pub.status}`);
    return examId;
  }

  const warmupExamId = await createExam(`warmup-${RUN_ID}`);
  const examId = await createExam(`550 lifecycle S${N} r${REP}`);

  // ── Proctors via the canonical paths: staff user create + scoped exam
  // assignment (ADR-015). Two identities poll concurrently during steady. ──
  const proctors: Client[] = [];
  for (let p = 0; p < 2; p++) {
    // username ≤50 chars (contract max) — do NOT embed the full RUN_ID.
    const username = `p550r${REP}x${p}t${Date.now()}`;
    const created = await admin.json("POST", "/api/users", {
      username,
      password: "proctor-550-cap",
      name: `Proctor ${p} (${RUN_ID})`,
      role: "Proctor",
    });
    if (created.status !== 201) {
      throw new Error(
        `proctor create: ${created.status} ${created.body.slice(0, 200)}`,
      );
    }
    const userId = (created.parsed as { id: string }).id;
    const assigned = await admin.json(
      "POST",
      `/api/admin/exams/${examId}/proctors`,
      { operationId: crypto.randomUUID(), proctorUserId: userId },
    );
    if (assigned.status !== 200 && assigned.status !== 201) {
      throw new Error(
        `proctor assign: ${assigned.status} ${assigned.body.slice(0, 200)}`,
      );
    }
    const client = new Client({
      baseUrl: api.baseUrl,
      id: `proctor-${p}`,
      origin: API_ORIGIN,
    });
    const login = await client.login(username, "proctor-550-cap");
    if (login.status !== 200) throw new Error(`proctor login: ${login.status}`);
    proctors.push(client);
  }

  // ── Candidate fixtures via DB bulk insert (not a measured path). ──
  const seeded = await seedCandidates(conn, {
    orgId,
    examId,
    count: N,
    prefix: `550S${N}r${REP}`,
  });

  writeFileSync(
    join(RESULTS_SUB, "meta.json"),
    JSON.stringify(
      {
        run_id: RUN_ID,
        scenario: SCENARIO,
        group: "lifecycle",
        n: N,
        rep: REP,
        steady_seconds: STEADY_S,
        topology: TOPOLOGY,
        base_sha: BASE_SHA,
        api_mode:
          "e2e (limiter off — sanctioned by the #549 contract; limiter dimension is separate)",
        api_port: api.port,
        db_pool_max: 10,
        redis_mode: "optional (limiter inert in e2e mode)",
        exam_id: examId,
        org_id: orgId,
        question_count: questionIds.length,
        candidate_count: N,
        batch_size: ADMISSION_BATCH_SIZE,
        started_at: new Date().toISOString(),
      },
      null,
      2,
    ) + "\n",
  );

  const observer: ObserverHandle = await startObservers({
    runId: RUN_ID,
    resultsDir: RESULTS_SUB,
    runDbName: RUN_DB_URL.split("/").pop() ?? "exam_550",
    samplerDbUrl: RUN_DB_URL,
    api,
    adminClient: admin,
  });

  // ── Warmup: one full flow on the warmup exam (phase=setup, unmeasured but
  // recorded with phase "setup" for honesty). ──
  observer.markPhase("setup");
  const warmupClient = new Client({
    baseUrl: api.baseUrl,
    id: "warmup",
    origin: API_ORIGIN,
  });
  const seededWarm = await seedCandidates(conn, {
    orgId,
    examId: warmupExamId,
    count: 1,
    prefix: "550warm",
  });
  const wLogin = await warmupClient.login(
    seededWarm.usernames[0],
    "pass-550-cap",
  );
  if (wLogin.status !== 200) throw new Error(`warmup login ${wLogin.status}`);
  const wStart = await warmupClient.json(
    "POST",
    `/api/attempts/${warmupExamId}/start`,
  );
  if (wStart.status !== 201)
    throw new Error(
      `warmup start ${wStart.status} ${wStart.body.slice(0, 300)}`,
    );
  const wAttempt = (wStart.parsed as { id: string }).id;
  const wQids = extractQuestionIds(wStart.parsed);
  const wSave = await warmupClient.json(
    "POST",
    `/api/attempts/${wAttempt}/answers/${wQids[0]}`,
    saveBody(wAttempt, wQids[0], true, 0, 0),
  );
  if (wSave.status !== 200)
    throw new Error(`warmup save ${wSave.status} ${wSave.body.slice(0, 300)}`);
  const wBeat = await warmupClient.json(
    "POST",
    `/api/attempts/${wAttempt}/heartbeat`,
  );
  if (wBeat.status !== 200) throw new Error(`warmup heartbeat ${wBeat.status}`);
  const wSubmit = await warmupClient.json(
    "POST",
    `/api/attempts/${wAttempt}/submit`,
  );
  if (wSubmit.status !== 200)
    throw new Error(
      `warmup submit ${wSubmit.status} ${wSubmit.body.slice(0, 300)}`,
    );
  await warmupClient.close();

  // ── Candidate state objects (fresh client per candidate = fresh session). ──
  const states: CandidateState[] = seeded.candidateIds.map((id, i) => ({
    id,
    username: seeded.usernames[i],
    client: new Client({
      baseUrl: api.baseUrl,
      id: `c${i}`,
      localAddress: loopbackAddress(i, TOPOLOGY),
      origin: API_ORIGIN,
    }),
    attemptId: null,
    questionIds: [],
    clientSeq: 0,
    versions: new Map(),
    answers: new Map(),
    lastSaved: null,
  }));

  const base = {
    scenario_id: SCENARIO,
    run_id: RUN_ID,
    topology: TOPOLOGY,
    n: N,
  };
  let phase = "setup";
  const record = (
    r: HttpResponse,
    candidate: string,
    endpoint: string,
    errorClassOverride?: string,
  ): void => {
    const rec = sampleFrom(r, {
      ...base,
      candidate,
      endpoint,
      phase,
      retry_count: 0,
    });
    if (errorClassOverride) rec.error_class = errorClassOverride;
    samples.write(rec);
  };

  /**
   * One answer save following the product's versioned conflict protocol.
   * The version scope is PER QUESTION; a rejection arrives as HTTP 200 with
   * accepted:false — recorded as a semantic rejection (never hidden), and the
   * server-provided serverVersion is adopted (the protocol's resync path).
   */
  async function saveOnce(s: CandidateState): Promise<HttpResponse> {
    s.clientSeq += 1;
    const qid = s.questionIds[s.clientSeq % s.questionIds.length];
    const answer = s.clientSeq % 2 === 0;
    const r = await s.client.json(
      "POST",
      `/api/attempts/${s.attemptId}/answers/${qid}`,
      saveBody(
        s.attemptId!,
        qid,
        answer,
        s.clientSeq,
        s.versions.get(qid) ?? 0,
      ),
    );
    const body = (r.parsed ?? {}) as {
      accepted?: boolean;
      reason?: string;
      serverVersion?: number;
    };
    if (r.status === 200 && body.accepted === true) {
      s.versions.set(qid, body.serverVersion ?? 0);
      s.answers.set(qid, answer);
      s.lastSaved = { questionId: qid, answer };
      record(r, s.id, "POST /api/attempts/:id/answers/:qid");
    } else if (r.status === 200 && body.accepted === false) {
      s.versions.set(qid, body.serverVersion ?? 0);
      record(
        r,
        s.id,
        "POST /api/attempts/:id/answers/:qid",
        `save_rejected:${body.reason ?? "unknown"}`,
      );
    } else {
      record(r, s.id, "POST /api/attempts/:id/answers/:qid");
    }
    return r;
  }
  const phaseTimes: Record<string, number> = {};
  async function enterPhase(name: string): Promise<void> {
    phase = name;
    phaseTimes[name] = performance.now();
    observer.markPhase(name);
  }

  // ── A. LOGIN_BURST ──
  await enterPhase("LOGIN_BURST");
  const tLogin = performance.now();
  const logins = await Promise.all(
    states.map((s) => s.client.login(s.username, "pass-550-cap")),
  );
  logins.forEach((r, i) => record(r, states[i].id, "POST /api/auth/login"));
  const loginWallMs = Math.round(performance.now() - tLogin);
  const loginOk = logins.filter((r) => r.status === 200).length;
  if (loginOk !== N) throw new Error(`login burst incomplete: ${loginOk}/${N}`);
  await sleep(500);

  // ── B. START_BURST ──
  await enterPhase("START_BURST");
  const starts = await Promise.all(
    states.map((s) => s.client.json("POST", `/api/attempts/${examId}/start`)),
  );
  starts.forEach((r, i) =>
    record(r, states[i].id, "POST /api/attempts/:examId/start"),
  );
  for (let i = 0; i < N; i++) {
    const r = starts[i];
    if (r.status !== 201 && r.status !== 200) {
      throw new Error(
        `start failed for ${i}: ${r.status} ${r.body.slice(0, 200)}`,
      );
    }
    const body = r.parsed as { id: string };
    states[i].attemptId = body.id;
    states[i].questionIds = extractQuestionIds(r.parsed);
  }

  // ── C/D/E. STEADY: saves + heartbeats + proctor reads ──
  await enterPhase("STEADY");
  const steadyDeadline = performance.now() + STEADY_S * 1000;
  let stopSteady = false;
  const steadyLoops = states.map((s, i) =>
    candidateSteadyLoop(
      s,
      i,
      { stop: () => stopSteady, deadline: steadyDeadline },
      record,
      saveOnce,
    ),
  );
  const proctorLoops = proctors.map((client, p) =>
    proctorLoop(client, p, examId, states, {
      stop: () => stopSteady,
      deadline: steadyDeadline,
      record,
    }),
  );
  await sleep(STEADY_S * 1000);
  stopSteady = true;
  await Promise.allSettled([...steadyLoops, ...proctorLoops]);

  // ── G. RECONNECT: silence → restore burst → take → first save ──
  await enterPhase("RECONNECT_SILENCE");
  await sleep(15_000);
  await enterPhase("RECONNECT_RESTORE");
  const restores = await Promise.all(
    states.map((s) => s.client.json("POST", `/api/attempts/${examId}/start`)),
  );
  restores.forEach((r, i) =>
    record(r, states[i].id, "POST /api/attempts/:examId/start (restore)"),
  );
  for (let i = 0; i < N; i++) {
    if (restores[i].status !== 200) {
      throw new Error(`restore failed for ${i}: ${restores[i].status}`);
    }
  }
  const takes = await Promise.all(
    states.map((s) =>
      s.client.json("GET", `/api/candidate/attempts/${s.attemptId}/take`),
    ),
  );
  await enterPhase("RECONNECT_TAKE");
  takes.forEach((r, i) =>
    record(r, states[i].id, "GET /api/candidate/attempts/:id/take"),
  );

  await enterPhase("RECONNECT_FIRST_SAVE");
  const firstSaves = await Promise.all(states.map((s) => saveOnce(s)));

  // ── F. SUBMIT_BURST ──
  await enterPhase("SUBMIT_BURST");
  const tSubmit = performance.now();
  const submits = await Promise.all(
    states.map((s) =>
      s.client.json("POST", `/api/attempts/${s.attemptId}/submit`),
    ),
  );
  submits.forEach((r, i) =>
    record(r, states[i].id, "POST /api/attempts/:id/submit"),
  );
  const submitWallMs = Math.round(performance.now() - tSubmit);
  const submitOk = submits.filter((r) => r.status === 200).length;

  // ── Durable oracles ──
  await enterPhase("ORACLE");
  const statusCounts = await attemptStatusCounts(conn, examId);
  const dupActive = await countDuplicates(conn, examId);
  const dupTerminal = await duplicateTerminalTransitions(conn, examId);
  const timing = await examTiming(conn, examId);
  const expectedAnswers = new Map(
    states
      .filter((s) => s.lastSaved && s.attemptId)
      .map((s) => [
        s.id,
        {
          attemptId: s.attemptId!,
          questionId: s.lastSaved!.questionId,
          answer: s.lastSaved!.answer,
        },
      ]),
  );
  const answerCheck = await answersMatchDurable(conn, expectedAnswers);
  await observer.markPhase("done");
  await samples.flush();

  const phaseSummary = (name: string, results: HttpResponse[]): PhaseSummary =>
    summarizePhase(name, results, phaseTimes[name] ?? 0);

  const summary = {
    run_id: RUN_ID,
    scenario: SCENARIO,
    n: N,
    rep: REP,
    topology: TOPOLOGY,
    LOGIN_BURST: phaseSummary("LOGIN_BURST", logins),
    START_BURST: phaseSummary("START_BURST", starts),
    RECONNECT_RESTORE: phaseSummary("RECONNECT_RESTORE", restores),
    RECONNECT_TAKE: phaseSummary("RECONNECT_TAKE", takes),
    RECONNECT_FIRST_SAVE: phaseSummary("RECONNECT_FIRST_SAVE", firstSaves),
    SUBMIT_BURST: phaseSummary("SUBMIT_BURST", submits),
    submitWallMs,
    loginWallMs,
    oracles: {
      loginSuccess: loginOk,
      submitSuccess: submitOk,
      expectedCandidates: N,
      attemptStatusCounts: statusCounts,
      duplicateActiveAttempts: dupActive,
      duplicateTerminalTransitions: dupTerminal,
      examTiming: timing,
      answersChecked: answerCheck.checked,
      answerMismatches: answerCheck.mismatches,
      pass:
        loginOk === N &&
        submitOk === N &&
        dupActive === 0 &&
        dupTerminal === 0 &&
        answerCheck.mismatches.length === 0 &&
        (statusCounts["graded"] ?? 0) === N,
    },
    steadySeconds: STEADY_S,
    finished_at: new Date().toISOString(),
  };
  writeFileSync(
    join(RESULTS_SUB, "summary.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );
  console.log(
    JSON.stringify(
      {
        run_id: RUN_ID,
        oraclePass: summary.oracles.pass,
        SUBMIT_BURST: summary.SUBMIT_BURST,
        oracles: summary.oracles,
      },
      null,
      2,
    ),
  );

  // ── Teardown ──
  await Promise.all(states.map((s) => s.client.close()));
  await Promise.all(proctors.map((c) => c.close()));
  await admin.close();
  await observer.stop();
  await api.stop();
  await conn.sql.end();
}

/** Steady per-candidate loop: save every ~5s±2s, heartbeat every ~15s±5s. */
async function candidateSteadyLoop(
  s: CandidateState,
  index: number,
  ctl: { stop: () => boolean; deadline: number },
  record: (r: HttpResponse, candidate: string, endpoint: string) => void,
  saveOnce: (s: CandidateState) => Promise<HttpResponse>,
): Promise<void> {
  await sleep((index % 10) * 120); // de-synchronize loop starts
  let nextSave = 0;
  let nextBeat = 0;
  while (!ctl.stop() && performance.now() < ctl.deadline) {
    const now = performance.now();
    if (now >= nextSave) {
      await saveOnce(s);
      nextSave = now + 4000 + Math.random() * 2000;
    }
    if (now >= nextBeat) {
      const r = await s.client.json(
        "POST",
        `/api/attempts/${s.attemptId}/heartbeat`,
      );
      record(r, s.id, "POST /api/attempts/:id/heartbeat");
      nextBeat = now + 12000 + Math.random() * 6000;
    }
    await sleep(50);
  }
}

async function proctorLoop(
  client: Client,
  p: number,
  examId: string,
  states: CandidateState[],
  ctl: {
    stop: () => boolean;
    deadline: number;
    record: (r: HttpResponse, candidate: string, endpoint: string) => void;
  },
): Promise<void> {
  await sleep(p * 1500);
  let nextList = 0;
  let nextEvents = 0;
  while (!ctl.stop() && performance.now() < ctl.deadline) {
    const now = performance.now();
    if (now >= nextList) {
      const r = await client.json(
        "GET",
        `/api/admin/exams/${examId}/proctor/attempts`,
      );
      ctl.record(
        r,
        `proctor-${p}`,
        "GET /api/admin/exams/:examId/proctor/attempts",
      );
      nextList = now + 3000;
    }
    if (now >= nextEvents) {
      const target = states[Math.floor(Math.random() * states.length)];
      if (target.attemptId) {
        const r = await client.json(
          "GET",
          `/api/admin/attempts/${target.attemptId}/proctor-events`,
        );
        ctl.record(
          r,
          `proctor-${p}`,
          "GET /api/admin/attempts/:id/proctor-events",
        );
      }
      nextEvents = now + 10_000;
    }
    await sleep(100);
  }
}

function saveBody(
  attemptId: string,
  questionId: string,
  answer: unknown,
  clientSeq: number,
  baseVersion: number,
): Record<string, unknown> {
  return {
    attemptId,
    questionId,
    answer,
    clientSeq,
    clientSavedAt: new Date().toISOString(),
    baseVersion,
  };
}

function extractQuestionIds(parsed: unknown): string[] {
  const body = parsed as {
    attempt?: { questionIds?: string[] };
    questions?: Array<{ id?: string }>;
    questionSnapshot?: Array<{ originalQuestionId?: string }>;
  };
  if (Array.isArray(body.questionSnapshot)) {
    return body.questionSnapshot
      .map((q) => q.originalQuestionId ?? "")
      .filter((x) => x.length > 0);
  }
  if (Array.isArray(body.questions)) {
    return body.questions.map((q) => q.id ?? "").filter((x) => x.length > 0);
  }
  if (Array.isArray(body.attempt?.questionIds))
    return body.attempt!.questionIds!;
  throw new Error(
    `cannot locate question ids in start response keys=${Object.keys(parsed as object).join(",")}`,
  );
}

function loopbackAddress(i: number, topology: string): string | undefined {
  if (topology !== "DIRECT_LAN") return undefined;
  return `127.0.0.${(i % 250) + 2}`;
}

main().catch(async (err) => {
  console.error(err);
  await stopActiveApi();
  process.exit(1);
});
