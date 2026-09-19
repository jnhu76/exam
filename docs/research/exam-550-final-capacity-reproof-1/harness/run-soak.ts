/**
 * #550 long-run pool observation — bounded soak crossing at least one
 * postgres.js connection-lifetime rotation window (default max_lifetime =
 * 60·(30+rand·30) s = 30–90 min per connection; #554 E12). S50 steady load
 * (save+heartbeat) with pool snapshot sampling; rotation events are read
 * from pg_stat_activity backend_start churn + the research snapshot's
 * in-process pool facts.
 *
 * Run from anywhere in the repo (paths derive from this file's location):
 *   HARNESS=$(git rev-parse --show-toplevel)/docs/research/exam-550-final-capacity-reproof-1/harness
 *   pnpm --filter @exam/db exec tsx "$HARNESS/run-soak.ts" \
 *     [--minutes=95] [--n=50]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import {
  API_ORIGIN,
  BASE_SHA,
  RESULTS_DIR,
  RUN_DB_URL,
  args,
} from "./lib/config.js";
import { freshRunDatabase, seedCandidates } from "./lib/db.js";
import { Client, JsonlWriter, sleep } from "./lib/http.js";
import {
  loginAdmin,
  startApi,
  startObservers,
  stopActiveApi,
  waitReady,
} from "./lib/runtime.js";
import { sampleFrom } from "./lib/summary.js";

const cfg = args();
const N = Number(cfg.n ?? 50);
const MINUTES = Number(cfg.minutes ?? 95);
const RUN_ID = `soak-S${N}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const RESULTS_SUB = join(RESULTS_DIR, RUN_ID);

/** Rotation watch: sample backend PIDs + backend_start from pg_stat_activity. */
async function watchConnections(
  samplerDbUrl: string,
  dbName: string,
  poolPath: string,
  isStopped: () => boolean,
): Promise<void> {
  const { createDatabase } =
    await import("../../../../packages/db/src/database.js");
  const sampler = await createDatabase(samplerDbUrl);
  while (!isStopped()) {
    try {
      const rows = await sampler.sql.unsafe(
        `SELECT pid, backend_start, state
         FROM pg_stat_activity
         WHERE datname = $1 AND pid <> pg_backend_pid()
         ORDER BY pid`,
        [dbName],
      );
      const { appendFileSync } = await import("node:fs");
      appendFileSync(
        poolPath,
        JSON.stringify({
          ts: new Date().toISOString(),
          source: "connections",
          connections: rows.map((r) => ({
            pid: r.pid,
            backendStart: r.backend_start,
            state: r.state,
          })),
        }) + "\n",
      );
    } catch {
      /* sampling must never break the soak */
    }
    await sleep(10_000);
  }
  await sampler.sql.end();
}

