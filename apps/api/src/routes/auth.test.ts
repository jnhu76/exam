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
  rebuildAppOnSameDb,
  type UnsupportedRole,
} from "./testHelpers.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { eq } from "drizzle-orm";
import { hashPassword } from "@exam/auth/src/password.js";
import { signJWT, verifyJWT } from "@exam/auth/src/session.js";
import { createHmac } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import userRoutes from "./user.js";
import { getRuntimeConfig } from "../config/runtimeConfig.js";

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
      authEpoch: 0,
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
    // #325: a valid-token logout is now a durable revocation, so this smoke
    // test deliberately sends NO cookie — a captured-token logout is covered
    // by the dedicated #325 regressions below (using isolated users, so the
    // shared ctx.adminToken never has its epoch consumed here).
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/logout",
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
    // #325: the password change advanced the credential epoch, so the
    // pre-change ctx.adminToken is revoked. Subsequent tests in this
    // describe keep using ctx.adminToken — refresh it from the fresh login.
    const refreshedToken = extractCookieValue(
      loginRes.headers["set-cookie"]?.toString() ?? "",
      "auth-token",
    );
    if (refreshedToken) {
      ctx.adminToken = refreshedToken;
    }
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

/**
 * #325 — auth epoch revocation regressions (R1-R7).
 *
 * The authority model: users.auth_epoch is the durable per-user credential
 * generation; JWTs carry the epoch they were issued under; authentication
 * accepts a token only while the claim matches. Logout CAS-advances the
 * epoch (all-tab / all-device revocation); password changes/resets advance
 * it atomically with the credential write.
 */
