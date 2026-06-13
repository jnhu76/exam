import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fp from "fastify-plugin";
import { randomUUID } from "node:crypto";
import authPlugin from "../../src/plugins/auth.js";
import tenantPlugin from "../../src/plugins/tenant.js";
import rateLimitPlugin from "../../src/plugins/rateLimit.js";
import nowPlugin from "../../src/plugins/now.js";
import { setupErrorHandler } from "../../src/plugins/errors.js";
import setupSecurity from "../../src/plugins/security.js";
import { hashPassword } from "@exam/auth/src/password.js";
import { createDatabase } from "@exam/db/src/database.js";
import { migratePostgres } from "@exam/db/src/postgres.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { eq } from "drizzle-orm";
import { signJWT } from "@exam/auth/src/session.js";
import { seed } from "@exam/db/src/seed.js";
import courseRoutes from "../../src/routes/course.js";
import questionRoutes from "../../src/routes/question.js";
import examRoutes from "../../src/routes/exam.js";
import candidateRoutes from "../../src/routes/candidate.js";
import attemptRoutes from "../../src/routes/attempts.js";
import type { Database } from "@exam/db/src/types.js";
import type { Role } from "@exam/domain";

function createDbPlugin(db: Database) {
  return fp(async (fastify) => {
    fastify.decorate("db", db);
  });
}

