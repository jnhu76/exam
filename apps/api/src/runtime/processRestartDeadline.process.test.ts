import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema } from "@exam/db/src/schema/pg.js";
import { createDatabase } from "@exam/db/src/database.js";
import { seed } from "@exam/db/src/seed.js";
import type { Database } from "@exam/db/src/types.js";
import { hashPassword } from "@exam/auth/src/password.js";
import { signJWT } from "@exam/auth/src/session.js";
import { getRuntimeConfig } from "../config/runtimeConfig.js";
import { setupApiTestDatabaseFromEnv } from "../routes/testDatabase.js";
import {
  grabFreePort,
  healthState,
  isProcessAlive,
  killHard,
  spawnApiServer,
  waitUntil,
  type SpawnedApiServer,
} from "./restartProcessHarness.js";

/**
 * #326 — REAL API process-boundary restart + cross-deadline recovery.
 *
 * Evidence contract (issue body + #333 S1 reconciliation comment):
 *   - The boundary is a REAL operating-system process: `node --import tsx
 *     src/server.ts` (the production entry — every plugin, including the
 *     deadline scanner interval, boots identically to `pnpm dev`), hard-killed
 *     with SIGKILL and replaced by a NEW process whose identity change is
 *     machine-proven: old pid reported dead by the OS + listener replaced on
 *     the same port + fresh `/api/system/info` uptime.
 *   - Assertions target DURABLE PostgreSQL facts read through a separate
 *     parent connection, not page navigation. Browser-close coverage already
 *     exists (`deadline-crash.spec.ts`) and is deliberately not duplicated;
 *     per the issue reconciliation comment, API-driven durable-state evidence
 *     plus the candidate summary endpoint is the representative post-restart
 *     verification.
 *
 * Measured convergence bound (scanner interval = 1s here): instance-ready →
 * attempt terminal was observed at roughly one scan interval plus transaction
 * overhead. The asserted operability ceiling is CONVERGENCE_BOUND_MS (30s);
 * a regression past it (e.g. lost overdue-state catch-up) fails scenarios
 * B/C red. Because the measured bound sits far below operational scale, NO
 * boot-time catch-up scanner is added:
 *
 *   PRODUCT CODE CHANGED: NO — this issue was an evidence gap, now executable.
 *
 * Isolation: fixtures use per-scenario UUID identities; each test stops every
 * server it booted so no scanner cross-talk leaks into the next test's DB
 * observations (all instances would otherwise share the worker database).
 */

const SCAN_INTERVAL_MS = 1000;
/** Documented operability ceiling for ready→terminal convergence after restart. */
const CONVERGENCE_BOUND_MS = 30_000;

type Json = Record<string, unknown>;

async function call(
  baseUrl: string,
  method: "GET" | "POST",
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<{ status: number; json: unknown }> {
  const headers: Record<string, string> = {};
  if (opts.token) headers.Cookie = `auth-token=${opts.token}`;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    const init: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(10_000),
    };
    if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
    res = await fetch(`${baseUrl}${path}`, init);
  } catch (err) {
    throw new Error(`fetch ${method} ${path} failed: ${String(err)}`);
  }
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  return { status: res.status, json };
}

function asRecord(json: unknown): Json {
  if (json !== null && typeof json === "object") return json as Json;
  throw new Error(`expected JSON object, got: ${JSON.stringify(json)}`);
}

function mintToken(user: {
  id: string;
  role: string;
  organizationId: string;
  authEpoch: number;
}): string {
  return signJWT(
    {
      actorId: user.id,
      role: user.role as never,
      organizationId: user.organizationId,
      authEpoch: user.authEpoch,
    },
    getRuntimeConfig().authSecret.jwtSecret,
  );
}

interface CandidateFixture {
  userId: string;
  profileId: string;
  token: string;
}

