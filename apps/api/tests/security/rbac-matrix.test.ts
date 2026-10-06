import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify from "fastify";
import fastifyCookie from "@fastify/cookie";
import fp from "fastify-plugin";
import authPlugin from "../../src/plugins/auth.js";
import rateLimitPlugin from "../../src/plugins/rateLimit.js";
import authzPlugin from "../../src/plugins/authz.js";
import { setupErrorHandler } from "../../src/plugins/errors.js";
import zodProviderPlugin from "../../src/plugins/zodProvider.js";
import setupSecurity from "../../src/plugins/security.js";
import auditLifecyclePlugin from "../../src/plugins/auditLifecycle.js";
import { hashPassword } from "@exam/auth/src/password.js";
import { createDatabase } from "@exam/db/src/database.js";
import { migratePostgres } from "@exam/db/src/postgres.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { setupApiTestDatabaseFromEnv } from "../../src/routes/testDatabase.js";
import { resolveTestDbUrl } from "@exam/db/src/testDb.js";
import { eq } from "drizzle-orm";
import { signJWT } from "@exam/auth/src/session.js";
import { seed } from "@exam/db/src/seed.js";
import candidateRoutes from "../../src/routes/candidate.js";
import { randomUUID } from "node:crypto";
import type { Database } from "@exam/db/src/types.js";
import type { Role } from "@exam/domain";

function createDbPlugin(db: Database) {
  return fp(async (fastify) => {
    fastify.decorate("db", db);
  });
}

describe("RBAC permission baseline", () => {
  let db: Database;
  let sql: Awaited<ReturnType<typeof createDatabase>>["sql"];
  let org: { id: string };
  let adminId: string;
  let adminToken: string;
  let candidateToken: string;
  let app: ReturnType<typeof Fastify>;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const testDb = await setupApiTestDatabaseFromEnv({
      namespace: "security-rbac",
      databaseUrl: resolveTestDbUrl(),
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
    // RBAC-M10-E: authenticate resolves authority from ACTIVE
    // user_role_assignments. The seeded admin/candidate come assignment-complete
    // via seed(); the manually-inserted admin here needs the same primary
    // assignment or it collapses to 401 AUTH_REQUIRED (no authority).
    await db.insert(schema.userRoleAssignments).values({
      id: randomUUID(),
      organizationId: org.id,
      userId: adminId,
      role: "Admin" as never,
      isPrimary: true,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    adminToken = signJWT({
      actorId: adminId,
      role: "Admin" as Role,
      organizationId: org.id,
      authEpoch: 0,
    });
    candidateToken = signJWT({
      actorId: candidate.id,
      role: candidate.role as Role,
      organizationId: candidate.organizationId,
      authEpoch: 0,
    });

    app = Fastify();
    setupSecurity(app);
    setupErrorHandler(app);
    await app.register(zodProviderPlugin);
    await app.register(fastifyCookie);
    await app.register(createDbPlugin(db));
    await app.register(auditLifecyclePlugin);
    await app.register(authPlugin);
    await app.register(rateLimitPlugin);
    await app.register(authzPlugin);
    await app.register(candidateRoutes, { prefix: "/api" });

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await sql.end();
    await cleanup();
  });

  describe("organizations API removed in Phase 1", () => {
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

  describe("Candidate cannot list candidates", () => {
    it("Candidate calling GET /api/candidates returns 403", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/candidates",
        cookies: { "auth-token": candidateToken },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe("PERMISSION_DENIED");
    });
  });
});
