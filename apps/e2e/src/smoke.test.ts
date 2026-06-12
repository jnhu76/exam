import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildTestApp } from "@exam/api/src/routes/testHelpers.js";
import type { TestContext } from "@exam/api/src/routes/testHelpers.js";
import authRoutes from "@exam/api/src/routes/auth.js";
import settingsRoutes from "@exam/api/src/routes/settings.js";
import organizationRoutes from "@exam/api/src/routes/organization.js";
import userRoutes from "@exam/api/src/routes/user.js";
import candidateRoutes from "@exam/api/src/routes/candidate.js";
import courseRoutes from "@exam/api/src/routes/course.js";
import questionRoutes from "@exam/api/src/routes/question.js";
import examRoutes from "@exam/api/src/routes/exam.js";
import attemptRoutes from "@exam/api/src/routes/attempts.js";
import scoreRoutes from "@exam/api/src/routes/scores.js";
import { exportRoutes } from "@exam/api/src/routes/export.js";
import systemRoutes from "@exam/api/src/routes/system.js";
import type { FastifyPluginAsync } from "fastify";
import { createCandidateViaApi } from "@exam/api/src/routes/testHelpers.js";

async function buildFullStackApp(): Promise<TestContext> {
  const allRoutes: FastifyPluginAsync = async (fastify) => {
    await fastify.register(authRoutes, { prefix: "/api/auth" });
    await fastify.register(settingsRoutes, { prefix: "/api" });
    await fastify.register(organizationRoutes, { prefix: "/api" });
    await fastify.register(userRoutes, { prefix: "/api" });
    await fastify.register(candidateRoutes, { prefix: "/api" });
    await fastify.register(courseRoutes, { prefix: "/api" });
    await fastify.register(questionRoutes, { prefix: "/api" });
    await fastify.register(examRoutes, { prefix: "/api" });
    await fastify.register(attemptRoutes, { prefix: "/api" });
    await fastify.register(scoreRoutes, { prefix: "/api" });
    await fastify.register(exportRoutes, { prefix: "/api" });
    await fastify.register(systemRoutes, { prefix: "/api" });
    fastify.get("/api/health", async () => ({ status: "ok" }));
  };

  return buildTestApp(allRoutes, { prefix: "" });
}

describe("Smoke — system info endpoint", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await buildFullStackApp();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it("GET /api/system/info returns version and uptime without auth", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/system/info",
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("version");
    expect(body).toHaveProperty("uptime");
    expect(typeof body.version).toBe("string");
    expect(typeof body.uptime).toBe("number");
  });
});

describe("Smoke — health check", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await buildFullStackApp();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it("GET /api/health returns ok without auth", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });
});

describe("Smoke — auth flow", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await buildFullStackApp();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it("login with seed superadmin succeeds", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        username: "superadmin",
        password: "admin123",
        organizationSlug: "default",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.username).toBe("superadmin");
    expect(body.role).toBe("SuperAdmin");
  });

  it("login with wrong password returns 401", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        username: "superadmin",
        password: "wrong",
        organizationSlug: "default",
      },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("Smoke — full exam lifecycle", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await buildFullStackApp();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it("create → publish → submit → score", async () => {
    const courseRes = await ctx.app.inject({
      method: "POST",
      url: "/api/courses",
      payload: { name: "Smoke Course", code: "SMK101", description: "" },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(courseRes.statusCode).toBe(201);
    const courseId = courseRes.json().id;

    const qRes = await ctx.app.inject({
      method: "POST",
      url: "/api/questions",
      payload: {
        courseId,
        type: "true_false",
        content: "2+2=4",
        standardAnswer: true,
        score: 10,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(qRes.statusCode).toBe(201);
    const questionId = qRes.json().id;

    const examRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        title: "Smoke Exam",
        courseId,
        durationMinutes: 30,
        openAt: new Date().toISOString(),
        closeAt: new Date(Date.now() + 86400000).toISOString(),
        passingScore: 5,
        totalScore: 10,
        questionIds: [questionId],
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(examRes.statusCode).toBe(201);
    const examId = examRes.json().id;

    const pubRes = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(pubRes.statusCode).toBe(200);

    const candidate = await createCandidateViaApi(
      ctx.app,
      ctx.adminToken,
      "smoke-user",
      ctx.org.id,
    );

    const enrollRes = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/enrollments`,
      payload: { candidateIds: [candidate.candidateProfileId] },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(enrollRes.statusCode).toBe(200);

    const startRes = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${examId}/start`,
      cookies: { "auth-token": candidate.token },
    });
    expect(startRes.statusCode).toBe(201);
    const attemptId = startRes.json().id;

    await ctx.app.inject({
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
      cookies: { "auth-token": candidate.token },
    });

    const submitRes = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${attemptId}/submit`,
      cookies: { "auth-token": candidate.token },
    });
    expect(submitRes.statusCode).toBe(200);
    expect(submitRes.json().score).toBe(10);
  });
});

describe("Smoke — candidate import", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await buildFullStackApp();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it("imports new candidates then re-imports as update", async () => {
    const username = `smoke-import-${Date.now()}`;
    const res1 = await ctx.app.inject({
      method: "POST",
      url: "/api/candidates/import",
      payload: {
        rows: [
          { username, password: "123456", name: "Smoke Import", fields: {} },
        ],
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res1.statusCode).toBe(200);
    expect(res1.json().created).toBe(1);
    expect(res1.json().errors).toHaveLength(0);

    const res2 = await ctx.app.inject({
      method: "POST",
      url: "/api/candidates/import",
      payload: {
        rows: [
          { username, password: "123456", name: "Smoke Updated", fields: {} },
        ],
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res2.statusCode).toBe(200);
    expect(res2.json().created).toBe(0);
    expect(res2.json().updated).toBe(1);
    expect(res2.json().errors).toHaveLength(0);
  });
});
