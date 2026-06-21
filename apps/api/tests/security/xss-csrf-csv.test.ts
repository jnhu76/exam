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
import { setupIsolatedTestDb } from "@exam/db/src/testIsolation.js";
import { eq } from "drizzle-orm";
import { signJWT } from "@exam/auth/src/session.js";
import { seed } from "@exam/db/src/seed.js";
import { exportRoutes } from "../../src/routes/export.js";
import candidateRoutes from "../../src/routes/candidate.js";
import examRoutes from "../../src/routes/exam.js";
import courseRoutes from "../../src/routes/course.js";
import questionRoutes from "../../src/routes/question.js";
import { randomUUID } from "node:crypto";
import type { Database } from "@exam/db/src/types.js";
import type { Role } from "@exam/domain";

function createDbPlugin(db: Database) {
  return fp(async (fastify) => {
    fastify.decorate("db", db);
  });
}

describe("XSS / CSRF / CSV Security Baseline (S08-lite)", () => {
  let app: ReturnType<typeof Fastify>;
  let sql: Awaited<ReturnType<typeof createDatabase>>["sql"];
  let adminToken: string;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const TEST_DB_URL =
      process.env.TEST_DATABASE_URL ??
      "postgresql://exam:exam@localhost:5432/exam_test";
    const iso = await setupIsolatedTestDb({
      namespace: "security-xss",
      databaseUrl: TEST_DB_URL,
    });
    cleanup = iso.cleanup;
    const conn = await createDatabase(TEST_DB_URL, iso.schemaName);
    await migratePostgres(conn.db, { migrationsSchema: iso.schemaName });
    const db = conn.db;
    sql = conn.sql;

    const seedResult = await seed(db, hashPassword);
    const admin = (
      await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, seedResult.users.adminId))
    )[0]!;

    adminToken = signJWT({
      actorId: admin.id,
      role: admin.role as Role,
      organizationId: admin.organizationId,
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
    await app.register(courseRoutes, { prefix: "/api" });
    await app.register(questionRoutes, { prefix: "/api" });
    await app.register(candidateRoutes, { prefix: "/api" });
    await app.register(exportRoutes, { prefix: "/api" });

    app.get("/api/_test/ping", async () => ({ ok: true }));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await sql.end();
    await cleanup();
  });

  describe("AC1: Security headers are present on responses", () => {
    it("sets X-Content-Type-Options: nosniff", async () => {
      const res = await app.inject({ method: "GET", url: "/api/_test/ping" });
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
    });

    it("sets X-Frame-Options: DENY", async () => {
      const res = await app.inject({ method: "GET", url: "/api/_test/ping" });
      expect(res.headers["x-frame-options"]).toBe("DENY");
    });

    it("sets Content-Security-Policy header", async () => {
      const res = await app.inject({ method: "GET", url: "/api/_test/ping" });
      expect(res.headers["content-security-policy"]).toContain("default-src");
    });

    it("sets X-XSS-Protection: 0 (disabled, superseded by CSP)", async () => {
      const res = await app.inject({ method: "GET", url: "/api/_test/ping" });
      expect(res.headers["x-xss-protection"]).toBe("0");
    });

    it("sets Referrer-Policy", async () => {
      const res = await app.inject({ method: "GET", url: "/api/_test/ping" });
      expect(res.headers["referrer-policy"]).toBe(
        "strict-origin-when-cross-origin",
      );
    });
  });

  describe("AC2: XSS payload in candidate name is safe in JSON response", () => {
    it("returns JSON content-type (not text/html) for responses with script tags in data", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/candidates",
        payload: {
          username: `xsstest-${randomUUID().slice(0, 8)}`,
          password: "password123",
          name: "<script>alert(1)</script>",
          fields: {},
        },
        cookies: { "auth-token": adminToken },
      });
      expect([201, 400]).toContain(res.statusCode);
      if (res.statusCode === 201) {
        expect(res.headers["content-type"]).toContain("application/json");
      }
    });
  });

  describe("AC3: CSV export endpoint requires authentication", () => {
    it("returns 401 without auth cookie", async () => {
      const res = await app.inject({
        method: "GET",
        url: `/api/exams/${randomUUID()}/export/scores`,
      });
      expect(res.statusCode).toBe(401);
    });
  });
});
