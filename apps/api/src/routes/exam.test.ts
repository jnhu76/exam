import { describe, expect, it, beforeAll, afterAll } from "vitest";
import examRoutes from "./exam.js";
import courseRoutes from "./course.js";
import questionRoutes from "./question.js";
import { buildTestApp } from "./testHelpers.js";

describe("exam routes", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let courseId: string;
  let questionId: string;

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(courseRoutes);
      await fastify.register(questionRoutes);
      await fastify.register(examRoutes);
    });

    const courseRes = await ctx.app.inject({
      method: "POST",
      url: "/api/courses",
      payload: { name: "Exam Course", code: "EC101", description: "" },
      cookies: { "auth-token": ctx.adminToken },
    });
    courseId = courseRes.json().id;

    const qRes = await ctx.app.inject({
      method: "POST",
      url: "/api/questions",
      payload: {
        courseId,
        type: "true_false",
        content: "Test question.",
        standardAnswer: true,
        score: 100,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    questionId = qRes.json().id;
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it("POST /api/exams creates a draft exam", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        title: "Test Exam",
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
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.title).toBe("Test Exam");
    expect(body.status).toBe("draft");
    expect(body).toHaveProperty("id");
  });

  it("GET /api/exams returns list", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/exams",
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("items");
    expect(body.items.length).toBeGreaterThanOrEqual(1);
  });

  it("GET /api/exams/:id returns exam detail", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        title: "Detail Exam",
        courseId,
        durationMinutes: 30,
        openAt: new Date().toISOString(),
        closeAt: new Date(Date.now() + 86400000).toISOString(),
        passingScore: 50,
        totalScore: 100,
        questionIds: [questionId],
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    const created = createRes.json();

    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/exams/${created.id}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().title).toBe("Detail Exam");
  });

  it("PATCH /api/exams/:id updates a draft exam", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        title: "Update Exam",
        courseId,
        durationMinutes: 30,
        openAt: new Date().toISOString(),
        closeAt: new Date(Date.now() + 86400000).toISOString(),
        passingScore: 50,
        totalScore: 100,
        questionIds: [questionId],
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    const created = createRes.json();

    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/api/exams/${created.id}`,
      payload: { title: "Updated Title" },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().title).toBe("Updated Title");
  });

  it("POST /api/exams/:id/publish publishes a draft", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        title: "Publish Exam",
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
    const created = createRes.json();

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${created.id}/publish`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("published");
  });

  it("POST /api/exams/:id/publish rejects already published", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        title: "Already Published",
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
    const created = createRes.json();

    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${created.id}/publish`,
      cookies: { "auth-token": ctx.adminToken },
    });

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${created.id}/publish`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(409);
  });

  it("DELETE /api/exams/:id deletes draft exam", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        title: "Delete Exam",
        courseId,
        durationMinutes: 30,
        openAt: new Date().toISOString(),
        closeAt: new Date(Date.now() + 86400000).toISOString(),
        passingScore: 50,
        totalScore: 100,
        questionIds: [questionId],
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    const created = createRes.json();

    const res = await ctx.app.inject({
      method: "DELETE",
      url: `/api/exams/${created.id}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(204);
  });

  it("DELETE /api/exams/:id rejects non-draft", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        title: "No Delete",
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
    const created = createRes.json();

    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${created.id}/publish`,
      cookies: { "auth-token": ctx.adminToken },
    });

    const res = await ctx.app.inject({
      method: "DELETE",
      url: `/api/exams/${created.id}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(409);
  });

  it("GET /api/exams returns 401 without auth", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/exams",
    });
    expect(res.statusCode).toBe(401);
  });

  it("POST /api/exams/:id/publish works without body", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        title: "No Body Publish",
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
    const created = createRes.json();

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${created.id}/publish`,
      headers: { "content-type": "application/json" },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("published");
  });
});
