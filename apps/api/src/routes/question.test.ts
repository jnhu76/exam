import { describe, expect, it, beforeAll, afterAll } from "vitest";
import questionRoutes from "./question.js";
import courseRoutes from "./course.js";
import { buildTestApp, uniquePrefix } from "./testHelpers.js";

describe("question routes", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let courseId: string;

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(courseRoutes);
      await fastify.register(questionRoutes);
    });

    const courseRes = await ctx.app.inject({
      method: "POST",
      url: "/api/courses",
      payload: {
        name: "Q Course",
        code: `QC-${uniquePrefix()}`,
        description: "",
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    courseId = courseRes.json().id;
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("POST /api/questions creates a single_choice question", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/questions",
      payload: {
        courseId,
        type: "single_choice",
        content: "What is 1+1?",
        options: [
          { id: "a", content: "1" },
          { id: "b", content: "2", isCorrect: true },
          { id: "c", content: "3" },
        ],
        standardAnswer: "b",
        score: 10,
        difficulty: 1,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.type).toBe("single_choice");
    expect(body.content).toBe("What is 1+1?");
    expect(body.courseId).toBe(courseId);
    expect(body).toHaveProperty("id");
  });

  it("POST /api/questions creates a true_false question", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/questions",
      payload: {
        courseId,
        type: "true_false",
        content: "The sky is blue.",
        standardAnswer: true,
        score: 5,
        difficulty: 1,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().type).toBe("true_false");
  });

  it("POST /api/questions creates a fill_blank question", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/questions",
      payload: {
        courseId,
        type: "fill_blank",
        content: "The capital of France is ____.",
        standardAnswer: "Paris",
        score: 10,
        difficulty: 2,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().type).toBe("fill_blank");
  });

  it("POST /api/questions creates a multiple_choice question", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/questions",
      payload: {
        courseId,
        type: "multiple_choice",
        content: "Select even numbers.",
        options: [
          { id: "a", content: "1" },
          { id: "b", content: "2", isCorrect: true },
          { id: "c", content: "3" },
          { id: "d", content: "4", isCorrect: true },
        ],
        standardAnswer: ["b", "d"],
        score: 10,
        difficulty: 2,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().type).toBe("multiple_choice");
  });

  it("GET /api/questions returns list", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/questions",
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("items");
    expect(body).toHaveProperty("total");
    expect(body.items.length).toBeGreaterThanOrEqual(4);
  });

  it("GET /api/questions filters by courseId", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/questions?courseId=${courseId}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.every((q: any) => q.courseId === courseId)).toBe(true);
  });

  it("GET /api/questions filters by type", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/questions?type=single_choice",
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items.every((q: any) => q.type === "single_choice")).toBe(true);
  });

  it("GET /api/questions/:id returns single question", async () => {
    const listRes = await ctx.app.inject({
      method: "GET",
      url: "/api/questions",
      cookies: { "auth-token": ctx.adminToken },
    });
    const first = listRes.json().items[0];

    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/questions/${first.id}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(first.id);
  });

  it("PATCH /api/questions/:id updates a question", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/questions",
      payload: {
        courseId,
        type: "true_false",
        content: "To update.",
        standardAnswer: true,
        score: 5,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    const created = createRes.json();

    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/api/questions/${created.id}`,
      payload: { content: "Updated content." },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().content).toBe("Updated content.");
  });

  it("DELETE /api/questions/:id deletes a question", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/questions",
      payload: {
        courseId,
        type: "true_false",
        content: "To delete.",
        standardAnswer: false,
        score: 5,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    const created = createRes.json();

    const res = await ctx.app.inject({
      method: "DELETE",
      url: `/api/questions/${created.id}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(204);
  });

  it("POST /api/questions rejects single_choice with < 2 options", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/questions",
      payload: {
        courseId,
        type: "single_choice",
        content: "Bad question.",
        options: [{ id: "a", content: "Only one" }],
        standardAnswer: "a",
        score: 10,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /api/questions rejects fill_blank without ____ in content", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/questions",
      payload: {
        courseId,
        type: "fill_blank",
        content: "No placeholder here.",
        standardAnswer: "answer",
        score: 10,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(400);
  });

  it("POST /api/questions rejects true_false with non-boolean answer", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/questions",
      payload: {
        courseId,
        type: "true_false",
        content: "Bad answer type.",
        standardAnswer: "yes",
        score: 10,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(400);
  });

  it("GET /api/questions returns 401 without auth", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/questions",
    });
    expect(res.statusCode).toBe(401);
  });

  it("POST /api/questions/import imports valid rows", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/questions/import",
      payload: {
        courseId,
        rows: [
          {
            type: "single_choice",
            content: "Import Q1?",
            optionA: "A",
            optionB: "B",
            optionC: "C",
            optionD: "D",
            standardAnswer: "A",
            score: 10,
          },
          {
            type: "true_false",
            content: "Import Q2?",
            standardAnswer: true,
            score: 5,
          },
        ],
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(2);
    expect(body.valid).toBe(2);
    expect(body.errors).toBe(0);
  });

  it("POST /api/questions/import reports errors for invalid rows", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/questions/import",
      payload: {
        courseId,
        rows: [
          {
            type: "single_choice",
            content: "Valid row",
            optionA: "A",
            optionB: "B",
            standardAnswer: "A",
            score: 10,
          },
          {
            type: "fill_blank",
            content: "No placeholder.",
            standardAnswer: "x",
            score: 5,
          },
        ],
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.total).toBe(2);
    expect(body.valid).toBe(1);
    expect(body.errors).toBe(1);
    expect(body.details[1].status).toBe("error");
  });
});
