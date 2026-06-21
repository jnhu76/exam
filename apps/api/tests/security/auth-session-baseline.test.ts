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
import { TEST_DB_URL } from "@exam/db/src/testDb.js";
import { eq } from "drizzle-orm";
import { signJWT, verifyJWT } from "@exam/auth/src/session.js";
import { seed } from "@exam/db/src/seed.js";
import authRoutes from "../../src/routes/auth.js";
import type { Database } from "@exam/db/src/types.js";
import type { Role } from "@exam/domain";

function createDbPlugin(db: Database) {
  return fp(async (fastify) => {
    fastify.decorate("db", db);
  });
}

describe("Auth & Session Security Baseline (S08-lite)", () => {
  let app: ReturnType<typeof Fastify>;
  let sql: Awaited<ReturnType<typeof createDatabase>>["sql"];
  let adminToken: string;
  let adminUsername: string;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const iso = await setupIsolatedTestDb({
      namespace: "security-auth",
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
    adminUsername = admin.username;

    app = Fastify();
    setupSecurity(app);
    setupErrorHandler(app);
    await app.register(zodProviderPlugin);
    await app.register(fastifyCookie);
    await app.register(createDbPlugin(db));
    await app.register(authPlugin);
    await app.register(tenantPlugin);
    await app.register(rateLimitPlugin);
    await app.register(authRoutes, { prefix: "/api/auth" });

    app.get(
      "/api/_test/protected",
      {
        preHandler: [app.authenticate],
      },
      async (request) => ({ actorId: request.ctx?.actorId }),
    );
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await sql.end();
    await cleanup();
  });

  describe("AC1: JWT verification rejects tampered tokens", () => {
    it("rejects a token with a corrupted signature", async () => {
      const parts = adminToken.split(".");
      const corruptedSig = parts[2]!.slice(0, -4) + "AAAA";
      const tamperedToken = `${parts[0]}.${parts[1]}.${corruptedSig}`;
      const res = await app.inject({
        method: "GET",
        url: "/api/_test/protected",
        cookies: { "auth-token": tamperedToken },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe("AUTH_REQUIRED");
    });

    it("rejects a token with completely invalid structure", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/_test/protected",
        cookies: { "auth-token": "tampered.token.here" },
      });
      expect(res.statusCode).toBe(401);
    });

    it("rejects a garbage string token", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/_test/protected",
        cookies: { "auth-token": "not-a-jwt" },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe("AC2: Login cookie has security attributes", () => {
    it("sets httpOnly and sameSite=strict on auth-token cookie", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          username: adminUsername,
          password: "admin123",
        },
      });
      expect(res.statusCode).toBe(200);
      const setCookie = res.headers["set-cookie"];
      expect(setCookie).toBeDefined();
      const cookieStr = Array.isArray(setCookie) ? setCookie[0]! : setCookie!;
      expect(cookieStr).toContain("HttpOnly");
      expect(cookieStr).toContain("SameSite=Strict");
    });
  });

  describe("AC3: verifyJWT throws on invalid input", () => {
    it("throws for empty string", () => {
      expect(() => verifyJWT("")).toThrow();
    });

    it("throws for unsigned payload", () => {
      const unsigned = Buffer.from(
        JSON.stringify({ actorId: "x", role: "Admin", organizationId: "y" }),
      ).toString("base64url");
      expect(() => verifyJWT(`${unsigned}.${unsigned}.`)).toThrow();
    });
  });
});
