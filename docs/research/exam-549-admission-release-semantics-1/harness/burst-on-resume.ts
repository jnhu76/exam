/**
 * #549 — burst-on-resume measurement harness (RESEARCH ONLY, no production surface).
 *
 * Deterministic equivalent of audit finding F-08-2: N candidates joined on a
 * requireQueue exam, polling stops for Δt (pause horizon), then all clients
 * resume polling at once. Each resumed "client" replays the exact engine
 * sequence the queue route executes (attempts.candidate.ts POST /queue):
 *
 *   joinAdmissionQueue → reconcileAdmission → previewAdmissionStatus
 *
 * against the REAL examAdmissionRepo on REAL PostgreSQL with the
 * production-shaped postgres.js pool (default max=10, no override — same
 * pool-shape evidence as #554 P1). The server clock is the deterministic
 * research variable: `now` for every resumed poll is fixed at the resume
 * instant T0+Δt, which upper-bounds the eligible set (a real burst's wall
 * clock advances batches mid-burst; #550 exercises that on the live HTTP path).
 *
 * Run (repo root):
 *   pnpm --filter @exam/db exec tsx \
 *     docs/research/exam-549-admission-release-semantics-1/harness/burst-on-resume.ts
 *
 * DB lifecycle: repo-owned test database resolution (exam_test, name-guarded)
 * + the repo's own per-run isolated schema (created/dropped through
 * packages/db helpers). No dev data is touched.
 *
 * Query counts: drizzle executes every statement through `sql.unsafe`; the
 * harness wraps that single funnel before any poll runs. Counts therefore
 * cover exactly the join+reconcile+preview burst (seeding and the two
 * admitted-row snapshots are taken outside the armed window). In-flight
 * tracking uses the same wrapper; the pg_stat_activity sampler runs on a
 * separate connection and counts active server-side sessions.
 */
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  addSearchPathToUrl,
  createTestSchema,
  dropTestSchema,
  generateUniqueSchemaName,
  stripOptionsFromUrl,
} from "../../../../packages/db/src/testIsolation.js";
import { createDatabase } from "../../../../packages/db/src/database.js";
import { migratePostgres } from "../../../../packages/db/src/postgres.js";
import { resolveTestDatabaseUrl } from "../../../../packages/db/src/testDb.js";
import { schema } from "../../../../packages/db/src/schema/pg.js";
import { createExamAdmissionRepo } from "../../../../packages/db/src/repository/examAdmissionRepo.js";
import {
  joinAdmissionQueue,
  previewAdmissionStatus,
  reconcileAdmission,
  type AdmissionDeps,
} from "../../../../packages/exam-engine/src/admissionCommands.js";
import type {
  Exam,
  RequestContext,
} from "../../../../packages/domain/src/types.js";

type DbConnection = Awaited<ReturnType<typeof createDatabase>>;

// ── Scenario matrix ────────────────────────────────────────────────────────

interface Scenario {
  id: string;
  note: string;
  candidates: number;
  /** Candidates whose membership was already consumed before the pause. */
  consumedBeforePause: number;
  batchSize: number;
  batchIntervalSeconds: number;
  /** Polling pause in seconds (Δt between the join anchor and the resume clock). */
  pauseSeconds: number;
}

