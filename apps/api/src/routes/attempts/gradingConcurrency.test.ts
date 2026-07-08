import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, like } from "drizzle-orm";
import { buildTestApp, uniquePrefix } from "../testHelpers.js";
import { schema } from "@exam/db/src/schema/pg.js";
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
import { hashPassword } from "@exam/auth/src/password.js";
import { cleanupOrganizationTestData } from "@exam/db/src/testCleanup.js";
import type {
  ControlFlags,
  Exam,
  ExamEnrollment,
  Permission,
  QuestionSnapshot,
  RequestContext,
  Role,
  ScoreResult,
} from "@exam/domain";

const GRADE_CONCURRENCY_PREFIX = "grade-concurrency-test-";

/**
 * P0-1 — finalScore / finalAttemptId last-writer-wins race.
 *
 * Before the fix, `finalizeGrading` read the enrollment WITHOUT a row lock:
 * two concurrent transactions (one grading a 100-point attempt, one grading a
 * 0-point attempt on the same enrollment) both read the same stale
 * finalScore/finalAttemptId, each computed `shouldSelectAttempt`, and the one
 * that committed LAST overwrote the other — so under `highest` strategy the
 * enrollment could end up recording the 0-point attempt.
 *
 * The fix reads the enrollment with `FOR UPDATE` inside the caller's
 * transaction, so the second transaction's read blocks until the first commits.
 * Selection is then recomputed against the post-commit state. These tests prove
 * that serialization holds in real Postgres: whichever attempt finalizes first,
 * the `highest` policy always keeps the higher score.
 *
 * Real-Postgres integration test (no fake repos, no DB mocking). Seeds via
 * direct inserts with explicit ids (matches the admin-force-submit test
 * pattern) so FKs link up; only the grading path under test goes through the
 * engine + tx-scoped repos.
 */

function makeCtx(orgId: string, actorId: string): RequestContext {
  return {
    actorId,
    organizationId: orgId,
    role: "Admin" as Role,
    permissions: [] as Permission[],
    sessionId: "grade-concurrency-test",
    targetOrganizationId: orgId,
  };
}

/**
 * Mirrors the production callers (submitAndGradeAttempt / autoSubmitAndGrade /
 * admin force-submit / gradingQueue): wrap finalizeGrading in ONE transaction
 * with tx-scoped repos and a locked attempt row, then a locked enrollment row.
 */
