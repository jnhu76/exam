/**
 * #550 ADMISSION_CAPACITY_SCENARIO on the live HTTP stack (#549 KEEP_LAZY
 * contract, RESEARCH ONLY).
 *
 * One invocation iterates the full matrix (fresh DB + fresh API per scenario):
 *   N ∈ {20,50,100,130,200} × Δt ∈ {15s, 90s, ceil(N/20)·15s}
 *   batchSize=20, batchInterval=15s, requireQueue=true.
 *
 * Procedure per scenario: login (setup) → concurrent join burst → poll pause
 * until anchor+Δt (real sleep) → resume burst → all-ready start burst →
 * write-once poll round → durable oracles.
 *
 * Δt boundary note: eligibility = (floor(Δt/15)+1)·20 batches is evaluated
 * server-side per poll with the SERVER clock. The resume burst starts just
 * past the Δt boundary (Δt+200ms) and completes well before the next one, so
 * the observed materialization count is deterministic.
 *
 * Run from anywhere in the repo (paths derive from this file's location):
 *   HARNESS=$(git rev-parse --show-toplevel)/docs/research/exam-550-final-capacity-reproof-1/harness
 *   pnpm --filter @exam/db exec tsx "$HARNESS/run-admission.ts" \
 *     [--only=N20-dt15,...]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import {
  ADMISSION_BATCH_INTERVAL_S,
  ADMISSION_BATCH_SIZE,
  API_ORIGIN,
  BASE_SHA,
  CAMPAIGN,
  RESULTS_DIR,
  RUN_DB_URL,
  args,
  headSha,
} from "./lib/config.js";
import {
  admittedCount,
  admissionAnchor,
  attemptStatusCounts,
  countDuplicates,
  freshRunDatabase,
  seedCandidates,
  waitingCount,
} from "./lib/db.js";
import { Client, JsonlWriter, sleep } from "./lib/http.js";
import {
  loginAdmin,
  startApi,
  startObservers,
  stopActiveApi,
  waitReady,
} from "./lib/runtime.js";
import { sampleFrom, summarizePhase } from "./lib/summary.js";

interface Scenario {
  id: string;
  n: number;
  pauseSeconds: number;
}

function scenarios(): Scenario[] {
  const filter = new Set(
    (process.env.SCENARIOS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  const all: Scenario[] = [];
  for (const n of [20, 50, 100, 130, 200]) {
    const batchesForAll = Math.ceil(n / ADMISSION_BATCH_SIZE);
    for (const dt of [15, 90, batchesForAll * ADMISSION_BATCH_INTERVAL_S]) {
      const id = `N${n}-dt${dt}`;
      if (filter.size === 0 || filter.has(id)) {
        all.push({ id, n, pauseSeconds: dt });
      }
    }
  }
  return all;
}

let activeConn: Awaited<ReturnType<typeof freshRunDatabase>> | null = null;

async function runScenario(sc: Scenario): Promise<Record<string, unknown>> {
  const RUN_ID = `admission-${sc.id}-${new Date()
    .toISOString()
    .replace(/[:.]/g, "-")}`;
  const RESULTS_SUB = join(RESULTS_DIR, RUN_ID);
  mkdirSync(RESULTS_SUB, { recursive: true });
  const samples = new JsonlWriter(join(RESULTS_SUB, "samples.jsonl"));

  const conn = await freshRunDatabase();
  activeConn = conn;
  const orgRow = await conn.sql.unsafe(
    `SELECT id::text AS id FROM organizations ORDER BY created_at LIMIT 1`,
  );
  const orgId = orgRow[0].id as string;

  const api = startApi({
    mode: "production",
    dbUrl: RUN_DB_URL,
    runId: RUN_ID,
  });
  await waitReady(api.baseUrl);
  const admin = await loginAdmin(api);

  // Exam with the frozen #549 batch policy via the canonical admin API.
  const course = await admin.json("POST", "/api/courses", {
    name: `550-adm-${sc.id}`,
    code: `550A-${Date.now()}`,
    description: "",
  });
  const courseId = (course.parsed as { id: string }).id;
  const q = await admin.json("POST", "/api/questions", {
    courseId,
    type: "true_false",
    content: "Q0",
    standardAnswer: true,
    score: 10,
  });
  const questionId = (q.parsed as { id: string }).id;
  const exam = await admin.json("POST", "/api/exams", {
    title: `550 admission ${sc.id}`,
    description: "",
    courseId,
    timingMode: "timed_window",
    durationMinutes: 90,
    openAt: new Date(Date.now() - 3600_000).toISOString(),
    closeAt: new Date(Date.now() + 86_400_000).toISOString(),
    passingScore: 6,
    totalScore: 10,
    questionSelectionMode: "manual",
    questionIds: [questionId],
    resultPublicationMode: "immediate",
    controlFlags: {
      shuffleQuestions: false,
      shuffleOptions: false,
      detectTabSwitch: false,
      disableCopyPaste: false,
      requireQueue: true,
      batchSize: ADMISSION_BATCH_SIZE,
      batchInterval: ADMISSION_BATCH_INTERVAL_S,
      showResultImmediately: true,
    },
    retakePolicy: "unlimited",
    scoreStrategy: "highest",
    maxAttempts: 1,
    interruptionTimePolicy: "strict",
  });
  if (exam.status !== 201)
    throw new Error(`exam: ${exam.status} ${exam.body.slice(0, 300)}`);
  const examId = (exam.parsed as { id: string }).id;
  const pub = await admin.json("POST", `/api/exams/${examId}/publish`, {});
  if (pub.status !== 200) throw new Error(`publish: ${pub.status}`);

  const seeded = await seedCandidates(conn, {
    orgId,
    examId,
    count: sc.n,
    prefix: `adm${sc.n}`,
  });

  writeFileSync(
    join(RESULTS_SUB, "meta.json"),
    JSON.stringify(
      {
        run_id: RUN_ID,
        group: "admission",
        campaign: CAMPAIGN,
        head_sha: headSha(),
        base_sha: BASE_SHA,
        scenario: sc.id,
        n: sc.n,
        pause_seconds: sc.pauseSeconds,
        batch_size: ADMISSION_BATCH_SIZE,
        batch_interval_s: ADMISSION_BATCH_INTERVAL_S,
        topology: "DIRECT_LAN (distinct loopback source IP per candidate)",
        api_mode:
          "production (limiter ON, default budgets; Redis-backed store — the accepted #554 topology)",
        db_pool_max: 10,
        redis_mode: "optional (rate-limit coordination only — #554)",
        exam_id: examId,
        started_at: new Date().toISOString(),
      },
      null,
      2,
    ) + "\n",
  );

  const observer = await startObservers({
    runId: RUN_ID,
    resultsDir: RESULTS_SUB,
    runDbName: "exam_550_e2e",
    samplerDbUrl: RUN_DB_URL,
    api,
    adminClient: admin,
  });

  const base = {
    scenario_id: sc.id,
    run_id: RUN_ID,
    topology: "DIRECT_LAN",
    n: sc.n,
  };
  let phase = "setup";
  const record = (
    r: Awaited<ReturnType<Client["json"]>>,
    candidate: string,
    endpoint: string,
  ): void => {
    samples.write(
      sampleFrom(r, { ...base, candidate, endpoint, phase, retry_count: 0 }),
    );
  };

  // Setup: login everyone. Production limiter is ON, so every candidate binds
  // a DISTINCT loopback source IP (DIRECT_LAN identity) — one login per
  // per-IP budget, no artificial headroom, nothing weakened. Setup logins are
  // not part of the admission metrics (recorded for completeness).
  const clients = seeded.usernames.map(
    (u, i) =>
      new Client({
        baseUrl: api.baseUrl,
        id: `c${i}`,
        localAddress: `127.0.0.${(i % 250) + 2}`,
        origin: API_ORIGIN,
      }),
  );
  const logins = await Promise.all(
    clients.map((c, i) => c.login(seeded.usernames[i], "pass-550-cap")),
  );
  logins.forEach((r, i) => record(r, clients[i].id, "POST /api/auth/login"));
  const loginOk = logins.filter((r) => r.status === 200).length;
  if (loginOk !== sc.n)
    throw new Error(`login burst incomplete: ${loginOk}/${sc.n}`);

  // Phase 1 — join burst (single anchor: all joins land within a few ms).
  phase = "QUEUE_JOIN";
  observer.markPhase("QUEUE_JOIN");
  const tJoin = performance.now();
  const joins = await Promise.all(
    clients.map((c) => c.json("POST", `/api/attempts/${examId}/queue`)),
  );
  joins.forEach((r, i) =>
    record(r, clients[i].id, "POST /api/attempts/:examId/queue"),
  );
  const joinWallMs = Math.round(performance.now() - tJoin);

  // Anchor from durable authority.
  const anchor = await admissionAnchor(conn, examId);
  if (!anchor) throw new Error("no admission anchor");
  const admittedBefore = await admittedCount(conn, examId);

  // Phase 2 — poll pause: real sleep until just past anchor+Δt.
  phase = "POLL_PAUSE";
  observer.markPhase("POLL_PAUSE");
  const resumeAt = anchor.getTime() + sc.pauseSeconds * 1000 + 200;
  const nowMs = Date.now();
  if (resumeAt > nowMs) await sleep(resumeAt - nowMs);

  // Phase 3 — resume burst.
  phase = "QUEUE_RESUME";
  observer.markPhase("QUEUE_RESUME");
  const resumeInstant = Date.now();
  const tResume = performance.now();
  const resumes = await Promise.all(
    clients.map((c) => c.json("POST", `/api/attempts/${examId}/queue`)),
  );
  resumes.forEach((r, i) =>
    record(r, clients[i].id, "POST /api/attempts/:examId/queue"),
  );
  const resumeWallMs = Math.round(performance.now() - tResume);
  const readyByView = resumes.filter(
    (r) => (r.parsed as { status?: string })?.status === "ready",
  ).length;
  const admittedAfterResume = await admittedCount(conn, examId);

  // Phase 4 — start burst for everyone (unqualified must fail closed 409).
  phase = "START_BURST";
  observer.markPhase("START_BURST");
  const tStart = performance.now();
  const starts = await Promise.all(
    clients.map((c) => c.json("POST", `/api/attempts/${examId}/start`)),
  );
  starts.forEach((r, i) =>
    record(r, clients[i].id, "POST /api/attempts/:examId/start"),
  );
  const startWallMs = Math.round(performance.now() - tStart);
  const startOk = starts.filter(
    (r) => r.status === 201 || r.status === 200,
  ).length;
  const startFailClosed = starts.filter((r) => r.status === 409).length;

  // Phase 5 — write-once poll round (CAS must not re-materialize anything).
  phase = "WRITEONCE_POLL";
  observer.markPhase("WRITEONCE_POLL");
  const extraPolls = await Promise.all(
    clients.map((c) => c.json("POST", `/api/attempts/${examId}/queue`)),
  );
  extraPolls.forEach((r, i) =>
    record(r, clients[i].id, "POST /api/attempts/:examId/queue"),
  );
  const admittedAfterExtra = await admittedCount(conn, examId);

  // Oracles from durable authority.
  const statusCounts = await attemptStatusCounts(conn, examId);
  const dupActive = await countDuplicates(conn, examId);
  const waiting = await waitingCount(conn, examId);

  // Expected eligible at the resume instant (server-clock predicate, evaluated
  // at the pause target the resume burst starts just past).
  const releasedBatches =
    Math.floor(sc.pauseSeconds / ADMISSION_BATCH_INTERVAL_S) + 1;
  const expectedEligible = Math.min(
    sc.n,
    releasedBatches * ADMISSION_BATCH_SIZE,
  );

  const summary = {
    run_id: RUN_ID,
    scenario: sc.id,
    n: sc.n,
    pauseSeconds: sc.pauseSeconds,
    batchSize: ADMISSION_BATCH_SIZE,
    batchIntervalS: ADMISSION_BATCH_INTERVAL_S,
    QUEUE_JOIN: summarizePhase("QUEUE_JOIN", joins, tJoin),
    QUEUE_RESUME: summarizePhase("QUEUE_RESUME", resumes, tResume),
    START_BURST: summarizePhase("START_BURST", starts, tStart),
    joinWallMs,
    resumeWallMs,
    startWallMs,
    oracle: {
      expectedEligibleAtResume: expectedEligible,
      readyByView,
      admittedBefore,
      admittedAfterResume,
      admittedAfterExtraPolls: admittedAfterExtra,
      waitingAfterRun: waiting,
      startOk,
      startFailClosed,
      duplicateActiveAttempts: dupActive,
      attemptStatusCounts: statusCounts,
      resumeDtxSec: Math.round((resumeInstant - anchor.getTime()) / 100) / 10,
      // admitted must equal expected; preview.ready must agree; extra polls
      // must not write; everyone admitted must have started; nobody else may
      // have started.
      pass:
        admittedAfterResume === expectedEligible &&
        readyByView === expectedEligible &&
        admittedAfterExtra === admittedAfterResume &&
        startOk === expectedEligible &&
        dupActive === 0 &&
        (statusCounts["in_progress"] ?? 0) === expectedEligible,
    },
    finished_at: new Date().toISOString(),
  };
  writeFileSync(
    join(RESULTS_SUB, "summary.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );
  await samples.flush();
  console.log(
    JSON.stringify({
      scenario: sc.id,
      oraclePass: summary.oracle.pass,
      resumeWallMs,
      startWallMs,
      admitted: admittedAfterResume,
      expected: expectedEligible,
    }),
  );

  await Promise.all(clients.map((c) => c.close()));
  await admin.close();
  await observer.stop();
  await api.stop();
  await conn.sql.end();
  return summary;
}

async function main(): Promise<void> {
  const cfg = args();
  if (cfg.only) process.env.SCENARIOS = cfg.only;
  const list = scenarios();
  const results: Record<string, unknown>[] = [];
  for (const sc of list) {
    try {
      results.push(await runScenario(sc));
    } catch (err) {
      console.error(`scenario ${sc.id} FAILED`, err);
      await stopActiveApi();
      await activeConn?.sql.end().catch(() => undefined);
      activeConn = null;
      results.push({ scenario: sc.id, error: String(err) });
    }
  }
  mkdirSync(RESULTS_DIR, { recursive: true });
  const outFile = join(
    RESULTS_DIR,
    `admission-matrix-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  );
  writeFileSync(outFile, JSON.stringify(results, null, 2) + "\n");
  console.log(`\nWrote ${results.length} scenario results → ${outFile}`);
}

main().catch(async (err) => {
  console.error(err);
  await stopActiveApi();
  process.exit(1);
});