/** Inserts candidate user + profile parent-side (no server needed). */
async function createCandidateFixture(
  db: Database,
  orgId: string,
  username: string,
): Promise<CandidateFixture> {
  const now = new Date();
  const userId = crypto.randomUUID();
  await db.insert(schema.users).values({
    id: userId,
    organizationId: orgId,
    username,
    passwordHash: await hashPassword("password123"),
    name: `Restart Candidate ${username}`,
    role: "Candidate",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.userRoleAssignments).values({
    id: crypto.randomUUID(),
    organizationId: orgId,
    userId,
    role: "Candidate",
    isPrimary: true,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  const profileId = crypto.randomUUID();
  await db.insert(schema.candidateProfiles).values({
    id: profileId,
    organizationId: orgId,
    userId,
    fields: {},
    createdAt: now,
    updatedAt: now,
  });
  const rows = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  return { userId, profileId, token: mintToken(rows[0]!) };
}

interface ExamBundle {
  examId: string;
  questionId: string;
  closeAtMs: number;
}

async function createPublishedExam(
  baseUrl: string,
  adminToken: string,
  title: string,
  opts: { durationMinutes: number; closeInMs: number },
): Promise<ExamBundle> {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const course = await call(baseUrl, "POST", "/api/courses", {
    token: adminToken,
    body: {
      name: `Restart course ${suffix}`,
      code: `RC-${suffix}`,
      description: "",
    },
  });
  if (course.status !== 201)
    throw new Error(`course: ${JSON.stringify(course.json)}`);
  const courseId = asRecord(course.json).id as string;

  const question = await call(baseUrl, "POST", "/api/questions", {
    token: adminToken,
    body: {
      courseId,
      type: "true_false",
      content: `Restart question ${suffix}: 2+2=4`,
      standardAnswer: true,
      score: 100,
    },
  });
  if (question.status !== 201)
    throw new Error(`question: ${JSON.stringify(question.json)}`);
  const questionId = asRecord(question.json).id as string;

  const nowMs = Date.now();
  const exam = await call(baseUrl, "POST", "/api/exams", {
    token: adminToken,
    body: {
      title,
      courseId,
      durationMinutes: opts.durationMinutes,
      openAt: new Date(nowMs - 5_000).toISOString(),
      closeAt: new Date(nowMs + opts.closeInMs).toISOString(),
      passingScore: 60,
      totalScore: 100,
      questionIds: [questionId],
    },
  });
  if (exam.status !== 201)
    throw new Error(`exam: ${JSON.stringify(exam.json)}`);
  const examId = asRecord(exam.json).id as string;

  const published = await call(
    baseUrl,
    "POST",
    `/api/exams/${examId}/publish`,
    {
      token: adminToken,
    },
  );
  if (published.status !== 200)
    throw new Error(`publish: ${JSON.stringify(published.json)}`);
  return { examId, questionId, closeAtMs: nowMs + opts.closeInMs };
}

async function enrollCandidate(
  baseUrl: string,
  adminToken: string,
  examId: string,
  profileId: string,
): Promise<void> {
  const res = await call(baseUrl, "POST", `/api/exams/${examId}/enrollments`, {
    token: adminToken,
    body: { candidateIds: [profileId] },
  });
  if (res.status !== 200)
    throw new Error(`enroll: ${JSON.stringify(res.json)}`);
}

let seqCounter = 0;

function nextSeq(): number {
  return ++seqCounter;
}

async function saveAnswer(
  baseUrl: string,
  token: string,
  attemptId: string,
  questionId: string,
  answer: unknown,
  clientSeq: number,
  baseVersion: number,
): Promise<{
  accepted: boolean;
  reason?: string | undefined;
  serverVersion?: number | undefined;
}> {
  const res = await call(
    baseUrl,
    "POST",
    `/api/attempts/${attemptId}/answers/${questionId}`,
    {
      token,
      body: {
        attemptId,
        questionId,
        answer,
        clientSeq,
        clientSavedAt: new Date().toISOString(),
        baseVersion,
      },
    },
  );
  if (res.status !== 200)
    throw new Error(`save http ${res.status}: ${JSON.stringify(res.json)}`);
  const rec = asRecord(res.json);
  return {
    accepted: rec.accepted === true,
    reason: rec.reason as string | undefined,
    serverVersion: rec.serverVersion as number | undefined,
  };
}

interface TakeSnapshotDto {
  attemptStatus: string;
  effectiveDeadline: string | null;
  submittedAt: string | null;
  serverNow: string;
  questions: { id: string; answerValue: unknown }[];
}

async function takeSnapshot(
  baseUrl: string,
  token: string,
  attemptId: string,
): Promise<TakeSnapshotDto> {
  const res = await call(
    baseUrl,
    "GET",
    `/api/candidate/attempts/${attemptId}/take`,
    { token },
  );
  if (res.status !== 200)
    throw new Error(`take ${res.status}: ${JSON.stringify(res.json)}`);
  return res.json as TakeSnapshotDto;
}

type AttemptRow = typeof schema.examAttempts.$inferSelect;

async function attemptRow(
  db: Database,
  attemptId: string,
): Promise<AttemptRow> {
  const rows = await db
    .select()
    .from(schema.examAttempts)
    .where(eq(schema.examAttempts.id, attemptId));
  if (rows.length === 0) throw new Error(`attempt ${attemptId} not found`);
  return rows[0]!;
}

async function countAttempts(
  db: Database,
  enrollmentId: string,
): Promise<number> {
  return (
    await db
      .select()
      .from(schema.examAttempts)
      .where(eq(schema.examAttempts.enrollmentId, enrollmentId))
  ).length;
}

async function gradingEntryCount(
  db: Database,
  attemptId: string,
): Promise<number> {
  return (
    await db
      .select()
      .from(schema.attemptGradingEntries)
      .where(eq(schema.attemptGradingEntries.attemptId, attemptId))
  ).length;
}

async function auditSubmitRowCount(
  db: Database,
  attemptId: string,
): Promise<number> {
  return (
    await db
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.targetType, "attempt"),
          eq(schema.auditLogs.targetId, attemptId),
          eq(schema.auditLogs.action, "attempt.submit"),
        ),
      )
  ).length;
}

