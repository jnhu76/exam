import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fp from "fastify-plugin";
import authPlugin from "../../src/plugins/auth.js";
import rateLimitPlugin from "../../src/plugins/rateLimit.js";
import { setupErrorHandler } from "../../src/plugins/errors.js";
import zodProviderPlugin from "../../src/plugins/zodProvider.js";
import setupSecurity from "../../src/plugins/security.js";
import auditLifecyclePlugin from "../../src/plugins/auditLifecycle.js";
import { hashPassword } from "@exam/auth/password";
import { createDatabase } from "@exam/db/database";
import { migratePostgres } from "@exam/db/postgres";
import { schema } from "@exam/db/schema/pg";
import { setupApiTestDatabaseFromEnv } from "../../src/routes/testDatabase.js";
import { resolveTestDbUrl } from "@exam/db/testDb";
import { eq } from "drizzle-orm";
import { signJWT, verifyJWT } from "@exam/auth/session";
import { seed } from "@exam/db/seed";
import authRoutes from "../../src/routes/auth.js";
import type { Database } from "@exam/db/types";
import type { Role } from "@exam/domain";
import { getRuntimeConfig } from "../../src/config/runtimeConfig.js";

function createDbPlugin(db: Database) {
  return fp(async (fastify) => {
    fastify.decorate("db", db);
  });
}

describe("Auth & Session Security Baseline (S08-lite)", () => {
  let app: ReturnType<typeof Fastify>;
  let sql: Awaited<ReturnType<typeof createDatabase>>["sql"];
  let adminToken: string;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const testDb = await setupApiTestDatabaseFromEnv({
      namespace: "security-auth",
      databaseUrl: resolveTestDbUrl(),
    });
    await testDb.resetPostgres();
    cleanup = testDb.close;
    const conn = await createDatabase(testDb.databaseUrl, testDb.schemaName);
    await migratePostgres(
      conn.db,
      testDb.schemaName ? { migrationsSchema: testDb.schemaName } : undefined,
    );
    const db = conn.db;
    sql = conn.sql;

    const seedResult = await seed(db, hashPassword);
    const admin = (
      await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, seedResult.users.adminId))
    )[0]!;

    adminToken = signJWT(
      {
        actorId: admin.id,
        role: admin.role as Role,
        organizationId: admin.organizationId,
        authEpoch: 0,
      },
      getRuntimeConfig().authSecret.jwtSecret,
    );

    app = Fastify();
    setupSecurity(app);
    setupErrorHandler(app);
    await app.register(zodProviderPlugin);
    await app.register(fastifyCookie);
    await app.register(createDbPlugin(db));
    await app.register(auditLifecyclePlugin);
    await app.register(authPlugin);
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

  describe("JWT verification rejects tampered tokens", () => {
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

  describe("verifyJWT throws on invalid input", () => {
    it("throws for empty string", () => {
      expect(() =>
        verifyJWT("", getRuntimeConfig().authSecret.jwtSecret),
      ).toThrow();
    });

    it("throws for unsigned payload", () => {
      const unsigned = Buffer.from(
        JSON.stringify({ actorId: "x", role: "Admin", organizationId: "y" }),
      ).toString("base64url");
      expect(() =>
        verifyJWT(
          `${unsigned}.${unsigned}.`,
          getRuntimeConfig().authSecret.jwtSecret,
        ),
      ).toThrow();
    });
  });
});
