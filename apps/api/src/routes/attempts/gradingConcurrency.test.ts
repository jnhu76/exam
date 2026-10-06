import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@exam/db/src/schema/pg.js";
import {
  createPostgresDatabase,
  migratePostgres,
} from "@exam/db/src/postgres.js";
import { setupIsolatedTestDb } from "@exam/db/src/testIsolation.js";
import { resolveTestDbUrl } from "@exam/db/src/testDb.js";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { createExamRepo } from "@exam/db/src/repository/examRepo.js";
import { createEnrollmentRepo } from "@exam/db/src/repository/enrollmentRepo.js";
import { createAttemptGradingEntryRepo } from "@exam/db/src/repository/attemptGradingEntryRepo.js";
import { executeInTransaction } from "@exam/db/src/types.js";
import type { Database } from "@exam/db/src/types.js";
import {
  computeGradingResult,
  finalizeGrading,
  lockEnrollmentAndAttempt,
} from "@exam/exam-engine";
import {
  createExamEngineRepos,
  createGradingWorksetRepoAdapter,
} from "../../adapters/repoAdapters.js";
import type { EnrollmentRepository } from "@exam/exam-engine";
import { hashPassword } from "@exam/auth/src/password.js";
import { createDeferred } from "../../testing/barrier.js";
import type { Deferred } from "../../testing/barrier.js";
import { collectConnectionEvidence } from "../../testing/operatorGrantConcurrencyHarness.js";
import {
  probeRowLockHeldNowait,
  waitForBackendBlocked,
  type ObserverSql,
} from "../../testing/pgConcurrencyProbes.js";
import type {
  ControlFlags,
  Exam,
  Permission,
  QuestionSnapshot,
  RequestContext,
  Role,
  ScoreResult,
} from "@exam/domain";

/**
 * Deterministic enrollment finalScore/finalAttemptId serialization proof.
 *
 * Fault model: two concurrent terminal graders race the enrollment
 * finalScore/finalAttemptId projection. Without the canonical seam's
 * Enrollment `FOR UPDATE` (acquired BEFORE the Attempt lock), both
 * transactions read the same pre-final state and the last committer can
 * overwrite a higher already-committed score (`highest` strategy loses).
 *
 * Each schedule below pins the interleaving deterministically with real
 * physical sessions and observer evidence — no `Promise.all` racing, no
 * repetition loops:
 *
 *   T1 (racer connection 1, max:1 pool):
 *     executeInTransaction (REPEATABLE READ, production composition)
 *       → lockEnrollmentAndAttempt seam step 2 acquires Enrollment FOR UPDATE
 *       → test hook signals enrollmentLockAcquired and PARKS the transaction
 *         mid-seam (before the Attempt lock) on a release gate
 *   Observer connection (independent):
 *     → SELECT ... FOR UPDATE NOWAIT on the enrollment row is rejected with
 *       SQLSTATE 55P03: T1 provably holds the Enrollment row lock
 *   T2 (racer connection 2, independent max:1 pool):
 *     the SAME production composition for the second attempt
 *       → its seam's Enrollment FOR UPDATE blocks on T1's row lock
 *       → proven via pg_locks ungranted-lock probe on T2's backend pid
 *   Release:
 *     T1 completes the seam, finalizes, commits; T2 wakes (directly or via
 *     the REPEATABLE READ 40001 whole-transaction retry), re-reads the
 *     committed enrollment state, and recomputes selection against it.
 *
 * Schedules H, L, E below cover both commit orders plus the equal-score
 * decline oracle. The durable final enrollment row is the oracle.
 */

interface ConcurrencyFixture {
  adminCtx: RequestContext;
  exam: Exam;
  enrollmentId: string;
  attemptHighId: string;
  attemptLowId: string;
}

