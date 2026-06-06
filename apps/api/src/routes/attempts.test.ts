import { describe, expect, it, beforeAll, afterAll } from "vitest";
import type { TestContext } from "./testHelpers.js";
import { buildTestApp } from "./testHelpers.js";
import examRoutes from "./exam.js";
import attemptRoutes from "./attempts.js";
import { sqliteSchema } from "@exam/db/src/schema/sqlite.js";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { signJWT } from "@exam/auth/src/session.js";
import { scanDatabaseForDisruptedAttempts } from "../plugins/heartbeat.js";

describe("attempt routes", () => {
  let ctx: TestContext;
  let examId: string;
  let courseId: string;
  let questionId: string;
  let candidateProfileId: string;

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(examRoutes, { prefix: "" });
      await fastify.register(attemptRoutes, { prefix: "" });
    });

    courseId = crypto.randomUUID();
    questionId = crypto.randomUUID();
    candidateProfileId = crypto.randomUUID();

    ctx.db
      .insert(sqliteSchema.courses)
      .values({
        id: courseId,
        organizationId: ctx.org.id,
        name: "Test Course",
        code: "TC101",
        description: "Test",
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
        content: "What is 1+1?",
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

    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        title: "Attempt Test Exam",
        description: "",
        courseId,
        timingMode: "timed_window",
        durationMinutes: 60,
        openAt: new Date(Date.now() - 3600000).toISOString(),
        closeAt: new Date(Date.now() + 86400000).toISOString(),
        passingScore: 60,
        totalScore: 100,
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
    if (res.statusCode !== 201) {
      throw new Error(
        `Failed to create exam: ${res.statusCode} ${JSON.stringify(res.json())}`,
      );
    }
    examId = res.json().id;

    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish`,
      cookies: { "auth-token": ctx.adminToken },
    });
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  describe("POST /attempts/:examId/start", () => {
    it("starts attempt for candidate", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${examId}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.status).toBe("in_progress");
      expect(body.examId).toBe(examId);
      expect(body.candidateId).toBe(candidateProfileId);
      expect(body.questionSnapshot).toBeDefined();
      expect(body.questionSnapshot).toHaveLength(1);
      expect(body.deadlineAt).toBeDefined();
      expect(body.startedAt).toBeDefined();
    });

    it("returns existing attempt on repeated start", async () => {
      const res1 = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${examId}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      const attemptId = res1.json().id;

      const res2 = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${examId}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });

      expect(res2.statusCode).toBe(200);
      expect(res2.json().id).toBe(attemptId);
    });

    it("returns 401 without auth", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${examId}/start`,
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("GET /attempts/:id", () => {
    let attemptId: string;

    beforeAll(async () => {
      const exam2 = await ctx.app.inject({
        method: "POST",
        url: "/api/exams",
        payload: {
          title: "Load Test Exam",
          description: "",
          courseId,
          timingMode: "timed_window",
          durationMinutes: 60,
          openAt: new Date(Date.now() - 3600000).toISOString(),
          closeAt: new Date(Date.now() + 86400000).toISOString(),
          passingScore: 60,
          totalScore: 100,
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
      const examId2 = exam2.json().id;

      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId2}/publish`,
        cookies: { "auth-token": ctx.adminToken },
      });

      const startRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${examId2}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      attemptId = startRes.json().id;
    });

    it("returns attempt without standardAnswer", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: `/api/attempts/${attemptId}`,
        cookies: { "auth-token": ctx.candidateToken },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe(attemptId);
      expect(body.questionSnapshot).toHaveLength(1);
      expect(body.questionSnapshot[0]).not.toHaveProperty("standardAnswer");
      expect(body.questionSnapshot[0]).toHaveProperty("content");
    });

    it("returns 400 for malformed attempt id", async () => {
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/attempts/nonexistent",
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(res.statusCode).toBe(400);
    });

    it("does not expose another candidate's attempt", async () => {
      const userId = crypto.randomUUID();
      ctx.db
        .insert(sqliteSchema.users)
        .values({
          id: userId,
          organizationId: ctx.org.id,
          username: `candidate-${userId}`,
          passwordHash: "unused",
          name: "Other Candidate",
          role: "Candidate",
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .run();
      ctx.db
        .insert(sqliteSchema.candidateProfiles)
        .values({
          id: crypto.randomUUID(),
          organizationId: ctx.org.id,
          userId,
          fields: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .run();
      const token = signJWT({
        actorId: userId,
        role: "Candidate",
        organizationId: ctx.org.id,
      });

      const res = await ctx.app.inject({
        method: "GET",
        url: `/api/attempts/${attemptId}`,
        cookies: { "auth-token": token },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  describe("POST /attempts/:attemptId/answers/:questionId", () => {
    let attemptId: string;
    let qId: string;

    beforeAll(async () => {
      const exam3 = await ctx.app.inject({
        method: "POST",
        url: "/api/exams",
        payload: {
          title: "Answer Test Exam",
          description: "",
          courseId,
          timingMode: "timed_window",
          durationMinutes: 60,
          openAt: new Date(Date.now() - 3600000).toISOString(),
          closeAt: new Date(Date.now() + 86400000).toISOString(),
          passingScore: 60,
          totalScore: 100,
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
      const examId3 = exam3.json().id;

      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId3}/publish`,
        cookies: { "auth-token": ctx.adminToken },
      });

      const startRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${examId3}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      attemptId = startRes.json().id;
      qId = startRes.json().questionSnapshot[0].originalQuestionId;
    });

    it("saves answer successfully", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/answers/${qId}`,
        payload: {
          attemptId,
          questionId: qId,
          answer: "b",
          clientSeq: 1,
          clientSavedAt: new Date().toISOString(),
          baseVersion: 0,
        },
        cookies: { "auth-token": ctx.candidateToken },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.accepted).toBe(true);
      expect(body.serverVersion).toBe(1);
      expect(body.savedAt).toBeDefined();
    });

    it("returns idempotent result for same clientSeq", async () => {
      const res1 = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/answers/${qId}`,
        payload: {
          attemptId,
          questionId: qId,
          answer: "b",
          clientSeq: 1,
          clientSavedAt: new Date().toISOString(),
          baseVersion: 0,
        },
        cookies: { "auth-token": ctx.candidateToken },
      });
      const savedAt = res1.json().savedAt;

      const res2 = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/answers/${qId}`,
        payload: {
          attemptId,
          questionId: qId,
          answer: "b",
          clientSeq: 1,
          clientSavedAt: new Date().toISOString(),
          baseVersion: 0,
        },
        cookies: { "auth-token": ctx.candidateToken },
      });

      expect(res2.json().accepted).toBe(true);
      expect(res2.json().serverVersion).toBe(res1.json().serverVersion);
      expect(res2.json().savedAt).toBe(savedAt);
    });

    it("accepts new version with correct baseVersion", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/answers/${qId}`,
        payload: {
          attemptId,
          questionId: qId,
          answer: "c",
          clientSeq: 2,
          clientSavedAt: new Date().toISOString(),
          baseVersion: 1,
        },
        cookies: { "auth-token": ctx.candidateToken },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().accepted).toBe(true);
      expect(res.json().serverVersion).toBe(2);
    });

    it("replays an older clientSeq after a newer version is saved", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/answers/${qId}`,
        payload: {
          attemptId,
          questionId: qId,
          answer: "b",
          clientSeq: 1,
          clientSavedAt: new Date().toISOString(),
          baseVersion: 0,
        },
        cookies: { "auth-token": ctx.candidateToken },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().accepted).toBe(true);
      expect(res.json().serverVersion).toBe(1);
    });

    it("rejects stale version", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/answers/${qId}`,
        payload: {
          attemptId,
          questionId: qId,
          answer: "a",
          clientSeq: 3,
          clientSavedAt: new Date().toISOString(),
          baseVersion: 0,
        },
        cookies: { "auth-token": ctx.candidateToken },
      });

      expect(res.json().accepted).toBe(false);
      expect(res.json().conflict?.reason).toBe("STALE_VERSION");
    });

    it("returns 400 for malformed save payload", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/answers/${qId}`,
        payload: {
          attemptId,
          questionId: qId,
          clientSeq: -1,
        },
        cookies: { "auth-token": ctx.candidateToken },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("VALIDATION_ERROR");
    });

    it("rejects answers for questions outside the attempt snapshot", async () => {
      const otherQuestionId = crypto.randomUUID();
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/answers/${otherQuestionId}`,
        payload: {
          attemptId,
          questionId: otherQuestionId,
          answer: "b",
          clientSeq: 4,
          clientSavedAt: new Date().toISOString(),
          baseVersion: 0,
        },
        cookies: { "auth-token": ctx.candidateToken },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("VALIDATION_ERROR");
    });
  });

  describe("POST /attempts/:attemptId/submit", () => {
    let attemptId: string;

    beforeAll(async () => {
      const exam4 = await ctx.app.inject({
        method: "POST",
        url: "/api/exams",
        payload: {
          title: "Submit Test Exam",
          description: "",
          courseId,
          timingMode: "timed_window",
          durationMinutes: 60,
          openAt: new Date(Date.now() - 3600000).toISOString(),
          closeAt: new Date(Date.now() + 86400000).toISOString(),
          passingScore: 60,
          totalScore: 100,
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
      const examId4 = exam4.json().id;

      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId4}/publish`,
        cookies: { "auth-token": ctx.adminToken },
      });

      const startRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${examId4}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      attemptId = startRes.json().id;
    });

    it("submits in_progress attempt", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/submit`,
        cookies: { "auth-token": ctx.candidateToken },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe("graded");
      expect(res.json().score).toBe(0);
      expect(res.json().passed).toBe(false);
      expect(res.json().submittedAt).toBeDefined();
      expect(res.json().questionSnapshot[0]).not.toHaveProperty(
        "standardAnswer",
      );
    });

    it("rejects double submit", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/submit`,
        cookies: { "auth-token": ctx.candidateToken },
      });

      expect(res.statusCode).toBe(409);
    });
  });

  describe("POST /attempts/:attemptId/heartbeat", () => {
    let attemptId: string;

    beforeAll(async () => {
      const exam5 = await ctx.app.inject({
        method: "POST",
        url: "/api/exams",
        payload: {
          title: "Heartbeat Test Exam",
          description: "",
          courseId,
          timingMode: "timed_window",
          durationMinutes: 60,
          openAt: new Date(Date.now() - 3600000).toISOString(),
          closeAt: new Date(Date.now() + 86400000).toISOString(),
          passingScore: 60,
          totalScore: 100,
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
      const examId5 = exam5.json().id;

      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId5}/publish`,
        cookies: { "auth-token": ctx.adminToken },
      });

      const startRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${examId5}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      attemptId = startRes.json().id;
    });

    it("updates lastActivityAt", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/heartbeat`,
        cookies: { "auth-token": ctx.candidateToken },
      });

      expect(res.statusCode).toBe(200);
    });

    it("marks stale attempts as disrupted during the background scan", () => {
      const result = scanDatabaseForDisruptedAttempts(
        ctx.app,
        new Date(Date.now() + 61_000),
        60_000,
      );
      const candidateCtx = {
        actorId: ctx.candidate.id,
        organizationId: ctx.org.id,
        role: "Candidate" as const,
        permissions: [] as import("@exam/domain").Permission[],
        sessionId: "test",
        targetOrganizationId: ctx.org.id,
      };
      const attempt = createAttemptRepo(ctx.db).findById(
        candidateCtx,
        attemptId,
      );

      expect(result.markedCount).toBeGreaterThan(0);
      expect(attempt?.status).toBe("disrupted");
    });
  });

  describe("POST /attempts/:attemptId/restore", () => {
    let attemptId: string;

    beforeAll(async () => {
      const exam6 = await ctx.app.inject({
        method: "POST",
        url: "/api/exams",
        payload: {
          title: "Restore Test Exam",
          description: "",
          courseId,
          timingMode: "timed_window",
          durationMinutes: 60,
          openAt: new Date(Date.now() - 3600000).toISOString(),
          closeAt: new Date(Date.now() + 86400000).toISOString(),
          passingScore: 60,
          totalScore: 100,
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
      const examId6 = exam6.json().id;

      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId6}/publish`,
        cookies: { "auth-token": ctx.adminToken },
      });

      const startRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${examId6}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      attemptId = startRes.json().id;

      const attemptRepo = createAttemptRepo(ctx.db);
      const candidateCtx = {
        actorId: ctx.candidate.id,
        organizationId: ctx.org.id,
        role: "Candidate" as const,
        permissions: [] as import("@exam/domain").Permission[],
        sessionId: "test",
        targetOrganizationId: ctx.org.id,
      };
      attemptRepo.update(candidateCtx, attemptId, {
        status: "disrupted",
      });
    });

    it("restores disrupted attempt to in_progress", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/restore`,
        cookies: { "auth-token": ctx.candidateToken },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe("in_progress");
    });
  });
});
