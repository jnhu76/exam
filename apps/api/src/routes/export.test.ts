import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildTestApp,
  createCandidateViaApi,
  createExamViaApi,
  publishExamViaApi,
  submitExamAsCandidate,
  exportResultsCsvAsAdmin,
  uniquePrefix,
} from "./testHelpers.js";
import { signJWT } from "@exam/auth/src/session.js";
import authRoutes from "./auth.js";
import examRoutes from "./exam.js";
import courseRoutes from "./course.js";
import questionRoutes from "./question.js";
import candidateRoutes from "./candidate.js";
import attemptRoutes from "./attempts.js";
import { exportRoutes } from "./export.js";

describe("CSV export integration", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let examId: string;

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(authRoutes, { prefix: "/auth" });
      await fastify.register(courseRoutes);
      await fastify.register(questionRoutes);
      await fastify.register(examRoutes);
      await fastify.register(candidateRoutes);
      await fastify.register(attemptRoutes);
      await fastify.register(exportRoutes);
    });

    examId = await createExamViaApi(ctx.app, ctx.adminToken, {
      examTitle: "Export Test Exam",
      courseCode: "EXP101",
      courseName: "Export Test Course",
      questionContent: "1+1=2?",
      questionAnswer: true,
      questionScore: 100,
      durationMinutes: 60,
      passingScore: 60,
      totalScore: 100,
    });
    await publishExamViaApi(ctx.app, ctx.adminToken, examId);
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("returns 404 for non-existent exam", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/exams/nonexistent/export/scores",
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns CSV with correct headers for empty results", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/exams/${examId}/export/scores`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    const body = typeof res.body === "string" ? res.body : res.body.toString();
    expect(body).toContain("考生姓名");
    expect(body).toContain("成绩");
    expect(body).toContain("及格状态");
  });

  it("rejects unauthenticated requests", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/exams/${examId}/export/scores`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects candidate role", async () => {
    const candidate = await createCandidateViaApi(
      ctx.app,
      ctx.adminToken,
      `export-cand-${uniquePrefix()}`,
      ctx.org.id,
    );
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/exams/${examId}/export/scores`,
      cookies: { "auth-token": candidate.token },
    });
    expect(res.statusCode).toBe(403);
  });

  it("Content-Disposition header contains attachment and examId", async () => {
    const res = await exportResultsCsvAsAdmin(ctx.app, ctx.adminToken, examId);
    expect(res.headers["content-disposition"]).toContain("attachment");
    expect(res.headers["content-disposition"]).toContain(examId);
  });

  it("CSV with graded data contains score fields", async () => {
    const gradedExamId = await createExamViaApi(ctx.app, ctx.adminToken, {
      examTitle: "Graded Export Exam",
      courseCode: "GRD102",
      courseName: "Graded Export Course",
      questionContent: "Is water wet?",
      questionAnswer: true,
      questionScore: 100,
      durationMinutes: 60,
      passingScore: 60,
      totalScore: 100,
    });
    await publishExamViaApi(ctx.app, ctx.adminToken, gradedExamId);
    const gradedUsername = `graded-export-cand-${uniquePrefix()}`;
    await submitExamAsCandidate(
      ctx.app,
      ctx.adminToken,
      ctx.org.id,
      gradedExamId,
      gradedUsername,
    );
    const { body } = await exportResultsCsvAsAdmin(
      ctx.app,
      ctx.adminToken,
      gradedExamId,
    );
    expect(body).toContain("100");
    expect(body).toContain("及格");
    expect(body).toContain(`Candidate ${gradedUsername}`);
  });

  it("CSV escaping handles commas and quotes in candidate name", async () => {
    const candidateRes = await ctx.app.inject({
      method: "POST",
      url: "/api/candidates",
      payload: {
        username: `csv-escape-user-${uniquePrefix()}`,
        password: "password123",
        name: 'Zhang, "San"',
        fields: {},
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(candidateRes.statusCode).toBe(201);
    const candidateBody = candidateRes.json();
    const candidateToken = signJWT({
      actorId: candidateBody.userId,
      role: "Candidate",
      organizationId: ctx.org.id,
    });

    const escapeExamId = await createExamViaApi(ctx.app, ctx.adminToken, {
      examTitle: "CSV Escape Exam",
      courseCode: "ESC102",
      courseName: "Escape Course",
      questionContent: "Is CSV escaping important?",
      questionAnswer: true,
      questionScore: 100,
      durationMinutes: 60,
      passingScore: 60,
      totalScore: 100,
    });
    await publishExamViaApi(ctx.app, ctx.adminToken, escapeExamId);

    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${escapeExamId}/enrollments`,
      payload: { candidateIds: [candidateBody.id] },
      cookies: { "auth-token": ctx.adminToken },
    });

    const startRes = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${escapeExamId}/start`,
      cookies: { "auth-token": candidateToken },
    });
    expect(startRes.statusCode).toBe(201);
    const attempt = startRes.json();

    const examDetailRes = await ctx.app.inject({
      method: "GET",
      url: `/api/exams/${escapeExamId}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    const questionId = examDetailRes.json().questionIds[0];

    await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attempt.id}/answers/${questionId}`,
      payload: {
        attemptId: attempt.id,
        questionId,
        answer: true,
        clientSeq: 1,
        clientSavedAt: new Date().toISOString(),
        baseVersion: 0,
      },
      cookies: { "auth-token": candidateToken },
    });

    const submitRes = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attempt.id}/submit`,
      cookies: { "auth-token": candidateToken },
    });
    expect(submitRes.statusCode).toBe(200);

    const { body } = await exportResultsCsvAsAdmin(
      ctx.app,
      ctx.adminToken,
      escapeExamId,
    );
    expect(body).toContain('"Zhang, ""San"""');
  });

  it("examId filtering — export only returns data for specified exam", async () => {
    const examAId = await createExamViaApi(ctx.app, ctx.adminToken, {
      examTitle: "Filter Exam A",
      courseCode: "FLTA102",
      courseName: "Filter Course A",
      questionContent: "Is A true?",
      questionAnswer: true,
      questionScore: 100,
      durationMinutes: 60,
      passingScore: 60,
      totalScore: 100,
    });
    const examBId = await createExamViaApi(ctx.app, ctx.adminToken, {
      examTitle: "Filter Exam B",
      courseCode: "FLTB102",
      courseName: "Filter Course B",
      questionContent: "Is B true?",
      questionAnswer: false,
      questionScore: 100,
      durationMinutes: 60,
      passingScore: 60,
      totalScore: 100,
    });
    await publishExamViaApi(ctx.app, ctx.adminToken, examAId);
    await publishExamViaApi(ctx.app, ctx.adminToken, examBId);

    const filterUsername = `filter-exam-a-cand-${uniquePrefix()}`;
    await submitExamAsCandidate(
      ctx.app,
      ctx.adminToken,
      ctx.org.id,
      examAId,
      filterUsername,
    );

    const exportB = await exportResultsCsvAsAdmin(
      ctx.app,
      ctx.adminToken,
      examBId,
    );
    const linesB = exportB.body.split("\n");
    expect(linesB.length).toBe(1);

    const exportA = await exportResultsCsvAsAdmin(
      ctx.app,
      ctx.adminToken,
      examAId,
    );
    const linesA = exportA.body.split("\n");
    expect(linesA.length).toBeGreaterThan(1);
    expect(exportA.body).toContain(`Candidate ${filterUsername}`);
  });
});
