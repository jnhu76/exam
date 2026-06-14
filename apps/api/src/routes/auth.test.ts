import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createUserRepo } from "@exam/db/src/repository/userRepo.js";
import type { RequestContext } from "@exam/domain";
import authRoutes from "./auth.js";
import { resetRuntimeConfigForTest } from "../config/runtimeConfig.js";
import { buildTestApp } from "./testHelpers.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { eq } from "drizzle-orm";
import { hashPassword } from "@exam/auth/src/password.js";
import { signJWT } from "@exam/auth/src/session.js";

describe("auth routes", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;

  beforeAll(async () => {
    ctx = await buildTestApp(authRoutes, { prefix: "/api/auth" });
  });

  afterAll(async () => {
    await ctx.db
      .update(schema.users)
      .set({ passwordHash: await hashPassword("admin123") })
      .where(eq(schema.users.id, ctx.admin.id));
    await ctx.cleanup();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetRuntimeConfigForTest();
  });

  it("POST /api/auth/login authenticates admin in default organization", async () => {
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        username: ctx.admin.username,
        password: "admin123",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().organizationId).toBe(ctx.org.id);
  });

  it("POST /api/auth/login sets Secure cookie when COOKIE_SECURE=true", async () => {
    vi.stubEnv("COOKIE_SECURE", "true");
    resetRuntimeConfigForTest();
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        username: ctx.admin.username,
        password: "admin123",
      },
    });
    expect(response.statusCode).toBe(200);
    const setCookie = response.headers["set-cookie"];
    const cookieStr = Array.isArray(setCookie)
      ? setCookie.join(";")
      : setCookie;
    expect(cookieStr).toMatch(/Secure/);
  });

  it("POST /api/auth/login omits Secure flag outside production when COOKIE_SECURE!=true", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("COOKIE_SECURE", "false");
    resetRuntimeConfigForTest();
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        username: ctx.admin.username,
        password: "admin123",
      },
    });
    expect(response.statusCode).toBe(200);
    const setCookie = response.headers["set-cookie"];
    const cookieStr = Array.isArray(setCookie)
      ? setCookie.join(";")
      : setCookie;
    expect(cookieStr).not.toMatch(/Secure/);
  });

  it("POST /api/auth/login sets Secure cookie in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_MODE", "production");
    vi.stubEnv("JWT_SECRET", "test-production-secret");
    vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost:5432/test");
    vi.stubEnv("CORS_ORIGIN", "https://example.com");
    vi.stubEnv("COOKIE_SECURE", "false");
    resetRuntimeConfigForTest();
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        username: ctx.admin.username,
        password: "admin123",
      },
    });
    expect(response.statusCode).toBe(200);
    const setCookie = response.headers["set-cookie"];
    const cookieStr = Array.isArray(setCookie)
      ? setCookie.join(";")
      : setCookie;
    expect(cookieStr).toMatch(/Secure/);
  });

  it("POST /api/auth/login rejects disabled users", async () => {
    const disableUsername = `to-disable-${Date.now()}`;
    const disableUserId = crypto.randomUUID();
    const hash = await hashPassword("disable123");
    await ctx.db.insert(schema.users).values({
      id: disableUserId,
      organizationId: ctx.org.id,
      username: disableUsername,
      passwordHash: hash,
      name: "To Disable",
      role: "Admin",
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const adminCtx: RequestContext = {
      actorId: ctx.admin.id,
      organizationId: ctx.org.id,
      targetOrganizationId: ctx.org.id,
      role: "Admin",
      permissions: [],
      sessionId: "test",
    };
    await createUserRepo(ctx.db).update(adminCtx, disableUserId, {
      isActive: false,
    });

    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        username: disableUsername,
        password: "disable123",
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: {
        code: "AUTH_INVALID_CREDENTIALS",
        message: "用户名或密码错误",
        requestId: expect.any(String),
      },
    });

    const disableToken = signJWT({
      actorId: disableUserId,
      role: "Admin",
      organizationId: ctx.org.id,
    });
    const meRes = await ctx.app.inject({
      method: "GET",
      url: "/api/auth/me",
      cookies: { "auth-token": disableToken },
    });
    expect(meRes.statusCode).toBe(401);
    expect(meRes.json()).toMatchObject({
      error: {
        code: "AUTH_REQUIRED",
        message: "请先登录",
        requestId: expect.any(String),
      },
    });
  });

  it("POST /api/auth/login does not reveal unknown users or wrong passwords", async () => {
    const attempts = [
      {
        username: "unknown-user",
        password: "admin123",
      },
      {
        username: ctx.admin.username,
        password: "wrong-password",
      },
    ];

    for (const payload of attempts) {
      const response = await ctx.app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload,
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({
        error: {
          code: "AUTH_INVALID_CREDENTIALS",
          message: "用户名或密码错误",
          requestId: expect.any(String),
        },
      });
    }
  });

  it("POST /api/auth/login returns validation details for malformed input", async () => {
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        message: "请求参数无效",
        details: {
          fields: expect.arrayContaining([
            expect.objectContaining({
              field: "username",
              code: "INVALID_TYPE",
            }),
          ]),
        },
        requestId: expect.any(String),
      },
    });
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
    expect(response.json()).toMatchObject({
      error: {
        code: "PERMISSION_DENIED",
        message: "无权执行此操作",
        requestId: expect.any(String),
      },
    });
  });

  it("POST /api/auth/logout returns 204 without a response body", async () => {
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/logout",
      cookies: { "auth-token": ctx.adminToken },
    });

    expect(response.statusCode).toBe(204);
    expect(response.body).toBe("");
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
    expect(res.json()).toMatchObject({
      error: {
        code: "CURRENT_PASSWORD_INVALID",
        message: "当前密码不正确",
        requestId: expect.any(String),
      },
    });
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
    expect(res.json()).toMatchObject({
      error: {
        code: "AUTH_REQUIRED",
        message: "请先登录",
        requestId: expect.any(String),
      },
    });
  });
});
