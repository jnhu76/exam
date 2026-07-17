import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import courseRoutes from "./course.js";
import questionRoutes from "./question.js";
import examRoutes from "./exam.js";
import { buildTestApp, uniquePrefix } from "./testHelpers.js";
import { signJWT } from "@exam/auth/src/session.js";
import { hashPassword } from "@exam/auth/src/password.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { getRuntimeConfig } from "../config/runtimeConfig.js";

/**
 * P4-2C capability cutover — Teacher exam authoring/lifecycle proof (task 8.4).
 *
 * The exam authoring routes flipped from requireRole(["Admin"]) to
 * requireCapability. Teacher preset grants ExamCreate/ExamUpdate/ExamPublish/
 * ExamClose/ExamResultPublish/ExamEnrollmentManage/ScoreAllView, so Teacher
 * must PASS the gate and drive the real lifecycle: create -> publish.
 * Candidate has no exam perm -> denied at the gate. Admin has no regression.
 *
 * This is the write/lifecycle-side complement to the GET-only exam matrix in
 * permissionMatrix.test.ts. It does NOT re-prove the full P2 authoring flow;
 * it proves only the capability dimension (Teacher may author/publish).
 */
describe("exam routes — P4-2C capability cutover (Teacher authoring)", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let courseId: string;
  let questionId: string;
  let teacherToken: string;
  let candidateToken: string;

  beforeAll(async () => {
    ctx = await buildTestApp(async (fastify) => {
      await fastify.register(courseRoutes);
      await fastify.register(questionRoutes);
      await fastify.register(examRoutes);
    });

    // Seed course + a publishable question (publish requires >=1 question).
    const courseRes = await ctx.app.inject({
      method: "POST",
      url: "/api/courses",
      payload: {
        name: "P4-2C Course",
        code: `P42C-${uniquePrefix()}`,
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
        content: "P4-2C question.",
        standardAnswer: true,
        score: 100,
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    questionId = qRes.json().id;

    const { jwtSecret } = getRuntimeConfig().authSecret;
    const mkUser = async (role: "Teacher" | "Candidate") => {
      const id = randomUUID();
      await ctx.db.insert(schema.users).values({
        id,
        organizationId: ctx.org.id,
        username: `p42c-${role.toLowerCase()}-${randomUUID().slice(0, 6)}`,
        passwordHash: await hashPassword("pw123456"),
        name: `${role} p42c`,
        role,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      return signJWT(
        { actorId: id, role, organizationId: ctx.org.id },
        jwtSecret,
      );
    };
    teacherToken = await mkUser("Teacher");
    candidateToken = await mkUser("Candidate");
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("Teacher creates a draft exam (passes the create gate)", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        courseId,
        title: "P4-2C Exam",
        description: "",
        durationMinutes: 60,
        openAt: new Date().toISOString(),
        closeAt: new Date(Date.now() + 86400000).toISOString(),
        passingScore: 50,
        totalScore: 100,
        questionIds: [questionId],
      },
      cookies: { "auth-token": teacherToken },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().title).toBe("P4-2C Exam");
    expect(res.json().status).toBe("draft");
  });

  it("Teacher lists exams (passes the view gate)", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/exams",
      cookies: { "auth-token": teacherToken },
    });
    expect(res.statusCode).toBe(200);
  });

  it("Teacher publishes a draft exam (passes the publish gate; draft -> published)", async () => {
    // Create a fresh draft to publish (publish is a one-way transition).
    const draftRes = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        courseId,
        title: "P4-2C Publish Exam",
        description: "",
        durationMinutes: 60,
        openAt: new Date().toISOString(),
        closeAt: new Date(Date.now() + 86400000).toISOString(),
        passingScore: 50,
        totalScore: 100,
        questionIds: [questionId],
      },
      cookies: { "auth-token": teacherToken },
    });
    expect(draftRes.statusCode).toBe(201);
    const examId = draftRes.json().id;

    const pubRes = await ctx.app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish`,
      cookies: { "auth-token": teacherToken },
    });
    expect(pubRes.statusCode).toBe(200);
    expect(pubRes.json().status).toBe("published");
  });

  it("Candidate is denied exam create at the capability gate (403)", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        courseId,
        title: "should not create",
        description: "",
        durationMinutes: 60,
        openAt: new Date().toISOString(),
        closeAt: new Date(Date.now() + 86400000).toISOString(),
        passingScore: 50,
        totalScore: 100,
        questionIds: [questionId],
      },
      cookies: { "auth-token": candidateToken },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      error: expect.objectContaining({ code: "PERMISSION_DENIED" }),
    });
  });

  it("Admin has no regression (creates an exam, 201)", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        courseId,
        title: "Admin still works",
        description: "",
        durationMinutes: 60,
        openAt: new Date().toISOString(),
        closeAt: new Date(Date.now() + 86400000).toISOString(),
        passingScore: 50,
        totalScore: 100,
        questionIds: [questionId],
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(201);
  });
});
