import { describe, expect, it, beforeAll, afterAll, afterEach } from "vitest";
import { eq } from "drizzle-orm";
import type { TestContext } from "./testHelpers.js";
import { buildTestApp, uniquePrefix } from "./testHelpers.js";
import examRoutes from "./exam.js";
import attemptRoutes from "./attempts.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { signJWT } from "@exam/auth/src/session.js";
import { scanDatabaseForDisruptedAttempts } from "../plugins/heartbeat.js";
import { scanDatabaseForExpiredAttempts } from "../plugins/deadlineScanner.js";
import { autoSubmitAndGrade } from "../plugins/deadlineScanner.js";
import { getSaveAnswerMessage } from "@exam/contracts";

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

const DEFAULT_CONTROL_FLAGS = {
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
} as const;

function buildExamPayload(
  overrides: Partial<{
    title: string;
    courseId: string;
    questionIds: string[];
    controlFlags: object;
    retakePolicy: string;
    scoreStrategy: string;
    maxAttempts: number;
    passingScore: number;
    totalScore: number;
    durationMinutes: number;
  }> = {},
) {
  return {
    title: "Test Exam",
    description: "",
    courseId: overrides.courseId ?? "",
    timingMode: "timed_window" as const,
    durationMinutes: overrides.durationMinutes ?? 60,
    openAt: new Date(Date.now() - 3600000).toISOString(),
    closeAt: new Date(Date.now() + 86400000).toISOString(),
    passingScore: overrides.passingScore ?? 60,
    totalScore: overrides.totalScore ?? 100,
    questionSelectionMode: "manual" as const,
    questionIds: overrides.questionIds ?? [],
    controlFlags: overrides.controlFlags ?? { ...DEFAULT_CONTROL_FLAGS },
    retakePolicy: overrides.retakePolicy ?? "unlimited",
    scoreStrategy: overrides.scoreStrategy ?? "highest",
    maxAttempts: overrides.maxAttempts ?? 3,
  };
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
      payload: buildExamPayload({
        title: "Attempt Test Exam",
        courseId,
        questionIds: [questionId],
      }),
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

    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/enrollments`,
      payload: { candidateIds: [candidateProfileId] },
      cookies: { "auth-token": ctx.adminToken },
    });
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  async function enrollCandidateForExam(examId: string) {
    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/enrollments`,
      payload: { candidateIds: [candidateProfileId] },
      cookies: { "auth-token": ctx.adminToken },
    });
  }

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

    it("double-click start creates only one active attempt in DB", async () => {
      const examRes = await ctx.app.inject({
        method: "POST",
        url: "/api/exams",
        payload: buildExamPayload({
          title: "DoubleClick Exam",
          courseId,
          questionIds: [questionId],
        }),
        cookies: { "auth-token": ctx.adminToken },
      });
      const dcExamId = examRes.json().id as string;

      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${dcExamId}/publish`,
        cookies: { "auth-token": ctx.adminToken },
      });
      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${dcExamId}/enrollments`,
        payload: { candidateIds: [candidateProfileId] },
        cookies: { "auth-token": ctx.adminToken },
      });

      const [res1, res2] = await Promise.all([
        ctx.app.inject({
          method: "POST",
          url: `/api/attempts/${dcExamId}/start`,
          cookies: { "auth-token": ctx.candidateToken },
        }),
        ctx.app.inject({
          method: "POST",
          url: `/api/attempts/${dcExamId}/start`,
          cookies: { "auth-token": ctx.candidateToken },
        }),
      ]);

      const codes = [res1.statusCode, res2.statusCode].sort();
      expect(codes).toEqual([200, 201]);
      expect(res1.json().id).toBe(res2.json().id);

      const candidateCtx = {
        actorId: ctx.candidate.id,
        organizationId: ctx.org.id,
        role: "Candidate" as const,
        permissions: [] as import("@exam/domain").Permission[],
        sessionId: "test",
        targetOrganizationId: ctx.org.id,
      };
      const allAttempts = await createAttemptRepo(
        ctx.db,
      ).findByExamAndCandidate(candidateCtx, dcExamId, candidateProfileId);
      const activeAttempts = allAttempts.filter(
        (a) => a.status === "in_progress",
      );
      expect(activeAttempts).toHaveLength(1);
    });

    it("returns 401 without auth", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${examId}/start`,
      });
      expect(res.statusCode).toBe(401);
    });

    it("rejects unassigned candidate (Phase 1 requires explicit enrollment)", async () => {
      const unassignedUserId = crypto.randomUUID();
      await ctx.db.insert(schema.users).values({
        id: unassignedUserId,
        organizationId: ctx.org.id,
        username: `unassigned-${uniquePrefix()}`,
        passwordHash: "$argon2id$dummy",
        name: "Unassigned Candidate",
        role: "Candidate",
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await ctx.db.insert(schema.candidateProfiles).values({
        id: crypto.randomUUID(),
        organizationId: ctx.org.id,
        userId: unassignedUserId,
        fields: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const unassignedToken = signJWT({
        actorId: unassignedUserId,
        role: "Candidate",
        organizationId: ctx.org.id,
      });

      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${examId}/start`,
        cookies: { "auth-token": unassignedToken },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe("PERMISSION_DENIED");
    });
  });

  describe("GET /candidate/exams/:examId", () => {
    it("returns active attempt metadata without creating a new attempt", async () => {
      const examResponse = await ctx.app.inject({
        method: "POST",
        url: "/api/exams",
        payload: buildExamPayload({
          title: "Resume Exam",
          courseId,
          questionIds: [questionId],
          retakePolicy: "max_attempts",
          maxAttempts: 1,
        }),
        cookies: { "auth-token": ctx.adminToken },
      });
      const resumeExamId = examResponse.json().id as string;

      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${resumeExamId}/publish`,
        cookies: { "auth-token": ctx.adminToken },
      });
      await enrollCandidateForExam(resumeExamId);

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
        payload: buildExamPayload({
          title: "Blocked Exam",
          courseId,
          questionIds: [questionId],
          retakePolicy: "max_attempts",
          maxAttempts: 1,
        }),
        cookies: { "auth-token": ctx.adminToken },
      });
      const blockedExamId = examResponse.json().id as string;

      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${blockedExamId}/publish`,
        cookies: { "auth-token": ctx.adminToken },
      });
      await enrollCandidateForExam(blockedExamId);

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
        payload: buildExamPayload({
          title: "Load Test Exam",
          courseId,
          questionIds: [questionId],
        }),
        cookies: { "auth-token": ctx.adminToken },
      });
      const examId2 = exam2.json().id;

      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId2}/publish`,
        cookies: { "auth-token": ctx.adminToken },
      });
      await enrollCandidateForExam(examId2);

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
        payload: buildExamPayload({
          title: "Answer Test Exam",
          courseId,
          questionIds: [questionId],
        }),
        cookies: { "auth-token": ctx.adminToken },
      });
      const examId3 = exam3.json().id;

      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId3}/publish`,
        cookies: { "auth-token": ctx.adminToken },
      });
      await enrollCandidateForExam(examId3);

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
      expect(res.json().reason).toBe("STALE_VERSION");
      expect(res.json().message).toBe(getSaveAnswerMessage("STALE_VERSION"));
      expect(res.json().serverVersion).toBe(2);
      expect(res.json().details).toEqual({ serverAnswer: "c" });
    });

    it("preserves a null server answer in stale-version details", async () => {
      const saveNull = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/answers/${qId}`,
        payload: {
          attemptId,
          questionId: qId,
          answer: null,
          clientSeq: 4,
          clientSavedAt: new Date().toISOString(),
          baseVersion: 2,
        },
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(saveNull.json().accepted).toBe(true);

      const stale = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/answers/${qId}`,
        payload: {
          attemptId,
          questionId: qId,
          answer: "late",
          clientSeq: 5,
          clientSavedAt: new Date().toISOString(),
          baseVersion: 2,
        },
        cookies: { "auth-token": ctx.candidateToken },
      });

      expect(stale.json()).toMatchObject({
        accepted: false,
        reason: "STALE_VERSION",
        serverVersion: 3,
        details: { serverAnswer: null },
      });
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
        payload: buildExamPayload({
          title: "Submit Test Exam",
          courseId,
          questionIds: [questionId],
        }),
        cookies: { "auth-token": ctx.adminToken },
      });
      const examId4 = exam4.json().id;

      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId4}/publish`,
        cookies: { "auth-token": ctx.adminToken },
      });
      await enrollCandidateForExam(examId4);

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

    it("idempotent: re-submitting a graded attempt returns the graded result (FIX-2)", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/submit`,
        cookies: { "auth-token": ctx.candidateToken },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe("graded");
      expect(body.score).toBe(0);
      expect(body.passed).toBe(false);
    });
  });

  describe("POST /attempts/:attemptId/submit — idempotent retry-grading (FIX-2)", () => {
    let retryExamId: string;

    beforeAll(async () => {
      const exam = await ctx.app.inject({
        method: "POST",
        url: "/api/exams",
        payload: buildExamPayload({
          title: "Retry Grading Exam",
          courseId,
          questionIds: [questionId],
        }),
        cookies: { "auth-token": ctx.adminToken },
      });
      retryExamId = exam.json().id;
      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${retryExamId}/publish`,
        cookies: { "auth-token": ctx.adminToken },
      });
      await enrollCandidateForExam(retryExamId);
    });

    it("re-grades an attempt stuck in submitted after a crash", async () => {
      const startRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${retryExamId}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      const stuckAttemptId = startRes.json().id as string;

      const qId = startRes.json().questionSnapshot[0].originalQuestionId;
      await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${stuckAttemptId}/answers/${qId}`,
        payload: {
          attemptId: stuckAttemptId,
          questionId: qId,
          answer: "b",
          clientSeq: 1,
          clientSavedAt: new Date().toISOString(),
          baseVersion: 0,
        },
        cookies: { "auth-token": ctx.candidateToken },
      });

      await ctx.db
        .update(schema.examAttempts)
        .set({
          status: "submitted",
          submittedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.examAttempts.id, stuckAttemptId));

      const submitRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${stuckAttemptId}/submit`,
        cookies: { "auth-token": ctx.candidateToken },
      });

      expect(submitRes.statusCode).toBe(200);
      expect(submitRes.json().status).toBe("graded");
      expect(submitRes.json().score).toBe(100);
      expect(submitRes.json().passed).toBe(true);
    });
  });

  describe("POST /attempts/:attemptId/answers — deadline contract (FIX-1)", () => {
    let deadlineContractExamId: string;

    beforeAll(async () => {
      const exam = await ctx.app.inject({
        method: "POST",
        url: "/api/exams",
        payload: buildExamPayload({
          title: "Deadline Contract Exam",
          courseId,
          questionIds: [questionId],
          durationMinutes: 1,
        }),
        cookies: { "auth-token": ctx.adminToken },
      });
      deadlineContractExamId = exam.json().id;
      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${deadlineContractExamId}/publish`,
        cookies: { "auth-token": ctx.adminToken },
      });
      await enrollCandidateForExam(deadlineContractExamId);
    });

    afterEach(() => {
      ctx.setNow(null);
    });

    it("rejects save-answer after deadline with DEADLINE_EXCEEDED, but still allows submit of saved answers", async () => {
      const startRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${deadlineContractExamId}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      const attemptId = startRes.json().id as string;
      const qId = startRes.json().questionSnapshot[0].originalQuestionId;

      const saveBefore = await ctx.app.inject({
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
      expect(saveBefore.json().accepted).toBe(true);

      ctx.setNow(new Date(Date.now() + 5 * 60 * 1000));

      const saveAfter = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/answers/${qId}`,
        payload: {
          attemptId,
          questionId: qId,
          answer: "a",
          clientSeq: 2,
          clientSavedAt: new Date().toISOString(),
          baseVersion: 1,
        },
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(saveAfter.statusCode).toBe(200);
      expect(saveAfter.json().accepted).toBe(false);
      expect(saveAfter.json().reason).toBe("DEADLINE_EXCEEDED");
      expect(saveAfter.json().message).toBe(
        getSaveAnswerMessage("DEADLINE_EXCEEDED"),
      );

      const submitRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/submit`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(submitRes.statusCode).toBe(200);
      expect(submitRes.json().status).toBe("graded");
      expect(submitRes.json().score).toBe(100);
    });
  });

  describe("POST /attempts/:attemptId/submit — deadline 行为", () => {
    let deadlineExamId: string;

    beforeAll(async () => {
      const exam = await ctx.app.inject({
        method: "POST",
        url: "/api/exams",
        payload: buildExamPayload({
          title: "Deadline Submit Exam",
          courseId,
          questionIds: [questionId],
          durationMinutes: 1,
        }),
        cookies: { "auth-token": ctx.adminToken },
      });
      deadlineExamId = exam.json().id;

      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${deadlineExamId}/publish`,
        cookies: { "auth-token": ctx.adminToken },
      });
      await enrollCandidateForExam(deadlineExamId);
    });

    afterEach(() => {
      ctx.setNow(null);
    });

    it("allows submit even when fastify.now() is past deadlineAt", async () => {
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

      expect(submitRes.statusCode).toBe(200);
      expect(submitRes.json().status).toBe("graded");
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
        payload: buildExamPayload({
          title: "Ownership Test Exam",
          courseId,
          questionIds: [questionId],
        }),
        cookies: { "auth-token": ctx.adminToken },
      });
      ownershipExamId = examRes.json().id;

      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${ownershipExamId}/publish`,
        cookies: { "auth-token": ctx.adminToken },
      });
      await enrollCandidateForExam(ownershipExamId);

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
      expect(body.error.code).toBe("RESOURCE_NOT_FOUND");
      expect(body.error.requestId).toEqual(expect.any(String));
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
        payload: buildExamPayload({
          title: "Save After Submit Exam",
          courseId,
          questionIds: [gradedQuestionId],
        }),
        cookies: { "auth-token": ctx.adminToken },
      });
      const gradedExamId = examRes.json().id;

      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${gradedExamId}/publish`,
        cookies: { "auth-token": ctx.adminToken },
      });
      await enrollCandidateForExam(gradedExamId);

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

    it("rejects save when attempt is graded (accepted: false, conflict: ATTEMPT_ALREADY_SUBMITTED)", async () => {
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
      expect(body.reason).toBeDefined();
      expect(body.reason).toBe("ATTEMPT_ALREADY_SUBMITTED");
      expect(body.message).toBe(
        getSaveAnswerMessage("ATTEMPT_ALREADY_SUBMITTED"),
      );
    });

    it("DB invariant: answers unchanged after rejected save (regression guard for route-level rejection)", async () => {
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
        payload: buildExamPayload({
          title: "Fill Blank Flow Exam",
          courseId,
          questionIds: [fillBlankQuestionId],
        }),
        cookies: { "auth-token": ctx.adminToken },
      });
      const fillBlankExamId = examResponse.json().id as string;

      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${fillBlankExamId}/publish`,
        cookies: { "auth-token": ctx.adminToken },
      });
      await enrollCandidateForExam(fillBlankExamId);

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
        payload: buildExamPayload({
          title: "Heartbeat Test Exam",
          courseId,
          questionIds: [questionId],
        }),
        cookies: { "auth-token": ctx.adminToken },
      });
      const examId5 = exam5.json().id;

      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId5}/publish`,
        cookies: { "auth-token": ctx.adminToken },
      });
      await enrollCandidateForExam(examId5);

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
      expect(res.headers["content-type"]).toMatch(/application\/json/);
      expect(res.json()).toEqual({ ok: true });
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
    }, 15_000);
  });

  describe("POST /attempts/:attemptId/restore", () => {
    let attemptId: string;

    beforeAll(async () => {
      const exam6 = await ctx.app.inject({
        method: "POST",
        url: "/api/exams",
        payload: buildExamPayload({
          title: "Restore Test Exam",
          courseId,
          questionIds: [questionId],
        }),
        cookies: { "auth-token": ctx.adminToken },
      });
      const examId6 = exam6.json().id;

      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId6}/publish`,
        cookies: { "auth-token": ctx.adminToken },
      });
      await enrollCandidateForExam(examId6);

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

    it("restores with deadlineAt adjusted for disconnected time", async () => {
      const exam7 = await ctx.app.inject({
        method: "POST",
        url: "/api/exams",
        payload: buildExamPayload({
          title: "Restore Deadline Exam",
          courseId,
          questionIds: [questionId],
        }),
        cookies: { "auth-token": ctx.adminToken },
      });
      const examId7 = exam7.json().id;

      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${examId7}/publish`,
        cookies: { "auth-token": ctx.adminToken },
      });
      await enrollCandidateForExam(examId7);

      const startRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${examId7}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      const attId = startRes.json().id;
      const originalDeadline = new Date(startRes.json().deadlineAt);

      const lastActivity = new Date(Date.now() - 5 * 60_000);
      const attemptRepo = createAttemptRepo(ctx.db);
      const candidateCtxVal = {
        actorId: ctx.candidate.id,
        organizationId: ctx.org.id,
        role: "Candidate" as const,
        permissions: [] as import("@exam/domain").Permission[],
        sessionId: "test",
        targetOrganizationId: ctx.org.id,
      };
      await attemptRepo.update(candidateCtxVal, attId, {
        status: "disrupted",
        lastActivityAt: lastActivity,
      });

      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attId}/restore`,
        cookies: { "auth-token": ctx.candidateToken },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe("in_progress");
      const restoredDeadline = new Date(body.deadlineAt);
      const disconnectedMs = Date.now() - lastActivity.getTime();
      const expectedMinDeadline = new Date(
        originalDeadline.getTime() + disconnectedMs - 2000,
      );
      expect(restoredDeadline.getTime()).toBeGreaterThanOrEqual(
        expectedMinDeadline.getTime(),
      );
    });
  });

  describe("CandidateExamSummary availabilityStatus derivation", () => {
    async function createAndEnrollExam(
      opts: {
        title?: string;
        retakePolicy?: string;
        maxAttempts?: number;
        openOffsetMs?: number;
        closeOffsetMs?: number;
        enroll?: boolean;
      } = {},
    ): Promise<string> {
      const id = crypto.randomUUID();
      const snapshot = [
        {
          originalQuestionId: questionId,
          type: "single_choice" as const,
          content: "Q",
          attachments: [] as never[],
          options: [{ id: "a", content: "A" }],
          standardAnswer: "a",
          score: 100,
          gradingRule: {
            multiSelectScoring: "all_correct_full" as const,
            fillBlankMatchMode: "exact" as const,
          },
          order: 0,
        },
      ];
      await ctx.db.insert(schema.exams).values({
        id,
        organizationId: ctx.org.id,
        title: opts.title ?? `Summary-${uniquePrefix()}`,
        description: "",
        courseId,
        status: "open",
        timingMode: "timed_window",
        durationMinutes: 60,
        openAt: new Date(Date.now() + (opts.openOffsetMs ?? -3600000)),
        closeAt: new Date(Date.now() + (opts.closeOffsetMs ?? 86400000)),
        passingScore: 60,
        totalScore: 100,
        questionSelectionMode: "manual",
        questionIds: [questionId],
        questionSnapshot: snapshot,
        controlFlags: { ...DEFAULT_CONTROL_FLAGS },
        retakePolicy: (opts.retakePolicy ?? "max_attempts") as
          | "max_attempts"
          | "unlimited"
          | "pass_then_stop",
        scoreStrategy: "highest",
        maxAttempts: opts.maxAttempts ?? 3,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      if (opts.enroll !== false) {
        await ctx.db.insert(schema.examEnrollments).values({
          id: crypto.randomUUID(),
          organizationId: ctx.org.id,
          examId: id,
          candidateId: candidateProfileId,
          status: "assigned",
          attemptCount: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }
      return id;
    }

    async function getSummary(
      examId: string,
    ): Promise<Record<string, unknown>> {
      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/candidate/exams",
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(Array.isArray(body)).toBe(true);
      const exams = body as Array<Record<string, unknown>>;
      const found = exams.find((e) => e.examId === examId);
      expect(found).toBeDefined();
      return found!;
    }

    async function startAndSubmit(examId: string): Promise<string> {
      const startRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${examId}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(startRes.statusCode).toBe(201);
      const attemptId = startRes.json().id;
      const submitRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/submit`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(submitRes.statusCode).toBe(200);
      return attemptId;
    }

    it("derives available/start when no attempts inside window", async () => {
      const freshExamId = await createAndEnrollExam({
        title: "Available Exam",
      });
      const target = await getSummary(freshExamId);
      expect(target.availabilityStatus).toBe("available");
      expect(target.primaryAction).toBe("start");
    });

    it("derives in_progress/resume when active attempt exists", async () => {
      const inProgressExamId = await createAndEnrollExam({
        title: "InProgress Exam",
      });
      await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${inProgressExamId}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      const target = await getSummary(inProgressExamId);
      expect(target.availabilityStatus).toBe("in_progress");
      expect(target.primaryAction).toBe("resume");
    });

    it("derives resumable/resume when disrupted attempt exists", async () => {
      const disruptedExamId = await createAndEnrollExam({
        title: "Disrupted Exam",
      });
      const startRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${disruptedExamId}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      const candidateCtx = {
        actorId: ctx.candidate.id,
        organizationId: ctx.org.id,
        role: "Candidate" as const,
        permissions: [] as import("@exam/domain").Permission[],
        sessionId: "test",
        targetOrganizationId: ctx.org.id,
      };
      await createAttemptRepo(ctx.db).update(candidateCtx, startRes.json().id, {
        status: "disrupted",
      });
      const target = await getSummary(disruptedExamId);
      expect(target.availabilityStatus).toBe("resumable");
      expect(target.primaryAction).toBe("resume");
    });

    it("derives max_attempts_exhausted/view_result after exhausting attempts", async () => {
      const exhaustExamId = await createAndEnrollExam({
        title: "Exhaust Exam",
        maxAttempts: 1,
      });
      await startAndSubmit(exhaustExamId);
      const target = await getSummary(exhaustExamId);
      expect(target.availabilityStatus).toBe("max_attempts_exhausted");
      expect(target.primaryAction).toBe("view_result");
    });

    it("rejects start API when maxAttempts exhausted", async () => {
      const exhaustExamId = await createAndEnrollExam({
        title: "Reject Exam",
        maxAttempts: 1,
      });
      await startAndSubmit(exhaustExamId);

      const rejectRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${exhaustExamId}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });

      expect(rejectRes.statusCode).toBe(409);
      expect(rejectRes.json().error.code).toBe("MAX_ATTEMPTS_REACHED");
    });

    it("rejects start API with 403 when candidate is not enrolled", async () => {
      const notEnrolledExamId = await createAndEnrollExam({
        title: "Not Enrolled Exam",
        enroll: false,
      });

      const rejectRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${notEnrolledExamId}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });

      expect(rejectRes.statusCode).toBe(403);
      expect(rejectRes.json().error.code).toBe("PERMISSION_DENIED");
    });

    it("derives graded/view_result when graded but attempts remain", async () => {
      const gradeExamId = await createAndEnrollExam({
        title: "Grade Exam",
        maxAttempts: 3,
      });
      await startAndSubmit(gradeExamId);
      const target = await getSummary(gradeExamId);
      expect(target.availabilityStatus).toBe("graded");
      expect(target.primaryAction).toBe("view_result");
      expect(target.bestScore).toBeDefined();
    });

    it("derives not_started_yet when before window", async () => {
      const futureExamId = await createAndEnrollExam({
        title: "Future Exam",
        openOffsetMs: 86400000,
        closeOffsetMs: 172800000,
      });
      const target = await getSummary(futureExamId);
      expect(target.availabilityStatus).toBe("not_started_yet");
      expect(target.primaryAction).toBe("none");
    });

    it("derives expired when after window with no attempts", async () => {
      const expiredExamId = await createAndEnrollExam({
        title: "Expired Exam",
        maxAttempts: 3,
        openOffsetMs: -172800000,
        closeOffsetMs: -86400000,
      });
      const target = await getSummary(expiredExamId);
      expect(target.availabilityStatus).toBe("expired");
      expect(target.primaryAction).toBe("none");
    });
  });

  describe("deadline scanner — scanDatabaseForExpiredAttempts", () => {
    const candidateCtx = () => ({
      actorId: ctx.candidate.id,
      organizationId: ctx.org.id,
      role: "Candidate" as const,
      permissions: [] as import("@exam/domain").Permission[],
      sessionId: "test",
      targetOrganizationId: ctx.org.id,
    });

    async function createStartedAttemptWithQuestion(
      examTitle: string,
    ): Promise<{ attemptId: string; questionId: string }> {
      const exam = await ctx.app.inject({
        method: "POST",
        url: "/api/exams",
        payload: buildExamPayload({
          title: examTitle,
          courseId,
          questionIds: [questionId],
          durationMinutes: 1,
        }),
        cookies: { "auth-token": ctx.adminToken },
      });
      const localExamId = exam.json().id;
      await ctx.app.inject({
        method: "POST",
        url: `/api/exams/${localExamId}/publish`,
        cookies: { "auth-token": ctx.adminToken },
      });
      await enrollCandidateForExam(localExamId);

      const startRes = await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${localExamId}/start`,
        cookies: { "auth-token": ctx.candidateToken },
      });
      const attemptId = startRes.json().id as string;

      const examDetail = (
        await ctx.app.inject({
          method: "GET",
          url: `/api/exams/${localExamId}`,
          cookies: { "auth-token": ctx.adminToken },
        })
      ).json();
      const localQuestionId = examDetail.questionIds[0];

      await ctx.app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/answers/${localQuestionId}`,
        payload: {
          attemptId,
          questionId: localQuestionId,
          answer: true,
          clientSeq: 1,
          clientSavedAt: new Date().toISOString(),
          baseVersion: 0,
        },
        cookies: { "auth-token": ctx.candidateToken },
      });

      return { attemptId, questionId: localQuestionId };
    }

    async function backdateDeadline(attemptId: string): Promise<void> {
      const past = new Date(Date.now() - 60_000);
      await ctx.db
        .update(schema.examAttempts)
        .set({ deadlineAt: past, status: "in_progress" })
        .where(eq(schema.examAttempts.id, attemptId));
    }

    it("auto-submits and grades an expired in_progress attempt end-to-end", async () => {
      const { attemptId } = await createStartedAttemptWithQuestion(
        "Deadline AutoSubmit InProgress Exam",
      );
      await backdateDeadline(attemptId);

      const result = await scanDatabaseForExpiredAttempts(ctx.app, new Date());

      expect(result.submittedCount).toBeGreaterThanOrEqual(1);

      const attempt = await createAttemptRepo(ctx.db).findById(
        candidateCtx(),
        attemptId,
      );
      expect(attempt?.status).toBe("graded");
      expect(attempt?.submittedAt).toBeDefined();
      expect(attempt?.gradedAt).toBeDefined();
      expect(attempt?.score).toBeDefined();
    });

    it("records exactly one attempt.autoSubmit audit event on a successful auto-submit", async () => {
      const { attemptId } = await createStartedAttemptWithQuestion(
        "Deadline AutoSubmit Audit Exam",
      );
      await backdateDeadline(attemptId);

      await scanDatabaseForExpiredAttempts(ctx.app, new Date());

      const auditRows = await ctx.db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.targetId, attemptId));
      const autoSubmitRows = auditRows.filter(
        (r) => r.action === "attempt.autoSubmit",
      );
      expect(autoSubmitRows).toHaveLength(1);
      expect(autoSubmitRows[0]!.targetType).toBe("attempt");
    });

    it("does NOT write a phantom attempt.autoSubmit audit when the row is already submitted at lock time (race no-op)", async () => {
      // Reproduces the scanner race: another submitter (manual or concurrent
      // scanner) wins and moves the attempt to `submitted` before this scanner
      // takes the row lock. autoSubmitAndGrade must perform no state change
      // (return false) and must NOT emit a phantom attempt.autoSubmit audit.
      const { attemptId } = await createStartedAttemptWithQuestion(
        "Deadline AutoSubmit Race Exam",
      );
      await backdateDeadline(attemptId);
      const scannerCtx = {
        actorId: "system:deadline-scanner",
        organizationId: ctx.org.id,
        role: "Admin" as const,
        permissions: [] as import("@exam/domain").Permission[],
        sessionId: "system:deadline-scanner",
        targetOrganizationId: ctx.org.id,
      };

      // Pre-empt the scanner exactly as a concurrent winner would.
      await ctx.db
        .update(schema.examAttempts)
        .set({ status: "submitted", submittedAt: new Date() })
        .where(eq(schema.examAttempts.id, attemptId));

      const stateChanged = await autoSubmitAndGrade(
        ctx.db,
        scannerCtx,
        attemptId,
        new Date(),
      );

      expect(stateChanged).toBe(false);

      const auditRows = await ctx.db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.targetId, attemptId));
      const autoSubmitRows = auditRows.filter(
        (r) => r.action === "attempt.autoSubmit",
      );
      expect(autoSubmitRows).toHaveLength(0);

      // Row remains as the winner left it; scanner did not auto-grade it.
      const attempt = await createAttemptRepo(ctx.db).findById(
        candidateCtx(),
        attemptId,
      );
      expect(attempt?.status).toBe("submitted");
    });

    it("is idempotent: second scan does not re-grade or duplicate audit", async () => {
      const { attemptId } = await createStartedAttemptWithQuestion(
        "Deadline AutoSubmit Idempotent Exam",
      );
      await backdateDeadline(attemptId);

      await scanDatabaseForExpiredAttempts(ctx.app, new Date());
      const firstAttempt = await createAttemptRepo(ctx.db).findById(
        candidateCtx(),
        attemptId,
      );
      const firstGradedAt = firstAttempt?.gradedAt;

      await ctx.db
        .update(schema.examAttempts)
        .set({ deadlineAt: new Date(Date.now() - 60_000) })
        .where(eq(schema.examAttempts.id, attemptId));

      const second = await scanDatabaseForExpiredAttempts(ctx.app, new Date());

      expect(second.submittedCount).toBe(0);

      const afterSecond = await createAttemptRepo(ctx.db).findById(
        candidateCtx(),
        attemptId,
      );
      expect(afterSecond?.status).toBe("graded");
      expect(afterSecond?.gradedAt?.getTime()).toBe(firstGradedAt?.getTime());

      const auditRows = await ctx.db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.targetId, attemptId));
      const autoSubmitCount = auditRows.filter(
        (r) => r.action === "attempt.autoSubmit",
      ).length;
      expect(autoSubmitCount).toBe(1);
    });

    it("auto-submits a disrupted attempt whose deadline has passed", async () => {
      const { attemptId } = await createStartedAttemptWithQuestion(
        "Deadline AutoSubmit Disrupted Exam",
      );
      await backdateDeadline(attemptId);
      await ctx.db
        .update(schema.examAttempts)
        .set({ status: "disrupted" })
        .where(eq(schema.examAttempts.id, attemptId));

      const result = await scanDatabaseForExpiredAttempts(ctx.app, new Date());
      expect(result.submittedCount).toBeGreaterThanOrEqual(1);

      const attempt = await createAttemptRepo(ctx.db).findById(
        candidateCtx(),
        attemptId,
      );
      expect(attempt?.status).toBe("graded");
    });

    it("does not touch a voided attempt whose deadline has passed", async () => {
      const { attemptId } = await createStartedAttemptWithQuestion(
        "Deadline AutoSubmit Voided Exam",
      );
      await backdateDeadline(attemptId);
      await ctx.db
        .update(schema.examAttempts)
        .set({ status: "voided" })
        .where(eq(schema.examAttempts.id, attemptId));

      const result = await scanDatabaseForExpiredAttempts(ctx.app, new Date());

      const attempt = await createAttemptRepo(ctx.db).findById(
        candidateCtx(),
        attemptId,
      );
      expect(attempt?.status).toBe("voided");
      expect(result.submittedCount).toBe(0);
    });

    it("does not auto-submit an in_progress attempt whose deadline is still future", async () => {
      const { attemptId } = await createStartedAttemptWithQuestion(
        "Deadline AutoSubmit Future Exam",
      );
      await ctx.db
        .update(schema.examAttempts)
        .set({ deadlineAt: new Date(Date.now() + 3600_000) })
        .where(eq(schema.examAttempts.id, attemptId));

      await scanDatabaseForExpiredAttempts(ctx.app, new Date());

      const attempt = await createAttemptRepo(ctx.db).findById(
        candidateCtx(),
        attemptId,
      );
      expect(attempt?.status).toBe("in_progress");
    });
  });
});