async function buildFixture(
  db: Database,
  highCorrect: boolean,
  lowCorrect: boolean,
): Promise<ConcurrencyFixture> {
  const slug = `grade-serialization-${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date();
  const orgId = crypto.randomUUID();
  const courseId = crypto.randomUUID();
  const questionId = crypto.randomUUID();
  const candidateUserId = crypto.randomUUID();
  const profileId = crypto.randomUUID();
  const examId = crypto.randomUUID();
  const enrollmentId = crypto.randomUUID();
  const attemptHighId = crypto.randomUUID();
  const attemptLowId = crypto.randomUUID();
  const adminCtx = makeCtx(orgId, "admin-serialization-test");

  await db.insert(schema.organizations).values({
    id: orgId,
    name: slug,
    displayName: slug,
    slug,
    createdAt: now,
    updatedAt: now,
  });
  const passwordHash = await hashPassword("password123");
  await db.insert(schema.users).values({
    id: candidateUserId,
    organizationId: orgId,
    username: `cand-${slug}`,
    passwordHash,
    name: "GC Candidate",
    role: "Candidate",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.candidateProfiles).values({
    id: profileId,
    organizationId: orgId,
    userId: candidateUserId,
    fields: {},
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.courses).values({
    id: courseId,
    organizationId: orgId,
    name: `GC Course ${slug}`,
    code: `GC-${slug}`,
    description: "",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.questions).values({
    id: questionId,
    organizationId: orgId,
    courseId,
    type: "single_choice",
    content: "1+1=?",
    options: [
      { id: "a", content: "1" },
      { id: "b", content: "2" },
      { id: "c", content: "3" },
    ],
    standardAnswer: "b",
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
  });

  const questionSnapshot: QuestionSnapshot[] = [
    {
      originalQuestionId: questionId,
      type: "single_choice",
      content: "1+1=?",
      contentDocument: null,
      answerMode: null,
      attachments: [],
      options: [
        { id: "a", content: "1" },
        { id: "b", content: "2" },
        { id: "c", content: "3" },
      ],
      standardAnswer: "b",
      score: 100,
      gradingRule: {
        multiSelectScoring: "all_correct_full",
        fillBlankMatchMode: "exact",
      },
      order: 0,
      rubric: null,
    },
  ];
  const controlFlags: ControlFlags = {
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
  };
  const exam: Exam = {
    id: examId,
    organizationId: orgId,
    title: "GC Exam",
    description: "",
    courseId,
    status: "open",
    timingMode: "timed_window",
    durationMinutes: 60,
    openAt: new Date(Date.now() - 3600_000),
    closeAt: new Date(Date.now() + 86400_000),
    passingScore: 60,
    totalScore: 100,
    questionSelectionMode: "manual",
    questionIds: [questionId],
    questionSnapshot,
    controlFlags,
    retakePolicy: "unlimited",
    scoreStrategy: "highest",
    maxAttempts: 3,
    latestStartOffsetMinutes: null,
    minSubmitAfterStartMinutes: null,
    resultPublicationMode: "immediate",
    resultsPublishedAt: null,
    syncStartedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(schema.exams).values({
    id: examId,
    organizationId: orgId,
    title: exam.title,
    description: exam.description,
    courseId,
    status: exam.status,
    timingMode: exam.timingMode,
    durationMinutes: exam.durationMinutes,
    openAt: exam.openAt,
    closeAt: exam.closeAt,
    passingScore: exam.passingScore,
    totalScore: exam.totalScore,
    questionSelectionMode: exam.questionSelectionMode,
    questionIds: exam.questionIds,
    questionSnapshot: exam.questionSnapshot,
    controlFlags: exam.controlFlags,
    retakePolicy: exam.retakePolicy,
    scoreStrategy: exam.scoreStrategy,
    maxAttempts: exam.maxAttempts,
    latestStartOffsetMinutes: null,
    minSubmitAfterStartMinutes: null,
    resultPublicationMode: exam.resultPublicationMode,
    resultsPublishedAt: null,
    createdAt: now,
    updatedAt: now,
  });

  // Enrollment: started, attemptCount 2, no final score yet.
  await db.insert(schema.examEnrollments).values({
    id: enrollmentId,
    organizationId: orgId,
    examId,
    candidateId: profileId,
    status: "started",
    attemptCount: 2,
    finalScore: null,
    finalPassed: null,
    finalAttemptId: null,
    createdAt: now,
    updatedAt: now,
  });

  const makeAttemptRow = (
    attemptId: string,
    correct: boolean,
    attemptNo: number,
  ) => ({
    id: attemptId,
    organizationId: orgId,
    examId,
    enrollmentId,
    candidateId: profileId,
    attemptNo,
    status: "submitted" as const,
    questionSnapshot,
    answers: [
      {
        questionId,
        answer: correct ? "b" : "a",
        version: 1,
        savedAt: now,
      },
    ],
    createdAt: now,
    updatedAt: now,
  });
  await db
    .insert(schema.examAttempts)
    .values(makeAttemptRow(attemptHighId, highCorrect, 1));
  await db
    .insert(schema.examAttempts)
    .values(makeAttemptRow(attemptLowId, lowCorrect, 2));

  // Compute ScoreResults from the SAME snapshots the engine will see.
  const highAttempt = {
    id: attemptHighId,
    questionSnapshot,
    answers: [
      { questionId, answer: highCorrect ? "b" : "a", version: 1, savedAt: now },
    ],
  };
  const lowAttempt = {
    id: attemptLowId,
    questionSnapshot,
    answers: [
      { questionId, answer: lowCorrect ? "b" : "a", version: 1, savedAt: now },
    ],
  };
  const resultHigh = computeGradingResult(highAttempt as never, exam, now);
  const resultLow = computeGradingResult(lowAttempt as never, exam, now);

  // finalizeGrading aggregates from attempt_grading_entries. Seed
  // terminal completed_auto entries for each attempt via the repo API (handles
  // the column mapping) so the aggregator sees the same score the old
  // result-based path produced.
  const entryRepo = createAttemptGradingEntryRepo(db);
  const seedEntries = async (attemptId: string, result: ScoreResult) => {
    await entryRepo.bulkCreate(
      adminCtx,
      result.questionResults.map((qr) => ({
        attemptId,
        questionId: qr.questionId,
        gradingMode: "auto" as const,
        status: "completed_auto" as const,
        maxScore: qr.maxScore,
        earnedScore: qr.score,
        candidateAnswer: qr.candidateAnswer,
        standardAnswer: qr.standardAnswer,
        correct: qr.correct,
      })),
    );
  };
  await seedEntries(attemptHighId, resultHigh);
  await seedEntries(attemptLowId, resultLow);

  return { adminCtx, exam, enrollmentId, attemptHighId, attemptLowId };
}

function makeCtx(orgId: string, actorId: string): RequestContext {
  return {
    actorId,
    organizationId: orgId,
    role: "Admin" as Role,
    permissions: [] as Permission[],
    sessionId: "grade-serialization-test",
    targetOrganizationId: orgId,
  };
}

/**
 * Mirrors the production callers (submitAndGradeAttempt / autoSubmitAndGrade /
 * admin force-submit / gradingQueue): wrap finalizeGrading in ONE
 * executeInTransaction (REPEATABLE READ + 40001/40P01 retry) with tx-scoped
 * repos, minting the EA capability via the canonical seam.
 */
async function finalizeInTx(
  db: Database,
  ctx: RequestContext,
  attemptId: string,
  exam: Exam,
): Promise<boolean> {
  return executeInTransaction(db, async (tx) => {
    const txAttemptRepo = createAttemptRepo(tx);
    const { enrollments, attempts } = createExamEngineRepos(
      {
        examRepo: createExamRepo(tx),
        attemptRepo: txAttemptRepo,
        enrollmentRepo: createEnrollmentRepo(tx),
      },
      ctx,
    );
    const cap = await lockEnrollmentAndAttempt(
      enrollments,
      attempts,
      attemptId,
    );
    const gradingWorksetRepo = createGradingWorksetRepoAdapter(
      createAttemptGradingEntryRepo(tx),
      ctx,
    );
    return finalizeGrading(
      enrollments,
      attempts,
      gradingWorksetRepo,
      cap,
      exam,
      new Date(),
    );
  });
}

interface FinalizerParkGate {
  /** Resolved with the enrollment id once T1's seam holds the row lock. */
  enrollmentLockAcquired: Deferred<string>;
  /** T1's transaction parks on this until the controller releases it. */
  release: Deferred<void>;
}

/**
 * Test-only wrapper around the engine-facing enrollment adapter: after the
 * seam's `FOR UPDATE` read returns (the Enrollment row lock is held, the
 * Attempt lock not yet requested), signal the controller and hold the
 * transaction open. One-shot: a REPEATABLE READ 40001 retry re-runs the seam
 * but does not re-park (the gate is already settled).
 */
function parkAfterEnrollmentLock(
  enrollments: EnrollmentRepository,
  gate: FinalizerParkGate,
): EnrollmentRepository {
  let parkedOnce = false;
  return {
    ...enrollments,
    findByExamAndCandidateForUpdate: async (
      examId: string,
      candidateId: string,
    ) => {
      const row = await enrollments.findByExamAndCandidateForUpdate(
        examId,
        candidateId,
      );
      if (row && !parkedOnce) {
        parkedOnce = true;
        gate.enrollmentLockAcquired.resolve(row.id);
        await gate.release.promise;
      }
      return row;
    },
  };
}

/**
 * The deterministic serialization schedule: T1 (parked mid-seem holding the
 * Enrollment row lock) vs T2 (independent physical session, full production
 * composition). Proves, in order:
 *   1. distinct backend sessions (pids differ);
 *   2. T1 really holds the Enrollment row lock (observer NOWAIT probe → 55P03);
 *   3. T2 really blocks (pg_locks ungranted request on T2's pid — its only
 *      lock acquisition before the park point is the seam's Enrollment
 *      FOR UPDATE, so the wait is attributable to T1's row lock);
 *   4. after release, both finalizers settle and the durable enrollment row
 *      satisfies the caller-supplied oracle.
 */
async function runSerializedFinalizerSchedule(
  connections: { db1: Database; db2: Database; sqlObserver: ObserverSql },
  f: ConcurrencyFixture,
  parkedAttemptId: string,
  secondAttemptId: string,
): Promise<void> {
  const t1Pid = (await collectConnectionEvidence(connections.db1)).pid;
  const t2Pid = (await collectConnectionEvidence(connections.db2)).pid;
  expect(t1Pid).not.toBe(t2Pid);

  const gate: FinalizerParkGate = {
    enrollmentLockAcquired: createDeferred<string>("t1-enrollment-lock"),
    release: createDeferred<void>("t1-release"),
  };

  const t1 = executeInTransaction(connections.db1, async (tx) => {
    const txAttemptRepo = createAttemptRepo(tx);
    const { enrollments, attempts } = createExamEngineRepos(
      {
        examRepo: createExamRepo(tx),
        attemptRepo: txAttemptRepo,
        enrollmentRepo: createEnrollmentRepo(tx),
      },
      f.adminCtx,
    );
    const parked = parkAfterEnrollmentLock(enrollments, gate);
    // The SAME parked adapter must be threaded into finalizeGrading: the
    // capability's consume-time affinity assertion compares repo identity.
    const cap = await lockEnrollmentAndAttempt(
      parked,
      attempts,
      parkedAttemptId,
    );
    const gradingWorksetRepo = createGradingWorksetRepoAdapter(
      createAttemptGradingEntryRepo(tx),
      f.adminCtx,
    );
    return finalizeGrading(
      parked,
      attempts,
      gradingWorksetRepo,
      cap,
      f.exam,
      new Date(),
    );
  });

  const enrollmentId = await gate.enrollmentLockAcquired.promise;
  expect(enrollmentId).toBe(f.enrollmentId);

  // (2) Direct row-lock attribution: the observer's NOWAIT read is rejected
  // with lock_not_available because T1's seam holds the enrollment row lock.
  const nowait = await probeRowLockHeldNowait(
    connections.sqlObserver,
    "exam_enrollments",
    enrollmentId,
  );
  expect(nowait.acquired).toBe(false);
  if (!nowait.acquired) {
    expect(nowait.sqlstate).toBe("55P03");
  }

  // (3) T2 — independent session, unmodified production composition.
  const t2 = finalizeInTx(connections.db2, f.adminCtx, secondAttemptId, f.exam);
  const blocked = await waitForBackendBlocked(connections.sqlObserver, t2Pid);
  expect(["relation", "transactionid", "tuple"]).toContain(
    blocked.blockedOnLocktype,
  );

  // (4) Release T1; both settle (T2 directly or via a 40001 retry with a
  // fresh snapshot that includes T1's committed projection).
  gate.release.resolve();
  await Promise.all([t1, t2]);
}

describe("grading finalizer serialization — enrollment finalScore/finalAttemptId", () => {
  let iso: Awaited<ReturnType<typeof setupIsolatedTestDb>>;
  let db1: Database;
  let db2: Database;
  let sqlObserver: ObserverSql;
  let teardown: () => Promise<void>;

  beforeAll(async () => {
    iso = await setupIsolatedTestDb({
      namespace: "grading_serialization",
      databaseUrl: resolveTestDbUrl(),
    });
    const conn1 = await createPostgresDatabase(iso.databaseUrl, iso.schemaName);
    const conn2 = await createPostgresDatabase(iso.databaseUrl, iso.schemaName);
    const connObserver = await createPostgresDatabase(
      iso.databaseUrl,
      iso.schemaName,
    );
    db1 = conn1.db;
    db2 = conn2.db;
    sqlObserver = connObserver.sql;
    await migratePostgres(db1, { migrationsSchema: iso.schemaName });
    teardown = async () => {
      await connObserver.sql.end();
      await conn2.sql.end();
      await conn1.sql.end();
      await iso.cleanup();
    };
  }, 60_000);

  afterAll(async () => {
    await teardown();
  }, 30_000);

  async function readEnrollmentFinal(enrollmentId: string): Promise<{
    finalScore: number | null;
    finalPassed: boolean | null;
    finalAttemptId: string | null;
  }> {
    const rows = await db1
      .select({
        finalScore: schema.examEnrollments.finalScore,
        finalPassed: schema.examEnrollments.finalPassed,
        finalAttemptId: schema.examEnrollments.finalAttemptId,
      })
      .from(schema.examEnrollments)
      .where(eq(schema.examEnrollments.id, enrollmentId));
    const e = rows[0];
    if (!e) throw new Error("enrollment disappeared");
    return e;
  }

  it("Schedule H: high-score finalizer holds the Enrollment lock; the low-score finalizer blocks, then declines against the committed 100", async () => {
    const f = await buildFixture(db1, true, false);

    await runSerializedFinalizerSchedule(
      { db1, db2, sqlObserver },
      f,
      f.attemptHighId,
      f.attemptLowId,
    );

    const final = await readEnrollmentFinal(f.enrollmentId);
    expect(final.finalScore).toBe(100);
    expect(final.finalPassed).toBe(true);
    expect(final.finalAttemptId).toBe(f.attemptHighId);
  }, 30_000);

  it("Schedule L: low-score finalizer holds the Enrollment lock; the high-score finalizer blocks, then overwrites the committed 0", async () => {
    const f = await buildFixture(db1, true, false);

    await runSerializedFinalizerSchedule(
      { db1, db2, sqlObserver },
      f,
      f.attemptLowId,
      f.attemptHighId,
    );

    const final = await readEnrollmentFinal(f.enrollmentId);
    expect(final.finalScore).toBe(100);
    expect(final.finalPassed).toBe(true);
    expect(final.finalAttemptId).toBe(f.attemptHighId);
  }, 30_000);

  // Equal scores: `highest` selects with `>`, NOT `>=`, so the FIRST
  // committer keeps finalAttemptId and the second finalizer declines. The
  // parked-first attempt id is a frozen identity, so the oracle is exact —
  // an overwrite (>= mutant) or a lost update flips it red.
  it("Schedule E: equal scores — the first committer keeps finalAttemptId, the second declines (no clobber)", async () => {
    const f = await buildFixture(db1, true, true);

    await runSerializedFinalizerSchedule(
      { db1, db2, sqlObserver },
      f,
      f.attemptHighId,
      f.attemptLowId,
    );

    const final = await readEnrollmentFinal(f.enrollmentId);
    expect(final.finalScore).toBe(100);
    expect(final.finalPassed).toBe(true);
    expect(final.finalAttemptId).toBe(f.attemptHighId);
  }, 30_000);
});
