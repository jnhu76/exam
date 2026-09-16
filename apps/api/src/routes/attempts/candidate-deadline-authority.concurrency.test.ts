/**
 * EXAM-558 — Deterministic candidate take/submit deadline-authority
 * concurrency regression. Companion to
 * candidate-save-deadline-race.concurrency.test.ts (#543).
 *
 * Root cause (frozen by EXAM-558-DEADLINE-AUTHORITY-CODE-REALITY-AUDIT-1):
 * `ensureAttemptDeadlineReconciled` owned the deadline decision but not the
 * Exam serialization required to make that decision authoritative — take and
 * submit had NO designed Exam row lock, and on the live surface their only
 * abort mechanism against a concurrent closeAt writer was an INCIDENTAL,
 * ordering-dependent exams-FK RI-check 40001 (measured on the audit branch,
 * including a durable stale-freeze interleaving). The fix gives the seam the
 * serialization point itself: EA affinity assertion → Attempt (via the
 * capability) → Exam FOR UPDATE → deadline decision, so the canonical lock
 * order Enrollment → Attempt → Exam holds on every caller and the 40001 +
 * whole-tx retry comes from the DESIGNED lock, never from incidental FK/RI
 * behavior.
 *
 * Schedules (no sleeps gate any outcome — interleavings are forced by
 * deferred park points inside the transaction composition and by an
 * enrollment row-lock barrier; the writer is the REAL operator extend route):
 *
 *   T2 submit, writer-first: the REAL submitAndGradeAttempt orchestrator is
 *     parked at the EA seam (its RR snapshot already fixed at the pre-extension
 *     closeAt) while the extension commits; after release the reconciliation's
 *     Exam FOR UPDATE must raise 40001 and the whole-tx retry must complete the
 *     candidate's MANUAL submit under the extended authority — never a durable
 *     deadline freeze at the stale closeAt.
 *   T3 take, writer-first: the take route's production transaction
 *     composition, parked between the EA seam and the reconciliation, with the
 *     injected now past the old closeAt (the stale authority says "expired").
 *     The extension committed in-flight must govern: the stale pass aborts at
 *     the designed Exam lock (≥2 composition passes = the 40001 retry fired),
 *     the retry observes the extended authority, and the attempt stays
 *     in_progress.
 *   T4 take, candidate-wins: the composition parks AFTER the reconciliation
 *     (holding the Exam lock); the extend route must queue behind it, the take
 *     commits under the then-current authority (a valid linearization), and
 *     the extension still applies. The submit path shares this exact seam code
 *     (its candidate-wins ordering is proven for save by #543-H3 and for take
 *     here; a mid-orchestrator park point does not exist to stage it
 *     separately).
 *
 * Mechanism attribution: T2/T3 pin the OUTCOME (no stale freeze; retry
 * converges on the extended authority). In these writer-first schedules a
 * mechanical revert of the seam's locked read would still abort + retry via
 * the incidental FK RI mechanism with identical observable outcomes, so the
 * mechanism itself — the 40001 arising at the DESIGNED Exam lock — is held by
 * the structural pins (lock-order.structural.test.ts) and the unit-trace test
 * (deadlineReconciliation.test.ts: the Exam row lock is the first Exam access
 * and precedes every freeze write).
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
import {
  ensureAttemptDeadlineReconciled,
  lockEnrollmentAndAttempt,
} from "@exam/exam-engine";
import type { SubmitInterruptionResolution } from "@exam/exam-engine";
import { submitAndGradeAttempt } from "../../orchestrators/submitAndGradeAttempt.js";
import {
  createExamEngineRepos,
  createGradingWorksetRepoAdapter,
  createInterruptionEpisodeRepoAdapter,
  createInterruptionEventRepoAdapter,
} from "../../adapters/repoAdapters.js";
import { hashPassword } from "@exam/auth/src/password.js";
import { signJWT } from "@exam/auth/src/session.js";
import { getRuntimeConfig } from "../../config/runtimeConfig.js";
import type { Permission, RequestContext, Role } from "@exam/domain";
import { NotFoundError } from "@exam/domain";
import type { Database } from "@exam/db/src/types.js";
import { executeInTransaction } from "@exam/db/src/types.js";
import { createDeferred, type Deferred } from "../../testing/barrier.js";
import type { ExamAttempt } from "@exam/domain";
import { and, eq, sql as drizzleSql } from "drizzle-orm";

// The deadline scanner must never fire mid-schedule: these tests park
// transactions on purpose, and a background auto-submit would compete with
// the parked candidate path for the same rows. 1h interval ≈ never.
process.env.DEADLINE_SCAN_INTERVAL_MS = "3600000";

const MINUTE_MS = 60_000;

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

interface DeadlineRaceFixture {
  orgId: string;
  examId: string;
  attemptId: string;
  enrollmentId: string;
  candidateProfileId: string;
  candidateCtx: RequestContext;
  adminToken: string;
  candidateToken: string;
  /** The closeAt the exam row carries after fixture setup. */
  closeAt: Date;
}

