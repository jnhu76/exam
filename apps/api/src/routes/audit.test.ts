import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
import { hashPassword } from "@exam/auth/src/password.js";
import { signJWT } from "@exam/auth/src/session.js";
import authRoutes from "./auth.js";
import auditRoutes from "./audit.js";
import { buildTestApp } from "./testHelpers.js";
import { schema } from "@exam/db/src/schema/pg.js";

const combinedPlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(authRoutes, { prefix: "/auth" });
  await fastify.register(auditRoutes);
};

describe("audit log baseline (S06-lite)", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let orgId: string;
  let orgSlug: string;
  let adminId: string;
  let adminUsername: string;
  let adminToken: string;
  let candidateToken: string;

  beforeAll(async () => {
    ctx = await buildTestApp(combinedPlugin, { prefix: "/api" });
    orgId = crypto.randomUUID();
    orgSlug = `audit-test-${orgId.slice(0, 8)}`;
    const now = new Date();
    await ctx.db.insert(schema.organizations).values({
      id: orgId,
      name: "Audit Test Org",
      displayName: "Audit Test Org",
      slug: orgSlug,
      createdAt: now,
      updatedAt: now,
    });

    adminId = crypto.randomUUID();
    adminUsername = `audit-admin-${orgId.slice(0, 8)}`;
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

    const candidateId = crypto.randomUUID();
    await ctx.db.insert(schema.users).values({
      id: candidateId,
      organizationId: orgId,
      username: `audit-candidate-${orgId.slice(0, 8)}`,
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
  });

  afterAll(async () => {
    await ctx.db
      .delete(schema.auditLogs)
      .where(eq(schema.auditLogs.organizationId, orgId));
    await ctx.db
      .delete(schema.users)
      .where(eq(schema.users.organizationId, orgId));
    await ctx.db
      .delete(schema.organizations)
      .where(eq(schema.organizations.id, orgId));
    await ctx.cleanup();
  });

  async function clearAudits() {
    await ctx.db
      .delete(schema.auditLogs)
      .where(eq(schema.auditLogs.organizationId, orgId));
  }

  async function readAudits() {
    return ctx.db
      .select()
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.organizationId, orgId));
  }

  async function waitForAudit(predicate?: () => Promise<boolean>) {
    const timeoutMs = predicate ? 2000 : 800;
    const deadline = Date.now() + timeoutMs;
    const check = predicate ?? (async () => (await readAudits()).length > 0);
    while (Date.now() < deadline) {
      if (await check()) return;
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  describe("login.success audit", () => {
    it("emits login.success on successful login", async () => {
      await clearAudits();

      const response = await ctx.app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          organizationSlug: orgSlug,
          username: adminUsername,
          password: "audit-pass-1",
        },
      });
      expect(response.statusCode).toBe(200);

      await waitForAudit();
      const rows = await ctx.db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.organizationId, orgId));
      const successRows = rows.filter((r) => r.action === "login.success");
      expect(successRows).toHaveLength(1);
      expect(successRows[0]!.actorId).toBe(adminId);
      expect(successRows[0]!.targetType).toBe("user");
      expect(successRows[0]!.targetId).toBe(adminId);
      expect(successRows[0]!.metadata).toMatchObject({
        username: adminUsername,
      });
    });
  });

  describe("login.failure audit", () => {
    it("emits login.failure when password is wrong", async () => {
      await clearAudits();

      const response = await ctx.app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          organizationSlug: orgSlug,
          username: adminUsername,
          password: "wrong-password",
        },
      });
      expect(response.statusCode).toBe(401);

      await waitForAudit();
      const rows = await ctx.db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.organizationId, orgId));
      const failures = rows.filter((r) => r.action === "login.failure");
      expect(failures).toHaveLength(1);
      expect(failures[0]!.targetType).toBe("login");
      expect(failures[0]!.metadata).toMatchObject({
        username: adminUsername,
        organizationSlug: orgSlug,
        reason: "invalid_credentials",
      });
    });

    it("emits login.failure when user is unknown", async () => {
      await clearAudits();

      const response = await ctx.app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          organizationSlug: orgSlug,
          username: "nobody-here",
          password: "whatever",
        },
      });
      expect(response.statusCode).toBe(401);

      await waitForAudit();
      const rows = await ctx.db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.organizationId, orgId));
      const failures = rows.filter((r) => r.action === "login.failure");
      expect(failures).toHaveLength(1);
      expect(failures[0]!.metadata).toMatchObject({
        username: "nobody-here",
        organizationSlug: orgSlug,
        reason: "invalid_credentials",
      });
    });

    it("does NOT emit audit when organization is unknown (no org context)", async () => {
      await clearAudits();

      const response = await ctx.app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          organizationSlug: "unknown-tenant",
          username: adminUsername,
          password: "audit-pass-1",
        },
      });
      expect(response.statusCode).toBe(401);

      await waitForAudit();
      const rows = await ctx.db.select().from(schema.auditLogs);
      const failures = rows.filter(
        (r) => r.action === "login.failure" && r.organizationId === orgId,
      );
      expect(failures).toHaveLength(0);
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
      const rows = await ctx.db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.organizationId, orgId));
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
      const rows = await ctx.db
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.organizationId, orgId));
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
            organizationSlug: orgSlug,
            username: adminUsername,
            password: "audit-pass-1",
          },
        });
      }
      await waitForAudit(async () => (await readAudits()).length >= 3);

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
            organizationSlug: orgSlug,
            username: adminUsername,
            password: "audit-pass-1",
          },
        });
      }
      await ctx.app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          organizationSlug: orgSlug,
          username: adminUsername,
          password: "nope",
        },
      });
      await waitForAudit(async () => (await readAudits()).length >= 3);

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
      expect(body.items.length).toBe(2);
    });

    it("respects pageSize parameter", async () => {
      await clearAudits();
      const { recordAudit } = await import("./audit.js");
      const fakeReq = {
        id: "t",
        ip: "127.0.0.1",
        headers: { "user-agent": "vitest" },
      } as unknown as Parameters<typeof recordAudit>[1];
      for (let i = 0; i < 5; i += 1) {
        recordAudit(
          ctx.app as unknown as Parameters<typeof recordAudit>[0],
          fakeReq,
          {
            actorId: adminId,
            organizationId: orgId,
            role: "Admin",
            permissions: [],
            sessionId: "test",
          },
          "login.success",
          "user",
          adminId,
        );
      }
      await waitForAudit(async () => (await readAudits()).length >= 5);

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
    it("recordAudit captures actorOrganizationId in metadata when ctx acts cross-org", async () => {
      const { recordAudit } = await import("./audit.js");

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
      } as unknown as Parameters<typeof recordAudit>[1];

      try {
        recordAudit(
          ctx.app as unknown as Parameters<typeof recordAudit>[0],
          fakeRequest,
          {
            actorId: adminId,
            organizationId: orgId,
            targetOrganizationId: otherOrgId,
            role: "SuperAdmin",
            permissions: [],
            sessionId: "test",
          },
          "exam.publish",
          "exam",
          targetId,
          { foo: "bar" },
        );

        await waitForAudit(async () => (await readAudits()).length >= 3);

        const rows = await ctx.db
          .select()
          .from(schema.auditLogs)
          .where(eq(schema.auditLogs.targetId, targetId));
        expect(rows.length).toBe(1);
        expect(rows[0]!.organizationId).toBe(otherOrgId);
        expect(rows[0]!.metadata).toMatchObject({
          foo: "bar",
          actorOrganizationId: orgId,
        });
        expect(rows[0]!.metadata).not.toHaveProperty("targetOrganizationId");
      } finally {
        await ctx.db
          .delete(schema.auditLogs)
          .where(eq(schema.auditLogs.organizationId, otherOrgId));
        await ctx.db
          .delete(schema.organizations)
          .where(eq(schema.organizations.id, otherOrgId));
      }
    });

    it("recordAudit does NOT add actorOrganizationId when ctx targets its own org", async () => {
      const { recordAudit } = await import("./audit.js");

      await clearAudits();
      const targetId2 = crypto.randomUUID();

      const fakeRequest = {
        id: "test-req-id-2",
        ip: "127.0.0.1",
        headers: { "user-agent": "vitest" },
      } as unknown as Parameters<typeof recordAudit>[1];

      recordAudit(
        ctx.app as unknown as Parameters<typeof recordAudit>[0],
        fakeRequest,
        {
          actorId: adminId,
          organizationId: orgId,
          targetOrganizationId: orgId,
          role: "Admin",
          permissions: [],
          sessionId: "test",
        },
        "course.create",
        "course",
        targetId2,
        { courseCode: "X" },
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
  });
});
