import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@exam/db/src/schema/pg.js";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { createEnrollmentRepo } from "@exam/db/src/repository/enrollmentRepo.js";
import {
  createAttemptGradingEntryRepo,
  toDomainEntry,
} from "@exam/db/src/repository/attemptGradingEntryRepo.js";
import { createAuditLogRepo } from "@exam/db/src/repository/auditLogRepo.js";
import type { AnswerRecord, QuestionSnapshot } from "@exam/domain";
import { gradeAnswers } from "@exam/domain";
import type { TestContext } from "./testHelpers.js";
import { buildTestApp, uniquePrefix } from "./testHelpers.js";
import examRoutes from "./exam.js";
import attemptRoutes from "./attempts.js";
import scoreRoutes from "./scores.js";

/**
 * Builds a subjective (manual-graded) question snapshot.
 * P3-L0-2D: protocol §1.4 — manual-graded questions are `text_response` by
 * QuestionType semantics, NOT by `standardAnswer == null`. The default
 * fixture carries a null standardAnswer; a non-null reference answer is
 * exercised in exam-engine's manualGradingCompletion.test.ts.
 */
function subjectiveQuestion(id: string, score = 10): QuestionSnapshot {
  return {
    originalQuestionId: id,
    type: "text_response",
    content: `Subjective ${id}`,
    attachments: [],
    options: [],
    standardAnswer: null,
    score,
    gradingRule: {
      multiSelectScoring: "all_correct_full",
      fillBlankMatchMode: "exact",
    },
    order: 0,
    rubric: null,
  };
}

/** Builds an objective (auto-graded, has standardAnswer) question snapshot. */
function objectiveQuestion(id: string, score = 10): QuestionSnapshot {
  return {
    originalQuestionId: id,
    type: "single_choice",
    content: `Objective ${id}`,
    attachments: [],
    options: [],
    standardAnswer: "a",
    score,
    gradingRule: {
      multiSelectScoring: "all_correct_full",
      fillBlankMatchMode: "exact",
    },
    order: 0,
    rubric: null,
  };
}

/**
 * Seeds an attempt with the given question snapshot and gradingStatus.
 * Subjective questions cannot be created via the question API (which
 * requires a non-null standardAnswer), so attempts are seeded directly.
 *
 * P3-L0-2E Slice 3: the route sources ALL grading state from the durable
 * `attempt_grading_entries` workset, so callers must also materialize grading
 * entries via {@link seedGradingEntries} for the queue / grading-details /
 * grade-question paths to observe the work. An attempt with
 * `gradingStatus=pending_manual` but NO grading entries is intentionally
 * invisible to the queue (queue work comes from entries, not lifecycle state).
 */