async function setupFixture(
  ctx: Awaited<ReturnType<typeof buildTestApp>>,
  closeAt: Date,
): Promise<DeadlineRaceFixture> {
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
  const candidateUserId = randomUUID();
  for (const user of [
    { id: adminId, username: `admin-${slug}`, role: "Admin" },
    { id: candidateUserId, username: `cand-${slug}`, role: "Candidate" },
  ] as const) {
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
  const adminToken = signJWT(
    {
      actorId: adminId,
      role: "Admin" as Role,
      organizationId: org.id,
      authEpoch: 0,
    },
    jwtSecret,
  );
  const candidateToken = signJWT(
    {
      actorId: candidateUserId,
      role: "Candidate" as Role,
      organizationId: org.id,
      authEpoch: 0,
    },
    jwtSecret,
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

  // timingMode "deadline": the started attempt carries deadlineAt = null, so
  // the effective deadline IS the exam closeAt — an exact assertion oracle
  // for which authority each pass evaluated.
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
        timingMode: "deadline" as const,
        durationMinutes: null,
        openAt: new Date(Date.now() - 60 * MINUTE_MS),
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

  const profile = (
    await ctx.db
      .insert(schema.candidateProfiles)
      .values({
        id: randomUUID(),
        organizationId: org.id,
        userId: candidateUserId,
        fields: {},
        createdAt: now,
        updatedAt: now,
      })
      .returning()
  )[0]!;

  const enrollRes = await ctx.app.inject({
    method: "POST",
    url: `/api/exams/${exam.id}/enrollments`,
    payload: { candidateIds: [profile.id] },
    cookies: { "auth-token": adminToken },
  });
  if (enrollRes.statusCode !== 200) {
    throw new Error(`enroll failed: ${enrollRes.statusCode} ${enrollRes.body}`);
  }

  const startRes = await ctx.app.inject({
    method: "POST",
    url: `/api/attempts/${exam.id}/start`,
    cookies: { "auth-token": candidateToken },
  });
  if (startRes.statusCode !== 201) {
    throw new Error(`start failed: ${startRes.statusCode} ${startRes.body}`);
  }

  const enrollmentRow = (
    await ctx.db
      .select()
      .from(schema.examEnrollments)
      .where(
        and(
          eq(schema.examEnrollments.examId, exam.id),
          eq(schema.examEnrollments.candidateId, profile.id),
        ),
      )
      .limit(1)
  )[0];

  const candidateCtx: RequestContext = {
    actorId: candidateUserId,
    organizationId: org.id,
    role: "Candidate",
    permissions: [] as Permission[],
    sessionId: "exam-558-candidate",
    targetOrganizationId: org.id,
  };

  return {
    orgId: org.id,
    examId: exam.id,
    attemptId: startRes.json().id as string,
    enrollmentId: enrollmentRow?.id ?? "",
    candidateProfileId: profile.id,
    candidateCtx,
    adminToken,
    candidateToken,
    closeAt,
  };
}

/**
 * The take route's production transaction composition
 * (apps/api/src/routes/attempts.candidate.ts GET .../take), with the route's
 * wall-clock `now` injected and optional deterministic parking:
 *   - "beforeReconciliation": parked between the EA seam and the deadline
 *     reconciliation — the RR snapshot is fixed (EA locator read) and the
 *     EA locks are held, but the Exam authority is not yet touched.
 *   - "afterReconciliation": parked holding every lock the path acquires —
 *     Enrollment → Attempt → Exam — so a concurrent exam writer must queue
 *     behind it (candidate-wins ordering).
 * `passCount` counts composition executions (the whole-tx 40001 retry
 * re-enters the callback); `observedStatuses` records the reconciliation
 * outcome of every pass that survived to a decision.
 */
async function runProductionTakeComposition(args: {
  db: Database;
  fixture: DeadlineRaceFixture;
  now: Date;
  park?: {
    beforeReconciliation?: Deferred<void>;
    beforeReconciliationWait?: Deferred<void>;
    afterReconciliation?: Deferred<void>;
    afterReconciliationWait?: Deferred<void>;
  };
  passCount?: number[];
  observedStatuses?: string[];
}): Promise<ExamAttempt> {
  const { db, fixture, now, park, passCount, observedStatuses } = args;
  const ctx = fixture.candidateCtx;

  return executeInTransaction(db, async (tx) => {
    passCount?.push(1);
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
      fixture.attemptId,
    );

    const preRead = await attempts.findById(fixture.attemptId);
    const episodeRepo = createInterruptionEpisodeRepoAdapter(
      createAttemptInterruptionRepo(tx),
      ctx,
    );
    const eventRepo = createInterruptionEventRepoAdapter(
      createAttemptInterruptionEventRepo(tx),
      ctx,
    );
    const resolution: SubmitInterruptionResolution =
      preRead?.status === "disrupted"
        ? {
            mode: "active_interruption",
            episodeRepo,
            eventRepo,
            hint: {
              policy:
                preRead.interruptionTimingPolicySnapshot?.policy ?? "strict",
              eligibleSeconds: null,
              adjustmentId: null,
              reasonCode: "deadline_terminalization",
            },
          }
        : { mode: "none", episodeRepo, eventRepo };

    if (park?.beforeReconciliation) {
      park.beforeReconciliation.resolve();
      await park.beforeReconciliationWait!.promise;
    }

    const reconciled = await ensureAttemptDeadlineReconciled(
      exams,
      enrollments,
      attempts,
      createGradingWorksetRepoAdapter(createAttemptGradingEntryRepo(tx), ctx),
      cap,
      now,
      resolution,
    );
    observedStatuses?.push(reconciled.status);

    if (park?.afterReconciliation) {
      park.afterReconciliation.resolve();
      await park.afterReconciliationWait!.promise;
    }

    if (reconciled.candidateId !== fixture.candidateProfileId) {
      throw new NotFoundError("Attempt not found");
    }
    return reconciled;
  });
}

/** Barrier pair for parking the in-flight candidate path at one point. */
function createPark(): {
  reached: Deferred<void>;
  wait: Deferred<void>;
} {
  return {
    reached: createDeferred<void>("park reached"),
    wait: createDeferred<void>("park release"),
  };
}

/**
 * Enrollment row-lock barrier on a dedicated connection: the candidate
 * transaction's first statement (the EA locator read) fixes its RR snapshot,
 * then it deterministically blocks at the seam's Enrollment FOR UPDATE —
 * after snapshot-fix, before any exam access. Arrival is observed precisely
 * via pg_locks waiters on the barrier transaction's own xid (a liveness
 * predicate with a hard timeout — a miss fails the test loudly, it never
 * degrades into a timing assumption).
 */
async function startEnrollmentBarrier(
  fixture: DeadlineRaceFixture,
  databaseUrl: string,
  schemaName: string,
): Promise<{
  holding: Deferred<void>;
  waiterSeen: Deferred<void>;
  release: Deferred<void>;
  done: Promise<unknown>;
  close: () => Promise<void>;
}> {
  const holding = createDeferred<void>("barrier holding");
  const waiterSeen = createDeferred<void>("barrier waiter seen");
  const release = createDeferred<void>("barrier release");
  holding.promise.catch(() => {});
  waiterSeen.promise.catch(() => {});
  release.promise.catch(() => {});

  // Two dedicated single-connection pools: connTx reserves its only session
  // for the barrier transaction; connProbe must NOT share that pool (max:1
  // pools would queue the pg_locks predicate behind the parked transaction).
  const connTx = await createPostgresDatabase(databaseUrl, schemaName);
  const connProbe = await createPostgresDatabase(databaseUrl, schemaName);
  const done = executeInTransaction(connTx.db, async (tx) => {
    const enrollmentRepo = createEnrollmentRepo(tx);
    const enrollment = await enrollmentRepo.findByExamAndCandidateForUpdate(
      fixture.candidateCtx,
      fixture.examId,
      fixture.candidateProfileId,
    );
    if (!enrollment) {
      throw new NotFoundError("barrier: enrollment row missing");
    }
    holding.resolve();
    const xidResult = (await tx.execute(
      drizzleSql`SELECT txid_current()::text AS xid`,
    )) as unknown;
    const xidRows =
      (xidResult as { rows?: Array<{ xid: string }> }).rows ??
      (xidResult as Array<{ xid: string }>);
    const xid = xidRows[0]!.xid;
    const predicateDeadline = Date.now() + 10_000;
    for (;;) {
      const waiters = await connProbe.sql`
        SELECT count(*)::int AS n
        FROM pg_locks
        WHERE locktype = 'transactionid'
          AND NOT granted
          AND transactionid = ${xid}::xid
      `;
      if (((waiters[0] as { n: number }).n ?? 0) > 0) {
        waiterSeen.resolve();
        break;
      }
      if (Date.now() > predicateDeadline) {
        throw new Error("no lock waiter appeared on the barrier transaction");
      }
      await new Promise((r) => setTimeout(r, 20));
    }
    await release.promise;
  }).catch((err) => err as Error);

  return {
    holding,
    waiterSeen,
    release,
    done,
    close: async () => {
      await connTx.sql.end();
      await connProbe.sql.end();
    },
  };
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

async function readExamRow(
  ctx: Awaited<ReturnType<typeof buildTestApp>>,
  examId: string,
): Promise<{ closeAt: Date | null }> {
  const row = (
    await ctx.db
      .select()
      .from(schema.exams)
      .where(eq(schema.exams.id, examId))
      .limit(1)
  )[0];
  if (!row) throw new NotFoundError("exam row missing");
  return { closeAt: row.closeAt };
}

/** The REAL operator writer: POST /exams/:id/extend (positive-only, later). */
async function extendExam(
  ctx: Awaited<ReturnType<typeof buildTestApp>>,
  fixture: DeadlineRaceFixture,
  extendMinutes: number,
): Promise<{ statusCode: number }> {
  return ctx.app.inject({
    method: "POST",
    url: `/api/exams/${fixture.examId}/extend`,
    payload: { extendMinutes, reason: "EXAM-558 concurrency regression" },
    cookies: { "auth-token": fixture.adminToken },
  });
}

describe("EXAM-558 — take/submit deadline authority vs concurrent closeAt change", () => {
  let iso: Awaited<ReturnType<typeof setupIsolatedTestDb>>;
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let db1: Database;
  let sql1: { end(): Promise<void> };

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
    db1 = conn1.db;
    sql1 = conn1.sql;
  }, 60_000);

  afterAll(async () => {
    await teardownAll(
      () => sql1.end(),
      () => ctx.cleanup(),
      () => iso.cleanup(),
    );
  }, 30_000);

  it("T2 submit writer-first: an extension committing while the submit is parked governs — the retry completes the MANUAL submit, never a stale deadline freeze", async () => {
    // The candidate's submit arrives past the OLD closeAt (its stale
    // authority says "expired" — the pre-fix code froze durably in exactly
    // this interleaving). The extension commits while the orchestrator is
    // parked at the EA seam. Post-fix, the reconciliation's Exam FOR UPDATE
    // raises 40001 against the committed extension and the whole-tx retry
    // completes the candidate's manual submit under the extended window.
    const closeAt = new Date(Date.now() + 60 * MINUTE_MS);
    const extendedCloseAt = new Date(closeAt.getTime() + 30 * MINUTE_MS);
    const fixture = await setupFixture(ctx, closeAt);
    // Injected arrival now: past the old closeAt (stale-freeze geometry),
    // before the extended one (the manual submit is legitimate).
    const arrivalNow = new Date(closeAt.getTime() + 1_000);

    const barrier = await startEnrollmentBarrier(
      fixture,
      iso.databaseUrl,
      iso.schemaName,
    );
    try {
      await barrier.holding.promise;

      const submitPromise = submitAndGradeAttempt(
        db1,
        fixture.candidateCtx,
        fixture.attemptId,
        fixture.candidateProfileId,
        arrivalNow,
      ).catch((err) => err as Error);

      await barrier.waiterSeen.promise;

      // The extension commits while the submit holds no exam lock —
      // writer-first ordering, deterministically before the release.
      const extendRes = await extendExam(ctx, fixture, 30);
      expect(extendRes.statusCode).toBe(200);

      barrier.release.resolve();
      await barrier.done;

      const result = (await submitPromise) as unknown as {
        attempt: ExamAttempt;
        alreadyGraded: boolean;
      };
      if (result instanceof Error) {
        throw result;
      }

      // The candidate submit WON on the retried pass: manual reason, the
      // candidate's own submit instant — never submissionReason='deadline'
      // with submittedAt = the stale (pre-extension) closeAt.
      expect(result.alreadyGraded).toBe(false);
      expect(result.attempt.submissionReason).toBe("manual");
      expect(result.attempt.submittedAt!.getTime()).toBe(arrivalNow.getTime());
      expect(["submitted", "graded"]).toContain(result.attempt.status);

      const attemptRow = await readAttemptRow(ctx, fixture.attemptId);
      expect(attemptRow.submissionReason).toBe("manual");
      expect(attemptRow.submittedAt!.getTime()).toBe(arrivalNow.getTime());

      const examRow = await readExamRow(ctx, fixture.examId);
      expect(examRow.closeAt!.getTime()).toBe(extendedCloseAt.getTime());
    } finally {
      barrier.release.resolve();
      await barrier.done;
      await barrier.close();
    }
  }, 40_000);

  it("T3 take writer-first: the stale pass aborts at the designed Exam lock (40001 retry) and the retry keeps the attempt in_progress under the extended authority", async () => {
    // Same freeze geometry through /take: the composition's injected now is
    // past the old closeAt, so the stale authority says "expired". The
    // extension commits while the take is parked between the EA seam and the
    // reconciliation. The reconciliation's Exam FOR UPDATE must abort the
    // stale pass (≥2 composition passes proves the whole-tx 40001 retry
    // fired); the surviving pass observes the extended authority and does not
    // freeze.
    const closeAt = new Date(Date.now() + 60 * MINUTE_MS);
    const extendedCloseAt = new Date(closeAt.getTime() + 30 * MINUTE_MS);
    const fixture = await setupFixture(ctx, closeAt);
    const staleNow = new Date(closeAt.getTime() + 1_000);

    const park = createPark();
    const passCount: number[] = [];
    const observedStatuses: string[] = [];

    const takePromise = runProductionTakeComposition({
      db: db1,
      fixture,
      now: staleNow,
      park: {
        beforeReconciliation: park.reached,
        beforeReconciliationWait: park.wait,
      },
      passCount,
      observedStatuses,
    }).catch((err) => err as Error);

    await park.reached.promise;

    const extendRes = await extendExam(ctx, fixture, 30);
    expect(extendRes.statusCode).toBe(200);

    park.wait.resolve();
    const taken = (await takePromise) as unknown as ExamAttempt;
    if (taken instanceof Error) {
      throw taken;
    }

    // The stale first pass never survived to a deadline decision: the only
    // recorded pass evaluated the extended authority and did not freeze.
    expect(passCount.length).toBeGreaterThanOrEqual(2);
    expect(observedStatuses).toEqual(["in_progress"]);
    expect(taken.status).toBe("in_progress");

    const attemptRow = await readAttemptRow(ctx, fixture.attemptId);
    expect(attemptRow.status).toBe("in_progress");
    expect(attemptRow.submittedAt).toBeNull();
    expect(attemptRow.submissionReason).toBeNull();

    const examRow = await readExamRow(ctx, fixture.examId);
    expect(examRow.closeAt!.getTime()).toBe(extendedCloseAt.getTime());
  }, 40_000);

  it("T4 take candidate-wins: an extension arriving after the take holds its Exam serialization point queues and applies after the take commits", async () => {
    // Parked AFTER the reconciliation, the take holds Enrollment → Attempt →
    // Exam. The extend route's Exam FOR UPDATE must wait behind it; the take
    // commits under the then-current (pre-extension) authority — a valid
    // linearization, not a bug — and the extension still applies.
    const closeAt = new Date(Date.now() + 30 * MINUTE_MS);
    const extendedCloseAt = new Date(closeAt.getTime() + 30 * MINUTE_MS);
    const fixture = await setupFixture(ctx, closeAt);

    const park = createPark();
    const passCount: number[] = [];
    const observedStatuses: string[] = [];

    const takePromise = runProductionTakeComposition({
      db: db1,
      fixture,
      now: new Date(),
      park: {
        afterReconciliation: park.reached,
        afterReconciliationWait: park.wait,
      },
      passCount,
      observedStatuses,
    }).catch((err) => err as Error);

    await park.reached.promise;

    // Launched while the take holds the Exam lock — it cannot commit before
    // the take releases it.
    const extendPromise = extendExam(ctx, fixture, 30);

    park.wait.resolve();
    const taken = (await takePromise) as unknown as ExamAttempt;
    if (taken instanceof Error) {
      throw taken;
    }

    // Exactly one composition pass — the take was never invalidated.
    expect(passCount).toHaveLength(1);
    expect(observedStatuses).toEqual(["in_progress"]);
    expect(taken.status).toBe("in_progress");

    const extendRes = await extendPromise;
    expect(extendRes.statusCode).toBe(200);

    const attemptRow = await readAttemptRow(ctx, fixture.attemptId);
    expect(attemptRow.status).toBe("in_progress");
    expect(attemptRow.submittedAt).toBeNull();

    const examRow = await readExamRow(ctx, fixture.examId);
    expect(examRow.closeAt!.getTime()).toBe(extendedCloseAt.getTime());
  }, 40_000);
});
