import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fp from "fastify-plugin";
import authPlugin from "../../src/plugins/auth.js";
import tenantPlugin from "../../src/plugins/tenant.js";
import rateLimitPlugin from "../../src/plugins/rateLimit.js";
import nowPlugin from "../../src/plugins/now.js";
import { setupErrorHandler } from "../../src/plugins/errors.js";
import zodProviderPlugin from "../../src/plugins/zodProvider.js";
import setupSecurity from "../../src/plugins/security.js";
import { hashPassword } from "@exam/auth/src/password.js";
import { createDatabase } from "@exam/db/src/database.js";
import { migratePostgres } from "@exam/db/src/postgres.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { setupApiTestDatabaseFromEnv } from "../../src/routes/testDatabase.js";
import { TEST_DB_URL } from "@exam/db/src/testDb.js";
import { eq } from "drizzle-orm";
import { signJWT } from "@exam/auth/src/session.js";
import { seed } from "@exam/db/src/seed.js";
import examRoutes from "../../src/routes/exam.js";
import systemRoutes from "../../src/routes/system.js";
import { randomUUID } from "node:crypto";
import type { Database } from "@exam/db/src/types.js";
import type { Role } from "@exam/domain";

function createDbPlugin(db: Database) {
  return fp(async (fastify) => {
    fastify.decorate("db", db);
  });
}

