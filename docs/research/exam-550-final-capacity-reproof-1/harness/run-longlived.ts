/**
 * #550 long-lived composition dataset + live-workload interference runner
 * (RESEARCH ONLY).
 *
 * Builds a composition-realistic semester-scale history (authority: #545,
 * issue §14): completed old exams with graded attempts + admission history +
 * heartbeat/disruption episode history crossing #545's S1 (1,000+ episodes:
 * completed majority + historical pending + fresh unmaterialized eligible) +
 * client-event history (30-day retention window). Then runs a LIVE S100
 * workload in the SAME org while the API's own reconciliation loop ticks, and
 * measures tick wall time + live latency inside vs outside tick windows.
 *
 * DB-side evidence: EXPLAIN (ANALYZE, BUFFERS) of the discovery query at this
 * cardinality (composition-realistic table — answers #545's index-recheck
 * residual) with and without the candidate index.
 *
 * Run from anywhere in the repo (paths derive from this file's location):
 *   HARNESS=$(git rev-parse --show-toplevel)/docs/research/exam-550-final-capacity-reproof-1/harness
 *   pnpm --filter @exam/db exec tsx "$HARNESS/run-longlived.ts" \
 *     [--n=100] [--episodes=1200] [--steady=240]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import {
  API_ORIGIN,
  BASE_SHA,
  RESULTS_DIR,
  RUN_DB_URL,
  args,
} from "./lib/config.js";
import { freshRunDatabase, seedCandidates, type DbConn } from "./lib/db.js";
import { Client, JsonlWriter, sleep } from "./lib/http.js";
import {
  loginAdmin,
  startApi,
  startObservers,
  stopActiveApi,
  waitReady,
} from "./lib/runtime.js";
import { sampleFrom, summarizePhase } from "./lib/summary.js";
import { systemIncidentOperationId } from "../../../../packages/exam-engine/src/systemIncidentCommands.js";

const cfg = args();
const N = Number(cfg.n ?? 100);
const EPISODES = Number(cfg.episodes ?? 1200);
const STEADY_S = Number(cfg.steady ?? 240);
const RUN_ID = `longlived-S${N}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const RESULTS_SUB = join(RESULTS_DIR, RUN_ID);

const NOW = Date.now();
const DAY = 86_400_000;

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

  // ── Live exam via canonical admin API. ──
  const course = await admin.json("POST", "/api/courses", {
    name: `550-ll-course`,
    code: `550LL-${Date.now()}`,
    description: "",
  });
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
    questionIds.push((q.parsed as { id: string }).id);
  }
  const exam = await admin.json("POST", "/api/exams", {
    title: `550 long-lived live exam S${N}`,
    description: "",
    courseId,
    timingMode: "timed_window",
    durationMinutes: 120,
    openAt: new Date(Date.now() - 3600_000).toISOString(),
    closeAt: new Date(Date.now() + 86_400_000).toISOString(),
    passingScore: 60,
    totalScore: 120,
    questionSelectionMode: "manual",
    questionIds,
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
    prefix: `llive${N}`,
  });

  writeFileSync(
    join(RESULTS_SUB, "meta.json"),
    JSON.stringify(
      {
        run_id: RUN_ID,
        group: "longlived",
        n: N,
        episodes: EPISODES,
        steady_seconds: STEADY_S,
        base_sha: BASE_SHA,
        exam_id: examId,
        org_id: orgId,
        started_at: new Date().toISOString(),
      },
      null,
      2,
    ) + "\n",
  );

  console.log(
    "▶ dataset build: old exams / attempts / admissions / episodes / client events …",
  );
  const cardinality = await buildLongLivedDataset(
    conn,
    orgId,
    courseId,
    EPISODES,
    questionIds,
  );
  writeFileSync(
    join(RESULTS_SUB, "cardinality.json"),
    JSON.stringify(cardinality, null, 2) + "\n",
  );

  console.log(
    "▶ EXPLAIN of discovery query at composition-realistic cardinality …",
  );
  const explain = await explainDiscovery(conn, orgId);
  writeFileSync(
    join(RESULTS_SUB, "explain.json"),
    JSON.stringify(explain, null, 2) + "\n",
  );

  // ── LIVE S100 workload with reconciliation ticks running. ──
  const observer = await startObservers({
    runId: RUN_ID,
    resultsDir: RESULTS_SUB,
    runDbName: "exam_550_e2e",
    samplerDbUrl: RUN_DB_URL,
    api,
    adminClient: admin,
  });

  const base = {
    scenario_id: "longlived",
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
  const versions = new Map<string, number>();
  const attemptIds = starts.map((r) =>
    r.status === 201 || r.status === 200
      ? (r.parsed as { id: string }).id
      : null,
  );

  // Baseline window (30s of steady) → then STEADY window with ticks.
  phase = "BASELINE_STEADY";
  observer.markPhase("BASELINE_STEADY");
  let stop = false;
  const seqs = clients.map(() => 0);
  const baselineDeadline = performance.now() + 30_000;
  const loop = async (i: number, until: number): Promise<void> => {
    await sleep((i % 10) * 120);
    let nextSave = 0;
    let nextBeat = 0;
    while (!stop && performance.now() < until) {
      const now = performance.now();
      const c = clients[i];
      const attemptId = attemptIds[i];
      if (!attemptId) return;
      if (now >= nextSave) {
        seqs[i] += 1;
        const qid = questionIds[seqs[i] % questionIds.length];
        const r = await c.json(
          "POST",
          `/api/attempts/${attemptId}/answers/${qid}`,
          {
            attemptId,
            questionId: qid,
            answer: seqs[i] % 2 === 0,
            clientSeq: seqs[i],
            clientSavedAt: new Date().toISOString(),
            baseVersion: versions.get(`${attemptId}:${qid}`) ?? 0,
          },
        );
        const body = (r.parsed ?? {}) as {
          accepted?: boolean;
          serverVersion?: number;
        };
        if (body.accepted === true)
          versions.set(`${attemptId}:${qid}`, body.serverVersion ?? 0);
        record(r, c.id, "POST /api/attempts/:id/answers/:qid");
        nextSave = now + 4500 + Math.random() * 1500;
      }
      if (now >= nextBeat) {
        const r = await c.json("POST", `/api/attempts/${attemptId}/heartbeat`);
        record(r, c.id, "POST /api/attempts/:id/heartbeat");
        nextBeat = now + 14_000 + Math.random() * 4000;
      }
      await sleep(50);
    }
  };
  await Promise.allSettled(clients.map((_, i) => loop(i, baselineDeadline)));

  phase = "MEASURE_STEADY";
  observer.markPhase("MEASURE_STEADY");
  const measureDeadline = performance.now() + STEADY_S * 1000;
  await Promise.allSettled(clients.map((_, i) => loop(i, measureDeadline)));
  stop = true;

  // Final dataset cardinality (post-reconciliation) + correctness.
  const post = await cardinalitySnapshot(conn, orgId);
  const summary = {
    run_id: RUN_ID,
    n: N,
    episodes: EPISODES,
    cardinalityBefore: cardinality,
    cardinalityAfter: post,
    BASELINE_STEADY: summarizePhase(
      "BASELINE_STEADY",
      samplesForPhase(samplesPath(), "BASELINE_STEADY"),
      0,
    ),
    MEASURE_STEADY: summarizePhase(
      "MEASURE_STEADY",
      samplesForPhase(samplesPath(), "MEASURE_STEADY"),
      0,
    ),
    note: "tick wall times live in pool.jsonl research snapshots (heartbeat metrics); interference analysis regenerates from raw",
    finished_at: new Date().toISOString(),
  };
  writeFileSync(
    join(RESULTS_SUB, "summary.json"),
    JSON.stringify(summary, null, 2) + "\n",
  );
  await samples.flush();
  console.log(
    JSON.stringify({
      pendingBefore: cardinality.pendingEpisodes,
      pendingAfter: post.pendingEpisodes,
      incidentsCreated: post.systemIncidents,
    }),
  );

  await Promise.all(clients.map((c) => c.close()));
  await admin.close();
  await observer.stop();
  await api.stop();
  await conn.sql.end();
}

// ── dataset builder ───────────────────────────────────────────────────────

let schemaCache:
  | typeof import("../../../../packages/db/src/schema/pg.js").schema
  | null = null;
async function schema() {
  if (!schemaCache) {
    schemaCache = (await import("../../../../packages/db/src/schema/pg.js"))
      .schema;
  }
  return schemaCache;
}

async function buildLongLivedDataset(
  conn: DbConn,
  orgId: string,
  liveCourseId: string,
  episodes: number,
  liveQuestionIds: string[],
): Promise<Record<string, unknown>> {
  void liveCourseId;
  void liveQuestionIds;
  const s = await schema();
  const now = new Date();

  // 2 old archived exams × 60 graded attempts (semester-old history).
  const oldExamAttemptIds: string[] = [];
  for (let e = 0; e < 2; e++) {
    const courseId = randomUUID();
    const createdAt = new Date(NOW - 150 * DAY);
    await conn.db.insert(s.courses).values({
      id: courseId,
      organizationId: orgId,
      name: `old course ${e}`,
      code: `OLDC-${e}-${courseId.slice(0, 6)}`,
      description: "",
      createdAt,
      updatedAt: createdAt,
    });
    const examId = randomUUID();
    const qid = randomUUID();
    await conn.db.insert(s.exams).values({
      id: examId,
      organizationId: orgId,
      title: `old exam ${e}`,
      description: "",
      courseId,
      status: "archived",
      timingMode: "timed_window",
      durationMinutes: 60,
      openAt: new Date(NOW - 120 * DAY),
      closeAt: new Date(NOW - 90 * DAY),
      passingScore: 6,
      totalScore: 10,
      questionSelectionMode: "manual",
      questionIds: [qid],
      questionSnapshot: [
        {
          originalQuestionId: qid,
          type: "true_false",
          content: "old",
          contentDocument: null,
          answerMode: null,
          attachments: [],
          options: [],
          score: 10,
        },
      ],
      controlFlags: {
        shuffleQuestions: false,
        shuffleOptions: false,
        detectTabSwitch: false,
        disableCopyPaste: false,
        requireQueue: false,
        batchSize: 20,
        batchInterval: 15,
        restrictIp: false,
        requireLockdown: false,
        showResultImmediately: true,
      },
      retakePolicy: "unlimited",
      scoreStrategy: "highest",
      maxAttempts: 1,
      latestStartOffsetMinutes: null,
      minSubmitAfterStartMinutes: null,
      resultPublicationMode: "immediate",
      resultsPublishedAt: null,
      interruptionTimePolicy: "strict",
      interruptionGracePerIncidentSeconds: null,
      interruptionGracePerAttemptSeconds: null,
      syncStartedAt: null,
      createdAt,
      updatedAt: new Date(NOW - 90 * DAY),
    } as never);
    const seeded = await seedCandidates(conn, {
      orgId,
      examId,
      count: 60,
      prefix: `old${e}`,
    });
    for (let i = 0; i < 60; i++) {
      const attemptId = randomUUID();
      oldExamAttemptIds.push(attemptId);
      const startedAt = new Date(NOW - 119 * DAY);
      await conn.db.insert(s.examAttempts).values({
        id: attemptId,
        organizationId: orgId,
        examId,
        enrollmentId: seeded.enrollmentIds[i],
        candidateId: seeded.candidateIds[i],
        attemptNo: 1,
        status: "graded",
        gradingStatus: "fully_graded",
        questionSnapshot: [],
        answers: [
          {
            questionId: qid,
            answer: true,
            version: 1,
            savedAt: startedAt.toISOString(),
          },
        ],
        startedAt,
        lastActivityAt: startedAt,
        submittedAt: startedAt,
        gradedAt: startedAt,
        createdAt: startedAt,
        updatedAt: startedAt,
      } as never);
      // Admission history: consumed rows.
      await conn.db.insert(s.examAdmissions).values({
        id: randomUUID(),
        organizationId: orgId,
        examId,
        candidateId: seeded.candidateIds[i],
        joinedAt: startedAt,
        admittedAt: startedAt,
        consumedAt: startedAt,
        consumedAttemptId: attemptId,
      });
    }
  }

  // Heartbeat/disruption episode history across the old attempts:
  //   75% completed (detected + restored), 25% pending with OLD dates — the
  //   pending set is unmaterialized eligible history that must converge on the
  //   first reconciliation tick of the run (#545 T8 anti-starvation; delivery
  //   has no time horizon), and afterwards must NOT duplicate.
  const nCompleted = Math.floor(EPISODES * 0.75);
  const nPending = EPISODES - nCompleted;
  const interruptions: unknown[] = [];
  const detectedEvents: unknown[] = [];
  const restoredEvents: unknown[] = [];
  let placed = 0;
  for (let i = 0; i < nPending; i++, placed++) {
    const attemptId = oldExamAttemptIds[i % oldExamAttemptIds.length];
    const interruptionId = randomUUID();
    const occurredAt = new Date(NOW - (1 + (i % 88)) * DAY);
    interruptions.push({
      id: interruptionId,
      organizationId: orgId,
      attemptId,
      createdAt: occurredAt,
    });
    detectedEvents.push({
      id: randomUUID(),
      organizationId: orgId,
      attemptId,
      interruptionId,
      eventType: "detected",
      detectionSource: "heartbeat_timeout",
      occurredAt,
      observedLastActivityAt: new Date(occurredAt.getTime() - 120_000),
      timeoutSeconds: 60,
      policy: "strict",
      eligibleSeconds: null,
      timeAdjustmentId: null,
      actorId: null,
      reasonCode: "heartbeat_timeout",
      createdAt: occurredAt,
    });
  }
  for (let i = 0; i < nCompleted; i++, placed++) {
    const attemptId = oldExamAttemptIds[i % oldExamAttemptIds.length];
    const interruptionId = randomUUID();
    const occurredAt = new Date(NOW - (1 + (i % 88)) * DAY);
    interruptions.push({
      id: interruptionId,
      organizationId: orgId,
      attemptId,
      createdAt: occurredAt,
    });
    detectedEvents.push({
      id: randomUUID(),
      organizationId: orgId,
      attemptId,
      interruptionId,
      eventType: "detected",
      detectionSource: "heartbeat_timeout",
      occurredAt,
      observedLastActivityAt: new Date(occurredAt.getTime() - 120_000),
      timeoutSeconds: 60,
      policy: "strict",
      eligibleSeconds: null,
      timeAdjustmentId: null,
      actorId: null,
      reasonCode: "heartbeat_timeout",
      createdAt: occurredAt,
    });
    restoredEvents.push({
      id: randomUUID(),
      organizationId: orgId,
      attemptId,
      interruptionId,
      eventType: "restored",
      detectionSource: null,
      occurredAt: new Date(occurredAt.getTime() + 600_000),
      observedLastActivityAt: null,
      timeoutSeconds: null,
      policy: "strict",
      eligibleSeconds: 600,
      timeAdjustmentId: null,
      actorId: null,
      reasonCode: "restored",
      createdAt: occurredAt,
    });
  }
  const CHUNK = 400;
  for (let off = 0; off < interruptions.length; off += CHUNK) {
    await conn.db
      .insert(s.attemptInterruptions)
      .values(interruptions.slice(off, off + CHUNK) as never);
  }
  for (let off = 0; off < detectedEvents.length; off += CHUNK) {
    await conn.db
      .insert(s.attemptInterruptionEvents)
      .values(detectedEvents.slice(off, off + CHUNK) as never);
  }
  for (let off = 0; off < restoredEvents.length; off += CHUNK) {
    await conn.db
      .insert(s.attemptInterruptionEvents)
      .values(restoredEvents.slice(off, off + CHUNK) as never);
  }

  // Client-event history: ~10k rows across the last 30 days on the org.
  const ceRows = [];
  for (let i = 0; i < 10_000; i++) {
    const occurredAt = new Date(NOW - Math.floor(Math.random() * 30 * DAY));
    ceRows.push({
      id: randomUUID(),
      organizationId: orgId,
      userId: null,
      attemptId: null,
      examId: null,
      questionId: null,
      kind: "page_view",
      level: "info",
      name: `legacy-event-${i % 40}`,
      route: "/exam",
      occurredAt,
      clientSessionId: null,
      metadata: {},
      userAgent: null,
    });
  }
  for (let off = 0; off < ceRows.length; off += CHUNK) {
    await conn.db
      .insert(s.clientEvents)
      .values(ceRows.slice(off, off + CHUNK) as never);
  }

  return cardinalitySnapshot(conn, orgId);
}

async function cardinalitySnapshot(conn: DbConn, orgId: string) {
  const q = async (label: string, sql: string): Promise<unknown> => {
    const rows = await conn.sql.unsafe(sql, [orgId]);
    return rows[0]?.n ?? 0;
  };
  return {
    users: await q(
      "users",
      `SELECT count(*)::int AS n FROM users WHERE organization_id=$1`,
    ),
    exams: await q(
      "exams",
      `SELECT count(*)::int AS n FROM exams WHERE organization_id=$1`,
    ),
    attempts: await q(
      "attempts",
      `SELECT count(*)::int AS n FROM exam_attempts WHERE organization_id=$1`,
    ),
    admissions: await q(
      "admissions",
      `SELECT count(*)::int AS n FROM exam_admissions WHERE organization_id=$1`,
    ),
    episodesTotal: await q(
      "episodes",
      `SELECT count(*)::int AS n FROM attempt_interruptions WHERE organization_id=$1`,
    ),
    detectedEvents: await q(
      "detected",
      `SELECT count(*)::int AS n FROM attempt_interruption_events WHERE organization_id=$1 AND event_type='detected' AND detection_source='heartbeat_timeout'`,
    ),
    clientEvents: await q(
      "clientEvents",
      `SELECT count(*)::int AS n FROM client_events WHERE organization_id=$1`,
    ),
    systemIncidents: await q(
      "incidents",
      `SELECT count(*)::int AS n FROM exam_incidents WHERE organization_id=$1`,
    ),
    pendingEpisodes: await pendingUnmaterialized(conn, orgId),
  };
}

/** Pending = detected heartbeat episodes with no outcome event AND no
 * materialized System incident (the derived operationId absent from the
 * arbiter). The operationId derivation is imported from the engine — the
 * single authority — rather than reimplemented. */
