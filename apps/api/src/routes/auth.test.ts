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
import {
  buildTestApp,
  createFutureRoleUserForTest,
  createUnassignedUserForTest,
  createUnassignedAssignableUserForTest,
  createUnsupportedRoleUserForTest,
  corruptUsersRoleProjectionForTest,
  LEGACY_ROLES,
  type UnsupportedRole,
} from "./testHelpers.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { eq } from "drizzle-orm";
import { hashPassword } from "@exam/auth/src/password.js";
import { signJWT, verifyJWT } from "@exam/auth/src/session.js";

/**
 * Extracts the raw value of a named cookie from a set-cookie header string.
 * Fastify emits `auth-token=<token>; Path=/; HttpOnly; ...`; the value ends
 * at the first semicolon.
 */
function extractCookieValue(
  cookieHeader: string,
  name: string,
): string | undefined {
  const match = cookieHeader.match(new RegExp(`${name}=([^;]+)`));
  return match?.[1];
}

describe("auth routes", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;

  beforeAll(async () => {
    ctx = await buildTestApp(authRoutes, { prefix: "/api/auth" });
  });

  afterAll(async () => {
    await ctx.db
      .update(schema.users)
      .set({
        passwordHash: await hashPassword("admin123"),
        name: ctx.admin.name,
      })
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

  it("POST /api/auth/login authenticates a Teacher-role user (RBAC runtime activation)", async () => {
    // Phase 3 widening: a user whose primary role is Teacher can log in and
    // the JWT/login response carries role=Teacher. RBAC-M10-E: the user must
    // have an active primary Teacher assignment, or login fail-closes (the
    // authority resolver returns no_active_assignments -> 401).
    const username = `teacher-${crypto.randomUUID().slice(0, 8)}`;
    const userId = crypto.randomUUID();
    const now = new Date();
    await ctx.db.insert(schema.users).values({
      id: userId,
      organizationId: ctx.org.id,
      username,
      passwordHash: await hashPassword("teacher123"),
      name: "Teacher User",
      role: "Teacher",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert(schema.userRoleAssignments).values({
      id: crypto.randomUUID(),
      organizationId: ctx.org.id,
      userId,
      role: "Teacher",
      isPrimary: true,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username, password: "teacher123" },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.role).toBe("Teacher");
    expect(body.organizationId).toBe(ctx.org.id);
  });

  it("non-e2e mode enforces the route-level login limiter", async () => {
    vi.stubEnv("APP_MODE", "test");
    vi.stubEnv("RATE_LIMIT_MAX", "1000");
    vi.stubEnv("RATE_LIMIT_WINDOW_MS", "60000");
    resetRuntimeConfigForTest();

    const limitedCtx = await buildTestApp(authRoutes, {
      prefix: "/api/auth",
      rateLimit: true,
    });
    try {
      for (let i = 0; i < 10; i++) {
        const response = await limitedCtx.app.inject({
          method: "POST",
          url: "/api/auth/login",
          payload: {
            username: limitedCtx.admin.username,
            password: "admin123",
          },
        });
        expect(response.statusCode).toBe(200);
      }

      const limited = await limitedCtx.app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          username: limitedCtx.admin.username,
          password: "admin123",
        },
      });
      expect(limited.statusCode).toBe(429);
      expect(limited.json().error.code).toBe("RATE_LIMITED");
    } finally {
      await limitedCtx.cleanup();
    }
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
    vi.stubEnv("PUBLIC_WEB_ORIGIN", "https://example.com");
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
    const now = new Date();
    const hash = await hashPassword("disable123");
    await ctx.db.insert(schema.users).values({
      id: disableUserId,
      organizationId: ctx.org.id,
      username: disableUsername,
      passwordHash: hash,
      name: "To Disable",
      role: "Admin",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    // RBAC-M10-E: seed an active primary Admin assignment so the disabled-user
    // path is what's under test. Without an assignment the post-flip resolver
    // would also 401 — but for the "no assignment" reason, masking the
    // disabled-user logic this test exists to verify.
    await ctx.db.insert(schema.userRoleAssignments).values({
      id: crypto.randomUUID(),
      organizationId: ctx.org.id,
      userId: disableUserId,
      role: "Admin",
      isPrimary: true,
      isActive: true,
      createdAt: now,
      updatedAt: now,
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
    expect(response.headers["content-type"]).toMatch(/application\/json/);
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

  it("POST /api/auth/register is disabled in Phase 1 (no public self-register)", async () => {
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        organizationSlug: "default",
        bootstrapToken: "anything",
        username: "new-admin",
        password: "admin123",
        name: "New Admin",
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: {
        code: "AUTH_REGISTER_DISABLED",
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

  it("PATCH /api/auth/me/profile updates the display name for authenticated user", async () => {
    const res = await ctx.app.inject({
      method: "PATCH",
      url: "/api/auth/me/profile",
      payload: { name: "Updated Admin Name" },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode, `status ${res.statusCode}, body: ${res.body}`).toBe(
      200,
    );
    const body = res.json();
    expect(body.name).toBe("Updated Admin Name");
    expect(body.id).toBe(ctx.admin.id);
    expect(body.username).toBe(ctx.admin.username);
    expect(body.role).toBe(ctx.admin.role);
    // RBAC-M10-E closure (F-2): /me/profile must return the authoritative
    // capability union (from the authenticated ctx), NOT lose it. The
    // frontend AuthContext stores this response as the session user; a
    // missing field here would silently drop capabilities on profile update.
    expect(body.capabilities).toBeDefined();
    expect(Array.isArray(body.capabilities)).toBe(true);
    expect(body.capabilities.length).toBeGreaterThan(0);
  });

  it("GET /api/auth/me returns the authoritative capability union for the authenticated actor", async () => {
    // RBAC-M10-E closure (F-2): /me must return the same authoritative
    // capability union that /login returns, so a session restore (page
    // refresh) does not lose capabilities. The frontend previously had to
    // re-derive visibility from presetFor(user.role) on /me, hiding
    // secondary-role capabilities from multi-role actors.
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/auth/me",
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(ctx.admin.id);
    expect(body.role).toBe(ctx.admin.role);
    expect(body.capabilities).toBeDefined();
    expect(Array.isArray(body.capabilities)).toBe(true);
    // Admin preset includes UserView (sanity check the union is non-empty
    // and contains a real Admin permission).
    expect(body.capabilities).toContain("user.view");
  });

  it("GET /api/auth/me returns the full multi-role capability union, not just the primary role's preset", async () => {
    // Multi-role closure (F-3): a primary Candidate + secondary Teacher must
    // receive the UNION of both presets on /me, so the frontend can surface
    // Teacher-only capabilities (e.g. exam.view) even though primary is
    // Candidate. This is the /me-side proof of the union that E19 proves on
    // the score route; here we assert the /me surface carries it.
    const { user, token } = await createFutureRoleUserForTest(
      ctx.db,
      ctx.org.id,
      "Candidate",
      `me-multirole-${crypto.randomUUID().slice(0, 8)}`,
    );
    // Grant a secondary Teacher assignment. Teacher's preset includes
    // exam.view; Candidate's does not.
    await ctx.db.insert(schema.userRoleAssignments).values({
      id: crypto.randomUUID(),
      organizationId: ctx.org.id,
      userId: user.id,
      role: "Teacher",
      isPrimary: false,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/auth/me",
      cookies: { "auth-token": token },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.role).toBe("Candidate"); // primary projection unchanged
    // The union MUST include exam.view (from Teacher) even though the
    // primary role is Candidate. A presetFor("Candidate") fallback would
    // miss this.
    expect(body.capabilities).toContain("exam.view");
  });

  it("PATCH /api/auth/me/profile rejects empty name", async () => {
    const res = await ctx.app.inject({
      method: "PATCH",
      url: "/api/auth/me/profile",
      payload: { name: "" },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(400);
  });

  it("PATCH /api/auth/me/profile requires authentication", async () => {
    const res = await ctx.app.inject({
      method: "PATCH",
      url: "/api/auth/me/profile",
      payload: { name: "No Auth" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("POST /api/auth/login: users.role is not authority — a stale SuperAdmin projection does not widen access", async () => {
    // RBAC-M10-E: runtime authority comes from active assignments, not the
    // users.role compatibility cache. A user whose assignment is Candidate but
    // whose users.role is the unsupported SuperAdmin must log in as Candidate.
    const { user } = await corruptUsersRoleProjectionForTest(
      ctx.db,
      ctx.org.id,
      "Candidate",
      "SuperAdmin",
      `stale-superadmin-${Date.now()}`,
    );
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: user.username, password: "password123" },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.role).toBe("Candidate");
    expect(body.capabilities).toBeDefined();
    // The JWT compatibility claim signed by the login route must also be
    // Candidate, not the stale SuperAdmin projection. Verify the actual token
    // the route set on the response rather than re-minting one in the test.
    const setCookie = response.headers["set-cookie"];
    const cookieStr = Array.isArray(setCookie)
      ? setCookie.join(";")
      : setCookie;
    expect(cookieStr).toBeDefined();
    const token = extractCookieValue(cookieStr!, "auth-token");
    expect(token).toBeDefined();
    const decoded = verifyJWT(token!);
    expect(decoded.actorId).toBe(user.id);
    expect(decoded.organizationId).toBe(ctx.org.id);
    expect(decoded.role).toBe("Candidate");
    expect(decoded.role).not.toBe("SuperAdmin");
  });

  it("POST /api/auth/login rejects unsupported roles (SuperAdmin/ContentManager/ResultViewer) with generic auth failure", async () => {
    const legacyCtx = await buildTestApp(authRoutes, { prefix: "/api/auth" });
    const unsupportedRoles: UnsupportedRole[] = [
      "SuperAdmin",
      "ContentManager",
      "ResultViewer",
    ];
    try {
      for (const role of unsupportedRoles) {
        // Unsupported roles cannot hold an assignment, so the authority
        // resolver returns no_active_assignments -> 401.
        const legacy = await createUnsupportedRoleUserForTest(
          legacyCtx.db,
          legacyCtx.org.id,
          role,
          `legacy-${role.toLowerCase()}-login`,
        );
        const response = await legacyCtx.app.inject({
          method: "POST",
          url: "/api/auth/login",
          payload: {
            username: legacy.user.username,
            password: "password123",
          },
        });
        expect(response.statusCode, `role=${role}`).toBe(401);
        const body = response.json();
        expect(body).toMatchObject({
          error: {
            code: "AUTH_INVALID_CREDENTIALS",
            message: "用户名或密码错误",
            requestId: expect.any(String),
          },
        });
        expect(JSON.stringify(body)).not.toContain(role);
        expect(JSON.stringify(body)).not.toContain("no_active_assignments");
      }
    } finally {
      await legacyCtx.cleanup();
    }
  });

  it("POST /api/auth/login rejects a user with no active assignment (assignable role, zero assignments)", async () => {
    const noAssignCtx = await buildTestApp(authRoutes, { prefix: "/api/auth" });
    try {
      const noAssign = await createUnassignedAssignableUserForTest(
        noAssignCtx.db,
        noAssignCtx.org.id,
        "Candidate",
        `no-assign-${Date.now()}`,
      );
      const response = await noAssignCtx.app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          username: noAssign.user.username,
          password: "password123",
        },
      });
      expect(response.statusCode).toBe(401);
      const body = response.json();
      expect(body).toMatchObject({
        error: {
          code: "AUTH_INVALID_CREDENTIALS",
          message: "用户名或密码错误",
          requestId: expect.any(String),
        },
      });
      expect(JSON.stringify(body)).not.toContain("no_active_assignments");

      // Existing JWT for the same identity also fails closed.
      const meRes = await noAssignCtx.app.inject({
        method: "GET",
        url: "/api/auth/me",
        cookies: { "auth-token": noAssign.token },
      });
      expect(meRes.statusCode).toBe(401);
      expect(meRes.json()).toMatchObject({
        error: { code: "AUTH_REQUIRED" },
      });
    } finally {
      await noAssignCtx.cleanup();
    }
  });
});
