import { afterAll, beforeAll, describe, expect, it } from "vitest";
import authRoutes from "./auth.js";
import courseRoutes from "./course.js";
import questionRoutes from "./question.js";
import candidateRoutes from "./candidate.js";
import examRoutes from "./exam.js";
import attemptRoutes from "./attempts.js";
import { exportRoutes } from "./export.js";
import {
  buildTestApp,
  createCandidateViaApi,
  createExamViaApi,
  publishExamViaApi,
  submitExamAsCandidate,
  exportResultsCsvAsAdmin,
} from "./testHelpers.js";

describe("test helpers — full lifecycle via helpers", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let examId: string;

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(authRoutes, { prefix: "/auth" });
      await fastify.register(courseRoutes);
      await fastify.register(questionRoutes);
      await fastify.register(candidateRoutes);
      await fastify.register(examRoutes);
      await fastify.register(attemptRoutes);
      await fastify.register(exportRoutes);
    });
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it("createExamViaApi creates a draft exam with course and question", async () => {
    examId = await createExamViaApi(ctx.app, ctx.adminToken, {
      examTitle: "Helper Test Exam",
      courseCode: "HLPR101",
      courseName: "Helper Course",
      questionContent: "Is helper working?",
      questionAnswer: true,
      questionScore: 100,
      durationMinutes: 60,
      passingScore: 60,
      totalScore: 100,
    });

    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/exams/${examId}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().title).toBe("Helper Test Exam");
    expect(res.json().status).toBe("draft");
  });

  it("publishExamViaApi transitions exam to published", async () => {
    const updated = await publishExamViaApi(ctx.app, ctx.adminToken, examId);
    expect(updated.status).toBe("published");
  });

  it("submitExamAsCandidate creates candidate, enrolls, starts, answers, submits", async () => {
    const result = await submitExamAsCandidate(
      ctx.app,
      ctx.adminToken,
      ctx.org.id,
      examId,
      "helper-candidate-1",
    );

    expect(result.id).toBeDefined();
    expect(result.status).toBe("graded");
    expect(result.score).toBe(100);
  });

  it("exportResultsCsvAsAdmin returns valid CSV with data", async () => {
    const csv = await exportResultsCsvAsAdmin(ctx.app, ctx.adminToken, examId);

    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.headers["content-disposition"]).toContain("attachment");

    const body = typeof csv.body === "string" ? csv.body : csv.body.toString();
    expect(body).toContain("考生姓名");
    expect(body).toContain("成绩");
    expect(body).toContain("100");
    expect(body).toContain("及格");
  });
});
