import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { schema } from "@exam/db/src/schema/pg.js";
import {
  buildTestApp,
  createCandidateViaApi,
  createExamViaApi,
  publishExamViaApi,
  uniquePrefix,
} from "./testHelpers.js";
import authRoutes from "./auth.js";
import candidateRoutes from "./candidate.js";
import attemptRoutes from "./attempts.js";
import examRoutes from "./exam.js";
import courseRoutes from "./course.js";
import questionRoutes from "./question.js";
import { createUserRepo } from "@exam/db/src/repository/userRepo.js";
import { createCandidateRepo } from "@exam/db/src/repository/candidateRepo.js";

describe("candidate profile invariant", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(authRoutes, { prefix: "/auth" });
      await fastify.register(candidateRoutes);
      await fastify.register(attemptRoutes);
      await fastify.register(courseRoutes);
      await fastify.register(questionRoutes);
      await fastify.register(examRoutes);
    });
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("POST /api/candidates creates both user and candidateProfile", async () => {
    const candidate = await createCandidateViaApi(
      ctx.app,
      ctx.adminToken,
      `invariant-test-1-${uniquePrefix()}`,
      ctx.org.id,
    );

    expect(candidate.candidateProfileId).toBeDefined();
    expect(candidate.userId).toBeDefined();

    const userRepo = createUserRepo(ctx.db);
    const user = await userRepo.findById(
      {
        actorId: ctx.admin.id,
        organizationId: ctx.org.id,
        targetOrganizationId: ctx.org.id,
        role: "SuperAdmin",
        permissions: [],
        sessionId: "test",
      },
      candidate.userId,
    );
    expect(user).toBeDefined();
    expect(user!.role).toBe("Candidate");

    const candidateRepo = createCandidateRepo(ctx.db);
    const profile = await candidateRepo.findById(
      {
        actorId: ctx.admin.id,
        organizationId: ctx.org.id,
        targetOrganizationId: ctx.org.id,
        role: "SuperAdmin",
        permissions: [],
        sessionId: "test",
      },
      candidate.candidateProfileId,
    );
    expect(profile).toBeDefined();
    expect(profile!.userId).toBe(candidate.userId);
  });

  it("Candidate with profile can get candidate exams", async () => {
    const candidate = await createCandidateViaApi(
      ctx.app,
      ctx.adminToken,
      `invariant-test-2-${uniquePrefix()}`,
      ctx.org.id,
    );

    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/candidate/exams",
      cookies: { "auth-token": candidate.token },
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it("candidate without profile gets empty exam list", async () => {
    const bareUserId = randomUUID();
    await ctx.db.insert(schema.users).values({
      id: bareUserId,
      organizationId: ctx.org.id,
      username: `bare-cand-${uniquePrefix()}`,
      passwordHash: await (
        await import("@exam/auth/src/password.js")
      ).hashPassword("test123"),
      name: "Bare Candidate",
      role: "Candidate",
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const { signJWT } = await import("@exam/auth/src/session.js");
    const bareToken = signJWT({
      actorId: bareUserId,
      role: "Candidate",
      organizationId: ctx.org.id,
    });

    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/candidate/exams",
      cookies: { "auth-token": bareToken },
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });

  it("candidate without profile cannot start exam attempt", async () => {
    const bareUserId = randomUUID();
    await ctx.db.insert(schema.users).values({
      id: bareUserId,
      organizationId: ctx.org.id,
      username: `bare-start-cand-${uniquePrefix()}`,
      passwordHash: await (
        await import("@exam/auth/src/password.js")
      ).hashPassword("test123"),
      name: "Bare Start Candidate",
      role: "Candidate",
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const { signJWT } = await import("@exam/auth/src/session.js");
    const bareToken = signJWT({
      actorId: bareUserId,
      role: "Candidate",
      organizationId: ctx.org.id,
    });

    const examId = await createExamViaApi(ctx.app, ctx.adminToken, {
      examTitle: "Profile Invariant Start Exam",
      courseCode: "PI-START-101",
      courseName: "Profile Invariant Start Course",
      questionContent: "Is this a test?",
      questionAnswer: true,
      questionScore: 10,
      durationMinutes: 60,
      passingScore: 5,
      totalScore: 10,
    });
    await publishExamViaApi(ctx.app, ctx.adminToken, examId);

    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${examId}/start`,
      cookies: { "auth-token": bareToken },
    });
    expect(res.statusCode).not.toBe(201);
  });

  it("Seed candidate without profile cannot submit answers", async () => {
    const fakeAttemptId = "00000000-0000-0000-0000-000000000000";
    const fakeQuestionId = "00000000-0000-0000-0000-000000000001";
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/attempts/${fakeAttemptId}/answers/${fakeQuestionId}`,
      payload: {
        attemptId: fakeAttemptId,
        questionId: fakeQuestionId,
        answer: true,
        clientSeq: 1,
        clientSavedAt: new Date().toISOString(),
        baseVersion: 0,
      },
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(res.statusCode).not.toBe(200);
  });
});