describe("Tenant Isolation (S01)", () => {
  let db: Database;
  let sql: Awaited<ReturnType<typeof createDatabase>>["sql"];
  let orgA: {
    id: string;
    slug: string;
    name: string;
    displayName: string;
    createdAt: Date;
    updatedAt: Date;
  };
  let orgB: { id: string; slug: string };
  let adminA: { id: string; organizationId: string; role: string };
  let adminB: { id: string; organizationId: string; role: string };
  let candidateA: { id: string; organizationId: string; role: string };
  let adminAToken: string;
  let adminBToken: string;
  let candidateAToken: string;
  let app: ReturnType<typeof Fastify>;
  let examBId: string;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const testDb = await setupApiTestDatabaseFromEnv({
      namespace: "security-tenant",
      databaseUrl: TEST_DB_URL,
    });
    await testDb.resetPostgres();
    cleanup = testDb.close;
    const conn = await createDatabase(testDb.databaseUrl, testDb.schemaName);
    await migratePostgres(
      conn.db,
      testDb.schemaName ? { migrationsSchema: testDb.schemaName } : undefined,
    );
    db = conn.db;
    sql = conn.sql;

    const seedResult = await seed(db, hashPassword);

    const orgs = await db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.id, seedResult.orgId));
    orgA = orgs[0]!;

    const candidateUser = (
      await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, seedResult.users.candidateId))
    )[0]!;

    candidateA = candidateUser as typeof candidateA;

    const now = new Date();

    const adminAId = randomUUID();
    const hashA = await hashPassword("admin123");
    await db.insert(schema.users).values({
      id: adminAId,
      organizationId: orgA.id,
      username: `admin-a-${adminAId.slice(0, 8)}`,
      passwordHash: hashA,
      name: "Admin A",
      role: "Admin",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    adminA = { id: adminAId, organizationId: orgA.id, role: "Admin" };

    const orgBId = randomUUID();
    const orgBSlug = `org-b-${orgBId.slice(0, 8)}`;
    orgB = { id: orgBId, slug: orgBSlug };
    await db.insert(schema.organizations).values({
      id: orgBId,
      name: "Organization B",
      displayName: "Org B",
      slug: orgBSlug,
      createdAt: now,
      updatedAt: now,
    });

    const adminBId = randomUUID();
    const hashB = await hashPassword("admin123");
    await db.insert(schema.users).values({
      id: adminBId,
      organizationId: orgBId,
      username: `admin-b-${adminBId.slice(0, 8)}`,
      passwordHash: hashB,
      name: "Admin B",
      role: "Admin",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    adminB = { id: adminBId, organizationId: orgBId, role: "Admin" };

    const courseId = randomUUID();
    await db.insert(schema.courses).values({
      id: courseId,
      organizationId: orgBId,
      name: "Course B",
      code: "CB",
      description: "",
      createdAt: now,
      updatedAt: now,
    });

    const questionId = randomUUID();
    await db.insert(schema.questions).values({
      id: questionId,
      organizationId: orgBId,
      courseId,
      type: "true_false",
      content: "Q1 B",
      standardAnswer: true,
      score: 10,
      options: [],
      attachments: [],
      difficulty: 0,
      tags: [],
      gradingRule: {
        multiSelectScoring: "all_correct_full",
        fillBlankMatchMode: "exact",
      },
      createdAt: now,
      updatedAt: now,
    });

    examBId = randomUUID();
    await db.insert(schema.exams).values({
      id: examBId,
      organizationId: orgBId,
      courseId,
      title: "Exam B",
      description: "",
      status: "published",
      timingMode: "timed_window",
      durationMinutes: 60,
      openAt: now,
      closeAt: new Date(Date.now() + 86400000),
      passingScore: 60,
      totalScore: 100,
      questionSelectionMode: "manual",
      questionIds: [questionId],
      questionSnapshot: [],
      controlFlags: {
        shuffleQuestions: false,
        shuffleOptions: false,
        detectTabSwitch: false,
        disableCopyPaste: false,
        requireQueue: false,
        batchSize: 10,
        batchInterval: 3,
        restrictIp: false,
        requireLockdown: false,
        showResultImmediately: false,
      },
      retakePolicy: "unlimited",
      scoreStrategy: "highest",
      maxAttempts: 1,
      createdAt: now,
      updatedAt: now,
    });

    adminAToken = signJWT({
      actorId: adminA.id,
      role: adminA.role as Role,
      organizationId: adminA.organizationId,
    });
    adminBToken = signJWT({
      actorId: adminB.id,
      role: adminB.role as Role,
      organizationId: adminB.organizationId,
    });
    candidateAToken = signJWT({
      actorId: candidateA.id,
      role: candidateA.role as Role,
      organizationId: candidateA.organizationId,
    });

    app = Fastify();
    setupSecurity(app);
    setupErrorHandler(app);
    await app.register(zodProviderPlugin);
    await app.register(fastifyCookie);
    await app.register(createDbPlugin(db));
    await app.register(nowPlugin);
    await app.register(authPlugin);
    await app.register(tenantPlugin);
    await app.register(rateLimitPlugin);
    await app.register(examRoutes, { prefix: "/api" });
    await app.register(systemRoutes, { prefix: "/api" });

    app.get("/api/health", async () => {
      return { status: "ok" };
    });

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await sql.end();
    await cleanup();
  });

  describe("Cross-tenant data isolation", () => {
    it("org A admin sees only org A exams", async () => {
      const courseAId = randomUUID();
      const now = new Date();
      await db.insert(schema.courses).values({
        id: courseAId,
        organizationId: orgA.id,
        name: "Course A",
        code: `CA-${Date.now()}`,
        description: "",
        createdAt: now,
        updatedAt: now,
      });

      const examAId = randomUUID();
      await db.insert(schema.exams).values({
        id: examAId,
        organizationId: orgA.id,
        courseId: courseAId,
        title: "Exam A",
        description: "",
        status: "published",
        timingMode: "timed_window",
        durationMinutes: 60,
        openAt: now,
        closeAt: new Date(Date.now() + 86400000),
        passingScore: 60,
        totalScore: 100,
        questionSelectionMode: "manual",
        questionIds: [],
        questionSnapshot: [],
        controlFlags: {
          shuffleQuestions: false,
          shuffleOptions: false,
          detectTabSwitch: false,
          disableCopyPaste: false,
          requireQueue: false,
          batchSize: 10,
          batchInterval: 3,
          restrictIp: false,
          requireLockdown: false,
          showResultImmediately: false,
        },
        retakePolicy: "unlimited",
        scoreStrategy: "highest",
        maxAttempts: 1,
        createdAt: now,
        updatedAt: now,
      });

      const res = await app.inject({
        method: "GET",
        url: "/api/exams",
        cookies: { "auth-token": adminAToken },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      const exams = body.items as Array<{ organizationId: string }>;
      expect(exams.length).toBeGreaterThanOrEqual(1);
      expect(exams.every((e) => e.organizationId === orgA.id)).toBe(true);
    });

    it("org A candidate cannot start org B exam", async () => {
      const res = await app.inject({
        method: "POST",
        url: `/api/attempts/${examBId}/start`,
        cookies: { "auth-token": candidateAToken },
      });
      expect([403, 404]).toContain(res.statusCode);
    });

    it("non-SuperAdmin x-target-org header is ignored", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/exams",
        cookies: { "auth-token": adminAToken },
        headers: { "x-target-org": orgB.id },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      const exams = body.items as Array<{ organizationId: string }>;
      expect(exams.every((e) => e.organizationId === orgA.id)).toBe(true);
    });
  });

  describe("Public endpoint exemption", () => {
    it("GET /api/health does not require authentication", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/health",
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe("ok");
    });

    it("GET /api/system/health requires authentication", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/system/health",
      });
      expect(res.statusCode).toBe(401);
    });

    it("GET /api/system/health with admin token returns 200", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/system/health",
        cookies: { "auth-token": adminAToken },
      });
      expect(res.statusCode).toBe(200);
    });

    it("GET /api/system/health rejects Candidate with 403", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/system/health",
        cookies: { "auth-token": candidateAToken },
      });
      expect(res.statusCode).toBe(403);
    });
  });
});
