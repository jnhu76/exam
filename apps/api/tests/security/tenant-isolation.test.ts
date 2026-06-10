import { describe, it, expect, beforeAll } from "vitest";
import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fp from "fastify-plugin";
import authPlugin from "../../src/plugins/auth.js";
import tenantPlugin from "../../src/plugins/tenant.js";
import rateLimitPlugin from "../../src/plugins/rateLimit.js";
import { setupErrorHandler } from "../../src/plugins/errors.js";
import setupSecurity from "../../src/plugins/security.js";
import { hashPassword } from "@exam/auth/src/password.js";
import { createSqliteDatabase, migrateSqlite } from "@exam/db/src/sqlite.js";
import { sqliteSchema } from "@exam/db/src/schema/sqlite.js";
import { signJWT } from "@exam/auth/src/session.js";
import { seed } from "@exam/db/src/seed.js";
import examRoutes from "../../src/routes/exam.js";
import systemRoutes from "../../src/routes/system.js";
import organizationRoutes from "../../src/routes/organization.js";
import { randomUUID } from "node:crypto";
import type { SqliteDatabase } from "@exam/db/src/sqlite.js";

function createDbPlugin(db: SqliteDatabase) {
  return fp(async (fastify) => {
    fastify.decorate("db", db);
  });
}

describe("Tenant Isolation (S01)", () => {
  let db: SqliteDatabase;
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
  let superAdmin: { id: string; organizationId: string; role: string };
  let adminAToken: string;
  let adminBToken: string;
  let candidateAToken: string;
  let superAdminToken: string;
  let app: ReturnType<typeof Fastify>;
  let examBId: string;

  beforeAll(async () => {
    const sqlite = createSqliteDatabase(":memory:");
    db = sqlite.db;
    migrateSqlite(db);

    await seed(db, hashPassword);

    const orgs = db.select().from(sqliteSchema.organizations).all();
    orgA = orgs[0]!;

    const usersA = db.select().from(sqliteSchema.users).all();
    const superAdminUser = usersA.find((u) => u.role === "SuperAdmin")!;
    const candidateUser = usersA.find((u) => u.role === "Candidate");

    superAdmin = superAdminUser;
    candidateA = candidateUser ?? superAdminUser;

    const now = new Date();

    const adminAId = randomUUID();
    const hashA = await hashPassword("admin123");
    db.insert(sqliteSchema.users)
      .values({
        id: adminAId,
        organizationId: orgA.id,
        username: "admin-a",
        passwordHash: hashA,
        name: "Admin A",
        role: "Admin",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    adminA = { id: adminAId, organizationId: orgA.id, role: "Admin" };

    const orgBId = randomUUID();
    orgB = { id: orgBId, slug: "org-b" };
    db.insert(sqliteSchema.organizations)
      .values({
        id: orgBId,
        name: "Organization B",
        displayName: "Org B",
        slug: "org-b",
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const adminBId = randomUUID();
    const hashB = await hashPassword("admin123");
    db.insert(sqliteSchema.users)
      .values({
        id: adminBId,
        organizationId: orgBId,
        username: "admin-b",
        passwordHash: hashB,
        name: "Admin B",
        role: "Admin",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    adminB = { id: adminBId, organizationId: orgBId, role: "Admin" };

    const courseId = randomUUID();
    db.insert(sqliteSchema.courses)
      .values({
        id: courseId,
        organizationId: orgBId,
        name: "Course B",
        code: "CB",
        description: "",
        createdAt: now,
        updatedAt: now,
      })
      .run();

    const questionId = randomUUID();
    db.insert(sqliteSchema.questions)
      .values({
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
      })
      .run();

    examBId = randomUUID();
    db.insert(sqliteSchema.exams)
      .values({
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
          batchSize: 0,
          batchInterval: 0,
          restrictIp: false,
          requireLockdown: false,
          showResultImmediately: false,
        },
        retakePolicy: "unlimited",
        scoreStrategy: "highest",
        maxAttempts: 1,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    adminAToken = signJWT({
      actorId: adminA.id,
      role: adminA.role as "Admin",
      organizationId: adminA.organizationId,
    });
    adminBToken = signJWT({
      actorId: adminB.id,
      role: adminB.role as "Admin",
      organizationId: adminB.organizationId,
    });
    candidateAToken = signJWT({
      actorId: candidateA.id,
      role: candidateA.role as "Candidate",
      organizationId: candidateA.organizationId,
    });
    superAdminToken = signJWT({
      actorId: superAdmin.id,
      role: superAdmin.role as "SuperAdmin",
      organizationId: superAdmin.organizationId,
    });

    app = Fastify();
    setupSecurity(app);
    setupErrorHandler(app);
    await app.register(fastifyCookie);
    await app.register(createDbPlugin(db));
    await app.register(authPlugin);
    await app.register(tenantPlugin);
    await app.register(rateLimitPlugin);
    await app.register(organizationRoutes, { prefix: "/api" });
    await app.register(examRoutes, { prefix: "/api" });
    await app.register(systemRoutes, { prefix: "/api" });

    app.get("/api/health", async () => {
      return { status: "ok" };
    });

    await app.ready();
  });

  describe("Cross-tenant data isolation", () => {
    it("org A admin sees only org A exams", async () => {
      const courseAId = randomUUID();
      const now = new Date();
      db.insert(sqliteSchema.courses)
        .values({
          id: courseAId,
          organizationId: orgA.id,
          name: "Course A",
          code: "CA",
          description: "",
          createdAt: now,
          updatedAt: now,
        })
        .run();

      const examAId = randomUUID();
      db.insert(sqliteSchema.exams)
        .values({
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
            batchSize: 0,
            batchInterval: 0,
            restrictIp: false,
            requireLockdown: false,
            showResultImmediately: false,
          },
          retakePolicy: "unlimited",
          scoreStrategy: "highest",
          maxAttempts: 1,
          createdAt: now,
          updatedAt: now,
        })
        .run();

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

  describe("SuperAdmin cross-organization access", () => {
    it("SuperAdmin without targetOrganizationId on org-scoped API returns 400", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/exams",
        cookies: { "auth-token": superAdminToken },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error?.code).toBe("TARGET_ORGANIZATION_REQUIRED");
    });

    it("SuperAdmin with valid targetOrganizationId can view org B data", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/exams",
        cookies: { "auth-token": superAdminToken },
        headers: { "x-target-org": orgB.id },
      });
      expect(res.statusCode).toBe(200);
    });

    it("SuperAdmin with invalid targetOrganizationId returns 403", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/exams",
        cookies: { "auth-token": superAdminToken },
        headers: { "x-target-org": "nonexistent-org-id" },
      });
      expect(res.statusCode).toBe(403);
      const body = res.json();
      expect(body.error?.code).toBe("TENANT_ACCESS_DENIED");
    });

    it("SuperAdmin on platform API (GET /api/organizations) works without targetOrg", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/organizations",
        cookies: { "auth-token": superAdminToken },
      });
      expect(res.statusCode).toBe(200);
      const orgs = res.json();
      expect(orgs.length).toBeGreaterThanOrEqual(2);
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

    it("GET /api/system/health allows SuperAdmin without x-target-org", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/system/health",
        cookies: { "auth-token": superAdminToken },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty("cpu");
      expect(body).toHaveProperty("memory");
      expect(body).toHaveProperty("status");
    });
  });
});