describe("auth epoch revocation (#325)", () => {
  async function createCandidateForEpochTest(
    testCtx: Awaited<ReturnType<typeof buildTestApp>>,
    usernamePrefix: string,
  ): Promise<{ username: string; userId: string }> {
    const now = new Date();
    const userId = crypto.randomUUID();
    const username = `epoch-${usernamePrefix}-${crypto.randomUUID().slice(0, 8)}`;
    await testCtx.db.insert(schema.users).values({
      id: userId,
      organizationId: testCtx.org.id,
      username,
      passwordHash: await hashPassword("password123"),
      name: "Epoch Test Candidate",
      role: "Candidate",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    await testCtx.db.insert(schema.userRoleAssignments).values({
      id: crypto.randomUUID(),
      organizationId: testCtx.org.id,
      userId,
      role: "Candidate",
      isPrimary: true,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    return { username, userId };
  }

  async function loginAndGetToken(
    app: Awaited<ReturnType<typeof buildTestApp>>["app"],
    username: string,
    password = "password123",
  ): Promise<{ status: number; token?: string }> {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username, password },
    });
    if (res.statusCode !== 200) return { status: res.statusCode };
    const cookie = extractCookieValue(
      res.headers["set-cookie"]?.toString() ?? "",
      "auth-token",
    );
    return cookie
      ? { status: res.statusCode, token: cookie }
      : { status: res.statusCode };
  }

  it("R1: logout revokes the captured JWT — replay hits 401", async () => {
    const r1Ctx = await buildTestApp(authRoutes, { prefix: "/api/auth" });
    try {
      const { username } = await createCandidateForEpochTest(r1Ctx, "r1");
      const login = await loginAndGetToken(r1Ctx.app, username);
      expect(login.status).toBe(200);
      expect(login.token).toBeTruthy();

      // Token works before logout.
      const before = await r1Ctx.app.inject({
        method: "GET",
        url: "/api/auth/me",
        cookies: { "auth-token": login.token! },
      });
      expect(before.statusCode).toBe(200);

      // Logout with the captured cookie.
      const out = await r1Ctx.app.inject({
        method: "POST",
        url: "/api/auth/logout",
        cookies: { "auth-token": login.token! },
      });
      expect(out.statusCode).toBe(204);

      // Replay the captured JWT → revoked.
      const after = await r1Ctx.app.inject({
        method: "GET",
        url: "/api/auth/me",
        cookies: { "auth-token": login.token! },
      });
      expect(after.statusCode).toBe(401);
      expect(after.json()).toMatchObject({ error: { code: "AUTH_REQUIRED" } });
    } finally {
      await r1Ctx.cleanup();
    }
  });

  it("R2: epoch revocation is durable across an app rebuild on the same DB", async () => {
    const r2Ctx = await buildTestApp(authRoutes, { prefix: "/api/auth" });
    try {
      const { username } = await createCandidateForEpochTest(r2Ctx, "r2");
      const login = await loginAndGetToken(r2Ctx.app, username);
      expect(login.token).toBeTruthy();

      // Durable revocation through the first instance.
      const out = await r2Ctx.app.inject({
        method: "POST",
        url: "/api/auth/logout",
        cookies: { "auth-token": login.token! },
      });
      expect(out.statusCode).toBe(204);

      // Rebuild a second Fastify instance against the SAME database.
      const rebuilt = await rebuildAppOnSameDb(r2Ctx, authRoutes, {
        prefix: "/api/auth",
      });
      try {
        const replay = await rebuilt.inject({
          method: "GET",
          url: "/api/auth/me",
          cookies: { "auth-token": login.token! },
        });
        expect(replay.statusCode).toBe(401);
      } finally {
        await rebuilt.close();
      }
    } finally {
      await r2Ctx.cleanup();
    }
  });

  it("R3: stale-token logout cannot revoke a newer epoch (CAS invariant)", async () => {
    const r3Ctx = await buildTestApp(authRoutes, { prefix: "/api/auth" });
    try {
      const { username } = await createCandidateForEpochTest(r3Ctx, "r3");

      // Epoch-0 session A.
      const loginA = await loginAndGetToken(r3Ctx.app, username);
      expect(loginA.token).toBeTruthy();

      // Legitimate logout advances the authority 0 -> 1.
      const firstOut = await r3Ctx.app.inject({
        method: "POST",
        url: "/api/auth/logout",
        cookies: { "auth-token": loginA.token! },
      });
      expect(firstOut.statusCode).toBe(204);

      // Fresh login issues an epoch-1 token B.
      const loginB = await loginAndGetToken(r3Ctx.app, username);
      expect(loginB.token).toBeTruthy();
      expect(loginB.token).not.toBe(loginA.token);
      const meB = await r3Ctx.app.inject({
        method: "GET",
        url: "/api/auth/me",
        cookies: { "auth-token": loginB.token! },
      });
      expect(meB.statusCode).toBe(200);

      // Attacker replays STALE epoch-0 token A against /logout.
      const staleOut = await r3Ctx.app.inject({
        method: "POST",
        url: "/api/auth/logout",
        cookies: { "auth-token": loginA.token! },
      });
      expect(staleOut.statusCode).toBe(204);

      // The CAS must NOT have advanced the epoch: DB stays at 1 and
      // the new session B still authenticates.
      const rows = await r3Ctx.db
        .select({ authEpoch: schema.users.authEpoch })
        .from(schema.users)
        .where(eq(schema.users.username, username));
      expect(rows[0]!.authEpoch).toBe(1);
      const meBAfter = await r3Ctx.app.inject({
        method: "GET",
        url: "/api/auth/me",
        cookies: { "auth-token": loginB.token! },
      });
      expect(meBAfter.statusCode).toBe(200);
    } finally {
      await r3Ctx.cleanup();
    }
  });

  it("R4: logout invalidates every tab sharing the current epoch", async () => {
    const r4Ctx = await buildTestApp(authRoutes, { prefix: "/api/auth" });
    try {
      const { username, userId } = await createCandidateForEpochTest(
        r4Ctx,
        "r4",
      );
      const loginA = await loginAndGetToken(r4Ctx.app, username);
      expect(loginA.token).toBeTruthy();

      // Tab B: a DIFFERENT JWT minted under the same current epoch.
      const userRows = await r4Ctx.db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, userId));
      const tabBToken = signJWT({
        actorId: userId,
        role: "Candidate",
        organizationId: r4Ctx.org.id,
        authEpoch: userRows[0]!.authEpoch,
      });

      // Tab A logs out → epoch advances → tab B dies too (documented
      // all-tab/all-device semantics for v0.x).
      const out = await r4Ctx.app.inject({
        method: "POST",
        url: "/api/auth/logout",
        cookies: { "auth-token": loginA.token! },
      });
      expect(out.statusCode).toBe(204);

      const meB = await r4Ctx.app.inject({
        method: "GET",
        url: "/api/auth/me",
        cookies: { "auth-token": tabBToken },
      });
      expect(meB.statusCode).toBe(401);
      const meA = await r4Ctx.app.inject({
        method: "GET",
        url: "/api/auth/me",
        cookies: { "auth-token": loginA.token! },
      });
      expect(meA.statusCode).toBe(401);
    } finally {
      await r4Ctx.cleanup();
    }
  });

  it("R5: self-service password change revokes old token; new credentials log in", async () => {
    const r5Ctx = await buildTestApp(authRoutes, { prefix: "/api/auth" });
    try {
      const { username } = await createCandidateForEpochTest(r5Ctx, "r5");
      const oldLogin = await loginAndGetToken(r5Ctx.app, username);
      expect(oldLogin.token).toBeTruthy();

      const changeRes = await r5Ctx.app.inject({
        method: "PATCH",
        url: "/api/auth/me/password",
        payload: {
          currentPassword: "password123",
          newPassword: "rotated12345",
        },
        cookies: { "auth-token": oldLogin.token! },
      });
      expect(changeRes.statusCode).toBe(200);

      // Old credential is dead for the next protected request.
      const replay = await r5Ctx.app.inject({
        method: "GET",
        url: "/api/auth/me",
        cookies: { "auth-token": oldLogin.token! },
      });
      expect(replay.statusCode).toBe(401);

      // New credentials work.
      const relogin = await loginAndGetToken(
        r5Ctx.app,
        username,
        "rotated12345",
      );
      expect(relogin.status).toBe(200);
      const meNew = await r5Ctx.app.inject({
        method: "GET",
        url: "/api/auth/me",
        cookies: { "auth-token": relogin.token! },
      });
      expect(meNew.statusCode).toBe(200);
    } finally {
      await r5Ctx.cleanup();
    }
  });

  it("R6: admin candidate password reset revokes the candidate's live token", async () => {
    // buildTestApp mounts this composite under /api; authRoutes needs its
    // own /auth segment to reproduce production paths (/api/auth/...,
    // /api/users/...).
    const bothRoutes: FastifyPluginAsync = async (app) => {
      await app.register(userRoutes);
      await app.register(authRoutes, { prefix: "/auth" });
    };
    const r6Ctx = await buildTestApp(bothRoutes);
    try {
      const { username, userId } = await createCandidateForEpochTest(
        r6Ctx,
        "r6",
      );
      // Candidate profile so POST /users/:id/reset-password accepts the target.
      await r6Ctx.db.insert(schema.candidateProfiles).values({
        id: crypto.randomUUID(),
        organizationId: r6Ctx.org.id,
        userId,
        fields: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const candLogin = await loginAndGetToken(r6Ctx.app, username);
      expect(candLogin.token).toBeTruthy();

      const resetRes = await r6Ctx.app.inject({
        method: "POST",
        url: `/api/users/${userId}/reset-password`,
        payload: { newPassword: "adminreset123" },
        cookies: { "auth-token": r6Ctx.adminToken },
      });
      expect(resetRes.statusCode).toBe(200);

      // Stolen pre-reset candidate JWT is revoked.
      const replay = await r6Ctx.app.inject({
        method: "GET",
        url: "/api/auth/me",
        cookies: { "auth-token": candLogin.token! },
      });
      expect(replay.statusCode).toBe(401);

      // New password works.
      const relogin = await loginAndGetToken(
        r6Ctx.app,
        username,
        "adminreset123",
      );
      expect(relogin.status).toBe(200);
    } finally {
      await r6Ctx.cleanup();
    }
  });

  it("R7: legacy/malformed authEpoch claims fail closed at the authenticate boundary", async () => {
    const r7Ctx = await buildTestApp(authRoutes, { prefix: "/api/auth" });
    try {
      const { username, userId } = await createCandidateForEpochTest(
        r7Ctx,
        "r7",
      );
      const userRows = await r7Ctx.db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, userId));
      const orgId = userRows[0]!.organizationId;

      // Hand-sign valid HS256 tokens carrying deliberately bad authEpoch
      // claims (same secret, correct signature — only the claim is wrong).
      const secret = getRuntimeConfig().authSecret.jwtSecret;
      const encode = (value: object) =>
        Buffer.from(JSON.stringify(value)).toString("base64url");
      const sign = (claim: unknown) => {
        const head = encode({ alg: "HS256", typ: "JWT" });
        const nowSec = Math.floor(Date.now() / 1000);
        const body = encode({
          actorId: userId,
          role: "Candidate",
          organizationId: orgId,
          ...(claim !== undefined ? { authEpoch: claim } : {}),
          iat: nowSec,
          exp: nowSec + 3600,
        });
        const sig = createHmac("sha256", secret)
          .update(`${head}.${body}`)
          .digest("base64url");
        return `${head}.${body}.${sig}`;
      };

      const malformedTokens: string[] = [
        // No authEpoch claim at all (legacy pre-#325 shape).
        sign(undefined),
        // Wrong shapes: negative, non-integer, string "0", null.
        sign(-1),
        sign(1.5),
        sign("0"),
        sign(null),
      ];

      for (const bad of malformedTokens) {
        const res = await r7Ctx.app.inject({
          method: "GET",
          url: "/api/auth/me",
          cookies: { "auth-token": bad },
        });
        expect(res.statusCode).toBe(401);
      }
    } finally {
      await r7Ctx.cleanup();
    }
  });
});
