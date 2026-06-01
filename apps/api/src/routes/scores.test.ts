import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sqliteSchema } from "@exam/db/src/schema/sqlite.js";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { createEnrollmentRepo } from "@exam/db/src/repository/enrollmentRepo.js";
import { signJWT } from "@exam/auth/src/session.js";
import type { TestContext } from "./testHelpers.js";
import { buildTestApp } from "./testHelpers.js";
import examRoutes from "./exam.js";
import attemptRoutes from "./attempts.js";
import scoreRoutes from "./scores.js";

describe("score routes", () => {
  let ctx: TestContext;
  let courseId: string;
  let questionId: string;
  let candidateProfileId: string;

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(examRoutes, { prefix: "" });
      await fastify.register(attemptRoutes, { prefix: "" });
      await fastify.register(scoreRoutes, { prefix: "" });
    });
    courseId = crypto.randomUUID();
    questionId = crypto.randomUUID();
    candidateProfileId = crypto.randomUUID();
    ctx.db
      .insert(sqliteSchema.courses)
      .values({
        id: courseId,
        organizationId: ctx.org.id,
        name: "Course",
        code: "SCORE",
        description: "",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();
    ctx.db
      .insert(sqliteSchema.questions)
      .values({
        id: questionId,
        organizationId: ctx.org.id,
        courseId,
        type: "single_choice",
        content: "Choose A",
        options: [{ id: "a", content: "A" }],
        standardAnswer: "a",
        attachments: [],
        score: 10,
        difficulty: 1,
        tags: [],
        gradingRule: {
          multiSelectScoring: "all_correct_full",
          fillBlankMatchMode: "exact",
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();
    ctx.db
      .insert(sqliteSchema.candidateProfiles)
      .values({
        id: candidateProfileId,
        organizationId: ctx.org.id,
        userId: ctx.candidate.id,
        fields: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .run();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  async function createGradedAttempt(showResultImmediately: boolean) {
    const createResponse = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        title: showResultImmediately ? "Visible Score" : "Hidden Score",
        description: "",
        courseId,
        timingMode: "timed_window",
        durationMinutes: 60,
        openAt: new Date(Date.now() - 3600000).toISOString(),
        closeAt: new Date(Date.now() + 86400000).toISOString(),
        passingScore: 6,
        totalScore: 10,
        questionSelectionMode: "manual",
        questionIds: [questionId],
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
          showResultImmediately,
        },
        retakePolicy: "unlimited",
        scoreStrategy: "highest",
        maxAttempts: 3,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    const examId = createResponse.json().id as string;
    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish`,
      cookies: { "auth-token": ctx.adminToken },
    });
    const startResponse = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${examId}/start`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    const attemptId = startResponse.json().id as string;
    await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attemptId}/answers/${questionId}`,
      payload: {
        attemptId,
        questionId,
        answer: "a",
        clientSeq: 1,
        clientSavedAt: new Date().toISOString(),
        baseVersion: 0,
      },
      cookies: { "auth-token": ctx.candidateToken },
    });
    const submitResponse = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attemptId}/submit`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    return { attemptId, submitResponse };
  }

  it("grades a submitted attempt and returns visible candidate results", async () => {
    const { attemptId, submitResponse } = await createGradedAttempt(true);

    expect(submitResponse.statusCode).toBe(200);
    expect(submitResponse.json()).toMatchObject({
      status: "graded",
      score: 10,
      passed: true,
    });
    const response = await ctx.app.inject({
      method: "GET",
      url: `/api/scores/attempts/${attemptId}`,
      cookies: { "auth-token": ctx.candidateToken },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "graded",
      showResultImmediately: true,
      examTitle: "Visible Score",
      totalScore: 10,
      passed: true,
    });
    expect(response.json().questionResults[0]).toMatchObject({
      questionId,
      correct: true,
      score: 10,
      standardAnswer: "a",
    });
    const requestContext = {
      actorId: ctx.candidate.id,
      organizationId: ctx.org.id,
      role: "Candidate" as const,
      permissions: [] as import("@exam/domain").Permission[],
      sessionId: "test",
    };
    const storedAttempt = createAttemptRepo(ctx.db).findById(
      requestContext,
      attemptId,
    );
    const storedEnrollment = createEnrollmentRepo(
      ctx.db,
    ).findByExamAndCandidate(
      requestContext,
      storedAttempt!.examId,
      candidateProfileId,
    );
    expect(storedAttempt).toMatchObject({
      status: "graded",
      score: 10,
      passed: true,
    });
    expect(storedAttempt?.gradingResult).toHaveLength(1);
    expect(storedAttempt?.gradedAt).toBeInstanceOf(Date);
    expect(storedEnrollment).toMatchObject({
      status: "completed",
      finalScore: 10,
      finalPassed: true,
      finalAttemptId: attemptId,
    });
  });

  it("rejects answer changes after grading", async () => {
    const { attemptId } = await createGradedAttempt(true);
    const response = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attemptId}/answers/${questionId}`,
      payload: {
        attemptId,
        questionId,
        answer: "a",
        clientSeq: 2,
        clientSavedAt: new Date().toISOString(),
        baseVersion: 1,
      },
      cookies: { "auth-token": ctx.candidateToken },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      accepted: false,
      conflict: { reason: "SUBMITTED" },
    });
  });

  it("hides score details when immediate results are disabled", async () => {
    const { attemptId } = await createGradedAttempt(false);
    const response = await ctx.app.inject({
      method: "GET",
      url: `/api/scores/attempts/${attemptId}`,
      cookies: { "auth-token": ctx.candidateToken },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      attemptId,
      status: "graded",
      showResultImmediately: false,
      examTitle: "Hidden Score",
    });
  });

  it("returns a hidden response for an in-progress attempt", async () => {
    const { attemptId } = await createGradedAttempt(true);
    const requestContext = {
      actorId: ctx.candidate.id,
      organizationId: ctx.org.id,
      role: "Candidate" as const,
      permissions: [] as import("@exam/domain").Permission[],
      sessionId: "test",
    };
    createAttemptRepo(ctx.db).update(requestContext, attemptId, {
      status: "in_progress",
    });

    const response = await ctx.app.inject({
      method: "GET",
      url: `/api/scores/attempts/${attemptId}`,
      cookies: { "auth-token": ctx.candidateToken },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      attemptId,
      status: "in_progress",
      showResultImmediately: false,
      examTitle: "Visible Score",
    });
  });

  it("allows teachers to view a single attempt result", async () => {
    const { attemptId } = await createGradedAttempt(false);
    const response = await ctx.app.inject({
      method: "GET",
      url: `/api/scores/attempts/${attemptId}`,
      cookies: { "auth-token": ctx.teacherToken },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      attemptId,
      showResultImmediately: true,
      totalScore: 10,
      passed: true,
    });
  });

  it("does not expose an attempt to a teacher from another organization", async () => {
    const { attemptId } = await createGradedAttempt(true);
    const foreignOrganizationId = crypto.randomUUID();
    const foreignTeacherId = crypto.randomUUID();
    const now = new Date();
    ctx.db
      .insert(sqliteSchema.organizations)
      .values({
        id: foreignOrganizationId,
        name: "Foreign Organization",
        displayName: "Foreign Organization",
        slug: `foreign-${foreignOrganizationId}`,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    ctx.db
      .insert(sqliteSchema.users)
      .values({
        id: foreignTeacherId,
        organizationId: foreignOrganizationId,
        username: "foreign-teacher",
        passwordHash: "not-used",
        name: "Foreign Teacher",
        role: "Teacher",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const foreignTeacherToken = signJWT({
      actorId: foreignTeacherId,
      role: "Teacher",
      organizationId: foreignOrganizationId,
    });

    const response = await ctx.app.inject({
      method: "GET",
      url: `/api/scores/attempts/${attemptId}`,
      cookies: { "auth-token": foreignTeacherToken },
    });

    expect(response.statusCode).toBe(404);
  });
});
