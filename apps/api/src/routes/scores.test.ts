import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@exam/db/src/schema/pg.js";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { createEnrollmentRepo } from "@exam/db/src/repository/enrollmentRepo.js";
import { createExamRepo } from "@exam/db/src/repository/examRepo.js";
import { signJWT } from "@exam/auth/src/session.js";
import { getRuntimeConfig } from "../config/runtimeConfig.js";
import type { TestContext } from "./testHelpers.js";
import {
  buildTestApp,
  createAssignedUserForTest,
  uniquePrefix,
} from "./testHelpers.js";
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
    });
    // standardAnswer is stripped for candidates — must not be present
    expect(response.json().questionResults[0]).not.toHaveProperty(
      "standardAnswer",
    );
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
      status: "started",
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
    // P2D-J5a: legacy showResultImmediately=false coerces to manual mode, so
    // the hidden variant now carries hiddenReason='pending_publish' (no
    // publish-results call has been made).
    expect(response.json()).toEqual({
      attemptId,
      status: "graded",
      showResultImmediately: false,
      hiddenReason: "pending_publish",
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
      hiddenReason: "not_started",
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
    // RBAC-M10-E: primary active assignment so the foreign admin's token
    // resolves authority (the test then asserts the org-anchor 404, not a
    // 401 from no-assignment).
    await ctx.db.insert(schema.userRoleAssignments).values({
      id: crypto.randomUUID(),
      organizationId: foreignOrganizationId,
      userId: foreignAdminId,
      role: "Admin",
      isPrimary: true,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const foreignAdminToken = signJWT(
      {
        actorId: foreignAdminId,
        role: "Admin",
        organizationId: foreignOrganizationId,
        authEpoch: 0,
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

  // RBAC-SCOPED-AUTHORIZATION-CORRECTIVE-1: roles that hold neither
  // ScoreAllView nor ScoreOwnView must be denied on the score route. The
  // preHandler resolves to a 403 PERMISSION_DENIED (genuine capability denial,
  // not an ownership ambiguity). Closes the previously-untested Grader/Proctor
  // gap on GET /scores/attempts/:attemptId. (Teacher holds ScoreAllView, so it
  // is allowed and tested via the exam matrix instead.)
  it.each(["Grader", "Proctor"] as const)(
    "denies %s (holds neither ScoreAllView nor ScoreOwnView) with 403",
    async (role) => {
      const { attemptId } = await createGradedAttempt(false);
      const now = new Date();
      const roleId = crypto.randomUUID();
      await ctx.db.insert(schema.users).values({
        id: roleId,
        organizationId: ctx.org.id,
        username: `${role.toLowerCase()}-score-${uniquePrefix()}`,
        passwordHash: "not-used",
        name: `${role} User`,
        role,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      // RBAC-M10-E: primary active assignment so the Grader/Proctor token
      // resolves authority (then the capability gate denies 403 — not 401).
      await ctx.db.insert(schema.userRoleAssignments).values({
        id: crypto.randomUUID(),
        organizationId: ctx.org.id,
        userId: roleId,
        role,
        isPrimary: true,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      const token = signJWT(
        {
          actorId: roleId,
          role,
          organizationId: ctx.org.id,
          authEpoch: 0,
        },
        getRuntimeConfig().authSecret.jwtSecret,
      );
      const response = await ctx.app.inject({
        method: "GET",
        url: `/api/scores/attempts/${attemptId}`,
        cookies: { "auth-token": token },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().error.code).toBe("PERMISSION_DENIED");
    },
  );
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
    const body = response.json();
    expect(body.error.message).toMatch(/not finished yet/i);
    expect(body.error.requestId).toEqual(expect.any(String));
    expect(body.error.code).toBe("RESOURCE_CONFLICT");
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
      username: "temp-candidate-" + uniquePrefix(),
      passwordHash: "not-used",
      name: "Temp Candidate",
      role: "Candidate",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    // RBAC-M10-E: assignment so tempToken can start an attempt.
    await ctx.db.insert(schema.userRoleAssignments).values({
      id: crypto.randomUUID(),
      organizationId: ctx.org.id,
      userId: tempUserId,
      role: "Candidate",
      isPrimary: true,
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
        authEpoch: 0,
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

  // ADR-005 Slice 1 §Close & export policy: scores must also reject while
  // unresolved attempts remain, even when the exam window has ended, so an
  // admin cannot export partial results mid-exam.
  it("rejects scores while unresolved attempts remain (UNRESOLVED_ATTEMPTS_EXIST)", async () => {
    // Create + publish an exam with an OPEN window (so a candidate can start).
    const createResponse = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        title: "Unresolved Score Guard",
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

    // START (not submit) an attempt -> stays in_progress (unresolved).
    const startRes = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${examId}/start`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(startRes.statusCode).toBe(201);

    // Move the window into the past directly (simulating the deadline elapsing
    // before the scanner auto-closes the exam). Now examEnded is true via
    // `now >= closeAt`, but the attempt is still unresolved.
    await markExamClosed(examId);

    const response = await ctx.app.inject({
      method: "GET",
      url: `/api/exams/${examId}/scores?page=1&passFilter=all`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(response.statusCode).toBe(409);
    const body = response.json();
    expect(body.error.code).toBe("RESOURCE_CONFLICT");
    expect(body.error.details?.reason).toBe("UNRESOLVED_ATTEMPTS_EXIST");
    expect(body.error.details?.activeAttemptCount).toBeGreaterThanOrEqual(1);
  });
});

// ── P3-MOD-P3-2: Candidate Result / Answer Visibility Boundaries ──
// Proves result visibility and answer visibility are INDEPENDENT gates, that
// nothing internal leaks through the Candidate result DTO, that ownership is
// enforced, and that frozen result metadata is immune to live-question edits.
//
// Protocol reality this block locks down (audited before writing):
//   - The Candidate result endpoint strips standardAnswer unconditionally for
//     candidates (scores.ts safeQuestionResults) — answer visibility is
//     effectively "always hidden" for candidates in MVP (there is no per-exam
//     answer-visibility config; computeAnswerVisibility() returns "hidden").
//   - The result questionResults DTO carries NO rubric field at all.
// So the only valid candidate cross-product is {result visible, answers
// hidden}; the tests below prove score is returned while standardAnswer/rubric
// never leak, and that result-hidden never leaks score either.
describe("P3-2 candidate result / answer visibility boundaries", () => {
  let ctx: TestContext;
  let courseId: string;
  let singleChoiceId: string;
  let textResponseId: string;
  let textResponseNullId: string;
  let candidateProfileId: string;

  // Second candidate (for the ownership test). Created directly in the DB and
  // given a signed token, mirroring ensureCandidateProfile + the foreign-admin
  // pattern already used in this file.
  let candidateBProfileId: string;
  let candidateBToken: string;

  async function createManualGradedMixedExam(opts: {
    title: string;
    resultPublicationMode: "immediate" | "manual";
    includeTextResponse: boolean;
  }): Promise<{ examId: string; attemptId: string }> {
    const createResponse = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        title: opts.title,
        description: "",
        courseId,
        timingMode: "timed_window",
        durationMinutes: 60,
        openAt: new Date(Date.now() - 3600000).toISOString(),
        closeAt: new Date(Date.now() + 86400000).toISOString(),
        passingScore: 10,
        totalScore: opts.includeTextResponse ? 30 : 10,
        questionSelectionMode: "manual",
        questionIds: opts.includeTextResponse
          ? [singleChoiceId, textResponseId]
          : [singleChoiceId],
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
        resultPublicationMode: opts.resultPublicationMode,
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

    // Answer the objective question correctly (auto-grades to 10 on submit).
    await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attemptId}/answers/${singleChoiceId}`,
      payload: {
        attemptId,
        questionId: singleChoiceId,
        answer: "a",
        clientSeq: 1,
        clientSavedAt: new Date().toISOString(),
        baseVersion: 0,
      },
      cookies: { "auth-token": ctx.candidateToken },
    });
    if (opts.includeTextResponse) {
      await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/answers/${textResponseId}`,
        payload: {
          attemptId,
          questionId: textResponseId,
          answer: "candidate essay text",
          clientSeq: 2,
          clientSavedAt: new Date().toISOString(),
          baseVersion: 0,
        },
        cookies: { "auth-token": ctx.candidateToken },
      });
    }
    await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attemptId}/submit`,
      cookies: { "auth-token": ctx.candidateToken },
    });

    // For the mixed exam the text_response is pending_manual after submit.
    // Mark the attempt fully_graded directly (visibility LOGIC is under test,
    // not the grading command which P1 already proves): set gradingStatus,
    // score, passed, gradedAt, and a terminal gradingResult for the
    // text_response entry so resolveCandidateResultVisibility sees a ready result.
    if (opts.includeTextResponse) {
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
      const gradingResult = (attempt?.gradingResult ?? []).map((r) =>
        r.questionId === textResponseId
          ? { ...r, score: 20, correct: true }
          : r,
      );
      await createAttemptRepo(ctx.db).update(requestContext, attemptId, {
        // Terminal state: status=graded + fully_graded so
        // resolveCandidateResultVisibility treats the result as computable
        // (it requires status==="graded").
        status: "graded",
        gradingStatus: "fully_graded",
        score: 30,
        passed: true,
        gradedAt: new Date(),
        gradingResult,
      });
    }
    return { examId, attemptId };
  }

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(examRoutes, { prefix: "" });
      await fastify.register(attemptRoutes, { prefix: "" });
      await fastify.register(scoreRoutes, { prefix: "" });
    });
    courseId = crypto.randomUUID();
    singleChoiceId = crypto.randomUUID();
    textResponseId = crypto.randomUUID();
    textResponseNullId = crypto.randomUUID();
    await ctx.db.insert(schema.courses).values({
      id: courseId,
      organizationId: ctx.org.id,
      name: "P3-2 Course",
      code: `P32-${uniquePrefix()}`,
      description: "",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await ctx.db.insert(schema.questions).values({
      id: singleChoiceId,
      organizationId: ctx.org.id,
      courseId,
      type: "single_choice",
      content: "P3-2 objective",
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
      rubric: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    // text_response WITH a reference standardAnswer + multiline rubric.
    await ctx.db.insert(schema.questions).values({
      id: textResponseId,
      organizationId: ctx.org.id,
      courseId,
      type: "text_response",
      content: "P3-2 essay prompt",
      options: [],
      standardAnswer: "参考论述内容",
      attachments: [],
      score: 20,
      difficulty: 3,
      tags: [],
      gradingRule: {
        multiSelectScoring: "all_correct_full",
        fillBlankMatchMode: "exact",
      },
      rubric: "关键概念：10 分\n论证完整：10 分",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    // text_response with standardAnswer=null + non-empty rubric (INV-VA2).
    await ctx.db.insert(schema.questions).values({
      id: textResponseNullId,
      organizationId: ctx.org.id,
      courseId,
      type: "text_response",
      content: "P3-2 essay prompt null answer",
      options: [],
      standardAnswer: null,
      attachments: [],
      score: 20,
      difficulty: 3,
      tags: [],
      gradingRule: {
        multiSelectScoring: "all_correct_full",
        fillBlankMatchMode: "exact",
      },
      rubric: "评分标准存在",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    candidateProfileId = await ensureCandidateProfile(ctx);

    // Second candidate for the ownership boundary.
    const now = new Date();
    const userIdB = crypto.randomUUID();
    candidateBProfileId = crypto.randomUUID();
    await ctx.db.insert(schema.users).values({
      id: userIdB,
      organizationId: ctx.org.id,
      username: `p32-cand-b-${uniquePrefix()}`,
      passwordHash: "not-used",
      name: "Candidate B",
      role: "Candidate",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    // RBAC-M10-E: assignment so candidateBToken can act.
    await ctx.db.insert(schema.userRoleAssignments).values({
      id: crypto.randomUUID(),
      organizationId: ctx.org.id,
      userId: userIdB,
      role: "Candidate",
      isPrimary: true,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert(schema.candidateProfiles).values({
      id: candidateBProfileId,
      organizationId: ctx.org.id,
      userId: userIdB,
      fields: {},
      createdAt: now,
      updatedAt: now,
    });
    candidateBToken = signJWT(
      {
        actorId: userIdB,
        role: "Candidate",
        organizationId: ctx.org.id,
        authEpoch: 0,
      },
      getRuntimeConfig().authSecret.jwtSecret,
    );
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("manual mode: fully_graded + computed score is hidden from the candidate until publish", async () => {
    const { examId, attemptId } = await createManualGradedMixedExam({
      title: "P3-2 manual hidden",
      resultPublicationMode: "manual",
      includeTextResponse: true,
    });

    // Internal state is fully_graded + computed (set in the helper). The
    // candidate result must still be HIDDEN with no score leakage.
    const before = await ctx.app.inject({
      method: "GET",
      url: `/api/scores/attempts/${attemptId}`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(before.statusCode).toBe(200);
    const beforeBody = before.json();
    expect(beforeBody.showResultImmediately).toBe(false);
    expect(beforeBody.hiddenReason).toBe("pending_publish");
    expect(beforeBody).not.toHaveProperty("totalScore");
    expect(beforeBody).not.toHaveProperty("passed");
    expect(beforeBody).not.toHaveProperty("questionResults");

    // Publish results via the real endpoint, then the result becomes visible.
    const publishRes = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish-results`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(publishRes.statusCode).toBe(200);

    const after = await ctx.app.inject({
      method: "GET",
      url: `/api/scores/attempts/${attemptId}`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(after.statusCode).toBe(200);
    const afterBody = after.json();
    expect(afterBody.showResultImmediately).toBe(true);
    expect(afterBody.totalScore).toBe(30);
    expect(afterBody.passed).toBe(true);
    void examId;
  });

  it("result visible: standardAnswer is stripped and rubric never appears for any question type", async () => {
    const { attemptId } = await createManualGradedMixedExam({
      title: "P3-2 answer gate",
      resultPublicationMode: "immediate",
      includeTextResponse: true,
    });

    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/scores/attempts/${attemptId}`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    // Score is visible — this is the {result visible, answers hidden} cross.
    expect(body.showResultImmediately).toBe(true);
    expect(body.totalScore).toBe(30);
    expect(body.passed).toBe(true);

    // Every question result: no standardAnswer (stripped), no rubric (never in
    // the result DTO), no internal grading metadata.
    for (const q of body.questionResults) {
      expect(q).not.toHaveProperty("standardAnswer");
      expect(q).not.toHaveProperty("rubric");
      // Internal grading-entry / workset fields must not leak.
      expect(q).not.toHaveProperty("graderId");
      expect(q).not.toHaveProperty("gradingEntryId");
      expect(q).not.toHaveProperty("comment");
    }
    // Top-level internal fields must not leak.
    expect(body).not.toHaveProperty("gradingResult");
    expect(body).not.toHaveProperty("gradingStatus");
    expect(body).not.toHaveProperty("questionSnapshot");
  });

  it("result DTO carries manualGraded per question, preserved through the candidate answer stripping", async () => {
    // Part 1 — objective question, real auto-grading path: the candidate DTO
    // must carry manualGraded=false and still strip standardAnswer.
    const { attemptId: objectiveAttemptId } = await createManualGradedMixedExam(
      {
        title: "P3-2 manualGraded objective",
        resultPublicationMode: "immediate",
        includeTextResponse: false,
      },
    );
    const objectiveRes = await ctx.app.inject({
      method: "GET",
      url: `/api/scores/attempts/${objectiveAttemptId}`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(objectiveRes.statusCode).toBe(200);
    const objectiveBody = objectiveRes.json();
    expect(objectiveBody.questionResults).toHaveLength(1);
    expect(objectiveBody.questionResults[0]).toMatchObject({
      type: "single_choice",
      manualGraded: false,
    });
    expect(objectiveBody.questionResults[0]).not.toHaveProperty(
      "standardAnswer",
    );

    // Part 2 — text_response question completed through the REAL grading API
    // (no direct DB shortcut): the candidate DTO must carry manualGraded=true
    // for the manual question while standardAnswer stays stripped.
    const manualCreate = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        title: "P3-2 manualGraded manual",
        description: "",
        courseId,
        timingMode: "timed_window",
        durationMinutes: 60,
        openAt: new Date(Date.now() - 3600000).toISOString(),
        closeAt: new Date(Date.now() + 86400000).toISOString(),
        passingScore: 10,
        totalScore: 20,
        questionSelectionMode: "manual",
        questionIds: [textResponseId],
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
        resultPublicationMode: "immediate",
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(manualCreate.statusCode).toBe(201);
    const manualExamId = manualCreate.json().id as string;
    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${manualExamId}/publish`,
      cookies: { "auth-token": ctx.adminToken },
    });
    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${manualExamId}/enrollments`,
      payload: { candidateIds: [candidateProfileId] },
      cookies: { "auth-token": ctx.adminToken },
    });
    const start = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${manualExamId}/start`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    const manualAttemptId = start.json().id as string;
    await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${manualAttemptId}/answers/${textResponseId}`,
      payload: {
        attemptId: manualAttemptId,
        questionId: textResponseId,
        answer: "candidate essay text",
        clientSeq: 1,
        clientSavedAt: new Date().toISOString(),
        baseVersion: 0,
      },
      cookies: { "auth-token": ctx.candidateToken },
    });
    await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${manualAttemptId}/submit`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    const grade = await ctx.app.inject({
      method: "POST",
      url: `/api/admin/attempts/${manualAttemptId}/grade-question`,
      payload: { questionId: textResponseId, score: 20, comment: "ok" },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(grade.statusCode).toBe(200);

    const manualRes = await ctx.app.inject({
      method: "GET",
      url: `/api/scores/attempts/${manualAttemptId}`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(manualRes.statusCode).toBe(200);
    const manualBody = manualRes.json();
    expect(manualBody.questionResults).toHaveLength(1);
    expect(manualBody.questionResults[0]).toMatchObject({
      type: "text_response",
      manualGraded: true,
    });
    expect(manualBody.questionResults[0]).not.toHaveProperty("standardAnswer");
  });

  it("candidate can read own result but not another candidate's attempt", async () => {
    // attemptA belongs to the default candidate; candidate B is a different user.
    const { attemptId: attemptA } = await createManualGradedMixedExam({
      title: "P3-2 ownership A",
      resultPublicationMode: "immediate",
      includeTextResponse: false,
    });

    // Owner can read it.
    const own = await ctx.app.inject({
      method: "GET",
      url: `/api/scores/attempts/${attemptA}`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(own.statusCode).toBe(200);
    expect(own.json().showResultImmediately).toBe(true);

    // Candidate B cannot read candidate A's attempt — ownership, not just role.
    const cross = await ctx.app.inject({
      method: "GET",
      url: `/api/scores/attempts/${attemptA}`,
      cookies: { "auth-token": candidateBToken },
    });
    expect(cross.statusCode).toBe(404);
  });

  it("frozen result metadata is immune to live-question edits", async () => {
    const { attemptId } = await createManualGradedMixedExam({
      title: "P3-2 frozen metadata",
      resultPublicationMode: "immediate",
      includeTextResponse: false,
    });

    // The objective question is in the result questionResults (auto-graded).
    // Its content/prompt comes from the attempt's frozen questionSnapshot, not
    // a live-question JOIN. Capture it, mutate the live row, then prove the
    // candidate result still reads the frozen value.
    const before = await ctx.app.inject({
      method: "GET",
      url: `/api/scores/attempts/${attemptId}`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    const beforePrompt = before
      .json()
      .questionResults.find(
        (q: { questionId: string }) => q.questionId === singleChoiceId,
      )?.content;

    await ctx.db
      .update(schema.questions)
      .set({
        content: "P3-2 LIVE EDITED objective prompt",
        standardAnswer: "b",
        rubric: "LIVE EDITED rubric",
        updatedAt: new Date(),
      })
      .where(eq(schema.questions.id, singleChoiceId));

    const after = await ctx.app.inject({
      method: "GET",
      url: `/api/scores/attempts/${attemptId}`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    const afterPrompt = after
      .json()
      .questionResults.find(
        (q: { questionId: string }) => q.questionId === singleChoiceId,
      )?.content;
    expect(afterPrompt).toBe(beforePrompt);
    expect(afterPrompt).toBe("P3-2 objective");
    expect(afterPrompt).not.toBe("P3-2 LIVE EDITED objective prompt");
    // And the live edit still didn't leak standardAnswer/rubric.
    for (const q of after.json().questionResults) {
      expect(q).not.toHaveProperty("standardAnswer");
      expect(q).not.toHaveProperty("rubric");
    }
  });
});

// ── P3-MOD-P3-3: Admin frozen result view ─────────────────────────
// Proves the Admin result projection is INDEPENDENT of candidate release
// (INV-A1), reads frozen QuestionSnapshot truth (INV-A2/A5), keeps
// standardAnswer for Admin (inverse of the candidate strip), and is
// authorization-gated. The grading-details frozen-rubric/standardAnswer
// immunity is already PROVEN in gradingQueue.test.ts (P3-MOD-P1-1 block);
// this block covers the scores-endpoint Admin view AttemptDetailPage consumes.
describe("P3-3 admin frozen result view", () => {
  let ctx: TestContext;
  let courseId: string;
  let singleChoiceId: string;
  let textResponseId: string;
  let candidateProfileId: string;

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(examRoutes, { prefix: "" });
      await fastify.register(attemptRoutes, { prefix: "" });
      await fastify.register(scoreRoutes, { prefix: "" });
    });
    courseId = crypto.randomUUID();
    singleChoiceId = crypto.randomUUID();
    textResponseId = crypto.randomUUID();
    await ctx.db.insert(schema.courses).values({
      id: courseId,
      organizationId: ctx.org.id,
      name: "P3-3 Course",
      code: `P33-${uniquePrefix()}`,
      description: "",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await ctx.db.insert(schema.questions).values({
      id: singleChoiceId,
      organizationId: ctx.org.id,
      courseId,
      type: "single_choice",
      content: "P3-3 objective prompt",
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
      rubric: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await ctx.db.insert(schema.questions).values({
      id: textResponseId,
      organizationId: ctx.org.id,
      courseId,
      type: "text_response",
      content: "P3-3 essay prompt",
      options: [],
      standardAnswer: "P3-3 frozen reference answer",
      attachments: [],
      score: 20,
      difficulty: 3,
      tags: [],
      gradingRule: {
        multiSelectScoring: "all_correct_full",
        fillBlankMatchMode: "exact",
      },
      rubric: "P3-3 key concept: 10\nfull argument: 10",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    candidateProfileId = await ensureCandidateProfile(ctx);
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  /**
   * Builds a manual-mode mixed exam, the candidate answers + submits, then the
   * attempt is marked fully_graded (terminal) with objective 10 + manual 15.
   * Returns examId/attemptId. Used for the cross-proof and frozen tests.
   */
  async function buildTerminalManualAttempt(): Promise<{
    examId: string;
    attemptId: string;
  }> {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        title: "P3-3 manual cross",
        description: "",
        courseId,
        timingMode: "timed_window",
        durationMinutes: 60,
        openAt: new Date(Date.now() - 3600000).toISOString(),
        closeAt: new Date(Date.now() + 86400000).toISOString(),
        passingScore: 20,
        totalScore: 30,
        questionSelectionMode: "manual",
        questionIds: [singleChoiceId, textResponseId],
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
        resultPublicationMode: "manual",
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    const examId = createRes.json().id as string;
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
    const startRes = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${examId}/start`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    const attemptId = startRes.json().id as string;
    await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attemptId}/answers/${singleChoiceId}`,
      payload: {
        attemptId,
        questionId: singleChoiceId,
        answer: "a",
        clientSeq: 1,
        clientSavedAt: new Date().toISOString(),
        baseVersion: 0,
      },
      cookies: { "auth-token": ctx.candidateToken },
    });
    await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attemptId}/answers/${textResponseId}`,
      payload: {
        attemptId,
        questionId: textResponseId,
        answer: "P3-3 candidate\nmultiline essay",
        clientSeq: 2,
        clientSavedAt: new Date().toISOString(),
        baseVersion: 0,
      },
      cookies: { "auth-token": ctx.candidateToken },
    });
    await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attemptId}/submit`,
      cookies: { "auth-token": ctx.candidateToken },
    });

    // Mark terminal (fully_graded, 10 + 15 = 25). Grading command is P1's
    // proven domain; the Admin visibility LOGIC is under test here.
    const adminCtx = {
      actorId: ctx.admin.id,
      organizationId: ctx.org.id,
      targetOrganizationId: ctx.org.id,
      role: "Admin" as const,
      permissions: [] as import("@exam/domain").Permission[],
      sessionId: "test",
    };
    const attempt = await createAttemptRepo(ctx.db).findById(
      adminCtx,
      attemptId,
    );
    // Build the terminal gradingResult explicitly with BOTH questions. After
    // submit-freeze the objective is auto-graded but attempt.gradingResult is a
    // projection regenerated by finalizeTerminalGrading (P1's proven domain);
    // since the grading route isn't registered in this app, set the full
    // terminal projection directly. The Admin visibility LOGIC is under test.
    const existing = new Map(
      (attempt?.gradingResult ?? []).map((r) => [r.questionId, r]),
    );
    const gradingResult = [
      {
        questionId: singleChoiceId,
        score: 10,
        maxScore: 10,
        correct: true,
        candidateAnswer: "a",
        standardAnswer: "a",
        ...(existing.get(singleChoiceId) ?? {}),
      },
      {
        questionId: textResponseId,
        score: 15,
        maxScore: 20,
        correct: true,
        candidateAnswer: "P3-3 candidate\nmultiline essay",
        standardAnswer: "P3-3 frozen reference answer",
        ...(existing.get(textResponseId) ?? {}),
      },
    ];
    await createAttemptRepo(ctx.db).update(adminCtx, attemptId, {
      status: "graded",
      gradingStatus: "fully_graded",
      score: 25,
      passed: true,
      gradedAt: new Date(),
      gradingResult,
    });
    return { examId, attemptId };
  }

  it("cross-proof: fully_graded + manual pending_publish — Admin sees full result, Candidate hidden", async () => {
    const { attemptId } = await buildTerminalManualAttempt();

    // SAME attempt, SAME moment. Admin result endpoint (scores, Admin bypasses
    // the publication gate) returns the complete terminal result.
    const adminRes = await ctx.app.inject({
      method: "GET",
      url: `/api/scores/attempts/${attemptId}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(adminRes.statusCode).toBe(200);
    const adminBody = adminRes.json();
    expect(adminBody.showResultImmediately).toBe(true);
    expect(adminBody.totalScore).toBe(25);
    expect(adminBody.passed).toBe(true);

    // Admin keeps standardAnswer (NOT stripped — inverse of the candidate gate)
    // and per-question earnedScore, from the frozen snapshot.
    const objQ = adminBody.questionResults.find(
      (q: { questionId: string }) => q.questionId === singleChoiceId,
    );
    expect(objQ.standardAnswer).toBe("a");
    expect(objQ.score).toBe(10);
    const textQ = adminBody.questionResults.find(
      (q: { questionId: string }) => q.questionId === textResponseId,
    );
    expect(textQ.score).toBe(15);

    // Candidate result for the SAME attempt is still hidden (manual,
    // pending_publish) — score/pass must not leak.
    const candRes = await ctx.app.inject({
      method: "GET",
      url: `/api/scores/attempts/${attemptId}`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(candRes.statusCode).toBe(200);
    const candBody = candRes.json();
    expect(candBody.showResultImmediately).toBe(false);
    expect(candBody.hiddenReason).toBe("pending_publish");
    expect(candBody).not.toHaveProperty("totalScore");
    expect(candBody).not.toHaveProperty("passed");
    expect(candBody).not.toHaveProperty("questionResults");
  });

  /**
   * M9 — Teacher all-view result proof.
   *
   * Proves the final P4 assignment-backed Teacher authority drives the
   * capability-path result view. Teacher preset grants ScoreAllView, so the
   * score route arbitrates own/all purely from capability and the Teacher
   * reaches the all-view path: (a) bypasses Stage 2 publication gate and (b)
   * keeps frozen standardAnswer. The Teacher is created via
   * createAssignedUserForTest (assignment-backed authority, not role-name). The
   * behavior must be immune to live-question edits (frozen snapshot truth).
   *
   * Capability-path proof:
   *   Teacher: ScoreAllView → all-view path → bypass Candidate Stage 2
   *            → retain frozen standardAnswer
   *   Candidate: ScoreOwnView → own-view path → publication gate applies
   */
  it("M9: Teacher all-view result bypasses publication gate and keeps frozen standardAnswer", async () => {
    const { attemptId } = await buildTerminalManualAttempt();

    // Teacher via assignment-backed authority (capability-driven, not role-name).
    const teacher = await createAssignedUserForTest(
      ctx.db,
      ctx.org.id,
      "Teacher",
      "m9-teacher",
    );
    // Issue #286: ScoreAllView is course-scoped for non-Admin actors — grant
    // the Teacher the attempt exam's course so the all-view path is reachable.
    const m9Now = new Date();
    await ctx.db.insert(schema.teacherCourseAssignments).values({
      id: crypto.randomUUID(),
      organizationId: ctx.org.id,
      teacherUserId: teacher.user.id,
      courseId,
      status: "active",
      assignedBy: ctx.admin.id,
      assignedAt: m9Now,
      revokedBy: null,
      revokedAt: null,
      createdAt: m9Now,
      updatedAt: m9Now,
    });

    // SAME attempt, SAME moment as the candidate read below. Teacher holds
    // ScoreAllView → all-view path → bypasses Stage 2 publication gate and
    // keeps frozen standardAnswer.
    const teacherRes = await ctx.app.inject({
      method: "GET",
      url: `/api/scores/attempts/${attemptId}`,
      cookies: { "auth-token": teacher.token },
    });
    expect(teacherRes.statusCode).toBe(200);
    const teacherBody = teacherRes.json();
    expect(teacherBody.showResultImmediately).toBe(true);
    expect(teacherBody.totalScore).toBe(25);
    expect(teacherBody.passed).toBe(true);
    expect(teacherBody.questionResults).toHaveLength(2);

    // Teacher keeps standardAnswer (all-view → NOT stripped).
    const objQ = teacherBody.questionResults.find(
      (q: { questionId: string }) => q.questionId === singleChoiceId,
    );
    expect(objQ.standardAnswer).toBe("a");

    // Candidate at the SAME moment: own-view → publication gate applies → hidden.
    const candRes = await ctx.app.inject({
      method: "GET",
      url: `/api/scores/attempts/${attemptId}`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(candRes.statusCode).toBe(200);
    const candBody = candRes.json();
    expect(candBody.showResultImmediately).toBe(false);
    expect(candBody.hiddenReason).toBe("pending_publish");
    expect(candBody).not.toHaveProperty("totalScore");
    expect(candBody).not.toHaveProperty("passed");
    expect(candBody).not.toHaveProperty("questionResults");

    // Frozen snapshot truth: mutate the LIVE question, Teacher still reads frozen.
    await ctx.db
      .update(schema.questions)
      .set({
        content: "M9 LIVE MUTATED objective prompt",
        standardAnswer: "b",
        updatedAt: new Date(),
      })
      .where(eq(schema.questions.id, singleChoiceId));

    const afterMutate = await ctx.app.inject({
      method: "GET",
      url: `/api/scores/attempts/${attemptId}`,
      cookies: { "auth-token": teacher.token },
    });
    const afterObj = afterMutate
      .json()
      .questionResults.find(
        (q: { questionId: string }) => q.questionId === singleChoiceId,
      );
    expect(afterObj.content).toBe("P3-3 objective prompt");
    expect(afterObj.standardAnswer).toBe("a");
    expect(afterObj.standardAnswer).not.toBe("b");

    // Restore the shared live-question fixture so later tests in this block
    // (which assert the original content/standardAnswer) see a clean state.
    await ctx.db
      .update(schema.questions)
      .set({
        content: "P3-3 objective prompt",
        standardAnswer: "a",
        updatedAt: new Date(),
      })
      .where(eq(schema.questions.id, singleChoiceId));
  });

  it("admin scores result is immune to live-question mutation (frozen snapshot truth)", async () => {
    const { attemptId } = await buildTerminalManualAttempt();

    const before = await ctx.app.inject({
      method: "GET",
      url: `/api/scores/attempts/${attemptId}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    const beforeObj = before
      .json()
      .questionResults.find(
        (q: { questionId: string }) => q.questionId === singleChoiceId,
      );

    // Mutate the LIVE question content/standardAnswer. The admin result reads
    // the attempt's frozen questionSnapshot (buildQuestionResults joins
    // gradingResult × questionSnapshot), so it must not drift.
    await ctx.db
      .update(schema.questions)
      .set({
        content: "P3-3 LIVE MUTATED objective prompt",
        standardAnswer: "b",
        updatedAt: new Date(),
      })
      .where(eq(schema.questions.id, singleChoiceId));

    const after = await ctx.app.inject({
      method: "GET",
      url: `/api/scores/attempts/${attemptId}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    const afterObj = after
      .json()
      .questionResults.find(
        (q: { questionId: string }) => q.questionId === singleChoiceId,
      );
    expect(afterObj.content).toBe(beforeObj.content);
    expect(afterObj.content).toBe("P3-3 objective prompt");
    expect(afterObj.standardAnswer).toBe("a");
    expect(afterObj.standardAnswer).not.toBe("b");
  });

  it("publish-results flips candidate visibility but does not change the admin projection", async () => {
    const { examId, attemptId } = await buildTerminalManualAttempt();

    const adminBefore = await ctx.app.inject({
      method: "GET",
      url: `/api/scores/attempts/${attemptId}`,
      cookies: { "auth-token": ctx.adminToken },
    });

    // Publish results — candidate becomes visible.
    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish-results`,
      cookies: { "auth-token": ctx.adminToken },
    });

    const candAfter = await ctx.app.inject({
      method: "GET",
      url: `/api/scores/attempts/${attemptId}`,
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(candAfter.json().showResultImmediately).toBe(true);
    expect(candAfter.json().totalScore).toBe(25);

    // Admin projection is unchanged by publication (no recompute).
    const adminAfter = await ctx.app.inject({
      method: "GET",
      url: `/api/scores/attempts/${attemptId}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(adminAfter.json().totalScore).toBe(adminBefore.json().totalScore);
    expect(adminAfter.json().passed).toBe(adminBefore.json().passed);
  });

  it("rejects unauthenticated access to the admin result endpoint", async () => {
    const { attemptId } = await buildTerminalManualAttempt();
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/scores/attempts/${attemptId}`,
    });
    expect(res.statusCode).toBe(401);
  });
});