const SCENARIOS: Scenario[] = [
  {
    id: "R-f082-repro",
    note: "audit witness: 60 join (4 start pre-pause), B=20 I=15s, Δt=3 intervals",
    candidates: 60,
    consumedBeforePause: 4,
    batchSize: 20,
    batchIntervalSeconds: 15,
    pauseSeconds: 45,
  },
  ...[20, 50, 100, 130, 200].flatMap((n) => {
    const base = {
      candidates: n,
      consumedBeforePause: 0,
      batchSize: 20,
      batchIntervalSeconds: 15,
    };
    const batchesForAll = Math.ceil(n / base.batchSize);
    return [
      {
        id: `N${n}-dt1batch`,
        note: "pause = 1 interval (2 batches released at resume)",
        ...base,
        pauseSeconds: 15,
      },
      {
        id: `N${n}-dt6batch`,
        note: "pause = 6 intervals (7 batches released at resume)",
        ...base,
        pauseSeconds: 90,
      },
      {
        id: `N${n}-dtall`,
        note: "pause covers every batch → all waiting candidates eligible",
        ...base,
        pauseSeconds: batchesForAll * base.batchIntervalSeconds,
      },
    ];
  }),
];
// Smoke/regression filter: SCENARIOS="R-f082-repro,N50-dt6batch" (comma-separated ids).
const scenarioFilter = new Set(
  (process.env.SCENARIOS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);
const ACTIVE_SCENARIOS = scenarioFilter.size
  ? SCENARIOS.filter((s) => scenarioFilter.has(s.id))
  : SCENARIOS;

/** Mirrors computeBatchRelease — cross-checked against the observed writes. */
function expectedEligible(s: Scenario): number {
  const waiting = s.candidates - s.consumedBeforePause;
  const releasedBatches =
    Math.floor(s.pauseSeconds / s.batchIntervalSeconds) + 1;
  return Math.min(waiting, releasedBatches * s.batchSize);
}

// ── Harness plumbing ───────────────────────────────────────────────────────

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.max(
    0,
    Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[idx];
}

function round(n: number, digits = 1): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(__dirname, "results");

// ── Query instrumentation state (module scope: the sql.unsafe funnel below
// and the per-scenario arm/capture helpers share it) ──
const instrumentation = {
  queries: 0,
  queriesInFlight: 0,
  maxQueriesInFlight: 0,
  queryMsTotal: 0,
  armed: false,
};

function armBurst(): void {
  instrumentation.queries = 0;
  instrumentation.queriesInFlight = 0;
  instrumentation.maxQueriesInFlight = 0;
  instrumentation.queryMsTotal = 0;
  instrumentation.armed = true;
}

function captureBurst(): {
  queriesTotal: number;
  maxQueriesInFlight: number;
  queryTimeMsTotal: number;
} {
  instrumentation.armed = false;
  return {
    queriesTotal: instrumentation.queries,
    maxQueriesInFlight: instrumentation.maxQueriesInFlight,
    queryTimeMsTotal: instrumentation.queryMsTotal,
  };
}

async function main(): Promise<void> {
  const baseUrl = resolveTestDatabaseUrl();
  const schemaName = generateUniqueSchemaName("549burst");
  await createTestSchema(baseUrl, schemaName);
  const url = addSearchPathToUrl(baseUrl, schemaName);

  const conn = await createDatabase(url);
  // Tables land in the isolated schema (first search_path entry via URL
  // options); the migration tracking table lives there too.
  await migratePostgres(conn.db, { migrationsSchema: schemaName });
  const samplerConn = await createDatabase(stripOptionsFromUrl(baseUrl));

  const origUnsafe = conn.sql.unsafe.bind(conn.sql);
  conn.sql.unsafe = ((...args: Parameters<typeof conn.sql.unsafe>) => {
    if (!instrumentation.armed) return origUnsafe(...args);
    instrumentation.queries += 1;
    instrumentation.queriesInFlight += 1;
    instrumentation.maxQueriesInFlight = Math.max(
      instrumentation.maxQueriesInFlight,
      instrumentation.queriesInFlight,
    );
    const started = performance.now();
    const result = origUnsafe(...args);
    void Promise.resolve(result)
      .catch(() => undefined)
      .finally(() => {
        instrumentation.queriesInFlight -= 1;
        instrumentation.queryMsTotal += performance.now() - started;
      });
    return result;
  }) as typeof conn.sql.unsafe;

  try {
    const results: Record<string, unknown>[] = [];
    for (const scenario of ACTIVE_SCENARIOS) {
      console.error(`▶ scenario ${scenario.id} …`);
      results.push(await runScenario(conn, samplerConn, scenario));
    }
    mkdirSync(RESULTS_DIR, { recursive: true });
    const outFile = join(
      RESULTS_DIR,
      `burst-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
    );
    writeFileSync(
      outFile,
      `${JSON.stringify(
        {
          baseSha: "1eff3f49b6dc13336d4e17593c120d77c680e080",
          ranAt: new Date().toISOString(),
          pool: "postgres.js default max=10 (production shape, no override)",
          results,
        },
        null,
        2,
      )}\n`,
    );
    console.log(`\nWrote ${results.length} scenario results → ${outFile}`);
  } finally {
    await samplerConn.sql.end();
    await conn.sql.end();
    await dropTestSchema(baseUrl, schemaName);
  }
}

async function runScenario(
  conn: DbConnection,
  samplerConn: DbConnection,
  s: Scenario,
): Promise<Record<string, unknown>> {
  const db = conn.db;

  // ── Seed: fresh org + exam per scenario (independent anchor/epoch) ──
  const orgId = randomUUID();
  const now = new Date();
  await db.insert(schema.organizations).values({
    id: orgId,
    name: `549-${s.id}`,
    displayName: `549-${s.id}`,
    slug: `549-${s.id}-${orgId.slice(0, 8)}`,
    createdAt: now,
    updatedAt: now,
  });

  const courseId = randomUUID();
  await db.insert(schema.courses).values({
    id: courseId,
    organizationId: orgId,
    name: `549 course ${s.id}`,
    code: `549-${s.id}-${courseId.slice(0, 6)}`.slice(0, 20),
    description: "",
    createdAt: now,
    updatedAt: now,
  });
  const examId = randomUUID();
  await db.insert(schema.exams).values({
    id: examId,
    organizationId: orgId,
    title: `549 exam ${s.id}`,
    description: "",
    courseId,
    status: "open",
    timingMode: "timed_window",
    durationMinutes: 60,
    openAt: now,
    closeAt: new Date(now.getTime() + 86_400_000),
    passingScore: 60,
    totalScore: 100,
    questionSelectionMode: "manual",
    questionIds: [],
    questionSnapshot: [],
    controlFlags: {
      shuffleQuestions: false,
      shuffleOptions: false,
      detectTabSwitch: false,
      disableCopyPaste: false,
      requireQueue: true,
      batchSize: s.batchSize,
      batchInterval: s.batchIntervalSeconds,
      restrictIp: false,
      requireLockdown: false,
      showResultImmediately: true,
    },
    retakePolicy: "unlimited",
    scoreStrategy: "highest",
    maxAttempts: 3,
    latestStartOffsetMinutes: null,
    minSubmitAfterStartMinutes: null,
    resultPublicationMode: "immediate",
    resultsPublishedAt: null,
    interruptionTimePolicy: "strict",
    interruptionGracePerIncidentSeconds: null,
    interruptionGracePerAttemptSeconds: null,
    syncStartedAt: null,
    createdAt: now,
    updatedAt: now,
  } as unknown as typeof schema.exams.$inferInsert);

  // ── Candidates: users + profiles, batched ──
  const candidateIds = Array.from({ length: s.candidates }, () => randomUUID());
  const waitingIds = candidateIds.slice(
    0,
    s.candidates - s.consumedBeforePause,
  );
  const consumedIds = candidateIds.slice(s.candidates - s.consumedBeforePause);

  const userRows = candidateIds.map((cid) => ({
    id: randomUUID(),
    organizationId: orgId,
    username: `549-${s.id}-${cid.slice(0, 8)}`,
    passwordHash: "x",
    name: `549 candidate ${cid.slice(0, 6)}`,
    role: "Candidate" as const,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  }));
  await db.insert(schema.users).values(userRows);
  await db.insert(schema.candidateProfiles).values(
    candidateIds.map((cid, i) => ({
      id: cid,
      organizationId: orgId,
      userId: userRows[i].id,
      fields: {},
      createdAt: now,
      updatedAt: now,
    })),
  );

  // Consumed memberships need paired enrollment + attempt rows (the DB check
  // exam_admissions_consumed_pair_check + FK enforce the pair, mirroring the
  // examAdmissionRepo.test.ts seeding idiom).
  const attemptIdByCandidate = new Map<string, string>();
  if (consumedIds.length > 0) {
    const enrollmentRows = consumedIds.map((cid) => ({
      id: randomUUID(),
      organizationId: orgId,
      examId,
      candidateId: cid,
      status: "started" as const,
      attemptCount: 0,
      createdAt: now,
      updatedAt: now,
    }));
    await db.insert(schema.examEnrollments).values(enrollmentRows);
    const attemptRows = consumedIds.map((cid, i) => ({
      id: randomUUID(),
      organizationId: orgId,
      examId,
      enrollmentId: enrollmentRows[i].id,
      candidateId: cid,
      attemptNo: 1,
      status: "in_progress" as const,
      questionSnapshot: [],
      answers: [],
      startedAt: now,
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
    }));
    await db.insert(schema.examAttempts).values(attemptRows);
    attemptRows.forEach((a) => attemptIdByCandidate.set(a.candidateId, a.id));
  }

  // All joins land on the same instant T0 → single anchor, worst-case join storm.
  const joinedAt = new Date();
  await db.insert(schema.examAdmissions).values([
    ...waitingIds.map((cid) => ({
      id: randomUUID(),
      organizationId: orgId,
      examId,
      candidateId: cid,
      joinedAt,
    })),
    ...consumedIds.map((cid) => ({
      id: randomUUID(),
      organizationId: orgId,
      examId,
      candidateId: cid,
      joinedAt,
      // Faithful lifecycle: admitted at T0+1s, started (consumed) at T0+2s —
      // the DB check admitted_before_consumed enforces this ordering.
      admittedAt: new Date(joinedAt.getTime() + 1000),
      consumedAt: new Date(joinedAt.getTime() + 2000),
      consumedAttemptId: attemptIdByCandidate.get(cid),
    })),
  ]);

  // ── Wiring: repo + ctx-binding port adapter. Mirrors the production
  // createExamAdmissionRepoAdapter (repoAdapters.ts) — it delegates to the
  // SAME repo methods; the adapter shape is inlined only because pulling the
  // whole API app surface into a research harness would be a heavier
  // second path, not a cleaner one.
  const ctx: RequestContext = {
    actorId: randomUUID(),
    organizationId: orgId,
    role: "Candidate",
    permissions: [],
    sessionId: randomUUID(),
    targetOrganizationId: orgId,
  };
  const repo = createExamAdmissionRepo(db);
  const deps: AdmissionDeps = {
    repo: {
      joinActive: (input) => repo.joinActive(ctx, input),
      findActive: (o, e, c) => repo.findActive(ctx, o, e, c),
      earliestJoinedAt: (o, e) => repo.earliestJoinedAt(ctx, o, e),
      countAllAhead: (o, e, j, id) => repo.countAllAhead(ctx, o, e, j, id),
      countActiveAhead: (o, e, j, id) =>
        repo.countActiveAhead(ctx, o, e, j, id),
      admitOnce: (id, at) => repo.admitOnce(ctx, id, at),
      consumeActive: (o, e, c, at, a) =>
        repo.consumeActive(ctx, o, e, c, at, a),
      listByExam: (o, e) => repo.listByExam(ctx, o, e),
    },
  };
  // The engine reads only organizationId/id/controlFlags.batchSize/batchInterval.
  const exam = {
    organizationId: orgId,
    id: examId,
    controlFlags: {
      batchSize: s.batchSize,
      batchInterval: s.batchIntervalSeconds,
    },
  } as unknown as Exam;

  const admittedBefore = await countAdmitted(conn, orgId, examId);

  // Deterministic resume clock: every poll observes T0+Δt.
  const nowResume = new Date(joinedAt.getTime() + s.pauseSeconds * 1000);

  // ── pg_stat_activity sampler (separate connection, never counts toward
  // the query funnel) ──
  let sampling = true;
  let maxActiveConns = 0;
  const sampler = (async () => {
    while (sampling) {
      try {
        const rows = await samplerConn.sql.unsafe(
          `SELECT count(*)::int AS n FROM pg_stat_activity
           WHERE datname = current_database() AND state = 'active'
             AND pid <> pg_backend_pid()`,
        );
        maxActiveConns = Math.max(maxActiveConns, rows[0]?.n ?? 0);
      } catch {
        // sampler failures never affect the measurement
      }
      await new Promise((r) => setTimeout(r, 10));
    }
  })();

  // The sampler MUST stop whatever the burst outcome is — a leaked loop
  // would keep the process alive after main() resolves.
  try {
    armBurst();
    const burstStart = performance.now();
    const polls = waitingIds.map(async (cid) => {
      const t0 = performance.now();
      await joinAdmissionQueue(deps, exam, cid, nowResume);
      await reconcileAdmission(deps, exam, cid, nowResume);
      const view = await previewAdmissionStatus(deps, exam, cid, nowResume);
      return { pollMs: performance.now() - t0, ready: view.ready };
    });
    var settled = await Promise.allSettled(polls);
    var burstMs = performance.now() - burstStart;
  } finally {
    sampling = false;
    await sampler;
  }
  const counted = captureBurst();

  const fulfilled = settled.filter(
    (r): r is PromiseFulfilledResult<{ pollMs: number; ready: boolean }> =>
      r.status === "fulfilled",
  );
  const rejected = settled.filter((r) => r.status === "rejected");
  const pollMsSorted = fulfilled
    .map((r) => r.value.pollMs)
    .sort((a, b) => a - b);
  const readyReportedByView = fulfilled.filter((r) => r.value.ready).length;

  const admittedAfter = await countAdmitted(conn, orgId, examId);
  const materializedDuringBurst = admittedAfter - admittedBefore;
  const waitingCount = waitingIds.length;
  const expected = expectedEligible(s);

  const result = {
    scenario: s.id,
    note: s.note,
    candidates: s.candidates,
    consumedBeforePause: s.consumedBeforePause,
    waitingCount,
    batchSize: s.batchSize,
    batchIntervalSeconds: s.batchIntervalSeconds,
    pauseSeconds: s.pauseSeconds,
    expectedEligibleAtResume: expected,
    materializedDuringBurst,
    readyReportedByView,
    predicateMatches:
      materializedDuringBurst === expected && readyReportedByView === expected,
    burstWallMs: round(burstMs),
    pollP50Ms: round(percentile(pollMsSorted, 50)),
    pollP95Ms: round(percentile(pollMsSorted, 95)),
    pollMaxMs: round(pollMsSorted[pollMsSorted.length - 1] ?? 0),
    queriesTotal: counted.queriesTotal,
    queriesPerPoll: round(counted.queriesTotal / Math.max(1, waitingCount), 2),
    queryTimeMsTotal: round(counted.queryTimeMsTotal),
    maxQueriesInFlight: counted.maxQueriesInFlight,
    maxActiveDbConnections: maxActiveConns,
    errors: rejected.length,
    errorSamples: rejected
      .slice(0, 3)
      .map((r) => String((r as PromiseRejectedResult).reason)),
  };
  console.log(JSON.stringify(result));
  return result;
}

/** Admitted-row snapshot — taken OUTSIDE the armed query-count window. */
async function countAdmitted(
  conn: DbConnection,
  organizationId: string,
  examId: string,
): Promise<number> {
  const rows = await conn.sql.unsafe(
    `SELECT count(*)::int AS n FROM exam_admissions
     WHERE organization_id = $1 AND exam_id = $2 AND admitted_at IS NOT NULL`,
    [organizationId, examId],
  );
  return rows[0]?.n ?? 0;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
