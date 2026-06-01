import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp, createCandidateViaApi } from "./testHelpers.js";
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

    const courseRes = await ctx.app.inject({
      method: "POST",
      url: "/api/courses",
      payload: { name: "Export Test Course", code: "EXP101", description: "" },
      cookies: { "auth-token": ctx.adminToken },
    });
    if (courseRes.statusCode !== 201) {
      throw new Error(
        `Course creation failed: ${courseRes.statusCode} ${courseRes.body}`,
      );
    }
    const courseId = courseRes.json().id;

    const questionRes = await ctx.app.inject({
      method: "POST",
      url: "/api/questions",
      payload: {
        courseId,
        type: "true_false",
        content: "1+1=2?",
        standardAnswer: true,
        score: 100,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    if (questionRes.statusCode !== 201) {
      throw new Error(
        `Question creation failed: ${questionRes.statusCode} ${questionRes.body}`,
      );
    }
    const questionId = questionRes.json().id;

    const examRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        title: "Export Test Exam",
        courseId,
        durationMinutes: 60,
        openAt: new Date().toISOString(),
        closeAt: new Date(Date.now() + 86400000).toISOString(),
        passingScore: 60,
        totalScore: 100,
        questionIds: [questionId],
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    if (examRes.statusCode !== 201) {
      throw new Error(
        `Exam creation failed: ${examRes.statusCode} ${examRes.body}`,
      );
    }
    examId = examRes.json().id;

    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish`,
      cookies: { "auth-token": ctx.adminToken },
    });
  });

  afterAll(async () => {
    await ctx.app.close();
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
      "export-candidate",
      ctx.org.id,
    );
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/exams/${examId}/export/scores`,
      cookies: { "auth-token": candidate.token },
    });
    expect(res.statusCode).toBe(403);
  });
});
