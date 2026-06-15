import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@exam/db/src/schema/pg.js";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { createEnrollmentRepo } from "@exam/db/src/repository/enrollmentRepo.js";
import { createExamRepo } from "@exam/db/src/repository/examRepo.js";
import { signJWT } from "@exam/auth/src/session.js";
import { getRuntimeConfig } from "../config/runtimeConfig.js";
import type { TestContext } from "./testHelpers.js";
import { buildTestApp, uniquePrefix } from "./testHelpers.js";
import examRoutes from "./exam.js";
import attemptRoutes from "./attempts.js";
import scoreRoutes from "./scores.js";

async function ensureCandidateProfile(ctx: TestContext): Promise<string> {
  const existing = await ctx.db
    .select({ id: schema.candidateProfiles.id })
    .from(schema.candidateProfiles)
    .where(eq(schema.candidateProfiles.userId, ctx.candidate.id));
  if (existing[0]) return existing[0].id;
  const id = crypto.randomUUID();
  await ctx.db.insert(schema.candidateProfiles).values({
    id,
    organizationId: ctx.org.id,
    userId: ctx.candidate.id,
    fields: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return id;
}

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
    await ctx.db.insert(schema.courses).values({
      id: courseId,
      organizationId: ctx.org.id,
      name: "Course",
      code: `SCORE-${uniquePrefix()}`,
      description: "",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await ctx.db.insert(schema.questions).values({
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
    });
    candidateProfileId = await ensureCandidateProfile(ctx);
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  function adminRequestContext() {
    return {
      actorId: ctx.admin.id,
      organizationId: ctx.org.id,
      targetOrganizationId: ctx.org.id,
      role: "Admin" as const,
      permissions: [] as import("@exam/domain").Permission[],
      sessionId: "test",
    };
  }

  async function markExamClosed(examId: string) {
    await createExamRepo(ctx.db).update(adminRequestContext(), examId, {
      closeAt: new Date(Date.now() - 1000),
    });
  }

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
    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/enrollments`,
      payload: { candidateIds: [candidateProfileId] },
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
    const storedAttempt = await createAttemptRepo(ctx.db).findById(
      requestContext,
      attemptId,
    );
    const storedEnrollment = await createEnrollmentRepo(
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
      reason: "ATTEMPT_ALREADY_SUBMITTED",
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
    await createAttemptRepo(ctx.db).update(requestContext, attemptId, {
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

  it("allows admins to view a single attempt result", async () => {
    const { attemptId } = await createGradedAttempt(false);
    const response = await ctx.app.inject({
      method: "GET",
      url: `/api/scores/attempts/${attemptId}`,
      cookies: { "auth-token": ctx.adminToken },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      attemptId,
      showResultImmediately: true,
      totalScore: 10,
      passed: true,
    });
  });

  it("does not expose an attempt to an admin from another organization", async () => {
    const { attemptId } = await createGradedAttempt(true);
    const foreignOrganizationId = crypto.randomUUID();
    const foreignAdminId = crypto.randomUUID();
    const now = new Date();
    await ctx.db.insert(schema.organizations).values({
      id: foreignOrganizationId,
      name: "Foreign Organization",
      displayName: "Foreign Organization",
      slug: `foreign-${foreignOrganizationId}`,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert(schema.users).values({
      id: foreignAdminId,
      organizationId: foreignOrganizationId,
      username: `foreign-admin-${uniquePrefix()}`,
      passwordHash: "not-used",
      name: "Foreign Admin",
      role: "Admin",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const foreignAdminToken = signJWT(
      {
        actorId: foreignAdminId,
        role: "Admin",
        organizationId: foreignOrganizationId,
      },
      getRuntimeConfig().authSecret.jwtSecret,
    );

    const response = await ctx.app.inject({
      method: "GET",
      url: `/api/scores/attempts/${attemptId}`,
      cookies: { "auth-token": foreignAdminToken },
    });

    expect(response.statusCode).toBe(404);
  });
});

describe("J8: score list routes", () => {
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
    await ctx.db.insert(schema.courses).values({
      id: courseId,
      organizationId: ctx.org.id,
      name: "Course",
      code: `SCORE-LIST-${uniquePrefix()}`,
      description: "",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await ctx.db.insert(schema.questions).values({
      id: questionId,
      organizationId: ctx.org.id,
      courseId,
      type: "single_choice",
      content: "Choose A",
      options: [
        { id: "a", content: "A" },
        { id: "b", content: "B" },
      ],
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
    });
    candidateProfileId = await ensureCandidateProfile(ctx);
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  function adminRequestContext() {
    return {
      actorId: ctx.admin.id,
      organizationId: ctx.org.id,
      targetOrganizationId: ctx.org.id,
      role: "Admin" as const,
      permissions: [] as import("@exam/domain").Permission[],
      sessionId: "test",
    };
  }

  async function markExamClosed(examId: string) {
    await createExamRepo(ctx.db).update(adminRequestContext(), examId, {
      closeAt: new Date(Date.now() - 1000),
    });
  }

  async function createExamAndPublish(): Promise<string> {
    const createResponse = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        title: "Exam for Score List",
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
          showResultImmediately: true,
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
    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/enrollments`,
      payload: { candidateIds: [candidateProfileId] },
      cookies: { "auth-token": ctx.adminToken },
    });
    return examId;
  }

  async function createGradedAttemptForExam(
    examId: string,
    answerRight: boolean = true,
    authToken: string = ctx.candidateToken,
    closeExamAfterGrading: boolean = true,
  ): Promise<string> {
    const startResponse = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${examId}/start`,
      cookies: { "auth-token": authToken },
    });
    const attemptId = startResponse.json().id as string;

    await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attemptId}/answers/${questionId}`,
      payload: {
        attemptId,
        questionId,
        answer: answerRight ? "a" : "b",
        clientSeq: 1,
        clientSavedAt: new Date().toISOString(),
        baseVersion: 0,
      },
      cookies: { "auth-token": authToken },
    });

    await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attemptId}/submit`,
      cookies: { "auth-token": authToken },
    });
    if (closeExamAfterGrading) {
      await markExamClosed(examId);
    }

    return attemptId;
  }

  it("J8-A-1: returns paginated score list for an exam", async () => {
    const examId = await createExamAndPublish();
    await createGradedAttemptForExam(examId, true);

    // 现在测试新的score list接口
    const response = await ctx.app.inject({
      method: "GET",
      url: `/api/exams/${examId}/scores`,
      cookies: { "auth-token": ctx.adminToken },
    });

    // 期望返回200和数据
    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveProperty("items");
    expect(response.json().items).toHaveLength(1);
    expect(response.json()).toHaveProperty("stats");
    expect(response.json()).toHaveProperty("total", 1);
  });

  it("J8-A-1b: coerces numeric query params without removing validation", async () => {
    const examId = await createExamAndPublish();
    await createGradedAttemptForExam(examId, true);

    const response = await ctx.app.inject({
      method: "GET",
      url: `/api/exams/${examId}/scores?page=1&pageSize=10&passFilter=all`,
      cookies: { "auth-token": ctx.adminToken },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      page: 1,
      pageSize: 10,
      total: 1,
    });
  });

  it("J8-A-1c: rejects score list access before exam ends", async () => {
    const createResponse = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        title: "Open Exam Score Guard",
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
          showResultImmediately: true,
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
    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/enrollments`,
      payload: { candidateIds: [candidateProfileId] },
      cookies: { "auth-token": ctx.adminToken },
    });

    const response = await ctx.app.inject({
      method: "GET",
      url: `/api/exams/${examId}/scores?page=1&passFilter=all`,
      cookies: { "auth-token": ctx.adminToken },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.message).toMatch(/not finished yet/i);
  });

  it("J8-A-2: filters by pass/fail status", async () => {
    const examId = await createExamAndPublish();

    // 需要另外的考生，先创建一个临时的
    const tempCandidateId = crypto.randomUUID();
    const tempUserId = crypto.randomUUID();
    const now = new Date();

    await ctx.db.insert(schema.users).values({
      id: tempUserId,
      organizationId: ctx.org.id,
      username: "temp-candidate-" + Date.now(),
      passwordHash: "not-used",
      name: "Temp Candidate",
      role: "Candidate",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert(schema.candidateProfiles).values({
      id: tempCandidateId,
      organizationId: ctx.org.id,
      userId: tempUserId,
      fields: {},
      createdAt: now,
      updatedAt: now,
    });

    const tempToken = signJWT(
      {
        actorId: tempUserId,
        role: "Candidate",
        organizationId: ctx.org.id,
      },
      getRuntimeConfig().authSecret.jwtSecret,
    );

    // 创建一个及格和一个不及格的尝试
    await createGradedAttemptForExam(examId, true, ctx.candidateToken, false); // passed
    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/enrollments`,
      payload: { candidateIds: [tempCandidateId] },
      cookies: { "auth-token": ctx.adminToken },
    });
    await createGradedAttemptForExam(examId, false, tempToken, false); // failed
    await markExamClosed(examId);

    // 测试过滤passed
    const responsePassed = await ctx.app.inject({
      method: "GET",
      url: `/api/exams/${examId}/scores?passFilter=passed`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(responsePassed.statusCode).toBe(200);
    expect(responsePassed.json().items.length).toBe(1);

    // 测试过滤failed
    const responseFailed = await ctx.app.inject({
      method: "GET",
      url: `/api/exams/${examId}/scores?passFilter=failed`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(responseFailed.statusCode).toBe(200);
    expect(responseFailed.json().items.length).toBe(1);
  });
});
