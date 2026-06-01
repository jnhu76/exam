import { describe, expect, it, beforeAll, afterAll } from "vitest";
import authRoutes from "./auth.js";
import courseRoutes from "./course.js";
import questionRoutes from "./question.js";
import examRoutes from "./exam.js";
import { buildTestApp, createExamViaApi } from "./testHelpers.js";

let examCounter = 0;

async function createExam(
  ctx: Awaited<ReturnType<typeof buildTestApp>>,
  title: string,
) {
  examCounter++;
  return createExamViaApi(ctx.app, ctx.adminToken, {
    examTitle: title,
    courseCode: `SM${examCounter}`,
    courseName: `Course for ${title}`,
    questionContent: `Question for ${title}`,
    questionAnswer: true,
    questionScore: 100,
    durationMinutes: 60,
    passingScore: 60,
    totalScore: 100,
  });
}

const adminCookies = (token: string) => ({ "auth-token": token });

describe("exam state machine transitions", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(authRoutes, { prefix: "/auth" });
      await fastify.register(courseRoutes);
      await fastify.register(questionRoutes);
      await fastify.register(examRoutes);
    });
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it("draft exam can be updated", async () => {
    const examId = await createExam(ctx, "SM Draft Update");

    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/api/exams/${examId}`,
      payload: { title: "SM Updated Title" },
      cookies: adminCookies(ctx.adminToken),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().title).toBe("SM Updated Title");
  });

  it("draft exam can be published", async () => {
    const examId = await createExam(ctx, "SM Publish Draft");

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish`,
      cookies: adminCookies(ctx.adminToken),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("published");
  });

  it("published exam cannot be republished", async () => {
    const examId = await createExam(ctx, "SM Republish");

    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish`,
      cookies: adminCookies(ctx.adminToken),
    });

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish`,
      cookies: adminCookies(ctx.adminToken),
    });

    expect(res.statusCode).toBe(409);
  });

  it("published exam can be archived", async () => {
    const examId = await createExam(ctx, "SM Archive");

    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish`,
      cookies: adminCookies(ctx.adminToken),
    });

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/archive`,
      cookies: adminCookies(ctx.adminToken),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("archived");
  });

  it("archived exam cannot be published", async () => {
    const examId = await createExam(ctx, "SM Archived Publish");

    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish`,
      cookies: adminCookies(ctx.adminToken),
    });
    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/archive`,
      cookies: adminCookies(ctx.adminToken),
    });

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish`,
      cookies: adminCookies(ctx.adminToken),
    });

    expect(res.statusCode).toBe(409);
  });

  it("draft exam can be deleted", async () => {
    const examId = await createExam(ctx, "SM Delete Draft");

    const res = await ctx.app.inject({
      method: "DELETE",
      url: `/api/exams/${examId}`,
      cookies: adminCookies(ctx.adminToken),
    });

    expect(res.statusCode).toBe(204);
  });

  it("published exam cannot be deleted", async () => {
    const examId = await createExam(ctx, "SM Delete Published");

    await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish`,
      cookies: adminCookies(ctx.adminToken),
    });

    const res = await ctx.app.inject({
      method: "DELETE",
      url: `/api/exams/${examId}`,
      cookies: adminCookies(ctx.adminToken),
    });

    expect(res.statusCode).toBe(409);
  });
});
