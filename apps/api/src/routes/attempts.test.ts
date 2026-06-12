import { describe, expect, it, beforeAll, afterAll, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import type { TestContext } from "./testHelpers.js";
import {
  buildTestApp,
  uniquePrefix,
  createCandidateViaApi,
} from "./testHelpers.js";
import examRoutes from "./exam.js";
import attemptRoutes from "./attempts.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { signJWT } from "@exam/auth/src/session.js";
import { scanDatabaseForDisruptedAttempts } from "../plugins/heartbeat.js";

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

describe("attempt routes", () => {
  let ctx: TestContext;
  let examId: string;
  let courseId: string;
  let questionId: string;
  let fillBlankQuestionId: string;
  let candidateProfileId: string;

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(examRoutes, { prefix: "" });
      await fastify.register(attemptRoutes, { prefix: "" });
    });

    courseId = crypto.randomUUID();
    questionId = crypto.randomUUID();
    fillBlankQuestionId = crypto.randomUUID();
    candidateProfileId = crypto.randomUUID();

    await ctx.db.insert(schema.courses).values({
      id: courseId,
      organizationId: ctx.org.id,
      name: "Test Course",
      code: `TC-${uniquePrefix()}`,
      description: "Test",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await ctx.db.insert(schema.questions).values({
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
    });

    await ctx.db.insert(schema.questions).values({
      id: fillBlankQuestionId,
      organizationId: ctx.org.id,
      courseId,
      type: "fill_blank",
      content: "安全出口标识的颜色是____色",
      options: [],
      standardAnswer: "绿",
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
    });

    candidateProfileId = await ensureCandidateProfile(ctx);

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
    await ctx.cleanup();
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

  describe("GET /candidate/exams/:examId", () => {
    it("returns active attempt metadata without creating a new attempt", async () => {
      const examResponse = await ctx.app.inject({
        method: "POST",
        url: "/api/exams",
        payload: {
          title: "Resume Exam",
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
          retakePolicy: "max_attempts",
          scoreStrategy: "highest",
          maxAttempts: 1,
        },
        cookies: { "auth-token": ctx.adminToken },
      });
      const resumeExamId = examResponse.json().id as string;

      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${resumeExamId}/publish`,
        cookies: { "auth-token": ctx.adminToken },
      });

      const startResponse = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${resumeExamId}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      const attemptId = startResponse.json().id as string;

      const candidateCtx = {
        actorId: ctx.candidate.id,
        organizationId: ctx.org.id,
        role: "Candidate" as const,
        permissions: [] as import("@exam/domain").Permission[],
        sessionId: "test",
        targetOrganizationId: ctx.org.id,
      };
      const beforeList = await createAttemptRepo(ctx.db).findByExamAndCandidate(
        candidateCtx,
        resumeExamId,
        candidateProfileId,
      );

      const detailResponse = await ctx.app.inject({
        method: "GET",
        url: `/api/candidate/exams/${resumeExamId}`,
        cookies: { "auth-token": ctx.candidateToken },
      });

      expect(detailResponse.statusCode).toBe(200);
      expect(detailResponse.json()).toMatchObject({
        id: resumeExamId,
        currentAttempts: 1,
        maxAttempts: 1,
        activeAttemptId: attemptId,
        canStartNewAttempt: false,
      });

      const afterList = await createAttemptRepo(ctx.db).findByExamAndCandidate(
        candidateCtx,
        resumeExamId,
        candidateProfileId,
      );
      expect(afterList).toHaveLength(beforeList.length);
    });

    it("returns max-attempt blocking reason after all attempts are used", async () => {
      const examResponse = await ctx.app.inject({
        method: "POST",
        url: "/api/exams",
        payload: {
          title: "Blocked Exam",
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
          retakePolicy: "max_attempts",
          scoreStrategy: "highest",
          maxAttempts: 1,
        },
        cookies: { "auth-token": ctx.adminToken },
      });
      const blockedExamId = examResponse.json().id as string;

      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${blockedExamId}/publish`,
        cookies: { "auth-token": ctx.adminToken },
      });

      const startResponse = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${blockedExamId}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      const attemptId = startResponse.json().id as string;

      await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/submit`,
        cookies: { "auth-token": ctx.candidateToken },
      });

      const detailResponse = await ctx.app.inject({
        method: "GET",
        url: `/api/candidate/exams/${blockedExamId}`,
        cookies: { "auth-token": ctx.candidateToken },
      });

      expect(detailResponse.statusCode).toBe(200);
      expect(detailResponse.json()).toMatchObject({
        currentAttempts: 1,
        maxAttempts: 1,
        canStartNewAttempt: false,
        blockingReason: "max_attempts_reached",
      });
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
      await ctx.db.insert(schema.users).values({
        id: userId,
        organizationId: ctx.org.id,
        username: `candidate-${userId}`,
        passwordHash: "unused",
        name: "Other Candidate",
        role: "Candidate",
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await ctx.db.insert(schema.candidateProfiles).values({
        id: crypto.randomUUID(),
        organizationId: ctx.org.id,
        userId,
        fields: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });
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
      const body = res.json();
      expect(body.error).toBeDefined();
      expect(typeof body.error.code).toBe("string");
      expect(typeof body.error.message).toBe("string");
    });
  });

  describe("POST /attempts/:attemptId/submit — deadline 行为", () => {
    let deadlineExamId: string;

    beforeAll(async () => {
      const exam = await ctx.app.inject({
        method: "POST",
        url: "/api/exams",
        payload: {
          title: "Deadline Submit Exam",
          description: "",
          courseId,
          timingMode: "timed_window",
          durationMinutes: 1,
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
      deadlineExamId = exam.json().id;

      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${deadlineExamId}/publish`,
        cookies: { "auth-token": ctx.adminToken },
      });
    });

    afterEach(() => {
      ctx.setNow(null);
    });

    it("rejects submit when fastify.now() is past deadlineAt", async () => {
      const startRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${deadlineExamId}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(startRes.statusCode).toBe(201);
      const lateAttemptId = startRes.json().id as string;

      ctx.setNow(new Date(Date.now() + 5 * 60 * 1000));

      const submitRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${lateAttemptId}/submit`,
        cookies: { "auth-token": ctx.candidateToken },
      });

      expect(submitRes.statusCode).toBe(409);
      expect(submitRes.json()).toEqual({
        error: {
          code: "ATTEMPT_DEADLINE_EXCEEDED",
          message: "Attempt deadline exceeded",
        },
      });
    });
  });

  describe("POST /attempts/:attemptId/submit — ownership safety net", () => {
    let otherCandidateToken: string;
    let ownAttemptId: string;
    let ownershipExamId: string;

    beforeAll(async () => {
      const otherUserId = crypto.randomUUID();
      await ctx.db.insert(schema.users).values({
        id: otherUserId,
        organizationId: ctx.org.id,
        username: `other-candidate-${uniquePrefix()}`,
        passwordHash: "unused",
        name: "Other Candidate",
        role: "Candidate",
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const otherProfileId = crypto.randomUUID();
      await ctx.db.insert(schema.candidateProfiles).values({
        id: otherProfileId,
        organizationId: ctx.org.id,
        userId: otherUserId,
        fields: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      otherCandidateToken = signJWT({
        actorId: otherUserId,
        role: "Candidate",
        organizationId: ctx.org.id,
      });

      const examRes = await ctx.app.inject({
        method: "POST",
        url: "/api/exams",
        payload: {
          title: "Ownership Test Exam",
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
      ownershipExamId = examRes.json().id;

      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${ownershipExamId}/publish`,
        cookies: { "auth-token": ctx.adminToken },
      });

      const startRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${ownershipExamId}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      ownAttemptId = startRes.json().id;
    });

    it("rejects submit by a different candidate (404)", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${ownAttemptId}/submit`,
        cookies: { "auth-token": otherCandidateToken },
      });

      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body.error).toBeDefined();
      expect(typeof body.error.code).toBe("string");
      expect(typeof body.error.message).toBe("string");
    });

    it("owner can still submit after cross-candidate attempt", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${ownAttemptId}/submit`,
        cookies: { "auth-token": ctx.candidateToken },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe("graded");
    });
  });

  describe("POST /attempts/:attemptId/answers/:questionId — rejects after submit", () => {
    let gradedAttemptId: string;
    let gradedQuestionId: string;
    let answersBeforeSave: unknown;

    beforeAll(async () => {
      gradedQuestionId = questionId;

      const examRes = await ctx.app.inject({
        method: "POST",
        url: "/api/exams",
        payload: {
          title: "Save After Submit Exam",
          description: "",
          courseId,
          timingMode: "timed_window",
          durationMinutes: 60,
          openAt: new Date(Date.now() - 3600000).toISOString(),
          closeAt: new Date(Date.now() + 86400000).toISOString(),
          passingScore: 60,
          totalScore: 100,
          questionSelectionMode: "manual",
          questionIds: [gradedQuestionId],
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
      const gradedExamId = examRes.json().id;

      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${gradedExamId}/publish`,
        cookies: { "auth-token": ctx.adminToken },
      });

      const startRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${gradedExamId}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      gradedAttemptId = startRes.json().id;

      await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${gradedAttemptId}/submit`,
        cookies: { "auth-token": ctx.candidateToken },
      });

      const attemptRepo = createAttemptRepo(ctx.db);
      const candidateCtx = {
        actorId: ctx.candidate.id,
        organizationId: ctx.org.id,
        role: "Candidate" as const,
        permissions: [] as import("@exam/domain").Permission[],
        sessionId: "test",
        targetOrganizationId: ctx.org.id,
      };
      const row = await attemptRepo.findById(candidateCtx, gradedAttemptId);
      answersBeforeSave = row?.answers;
    });

    it("rejects save when attempt is graded (accepted: false, conflict: SUBMITTED)", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${gradedAttemptId}/answers/${gradedQuestionId}`,
        payload: {
          attemptId: gradedAttemptId,
          questionId: gradedQuestionId,
          answer: true,
          clientSeq: 999,
          clientSavedAt: new Date().toISOString(),
          baseVersion: 0,
        },
        cookies: { "auth-token": ctx.candidateToken },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.accepted).toBe(false);
      expect(body.conflict).toBeDefined();
      expect(body.conflict.reason).toBe("SUBMITTED");
    });

    it("does not modify attempt answers in DB after rejected save", async () => {
      const attemptRepo = createAttemptRepo(ctx.db);
      const candidateCtx = {
        actorId: ctx.candidate.id,
        organizationId: ctx.org.id,
        role: "Candidate" as const,
        permissions: [] as import("@exam/domain").Permission[],
        sessionId: "test",
        targetOrganizationId: ctx.org.id,
      };
      const row = await attemptRepo.findById(candidateCtx, gradedAttemptId);
      expect(row?.answers).toEqual(answersBeforeSave);
    });
  });

  describe("fill_blank attempt flow", () => {
    it("loads, saves, submits, and grades a fill_blank answer", async () => {
      const examResponse = await ctx.app.inject({
        method: "POST",
        url: "/api/exams",
        payload: {
          title: "Fill Blank Flow Exam",
          description: "",
          courseId,
          timingMode: "timed_window",
          durationMinutes: 60,
          openAt: new Date(Date.now() - 3600000).toISOString(),
          closeAt: new Date(Date.now() + 86400000).toISOString(),
          passingScore: 60,
          totalScore: 100,
          questionSelectionMode: "manual",
          questionIds: [fillBlankQuestionId],
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
      const fillBlankExamId = examResponse.json().id as string;

      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${fillBlankExamId}/publish`,
        cookies: { "auth-token": ctx.adminToken },
      });

      const startResponse = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${fillBlankExamId}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      const attemptId = startResponse.json().id as string;

      expect(startResponse.statusCode).toBe(201);
      expect(startResponse.json().questionSnapshot[0]).toMatchObject({
        type: "fill_blank",
        content: "安全出口标识的颜色是____色",
      });

      const loadResponse = await ctx.app.inject({
        method: "GET",
        url: `/api/attempts/${attemptId}`,
        cookies: { "auth-token": ctx.candidateToken },
      });

      expect(loadResponse.statusCode).toBe(200);
      expect(loadResponse.json().questionSnapshot[0].type).toBe("fill_blank");

      const saveResponse = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/answers/${fillBlankQuestionId}`,
        payload: {
          attemptId,
          questionId: fillBlankQuestionId,
          answer: "绿",
          clientSeq: 1,
          clientSavedAt: new Date().toISOString(),
          baseVersion: 0,
        },
        cookies: { "auth-token": ctx.candidateToken },
      });

      expect(saveResponse.statusCode).toBe(200);
      expect(saveResponse.json()).toMatchObject({
        accepted: true,
        serverVersion: 1,
      });

      const submitResponse = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/submit`,
        cookies: { "auth-token": ctx.candidateToken },
      });

      expect(submitResponse.statusCode).toBe(200);
      expect(submitResponse.json()).toMatchObject({
        status: "graded",
        score: 100,
        passed: true,
      });
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

    it("marks stale attempts as disrupted during the background scan", async () => {
      const result = await scanDatabaseForDisruptedAttempts(
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
      const attempt = await createAttemptRepo(ctx.db).findById(
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
      await attemptRepo.update(candidateCtx, attemptId, {
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
