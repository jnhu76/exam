import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import courseRoutes from "./course.js";
import questionRoutes from "./question.js";
import examRoutes from "./exam.js";
import attemptRoutes from "./attempts.js";
import candidateRoutes from "./candidate.js";
import scoreRoutes from "./scores.js";
import {
  buildTestApp,
  createAssignedUserForTest,
  createCandidateViaApi,
  uniquePrefix,
} from "./testHelpers.js";

/**
 * P4-2C capability cutover — Teacher exam authoring/lifecycle proof (task 8.4).
 *
 * The exam authoring routes flipped from requireRole(["Admin"]) to
 * requireCapability. Teacher preset grants ExamCreate/ExamUpdate/ExamPublish/
 * ExamClose/ExamResultPublish/ExamEnrollmentManage/ScoreAllView, so Teacher
 * must pass each permitted gate through real authoring, lifecycle, enrollment,
 * result-publication, and score-list behavior. Candidate has no exam permission
 * and Admin retains compatibility access.
 */
describe("exam routes — P4-2C capability cutover (Teacher authoring)", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let courseId: string;
  let questionId: string;
  let teacherToken: string;
  let candidateToken: string;

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(courseRoutes);
      await fastify.register(questionRoutes);
      await fastify.register(candidateRoutes);
      await fastify.register(examRoutes);
      await fastify.register(attemptRoutes);
      await fastify.register(scoreRoutes);
    });

    // Seed course + a publishable question (publish requires >=1 question).
    const courseRes = await ctx.app.inject({
      method: "POST",
      url: "/api/courses",
      payload: {
        name: "P4-2C Course",
        code: `P42C-${uniquePrefix()}`,
        description: "",
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    courseId = courseRes.json().id;

    const qRes = await ctx.app.inject({
      method: "POST",
      url: "/api/questions",
      payload: {
        courseId,
        type: "true_false",
        content: "P4-2C question.",
        standardAnswer: true,
        score: 100,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    questionId = qRes.json().id;

    // RBAC-M10-E: delegates to createAssignedUserForTest so the user gets an
    // active primary role assignment — without it, authenticate denies 401 and
    // the capability decisions under test never run.
    const mkUser = async (role: "Teacher" | "Candidate") => {
      const { token } = await createAssignedUserForTest(
        ctx.db,
        ctx.org.id,
        role,
        `p42c-${role.toLowerCase()}-exam-auth`,
      );
      return token;
    };
    teacherToken = await mkUser("Teacher");
    candidateToken = await mkUser("Candidate");
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  async function createTeacherDraft(
    title: string,
    overrides: Record<string, unknown> = {},
  ) {
    return ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        courseId,
        title,
        description: "",
        durationMinutes: 60,
        openAt: new Date(Date.now() + 3_600_000).toISOString(),
        closeAt: new Date(Date.now() + 86_400_000).toISOString(),
        passingScore: 50,
        totalScore: 100,
        questionIds: [questionId],
        ...overrides,
      },
      cookies: { "auth-token": teacherToken },
    });
  }

  it("Teacher creates a draft exam (passes the create gate)", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        courseId,
        title: "P4-2C Exam",
        description: "",
        durationMinutes: 60,
        openAt: new Date().toISOString(),
        closeAt: new Date(Date.now() + 86400000).toISOString(),
        passingScore: 50,
        totalScore: 100,
        questionIds: [questionId],
      },
      cookies: { "auth-token": teacherToken },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().title).toBe("P4-2C Exam");
    expect(res.json().status).toBe("draft");
  });

  it("Teacher lists exams (passes the view gate)", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/exams",
      cookies: { "auth-token": teacherToken },
    });
    expect(res.statusCode).toBe(200);
  });

  it("Teacher reads and updates a draft exam", async () => {
    const draftRes = await createTeacherDraft("P4-2C Read Update Exam");
    expect(draftRes.statusCode).toBe(201);
    const examId = draftRes.json().id as string;

    const detailRes = await ctx.app.inject({
      method: "GET",
      url: `/api/exams/${examId}`,
      cookies: { "auth-token": teacherToken },
    });
    expect(detailRes.statusCode).toBe(200);
    expect(detailRes.json().id).toBe(examId);

    const updateRes = await ctx.app.inject({
      method: "PATCH",
      url: `/api/exams/${examId}`,
      payload: { title: "P4-2C Updated Exam" },
      cookies: { "auth-token": teacherToken },
    });
    expect(updateRes.statusCode).toBe(200);
    expect(updateRes.json().title).toBe("P4-2C Updated Exam");
  });

  it("Teacher publishes a draft exam (passes the publish gate; draft -> published)", async () => {
    // Create a fresh draft to publish (publish is a one-way transition).
    const draftRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        courseId,
        title: "P4-2C Publish Exam",
        description: "",
        durationMinutes: 60,
        openAt: new Date().toISOString(),
        closeAt: new Date(Date.now() + 86400000).toISOString(),
        passingScore: 50,
        totalScore: 100,
        questionIds: [questionId],
      },
      cookies: { "auth-token": teacherToken },
    });
    expect(draftRes.statusCode).toBe(201);
    const examId = draftRes.json().id;

    const pubRes = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish`,
      cookies: { "auth-token": teacherToken },
    });
    expect(pubRes.statusCode).toBe(200);
    expect(pubRes.json().status).toBe("published");
  });

  it("Teacher closes an open exam and publishes manual results", async () => {
    const closeDraft = await createTeacherDraft("P4-2C Close Exam", {
      openAt: new Date(Date.now() - 60_000).toISOString(),
      closeAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(closeDraft.statusCode).toBe(201);
    const closeExamId = closeDraft.json().id as string;

    const closePublish = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${closeExamId}/publish`,
      cookies: { "auth-token": teacherToken },
    });
    expect(closePublish.statusCode).toBe(200);

    const scoreCandidate = await createCandidateViaApi(
      ctx.app,
      ctx.adminToken,
      `p42c-score-${uniquePrefix()}`,
      ctx.org.id,
    );
    const scoreEnrollment = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${closeExamId}/enrollments`,
      payload: { candidateIds: [scoreCandidate.candidateProfileId] },
      cookies: { "auth-token": teacherToken },
    });
    expect(scoreEnrollment.statusCode).toBe(200);

    const startRes = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${closeExamId}/start`,
      cookies: { "auth-token": scoreCandidate.token },
    });
    expect(startRes.statusCode).toBe(201);
    const attemptId = startRes.json().id as string;

    const answerRes = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attemptId}/answers/${questionId}`,
      payload: {
        attemptId,
        questionId,
        answer: true,
        clientSeq: 1,
        clientSavedAt: new Date().toISOString(),
        baseVersion: 0,
      },
      cookies: { "auth-token": scoreCandidate.token },
    });
    expect(answerRes.statusCode).toBe(200);

    const submitRes = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attemptId}/submit`,
      cookies: { "auth-token": scoreCandidate.token },
    });
    expect(submitRes.statusCode).toBe(200);
    expect(submitRes.json().status).toBe("graded");

    const closeRes = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${closeExamId}/close`,
      payload: {},
      cookies: { "auth-token": teacherToken },
    });
    expect(closeRes.statusCode).toBe(200);
    expect(closeRes.json().status).toBe("closed");

    const resultsDraft = await createTeacherDraft("P4-2C Results Exam", {
      resultPublicationMode: "manual",
    });
    expect(resultsDraft.statusCode).toBe(201);
    const resultsExamId = resultsDraft.json().id as string;
    const resultsPublish = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${resultsExamId}/publish`,
      cookies: { "auth-token": teacherToken },
    });
    expect(resultsPublish.statusCode).toBe(200);

    const publishResultsRes = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${resultsExamId}/publish-results`,
      cookies: { "auth-token": teacherToken },
    });
    expect(publishResultsRes.statusCode).toBe(200);
    expect(publishResultsRes.json()).toMatchObject({
      ok: true,
      alreadyPublished: false,
    });

    const scoresRes = await ctx.app.inject({
      method: "GET",
      url: `/api/exams/${closeExamId}/scores`,
      cookies: { "auth-token": teacherToken },
    });
    expect(scoresRes.statusCode).toBe(200);
  });

  it("Teacher adds, lists, monitors, and removes an enrollment", async () => {
    const draftRes = await createTeacherDraft("P4-2C Enrollment Exam");
    expect(draftRes.statusCode).toBe(201);
    const examId = draftRes.json().id as string;
    const candidate = await createCandidateViaApi(
      ctx.app,
      ctx.adminToken,
      `p42c-enrollment-${uniquePrefix()}`,
      ctx.org.id,
    );

    const addRes = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/enrollments`,
      payload: { candidateIds: [candidate.candidateProfileId] },
      cookies: { "auth-token": teacherToken },
    });
    expect(addRes.statusCode).toBe(200);
    expect(addRes.json()).toMatchObject({ added: 1, skipped: 0 });
    const enrollmentId = addRes.json().enrollments[0].id as string;

    const listRes = await ctx.app.inject({
      method: "GET",
      url: `/api/exams/${examId}/enrollments`,
      cookies: { "auth-token": teacherToken },
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: enrollmentId,
          candidateId: candidate.candidateProfileId,
        }),
      ]),
    );

    const statusRes = await ctx.app.inject({
      method: "GET",
      url: `/api/admin/exams/${examId}/candidates/status`,
      cookies: { "auth-token": teacherToken },
    });
    expect(statusRes.statusCode).toBe(200);
    expect(statusRes.json().total).toBe(1);

    const deleteRes = await ctx.app.inject({
      method: "DELETE",
      url: `/api/exams/${examId}/enrollments/${enrollmentId}`,
      cookies: { "auth-token": teacherToken },
    });
    expect(deleteRes.statusCode).toBe(204);
  });

  it("Teacher remains denied on every Admin-only exam lifecycle route", async () => {
    const missingExamId = randomUUID();
    const requests = [
      ["POST", `/api/exams/${missingExamId}/unpublish`, undefined],
      ["POST", `/api/exams/${missingExamId}/extend`, { extendMinutes: 15 }],
      ["POST", `/api/exams/${missingExamId}/cancel`, {}],
      ["POST", `/api/exams/${missingExamId}/archive`, undefined],
      ["DELETE", `/api/exams/${missingExamId}`, undefined],
    ] as const;

    for (const [method, url, payload] of requests) {
      const res = await ctx.app.inject({
        method,
        url,
        payload,
        cookies: { "auth-token": teacherToken },
      });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
      expect(res.json()).toMatchObject({
        error: expect.objectContaining({ code: "PERMISSION_DENIED" }),
      });
    }
  });

  it("Candidate is denied exam create at the capability gate (403)", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        courseId,
        title: "should not create",
        description: "",
        durationMinutes: 60,
        openAt: new Date().toISOString(),
        closeAt: new Date(Date.now() + 86400000).toISOString(),
        passingScore: 50,
        totalScore: 100,
        questionIds: [questionId],
      },
      cookies: { "auth-token": candidateToken },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      error: expect.objectContaining({ code: "PERMISSION_DENIED" }),
    });
  });

  it("Admin has no regression (creates an exam, 201)", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        courseId,
        title: "Admin still works",
        description: "",
        durationMinutes: 60,
        openAt: new Date().toISOString(),
        closeAt: new Date(Date.now() + 86400000).toISOString(),
        passingScore: 50,
        totalScore: 100,
        questionIds: [questionId],
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(201);
  });
});
