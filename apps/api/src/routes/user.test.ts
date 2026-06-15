import { describe, expect, it, beforeAll, afterAll } from "vitest";
import userRoutes from "./user.js";
import { buildTestApp, createFutureRoleUserForTest } from "./testHelpers.js";
import { hashPassword } from "@exam/auth/src/password.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { eq } from "drizzle-orm";
import type { Database } from "@exam/db/src/types.js";

async function createCandidateUser(
  db: Database,
  orgId: string,
  username: string,
) {
  const rows = await db
    .insert(schema.users)
    .values({
      id: crypto.randomUUID(),
      organizationId: orgId,
      username,
      passwordHash: await hashPassword("password123"),
      name: `Candidate ${username}`,
      role: "Candidate",
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .returning();
  return rows[0]!;
}

describe("user routes", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;

  beforeAll(async () => {
    ctx = await buildTestApp(userRoutes);
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("GET /api/users returns paginated list", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/users",
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("items");
    expect(body).toHaveProperty("total");
    expect(body).toHaveProperty("page", 1);
    expect(body.items).toBeInstanceOf(Array);
    expect(body.items.length).toBeGreaterThanOrEqual(1);
  });

  it("POST /api/users creates a user", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/users",
      payload: {
        username: `newuser-${Date.now()}`,
        password: "password123",
        name: "New User",
        role: "Admin",
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe("New User");
    expect(body.role).toBe("Admin");
    expect(body).not.toHaveProperty("passwordHash");
  });

  it("POST /api/users returns validation details", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/users",
      payload: {
        username: "x",
        password: "short",
        name: "",
        role: "Admin",
      },
      cookies: { "auth-token": ctx.adminToken },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        details: {
          fields: expect.arrayContaining([
            expect.objectContaining({ field: "username", code: "TOO_SMALL" }),
            expect.objectContaining({ field: "password", code: "TOO_SMALL" }),
            expect.objectContaining({ field: "name", code: "TOO_SMALL" }),
          ]),
        },
        requestId: expect.any(String),
      },
    });
  });

  it("POST /api/users returns a stable conflict for duplicate usernames", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/users",
      payload: {
        username: ctx.admin.username,
        password: "password123",
        name: "Duplicate User",
        role: "Admin",
      },
      cookies: { "auth-token": ctx.adminToken },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      error: {
        code: "USER_ALREADY_EXISTS",
        requestId: expect.any(String),
      },
    });
  });

  it("PATCH /api/users/:id updates a user", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/users",
      payload: {
        username: `updateuser-${Date.now()}`,
        password: "password123",
        name: "Update Me",
        role: "Admin",
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    const created = createRes.json();
    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/api/users/${created.id}`,
      payload: { name: "Updated Name" },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe("Updated Name");
  });

  it("DELETE /api/users/:id deletes a user", async () => {
    const createRes = await ctx.app.inject({
      method: "POST",
      url: "/api/users",
      payload: {
        username: `deleteuser-${Date.now()}`,
        password: "password123",
        name: "Delete Me",
        role: "Admin",
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    const created = createRes.json();
    const res = await ctx.app.inject({
      method: "DELETE",
      url: `/api/users/${created.id}`,
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(204);
    expect(res.body).toBe("");
  });

  it("PATCH /api/users/:id returns ErrorResponse v0 when missing", async () => {
    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/api/users/${crypto.randomUUID()}`,
      payload: { name: "Missing User" },
      cookies: { "auth-token": ctx.adminToken },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({
      error: {
        code: "RESOURCE_NOT_FOUND",
        requestId: expect.any(String),
      },
    });
  });

  it("POST /api/users requires Admin role", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/users",
      payload: {
        username: "forbidden",
        password: "password123",
        name: "Forbidden",
        role: "Admin",
      },
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({
      error: {
        code: "PERMISSION_DENIED",
        requestId: expect.any(String),
      },
    });
  });

  it("GET /api/users excludes legacy-role rows from items and total via repo-level filter", async () => {
    const legacyCtx = await buildTestApp(userRoutes);
    try {
      await createFutureRoleUserForTest(
        legacyCtx.db,
        legacyCtx.org.id,
        "Teacher",
        `legacy-teacher-list`,
      );
      await createFutureRoleUserForTest(
        legacyCtx.db,
        legacyCtx.org.id,
        "SuperAdmin",
        `legacy-superadmin-list`,
      );
      const res = await legacyCtx.app.inject({
        method: "GET",
        url: "/api/users?page=1&pageSize=50",
        cookies: { "auth-token": legacyCtx.adminToken },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(
        body.items.every(
          (u: { role: string }) => u.role === "Admin" || u.role === "Candidate",
        ),
      ).toBe(true);
      expect(body.total).toBeGreaterThanOrEqual(body.items.length);
      expect(body.totalPages).toBe(
        body.total === 0 ? 0 : Math.ceil(body.total / body.pageSize),
      );
    } finally {
      await legacyCtx.cleanup();
    }
  });

  it("PATCH /api/users/:id rejects self-disable with VALIDATION_ERROR + reason CANNOT_DISABLE_SELF", async () => {
    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/api/users/${ctx.admin.id}`,
      payload: { isActive: false },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        details: { reason: "CANNOT_DISABLE_SELF" },
        requestId: expect.any(String),
      },
    });
  });

  it("PATCH /api/users/:id rejects disabling the last active Admin", async () => {
    const adminCtx = await buildTestApp(userRoutes);
    try {
      const res = await adminCtx.app.inject({
        method: "PATCH",
        url: `/api/users/${adminCtx.admin.id}`,
        payload: { isActive: false },
        cookies: { "auth-token": adminCtx.adminToken },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({
        error: {
          code: "VALIDATION_ERROR",
          details: {
            reason: expect.stringMatching(
              /LAST_ACTIVE_ADMIN|CANNOT_DISABLE_SELF/,
            ),
          },
          requestId: expect.any(String),
        },
      });
    } finally {
      await adminCtx.cleanup();
    }
  });

  it("PATCH /api/users/:id allows disabling a non-last Admin when another active Admin exists", async () => {
    const second = await ctx.app.inject({
      method: "POST",
      url: "/api/users",
      payload: {
        username: `second-admin-${Date.now()}`,
        password: "password123",
        name: "Second Admin",
        role: "Admin",
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(second.statusCode).toBe(201);
    const created = second.json();
    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/api/users/${created.id}`,
      payload: { isActive: false },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: created.id, isActive: false });
  });

  describe("POST /api/users/:id/reset-password (Candidate password reset)", () => {
    it("Admin resets Candidate password successfully", async () => {
      const candidate = await createCandidateUser(
        ctx.db,
        ctx.org.id,
        `cand-reset-${Date.now()}`,
      );

      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/users/${candidate.id}/reset-password`,
        payload: { newPassword: "NewCandPass456!" },
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().ok).toBe(true);
      expect(res.body).not.toContain("NewCandPass456!");
    });

    it("Candidate cannot reset another user's password", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/users/${ctx.admin.id}/reset-password`,
        payload: { newPassword: "Hacked123!" },
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(res.statusCode).toBe(403);
    });

    it("Admin cannot reset another Admin's password via this endpoint", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/users/${ctx.admin.id}/reset-password`,
        payload: { newPassword: "NewAdminPass456!" },
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe(
        "PASSWORD_RESET_TARGET_ROLE_NOT_ALLOWED",
      );
      expect(res.json().error.details).toMatchObject({ targetRole: "Admin" });
    });

    it("reset-password writes audit log with candidate.password_reset action", async () => {
      const candidate = await createCandidateUser(
        ctx.db,
        ctx.org.id,
        `cand-audit-${Date.now()}`,
      );

      await ctx.app.inject({
        method: "POST",
        url: `/api/users/${candidate.id}/reset-password`,
        payload: { newPassword: "NewAuditPass456!" },
        cookies: { "auth-token": ctx.adminToken },
      });

      let resetAudit: typeof schema.auditLogs.$inferSelect | undefined;
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        const auditRows = await ctx.db
          .select()
          .from(schema.auditLogs)
          .where(eq(schema.auditLogs.targetId, candidate.id));
        resetAudit = auditRows.find(
          (r) => r.action === "candidate.password_reset",
        );
        if (resetAudit) break;
        await new Promise((r) => setTimeout(r, 25));
      }
      expect(resetAudit).toBeDefined();
      const metadata = resetAudit!.metadata as Record<string, unknown>;
      expect(JSON.stringify(metadata)).not.toContain("NewAuditPass456!");
      expect(JSON.stringify(metadata)).not.toContain("password");
    });

    it("reset-password requires authentication", async () => {
      const res = await ctx.app.inject({
        method: "POST",
        url: `/api/users/${ctx.candidate.id}/reset-password`,
        payload: { newPassword: "NewPass456!" },
      });
      expect(res.statusCode).toBe(401);
    });

    it("old password no longer works after reset", async () => {
      const candidate = await createCandidateUser(
        ctx.db,
        ctx.org.id,
        `cand-old-${Date.now()}`,
      );

      await ctx.app.inject({
        method: "POST",
        url: `/api/users/${candidate.id}/reset-password`,
        payload: { newPassword: "NewLoginPass456!" },
        cookies: { "auth-token": ctx.adminToken },
      });

      const { verifyPassword } = await import("@exam/auth/src/password.js");
      const updated = await ctx.db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, candidate.id));
      expect(
        await verifyPassword("NewLoginPass456!", updated[0]!.passwordHash),
      ).toBe(true);
      expect(
        await verifyPassword("password123", updated[0]!.passwordHash),
      ).toBe(false);
    });
  });
});