async function main(): Promise<void> {
  mkdirSync(RESULTS_SUB, { recursive: true });
  const samples = new JsonlWriter(join(RESULTS_SUB, "samples.jsonl"));
  const conn = await freshRunDatabase();
  const orgRow = await conn.sql.unsafe(
    `SELECT id::text AS id FROM organizations ORDER BY created_at LIMIT 1`,
  );
  const orgId = orgRow[0].id as string;

  const api = startApi({ mode: "e2e", dbUrl: RUN_DB_URL, runId: RUN_ID });
  await waitReady(api.baseUrl);
  const admin = await loginAdmin(api);

  const course = await admin.json("POST", "/api/courses", {
    name: `550-soak`,
    code: `550SOAK-${Date.now()}`,
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
    title: `550 soak S${N}`,
    description: "",
    courseId,
    timingMode: "timed_window",
    durationMinutes: 180,
    openAt: new Date(Date.now() - 3600_000).toISOString(),
    closeAt: new Date(Date.now() + 86_400_000).toISOString(),
    passingScore: 6,
    totalScore: 10,
    questionSelectionMode: "manual",
    questionIds: [questionId],
    resultPublicationMode: "immediate",
    controlFlags: { requireQueue: false },
    retakePolicy: "unlimited",
    scoreStrategy: "highest",
    maxAttempts: 1,
    interruptionTimePolicy: "strict",
  });
  const examId = (exam.parsed as { id: string }).id;
  await admin.json("POST", `/api/exams/${examId}/publish`, {});
  const seeded = await seedCandidates(conn, {
    orgId,
    examId,
    count: N,
    prefix: `soak${N}`,
  });

  writeFileSync(
    join(RESULTS_SUB, "meta.json"),
    JSON.stringify(
      {
        run_id: RUN_ID,
        group: "soak",
        n: N,
        minutes: MINUTES,
        base_sha: BASE_SHA,
        pool: "postgres.js default max=10; max_lifetime default 30–90 min randomized",
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

  // Rotation watcher appends to pool.jsonl (10s cadence).
  let connWatchStopped = false;
  void watchConnections(
    RUN_DB_URL,
    "exam_550_e2e",
    observer.poolJsonlPath,
    () => connWatchStopped,
  );

  const base = {
    scenario_id: "soak",
    run_id: RUN_ID,
    topology: "DIRECT_LAN",
    n: N,
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

  const clients = seeded.usernames.map(
    (u, i) =>
      new Client({ baseUrl: api.baseUrl, id: `c${i}`, origin: API_ORIGIN }),
  );
  const logins = await Promise.all(
    clients.map((c, i) => c.login(seeded.usernames[i], "pass-550-cap")),
  );
  logins.forEach((r, i) => record(r, clients[i].id, "POST /api/auth/login"));
  phase = "START";
  const starts = await Promise.all(
    clients.map((c) => c.json("POST", `/api/attempts/${examId}/start`)),
  );
  starts.forEach((r, i) =>
    record(r, clients[i].id, "POST /api/attempts/:examId/start"),
  );
  const attemptIds = starts.map((r) =>
    r.status === 201 || r.status === 200
      ? (r.parsed as { id: string }).id
      : null,
  );

  phase = "SOAK";
  observer.markPhase("SOAK");
  const deadline = performance.now() + MINUTES * 60_000;
  let stop = false;
  const versions = new Map<string, number>();
  const seqs = clients.map(() => 0);
  const loops = clients.map(async (c, i) => {
    await sleep((i % 10) * 120);
    let nextSave = 0;
    let nextBeat = 0;
    while (!stop && performance.now() < deadline) {
      const now = performance.now();
      const attemptId = attemptIds[i];
      if (!attemptId) return;
      if (now >= nextSave) {
        seqs[i] += 1;
        const r = await c.json(
          "POST",
          `/api/attempts/${attemptId}/answers/${questionId}`,
          {
            attemptId,
            questionId,
            answer: seqs[i] % 2 === 0,
            clientSeq: seqs[i],
            clientSavedAt: new Date().toISOString(),
            baseVersion: versions.get(attemptId) ?? 0,
          },
        );
        const body = (r.parsed ?? {}) as {
          accepted?: boolean;
          serverVersion?: number;
        };
        if (body.accepted === true)
          versions.set(attemptId, body.serverVersion ?? 0);
        record(r, c.id, "POST /api/attempts/:id/answers/:qid");
        nextSave = now + 8000 + Math.random() * 4000;
      }
      if (now >= nextBeat) {
        const r = await c.json("POST", `/api/attempts/${attemptId}/heartbeat`);
        record(r, c.id, "POST /api/attempts/:id/heartbeat");
        nextBeat = now + 25_000 + Math.random() * 10_000;
      }
      await sleep(100);
    }
  });
  await sleep(MINUTES * 60_000);
  stop = true;
  await Promise.allSettled(loops);
  connWatchStopped = true;

  await samples.flush();
  writeFileSync(
    join(RESULTS_SUB, "summary.json"),
    JSON.stringify(
      {
        run_id: RUN_ID,
        minutes: MINUTES,
        n: N,
        finished_at: new Date().toISOString(),
      },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify({ runId: RUN_ID, done: true }));

  await Promise.all(clients.map((c) => c.close()));
  await admin.close();
  await observer.stop();
  await api.stop();
  await conn.sql.end();
}

main().catch(async (err) => {
  console.error(err);
  await stopActiveApi();
  process.exit(1);
});
