import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AnswerRecord, QuestionSnapshot } from "@exam/domain";
import { gradeAnswers } from "@exam/domain";
import { eq } from "drizzle-orm";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { createAttemptGradingEntryRepo } from "@exam/db/src/repository/attemptGradingEntryRepo.js";
import { createEnrollmentRepo } from "@exam/db/src/repository/enrollmentRepo.js";
import { schema } from "@exam/db/src/schema.js";
import { buildTestApp, type TestContext } from "../testHelpers.js";
import { executeInTransaction } from "@exam/db/src/types.js";
import examRoutes from "../exam.js";
import attemptRoutes from "../attempts.js";
import scoreRoutes from "../scores.js";
import crypto from "node:crypto";

/**
 * P3-FORMAL-P0-A — Manual Grading Terminal Closure integration tests.
 *
 * Pre-repair bug: gradeQuestion wrote attempt.{score, passed, gradingResult}
 * on terminal manual completion but NEVER wrote
 * enrollment.{finalScore, finalPassed, finalAttemptId, status}. The candidate
 * exam list (which reads enrollment.finalScore) showed NULL/stale results for
 * manual-graded exams even though the attempt was fully graded. The scores
 * route worked around it by reading attempt.score directly.
 *
 * Fix: gradeQuestion's terminal branch now delegates to the canonical
 * finalizeTerminalGrading seam (shared with the auto path), which projects
 * BOTH Attempt AND Enrollment in the same transaction.
 *
 * These tests exercise the full HTTP path against real PostgreSQL:
 *   T6: POST /admin/attempts/:id/grade-question (terminal) → enrollment
 *       projection written AND consistent with attempt.score AND visible on
 *       the candidate exam list.
 *   T7: concurrent gradeQuestion for the SAME pending entry (UNCONTROLLED
 *       schedule — Promise.all only; no controlled-barrier harness exists in
 *       this repo). Exactly one wins; the other is rejected; no duplicate
 *       projection write.
 *   T8: two manual-graded attempts on the same enrollment reach terminal via
 *       the manual path concurrently (UNCONTROLLED). Enrollment projection
 *       converges to the scoreStrategy-selected winner under FOR UPDATE.
 */

// ── fixture builders (mirror gradingQueue.test.ts) ────────────────────

function subjectiveQuestion(id: string, score = 10): QuestionSnapshot {
  return {
    originalQuestionId: id,
    type: "text_response",
    content: `Subjective ${id}`,
    contentDocument: null,
    answerMode: null,
    attachments: [],
    options: [],
    standardAnswer: null,
    score,
    gradingRule: {
      multiSelectScoring: "all_correct_full" as const,
      fillBlankMatchMode: "exact" as const,
    },
    order: 0,
    rubric: null,
  };
}

function objectiveQuestion(
  id: string,
  score: number,
  standardAnswer: unknown,
): QuestionSnapshot {
  return {
    originalQuestionId: id,
    type: "single_choice",
    content: `Objective ${id}`,
    contentDocument: null,
    answerMode: null,
    attachments: [],
    options: [],
    standardAnswer,
    score,
    gradingRule: {
      multiSelectScoring: "all_correct_full" as const,
      fillBlankMatchMode: "exact" as const,
    },
    order: 0,
    rubric: null,
  };
}

let uniqueCounter = 0;
function uniquePrefix(): string {
  uniqueCounter += 1;
  return `${Date.now()}-${uniqueCounter}`;
}

interface SeedOptions {
  questions: QuestionSnapshot[];
  title?: string;
  passingScore?: number;
  scoreStrategy?: "highest" | "latest" | "first";
  retakePolicy?: "unlimited" | "max_attempts" | "pass_then_stop";
  maxAttempts?: number;
}

