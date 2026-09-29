/**
 * EXAM-558 — Permanent lock-mode regression for the deadline-authority Exam
 * read: the candidate/read-side serialization point takes a SHARED row lock
 * (`findByIdForShare` / FOR SHARE), not FOR UPDATE. Companion to
 * candidate-deadline-authority.concurrency.test.ts (the writer-first
 * take/submit outcomes) and candidate-save-deadline-race.concurrency.test.ts
 * (#543).
 *
 * Mechanism (research record: docs/research/exam-558-lock-mode-1/):
 *   - SHARE conflicts with the Exam-authority writers (FOR UPDATE / UPDATE),
 *     so the deadline decision serializes against concurrent exam commands
 *     exactly as before — same authority serialization.
 *   - SHARE does NOT conflict with SHARE, so same-exam candidate readers
 *     coexist instead of queueing on one another (the same-Exam candidate
 *     convoy the research measured: S200 submit p99 ~2.8× worse under
 *     FOR UPDATE, zero deadlocks / retries / 429 / 5xx under SHARE).
 *   - A writer that commits BEFORE a REPEATABLE READ candidate transaction
 *     takes its locking read still forces that stale transaction to lose:
 *     SQLSTATE 40001 at the locking read, and `executeInTransaction` retries
 *     the WHOLE callback onto the new authority.
 *
 * These regressions pin that mechanism on real PostgreSQL. The parked holder
 * (`runParkedExamLockHolder`) composes the production locking prefix by hand
 * — executeInTransaction → EA seam → the SAME seam method
 * `ensureAttemptDeadlineReconciled` calls — because the production function
 * has no internal observation hook; T3 drives the REAL production
 * composition end-to-end. Schedules are forced by deferred park points; the
 * bounded promise-races only bound NEGATIVE observations ("not yet
 * released") — the positive evidence is pg_locks / pg_blocking_pids.
 *
 * T1-control keeps the FOR UPDATE baseline on the identical schedule: it
 * proves this rig still detects Exam-row serialization, so T1's coexistence
 * assertion can never pass vacuously.
 */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { createPostgresDatabase } from "@exam/db/src/postgres.js";
import { setupIsolatedTestDb } from "@exam/db/src/testIsolation.js";
import { resolveTestDbUrl } from "@exam/db/src/testDb.js";
import { buildTestApp } from "../testHelpers.js";
import examRoutes from "../exam.js";
import attemptRoutes from "../attempts.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { createExamRepo } from "@exam/db/src/repository/examRepo.js";
import { createEnrollmentRepo } from "@exam/db/src/repository/enrollmentRepo.js";
import { createAttemptGradingEntryRepo } from "@exam/db/src/repository/attemptGradingEntryRepo.js";
import { createAttemptInterruptionRepo } from "@exam/db/src/repository/attemptInterruptionRepo.js";
import { createAttemptInterruptionEventRepo } from "@exam/db/src/repository/attemptInterruptionEventRepo.js";
import { hashPassword } from "@exam/auth/src/password.js";
import { signJWT } from "@exam/auth/src/session.js";
import { getRuntimeConfig } from "../../config/runtimeConfig.js";
import type { Permission, RequestContext, Role } from "@exam/domain";
import { NotFoundError } from "@exam/domain";
import type { Database } from "@exam/db/src/types.js";
import { executeInTransaction } from "@exam/db/src/types.js";
import type { Exam, ExamAttempt } from "@exam/domain";
import {
  ensureAttemptDeadlineReconciled,
  lockEnrollmentAndAttempt,
} from "@exam/exam-engine";
import {
  createExamEngineRepos,
  createGradingWorksetRepoAdapter,
  createInterruptionEpisodeRepoAdapter,
  createInterruptionEventRepoAdapter,
} from "../../adapters/repoAdapters.js";
import { createDeferred, type Deferred } from "../../testing/barrier.js";
import { eq } from "drizzle-orm";

