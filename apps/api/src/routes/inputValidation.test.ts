import { describe, expect, it, beforeAll, afterAll } from "vitest";
import authRoutes from "./auth.js";
import courseRoutes from "./course.js";
import questionRoutes from "./question.js";
import candidateRoutes from "./candidate.js";
import examRoutes from "./exam.js";
import { buildTestApp, uniquePrefix } from "./testHelpers.js";

// The per-route files and plugins/errors.test.ts own the ZodError→HTTP
// mapping; contracts tests own the members they enumerate. The rows below are
// the sole wire-boundary witnesses for schema members that NO other lane
// covers (verified member-by-member in the #716 adversarial pass): title
// min/max, openAt datetime, durationMinutes positivity, question content
// non-empty, question score positivity, and the duplicate-username → 409
// mapping. Adversarial review D restored them after the first deletion pass.
describe("API input validation (Zod schema boundary)", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let courseId: string;
  let questionId: string;

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(authRoutes, { prefix: "/auth" });
      await fastify.register(courseRoutes);
      await fastify.register(questionRoutes);
      await fastify.register(candidateRoutes);
      await fastify.register(examRoutes);
    });

    const courseRes = await ctx.app.inject({
      method: "POST",
      url: "/api/courses",
      payload: {
        name: "Validation Course",
        code: `VC-${uniquePrefix()}`,
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
        content: "Validation question.",
        standardAnswer: true,
        score: 10,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    questionId = qRes.json().id;
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  function baseExamPayload() {
    return {
      title: "Valid Exam",
      courseId,
      durationMinutes: 60,
      openAt: "2026-06-01T00:00:00.000Z",
      closeAt: "2026-06-02T00:00:00.000Z",
      passingScore: 60,
      totalScore: 100,
      questionIds: [questionId],
    };
  }

  it("exam creation rejects empty title", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: { ...baseExamPayload(), title: "" },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("exam creation rejects oversized title (201+ chars)", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: { ...baseExamPayload(), title: "x".repeat(201) },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("exam creation rejects invalid datetime format for openAt", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: { ...baseExamPayload(), openAt: "not-a-date" },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("exam creation rejects durationMinutes <= 0", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: { ...baseExamPayload(), durationMinutes: 0 },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("question creation rejects empty content", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/questions",
      payload: {
        courseId,
        type: "true_false",
        content: "",
        standardAnswer: true,
        score: 5,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("question creation rejects negative score", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/questions",
      payload: {
        courseId,
        type: "true_false",
        content: "Valid content.",
        standardAnswer: true,
        score: -1,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("candidate creation rejects duplicate username", async () => {
    const username = `dup-user-${uniquePrefix()}`;
    const payload = {
      username,
      password: "password123",
      name: "Dup Candidate",
      fields: {},
    };

    const first = await ctx.app.inject({
      method: "POST",
      url: "/api/candidates",
      payload,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(first.statusCode).toBe(201);

    const second = await ctx.app.inject({
      method: "POST",
      url: "/api/candidates",
      payload,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(second.statusCode).toBe(409);
  });
});
