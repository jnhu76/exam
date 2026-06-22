import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@exam/db/src/schema/pg.js";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { createEnrollmentRepo } from "@exam/db/src/repository/enrollmentRepo.js";
import { createManualGradingRepo } from "@exam/db/src/repository/manualGradingRepo.js";
import { createAuditLogRepo } from "@exam/db/src/repository/auditLogRepo.js";
import type { QuestionSnapshot } from "@exam/domain";
import type { TestContext } from "./testHelpers.js";
import { buildTestApp, uniquePrefix } from "./testHelpers.js";
import examRoutes from "./exam.js";
import attemptRoutes from "./attempts.js";
import scoreRoutes from "./scores.js";

/** Builds a subjective (no standardAnswer) question snapshot. */
function subjectiveQuestion(id: string, score = 10): QuestionSnapshot {
  return {
    originalQuestionId: id,
    type: "single_choice",
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
  };
}

/** Builds an objective (has standardAnswer) question snapshot. */
function objectiveQuestion(id: string, score = 10): QuestionSnapshot {
  return {
    ...subjectiveQuestion(id, score),
    content: `Objective ${id}`,
    standardAnswer: "a",
  };
}

/**
 * Seeds an attempt with the given question snapshot and gradingStatus.
 * Subjective questions cannot be created via the question API (which
 * requires a non-null standardAnswer), so attempts are seeded directly.
 */
async function seedAttempt(
  ctx: TestContext,
  opts: {
    questions: QuestionSnapshot[];
    gradingStatus?: "pending_manual" | "fully_graded" | "auto_graded";
    title?: string;
    candidateName?: string;
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
    passingScore: 0,
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
  const attempt = await attemptRepo.create(requestContext, {
    examId,
    enrollmentId: enr.id,
    candidateId: candidateProfileId,
    attemptNo: 1,
    status: "graded",
    gradingStatus:
      opts.gradingStatus ?? (isObjective ? "auto_graded" : "pending_manual"),
    questionSnapshot: opts.questions,
    answers: [],
    submittedAt: now,
    gradedAt: now,
  });
  return { attemptId: attempt.id, examId };
}

describe("grading queue routes (P2D-J3)", () => {
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
  it("lists an attempt with a subjective question in the grading queue", async () => {
    const { attemptId, examId } = await seedAttempt(ctx, {
      questions: [subjectiveQuestion("q-essay")],
      title: "Queue Tracer",
      candidateName: "Tracer Candidate",
    });

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
  it("does not list an auto_graded attempt in the queue", async () => {
    const { attemptId } = await seedAttempt(ctx, {
      questions: [objectiveQuestion("q-obj")],
      title: "Objective Only",
      candidateName: "Objective Candidate",
    });

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

  // ── Slice 3: 403 non-admin + cross-org isolation ─────────────────
  it("rejects a non-admin (candidate) token with 403", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/admin/grading-queue",
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(res.statusCode).toBe(403);
  });

  it("does not expose another organization's attempts in the queue", async () => {
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
    // Insert a foreign pending_manual attempt directly.
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

  // ── Slice 4: GET grading-details returns subjective questions + state
  it("returns subjective questions and their grading state in details", async () => {
    const { attemptId } = await seedAttempt(ctx, {
      questions: [subjectiveQuestion("q-essay-1")],
      title: "Details Exam",
      candidateName: "Details Candidate",
    });

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
    const entry = await createManualGradingRepo(
      ctx.db,
    ).findByAttemptAndQuestion(requestContext, attemptId, "q-a");
    expect(entry).toMatchObject({ score: 7, comment: "good" });
  });

  // ── Slice 7: last subjective graded -> fully_graded ──────────────
  it("flips gradingStatus to fully_graded when the last question is graded", async () => {
    const { attemptId } = await seedAttempt(ctx, {
      questions: [subjectiveQuestion("q-only")],
      title: "Single Subjective",
    });

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

  // ── Slice 8: re-grade overwrites the previous score ──────────────
  it("overwrites the previous score on re-grade", async () => {
    const { attemptId } = await seedAttempt(ctx, {
      questions: [subjectiveQuestion("q-re")],
      title: "Re-grade",
    });

    const first = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/attempts/${attemptId}/grade-question`,
      payload: { questionId: "q-re", score: 5, comment: "first" },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(first.statusCode).toBe(200);

    const second = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/attempts/${attemptId}/grade-question`,
      payload: { questionId: "q-re", score: 8, comment: "second" },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(second.statusCode).toBe(200);

    const requestContext = {
      actorId: ctx.admin.id,
      organizationId: ctx.org.id,
      targetOrganizationId: ctx.org.id,
      role: "Admin" as const,
      permissions: [] as import("@exam/domain").Permission[],
      sessionId: "test",
    };
    const entries = await createManualGradingRepo(ctx.db).findByAttempt(
      requestContext,
      attemptId,
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ score: 8, comment: "second" });
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

  it("returns 403 grading an auto_graded attempt", async () => {
    const { attemptId } = await seedAttempt(ctx, {
      questions: [objectiveQuestion("q-obj")],
      title: "Auto-graded Only",
    });
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/attempts/${attemptId}/grade-question`,
      payload: { questionId: "q-obj", score: 5 },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns 400 for a non-subjective question id in a mixed attempt", async () => {
    const { attemptId } = await seedAttempt(ctx, {
      questions: [subjectiveQuestion("q-sub"), objectiveQuestion("q-obj")],
      title: "Mixed",
    });
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/attempts/${attemptId}/grade-question`,
      payload: { questionId: "q-obj", score: 5 },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when score exceeds the question maxScore", async () => {
    const { attemptId } = await seedAttempt(ctx, {
      questions: [subjectiveQuestion("q-sub", 10)],
      title: "Over Max",
    });
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
    const mine = items.find((i) => i.targetId === attemptId);
    expect(mine).toBeDefined();
    expect(mine).toMatchObject({
      action: "grading.score_entered",
      targetType: "attempt",
      targetId: attemptId,
      metadata: {
        questionId: "q-aud",
        score: 6,
        maxScore: 10,
        graderId: ctx.admin.id,
      },
    });
  });

  // ── Slice 11: audit row grading.finalized ────────────────────────
  it("records a grading.finalized audit when last question is graded", async () => {
    const { attemptId } = await seedAttempt(ctx, {
      questions: [subjectiveQuestion("q-fin", 10)],
      title: "Finalize Exam",
    });
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
    const mine = items.find((i) => i.targetId === attemptId);
    expect(mine).toBeDefined();
    expect(mine).toMatchObject({
      action: "grading.finalized",
      targetType: "attempt",
      targetId: attemptId,
      metadata: {
        gradingStatus: "fully_graded",
        graderId: ctx.admin.id,
      },
    });
  });
});