describe("Exam Protocol Security Baseline (S08-lite)", () => {
  let app: ReturnType<typeof Fastify>;
  let sql: Awaited<ReturnType<typeof createDatabase>>["sql"];
  let adminToken: string;
  let candidateToken: string;
  let otherCandidateToken: string;
  let candidateProfileId: string;
  let courseId: string;
  let questionId: string;

  async function createExamAndStart(
    title: string,
    durationMinutes = 60,
  ): Promise<string> {
    const examRes = await app.inject({
      method: "POST",
      url: "/api/exams",
      payload: {
        title,
        courseId,
        durationMinutes,
        openAt: new Date(Date.now() - 3600000).toISOString(),
        closeAt: new Date(Date.now() + 86400000).toISOString(),
        passingScore: 6,
        totalScore: 10,
        questionIds: [questionId],
      },
      cookies: { "auth-token": adminToken },
    });
    const examId = examRes.json().id;
    if (!examId) {
      throw new Error(
        `exam creation failed: ${examRes.statusCode} ${examRes.body}`,
      );
    }

    const pubRes = await app.inject({
      method: "POST",
      url: `/api/exams/${examId}/publish`,
      cookies: { "auth-token": adminToken },
    });
    if (pubRes.statusCode !== 200) {
      throw new Error(`publish failed: ${pubRes.statusCode} ${pubRes.body}`);
    }

    const enrollRes = await app.inject({
      method: "POST",
      url: `/api/exams/${examId}/enrollments`,
      payload: { candidateIds: [candidateProfileId] },
      cookies: { "auth-token": adminToken },
    });
    if (enrollRes.statusCode !== 200 && enrollRes.statusCode !== 201) {
      throw new Error(
        `enroll failed: ${enrollRes.statusCode} ${enrollRes.body}`,
      );
    }

    const startRes = await app.inject({
      method: "POST",
      url: `/api/attempts/${examId}/start`,
      cookies: { "auth-token": candidateToken },
    });
    expect(startRes.statusCode, `start failed: ${startRes.body}`).toBe(201);
    return startRes.json().id;
  }

  beforeAll(async () => {
    const conn = await createDatabase(
      process.env.TEST_DATABASE_URL ??
        "postgresql://exam:exam@localhost:5432/exam_test",
    );
    await migratePostgres(conn.db);
    const db = conn.db;
    sql = conn.sql;

    const seedResult = await seed(db, hashPassword);

    const admin = (
      await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, seedResult.users.adminId))
    )[0]!;
    const candidate = (
      await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, seedResult.users.candidateId))
    )[0]!;

    adminToken = signJWT({
      actorId: admin.id,
      role: admin.role as Role,
      organizationId: admin.organizationId,
    });
    candidateToken = signJWT({
      actorId: candidate.id,
      role: candidate.role as Role,
      organizationId: candidate.organizationId,
    });

    const otherCandidateUserId = randomUUID();
    await db.insert(schema.users).values({
      id: otherCandidateUserId,
      organizationId: candidate.organizationId,
      username: `security-other-${randomUUID().slice(0, 8)}`,
      passwordHash: "unused",
      name: "Other Candidate",
      role: "Candidate",
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await db.insert(schema.candidateProfiles).values({
      id: randomUUID(),
      userId: otherCandidateUserId,
      organizationId: candidate.organizationId,
      fields: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    otherCandidateToken = signJWT({
      actorId: otherCandidateUserId,
      role: "Candidate",
      organizationId: candidate.organizationId,
    });

    const candidateRows = await db
      .select()
      .from(schema.candidateProfiles)
      .where(eq(schema.candidateProfiles.userId, candidate.id));
    candidateProfileId = candidateRows[0]?.id ?? "";
    if (!candidateProfileId) {
      await db.insert(schema.candidateProfiles).values({
        id: crypto.randomUUID(),
        userId: candidate.id,
        organizationId: candidate.organizationId,
        fields: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const freshRows = await db
        .select()
        .from(schema.candidateProfiles)
        .where(eq(schema.candidateProfiles.userId, candidate.id));
      candidateProfileId = freshRows[0]!.id;
    }

    app = Fastify();
    setupSecurity(app);
    setupErrorHandler(app);
    await app.register(fastifyCookie);
    await app.register(createDbPlugin(db));
    await app.register(nowPlugin);
    await app.register(authPlugin);
    await app.register(tenantPlugin);
    await app.register(rateLimitPlugin);
    await app.register(courseRoutes, { prefix: "/api" });
    await app.register(questionRoutes, { prefix: "/api" });
    await app.register(examRoutes, { prefix: "/api" });
    await app.register(candidateRoutes, { prefix: "/api" });
    await app.register(attemptRoutes, { prefix: "/api" });
    await app.ready();

    const course = await app.inject({
      method: "POST",
      url: "/api/courses",
      payload: {
        name: "Security Test Course",
        code: `SEC-${randomUUID().slice(0, 8)}`,
      },
      cookies: { "auth-token": adminToken },
    });
    courseId = course.json().id;
    if (!courseId) {
      throw new Error(
        `course creation failed: ${course.statusCode} ${course.body}`,
      );
    }

    const question = await app.inject({
      method: "POST",
      url: "/api/questions",
      payload: {
        courseId,
        type: "single_choice",
        content: "Is security important?",
        options: [
          { id: "A", content: "Yes" },
          { id: "B", content: "No" },
        ],
        standardAnswer: "A",
        score: 10,
        difficulty: 1,
        tags: [],
      },
      cookies: { "auth-token": adminToken },
    });
    questionId = question.json().id;
  });

  afterAll(async () => {
    await app.close();
    await sql.end();
  });

  describe("AC1: Submit after deadline returns 409", () => {
    it("rejects submit when server time is past deadlineAt", async () => {
      const attemptId = await createExamAndStart("Deadline Exam", 1);

      const originalNow = app.now;
      app.now = () => new Date(Date.now() + 5 * 60 * 1000);
      try {
        const submitRes = await app.inject({
          method: "POST",
          url: `/api/attempts/${attemptId}/submit`,
          cookies: { "auth-token": candidateToken },
        });

        expect(submitRes.statusCode).toBe(409);
        expect(submitRes.json().error.code).toBe("ATTEMPT_DEADLINE_EXCEEDED");
      } finally {
        app.now = originalNow;
      }
    });
  });

  describe("AC2: Cannot start attempt for unpublished exam", () => {
    it("returns 409 when exam is still in draft", async () => {
      const examRes = await app.inject({
        method: "POST",
        url: "/api/exams",
        payload: {
          title: "Draft Exam",
          courseId,
          durationMinutes: 60,
          openAt: new Date(Date.now() - 3600000).toISOString(),
          closeAt: new Date(Date.now() + 86400000).toISOString(),
          passingScore: 6,
          totalScore: 10,
          questionIds: [questionId],
        },
        cookies: { "auth-token": adminToken },
      });
      const draftExamId = examRes.json().id;

      const startRes = await app.inject({
        method: "POST",
        url: `/api/attempts/${draftExamId}/start`,
        cookies: { "auth-token": candidateToken },
      });

      expect(startRes.statusCode).toBe(409);
      expect(startRes.json().error.code).toBe("EXAM_NOT_OPEN");
    });
  });

  describe("AC3: Answer save versioned protocol", () => {
    it("accepts first save then rejects stale version", async () => {
      const attemptId = await createExamAndStart("Answer Version Exam");

      const first = await app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/answers/${questionId}`,
        payload: {
          attemptId,
          questionId,
          answer: "A",
          clientSeq: 0,
          clientSavedAt: new Date().toISOString(),
          baseVersion: 0,
        },
        cookies: { "auth-token": candidateToken },
      });
      expect(first.statusCode).toBe(200);
      expect(first.json().accepted).toBe(true);

      const stale = await app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/answers/${questionId}`,
        payload: {
          attemptId,
          questionId,
          answer: "B",
          clientSeq: 1,
          clientSavedAt: new Date().toISOString(),
          baseVersion: 0,
        },
        cookies: { "auth-token": candidateToken },
      });
      expect(stale.statusCode).toBe(200);
      expect(stale.json().accepted).toBe(false);
    });
  });

  describe("AC4: Candidate cannot submit another candidate's attempt", () => {
    it("returns 404 for cross-candidate submit", async () => {
      const attemptId = await createExamAndStart("Ownership Exam");

      const res = await app.inject({
        method: "POST",
        url: `/api/attempts/${attemptId}/submit`,
        cookies: { "auth-token": otherCandidateToken },
      });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe("RESOURCE_NOT_FOUND");
    });
  });
});
