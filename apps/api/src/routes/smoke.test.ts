import { describe, expect, it, beforeAll, afterAll } from "vitest";
import examRoutes from "./exam.js";
import courseRoutes from "./course.js";
import questionRoutes from "./question.js";
import candidateRoutes from "./candidate.js";
import attemptRoutes from "./attempts.js";
import authRoutes from "./auth.js";
import {
  buildTestApp,
  createCandidateViaApi,
  uniquePrefix,
} from "./testHelpers.js";
import { createUserRepo } from "@exam/db/src/repository/userRepo.js";
import { hashPassword } from "@exam/auth/src/password.js";
import { randomUUID } from "node:crypto";

describe("Phase 1.1 regression - critical path", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let courseId: string;
  let questionId: string;
  let examId: string;
  let candidateProfileId: string;
  let candidateToken: string;
  let passwordTestUserId: string;
  let passwordTestToken: string;

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(authRoutes, { prefix: "/auth" });
      await fastify.register(courseRoutes);
      await fastify.register(questionRoutes);
      await fastify.register(candidateRoutes);
      await fastify.register(examRoutes);
      await fastify.register(attemptRoutes);
    });

    const pwUserId = randomUUID();
    const pwHash = await hashPassword("pwtest123");
    await ctx.db
      .insert((await import("@exam/db/src/schema/pg.js")).schema.users)
      .values({
        id: pwUserId,
        organizationId: ctx.org.id,
        username: `pwtest-${uniquePrefix()}`,
        passwordHash: pwHash,
        name: "Password Test User",
        role: "Teacher",
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    const pwRows = await ctx.db
      .select()
      .from((await import("@exam/db/src/schema/pg.js")).schema.users)
      .where(
        (await import("drizzle-orm")).eq(
          (await import("@exam/db/src/schema/pg.js")).schema.users.id,
          pwUserId,
        ),
      );
    passwordTestUserId = pwRows[0]!.id;
    const { signJWT } = await import("@exam/auth/src/session.js");
    passwordTestToken = signJWT({
      actorId: passwordTestUserId,
      role: "Teacher",
      organizationId: ctx.org.id,
    });

    const courseRes = await ctx.app.inject({
      method: "POST",
      url: "/api/courses",
      payload: {
        name: "Smoke Course",
        code: `SM-${uniquePrefix()}`,
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
        content: "Is 1+1=2?",
        standardAnswer: true,
        score: 100,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    questionId = qRes.json().id;

    const examRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        title: "Smoke Exam",
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
    examId = examRes.json().id;
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("publishes an exam", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("published");
  });

  it("creates a candidate and enrolls to exam", async () => {
    const candidate = await createCandidateViaApi(
      ctx.app,
      ctx.adminToken,
      "smoke-candidate-" + uniquePrefix(),
      ctx.org.id,
    );
    candidateProfileId = candidate.candidateProfileId;
    candidateToken = candidate.token;

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/enrollments`,
      payload: { candidateIds: [candidateProfileId] },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().added).toBe(1);
  });

  it("candidate can list their exams", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/candidate/exams",
      cookies: { "auth-token": candidateToken },
    });
    expect(res.statusCode).toBe(200);
    const exams = res.json();
    expect(exams.length).toBeGreaterThanOrEqual(1);
    const enrolled = exams.find((e: { examId: string }) => e.examId === examId);
    expect(enrolled).toBeDefined();
    expect(enrolled.isAvailable).toBe(true);
  });

  it("candidate can start exam", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${examId}/start`,
      cookies: { "auth-token": candidateToken },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe("in_progress");
    expect(body).toHaveProperty("id");
  });

  it("delete course with questions returns 409", async () => {
    const res = await ctx.app.inject({
      method: "DELETE",
      url: `/api/courses/${courseId}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(409);
  });

  it("password change works", async () => {
    const res = await ctx.app.inject({
      method: "PATCH",
      url: "/api/auth/me/password",
      payload: {
        currentPassword: "pwtest123",
        newPassword: "newpwtest123",
      },
      cookies: { "auth-token": passwordTestToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  it("login works with new password", async () => {
    const pwUser = await ctx.db
      .select()
      .from((await import("@exam/db/src/schema/pg.js")).schema.users)
      .where(
        (await import("drizzle-orm")).eq(
          (await import("@exam/db/src/schema/pg.js")).schema.users.id,
          passwordTestUserId,
        ),
      );
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        organizationSlug: "default",
        username: pwUser[0]!.username,
        password: "newpwtest123",
      },
    });
    expect(res.statusCode).toBe(200);
  });
});
