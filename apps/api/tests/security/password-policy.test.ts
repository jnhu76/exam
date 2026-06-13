import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fp from "fastify-plugin";
import authPlugin from "../../src/plugins/auth.js";
import tenantPlugin from "../../src/plugins/tenant.js";
import rateLimitPlugin from "../../src/plugins/rateLimit.js";
import { setupErrorHandler } from "../../src/plugins/errors.js";
import setupSecurity from "../../src/plugins/security.js";
import { hashPassword } from "@exam/auth/src/password.js";
import { createDatabase } from "@exam/db/src/database.js";
import { migratePostgres } from "@exam/db/src/postgres.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { eq } from "drizzle-orm";
import { signJWT } from "@exam/auth/src/session.js";
import { seed } from "@exam/db/src/seed.js";
import userRoutes from "../../src/routes/user.js";
import candidateRoutes from "../../src/routes/candidate.js";
import { randomUUID } from "node:crypto";
import type { Database } from "@exam/db/src/types.js";
import type { Role } from "@exam/domain";

function createDbPlugin(db: Database) {
  return fp(async (fastify) => {
    fastify.decorate("db", db);
  });
}

describe("Password Policy Baseline (S08-lite)", () => {
  let app: ReturnType<typeof Fastify>;
  let sql: Awaited<ReturnType<typeof createDatabase>>["sql"];
  let adminToken: string;

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

    adminToken = signJWT({
      actorId: admin.id,
      role: admin.role as Role,
      organizationId: admin.organizationId,
    });

    app = Fastify();
    setupSecurity(app);
    setupErrorHandler(app);
    await app.register(fastifyCookie);
    await app.register(createDbPlugin(db));
    await app.register(authPlugin);
    await app.register(tenantPlugin);
    await app.register(rateLimitPlugin);
    await app.register(userRoutes, { prefix: "/api" });
    await app.register(candidateRoutes, { prefix: "/api" });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await sql.end();
  });

  describe("AC1: POST /api/users rejects passwords shorter than 8 characters", () => {
    it("returns 400 VALIDATION_ERROR for a 7-char password", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/users",
        payload: {
          username: `pwtest-${randomUUID().slice(0, 8)}`,
          password: "1234567",
          name: "PW Test",
          role: "Teacher",
        },
        cookies: { "auth-token": adminToken },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("VALIDATION_ERROR");
    });

    it("accepts an 8-char password", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/users",
        payload: {
          username: `pwtest-${randomUUID().slice(0, 8)}`,
          password: "12345678",
          name: "PW Test OK",
          role: "Teacher",
        },
        cookies: { "auth-token": adminToken },
      });
      expect(res.statusCode).toBe(201);
    });
  });

  describe("AC2: POST /api/candidates rejects passwords shorter than 8", () => {
    it("returns 400 VALIDATION_ERROR for a 7-char password", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/candidates",
        payload: {
          username: `candpw-${randomUUID().slice(0, 8)}`,
          password: "1234567",
          name: "Cand PW",
          fields: {},
        },
        cookies: { "auth-token": adminToken },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("VALIDATION_ERROR");
    });
  });
});
