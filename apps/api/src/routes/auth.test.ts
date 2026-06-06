import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createUserRepo } from "@exam/db/src/repository/userRepo.js";
import type { RequestContext } from "@exam/domain";
import authRoutes from "./auth.js";
import { buildTestApp } from "./testHelpers.js";

describe("auth routes", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;

  beforeAll(async () => {
    ctx = await buildTestApp(authRoutes, { prefix: "/api/auth" });
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it("POST /api/auth/login authenticates within the requested tenant", async () => {
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        organizationSlug: "default",
        username: "admin",
        password: "admin123",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().organizationId).toBe(ctx.org.id);
  });

  it("POST /api/auth/login rejects disabled users", async () => {
    const adminCtx: RequestContext = {
      actorId: ctx.admin.id,
      organizationId: ctx.org.id,
      targetOrganizationId: ctx.org.id,
      role: "SuperAdmin",
      permissions: [],
      sessionId: "test",
    };
    createUserRepo(ctx.db).update(adminCtx, ctx.teacher.id, {
      isActive: false,
    });

    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        organizationSlug: "default",
        username: "teacher",
        password: "teacher123",
      },
    });

    expect(response.statusCode).toBe(401);
  });

  it("GET /api/auth/me rejects an existing session after user disable", async () => {
    const response = await ctx.app.inject({
      method: "GET",
      url: "/api/auth/me",
      cookies: { "auth-token": ctx.teacherToken },
    });

    expect(response.statusCode).toBe(401);
  });

  it("POST /api/auth/login returns 400 for malformed input", async () => {
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");
  });

  it("POST /api/auth/register is disabled without a bootstrap token", async () => {
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        organizationSlug: "default",
        bootstrapToken: "not-configured",
        username: "new-admin",
        password: "admin123",
        name: "New Admin",
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("PERMISSION_DENIED");
  });

  it("PATCH /api/auth/me/password changes password for authenticated user", async () => {
    const res = await ctx.app.inject({
      method: "PATCH",
      url: "/api/auth/me/password",
      payload: {
        currentPassword: "admin123",
        newPassword: "newpass123",
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode, `status ${res.statusCode}, body: ${res.body}`).toBe(
      200,
    );
    expect(res.json().ok).toBe(true);

    const loginRes = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        organizationSlug: "default",
        username: "admin",
        password: "newpass123",
      },
    });
    expect(loginRes.statusCode).toBe(200);
  });

  it("PATCH /api/auth/me/password rejects wrong current password", async () => {
    const res = await ctx.app.inject({
      method: "PATCH",
      url: "/api/auth/me/password",
      payload: {
        currentPassword: "wrong-password",
        newPassword: "another123",
      },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH /api/auth/me/password requires authentication", async () => {
    const res = await ctx.app.inject({
      method: "PATCH",
      url: "/api/auth/me/password",
      payload: {
        currentPassword: "admin123",
        newPassword: "newpass123",
      },
    });
    expect(res.statusCode).toBe(401);
  });
});