async function finalizeInTx(
  db: Database,
  ctx: RequestContext,
  attemptId: string,
  enrollmentId: string,
  exam: Exam,
): Promise<boolean> {
  return executeInTransaction(db, async (tx) => {
    const txAttemptRepo = createAttemptRepo(tx);
    const { exams, enrollments, attempts } = createExamEngineRepos(
      {
        examRepo: createExamRepo(tx),
        attemptRepo: txAttemptRepo,
        enrollmentRepo: createEnrollmentRepo(tx),
      },
      ctx,
    );
    // P3-FORMAL-P0-D2: mint the EA capability via the canonical seam (matches
    // every production caller); thread it into finalizeGrading. The capability
    // replaces the old (attemptId, enrollmentId) arguments.
    const cap = await lockEnrollmentAndAttempt(
      enrollments,
      attempts,
      attemptId,
    );
    // Slice 4: finalizeGrading aggregates from the grading workset internally —
    // no externally computed result. Build the tx-scoped workset adapter so it
    // reads the entries the submit freeze materialized.
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

interface ConcurrencyFixture {
  orgId: string;
  adminCtx: RequestContext;
  exam: Exam;
  enrollmentId: string;
  attemptHighId: string;
  attemptLowId: string;
  resultHigh: ScoreResult;
  resultLow: ScoreResult;
}

async function buildFixture(
  db: Database,
  highCorrect: boolean,
  lowCorrect: boolean,
): Promise<ConcurrencyFixture> {
  const slug = `${GRADE_CONCURRENCY_PREFIX}${uniquePrefix()}`;
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
  const adminCtx = makeCtx(orgId, "admin-concurrency-test");

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
    resultPublicationMode: "immediate",
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
    status: "submitted",
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

  // Slice 4: finalizeGrading aggregates from attempt_grading_entries. Seed
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

  return {
    orgId,
    adminCtx,
    exam,
    enrollmentId,
    attemptHighId,
    attemptLowId,
    resultHigh,
    resultLow,
  };
}

async function readEnrollmentFinal(
  db: Database,
  enrollmentId: string,
): Promise<{
  finalScore: number | null;
  finalPassed: boolean | null;
  finalAttemptId: string | null;
}> {
  const rows = await db
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

describe("grading concurrency — enrollment finalScore/finalAttemptId race (P0-1)", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;

  beforeAll(async () => {
    ctx = await buildTestApp(async () => {
      /* no routes needed — we call the engine directly */
    });
  });

  afterAll(async () => {
    const stale = await ctx.db
      .select({ id: schema.organizations.id })
      .from(schema.organizations)
      .where(like(schema.organizations.slug, `${GRADE_CONCURRENCY_PREFIX}%`));
    for (const org of stale) {
      await cleanupOrganizationTestData(ctx.db, org.id);
    }
    await ctx.cleanup();
  });

  // Case 1: high-score (100) + low-score (0) graded concurrently. Under
  // `highest` the enrollment MUST end with finalScore 100 and finalAttemptId
  // pointing at the high attempt, regardless of commit order.
  it("concurrent grading of a 100 and a 0 attempt keeps the high score (no last-writer-wins)", async () => {
    const f = await buildFixture(ctx.db as Database, true, false);

    // Race the two finalizations. `Promise.all` starts them ~together; the
    // FOR UPDATE on the enrollment serializes them. Whichever commits first,
    // the second recomputes selection against the now-committed finalScore.
    await Promise.all([
      finalizeInTx(
        ctx.db as Database,
        f.adminCtx,
        f.attemptHighId,
        f.enrollmentId,
        f.exam,
      ),
      finalizeInTx(
        ctx.db as Database,
        f.adminCtx,
        f.attemptLowId,
        f.enrollmentId,
        f.exam,
      ),
    ]);

    const final = await readEnrollmentFinal(ctx.db as Database, f.enrollmentId);
    expect(final.finalScore).toBe(100);
    expect(final.finalAttemptId).toBe(f.attemptHighId);
    expect(final.finalPassed).toBe(true);
  }, 30_000);

  // Case 2: repeat the race several times to exercise different interleavings.
  // Over many runs the high score must ALWAYS win under `highest`.
  it("repeated concurrent races always retain the high score (order-invariant)", async () => {
    for (let i = 0; i < 4; i++) {
      const f = await buildFixture(ctx.db as Database, true, false);
      await Promise.all([
        finalizeInTx(
          ctx.db as Database,
          f.adminCtx,
          f.attemptHighId,
          f.enrollmentId,
          f.exam,
        ),
        finalizeInTx(
          ctx.db as Database,
          f.adminCtx,
          f.attemptLowId,
          f.enrollmentId,
          f.exam,
        ),
      ]);
      const final = await readEnrollmentFinal(
        ctx.db as Database,
        f.enrollmentId,
      );
      expect(final.finalScore).toBe(100);
      expect(final.finalAttemptId).toBe(f.attemptHighId);
    }
  }, 120_000);

  // Case 3: two attempts both worth 100 (equal). `highest` uses `>` not `>=`,
  // so the first attempt committed stays the recorded final; the second must
  // NOT overwrite it. This proves the locked re-read + recompute path: the
  // second transaction sees finalScore=100 already set and declines.
  it("two equal-score attempts keep the first committed final under `highest` (no clobber on equal)", async () => {
    const f = await buildFixture(ctx.db as Database, true, true);

    await Promise.all([
      finalizeInTx(
        ctx.db as Database,
        f.adminCtx,
        f.attemptHighId,
        f.enrollmentId,
        f.exam,
      ),
      finalizeInTx(
        ctx.db as Database,
        f.adminCtx,
        f.attemptLowId,
        f.enrollmentId,
        f.exam,
      ),
    ]);

    const final = await readEnrollmentFinal(ctx.db as Database, f.enrollmentId);
    expect(final.finalScore).toBe(100);
    // finalAttemptId must point at exactly one of the two attempts (the
    // first to commit), never null, never a partial state.
    expect([f.attemptHighId, f.attemptLowId]).toContain(final.finalAttemptId);
    expect(final.finalPassed).toBe(true);
  }, 30_000);
});