// The deadline scanner must never fire mid-schedule: these tests park
// transactions on purpose, and a background auto-submit would compete for
// the same rows. 1h interval ≈ never during a test file.
process.env.DEADLINE_SCAN_INTERVAL_MS = "3600000";

const MINUTE_MS = 60_000;
const baseNow = Date.now();

type PostgresSql = Awaited<ReturnType<typeof createPostgresDatabase>>["sql"];

/**
 * First PostgreSQL error code in the error's `cause` chain. Drizzle wraps
 * driver errors in DrizzleQueryError, which carries no `.code` itself, so a
 * raw `err.code` read always misses — the same walk `hasPostgresErrorCode`
 * performs for the retry decision.
 */
function extractPgErrorCode(err: unknown): string | undefined {
  let current: unknown = err;
  const visited = new Set<unknown>();
  while (current && !visited.has(current)) {
    visited.add(current);
    if (
      typeof current === "object" &&
      current !== null &&
      typeof (current as { code: unknown }).code === "string"
    ) {
      return (current as { code: string }).code;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

async function connectionPid(sql: PostgresSql): Promise<number> {
  const rows = await sql`SELECT pg_backend_pid() AS pid`;
  return Number(rows[0]!.pid);
}

/** Row-level lock rows on the isolated schema's `exams` table (tuple locks). */
async function examTupleLocks(
  sql: PostgresSql,
  schemaName: string,
): Promise<Array<{ pid: number; mode: string; granted: boolean }>> {
  const rows = await sql`
    SELECT l.pid AS pid, l.mode AS mode, l.granted AS granted
    FROM pg_locks l
    JOIN pg_class c ON c.oid = l.relation
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE l.locktype = 'tuple' AND c.relname = 'exams' AND n.nspname = ${schemaName}
    ORDER BY l.pid, l.granted`;
  return rows.map((r) => ({
    pid: Number(r.pid),
    mode: String(r.mode),
    granted: Boolean(r.granted),
  }));
}

async function blockingPids(sql: PostgresSql, pid: number): Promise<number[]> {
  const rows = await sql`SELECT pg_blocking_pids(${pid}) AS blockers`;
  const blockers = rows[0]?.blockers;
  return Array.isArray(blockers) ? blockers.map(Number) : [];
}

/** All teardown steps run and every error surfaces (no swallowed cleanup). */
async function teardownAll(
  ...steps: Array<() => Promise<unknown>>
): Promise<void> {
  const errors: unknown[] = [];
  for (const step of steps) {
    try {
      await step();
    } catch (err) {
      errors.push(err);
    }
  }
  if (errors.length > 0) {
    throw new Error(
      `teardown failed with ${errors.length} error(s): ` +
        errors.map((e) => String(e)).join(" | "),
    );
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface CandidateFixture {
  candidateId: string;
  candidateToken: string;
  attemptId: string;
  ctx: RequestContext;
}

interface ShareLockFixture {
  orgId: string;
  examId: string;
  adminToken: string;
  closeAt: Date;
  candidateA: CandidateFixture;
  candidateB: CandidateFixture;
}

/**
 * Two distinct candidates on ONE exam, each with a started in_progress
 * attempt. Distinct candidates are required: same-candidate transactions
 * would serialize on the shared Enrollment row and mask the Exam-row lock
 * behavior these regressions are about.
 */
async function setupFixture(
  ctx: Awaited<ReturnType<typeof buildTestApp>>,
  closeAt: Date,
): Promise<ShareLockFixture> {
  const now = new Date();
  const slug = `exam-558-${randomUUID().slice(0, 8)}`;

  const org = (
    await ctx.db
      .insert(schema.organizations)
      .values({
        id: randomUUID(),
        name: slug,
        displayName: slug,
        slug,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
  )[0]!;

  const passwordHash = await hashPassword("password123");
  const adminId = randomUUID();
  const candidateUserIds = [randomUUID(), randomUUID()];
  for (const user of [
    { id: adminId, username: `admin-${slug}`, role: "Admin" as const },
    {
      id: candidateUserIds[0]!,
      username: `cand-a-${slug}`,
      role: "Candidate" as const,
    },
    {
      id: candidateUserIds[1]!,
      username: `cand-b-${slug}`,
      role: "Candidate" as const,
    },
  ]) {
    await ctx.db.insert(schema.users).values({
      id: user.id,
      organizationId: org.id,
      username: user.username,
      passwordHash,
      name: user.role,
      role: user.role,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert(schema.userRoleAssignments).values({
      id: randomUUID(),
      organizationId: org.id,
      userId: user.id,
      role: user.role,
      isPrimary: true,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
  }

  const { jwtSecret } = getRuntimeConfig().authSecret;
  const tokenFor = (actorId: string, role: Role): string =>
    signJWT({ actorId, role, organizationId: org.id, authEpoch: 0 }, jwtSecret);
  const adminToken = tokenFor(adminId, "Admin");
  const candidateTokens = candidateUserIds.map((id) =>
    tokenFor(id, "Candidate"),
  );

  const course = (
    await ctx.db
      .insert(schema.courses)
      .values({
        id: randomUUID(),
        organizationId: org.id,
        name: `Course ${slug}`,
        code: `C-${slug}`,
        description: "",
        createdAt: now,
        updatedAt: now,
      })
      .returning()
  )[0]!;

  const question = (
    await ctx.db
      .insert(schema.questions)
      .values({
        id: randomUUID(),
        organizationId: org.id,
        courseId: course.id,
        type: "single_choice" as const,
        content: "EXAM-558",
        options: [
          { id: "a", content: "1" },
          { id: "b", content: "2" },
        ],
        standardAnswer: "a",
        attachments: [],
        score: 100,
        difficulty: 1,
        tags: [],
        gradingRule: {
          multiSelectScoring: "all_correct_full",
          fillBlankMatchMode: "exact",
        },
        createdAt: now,
        updatedAt: now,
      })
      .returning()
  )[0]!;

  const exam = (
    await ctx.db
      .insert(schema.exams)
      .values({
        id: randomUUID(),
        organizationId: org.id,
        title: `EXAM-558 ${slug}`,
        description: "",
        courseId: course.id,
        status: "open",
        timingMode: "timed_window",
        durationMinutes: 60,
        openAt: new Date(baseNow - 60 * MINUTE_MS),
        closeAt,
        passingScore: 60,
        totalScore: 100,
        questionSelectionMode: "manual",
        questionIds: [question.id],
        questionSnapshot: [
          {
            originalQuestionId: question.id,
            type: "single_choice" as const,
            content: question.content,
            contentDocument: null,
            answerMode: null,
            attachments: [],
            options: question.options,
            standardAnswer: question.standardAnswer,
            score: question.score,
            gradingRule: question.gradingRule,
            order: 0,
            rubric: null,
          },
        ],
        controlFlags: {
          shuffleQuestions: false,
          shuffleOptions: false,
          detectTabSwitch: false,
          disableCopyPaste: false,
          requireQueue: false,
          batchSize: 10,
          batchInterval: 3,
          restrictIp: false,
          requireLockdown: false,
          showResultImmediately: true,
        },
        retakePolicy: "unlimited",
        scoreStrategy: "highest",
        maxAttempts: 10,
        interruptionTimePolicy: "strict",
        interruptionGracePerIncidentSeconds: null,
        interruptionGracePerAttemptSeconds: null,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
  )[0]!;

  const profiles = [];
  for (const userId of candidateUserIds) {
    profiles.push(
      (
        await ctx.db
          .insert(schema.candidateProfiles)
          .values({
            id: randomUUID(),
            organizationId: org.id,
            userId,
            fields: {},
            createdAt: now,
            updatedAt: now,
          })
          .returning()
      )[0]!,
    );
  }

  const enrollRes = await ctx.app.inject({
    method: "POST",
    url: `/api/exams/${exam.id}/enrollments`,
    payload: { candidateIds: profiles.map((p) => p.id) },
    cookies: { "auth-token": adminToken },
  });
  if (enrollRes.statusCode !== 200) {
    throw new Error(`enroll failed: ${enrollRes.statusCode} ${enrollRes.body}`);
  }

  const candidates: CandidateFixture[] = [];
  for (let i = 0; i < profiles.length; i++) {
    const startRes = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${exam.id}/start`,
      cookies: { "auth-token": candidateTokens[i] },
    });
    if (startRes.statusCode !== 201) {
      throw new Error(`start failed: ${startRes.statusCode} ${startRes.body}`);
    }
    candidates.push({
      candidateId: profiles[i]!.id,
      candidateToken: candidateTokens[i]!,
      attemptId: startRes.json().id as string,
      ctx: {
        actorId: candidateUserIds[i]!,
        organizationId: org.id,
        role: "Candidate",
        permissions: [] as Permission[],
        sessionId: `exam-558-candidate-${i}`,
        targetOrganizationId: org.id,
      },
    });
  }

  return {
    orgId: org.id,
    examId: exam.id,
    adminToken,
    closeAt,
    candidateA: candidates[0]!,
    candidateB: candidates[1]!,
  };
}

/**
 * The submit/take deadline-decision composition, verbatim:
 * executeInTransaction → EA seam → ensureAttemptDeadlineReconciled. The
 * optional park point sits AFTER the EA locks and BEFORE the Exam authority
 * read (the window T3 needs). `sqlstates` collects the Postgres error code
 * of every failed pass (including retried 40001 passes).
 */
async function runCandidateDeadlineDecisionTx(args: {
  db: Database;
  candidate: CandidateFixture;
  now: Date;
  park?: { reached: Deferred<void>; wait: Deferred<void> };
  sqlstates?: string[];
}): Promise<ExamAttempt> {
  const { db, candidate, now, park, sqlstates } = args;
  const ctx = candidate.ctx;

  return executeInTransaction(db, async (tx) => {
    const { exams, enrollments, attempts } = createExamEngineRepos(
      {
        examRepo: createExamRepo(tx),
        attemptRepo: createAttemptRepo(tx),
        enrollmentRepo: createEnrollmentRepo(tx),
      },
      ctx,
    );
    const cap = await lockEnrollmentAndAttempt(
      enrollments,
      attempts,
      candidate.attemptId,
    );

    if (park) {
      park.reached.resolve();
      await park.wait.promise;
    }

    const episodeRepo = createInterruptionEpisodeRepoAdapter(
      createAttemptInterruptionRepo(tx),
      ctx,
    );
    const eventRepo = createInterruptionEventRepoAdapter(
      createAttemptInterruptionEventRepo(tx),
      ctx,
    );

    try {
      return await ensureAttemptDeadlineReconciled(
        exams,
        enrollments,
        attempts,
        createGradingWorksetRepoAdapter(createAttemptGradingEntryRepo(tx), ctx),
        cap,
        now,
        { mode: "none", episodeRepo, eventRepo },
      );
    } catch (err) {
      const code = extractPgErrorCode(err);
      if (code !== undefined) sqlstates?.push(code);
      throw err;
    }
  });
}

/**
 * Parked Exam-lock holder: the production locking prefix, verbatim —
 * executeInTransaction → EA seam → the SAME Exam authority read the deadline
 * decision makes (`findByIdForShare`, or `findByIdForUpdate` ONLY in the
 * T1-control baseline) — parked while HOLDING that lock.
 *
 * `ensureAttemptDeadlineReconciled` has no internal observation hook, so the
 * holder composes its exact locking prefix by hand and calls the same seam
 * method on the same tx-bound repo chain. T1/T2 assert lock compatibility AT
 * the Exam row; the decision logic after the read is out of scope there (T3
 * drives the real function end-to-end).
 */
async function runParkedExamLockHolder(args: {
  db: Database;
  candidate: CandidateFixture;
  examId: string;
  lockMode: "share" | "update";
  park: { reached: Deferred<void>; wait: Deferred<void> };
}): Promise<string> {
  const { db, candidate, examId, lockMode, park } = args;
  const ctx = candidate.ctx;

  return executeInTransaction(db, async (tx) => {
    const { exams, enrollments, attempts } = createExamEngineRepos(
      {
        examRepo: createExamRepo(tx),
        attemptRepo: createAttemptRepo(tx),
        enrollmentRepo: createEnrollmentRepo(tx),
      },
      ctx,
    );
    // Canonical EA lock prefix (Enrollment → Attempt) must be taken even
    // though only the examId is consumed below — it is part of the production
    // locking composition and the lock order under test.
    await lockEnrollmentAndAttempt(enrollments, attempts, candidate.attemptId);

    const exam =
      lockMode === "share"
        ? await exams.findByIdForShare(examId)
        : await exams.findByIdForUpdate(examId);
    if (!exam) throw new NotFoundError("exam row missing");

    park.reached.resolve();
    await park.wait.promise;
    return exam.id;
  });
}

async function readAttemptRow(
  ctx: Awaited<ReturnType<typeof buildTestApp>>,
  attemptId: string,
): Promise<ExamAttempt> {
  const rows = await ctx.db
    .select()
    .from(schema.examAttempts)
    .where(eq(schema.examAttempts.id, attemptId))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError("attempt row missing");
  return row as unknown as ExamAttempt;
}

async function readExamCloseAt(
  ctx: Awaited<ReturnType<typeof buildTestApp>>,
  examId: string,
): Promise<number> {
  const rows = await ctx.db
    .select()
    .from(schema.exams)
    .where(eq(schema.exams.id, examId))
    .limit(1);
  return rows[0]!.closeAt!.getTime();
}

describe("EXAM-558 — deadline-authority Exam read is a shared (FOR SHARE) row lock", () => {
  let iso: Awaited<ReturnType<typeof setupIsolatedTestDb>>;
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let db1: Database;
  let db2: Database;
  let sql1: PostgresSql;
  let sql2: PostgresSql;
  let sqlProbe: PostgresSql;

  beforeAll(async () => {
    const testDbUrl = resolveTestDbUrl();
    iso = await setupIsolatedTestDb({
      namespace: "api",
      databaseUrl: testDbUrl,
    });

    ctx = await buildTestApp(
      async (fastify) => {
        await fastify.register(examRoutes, { prefix: "" });
        await fastify.register(attemptRoutes, { prefix: "" });
      },
      { schemaName: iso.schemaName },
    );

    const conn1 = await createPostgresDatabase(iso.databaseUrl, iso.schemaName);
    const conn2 = await createPostgresDatabase(iso.databaseUrl, iso.schemaName);
    const connProbe = await createPostgresDatabase(
      iso.databaseUrl,
      iso.schemaName,
    );
    db1 = conn1.db;
    db2 = conn2.db;
    sql1 = conn1.sql;
    sql2 = conn2.sql;
    sqlProbe = connProbe.sql;
  }, 60_000);

  afterAll(async () => {
    await teardownAll(
      () => sqlProbe.end(),
      () => sql2.end(),
      () => sql1.end(),
      () => ctx.cleanup(),
      () => iso.cleanup(),
    );
  }, 30_000);

  // ── T1 — reader/reader coexistence at the Exam authority row ──────────

  it("T1 share/share: a second same-exam candidate decision completes while the first decision holds the shared lock", async () => {
    const fixture = await setupFixture(ctx, new Date(baseNow + 30 * MINUTE_MS));
    const pidB = await connectionPid(sql2);

    const park = {
      reached: createDeferred<void>("T1 A reached"),
      wait: createDeferred<void>("T1 A release"),
    };

    const aPromise = runParkedExamLockHolder({
      db: db1,
      candidate: fixture.candidateA,
      examId: fixture.examId,
      lockMode: "share",
      park,
    });
    await park.reached.promise;

    // While A parks: nothing is waiting behind the share holder (no
    // ungranted exams-tuple locks). PostgreSQL 18.x represents an
    // unconflicted row lock in the tuple's xmax WITHOUT a lock-manager
    // entry, so no granted tuple row is expected here either; the lock MODE
    // is proven behaviorally by B below plus the T1-control differential on
    // the identical schedule.
    const locksWhileParked = await examTupleLocks(sqlProbe, iso.schemaName);
    expect(locksWhileParked.filter((l) => !l.granted)).toEqual([]);

    // B runs the real decision composition targeting the SAME exam; it must
    // complete WITHOUT waiting for A's transaction to end.
    const bResult = await runCandidateDeadlineDecisionTx({
      db: db2,
      candidate: fixture.candidateB,
      now: new Date(baseNow),
    });
    expect(bResult.status).toBe("in_progress");
    // A is still parked: its release deferred has not been settled, so B's
    // completion provably did not wait for A's transaction to end.
    expect(park.wait.isSettled()).toBe(false);

    expect(await blockingPids(sqlProbe, pidB)).toEqual([]);
    park.wait.resolve();
    expect(await aPromise).toBe(fixture.examId);
  }, 30_000);

  it("T1-control FOR UPDATE baseline: the identical schedule serializes — the second decision waits on the holder's Exam row lock (the convoy this lock mode removes)", async () => {
    const fixture = await setupFixture(ctx, new Date(baseNow + 30 * MINUTE_MS));
    const pidA = await connectionPid(sql1);
    const pidB = await connectionPid(sql2);

    const park = {
      reached: createDeferred<void>("T1-control A reached"),
      wait: createDeferred<void>("T1-control A release"),
    };

    const aPromise = runParkedExamLockHolder({
      db: db1,
      candidate: fixture.candidateA,
      examId: fixture.examId,
      lockMode: "update",
      park,
    });
    await park.reached.promise;

    let bSettled = false;
    const bPromise = runCandidateDeadlineDecisionTx({
      db: db2,
      candidate: fixture.candidateB,
      now: new Date(baseNow),
    }).then((result) => {
      bSettled = true;
      return result;
    });

    // Bounded NEGATIVE observation: B must not settle while A is parked.
    const outcome = await Promise.race([
      bPromise.then(() => "settled" as const),
      delay(1500).then(() => "still-parked" as const),
    ]);
    expect(outcome).toBe("still-parked");

    // Positive evidence: B is blocked BY A on the Exam row.
    expect(await blockingPids(sqlProbe, pidB)).toContain(pidA);
    expect(bSettled).toBe(false);

    park.wait.resolve();
    const [aHolderExam, bResult] = await Promise.all([aPromise, bPromise]);
    expect(aHolderExam).toBe(fixture.examId);
    expect(bResult.status).toBe("in_progress");
  }, 30_000);

  // ── T2 — the shared reader lock still blocks the real authority writer ──

  it("T2 share blocks the real extend writer: POST /exams/:id/extend cannot pass the serialization point until the parked decision releases, then applies", async () => {
    const closeAt = new Date(baseNow + 30 * MINUTE_MS);
    const fixture = await setupFixture(ctx, closeAt);
    const pidA = await connectionPid(sql1);

    const park = {
      reached: createDeferred<void>("T2 A reached"),
      wait: createDeferred<void>("T2 A release"),
    };

    const aPromise = runParkedExamLockHolder({
      db: db1,
      candidate: fixture.candidateA,
      examId: fixture.examId,
      lockMode: "share",
      park,
    });
    await park.reached.promise;

    // Real operator surface: the supported live-exam authority writer.
    let extendSettled = false;
    const extendPromise = ctx.app
      .inject({
        method: "POST",
        url: `/api/exams/${fixture.examId}/extend`,
        payload: { extendMinutes: 30, reason: "EXAM-558 T2" },
        cookies: { "auth-token": fixture.adminToken },
      })
      .then((res: Awaited<ReturnType<typeof ctx.app.inject>>) => {
        extendSettled = true;
        return res;
      });

    // Bounded negative observation + positive lock evidence.
    const outcome = await Promise.race([
      extendPromise.then(() => "settled" as const),
      delay(1500).then(() => "blocked" as const),
    ]);
    expect(outcome).toBe("blocked");
    expect(extendSettled).toBe(false);

    // The writer is provably waiting: it holds at least one ungranted lock
    // (a row-lock waiter queues on the holder's transactionid; the ungranted
    // entry is not always a tuple row), and pg_blocking_pids attributes the
    // block to A directly.
    const waiting = await sqlProbe`
      SELECT l.pid AS pid, l.locktype AS locktype, l.mode AS mode
      FROM pg_locks l
      WHERE l.granted = false AND l.pid <> ${pidA}`;
    expect(waiting.length).toBeGreaterThanOrEqual(1);
    const writerPid = Number(waiting[0]!.pid);
    expect(await blockingPids(sqlProbe, writerPid)).toContain(pidA);

    park.wait.resolve();
    const extendRes = await extendPromise;
    expect(await aPromise).toBe(fixture.examId);
    expect(extendRes.statusCode).toBe(200);
    expect(await readExamCloseAt(ctx, fixture.examId)).toBe(
      closeAt.getTime() + 30 * MINUTE_MS,
    );
  }, 30_000);

  // ── T3 — writer-first ordering must defeat the stale snapshot ─────────

  it("T3 writer-first stale snapshot: no stale deadline decision can commit — the locking read aborts (observed 40001), the whole transaction retries, and the retry observes the new authority", async () => {
    // Under the OLD authority the attempt is expired (now > closeAt); the
    // writer's committed extension moves the authority past `now`. A
    // candidate decision that survived on the stale snapshot would freeze
    // the attempt at the old deadline — the failure this case excludes.
    const oldCloseAt = new Date(baseNow + MINUTE_MS);
    const fixture = await setupFixture(ctx, oldCloseAt);
    const now = new Date(oldCloseAt.getTime() + 1000);

    const park = {
      reached: createDeferred<void>("T3 A reached"),
      wait: createDeferred<void>("T3 A release"),
    };
    const sqlstates: string[] = [];

    const decisionPromise = runCandidateDeadlineDecisionTx({
      db: db1,
      candidate: fixture.candidateA,
      now,
      park,
      sqlstates,
    });
    await park.reached.promise;

    // Writer-first: the real extend route commits the new authority while
    // the candidate transaction is parked with its (older) RR snapshot.
    const extendRes = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${fixture.examId}/extend`,
      payload: { extendMinutes: 30, reason: "EXAM-558 T3" },
      cookies: { "auth-token": fixture.adminToken },
    });
    expect(extendRes.statusCode).toBe(200);

    park.wait.resolve();
    const reconciled = await decisionPromise;

    // The stale pass(es) lost at the locking read with the OBSERVED
    // SQLSTATE (40001 on PostgreSQL 18.4, ExecLockRows); the surviving pass
    // observed the committed extension.
    expect(sqlstates.length).toBeGreaterThanOrEqual(1);
    expect(sqlstates[0]).toBe("40001");

    expect(reconciled.status).toBe("in_progress");
    // Writer wins: no freeze at the stale deadline, attempt untouched.
    const attemptRow = await readAttemptRow(ctx, fixture.candidateA.attemptId);
    expect(attemptRow.status).toBe("in_progress");
    expect(attemptRow.submittedAt).toBeNull();
    expect(await readExamCloseAt(ctx, fixture.examId)).toBeGreaterThan(baseNow);
  }, 30_000);
});
