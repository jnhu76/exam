/**
 * #1038 R-T3-1 / R-ENG-1 — terminal grading vs extendExam authority race.
 *
 * The Enrollment terminal decision (`shouldEnrollmentComplete` — exam.closeAt,
 * retakePolicy) is a LIVE-fact decision (EXSEM-011/013: the exam window is a
 * legitimate live authority), but the canonical terminal closure
 * `finalizeTerminalGrading` consumed a CALLER-PROVIDED Exam snapshot. The
 * grade-question route read that Exam OUTSIDE its transaction
 * (`createGradingQueueRepo(fastify.db).findExamById` — a plain SELECT), and
 * the in-transaction paths read it with a plain (non-locking) read. Neither
 * read serializes against a concurrent legal `extendExam`, so:
 *
 *   extend commits closeAt T1→T2 while a grading command holds a T1 snapshot
 *   → shouldEnrollmentComplete(stale T1, now ∈ [T1, T2)) → "completed"
 *   → Enrollment.completed is IRREVERSIBLE (enrollmentStateMachine: no
 *     outgoing edges) → the candidate can never retake although the
 *     authoritative window is open until T2.
 *
 * Schedules (all deterministic — deferred barriers, injected `now`, no sleeps):
 *
 *   A  extend-commits-inside-the-decision-window — the RED oracle against
 *      master's defect and its regression guard after the fix. The grading
 *      transaction takes its EA locks and fixes its REPEATABLE READ snapshot
 *      FIRST, then parks; the REAL extend route commits closeAt T1→T2 while
 *      the grading transaction is parked (it holds no Exam lock, so nothing
 *      blocks the writer); grading then resumes and reaches the terminal
 *      closure, whose Exam authority read must observe the NEW window:
 *      under REPEATABLE READ a plain (non-locking) read keeps returning the
 *      stale pre-extend snapshot — exactly master's defect, which completed
 *      the enrollment irreversibly — while the closure's FOR SHARE read
 *      raises 40001 and the whole transaction retries onto the committed
 *      T2 authority. The test asserts the retry happened (via the
 *      transaction-retry logger) and the enrollment stays `started`.
 *   B  decision-before-extend — the legal reader-first order. The grading
 *      transaction linearizes BEFORE the extend (its locked read observes the
 *      then-authoritative T1 and completes the enrollment); the extend then
 *      commits T2. Per the candidate-wins linearization contract (EXAM-558)
 *      the two orders need NOT agree — B stays `completed`.
 *   C  fresh-read control (detection capability) — the REAL grade-question
 *      route runs wholly AFTER the extend committed (route clock injected to
 *      the same divergence instant `now ∈ [T1, T2)`), so its Exam read is
 *      fresh. The enrollment must stay `started`. Passing on master proves
 *      the fixture does not unconditionally complete and that A's `completed`
 *      is caused by the stale snapshot, not by the schedule's `now`.
 */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createPostgresDatabase } from "@exam/db/postgres";
import { setupIsolatedTestDb } from "@exam/db/testIsolation";
import { resolveTestDbUrl } from "@exam/db/testDb";
import { buildTestApp } from "../testHelpers.js";
import examRoutes from "../exam.js";
import attemptRoutes from "../attempts.js";
import { schema } from "@exam/db/schema/pg";
import { createExamRepo } from "@exam/db/repository/examRepo";
import { createAttemptRepo } from "@exam/db/repository/attemptRepo";
import { createEnrollmentRepo } from "@exam/db/repository/enrollmentRepo";
import { createAttemptGradingEntryRepo } from "@exam/db/repository/attemptGradingEntryRepo";
import {
  executeInTransaction,
  setTransactionRetryLogger,
  type TransactionRetryLogger,
} from "@exam/db/types";
import { gradeQuestion, lockEnrollmentAndAttempt } from "@exam/exam-engine";
import type {
  Permission,
  QuestionSnapshot,
  RequestContext,
  Role,
} from "@exam/domain";
import {
  createExamEngineRepos,
  createGradingWorksetRepoAdapter,
} from "../../adapters/repoAdapters.js";
import { createDeferred } from "../../testing/barrier.js";
import { hashPassword } from "@exam/auth/password";
import { signJWT } from "@exam/auth/session";
import { getRuntimeConfig } from "../../config/runtimeConfig.js";