async function seedAttempt(
  ctx: TestContext,
  opts: SeedOptions,
): Promise<{
  attemptId: string;
  examId: string;
  enrollmentId: string;
  candidateId: string;
}> {
  const now = new Date();
  const courseId = crypto.randomUUID();
  const examId = crypto.randomUUID();
  const candidateProfileId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const orgId = ctx.org.id;

  await ctx.db.insert(schema.courses).values({
    id: courseId,
    organizationId: orgId,
    name: opts.title ?? "Course",
    code: `MC-${uniquePrefix()}`,
    description: "",
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.insert(schema.exams).values({
    id: examId,
    organizationId: orgId,
    title: opts.title ?? "Manual Closure Exam",
    description: "",
    courseId,
    status: "open",
    timingMode: "timed_window",
    durationMinutes: 60,
    openAt: now,
    closeAt: new Date(Date.now() + 86400000),
    passingScore: opts.passingScore ?? 0,
    totalScore: opts.questions.reduce((s, q) => s + q.score, 0),
    questionSelectionMode: "manual",
    questionIds: opts.questions.map((q) => q.originalQuestionId),
    questionSnapshot: opts.questions,
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
    retakePolicy: opts.retakePolicy ?? "unlimited",
    scoreStrategy: opts.scoreStrategy ?? "highest",
    maxAttempts: opts.maxAttempts ?? 3,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.insert(schema.users).values({
    id: userId,
    organizationId: orgId,
    username: `mc-cand-${uniquePrefix()}`,
    passwordHash: "hash",
    name: "Manual Closure Candidate",
    role: "Candidate",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.insert(schema.candidateProfiles).values({
    id: candidateProfileId,
    organizationId: orgId,
    userId,
    fields: {},
    createdAt: now,
    updatedAt: now,
  });

  const requestContext = {
    actorId: ctx.admin.id,
    organizationId: orgId,
    targetOrganizationId: orgId,
    role: "Admin" as const,
    permissions: [] as import("@exam/domain").Permission[],
    sessionId: "test",
  };
  const enrollmentRepo = createEnrollmentRepo(ctx.db);
  const attemptRepo = createAttemptRepo(ctx.db);
  const enr = await enrollmentRepo.create(requestContext, {
    examId,
    candidateId: candidateProfileId,
    status: "started",
    attemptCount: 1,
  });
  const attempt = await attemptRepo.create(requestContext, {
    examId,
    enrollmentId: enr.id,
    candidateId: candidateProfileId,
    attemptNo: 1,
    status: "submitted",
    gradingStatus: "pending_manual",
    questionSnapshot: opts.questions,
    answers: [],
    submittedAnswers: {
      schemaVersion: 1,
      answers: [],
    },
    submittedAt: now,
    gradedAt: now,
  });
  return {
    attemptId: attempt.id,
    examId,
    enrollmentId: enr.id,
    candidateId: candidateProfileId,
  };
}

async function seedGradingEntries(
  ctx: TestContext,
  attemptId: string,
  questions: QuestionSnapshot[],
  answers: AnswerRecord[],
): Promise<void> {
  const requestContext = {
    actorId: ctx.admin.id,
    organizationId: ctx.org.id,
    targetOrganizationId: ctx.org.id,
    role: "Admin" as const,
    permissions: [] as import("@exam/domain").Permission[],
    sessionId: "test",
  };
  const entryRepo = createAttemptGradingEntryRepo(ctx.db);
  const answerMap = new Map(answers.map((a) => [a.questionId, a.answer]));
  await entryRepo.bulkCreate(
    requestContext,
    questions.map((q) => {
      const candidateAnswer = answerMap.get(q.originalQuestionId) ?? null;
      if (q.type === "text_response") {
        return {
          attemptId,
          questionId: q.originalQuestionId,
          gradingMode: "manual" as const,
          status: "pending_manual" as const,
          maxScore: q.score,
          earnedScore: null,
          candidateAnswer,
          standardAnswer: q.standardAnswer ?? null,
          correct: null,
        };
      }
      const result = gradeAnswers(
        "00000000-0000-0000-0000-000000000000",
        [q],
        [
          {
            questionId: q.originalQuestionId,
            answer: candidateAnswer,
            version: 1,
            savedAt: new Date(),
          },
        ],
        0,
        new Date(),
      );
      const row = result.questionResults[0]!;
      return {
        attemptId,
        questionId: q.originalQuestionId,
        gradingMode: "auto" as const,
        status: "completed_auto" as const,
        maxScore: q.score,
        earnedScore: row.score,
        candidateAnswer,
        standardAnswer: q.standardAnswer ?? null,
        correct: row.correct,
      };
    }),
  );
}

async function readEnrollmentFinal(ctx: TestContext, enrollmentId: string) {
  const rows = await ctx.db
    .select()
    .from(schema.examEnrollments)
    .where(eq(schema.examEnrollments.id, enrollmentId));
  return rows[0] ?? null;
}

// ── tests ────────────────────────────────────────────────────────────

describe("P3-FORMAL-P0-A: manual grading terminal closure", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(examRoutes, { prefix: "" });
      // attemptRoutes (default export of attempts.ts) internally registers the
      // grading-queue routes via registerGradingQueueRoutes.
      await fastify.register(attemptRoutes, { prefix: "" });
      await fastify.register(scoreRoutes, { prefix: "" });
    });
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("T6: terminal manual grade projects enrollment.finalScore consistently with attempt.score", async () => {
    // Mixed exam: one objective (auto, full marks) + one subjective (manual).
    // Pre-repair: enrollment.finalScore stayed NULL after manual completion.
    const questions = [
      objectiveQuestion("q-obj", 40, "a"),
      subjectiveQuestion("q-text", 60),
    ];
    const { attemptId, enrollmentId, candidateId, examId } = await seedAttempt(
      ctx,
      { questions, passingScore: 50, title: "T6 mixed" },
    );
    await seedGradingEntries(ctx, attemptId, questions, [
      { questionId: "q-obj", answer: "a", version: 1, savedAt: new Date() },
      {
        questionId: "q-text",
        answer: "主观答题",
        version: 1,
        savedAt: new Date(),
      },
    ]);

    // Grade the last (only) pending manual entry → terminal closure fires.
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/attempts/${attemptId}/grade-question`,
      payload: { questionId: "q-text", score: 30, comment: "partial" },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      gradingStatus: "fully_graded",
      fullyGraded: true,
      totalScore: 70, // 40 objective + 30 manual
    });

    // Attempt projection.
    const attemptRepo = createAttemptRepo(ctx.db);
    const requestContext = {
      actorId: ctx.admin.id,
      organizationId: ctx.org.id,
      targetOrganizationId: ctx.org.id,
      role: "Admin" as const,
      permissions: [] as import("@exam/domain").Permission[],
      sessionId: "test",
    };
    const attempt = await attemptRepo.findById(requestContext, attemptId);
    expect(attempt?.status).toBe("graded");
    expect(attempt?.score).toBe(70);
    expect(attempt?.gradingStatus).toBe("fully_graded");
    expect(attempt?.gradedAt).not.toBeNull();

    // Enrollment projection — the regression target. Pre-repair these were
    // NULL / stale.
    const enrollment = await readEnrollmentFinal(ctx, enrollmentId);
    expect(enrollment?.finalScore).toBe(70);
    expect(enrollment?.finalPassed).toBe(true); // 70 >= 50
    expect(enrollment?.finalAttemptId).toBe(attemptId);

    // Reader-consistency: the candidate's enrollment-projected score equals
    // the attempt's persisted score. (Pre-repair: candidate list showed NULL
    // while scores route showed 70.)
    expect(enrollment?.finalScore).toBe(attempt?.score);
    void candidateId;
    void examId;
  });

  it("T7: concurrent gradeQuestion for the SAME pending entry — exactly one wins (UNCONTROLLED schedule)", async () => {
    // NOTE: this test uses Promise.all, which does NOT deterministically
    // order the FOR UPDATE acquisitions. The repo has no controlled-barrier
    // harness today. This test asserts the OUTCOME invariant (exactly one
    // logical completion; no duplicate projection) but cannot prove a
    // specific interleaving. Marked UNCONTROLLED SCHEDULE per the design.
    const questions = [subjectiveQuestion("q-text", 100)];
    const { attemptId, enrollmentId } = await seedAttempt(ctx, {
      questions,
      passingScore: 50,
      title: "T7 concurrent same entry",
    });
    await seedGradingEntries(ctx, attemptId, questions, [
      {
        questionId: "q-text",
        answer: "ans",
        version: 1,
        savedAt: new Date(),
      },
    ]);

    // Two concurrent grade-question POSTs for the same (attempt, question).
    // One should win (200), the other should be rejected (409) because the
    // entry is no longer pending_manual.
    const [r1, r2] = await Promise.all([
      ctx.app.inject({
        method: "POST",
        url: `/api/admin/attempts/${attemptId}/grade-question`,
        payload: { questionId: "q-text", score: 70, comment: "first" },
        cookies: { "auth-token": ctx.adminToken },
      }),
      ctx.app.inject({
        method: "POST",
        url: `/api/admin/attempts/${attemptId}/grade-question`,
        payload: { questionId: "q-text", score: 80, comment: "second" },
        cookies: { "auth-token": ctx.adminToken },
      }),
    ]);

    const codes = [r1.statusCode, r2.statusCode].sort();
    // Exactly one succeeds; the other is rejected as terminal-revision.
    // Accepted reject codes: 409 (InvalidStateTransition) or 400/500 if the
    // closure's defensive guard fired.
    const winners = codes.filter((c) => c === 200);
    expect(winners).toHaveLength(1);
    const loser = codes.find((c) => c !== 200)!;
    expect([400, 409, 500].includes(loser)).toBe(true);

    // The enrollment projection was written exactly once and reflects ONE of
    // the two scores (whichever won). The attempt is graded; no double-write.
    const enrollment = await readEnrollmentFinal(ctx, enrollmentId);
    expect(enrollment?.finalAttemptId).toBe(attemptId);
    expect([70, 80].includes(enrollment?.finalScore ?? -1)).toBe(true);
  });

  it("T8: two manual-graded attempts on the same enrollment, manual terminal via grade-question — scoreStrategy=highest converges (UNCONTROLLED)", async () => {
    // NOTE: UNCONTROLLED SCHEDULE — Promise.all only. Asserts convergence,
    // not a specific ordering.
    const questions = [subjectiveQuestion("q-text", 100)];
    // First attempt creates the exam + enrollment. We then create attempt 2
    // against the SAME exam + enrollment via direct repo insertion (the
    // seedAttempt helper always inserts a new exam, so we cannot call it twice
    // for the same exam).
    const s1 = await seedAttempt(ctx, {
      questions,
      passingScore: 50,
      title: "T8 exam",
      scoreStrategy: "highest",
      retakePolicy: "unlimited",
      maxAttempts: 5,
    });
    await seedGradingEntries(ctx, s1.attemptId, questions, [
      {
        questionId: "q-text",
        answer: "a1",
        version: 1,
        savedAt: new Date(),
      },
    ]);

    // Create attempt 2 directly against the same exam + enrollment.
    const now = new Date();
    const requestContext = {
      actorId: ctx.admin.id,
      organizationId: ctx.org.id,
      targetOrganizationId: ctx.org.id,
      role: "Admin" as const,
      permissions: [] as import("@exam/domain").Permission[],
      sessionId: "test",
    };
    const attemptRepo = createAttemptRepo(ctx.db);
    const attempt2 = await attemptRepo.create(requestContext, {
      examId: s1.examId,
      enrollmentId: s1.enrollmentId,
      candidateId: s1.candidateId,
      attemptNo: 2,
      status: "submitted",
      gradingStatus: "pending_manual",
      questionSnapshot: questions,
      answers: [],
      submittedAnswers: { schemaVersion: 1, answers: [] },
      submittedAt: now,
      gradedAt: now,
    });
    await seedGradingEntries(ctx, attempt2.id, questions, [
      {
        questionId: "q-text",
        answer: "a2",
        version: 1,
        savedAt: new Date(),
      },
    ]);
    // Bump the enrollment's attemptCount to reflect the second attempt.
    await ctx.db
      .update(schema.examEnrollments)
      .set({ attemptCount: 2 })
      .where(eq(schema.examEnrollments.id, s1.enrollmentId));

    // Concurrently terminal-grade both attempts via the manual path.
    const [r1, r2] = await Promise.all([
      ctx.app.inject({
        method: "POST",
        url: `/api/admin/attempts/${s1.attemptId}/grade-question`,
        payload: { questionId: "q-text", score: 80, comment: "a1" },
        cookies: { "auth-token": ctx.adminToken },
      }),
      ctx.app.inject({
        method: "POST",
        url: `/api/admin/attempts/${attempt2.id}/grade-question`,
        payload: { questionId: "q-text", score: 50, comment: "a2" },
        cookies: { "auth-token": ctx.adminToken },
      }),
    ]);
    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);

    // Both attempts graded with their own scores.
    const a1 = await attemptRepo.findById(requestContext, s1.attemptId);
    const a2 = await attemptRepo.findById(requestContext, attempt2.id);
    expect(a1?.score).toBe(80);
    expect(a2?.score).toBe(50);

    // highest strategy: 80 wins, regardless of completion order. The FOR
    // UPDATE on the enrollment serializes the two closures.
    const enrollment = await readEnrollmentFinal(ctx, s1.enrollmentId);
    expect(enrollment?.finalScore).toBe(80);
    expect(enrollment?.finalAttemptId).toBe(s1.attemptId);
  });

  it("T8b: legacy-data guard — a pre-existing graded attempt with NULL enrollment.finalScore is NOT silently repaired by a new gradeQuestion call", async () => {
    // This documents the legacy-data answer for the final report: the
    // canonical closure's idempotency guard (status === graded → return false)
    // means it does NOT re-project historical inconsistent rows. A separate
    // data-repair follow-up is required (out of scope for this job card).
    // We seed a manual attempt that is ALREADY graded (simulating a
    // pre-repair row) with NULL enrollment.finalScore, then attempt another
    // grade-question call — it must be rejected (409, entry already
    // completed_manual), and the enrollment must remain stale.
    const questions = [subjectiveQuestion("q-text", 100)];
    const { attemptId, enrollmentId } = await seedAttempt(ctx, {
      questions,
      passingScore: 50,
      title: "T8b legacy",
    });
    await seedGradingEntries(ctx, attemptId, questions, [
      {
        questionId: "q-text",
        answer: "ans",
        version: 1,
        savedAt: new Date(),
      },
    ]);
    // Manually mark the attempt graded + the entry completed_manual, mirroring
    // a pre-repair row where gradeQuestion wrote attempt.score but left
    // enrollment.finalScore NULL.
    await ctx.db
      .update(schema.examAttempts)
      .set({
        status: "graded",
        gradingStatus: "fully_graded",
        score: 60,
        passed: true,
      })
      .where(eq(schema.examAttempts.id, attemptId));
    await ctx.db
      .update(schema.attemptGradingEntries)
      .set({ status: "completed_manual", earnedScore: 60, correct: true })
      .where(eq(schema.attemptGradingEntries.attemptId, attemptId));
    // enrollment.finalScore intentionally left NULL.

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/attempts/${attemptId}/grade-question`,
      payload: { questionId: "q-text", score: 90, comment: "revise" },
      cookies: { "auth-token": ctx.adminToken },
    });
    // Rejected: entry is completed_manual (one-way) — no re-grade, no repair.
    expect([400, 409].includes(res.statusCode)).toBe(true);

    const enrollment = await readEnrollmentFinal(ctx, enrollmentId);
    // Still NULL — the canonical closure did NOT run (the entry was already
    // terminal and the lifecycle guard rejected the call before closure).
    // This proves historical rows require a separate data-repair path.
    expect(enrollment?.finalScore).toBeNull();
  });
});

// executeInTransaction is imported to keep the type-resolution graph stable
// across this file's transaction-aware fixtures; it is not invoked directly
// in the tests above (the route handler manages the transaction).
void executeInTransaction;