async function terminalizedEventCount(
  db: Database,
  attemptId: string,
): Promise<number> {
  const rows = await db
    .select({ eventType: schema.attemptInterruptionEvents.eventType })
    .from(schema.attemptInterruptionEvents)
    .where(eq(schema.attemptInterruptionEvents.attemptId, attemptId));
  return rows.filter((e) => e.eventType === "terminalized").length;
}

/** Answer value carried by the frozen SubmittedAnswersSnapshot ({questionId, value}). */
function submittedSnapshotAnswer(
  submitted: unknown,
  questionId: string,
): unknown {
  const snap = submitted as {
    answers?: { questionId: string; value: unknown }[];
  } | null;
  const hit = snap?.answers?.find((a) => a.questionId === questionId);
  return hit === undefined ? null : hit.value;
}

/** Answer value shown by the candidate take-snapshot for one question id. */
function takeAnswerValue(
  questions: TakeSnapshotDto["questions"],
  questionId: string,
): unknown {
  const hit = questions.find((q) => q.id === questionId);
  return hit === undefined ? null : hit.answerValue;
}

describe("process-restart deadline recovery (#326)", () => {
  let connInfo: Awaited<ReturnType<typeof createDatabase>>;
  let db: Database;
  let orgId = "";
  let adminToken = "";
  let workerUrl = "";
  let cleanupHandle: Awaited<
    ReturnType<typeof setupApiTestDatabaseFromEnv>
  > | null = null;
  /** Servers still alive; afterAll is only a safety net — tests clean up inline. */
  const liveServers: SpawnedApiServer[] = [];

  beforeAll(async () => {
    cleanupHandle = await setupApiTestDatabaseFromEnv({
      namespace: "restart-deadline",
    });
    workerUrl = cleanupHandle.databaseUrl;
    connInfo = await createDatabase(workerUrl);
    db = connInfo.db;
    const seedResult = await seed(db, hashPassword);
    orgId = seedResult.orgId;
    const admins = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, seedResult.users.adminId));
    adminToken = mintToken(admins[0]!);
  });

  afterAll(async () => {
    for (const server of liveServers) {
      try {
        if (isProcessAlive(server.pid)) process.kill(server.pid, "SIGKILL");
      } catch {
        /* already gone */
      }
    }
    try {
      await connInfo?.sql.end();
    } catch {
      /* pool may already be closed */
    }
    await cleanupHandle?.close();
  });

  async function boot(
    opts: Parameters<typeof spawnApiServer>[0],
  ): Promise<SpawnedApiServer> {
    const server = await spawnApiServer({
      deadlineScanIntervalMs: SCAN_INTERVAL_MS,
      ...opts,
    });
    liveServers.push(server);
    return server;
  }

  /** SIGKILLs every server this test booted so its scanner cannot observe later tests. */
  async function stopBootedServers(): Promise<void> {
    while (liveServers.length > 0) {
      const server = liveServers.pop()!;
      if (!isProcessAlive(server.pid)) continue;
      process.kill(server.pid, "SIGKILL");
      await Promise.race([
        server.exitPromise,
        new Promise((r) => setTimeout(r, 5000)),
      ]);
    }
  }

  /**
   * Shared post-restart convergence contract for scenarios B/C:
   * exactly one terminal outcome across every durable surface that could
   * duplicate it, correct server-side submission facts, and inertness of the
   * continued scan loop.
   */
  async function assertConvergedOnceAndStable(params: {
    attemptId: string;
    enrollmentId: string;
    questionId: string;
    closeAtMs: number;
    readyAtMs: number;
    expectTerminalizedEvent?: boolean;
  }): Promise<void> {
    const row = await waitUntil(
      async () => {
        const current = await attemptRow(db, params.attemptId);
        return current.status === "graded" ? current : null;
      },
      {
        timeoutMs: CONVERGENCE_BOUND_MS,
        intervalMs: 400,
        label: "attempt reaches graded",
      },
    );
    const observedAtMs = Date.now();
    const measured = observedAtMs - params.readyAtMs;

    expect(
      measured,
      `scanner convergence took ${measured}ms — documented bound is ${CONVERGENCE_BOUND_MS}ms`,
    ).toBeLessThan(CONVERGENCE_BOUND_MS);

    expect(row.submissionReason).toBe("deadline");
    expect(row.score).toBe(100);
    expect(row.passed).toBe(true);
    expect(row.submittedAnswers).not.toBeNull();
    // submittedAt must be a server-side valid instant inside [effectiveDeadline, observation].
    // Scanner-won races record the wall-clock submit moment (>closeAt); lazy-won
    // races record exactly effectiveDeadline — both are inside the window.
    expect(row.submittedAt!.getTime()).toBeGreaterThanOrEqual(params.closeAtMs);
    expect(row.submittedAt!.getTime()).toBeLessThanOrEqual(observedAtMs);

    // Exactly ONE terminal outcome across every surface that could duplicate.
    expect(await countAttempts(db, params.enrollmentId)).toBe(1);
    // UNIQUE(attempt_id, question_id) backs this, but the count also proves
    // the workset was materialized exactly once (never re-materialized).
    expect(await gradingEntryCount(db, params.attemptId)).toBe(1); // 1 question
    expect(
      submittedSnapshotAnswer(row.submittedAnswers, params.questionId),
    ).toBe(true);
    // Deadline-freeze paths write no manual-submit audit event (documented).
    expect(await auditSubmitRowCount(db, params.attemptId)).toBe(0);
    if (params.expectTerminalizedEvent) {
      // The outcome ledger allows at most one terminalized row per episode.
      expect(await terminalizedEventCount(db, params.attemptId)).toBe(1);
      // Terminal release: the disrupted pointer pair must be cleared.
      expect(row.currentInterruptionId).toBeNull();
      expect(row.interruptedAt).toBeNull();
    }

    // Continued scanner ticks must be inert — re-sample after ≥3 intervals.
    const stableBefore = {
      submittedAt: row.submittedAt!.toISOString(),
      score: row.score,
      snapshot: JSON.stringify(row.submittedAnswers),
    };
    await new Promise((r) => setTimeout(r, SCAN_INTERVAL_MS * 3 + 500));
    const later = await attemptRow(db, params.attemptId);
    expect(later.status).toBe("graded");
    expect(later.submittedAt!.toISOString()).toBe(stableBefore.submittedAt);
    expect(later.score).toBe(stableBefore.score);
    expect(JSON.stringify(later.submittedAnswers)).toBe(stableBefore.snapshot);
  }

  it("A: restart BEFORE deadline preserves attempt identity, answers, and exact deadline", async () => {
    const firstPort = await grabFreePort();
    const serverA = await boot({ port: firstPort, databaseUrl: workerUrl });
    const candidate = await createCandidateFixture(
      db,
      orgId,
      `rc-a-${Date.now().toString(36)}`,
    );

    const bundle = await createPublishedExam(
      serverA.baseUrl,
      adminToken,
      "restart-pre-deadline",
      {
        durationMinutes: 30,
        closeInMs: 90 * 60_000,
      },
    );
    await enrollCandidate(
      serverA.baseUrl,
      adminToken,
      bundle.examId,
      candidate.profileId,
    );

    const startRes = await call(
      serverA.baseUrl,
      "POST",
      `/api/attempts/${bundle.examId}/start`,
      {
        token: candidate.token,
      },
    );
    expect(startRes.status).toBe(201);
    const attemptId = asRecord(startRes.json).id as string;

    const saved1 = await saveAnswer(
      serverA.baseUrl,
      candidate.token,
      attemptId,
      bundle.questionId,
      true,
      nextSeq(),
      0,
    );
    expect(saved1.accepted).toBe(true);
    expect(saved1.serverVersion).toBe(1);

    const snapA = await takeSnapshot(
      serverA.baseUrl,
      candidate.token,
      attemptId,
    );
    const rowA = await attemptRow(db, attemptId);
    // API surface agrees with the durable authority byte-for-byte.
    expect(snapA.effectiveDeadline).toBe(rowA.deadlineAt!.toISOString());
    const enrollmentRows = await db
      .select()
      .from(schema.examEnrollments)
      .where(
        and(
          eq(schema.examEnrollments.examId, bundle.examId),
          eq(schema.examEnrollments.candidateId, candidate.profileId),
        ),
      );
    expect(enrollmentRows[0]!.attemptCount).toBe(1);

    // ── REAL process restart ──────────────────────────────────────
    const pidA = serverA.pid;
    await killHard(serverA);
    expect(isProcessAlive(pidA)).toBe(false);

    const serverB = await boot({ port: firstPort, databaseUrl: workerUrl });
    expect(serverB.pid).not.toBe(pidA);
    const version = await call(serverB.baseUrl, "GET", "/api/system/info", {});
    expect(version.status).toBe(200);
    // Freshly booted replacement process, not a lingering runtime.
    expect(Number(asRecord(version.json).uptime)).toBeLessThan(20);

    // Durable auth authority survives (JWT secret + credential epoch are in PG).
    const snapB = await takeSnapshot(
      serverB.baseUrl,
      candidate.token,
      attemptId,
    );
    expect(snapB.attemptStatus).toBe("in_progress");
    expect(snapB.effectiveDeadline).toBe(snapA.effectiveDeadline); // zero drift
    expect(takeAnswerValue(snapB.questions, bundle.questionId)).toBe(true);

    // POST start again restores THE SAME attempt — never fabricates a second one.
    const restarted = await call(
      serverB.baseUrl,
      "POST",
      `/api/attempts/${bundle.examId}/start`,
      {
        token: candidate.token,
      },
    );
    expect(restarted.status).toBe(200);
    expect(asRecord(restarted.json).id).toBe(attemptId);

    const rowAfterReStart = await attemptRow(db, attemptId);
    expect(rowAfterReStart.startedAt!.getTime()).toBe(
      rowA.startedAt!.getTime(),
    );
    // M1-SENSITIVE INVARIANT: a regression that recomputes/extends deadlineAt
    // on restore fails here — the stored deadline must be byte-stable.
    expect(rowAfterReStart.deadlineAt!.getTime()).toBe(
      rowA.deadlineAt!.getTime(),
    );
    expect(await countAttempts(db, enrollmentRows[0]!.id)).toBe(1);
    const enrollmentAfter = await db
      .select()
      .from(schema.examEnrollments)
      .where(eq(schema.examEnrollments.id, enrollmentRows[0]!.id));
    expect(enrollmentAfter[0]!.attemptCount).toBe(1);

    // Version continuity ACROSS processes: v1 was minted by instance A; B must
    // honor it as base — the Answer Save Protocol version chain is durable.
    const saved2 = await saveAnswer(
      serverB.baseUrl,
      candidate.token,
      attemptId,
      bundle.questionId,
      false,
      nextSeq(),
      saved1.serverVersion!,
    );
    expect(saved2.accepted).toBe(true);
    expect(saved2.serverVersion).toBe(2);
    const rowFinal = await attemptRow(db, attemptId);
    const draftRecord = rowFinal.answers.find(
      (a) => a.questionId === bundle.questionId,
    );
    expect(draftRecord?.answer).toBe(false);
    expect(draftRecord?.version).toBe(2);

    await stopBootedServers();
  }, 150_000);

  it("B: API down ACROSS deadline → converges once after restart; late saves rejected", async () => {
    const portB = await grabFreePort();
    const serverA = await boot({ port: portB, databaseUrl: workerUrl });
    const candidate = await createCandidateFixture(
      db,
      orgId,
      `rc-b-${Date.now().toString(36)}`,
    );
    const bundle = await createPublishedExam(
      serverA.baseUrl,
      adminToken,
      "restart-cross-deadline",
      {
        durationMinutes: 30,
        closeInMs: 12_000, // closeAt is the effective deadline (12s out)
      },
    );
    await enrollCandidate(
      serverA.baseUrl,
      adminToken,
      bundle.examId,
      candidate.profileId,
    );
    const startRes = await call(
      serverA.baseUrl,
      "POST",
      `/api/attempts/${bundle.examId}/start`,
      {
        token: candidate.token,
      },
    );
    expect(startRes.status).toBe(201);
    const attemptId = asRecord(startRes.json).id as string;
    const preRow = await attemptRow(db, attemptId);
    // durationMinutes=30 puts the per-attempt deadline beyond closeAt ⇒ min() picks closeAt.
    expect(bundle.closeAtMs).toBeLessThan(preRow.deadlineAt!.getTime());

    const savedPre = await saveAnswer(
      serverA.baseUrl,
      candidate.token,
      attemptId,
      bundle.questionId,
      true,
      nextSeq(),
      0,
    );
    expect(savedPre.accepted).toBe(true);

    await killHard(serverA);
    // Cross the effective deadline while genuinely DOWN (nothing listening).
    await waitUntil(async () => Date.now() >= bundle.closeAtMs + 300 || null, {
      timeoutMs: 20_000,
      intervalMs: 120,
      label: "cross effective deadline while down",
    });
    expect(await healthState(serverA.baseUrl)).toBe("refused");

    const serverB = await boot({ port: portB, databaseUrl: workerUrl });
    const readyAtMs = Date.now();

    // Duplicate-effects adversary: burst candidate traffic DURING convergence.
    // Saves carry a forged marker so any improper post-deadline persistence
    // becomes greppably visible in durable JSON.
    await Promise.allSettled([
      takeSnapshot(serverB.baseUrl, candidate.token, attemptId),
      takeSnapshot(serverB.baseUrl, candidate.token, attemptId),
      saveAnswer(
        serverB.baseUrl,
        candidate.token,
        attemptId,
        bundle.questionId,
        "post-deadline-burst-marker",
        nextSeq(),
        9999,
      ),
      call(serverB.baseUrl, "POST", `/api/attempts/${bundle.examId}/start`, {
        token: candidate.token,
      }),
    ]);

    const enrollmentRows = await db
      .select()
      .from(schema.examEnrollments)
      .where(eq(schema.examEnrollments.id, preRow.enrollmentId));
    await assertConvergedOnceAndStable({
      attemptId,
      enrollmentId: enrollmentRows[0]!.id,
      questionId: bundle.questionId,
      closeAtMs: bundle.closeAtMs,
      readyAtMs,
    });

    // The burst's forged answer must not exist anywhere durable.
    const finalRow = await attemptRow(db, attemptId);
    expect(JSON.stringify(finalRow.answers)).not.toContain(
      "post-deadline-burst-marker",
    );

    // An explicit post-convergence save is durably rejected.
    const lateSave = await saveAnswer(
      serverB.baseUrl,
      candidate.token,
      attemptId,
      bundle.questionId,
      true,
      nextSeq(),
      0,
    );
    expect(lateSave.accepted).toBe(false);
    expect(["ATTEMPT_ALREADY_SUBMITTED", "DEADLINE_EXCEEDED"]).toContain(
      lateSave.reason,
    );

    // Representative verification: the candidate sees the graded result.
    // NOTE the derivation order in candidateExamSummary: afterWindow(closeAt)
    // precedes the graded branch, so a scored attempt inside a closed exam
    // window surfaces as "expired" + view_result — both are result-visible.
    const summary = await call(serverB.baseUrl, "GET", "/api/candidate/exams", {
      token: candidate.token,
    });
    expect(summary.status).toBe(200);
    const entries = summary.json as Array<{
      examId: string;
      availabilityStatus: string;
      primaryAction: string;
      bestScore?: number;
    }>;
    const entry = entries.find((e) => e.examId === bundle.examId);
    expect(entry).toBeDefined();
    const resultVisible =
      entry!.availabilityStatus === "graded" ||
      (entry!.availabilityStatus === "expired" &&
        entry!.primaryAction === "view_result");
    expect(resultVisible).toBe(true);
    expect(entry!.bestScore).toBe(100);

    await stopBootedServers();
  }, 180_000);

  it("C: overdue DISRUPTED state at startup converges with exactly one terminalization", async () => {
    // Faster heartbeat detector so the disruption lands well before the deadline.
    const heavyHeartbeat = {
      heartbeatTimeoutMs: 3000,
      heartbeatScanIntervalMs: SCAN_INTERVAL_MS,
    };
    const portC = await grabFreePort();
    const serverA = await boot({
      port: portC,
      databaseUrl: workerUrl,
      ...heavyHeartbeat,
    });
    const candidate = await createCandidateFixture(
      db,
      orgId,
      `rc-c-${Date.now().toString(36)}`,
    );
    const bundle = await createPublishedExam(
      serverA.baseUrl,
      adminToken,
      "restart-overdue-disrupted",
      {
        durationMinutes: 30,
        closeInMs: 14_000,
      },
    );
    await enrollCandidate(
      serverA.baseUrl,
      adminToken,
      bundle.examId,
      candidate.profileId,
    );
    const startRes = await call(
      serverA.baseUrl,
      "POST",
      `/api/attempts/${bundle.examId}/start`,
      {
        token: candidate.token,
      },
    );
    expect(startRes.status).toBe(201);
    const attemptId = asRecord(startRes.json).id as string;
    const saved = await saveAnswer(
      serverA.baseUrl,
      candidate.token,
      attemptId,
      bundle.questionId,
      true,
      nextSeq(),
      0,
    );
    expect(saved.accepted).toBe(true);

    // Go silent: the heartbeat detector must persist 'disrupted' BEFORE the deadline.
    await waitUntil(
      async () =>
        (await attemptRow(db, attemptId)).status === "disrupted" ? true : null,
      {
        timeoutMs: 12_000,
        intervalMs: 250,
        label: "heartbeat timeout flips attempt to disrupted",
      },
    );

    await killHard(serverA);
    await waitUntil(async () => Date.now() >= bundle.closeAtMs + 300 || null, {
      timeoutMs: 25_000,
      intervalMs: 120,
      label: "overdue persisted state while down",
    });

    // Fresh process boots against ALREADY-OVERDUE disrupted state (startup
    // catch-up comes purely from the regular interval scanner).
    const serverB = await boot({ port: portC, databaseUrl: workerUrl });
    const readyAtMs = Date.now();
    const enrollmentRows = await db
      .select()
      .from(schema.examEnrollments)
      .where(
        and(
          eq(schema.examEnrollments.candidateId, candidate.profileId),
          eq(schema.examEnrollments.examId, bundle.examId),
        ),
      );

    await assertConvergedOnceAndStable({
      attemptId,
      enrollmentId: enrollmentRows[0]!.id,
      questionId: bundle.questionId,
      closeAtMs: bundle.closeAtMs,
      readyAtMs,
      expectTerminalizedEvent: true,
    });

    await stopBootedServers();
  }, 180_000);
});