async function seedAttempt(
  ctx: TestContext,
  opts: {
    questions: QuestionSnapshot[];
    gradingStatus?: "pending_manual" | "fully_graded" | "auto_graded";
    title?: string;
    candidateName?: string;
    answers?: AnswerRecord[];
    passingScore?: number;
  },
): Promise<{ attemptId: string; examId: string }> {
  const now = new Date();
  const courseId = crypto.randomUUID();
  const examId = crypto.randomUUID();
  const candidateProfileId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const orgId = ctx.org.id;
  const isObjective = opts.questions.every((q) => q.standardAnswer != null);

  await ctx.db.insert(schema.courses).values({
    id: courseId,
    organizationId: orgId,
    name: opts.title ?? "Course",
    code: `GQ-${uniquePrefix()}`,
    description: "",
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.insert(schema.exams).values({
    id: examId,
    organizationId: orgId,
    title: opts.title ?? "Grading Queue Exam",
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
    retakePolicy: "unlimited",
    scoreStrategy: "highest",
    maxAttempts: 3,
    createdAt: now,
    updatedAt: now,
  });
  await ctx.db.insert(schema.users).values({
    id: userId,
    organizationId: orgId,
    username: `cand-${uniquePrefix()}`,
    passwordHash: "hash",
    name: opts.candidateName ?? "Candidate One",
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
  // When answers are provided, simulate the auto-grade step (mirrors the real
  // submit → finalizeGrading path) so attempts carry gradingResult/score/passed.
  const answers = opts.answers ?? [];
  const autoGraded =
    answers.length > 0
      ? gradeAnswers(
          "00000000-0000-0000-0000-000000000000",
          opts.questions,
          answers,
          opts.passingScore ?? 0,
          now,
        )
      : null;

  const attempt = await attemptRepo.create(requestContext, {
    examId,
    enrollmentId: enr.id,
    candidateId: candidateProfileId,
    attemptNo: 1,
    // Slice 3C: manual grading is only permitted while the attempt is at
    // `submitted + pending_manual`. Test fixtures seed attempts at the correct
    // lifecycle state; the Slice 7/11/13/14 tests that need a terminal `graded`
    // attempt reach it by grading the last pending question.
    status: "submitted",
    gradingStatus:
      opts.gradingStatus ?? (isObjective ? "auto_graded" : "pending_manual"),
    questionSnapshot: opts.questions,
    answers,
    submittedAnswers: {
      schemaVersion: 1,
      answers: answers.map((a) => ({
        questionId: a.questionId,
        value: a.answer,
      })),
    },
    ...(autoGraded
      ? {
          gradingResult: autoGraded.questionResults,
          score: autoGraded.totalScore,
          passed: autoGraded.passed,
        }
      : {}),
    submittedAt: now,
    gradedAt: now,
  });
  return { attemptId: attempt.id, examId };
}

/**
 * P3-L0-2E Slice 3 test helper: materializes the durable grading workset for
 * an attempt, mirroring what `submitAttempt` would have produced. Each frozen
 * question gets exactly one `attempt_grading_entries` row: objective questions
 * are `completed_auto` with their auto-graded score; text_response questions
 * are `pending_manual` with null earnedScore. This is the queue's work source.
 */
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

describe("grading queue routes (P2D-J3 / P3-L0-2E Slice 3)", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(examRoutes, { prefix: "" });
      await fastify.register(attemptRoutes, { prefix: "" });
      await fastify.register(scoreRoutes, { prefix: "" });
    });
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  // ── Slice 1: tracer bullet ───────────────────────────────────────
  it("lists an attempt with a pending_manual grading entry in the queue", async () => {
    const { attemptId, examId } = await seedAttempt(ctx, {
      questions: [subjectiveQuestion("q-essay")],
      title: "Queue Tracer",
      candidateName: "Tracer Candidate",
    });
    await seedGradingEntries(
      ctx,
      attemptId,
      [subjectiveQuestion("q-essay")],
      [],
    );

    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/admin/grading-queue",
      cookies: { "auth-token": ctx.adminToken },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const mine = body.items.find(
      (i: { attemptId: string }) => i.attemptId === attemptId,
    );
    expect(mine).toBeDefined();
    expect(mine).toMatchObject({
      attemptId,
      examId,
      examTitle: "Queue Tracer",
      candidateName: "Tracer Candidate",
      gradingStatus: "pending_manual",
      pendingQuestionCount: 1,
    });
    expect(body.total).toBeGreaterThanOrEqual(1);
  });

  // ── Slice 2: pure-objective attempt NOT in queue ─────────────────
  it("does not list an attempt whose grading entries are all completed_auto", async () => {
    const { attemptId } = await seedAttempt(ctx, {
      questions: [objectiveQuestion("q-obj")],
      title: "Objective Only",
      candidateName: "Objective Candidate",
    });
    await seedGradingEntries(
      ctx,
      attemptId,
      [objectiveQuestion("q-obj")],
      [{ questionId: "q-obj", answer: "a", version: 1, savedAt: new Date() }],
    );

    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/admin/grading-queue",
      cookies: { "auth-token": ctx.adminToken },
    });

    expect(res.statusCode).toBe(200);
    const mine = res
      .json()
      .items.find((i: { attemptId: string }) => i.attemptId === attemptId);
    expect(mine).toBeUndefined();
  });

  // ── Slice 3: 403 non-admin ───────────────────────────────────────
  it("rejects a non-admin (candidate) token with 403", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/admin/grading-queue",
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(res.statusCode).toBe(403);
  });

  // ── Slice 3E (Slice 3 invariant E): lifecycle state alone cannot create work ──
  it("does not fabricate queue work from gradingStatus=pending_manual when no grading entry exists", async () => {
    // Attempt is pending_manual but has ZERO grading entries. Slice 3: the
    // queue MUST NOT reconstruct work from questionSnapshot / lifecycle state.
    const { attemptId } = await seedAttempt(ctx, {
      questions: [subjectiveQuestion("q-ghost")],
      gradingStatus: "pending_manual",
      title: "Ghost Queue",
    });
    // Deliberately do NOT call seedGradingEntries.

    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/admin/grading-queue",
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    const mine = res
      .json()
      .items.find((i: { attemptId: string }) => i.attemptId === attemptId);
    expect(mine).toBeUndefined();
  });

  // ── Slice 3N: tenant isolation ───────────────────────────────────
  it("does not expose another organization's pending grading entries", async () => {
    const now = new Date();
    const foreignOrgId = crypto.randomUUID();
    await ctx.db.insert(schema.organizations).values({
      id: foreignOrgId,
      name: "Foreign",
      displayName: "Foreign",
      slug: `foreign-${foreignOrgId.slice(0, 8)}`,
      createdAt: now,
      updatedAt: now,
    });
    const foreignAttemptId = crypto.randomUUID();
    const foreignExamId = crypto.randomUUID();
    const foreignCourseId = crypto.randomUUID();
    const foreignCandidateId = crypto.randomUUID();
    const foreignUserId = crypto.randomUUID();
    await ctx.db.insert(schema.courses).values({
      id: foreignCourseId,
      organizationId: foreignOrgId,
      name: "F",
      code: `FC-${uniquePrefix()}`,
      description: "",
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert(schema.exams).values({
      id: foreignExamId,
      organizationId: foreignOrgId,
      title: "Foreign Exam",
      description: "",
      courseId: foreignCourseId,
      status: "open",
      timingMode: "timed_window",
      durationMinutes: 60,
      openAt: now,
      closeAt: new Date(Date.now() + 86400000),
      passingScore: 0,
      totalScore: 10,
      questionSelectionMode: "manual",
      questionIds: ["q"],
      questionSnapshot: [subjectiveQuestion("q")],
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
      maxAttempts: 3,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert(schema.users).values({
      id: foreignUserId,
      organizationId: foreignOrgId,
      username: `fu-${uniquePrefix()}`,
      passwordHash: "h",
      name: "Foreign User",
      role: "Candidate",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert(schema.candidateProfiles).values({
      id: foreignCandidateId,
      organizationId: foreignOrgId,
      userId: foreignUserId,
      fields: {},
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert(schema.examEnrollments).values({
      id: crypto.randomUUID(),
      organizationId: foreignOrgId,
      examId: foreignExamId,
      candidateId: foreignCandidateId,
      status: "started",
      attemptCount: 1,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert(schema.examAttempts).values({
      id: foreignAttemptId,
      organizationId: foreignOrgId,
      examId: foreignExamId,
      candidateId: foreignCandidateId,
      enrollmentId: (
        await ctx.db
          .select()
          .from(schema.examEnrollments)
          .where(eq(schema.examEnrollments.examId, foreignExamId))
      )[0]!.id,
      attemptNo: 1,
      status: "graded",
      questionSnapshot: [subjectiveQuestion("q")],
      answers: [],
      gradingStatus: "pending_manual",
      submittedAt: now,
      gradedAt: now,
      createdAt: now,
      updatedAt: now,
    });
    // Foreign pending manual grading entry — must be invisible to our tenant.
    await ctx.db.insert(schema.attemptGradingEntries).values({
      id: crypto.randomUUID(),
      organizationId: foreignOrgId,
      attemptId: foreignAttemptId,
      questionId: "q",
      gradingMode: "manual",
      status: "pending_manual",
      maxScore: 10,
      earnedScore: null,
      candidateAnswer: null,
      standardAnswer: null,
      correct: null,
      comment: "",
      createdAt: now,
      updatedAt: now,
    });

    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/admin/grading-queue",
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    const mine = res
      .json()
      .items.find(
        (i: { attemptId: string }) => i.attemptId === foreignAttemptId,
      );
    expect(mine).toBeUndefined();
  });

  // ── Slice 4: GET grading-details returns subjective questions + state ──
  it("returns manual-mode questions and their grading state in details", async () => {
    const { attemptId } = await seedAttempt(ctx, {
      questions: [subjectiveQuestion("q-essay-1")],
      title: "Details Exam",
      candidateName: "Details Candidate",
    });
    await seedGradingEntries(
      ctx,
      attemptId,
      [subjectiveQuestion("q-essay-1")],
      [],
    );

    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/admin/attempts/${attemptId}/grading-details`,
      cookies: { "auth-token": ctx.adminToken },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      attemptId,
      examTitle: "Details Exam",
      candidateName: "Details Candidate",
      gradingStatus: "pending_manual",
      questions: [
        {
          questionId: "q-essay-1",
          content: "Subjective q-essay-1",
          maxScore: 10,
          entry: null,
        },
      ],
    });
  });

  // ── Slice 5: grading-details 404 unknown attempt ─────────────────
  it("returns 404 for an unknown attempt in grading-details", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/admin/attempts/${crypto.randomUUID()}/grading-details`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(404);
  });

  // ── Slice 6: POST grade-question saves score + comment ───────────
  it("saves a manual score and comment for a subjective question", async () => {
    const { attemptId } = await seedAttempt(ctx, {
      questions: [subjectiveQuestion("q-a"), subjectiveQuestion("q-b")],
      title: "Grade One",
    });
    await seedGradingEntries(
      ctx,
      attemptId,
      [subjectiveQuestion("q-a"), subjectiveQuestion("q-b")],
      [],
    );

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/attempts/${attemptId}/grade-question`,
      payload: { questionId: "q-a", score: 7, comment: "good" },
      cookies: { "auth-token": ctx.adminToken },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      attemptId,
      gradingStatus: "pending_manual",
      questionId: "q-a",
      score: 7,
      fullyGraded: false,
    });

    const requestContext = {
      actorId: ctx.admin.id,
      organizationId: ctx.org.id,
      targetOrganizationId: ctx.org.id,
      role: "Admin" as const,
      permissions: [] as import("@exam/domain").Permission[],
      sessionId: "test",
    };
    const entry = await createAttemptGradingEntryRepo(
      ctx.db,
    ).findByAttemptAndQuestion(requestContext, attemptId, "q-a");
    expect(entry).toMatchObject({
      status: "completed_manual",
      earnedScore: 7,
      comment: "good",
      gradingMode: "manual",
    });
  });

  // ── Slice 7: last subjective graded -> fully_graded ──────────────
  it("flips gradingStatus to fully_graded when the last question is graded", async () => {
    const { attemptId } = await seedAttempt(ctx, {
      questions: [subjectiveQuestion("q-only")],
      title: "Single Subjective",
    });
    // Force the attempt to the submitted lifecycle state so the command's
    // submitted→graded terminal transition fires.
    await ctx.db
      .update(schema.examAttempts)
      .set({ status: "submitted" })
      .where(eq(schema.examAttempts.id, attemptId));
    await seedGradingEntries(
      ctx,
      attemptId,
      [subjectiveQuestion("q-only")],
      [],
    );

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/attempts/${attemptId}/grade-question`,
      payload: { questionId: "q-only", score: 9, comment: "" },
      cookies: { "auth-token": ctx.adminToken },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      gradingStatus: "fully_graded",
      fullyGraded: true,
    });
  });

  // ── Slice 8 (Slice 3C): a completed_manual entry is terminal — no overwrite ──
  it("does not overwrite a completed_manual entry and keeps exactly one row", async () => {
    const { attemptId } = await seedAttempt(ctx, {
      questions: [
        subjectiveQuestion("q-re"),
        subjectiveQuestion("q-other", 10),
      ],
      title: "Re-grade Rejected",
    });
    await seedGradingEntries(
      ctx,
      attemptId,
      [subjectiveQuestion("q-re"), subjectiveQuestion("q-other", 10)],
      [],
    );

    const first = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/attempts/${attemptId}/grade-question`,
      payload: { questionId: "q-re", score: 5, comment: "first" },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(first.statusCode).toBe(200);

    // Slice 3C: re-grading q-re is rejected (entry already completed_manual).
    const second = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/attempts/${attemptId}/grade-question`,
      payload: { questionId: "q-re", score: 8, comment: "second" },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(second.statusCode).toBe(409);

    const requestContext = {
      actorId: ctx.admin.id,
      organizationId: ctx.org.id,
      targetOrganizationId: ctx.org.id,
      role: "Admin" as const,
      permissions: [] as import("@exam/domain").Permission[],
      sessionId: "test",
    };
    const entries = await createAttemptGradingEntryRepo(ctx.db).findByAttempt(
      requestContext,
      attemptId,
    );
    // Exactly one entry for q-re, and it keeps the ORIGINAL score (5).
    const qreEntries = entries.filter((e) => e.questionId === "q-re");
    expect(qreEntries).toHaveLength(1);
    expect(qreEntries[0]).toMatchObject({
      status: "completed_manual",
      earnedScore: 5,
      comment: "first",
    });
    // The other pending question is still gradable (multi-manual preserved).
    const qother = entries.find((e) => e.questionId === "q-other");
    expect(qother).toMatchObject({ status: "pending_manual" });
  });

  // ── Slice 9: error contract ──────────────────────────────────────
  it("returns 404 grading an unknown attempt", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/attempts/${crypto.randomUUID()}/grade-question`,
      payload: { questionId: "q-x", score: 1 },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(404);
  });

  // ── Slice 3K: missing grading entry fails closed ─────────────────
  it("returns 404 when the grading entry is missing (fail closed, no lazy create)", async () => {
    const { attemptId } = await seedAttempt(ctx, {
      questions: [subjectiveQuestion("q-missing-entry")],
      title: "Missing Entry",
    });
    // Deliberately do NOT seed grading entries — the command must fail closed
    // rather than lazily create an entry or write a legacy row.
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/attempts/${attemptId}/grade-question`,
      payload: { questionId: "q-missing-entry", score: 5 },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(404);

    // And no grading entry was lazily created.
    const requestContext = {
      actorId: ctx.admin.id,
      organizationId: ctx.org.id,
      targetOrganizationId: ctx.org.id,
      role: "Admin" as const,
      permissions: [] as import("@exam/domain").Permission[],
      sessionId: "test",
    };
    const entry = await createAttemptGradingEntryRepo(
      ctx.db,
    ).findByAttemptAndQuestion(requestContext, attemptId, "q-missing-entry");
    expect(entry).toBeNull();
  });

  // ── Slice 3L: an auto_graded attempt is not in the manual-grading lifecycle ──
  it("rejects manual grading on an auto_graded attempt (not pending_manual)", async () => {
    const { attemptId } = await seedAttempt(ctx, {
      questions: [objectiveQuestion("q-obj")],
      title: "Auto Only",
    });
    await seedGradingEntries(
      ctx,
      attemptId,
      [objectiveQuestion("q-obj")],
      [{ questionId: "q-obj", answer: "a", version: 1, savedAt: new Date() }],
    );

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/attempts/${attemptId}/grade-question`,
      payload: { questionId: "q-obj", score: 5 },
      cookies: { "auth-token": ctx.adminToken },
    });
    // Slice 3C: the attempt is submitted + auto_graded, not pending_manual —
    // manual grading is rejected at the lifecycle guard.
    expect(res.statusCode).toBe(409);
  });

  it("returns 400 when score exceeds the question maxScore", async () => {
    const { attemptId } = await seedAttempt(ctx, {
      questions: [subjectiveQuestion("q-sub", 10)],
      title: "Over Max",
    });
    await seedGradingEntries(
      ctx,
      attemptId,
      [subjectiveQuestion("q-sub", 10)],
      [],
    );
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/attempts/${attemptId}/grade-question`,
      payload: { questionId: "q-sub", score: 11 },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a candidate token on grade-question with 403", async () => {
    const { attemptId } = await seedAttempt(ctx, {
      questions: [subjectiveQuestion("q-sub")],
      title: "Forbidden",
    });
    await seedGradingEntries(ctx, attemptId, [subjectiveQuestion("q-sub")], []);
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/attempts/${attemptId}/grade-question`,
      payload: { questionId: "q-sub", score: 5 },
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(res.statusCode).toBe(403);
  });

  // ── Slice 10: audit row grading.score_entered ────────────────────
  it("records a grading.score_entered audit row with full metadata", async () => {
    const { attemptId } = await seedAttempt(ctx, {
      questions: [subjectiveQuestion("q-aud", 10)],
      title: "Audit Exam",
    });
    await seedGradingEntries(
      ctx,
      attemptId,
      [subjectiveQuestion("q-aud", 10)],
      [],
    );
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/attempts/${attemptId}/grade-question`,
      payload: { questionId: "q-aud", score: 6, comment: "audited" },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);

    const requestContext = {
      actorId: ctx.admin.id,
      organizationId: ctx.org.id,
      targetOrganizationId: ctx.org.id,
      role: "Admin" as const,
      permissions: [] as import("@exam/domain").Permission[],
      sessionId: "test",
    };
    const { items } = await createAuditLogRepo(ctx.db).listPaginatedFiltered(
      requestContext,
      1,
      50,
      { action: "grading.score_entered" },
    );
    const mine = items.find((i) => i.auditLog.targetId === attemptId);
    expect(mine).toBeDefined();
    expect(mine).toMatchObject({
      auditLog: {
        action: "grading.score_entered",
        targetType: "attempt",
        targetId: attemptId,
        metadata: {
          questionId: "q-aud",
          score: 6,
          maxScore: 10,
          graderId: ctx.admin.id,
        },
      },
      actorName: ctx.admin.name,
    });
  });

  // ── Privacy: grading audit metadata must not contain candidate answers ──
  it("grading.score_entered audit metadata excludes candidate answer content", async () => {
    const { attemptId } = await seedAttempt(ctx, {
      questions: [subjectiveQuestion("q-priv", 10)],
      answers: [
        {
          questionId: "q-priv",
          answer: "SECRET_CANDIDATE_ANSWER",
          version: 1,
          savedAt: new Date(),
        },
      ],
      title: "Privacy Exam",
    });
    await seedGradingEntries(
      ctx,
      attemptId,
      [subjectiveQuestion("q-priv", 10)],
      [
        {
          questionId: "q-priv",
          answer: "SECRET_CANDIDATE_ANSWER",
          version: 1,
          savedAt: new Date(),
        },
      ],
    );
    await ctx.app.inject({
      method: "POST",
      url: `/api/admin/attempts/${attemptId}/grade-question`,
      payload: { questionId: "q-priv", score: 5, comment: "ok" },
      cookies: { "auth-token": ctx.adminToken },
    });
    const requestContext = {
      actorId: ctx.admin.id,
      organizationId: ctx.org.id,
      targetOrganizationId: ctx.org.id,
      role: "Admin" as const,
      permissions: [] as import("@exam/domain").Permission[],
      sessionId: "test",
    };
    const { items } = await createAuditLogRepo(ctx.db).listPaginatedFiltered(
      requestContext,
      1,
      50,
      { action: "grading.score_entered" },
    );
    const mine = items.find((i) => i.auditLog.targetId === attemptId);
    expect(mine).toBeDefined();
    const serialized = JSON.stringify(mine!.auditLog.metadata);
    expect(serialized).not.toContain("SECRET_CANDIDATE_ANSWER");
    expect(serialized).not.toContain("candidateAnswer");
    expect(serialized).not.toContain("answer");
  });

  // ── Slice 11: audit row grading.finalized ────────────────────────
  it("records a grading.finalized audit when last question is graded", async () => {
    const { attemptId } = await seedAttempt(ctx, {
      questions: [subjectiveQuestion("q-fin", 10)],
      title: "Finalize Exam",
    });
    await ctx.db
      .update(schema.examAttempts)
      .set({ status: "submitted" })
      .where(eq(schema.examAttempts.id, attemptId));
    await seedGradingEntries(
      ctx,
      attemptId,
      [subjectiveQuestion("q-fin", 10)],
      [],
    );
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/attempts/${attemptId}/grade-question`,
      payload: { questionId: "q-fin", score: 8 },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.fullyGraded).toBe(true);
    expect(body.gradingStatus).toBe("fully_graded");

    const requestContext = {
      actorId: ctx.admin.id,
      organizationId: ctx.org.id,
      targetOrganizationId: ctx.org.id,
      role: "Admin" as const,
      permissions: [] as import("@exam/domain").Permission[],
      sessionId: "test",
    };
    const { items } = await createAuditLogRepo(ctx.db).listPaginatedFiltered(
      requestContext,
      1,
      50,
      { action: "grading.finalized" },
    );
    const mine = items.find((i) => i.auditLog.targetId === attemptId);
    expect(mine).toBeDefined();
    expect(mine).toMatchObject({
      auditLog: {
        action: "grading.finalized",
        targetType: "attempt",
        targetId: attemptId,
        metadata: {
          gradingStatus: "fully_graded",
          graderId: ctx.admin.id,
        },
      },
      actorName: ctx.admin.name,
    });
  });

  // ── Slice 12: grading-details surfaces the candidate's answer ────
  it("returns the candidate's answer for a subjective question in details", async () => {
    const { attemptId } = await seedAttempt(ctx, {
      questions: [subjectiveQuestion("q-ans")],
      title: "Candidate Answer Exam",
      answers: [
        {
          questionId: "q-ans",
          answer: "my essay response",
          version: 1,
          savedAt: new Date(),
        } satisfies AnswerRecord,
      ],
    });
    await seedGradingEntries(
      ctx,
      attemptId,
      [subjectiveQuestion("q-ans")],
      [
        {
          questionId: "q-ans",
          answer: "my essay response",
          version: 1,
          savedAt: new Date(),
        },
      ],
    );

    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/admin/attempts/${attemptId}/grading-details`,
      cookies: { "auth-token": ctx.adminToken },
    });

    expect(res.statusCode).toBe(200);
    const questions = res.json().questions as Array<{
      questionId: string;
      candidateAnswer: unknown;
    }>;
    expect(questions[0]!.candidateAnswer).toBe("my essay response");
  });

  // ── Slice 13: full grading reconciles objective + manual total ───
  it("reconciles objective + manual into the attempt total on full grading", async () => {
    const { attemptId } = await seedAttempt(ctx, {
      questions: [
        objectiveQuestion("q-obj", 40),
        subjectiveQuestion("q-sub", 60),
      ],
      answers: [
        {
          questionId: "q-obj",
          answer: "a",
          version: 1,
          savedAt: new Date(),
        } satisfies AnswerRecord,
      ],
      gradingStatus: "pending_manual",
      passingScore: 50,
    });
    await ctx.db
      .update(schema.examAttempts)
      .set({ status: "submitted" })
      .where(eq(schema.examAttempts.id, attemptId));
    await seedGradingEntries(
      ctx,
      attemptId,
      [objectiveQuestion("q-obj", 40), subjectiveQuestion("q-sub", 60)],
      [
        {
          questionId: "q-obj",
          answer: "a",
          version: 1,
          savedAt: new Date(),
        },
      ],
    );

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/attempts/${attemptId}/grade-question`,
      payload: { questionId: "q-sub", score: 50, comment: "good" },
      cookies: { "auth-token": ctx.adminToken },
    });

    expect(res.statusCode).toBe(200);
    // Objective auto (40) + manual (50) = 90; passed (>= 50).
    expect(res.json()).toMatchObject({
      gradingStatus: "fully_graded",
      fullyGraded: true,
      totalScore: 90,
      passed: true,
    });
  });

  // ── Slice 14 (Slice 3C): terminal truth is immutable ───────────
  it("rejects manual grading after the attempt reaches graded + fully_graded and preserves terminal truth", async () => {
    const { attemptId } = await seedAttempt(ctx, {
      questions: [subjectiveQuestion("q-re", 60)],
      passingScore: 50,
      title: "Terminal Immutable",
    });
    await seedGradingEntries(
      ctx,
      attemptId,
      [subjectiveQuestion("q-re", 60)],
      [],
    );

    // Reach terminal: single manual question graded 60 → graded + fully_graded.
    const first = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/attempts/${attemptId}/grade-question`,
      payload: { questionId: "q-re", score: 60, comment: "" },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      gradingStatus: "fully_graded",
      totalScore: 60,
      passed: true,
    });

    // Post-terminal re-grade (different value) must be rejected.
    const second = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/attempts/${attemptId}/grade-question`,
      payload: { questionId: "q-re", score: 45, comment: "re-grade" },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(second.statusCode).toBe(409);

    // Terminal truth persists — score is NOT recomputed to 45.
    const requestContext = {
      actorId: ctx.admin.id,
      organizationId: ctx.org.id,
      targetOrganizationId: ctx.org.id,
      role: "Admin" as const,
      permissions: [] as import("@exam/domain").Permission[],
      sessionId: "test",
    };
    const attempt = await createAttemptRepo(ctx.db).findById(
      requestContext,
      attemptId,
    );
    expect(attempt?.score).toBe(60);
    expect(attempt?.passed).toBe(true);
    expect(attempt?.status).toBe("graded");
    expect(attempt?.gradingStatus).toBe("fully_graded");
    const entry = await createAttemptGradingEntryRepo(
      ctx.db,
    ).findByAttemptAndQuestion(requestContext, attemptId, "q-re");
    expect(entry?.earnedScore).toBe(60);
  });

  // ── Slice 3H/I: multi-manual queue behavior ──────────────────────
  it("returns two queue items for two pending manual questions, then one after grading the first", async () => {
    const { attemptId } = await seedAttempt(ctx, {
      questions: [
        subjectiveQuestion("q-text-1", 30),
        subjectiveQuestion("q-text-2", 30),
      ],
      title: "Multi Manual",
    });
    await seedGradingEntries(
      ctx,
      attemptId,
      [subjectiveQuestion("q-text-1", 30), subjectiveQuestion("q-text-2", 30)],
      [],
    );

    const before = await ctx.app.inject({
      method: "GET",
      url: "/api/admin/grading-queue",
      cookies: { "auth-token": ctx.adminToken },
    });
    const beforeMine = before
      .json()
      .items.find((i: { attemptId: string }) => i.attemptId === attemptId);
    expect(beforeMine).toMatchObject({ pendingQuestionCount: 2 });

    // Grade the first — queue must then show exactly one pending item.
    await ctx.app.inject({
      method: "POST",
      url: `/api/admin/attempts/${attemptId}/grade-question`,
      payload: { questionId: "q-text-1", score: 20 },
      cookies: { "auth-token": ctx.adminToken },
    });

    const after = await ctx.app.inject({
      method: "GET",
      url: "/api/admin/grading-queue",
      cookies: { "auth-token": ctx.adminToken },
    });
    const afterMine = after
      .json()
      .items.find((i: { attemptId: string }) => i.attemptId === attemptId);
    expect(afterMine).toMatchObject({
      pendingQuestionCount: 1,
      gradingStatus: "pending_manual",
    });
  });

  // ── Slice 3C/O: completed_manual immediately leaves the queue ────
  it("removes the attempt from the queue once all manual entries are completed", async () => {
    const { attemptId } = await seedAttempt(ctx, {
      questions: [subjectiveQuestion("q-done")],
      title: "Done Queue",
    });
    await ctx.db
      .update(schema.examAttempts)
      .set({ status: "submitted" })
      .where(eq(schema.examAttempts.id, attemptId));
    await seedGradingEntries(
      ctx,
      attemptId,
      [subjectiveQuestion("q-done")],
      [],
    );

    await ctx.app.inject({
      method: "POST",
      url: `/api/admin/attempts/${attemptId}/grade-question`,
      payload: { questionId: "q-done", score: 8 },
      cookies: { "auth-token": ctx.adminToken },
    });

    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/admin/grading-queue",
      cookies: { "auth-token": ctx.adminToken },
    });
    const mine = res
      .json()
      .items.find((i: { attemptId: string }) => i.attemptId === attemptId);
    expect(mine).toBeUndefined();
  });

  // ── Slice 3F/G: mixed exam exposes only text_response work; non-null std answer ok ──
  it("exposes only text_response work in a mixed exam, including a text_response with non-null standardAnswer", async () => {
    const textWithRef: QuestionSnapshot = {
      ...subjectiveQuestion("q-ref", 20),
      standardAnswer: "参考答案：评分要点",
    };
    const { attemptId } = await seedAttempt(ctx, {
      questions: [objectiveQuestion("q-obj", 40), textWithRef],
      title: "Mixed",
    });
    await seedGradingEntries(
      ctx,
      attemptId,
      [objectiveQuestion("q-obj", 40), textWithRef],
      [],
    );

    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/admin/grading-queue",
      cookies: { "auth-token": ctx.adminToken },
    });
    const mine = res
      .json()
      .items.find((i: { attemptId: string }) => i.attemptId === attemptId);
    expect(mine).toMatchObject({ pendingQuestionCount: 1 });
  });

  // ── Slice 3J: gradeQuestion updates the SAME grading entry (id stable) ──
  it("gradeQuestion updates the SAME grading entry — id stable, status completed_manual", async () => {
    const { attemptId } = await seedAttempt(ctx, {
      questions: [subjectiveQuestion("q-same", 10)],
      title: "Same Entry",
    });
    await seedGradingEntries(
      ctx,
      attemptId,
      [subjectiveQuestion("q-same", 10)],
      [],
    );

    const requestContext = {
      actorId: ctx.admin.id,
      organizationId: ctx.org.id,
      targetOrganizationId: ctx.org.id,
      role: "Admin" as const,
      permissions: [] as import("@exam/domain").Permission[],
      sessionId: "test",
    };
    const before = await createAttemptGradingEntryRepo(
      ctx.db,
    ).findByAttemptAndQuestion(requestContext, attemptId, "q-same");
    expect(before).toMatchObject({
      status: "pending_manual",
      gradingMode: "manual",
      earnedScore: null,
    });

    await ctx.app.inject({
      method: "POST",
      url: `/api/admin/attempts/${attemptId}/grade-question`,
      payload: { questionId: "q-same", score: 7, comment: "first" },
      cookies: { "auth-token": ctx.adminToken },
    });

    const after = await createAttemptGradingEntryRepo(
      ctx.db,
    ).findByAttemptAndQuestion(requestContext, attemptId, "q-same");
    expect(after).toMatchObject({
      id: before!.id,
      status: "completed_manual",
      gradingMode: "manual",
      earnedScore: 7,
      comment: "first",
      gradedBy: ctx.admin.id,
    });
    expect(toDomainEntry(after!)).toMatchObject({ status: "completed_manual" });
  });
});

// Note: the tests below were appended; the preceding "});" closed the
// describe block, so we re-open a sibling describe for the Slice 3C
// boundary tests to keep them grouped.
describe("grading queue Slice 3C — strict manual-work completion boundary", () => {
  let ctx3c: TestContext;

  beforeAll(async () => {
    ctx3c = await buildTestApp(async (fastify) => {
      await fastify.register(examRoutes, { prefix: "" });
      await fastify.register(attemptRoutes, { prefix: "" });
      await fastify.register(scoreRoutes, { prefix: "" });
    });
  });

  afterAll(async () => {
    await ctx3c.cleanup();
  });

  async function readEntry(attemptId: string, questionId: string) {
    const requestContext = {
      actorId: ctx3c.admin.id,
      organizationId: ctx3c.org.id,
      targetOrganizationId: ctx3c.org.id,
      role: "Admin" as const,
      permissions: [] as import("@exam/domain").Permission[],
      sessionId: "test",
    };
    return createAttemptGradingEntryRepo(ctx3c.db).findByAttemptAndQuestion(
      requestContext,
      attemptId,
      questionId,
    );
  }

  it("rejects same-value re-grade of a completed_manual entry before terminal completion", async () => {
    const { attemptId } = await seedAttempt(ctx3c, {
      questions: [subjectiveQuestion("q1", 60), subjectiveQuestion("q2", 40)],
      title: "Pre-Terminal Same",
    });
    await seedGradingEntries(
      ctx3c,
      attemptId,
      [subjectiveQuestion("q1", 60), subjectiveQuestion("q2", 40)],
      [],
    );

    const first = await ctx3c.app.inject({
      method: "POST",
      url: `/api/admin/attempts/${attemptId}/grade-question`,
      payload: { questionId: "q1", score: 30 },
      cookies: { "auth-token": ctx3c.adminToken },
    });
    expect(first.statusCode).toBe(200);

    const retry = await ctx3c.app.inject({
      method: "POST",
      url: `/api/admin/attempts/${attemptId}/grade-question`,
      payload: { questionId: "q1", score: 30 },
      cookies: { "auth-token": ctx3c.adminToken },
    });
    expect(retry.statusCode).toBe(409);

    const entry = await readEntry(attemptId, "q1");
    expect(entry).toMatchObject({
      status: "completed_manual",
      earnedScore: 30,
    });
  });

  it("rejects different-value re-grade of a completed_manual entry before terminal completion", async () => {
    const { attemptId } = await seedAttempt(ctx3c, {
      questions: [subjectiveQuestion("q1", 60), subjectiveQuestion("q2", 40)],
      title: "Pre-Terminal Diff",
    });
    await seedGradingEntries(
      ctx3c,
      attemptId,
      [subjectiveQuestion("q1", 60), subjectiveQuestion("q2", 40)],
      [],
    );

    await ctx3c.app.inject({
      method: "POST",
      url: `/api/admin/attempts/${attemptId}/grade-question`,
      payload: { questionId: "q1", score: 30 },
      cookies: { "auth-token": ctx3c.adminToken },
    });

    const revise = await ctx3c.app.inject({
      method: "POST",
      url: `/api/admin/attempts/${attemptId}/grade-question`,
      payload: { questionId: "q1", score: 50 },
      cookies: { "auth-token": ctx3c.adminToken },
    });
    expect(revise.statusCode).toBe(409);

    const entry = await readEntry(attemptId, "q1");
    expect(entry).toMatchObject({
      status: "completed_manual",
      earnedScore: 30,
      comment: "",
    });
  });

  it("rejects post-terminal re-grade (same value) and preserves terminal state", async () => {
    const { attemptId } = await seedAttempt(ctx3c, {
      questions: [subjectiveQuestion("q1", 60)],
      passingScore: 50,
      title: "Post-Terminal Same",
    });
    await ctx3c.db
      .update(schema.examAttempts)
      .set({ status: "submitted" })
      .where(eq(schema.examAttempts.id, attemptId));
    await seedGradingEntries(
      ctx3c,
      attemptId,
      [subjectiveQuestion("q1", 60)],
      [],
    );

    const first = await ctx3c.app.inject({
      method: "POST",
      url: `/api/admin/attempts/${attemptId}/grade-question`,
      payload: { questionId: "q1", score: 60 },
      cookies: { "auth-token": ctx3c.adminToken },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      gradingStatus: "fully_graded",
      fullyGraded: true,
      totalScore: 60,
      passed: true,
    });

    const reqCtx = {
      actorId: ctx3c.admin.id,
      organizationId: ctx3c.org.id,
      targetOrganizationId: ctx3c.org.id,
      role: "Admin" as const,
      permissions: [] as import("@exam/domain").Permission[],
      sessionId: "test",
    };
    const preAttempt = await createAttemptRepo(ctx3c.db).findById(
      reqCtx,
      attemptId,
    );
    const retry = await ctx3c.app.inject({
      method: "POST",
      url: `/api/admin/attempts/${attemptId}/grade-question`,
      payload: { questionId: "q1", score: 60 },
      cookies: { "auth-token": ctx3c.adminToken },
    });
    expect(retry.statusCode).toBe(409);

    const postAttempt = await createAttemptRepo(ctx3c.db).findById(
      reqCtx,
      attemptId,
    );
    expect(postAttempt?.score).toBe(preAttempt?.score);
    expect(postAttempt?.passed).toBe(preAttempt?.passed);
    expect(postAttempt?.gradingResult).toEqual(preAttempt?.gradingResult);
    expect(postAttempt?.status).toBe("graded");
    expect(postAttempt?.gradingStatus).toBe("fully_graded");
    const entry = await readEntry(attemptId, "q1");
    expect(entry?.earnedScore).toBe(60);
  });

  it("rejects post-terminal score revision (different value) and preserves terminal state", async () => {
    const { attemptId } = await seedAttempt(ctx3c, {
      questions: [subjectiveQuestion("q1", 60)],
      passingScore: 50,
      title: "Post-Terminal Diff",
    });
    await ctx3c.db
      .update(schema.examAttempts)
      .set({ status: "submitted" })
      .where(eq(schema.examAttempts.id, attemptId));
    await seedGradingEntries(
      ctx3c,
      attemptId,
      [subjectiveQuestion("q1", 60)],
      [],
    );

    await ctx3c.app.inject({
      method: "POST",
      url: `/api/admin/attempts/${attemptId}/grade-question`,
      payload: { questionId: "q1", score: 60 },
      cookies: { "auth-token": ctx3c.adminToken },
    });

    const revise = await ctx3c.app.inject({
      method: "POST",
      url: `/api/admin/attempts/${attemptId}/grade-question`,
      payload: { questionId: "q1", score: 45 },
      cookies: { "auth-token": ctx3c.adminToken },
    });
    expect(revise.statusCode).toBe(409);

    const entry = await readEntry(attemptId, "q1");
    expect(entry?.earnedScore).toBe(60);
    const reqCtx = {
      actorId: ctx3c.admin.id,
      organizationId: ctx3c.org.id,
      targetOrganizationId: ctx3c.org.id,
      role: "Admin" as const,
      permissions: [] as import("@exam/domain").Permission[],
      sessionId: "test",
    };
    const attempt = await createAttemptRepo(ctx3c.db).findById(
      reqCtx,
      attemptId,
    );
    expect(attempt?.score).toBe(60);
    expect(attempt?.passed).toBe(true);
    expect(attempt?.status).toBe("graded");
    expect(attempt?.gradingStatus).toBe("fully_graded");
  });
});
