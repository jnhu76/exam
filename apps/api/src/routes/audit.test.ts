import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import { hashPassword } from "@exam/auth/src/password.js";
import { signJWT } from "@exam/auth/src/session.js";
import authRoutes from "./auth.js";
import auditRoutes from "./audit.js";
import { buildTestApp } from "./testHelpers.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { cleanupOrganizationTestData } from "@exam/db/src/testCleanup.js";
import { executeInTransaction } from "@exam/db/src/types.js";
import type { RequestContext } from "@exam/domain";
import {
  recordAtomicHttpAudit,
  recordSensitiveReadAudit,
} from "../audit/auditWriter.js";
import type { AuditActionForDurability } from "../audit/auditPolicy.js";

const combinedPlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(authRoutes, { prefix: "/auth" });
  await fastify.register(auditRoutes);
};

describe("audit log baseline (S06-lite)", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let orgId: string;
  let adminId: string;
  let adminUsername: string;
  let adminToken: string;
  let candidateToken: string;
  let candidateId: string;

  beforeAll(async () => {
    ctx = await buildTestApp(combinedPlugin, { prefix: "/api" });
    orgId = ctx.org.id;
    const now = new Date();

    adminId = crypto.randomUUID();
    adminUsername = `audit-admin-${adminId.slice(0, 8)}`;
    await ctx.db.insert(schema.users).values({
      id: adminId,
      organizationId: orgId,
      username: adminUsername,
      passwordHash: await hashPassword("audit-pass-1"),
      name: "Audit Test Admin",
      role: "Admin",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    adminToken = signJWT({
      actorId: adminId,
      role: "Admin",
      organizationId: orgId,
    });

    candidateId = crypto.randomUUID();
    await ctx.db.insert(schema.users).values({
      id: candidateId,
      organizationId: orgId,
      username: `audit-candidate-${candidateId.slice(0, 8)}`,
      passwordHash: await hashPassword("audit-pass-2"),
      name: "Audit Test Candidate",
      role: "Candidate",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    candidateToken = signJWT({
      actorId: candidateId,
      role: "Candidate",
      organizationId: orgId,
    });

    // RBAC-M10-E: every authenticated request resolves authority from ACTIVE
    // user_role_assignments. Seed one active primary assignment per test user
    // so authenticate grants the role's preset (audit endpoints are gated by
    // capability). Without these rows both users collapse to 401 AUTH_REQUIRED.
    await ctx.db.insert(schema.userRoleAssignments).values([
      {
        id: crypto.randomUUID(),
        organizationId: orgId,
        userId: adminId,
        role: "Admin" as never,
        isPrimary: true,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: crypto.randomUUID(),
        organizationId: orgId,
        userId: candidateId,
        role: "Candidate" as never,
        isPrimary: true,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      },
    ]);
  });

  afterAll(async () => {
    await ctx.db
      .delete(schema.auditLogs)
      .where(eq(schema.auditLogs.actorId, adminId));
    await ctx.db
      .delete(schema.auditLogs)
      .where(eq(schema.auditLogs.actorId, candidateId));
    await ctx.db.delete(schema.users).where(eq(schema.users.id, adminId));
    await ctx.db.delete(schema.users).where(eq(schema.users.id, candidateId));
    await ctx.cleanup();
  });

  async function clearAudits() {
    await ctx.db
      .delete(schema.auditLogs)
      .where(eq(schema.auditLogs.actorId, adminId));
    await ctx.db
      .delete(schema.auditLogs)
      .where(eq(schema.auditLogs.targetId, adminId));
    await ctx.db
      .delete(schema.auditLogs)
      .where(eq(schema.auditLogs.targetId, adminUsername));
  }

  async function readAuditsForActor(actorId: string) {
    return ctx.db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.actorId, actorId));
  }

  async function readAuditsForTarget(targetId: string) {
    return ctx.db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.targetId, targetId));
  }

  async function waitForAudit(predicate?: () => Promise<boolean>) {
    await ctx.drainAuditWrites();
    if (predicate) expect(await predicate()).toBe(true);
  }

  async function writeTransactionalAudit(
    request: FastifyRequest,
    requestContext: RequestContext,
    action: AuditActionForDurability<"atomic">,
    targetType: string,
    targetId: string,
    metadata?: Record<string, unknown>,
  ) {
    await executeInTransaction(ctx.db, (tx) =>
      recordAtomicHttpAudit(tx, request, requestContext, {
        action,
        targetType,
        targetId,
        ...(metadata ? { metadata } : {}),
      }),
    );
  }

  describe("login.success audit", () => {
    it("emits login.success on successful login", async () => {
      await clearAudits();

      const response = await ctx.app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          username: adminUsername,
          password: "audit-pass-1",
        },
      });
      expect(response.statusCode).toBe(200);

      await waitForAudit();
      const rows = await readAuditsForActor(adminId);
      const successRows = rows.filter((r) => r.action === "login.success");
      expect(successRows).toHaveLength(1);
      expect(successRows[0]!.actorId).toBe(adminId);
      expect(successRows[0]!.targetType).toBe("user");
      expect(successRows[0]!.targetId).toBe(adminId);
      expect(successRows[0]!.metadata).toHaveProperty("requestId");
      expect(successRows[0]!.metadata).not.toHaveProperty("username");
    });
  });

  describe("login.failure audit", () => {
    it("emits login.failure when password is wrong", async () => {
      await clearAudits();

      const response = await ctx.app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          username: adminUsername,
          password: "wrong-password",
        },
      });
      expect(response.statusCode).toBe(401);

      await waitForAudit(
        async () => (await readAuditsForTarget(adminId)).length >= 1,
      );
      const rows = await readAuditsForTarget(adminId);
      const failures = rows.filter((r) => r.action === "login.failure");
      expect(failures).toHaveLength(1);
      expect(failures[0]!.targetType).toBe("login");
      expect(failures[0]!.metadata).toMatchObject({
        reason: "invalid_password",
      });
      expect(failures[0]!.metadata).not.toHaveProperty("username");
    });

    it("emits login.failure when user is unknown", async () => {
      const marker = `nobody-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      await ctx.db
        .delete(schema.auditLogs)
        .where(eq(schema.auditLogs.targetId, "anonymous"));

      const response = await ctx.app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          username: marker,
          password: "whatever",
        },
      });
      expect(response.statusCode).toBe(401);

      await waitForAudit(
        async () => (await readAuditsForTarget("anonymous")).length > 0,
      );
      const rows = await readAuditsForTarget("anonymous");
      const failures = rows.filter((r) => r.action === "login.failure");
      expect(failures).toHaveLength(1);
      expect(failures[0]!.metadata).toMatchObject({ reason: "unknown_user" });
      expect(failures[0]!.metadata).not.toHaveProperty("username");
    });
  });

  describe("logout audit", () => {
    it("emits logout audit when authenticated user logs out", async () => {
      await clearAudits();

      const response = await ctx.app.inject({
        method: "POST",
        url: "/api/auth/logout",
        cookies: { "auth-token": adminToken },
      });
      expect(response.statusCode).toBe(204);

      await waitForAudit();
      const rows = await readAuditsForActor(adminId);
      const logouts = rows.filter((r) => r.action === "logout");
      expect(logouts).toHaveLength(1);
      expect(logouts[0]!.actorId).toBe(adminId);
      expect(logouts[0]!.targetType).toBe("user");
      expect(logouts[0]!.targetId).toBe(adminId);
    });

    it("does NOT emit logout audit when called without authentication", async () => {
      await clearAudits();

      const response = await ctx.app.inject({
        method: "POST",
        url: "/api/auth/logout",
      });
      expect(response.statusCode).toBe(204);

      await waitForAudit();
      const rows = await readAuditsForActor(adminId);
      const logouts = rows.filter((r) => r.action === "logout");
      expect(logouts).toHaveLength(0);
    });
  });

  describe("GET /api/admin/audit-logs", () => {
    it("requires authentication", async () => {
      const response = await ctx.app.inject({
        method: "GET",
        url: "/api/admin/audit-logs",
      });
      expect(response.statusCode).toBe(401);
    });

    it("rejects Candidate role with 403", async () => {
      const response = await ctx.app.inject({
        method: "GET",
        url: "/api/admin/audit-logs",
        cookies: { "auth-token": candidateToken },
      });
      expect(response.statusCode).toBe(403);
    });

    it("returns paginated audit logs for Admin", async () => {
      await clearAudits();
      for (let i = 0; i < 3; i += 1) {
        await ctx.app.inject({
          method: "POST",
          url: "/api/auth/login",
          payload: {
            username: adminUsername,
            password: "audit-pass-1",
          },
        });
      }
      await waitForAudit();

      const response = await ctx.app.inject({
        method: "GET",
        url: "/api/admin/audit-logs",
        cookies: { "auth-token": adminToken },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toMatchObject({
        page: 1,
        pageSize: 20,
        total: expect.any(Number),
        totalPages: expect.any(Number),
        items: expect.any(Array),
      });
      expect(body.items.length).toBeGreaterThanOrEqual(3);
      const ours = body.items.filter(
        (i: { actorId: string }) => i.actorId === adminId,
      );
      expect(ours.length).toBeGreaterThanOrEqual(3);
      expect(body.items[0]).toMatchObject({
        id: expect.any(String),
        organizationId: orgId,
        actorId: expect.any(String),
        action: expect.any(String),
        targetType: expect.any(String),
        targetId: expect.any(String),
        metadata: expect.any(Object),
        createdAt: expect.any(String),
      });
    });

    it("filters by action query param", async () => {
      await clearAudits();
      for (let i = 0; i < 2; i += 1) {
        await ctx.app.inject({
          method: "POST",
          url: "/api/auth/login",
          payload: {
            username: adminUsername,
            password: "audit-pass-1",
          },
        });
      }
      await ctx.app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          username: adminUsername,
          password: "nope",
        },
      });
      await waitForAudit();

      const response = await ctx.app.inject({
        method: "GET",
        url: "/api/admin/audit-logs?action=login.success",
        cookies: { "auth-token": adminToken },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(
        body.items.every(
          (item: { action: string }) => item.action === "login.success",
        ),
      ).toBe(true);
      const ours = body.items.filter(
        (i: { actorId: string }) => i.actorId === adminId,
      );
      expect(ours.length).toBe(2);
    });

    it("filters by targetType query param", async () => {
      await clearAudits();
      const fakeReq = {
        id: "t",
        ip: "127.0.0.1",
        headers: { "user-agent": "vitest" },
      } as unknown as FastifyRequest;
      const examTarget = crypto.randomUUID();
      const userTarget = crypto.randomUUID();
      await writeTransactionalAudit(
        fakeReq,
        {
          actorId: adminId,
          organizationId: orgId,
          role: "Admin",
          permissions: [],
          sessionId: "test",
        },
        "exam.publish",
        "exam",
        examTarget,
      );
      await writeTransactionalAudit(
        fakeReq,
        {
          actorId: adminId,
          organizationId: orgId,
          role: "Admin",
          permissions: [],
          sessionId: "test",
        },
        "user.create",
        "user",
        userTarget,
      );
      await waitForAudit(
        async () => (await readAuditsForTarget(examTarget)).length >= 1,
      );
      await waitForAudit(
        async () => (await readAuditsForTarget(userTarget)).length >= 1,
      );

      const response = await ctx.app.inject({
        method: "GET",
        url: "/api/admin/audit-logs?targetType=exam",
        cookies: { "auth-token": adminToken },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(
        body.items.every(
          (item: { targetType: string }) => item.targetType === "exam",
        ),
      ).toBe(true);
      expect(
        body.items.some((i: { targetId: string }) => i.targetId === examTarget),
      ).toBe(true);
      expect(
        body.items.some((i: { targetId: string }) => i.targetId === userTarget),
      ).toBe(false);
    });

    it("filters by inclusive date range (from / to)", async () => {
      await clearAudits();
      const t0 = "2026-01-01T00:00:00.000Z";
      const t1 = "2026-02-01T00:00:00.000Z";
      const t2 = "2026-03-01T00:00:00.000Z";
      const t3 = "2026-04-01T00:00:00.000Z";
      const markers: Record<string, string> = {};
      for (const [tag, ts] of Object.entries({ t0, t1, t2, t3 })) {
        const targetId = `range-${tag}-${crypto.randomUUID()}`;
        markers[tag] = targetId;
        await ctx.db.insert(schema.auditLogs).values({
          id: crypto.randomUUID(),
          organizationId: orgId,
          actorId: adminId,
          action: `range.${tag}`,
          targetType: "range_test",
          targetId,
          metadata: { requestId: "t" },
          createdAt: new Date(ts),
        });
      }

      // Filter by targetType=range_test so these queries only see the 4
      // rows this test created — not residual audit rows from other test
      // files sharing the worker database (default pageSize=20 would
      // paginate the range markers out otherwise).
      // from = t1: excludes t0.
      const fromRes = await ctx.app.inject({
        method: "GET",
        url: `/api/admin/audit-logs?targetType=range_test&from=${encodeURIComponent(t1)}`,
        cookies: { "auth-token": adminToken },
      });
      expect(fromRes.statusCode).toBe(200);
      const fromBody = fromRes.json();
      expect(
        fromBody.items.some(
          (i: { targetId: string }) => i.targetId === markers.t0,
        ),
      ).toBe(false);
      expect(
        fromBody.items.some(
          (i: { targetId: string }) => i.targetId === markers.t1,
        ),
      ).toBe(true);

      // to = t2: excludes t3.
      const toRes = await ctx.app.inject({
        method: "GET",
        url: `/api/admin/audit-logs?targetType=range_test&to=${encodeURIComponent(t2)}`,
        cookies: { "auth-token": adminToken },
      });
      expect(toRes.statusCode).toBe(200);
      const toBody = toRes.json();
      expect(
        toBody.items.some(
          (i: { targetId: string }) => i.targetId === markers.t2,
        ),
      ).toBe(true);
      expect(
        toBody.items.some(
          (i: { targetId: string }) => i.targetId === markers.t3,
        ),
      ).toBe(false);

      // from=t1, to=t2: only t1 and t2.
      const bothRes = await ctx.app.inject({
        method: "GET",
        url: `/api/admin/audit-logs?targetType=range_test&from=${encodeURIComponent(t1)}&to=${encodeURIComponent(t2)}`,
        cookies: { "auth-token": adminToken },
      });
      expect(bothRes.statusCode).toBe(200);
      const bothBody = bothRes.json();
      expect(
        bothBody.items.some(
          (i: { targetId: string }) => i.targetId === markers.t1,
        ),
      ).toBe(true);
      expect(
        bothBody.items.some(
          (i: { targetId: string }) => i.targetId === markers.t2,
        ),
      ).toBe(true);
      expect(
        bothBody.items.some(
          (i: { targetId: string }) => i.targetId === markers.t0,
        ),
      ).toBe(false);
      expect(
        bothBody.items.some(
          (i: { targetId: string }) => i.targetId === markers.t3,
        ),
      ).toBe(false);
    });

    it("respects pageSize parameter", async () => {
      await clearAudits();
      const fakeReq = {
        id: "t",
        ip: "127.0.0.1",
        headers: { "user-agent": "vitest" },
      } as unknown as FastifyRequest;
      for (let i = 0; i < 5; i += 1) {
        await recordSensitiveReadAudit(
          ctx.db,
          fakeReq,
          {
            actorId: adminId,
            organizationId: orgId,
            role: "Admin",
            permissions: [],
            sessionId: "test",
          },
          {
            action: "attempt.exported",
            targetType: "attempt",
            targetId: adminId,
            metadata: { format: "csv" },
          },
        );
      }
      await waitForAudit(
        async () => (await readAuditsForTarget(adminId)).length >= 5,
      );

      const response = await ctx.app.inject({
        method: "GET",
        url: "/api/admin/audit-logs?pageSize=2&page=1",
        cookies: { "auth-token": adminToken },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.pageSize).toBe(2);
      expect(body.items.length).toBe(2);
      expect(body.total).toBeGreaterThanOrEqual(5);
    });
  });

  describe("SuperAdmin cross-org metadata", () => {
    it("transactional audit captures actorOrganizationId when ctx acts cross-org", async () => {
      await clearAudits();
      const otherOrgId = crypto.randomUUID();
      const otherSlug = `audit-other-${otherOrgId.slice(0, 8)}`;
      const nowTs = new Date();
      await ctx.db.insert(schema.organizations).values({
        id: otherOrgId,
        name: "Audit Other Org",
        displayName: "Audit Other Org",
        slug: otherSlug,
        createdAt: nowTs,
        updatedAt: nowTs,
      });
      const targetId = crypto.randomUUID();

      const fakeRequest = {
        id: "test-req-id",
        ip: "127.0.0.1",
        headers: { "user-agent": "vitest" },
      } as unknown as FastifyRequest;

      try {
        await writeTransactionalAudit(
          fakeRequest,
          {
            actorId: adminId,
            organizationId: orgId,
            targetOrganizationId: otherOrgId,
            role: "Admin",
            permissions: [],
            sessionId: "test",
          },
          "user.role_changed",
          "exam",
          targetId,
          { oldRole: "Admin", newRole: "Candidate" },
        );

        await waitForAudit(
          async () => (await readAuditsForTarget(targetId)).length >= 1,
        );

        const rows = await ctx.db
          .select()
          .from(schema.auditLogs)
          .where(eq(schema.auditLogs.targetId, targetId));
        expect(rows.length).toBe(1);
        expect(rows[0]!.organizationId).toBe(orgId);
        expect(rows[0]!.metadata).toMatchObject({
          oldRole: "Admin",
          newRole: "Candidate",
          actorOrganizationId: orgId,
        });
        expect(rows[0]!.metadata).not.toHaveProperty("targetOrganizationId");
      } finally {
        await ctx.db
          .delete(schema.auditLogs)
          .where(eq(schema.auditLogs.targetId, targetId));
        await cleanupOrganizationTestData(ctx.db, otherOrgId);
      }
    });

    it("transactional audit omits actorOrganizationId for the actor org", async () => {
      await clearAudits();
      const targetId2 = crypto.randomUUID();

      const fakeRequest = {
        id: "test-req-id-2",
        ip: "127.0.0.1",
        headers: { "user-agent": "vitest" },
      } as unknown as FastifyRequest;

      await writeTransactionalAudit(
        fakeRequest,
        {
          actorId: adminId,
          organizationId: orgId,
          targetOrganizationId: orgId,
          role: "Admin",
          permissions: [],
          sessionId: "test",
        },
        "exam.publish",
        "course",
        targetId2,
      );

      await waitForAudit();
      const rows = await ctx.db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.targetId, targetId2));
      expect(rows.length).toBe(1);
      expect(rows[0]!.metadata).not.toHaveProperty("actorOrganizationId");
      expect(rows[0]!.metadata).not.toHaveProperty("targetOrganizationId");
    });

    it("transactional audit includes requestId from request.id", async () => {
      await clearAudits();
      const targetId3 = crypto.randomUUID();
      const testRequestId = crypto.randomUUID();

      const fakeRequest = {
        id: testRequestId,
        ip: "127.0.0.1",
        headers: { "user-agent": "vitest" },
      } as unknown as FastifyRequest;

      await writeTransactionalAudit(
        fakeRequest,
        {
          actorId: adminId,
          organizationId: orgId,
          targetOrganizationId: orgId,
          role: "Admin",
          permissions: [],
          sessionId: "test",
        },
        "exam.publish",
        "exam",
        targetId3,
      );

      await waitForAudit(async () => {
        const rows = await ctx.db
          .select()
          .from(schema.auditLogs)
          .where(eq(schema.auditLogs.targetId, targetId3));
        return rows.length > 0;
      });

      const rows = await ctx.db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.targetId, targetId3));
      expect(rows.length).toBe(1);
      expect(rows[0]!.metadata).toHaveProperty("requestId");
      expect(rows[0]!.metadata.requestId).toBe(testRequestId);
    });
  });
});
