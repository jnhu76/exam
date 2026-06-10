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
import organizationRoutes from "../../src/routes/organization.js";
import userRoutes from "../../src/routes/user.js";
import candidateRoutes from "../../src/routes/candidate.js";
import systemRoutes from "../../src/routes/system.js";
import settingsRoutes from "../../src/routes/settings.js";
import { randomUUID } from "node:crypto";
import type { SqliteDatabase } from "@exam/db/src/sqlite.js";
import type { Permission } from "@exam/domain";
import { getPermissionsForRole } from "@exam/auth/src/rbac.js";

function createDbPlugin(db: SqliteDatabase) {
  return fp(async (fastify) => {
    fastify.decorate("db", db);
  });
}

describe("RBAC Permission Matrix (S02)", () => {
  let db: SqliteDatabase;
  let org: { id: string };
  let adminId: string;
  let adminToken: string;
  let superAdminToken: string;
  let teacherToken: string;
  let candidateToken: string;
  let app: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    const sqlite = createSqliteDatabase(":memory:");
    db = sqlite.db;
    migrateSqlite(db);

    await seed(db, hashPassword);

    const orgs = db.select().from(sqliteSchema.organizations).all();
    org = orgs[0]!;

    const users = db.select().from(sqliteSchema.users).all();
    const superAdmin = users.find((u) => u.role === "SuperAdmin")!;
    const teacher = users.find((u) => u.role === "Teacher")!;
    const candidate = users.find((u) => u.role === "Candidate")!;

    const now = new Date();
    adminId = randomUUID();
    const hash = await hashPassword("admin123");
    db.insert(sqliteSchema.users)
      .values({
        id: adminId,
        organizationId: org.id,
        username: "test-admin",
        passwordHash: hash,
        name: "Test Admin",
        role: "Admin",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      })
      .run();

    superAdminToken = signJWT({
      actorId: superAdmin.id,
      role: superAdmin.role,
      organizationId: superAdmin.organizationId,
    });
    adminToken = signJWT({
      actorId: adminId,
      role: "Admin",
      organizationId: org.id,
    });
    teacherToken = signJWT({
      actorId: teacher.id,
      role: teacher.role,
      organizationId: teacher.organizationId,
    });
    candidateToken = signJWT({
      actorId: candidate.id,
      role: candidate.role,
      organizationId: candidate.organizationId,
    });

    app = Fastify();
    setupSecurity(app);
    setupErrorHandler(app);
    await app.register(fastifyCookie);
    await app.register(createDbPlugin(db));
    await app.register(authPlugin);
    await app.register(tenantPlugin);
    await app.register(rateLimitPlugin);
    await app.register(settingsRoutes, { prefix: "/api" });
    await app.register(organizationRoutes, { prefix: "/api" });
    await app.register(examRoutes, { prefix: "/api" });
    await app.register(userRoutes, { prefix: "/api" });
    await app.register(candidateRoutes, { prefix: "/api" });
    await app.register(systemRoutes, { prefix: "/api" });

    app.get("/api/health", async () => ({ status: "ok" }));

    app.get("/api/auth/me", { preHandler: [app.authenticate] }, (request) => {
      return { ctx: request.ctx };
    });

    await app.ready();
  });

  describe("AC1: Candidate cannot create exams", () => {
    it("Candidate calling POST /api/exams returns 403", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/exams",
        payload: {
          title: "Cheater Exam",
          courseId: randomUUID(),
          durationMinutes: 60,
          openAt: new Date().toISOString(),
          closeAt: new Date(Date.now() + 86400000).toISOString(),
          passingScore: 60,
          totalScore: 100,
          questionIds: [],
        },
        cookies: { "auth-token": candidateToken },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("AC2: Teacher cannot manage organizations", () => {
    it("Teacher calling POST /api/organizations returns 403", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/organizations",
        payload: {
          name: "Rogue Org",
          displayName: "Rogue",
          slug: "rogue",
        },
        cookies: { "auth-token": teacherToken },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("AC3: Teacher cannot delete users", () => {
    it("Teacher calling DELETE /api/users/:id returns 403", async () => {
      const res = await app.inject({
        method: "DELETE",
        url: `/api/users/${randomUUID()}`,
        cookies: { "auth-token": teacherToken },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("AC4: Admin cannot create organizations", () => {
    it("Admin calling POST /api/organizations returns 403", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/organizations",
        payload: {
          name: "Admin Org",
          displayName: "Admin",
          slug: "admin-org",
        },
        cookies: { "auth-token": adminToken },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("AC5: Candidate cannot list candidates", () => {
    it("Candidate calling GET /api/candidates returns 403", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/candidates",
        cookies: { "auth-token": candidateToken },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("AC6: Candidate cannot access system health", () => {
    it("Candidate calling GET /api/system/health returns 403", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/system/health",
        cookies: { "auth-token": candidateToken },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe("AC7: ctx.permissions is populated", () => {
    it("authenticated user has non-empty permissions", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/auth/me",
        cookies: { "auth-token": adminToken },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      const permissions = body.ctx.permissions as Permission[];
      expect(permissions.length).toBeGreaterThan(0);
    });
  });

  describe("AC8: Proctor permissions exist in rbac mapping", () => {
    it("Proctor role has proctor-specific permissions", () => {
      const proctorPermissions = getPermissionsForRole("Proctor");
      expect(proctorPermissions).toContain("VIEW_EXAM_ROOM");
      expect(proctorPermissions).toContain("EXTEND_TIME");
      expect(proctorPermissions).toContain("MARK_MISCONDUCT");
      expect(proctorPermissions).toContain("FORCE_SUBMIT");
    });
  });
});
