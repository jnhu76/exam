import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fp from "fastify-plugin";
import authPlugin from "../../src/plugins/auth.js";
import tenantPlugin from "../../src/plugins/tenant.js";
import rateLimitPlugin from "../../src/plugins/rateLimit.js";
import { setupErrorHandler } from "../../src/plugins/errors.js";
import zodProviderPlugin from "../../src/plugins/zodProvider.js";
import setupSecurity from "../../src/plugins/security.js";
import { hashPassword } from "@exam/auth/src/password.js";
import { createDatabase } from "@exam/db/src/database.js";
import { migratePostgres } from "@exam/db/src/postgres.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { eq } from "drizzle-orm";
import { signJWT } from "@exam/auth/src/session.js";
import { seed } from "@exam/db/src/seed.js";
import examRoutes from "../../src/routes/exam.js";
import userRoutes from "../../src/routes/user.js";
import candidateRoutes from "../../src/routes/candidate.js";
import systemRoutes from "../../src/routes/system.js";
import settingsRoutes from "../../src/routes/settings.js";
import { randomUUID } from "node:crypto";
import type { Database } from "@exam/db/src/types.js";
import type { Permission, Role } from "@exam/domain";

function createDbPlugin(db: Database) {
  return fp(async (fastify) => {
    fastify.decorate("db", db);
  });
}

describe("RBAC Permission Matrix (S02)", () => {
  let db: Database;
  let sql: Awaited<ReturnType<typeof createDatabase>>["sql"];
  let org: { id: string };
  let adminId: string;
  let adminToken: string;
  let candidateToken: string;
  let app: ReturnType<typeof Fastify>;

  beforeAll(async () => {
    const conn = await createDatabase(
      process.env.TEST_DATABASE_URL ??
        "postgresql://exam:exam@localhost:5432/exam_test",
    );
    await migratePostgres(conn.db);
    db = conn.db;
    sql = conn.sql;

    const seedResult = await seed(db, hashPassword);

    const orgs = await db
      .select()
      .from(schema.organizations)
      .where(eq(schema.organizations.id, seedResult.orgId));
    org = orgs[0]!;

    const candidate = (
      await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, seedResult.users.candidateId))
    )[0]!;

    const now = new Date();
    adminId = randomUUID();
    const hash = await hashPassword("admin123");
    await db.insert(schema.users).values({
      id: adminId,
      organizationId: org.id,
      username: `test-admin-${adminId.slice(0, 8)}`,
      passwordHash: hash,
      name: "Test Admin",
      role: "Admin",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    adminToken = signJWT({
      actorId: adminId,
      role: "Admin" as Role,
      organizationId: org.id,
    });
    candidateToken = signJWT({
      actorId: candidate.id,
      role: candidate.role as Role,
      organizationId: candidate.organizationId,
    });

    app = Fastify();
    setupSecurity(app);
    setupErrorHandler(app);
    await app.register(zodProviderPlugin);
    await app.register(fastifyCookie);
    await app.register(createDbPlugin(db));
    await app.register(authPlugin);
    await app.register(tenantPlugin);
    await app.register(rateLimitPlugin);
    await app.register(settingsRoutes, { prefix: "/api" });
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

  afterAll(async () => {
    await app.close();
    await sql.end();
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

  describe("AC4: organizations API removed in Phase 1", () => {
    it("POST /api/organizations is not registered (404)", async () => {
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
      expect(res.statusCode).toBe(404);
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
});
