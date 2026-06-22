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
import { setupApiTestDatabaseFromEnv } from "../../src/routes/testDatabase.js";
import { TEST_DB_URL } from "@exam/db/src/testDb.js";
import { eq } from "drizzle-orm";
import { signJWT } from "@exam/auth/src/session.js";
import { seed } from "@exam/db/src/seed.js";
import examRoutes from "../../src/routes/exam.js";
import userRoutes from "../../src/routes/user.js";
import candidateRoutes from "../../src/routes/candidate.js";
import auditRoutes from "../../src/routes/audit.js";
import systemRoutes from "../../src/routes/system.js";
import settingsRoutes from "../../src/routes/settings.js";
import { randomUUID } from "node:crypto";
import type { Database } from "@exam/db/src/types.js";
import type { Role } from "@exam/domain";

function createDbPlugin(db: Database) {
  return fp(async (fastify) => {
    fastify.decorate("db", db);
  });
}

describe("Unauthorized Access Baseline (S08-lite)", () => {
  let db: Database;
  let sql: Awaited<ReturnType<typeof createDatabase>>["sql"];
  let app: ReturnType<typeof Fastify>;
  let candidateToken: string;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const testDb = await setupApiTestDatabaseFromEnv({
      namespace: "security-unauth",
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

    const candidate = (
      await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, seedResult.users.candidateId))
    )[0]!;

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
    await app.register(examRoutes, { prefix: "/api" });
    await app.register(userRoutes, { prefix: "/api" });
    await app.register(candidateRoutes, { prefix: "/api" });
    await app.register(auditRoutes, { prefix: "/api" });
    await app.register(systemRoutes, { prefix: "/api" });
    await app.register(settingsRoutes, { prefix: "/api" });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await sql.end();
    await cleanup();
  });

  describe("AC1: Protected endpoints return 401 without auth cookie", () => {
    const protectedEndpoints: Array<{
      method: string;
      url: string;
      label: string;
    }> = [
      { method: "GET", url: "/api/users", label: "user list" },
      { method: "GET", url: "/api/candidates", label: "candidate list" },
      { method: "GET", url: "/api/admin/audit-logs", label: "audit logs" },
      { method: "GET", url: "/api/system/health", label: "system health" },
      { method: "GET", url: "/api/exams", label: "exam list" },
    ];

    for (const ep of protectedEndpoints) {
      it(`GET ${ep.url} (${ep.label}) returns 401 without cookie`, async () => {
        const res = await app.inject({ method: ep.method, url: ep.url });
        expect(res.statusCode).toBe(401);
        const body = res.json();
        expect(body.error.code).toBe("AUTH_REQUIRED");
      });
    }
  });

  describe("AC2: Candidate cannot access admin-only endpoints", () => {
    it("Candidate calling GET /api/users returns 403", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/users",
        cookies: { "auth-token": candidateToken },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe("PERMISSION_DENIED");
    });

    it("Candidate calling GET /api/admin/audit-logs returns 403", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/admin/audit-logs",
        cookies: { "auth-token": candidateToken },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe("PERMISSION_DENIED");
    });

    it("Candidate calling POST /api/users returns 403", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/users",
        payload: {
          username: `intruder-${randomUUID().slice(0, 8)}`,
          password: "password123",
          name: "Intruder",
          role: "Admin",
        },
        cookies: { "auth-token": candidateToken },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe("PERMISSION_DENIED");
    });
  });

  describe("AC4: Tampered JWT is rejected", () => {
    it("Invalid JWT signature returns 401", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/users",
        cookies: { "auth-token": "tampered.token.here" },
      });
      expect(res.statusCode).toBe(401);
    });
  });
});
