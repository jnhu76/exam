import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createUserRepo } from "@exam/db/src/repository/userRepo.js";
import type { RequestContext } from "@exam/domain";
import { signJWT } from "@exam/auth/src/session.js";
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
        username: ctx.admin.username,
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

describe("session version invalidation", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;

  beforeAll(async () => {
    ctx = await buildTestApp(authRoutes, { prefix: "/api/auth" });
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it("login returns a token with sessionVersion", async () => {
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
    const cookieHeader = response.headers["set-cookie"];
    expect(cookieHeader).toBeDefined();
  });

  it("logout invalidates the old token via sessionVersion", async () => {
    const loginRes = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        organizationSlug: "default",
        username: "admin",
        password: "admin123",
      },
    });
    expect(loginRes.statusCode).toBe(200);

    const cookies = loginRes.cookies;
    const authToken = cookies.find(
      (c: { name: string }) => c.name === "auth-token",
    )!;
    expect(authToken).toBeDefined();

    const meBeforeLogout = await ctx.app.inject({
      method: "GET",
      url: "/api/auth/me",
      cookies: { "auth-token": authToken.value },
    });
    expect(meBeforeLogout.statusCode).toBe(200);

    await ctx.app.inject({
      method: "POST",
      url: "/api/auth/logout",
      cookies: { "auth-token": authToken.value },
    });

    const meAfterLogout = await ctx.app.inject({
      method: "GET",
      url: "/api/auth/me",
      cookies: { "auth-token": authToken.value },
    });
    expect(meAfterLogout.statusCode).toBe(401);
  });

  it("password change invalidates the old token via sessionVersion", async () => {
    const loginRes = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        organizationSlug: "default",
        username: "admin",
        password: "admin123",
      },
    });
    expect(loginRes.statusCode).toBe(200);

    const cookies = loginRes.cookies;
    const authToken = cookies.find(
      (c: { name: string }) => c.name === "auth-token",
    )!;
    expect(authToken).toBeDefined();

    const changeRes = await ctx.app.inject({
      method: "PATCH",
      url: "/api/auth/me/password",
      payload: {
        currentPassword: "admin123",
        newPassword: "newadmin456",
      },
      cookies: { "auth-token": authToken.value },
    });
    expect(changeRes.statusCode).toBe(200);

    const meAfterChange = await ctx.app.inject({
      method: "GET",
      url: "/api/auth/me",
      cookies: { "auth-token": authToken.value },
    });
    expect(meAfterChange.statusCode).toBe(401);

    const reloginRes = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        organizationSlug: "default",
        username: "admin",
        password: "newadmin456",
      },
    });
    expect(reloginRes.statusCode).toBe(200);
  });
});

describe("timing-safe login", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;

  beforeAll(async () => {
    ctx = await buildTestApp(authRoutes, { prefix: "/api/auth" });
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it("returns same error shape for wrong username and wrong password", async () => {
    const wrongUsernameRes = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        organizationSlug: "default",
        username: "nonexistent-user",
        password: "admin123",
      },
    });

    const wrongPasswordRes = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        organizationSlug: "default",
        username: "admin",
        password: "wrong-password",
      },
    });

    expect(wrongUsernameRes.statusCode).toBe(401);
    expect(wrongPasswordRes.statusCode).toBe(401);

    const wrongUsernameBody = wrongUsernameRes.json();
    const wrongPasswordBody = wrongPasswordRes.json();
    expect(wrongUsernameBody.message).toBe("Invalid username or password");
    expect(wrongUsernameBody.code).toBe("INVALID_CREDENTIALS");
    expect(wrongPasswordBody.message).toBe("Invalid username or password");
    expect(wrongPasswordBody.code).toBe("INVALID_CREDENTIALS");
  });

  it("executes dummy password verify when user not found", async () => {
    const verifyModule = await import("@exam/auth/src/password.js");
    const verifySpy = vi.spyOn(verifyModule, "verifyPassword");

    await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        organizationSlug: "default",
        username: "nonexistent-user",
        password: "admin123",
      },
    });

    expect(verifySpy).toHaveBeenCalled();
    verifySpy.mockRestore();
  });
});

describe("cookie configuration", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;

  beforeAll(async () => {
    ctx = await buildTestApp(authRoutes, { prefix: "/api/auth" });
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it("sets secure flag on cookie when COOKIE_SECURE=true", async () => {
    const originalValue = process.env.COOKIE_SECURE;
    process.env.COOKIE_SECURE = "true";

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
    const cookieHeader = response.headers["set-cookie"];
    expect(cookieHeader).toBeDefined();
    expect(cookieHeader).toContain("Secure");

    process.env.COOKIE_SECURE = originalValue;
  });

  it("does not set secure flag when COOKIE_SECURE is not set", async () => {
    const originalValue = process.env.COOKIE_SECURE;
    delete process.env.COOKIE_SECURE;

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
    const cookieHeader = response.headers["set-cookie"];
    expect(cookieHeader).toBeDefined();
    expect(cookieHeader).not.toContain("Secure");

    process.env.COOKIE_SECURE = originalValue;
  });
});