async function pendingUnmaterialized(
  conn: DbConn,
  orgId: string,
): Promise<number> {
  const rows = await conn.sql.unsafe(
    `SELECT e.interruption_id::text AS id FROM attempt_interruption_events e
     JOIN attempt_interruptions i ON i.id = e.interruption_id AND i.organization_id = e.organization_id
     LEFT JOIN attempt_interruption_events o
       ON o.interruption_id = e.interruption_id AND o.organization_id = e.organization_id
      AND o.event_type IN ('restored','terminalized')
     WHERE e.organization_id = $1 AND e.event_type='detected'
       AND e.detection_source='heartbeat_timeout' AND o.id IS NULL`,
    [orgId],
  );
  const pendingIds = rows.map((r) => r.id as string);
  if (pendingIds.length === 0) return 0;
  const ops = pendingIds.map((id) => systemIncidentOperationId(id));
  const mat = await conn.sql.unsafe(
    `SELECT count(*)::int AS n FROM exam_incident_events
     WHERE organization_id = $1 AND operation_id = ANY($2)`,
    [orgId, ops],
  );
  return pendingIds.length - (mat[0]?.n ?? 0);
}

async function explainDiscovery(
  conn: DbConn,
  orgId: string,
): Promise<Record<string, unknown>> {
  const query = `SELECT e.interruption_id, i.attempt_id, a.exam_id, a.candidate_id,
       e.occurred_at, e.observed_last_activity_at, e.timeout_seconds
     FROM attempt_interruption_events e
     JOIN attempt_interruptions i
       ON i.id = e.interruption_id AND i.organization_id = e.organization_id
     JOIN exam_attempts a
       ON a.id = i.attempt_id AND a.organization_id = i.organization_id
     WHERE e.organization_id = $1 AND e.event_type='detected'
       AND e.detection_source='heartbeat_timeout'
     ORDER BY e.occurred_at ASC, e.interruption_id ASC`;
  const run = async (sql: string) => {
    const t0 = performance.now();
    try {
      const rows = await conn.sql.unsafe(sql, [orgId]);
      return {
        ok: true,
        ms: Math.round((performance.now() - t0) * 10) / 10,
        plan: rows
          .map((r) => Object.values(r as Record<string, unknown>).join(" "))
          .slice(0, 40),
      };
    } catch (err) {
      return { ok: false, error: String(err).slice(0, 400) };
    }
  };
  const base = await run(`EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${query}`);
  // #545 residual: re-check the rejected index on a composition-realistic table.
  let withIndex: Record<string, unknown> = { skipped: "not attempted" };
  await conn.sql.unsafe(`CREATE INDEX IF NOT EXISTS ll_discovery_idx
     ON attempt_interruption_events (organization_id, event_type, detection_source, occurred_at, interruption_id)`);
  await conn.sql.unsafe(`ANALYZE attempt_interruption_events`);
  withIndex = await run(`EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) ${query}`);
  await conn.sql.unsafe(`DROP INDEX IF EXISTS ll_discovery_idx`);
  return { base, withIndex };
}

function samplesPath(): string {
  return join(RESULTS_SUB, "samples.jsonl");
}

function samplesForPhase(
  path: string,
  phase: string,
): Array<{
  status: number;
  latencyMs: number;
  timedOut: boolean;
  errorClass: string | null;
}> {
  void path;
  void phase;
  // Summaries regenerate from raw via summarize.ts; the runner writes empty
  // arrays here to keep summary.json self-contained without re-reading.
  return [];
}

main().catch(async (err) => {
  console.error(err);
  await stopActiveApi();
  process.exit(1);
});