process.env.DEADLINE_SCAN_INTERVAL_MS = "3600000";

const MINUTE_MS = 60_000;

/** A dedicated-connection pool handle from createPostgresDatabase. */
type PgConn = Awaited<ReturnType<typeof createPostgresDatabase>>;

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

describe("terminal grading vs extendExam — Exam authority race (#1038)", () => {
  let iso: Awaited<ReturnType<typeof setupIsolatedTestDb>>;
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let adminCtx: RequestContext;
  let adminToken: string;

  /**
   * Seeds one org/admin and per-test exams/attempts via direct inserts.
   * The exam carries a single text_response (manual) question so terminal
   * closure runs exactly when gradeQuestion completes the one pending entry.
   * retakePolicy=unlimited + attemptCount=1 < maxAttempts isolates closeAt as
   * the ONLY shouldEnrollmentComplete input that can fire.
   */
  async function seedPendingManualAttempt(closeAt: Date): Promise<{
    attemptId: string;
    examId: string;
    questionId: string;
  }> {
    const now = new Date();
    const slug = `tga-${randomUUID().slice(0, 8)}`;
    const orgId = ctx.org.id;
    // ExamSchema requires questionIds to be UUIDs (the extend response
    // serializes the whole exam row).
    const questionId = randomUUID();

    const candidateUserId = randomUUID();
    await ctx.db.insert(schema.users).values({
      id: candidateUserId,
      organizationId: orgId,
      username: `cand-${slug}`,
      passwordHash: await hashPassword("password123"),
      name: "Candidate",
      role: "Candidate",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert(schema.userRoleAssignments).values({
      id: randomUUID(),
      organizationId: orgId,
      userId: candidateUserId,
      role: "Candidate",
      isPrimary: true,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const profileId = (
      await ctx.db
        .insert(schema.candidateProfiles)
        .values({
          id: randomUUID(),
          organizationId: orgId,
          userId: candidateUserId,
          fields: {},
          createdAt: now,
          updatedAt: now,
        })
        .returning()
    )[0]!.id;

    const examId = randomUUID();
    const questionSnapshot: QuestionSnapshot[] = [
      {
        originalQuestionId: questionId,
        type: "text_response" as const,
        content: "terminal authority essay",
        contentDocument: null,
        answerMode: null,
        attachments: [],
        options: [],
        standardAnswer: null,
        score: 10,
        gradingRule: {
          multiSelectScoring: "all_correct_full",
          fillBlankMatchMode: "exact",
        },
        order: 0,
        rubric: null,
      },
    ];
    await ctx.db.insert(schema.exams).values({
      id: examId,
      organizationId: orgId,
      title: `Terminal Authority ${slug}`,
      description: "",
      courseId: (
        await ctx.db
          .insert(schema.courses)
          .values({
            id: randomUUID(),
            organizationId: orgId,
            name: `Course ${slug}`,
            code: `C-${slug}`,
            description: "",
            createdAt: now,
            updatedAt: now,
          })
          .returning()
      )[0]!.id,
      status: "open",
      timingMode: "deadline",
      durationMinutes: null,
      openAt: new Date(now.getTime() - 60 * MINUTE_MS),
      closeAt,
      passingScore: 5,
      totalScore: 10,
      questionSelectionMode: "manual",
      questionIds: [questionId],
      questionSnapshot,
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
        showResultImmediately: false,
      },
      retakePolicy: "unlimited",
      scoreStrategy: "highest",
      maxAttempts: 10,
      createdAt: now,
      updatedAt: now,
    });

    const enrollmentRepo = createEnrollmentRepo(ctx.db);
    const attemptRepo = createAttemptRepo(ctx.db);
    const enrollment = await enrollmentRepo.create(adminCtx, {
      examId,
      candidateId: profileId,
      status: "started",
      attemptCount: 1,
    });
    const attempt = await attemptRepo.create(adminCtx, {
      examId,
      enrollmentId: enrollment.id,
      candidateId: profileId,
      attemptNo: 1,
      status: "submitted",
      gradingStatus: "pending_manual",
      questionSnapshot,
      answers: [],
      submittedAnswers: { schemaVersion: 1, answers: [] },
      submittedAt: now,
    });
    await createAttemptGradingEntryRepo(ctx.db).bulkCreate(
      adminCtx,
      questionSnapshot.map((q) => ({
        attemptId: attempt.id,
        questionId: q.originalQuestionId,
        gradingMode: "manual" as const,
        status: "pending_manual" as const,
        maxScore: q.score,
        earnedScore: null,
        candidateAnswer: null,
        standardAnswer: null,
        correct: null,
      })),
    );
    return { attemptId: attempt.id, examId, questionId };
  }

  /** The REAL exam-window writer: POST /api/exams/:id/extend (route legality:
   *  lock → reconcile → status must be open → closeAt += minutes). */
  async function extendExam(
    examId: string,
    extendMinutes: number,
  ): Promise<void> {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/extend`,
      payload: {
        extendMinutes,
        reason: "terminal-grading authority race witness",
      },
      cookies: { "auth-token": adminToken },
    });
    expect(res.statusCode, `extend failed: ${res.statusCode} ${res.body}`).toBe(
      200,
    );
  }

  async function readEnrollmentStatus(
    attemptId: string,
  ): Promise<string | undefined> {
    const row = (
      await ctx.db
        .select({
          status: schema.examEnrollments.status,
        })
        .from(schema.examAttempts)
        .innerJoin(
          schema.examEnrollments,
          eq(schema.examAttempts.enrollmentId, schema.examEnrollments.id),
        )
        .where(eq(schema.examAttempts.id, attemptId))
        .limit(1)
    )[0];
    return row?.status;
  }

  async function readExamCloseAt(examId: string): Promise<Date | null> {
    const row = (
      await ctx.db
        .select({ closeAt: schema.exams.closeAt })
        .from(schema.exams)
        .where(eq(schema.exams.id, examId))
        .limit(1)
    )[0];
    return row?.closeAt ?? null;
  }

  beforeAll(async () => {
    iso = await setupIsolatedTestDb({
      namespace: "api",
      databaseUrl: resolveTestDbUrl(),
    });
    ctx = await buildTestApp(
      async (fastify) => {
        await fastify.register(examRoutes, { prefix: "" });
        await fastify.register(attemptRoutes, { prefix: "" });
      },
      { schemaName: iso.schemaName, logger: { level: "error" } },
    );

    const now = new Date();
    const passwordHash = await hashPassword("password123");
    const adminId = randomUUID();
    const slug = `tga-admin-${randomUUID().slice(0, 8)}`;
    await ctx.db.insert(schema.users).values({
      id: adminId,
      organizationId: ctx.org.id,
      username: slug,
      passwordHash,
      name: "Admin",
      role: "Admin",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert(schema.userRoleAssignments).values({
      id: randomUUID(),
      organizationId: ctx.org.id,
      userId: adminId,
      role: "Admin",
      isPrimary: true,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    adminCtx = {
      actorId: adminId,
      organizationId: ctx.org.id,
      role: "Admin",
      permissions: [] as Permission[],
      sessionId: "terminal-grading-concurrency",
      targetOrganizationId: ctx.org.id,
    };
    adminToken = signJWT(
      {
        actorId: adminId,
        role: "Admin" as Role,
        organizationId: ctx.org.id,
        authEpoch: 0,
      },
      getRuntimeConfig().authSecret.jwtSecret,
    );
  }, 60_000);

  afterAll(async () => {
    await teardownAll(
      () => ctx.cleanup(),
      () => iso.cleanup(),
    );
  }, 30_000);

  it("A: extend committed inside the decision window — FOR SHARE serialization keeps the enrollment started", async () => {
    const wallNow = Date.now();
    const closeAtT1 = new Date(wallNow + 60 * MINUTE_MS);
    const closeAtT2 = new Date(wallNow + 90 * MINUTE_MS);
    const { attemptId, examId, questionId } =
      await seedPendingManualAttempt(closeAtT1);

    // Capture transaction retries so the test can PROVE the FOR SHARE read
    // serialized against the extend (40001 → whole-transaction retry) rather
    // than passing on a coincidentally fresh snapshot.
    const retries: Array<{ attempt: number; sqlstate?: string }> = [];
    const logger: TransactionRetryLogger = {
      warn(obj) {
        retries.push(obj as { attempt: number; sqlstate?: string });
      },
    };
    setTransactionRetryLogger(logger);

    // Grading connection — a real, dedicated pool distinct from the app pool
    // (two real connections: grader tx + extend route tx).
    const grader = await createPostgresDatabase(
      iso.databaseUrl,
      iso.schemaName,
    );
    // Barrier INSIDE the grading transaction: reached after the EA locks and
    // the REPEATABLE READ snapshot are fixed, before the terminal closure's
    // Exam authority read. Deferred promise — deterministic ordering, no
    // sleeps.
    const txParked = createDeferred<void>("grading tx parked pre-closure");
    const txRelease = createDeferred<void>("grading tx release");
    txRelease.promise.catch(() => {});

    let gradedResult: { fullyGraded: boolean } | undefined;
    const gradingDone = (async () => {
      gradedResult = await executeInTransaction(grader.db, async (tx) => {
        const txAttemptRepo = createAttemptRepo(tx);
        const txEnrollmentRepo = createEnrollmentRepo(tx);
        const txEntryRepo = createAttemptGradingEntryRepo(tx);
        const { exams, enrollments, attempts } = createExamEngineRepos(
          {
            examRepo: createExamRepo(tx),
            attemptRepo: txAttemptRepo,
            enrollmentRepo: txEnrollmentRepo,
          },
          adminCtx,
        );
        // EA lock first (canonical order); the locator read also fixes this
        // transaction's REPEATABLE READ snapshot BEFORE the extend commits.
        const cap = await lockEnrollmentAndAttempt(
          enrollments,
          attempts,
          attemptId,
        );
        txParked.resolve();
        await txRelease.promise;
        // The divergence instant: inside [T1, T2) — past the ORIGINAL close
        // boundary, inside the extended one. `now` is the injected canonical
        // server instant threaded from the route's fastify.now().
        const nowInDivergenceWindow = new Date(
          closeAtT1.getTime() + 5 * MINUTE_MS,
        );
        return gradeQuestion(
          attempts,
          enrollments,
          exams,
          createGradingWorksetRepoAdapter(txEntryRepo, adminCtx),
          cap,
          questionId,
          6,
          "terminal authority witness",
          adminCtx.actorId,
          nowInDivergenceWindow,
        );
      });
      return gradedResult;
    })().catch((err) => err as Error);

    try {
      await txParked.promise;
      // The legal extend COMMITS while the grading transaction is parked: the
      // persisted status is `open` and the wall clock is inside the original
      // window. The grader holds no Exam lock, so the writer is not blocked.
      await extendExam(examId, 30);
      expect(await readExamCloseAt(examId)).toEqual(closeAtT2);
      txRelease.resolve();

      const settled = await gradingDone;
      if (settled instanceof Error) throw settled;
      expect(gradedResult!.fullyGraded).toBe(true);

      // Linearization-point evidence: the closure's locked Exam read met the
      // concurrently committed closeAt change and the WHOLE transaction was
      // retried onto the new authority (40001 under REPEATABLE READ).
      expect(retries.length).toBeGreaterThan(0);
      expect(retries.some((r) => r.sqlstate === "40001")).toBe(true);

      // Final committed state: the authoritative window is open until T2 and
      // the decision instant is inside it — the enrollment must NOT have
      // been closed irreversibly.
      expect(await readEnrollmentStatus(attemptId)).toBe("started");
      expect(await readExamCloseAt(examId)).toEqual(closeAtT2);
      const attemptRow = (
        await ctx.db
          .select({ status: schema.examAttempts.status })
          .from(schema.examAttempts)
          .where(eq(schema.examAttempts.id, attemptId))
          .limit(1)
      )[0];
      expect(attemptRow?.status).toBe("graded");
    } finally {
      txRelease.resolve();
      setTransactionRetryLogger(null);
      await gradingDone.catch(() => {});
      await grader.sql.end();
    }
  }, 30_000);

  it("B: terminal decision committed before the extend — completed is the contract outcome (reader-first linearization)", async () => {
    const wallNow = Date.now();
    const closeAtT1 = new Date(wallNow + 60 * MINUTE_MS);
    const closeAtT2 = new Date(wallNow + 90 * MINUTE_MS);
    const { attemptId, examId, questionId } =
      await seedPendingManualAttempt(closeAtT1);

    const grader = await createPostgresDatabase(
      iso.databaseUrl,
      iso.schemaName,
    );
    try {
      // The grading transaction linearizes FIRST — at this instant the
      // committed authority IS T1 (the extend has not started), so completing
      // the enrollment at now ≥ T1 is correct-at-linearization-point for
      // this order.
      const nowPastT1 = new Date(closeAtT1.getTime() + 5 * MINUTE_MS);
      await executeInTransaction(grader.db, async (tx) => {
        const { exams, enrollments, attempts } = createExamEngineRepos(
          {
            examRepo: createExamRepo(tx),
            attemptRepo: createAttemptRepo(tx),
            enrollmentRepo: createEnrollmentRepo(tx),
          },
          adminCtx,
        );
        const cap = await lockEnrollmentAndAttempt(
          enrollments,
          attempts,
          attemptId,
        );
        return gradeQuestion(
          attempts,
          enrollments,
          exams,
          createGradingWorksetRepoAdapter(
            createAttemptGradingEntryRepo(tx),
            adminCtx,
          ),
          cap,
          questionId,
          6,
          "reader-first witness",
          adminCtx.actorId,
          nowPastT1,
        );
      });
      expect(await readEnrollmentStatus(attemptId)).toBe("completed");

      // The extend remains legal (persisted status open, wall clock inside
      // the original window) and commits afterwards; it must not be blocked
      // by the already-committed grading decision.
      await extendExam(examId, 30);

      // Contract: the two legal orders need not agree — the reader-first
      // linearization keeps the completed enrollment (irreversible state
      // machine), the exam window itself reflects the extension.
      expect(await readEnrollmentStatus(attemptId)).toBe("completed");
      expect(await readExamCloseAt(examId)).toEqual(closeAtT2);
    } finally {
      await grader.sql.end();
    }
  }, 30_000);

  it("C: fresh-read control — the REAL grade-question route wholly after the extend stays started (detection capability)", async () => {
    const wallNow = Date.now();
    const closeAtT1 = new Date(wallNow + 60 * MINUTE_MS);
    const closeAtT2 = new Date(wallNow + 90 * MINUTE_MS);
    const { attemptId, examId, questionId } =
      await seedPendingManualAttempt(closeAtT1);

    // The extend commits first; the route's own pre-read therefore observes
    // the fresh authority T2.
    await extendExam(examId, 30);
    expect(await readExamCloseAt(examId)).toEqual(closeAtT2);

    // Same divergence instant as schedule A, injected through the canonical
    // clock seam the route reads (fastify.now()).
    const injected = new Date(closeAtT1.getTime() + 5 * MINUTE_MS);
    ctx.setNow(injected);
    try {
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/admin/attempts/${attemptId}/grade-question`,
        payload: {
          questionId,
          score: 6,
          comment: "fresh-read control",
        },
        cookies: { "auth-token": adminToken },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().fullyGraded).toBe(true);
    } finally {
      ctx.setNow(null);
    }

    // Fresh authority (T2) + decision instant inside it → stays started.
    // Passing on master proves schedule A's `completed` comes from the stale
    // snapshot, not from an unconditional-completion property of the fixture.
    expect(await readEnrollmentStatus(attemptId)).toBe("started");
    expect(await readExamCloseAt(examId)).toEqual(closeAtT2);
  }, 30_000);
});
