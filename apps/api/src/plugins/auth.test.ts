import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import { signJWT } from "@exam/auth/src/session.js";
import { Permission, permissionsForRole, type RoleKey } from "@exam/authz";
import { buildAuthPluginFp } from "./auth.js";
import type { AssignmentAuthorityResult } from "../authz/assignmentAuthority.js";
import { resetRuntimeConfigForTest } from "../config/runtimeConfig.js";

/** The role the mocked userRepo returns; override per-test. */
let mockRole = "Admin";
vi.mock("@exam/db/src/repository/userRepo.js", () => ({
  createUserRepo: () => ({
    findByOrganizationAndId: async () => ({
      id: "user-1",
      organizationId: "org-1",
      role: mockRole,
      isActive: true,
    }),
  }),
}));

/**
 * RBAC-M10-E: the mocked userRepo returns a user with no real DB, so the
 * production assignment loader cannot run. Inject a single-role loader that
 * derives authority from `mockRole` (the role the mocked userRepo returns),
 * matching how a real single-assignment user would resolve. This tests the
 * actual DI seam in {@link buildAuthPlugin}.
 */
function mockLoadAuthority(): typeof import("../authz/assignmentAuthority.js").loadAssignmentAuthority {
  return async () => {
    const role = mockRole as RoleKey;
    const result: AssignmentAuthorityResult = {
      ok: true,
      authority: {
        primaryRole: role,
        activeRoles: [role],
        capabilities: permissionsForRole(role),
        assignmentIds: ["assignment-mock"],
      },
    };
    return result;
  };
}

async function buildAppWithAuth(): Promise<FastifyInstance> {
  resetRuntimeConfigForTest();
  const app = Fastify();
  await app.register(cookie);
  app.decorate("db", {} as never);
  await app.register(
    buildAuthPluginFp({ loadAssignmentAuthority: mockLoadAuthority() }),
  );
  app.get("/protected", { preHandler: app.authenticate }, async (req) => ({
    actorId: req.ctx?.actorId,
    role: req.ctx?.role,
  }));
  await app.ready();
  return app;
}

describe("auth plugin: P0-3 API JWT path uses runtimeConfig.authSecret.jwtSecret", () => {
  beforeEach(() => {
    vi.stubEnv("APP_MODE", "test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetRuntimeConfigForTest();
  });

  it("token signed with the runtimeConfig secret is accepted", async () => {
    vi.stubEnv("JWT_SECRET", "runtime-secret-A");
    const app = await buildAppWithAuth();

    const token = signJWT(
      { actorId: "user-1", role: "Admin", organizationId: "org-1" },
      "runtime-secret-A",
    );

    const res = await app.inject({
      method: "GET",
      url: "/protected",
      cookies: { "auth-token": token },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ actorId: "user-1", role: "Admin" });
    await app.close();
  });

  it("token signed with a different secret is rejected (proves API verify uses runtimeConfig secret)", async () => {
    vi.stubEnv("JWT_SECRET", "runtime-secret-A");
    const app = await buildAppWithAuth();

    const token = signJWT(
      { actorId: "user-1", role: "Admin", organizationId: "org-1" },
      "different-secret-B",
    );

    const res = await app.inject({
      method: "GET",
      url: "/protected",
      cookies: { "auth-token": token },
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({
      error: { code: "AUTH_REQUIRED" },
    });
    await app.close();
  });

  it("token signed using session.ts default fallback is rejected when runtimeConfig has a different secret", async () => {
    vi.stubEnv("JWT_SECRET", "runtime-secret-A");
    const app = await buildAppWithAuth();

    vi.stubEnv("JWT_SECRET", "fallback-secret-from-env");
    const token = signJWT({
      actorId: "user-1",
      role: "Admin",
      organizationId: "org-1",
    });

    const res = await app.inject({
      method: "GET",
      url: "/protected",
      cookies: { "auth-token": token },
    });

    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

describe("auth plugin: requireCapability (RBAC runtime activation, PR #3)", () => {
  beforeEach(() => {
    vi.stubEnv("APP_MODE", "test");
    vi.stubEnv("JWT_SECRET", "runtime-secret-A");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    resetRuntimeConfigForTest();
  });

  async function buildCapabilityApp(permission: string) {
    const app = Fastify();
    await app.register(cookie);
    app.decorate("db", {} as never);
    await app.register(
      buildAuthPluginFp({ loadAssignmentAuthority: mockLoadAuthority() }),
    );
    app.get(
      "/cap",
      {
        preHandler: [
          app.authenticate,
          app.requireCapability(permission as never),
        ],
      },
      async (req) => ({ role: req.ctx?.role }),
    );
    await app.ready();
    return app;
  }

  async function tokenFor(role: string) {
    return signJWT(
      { actorId: "user-1", role: role as never, organizationId: "org-1" },
      "runtime-secret-A",
    );
  }

  it("Admin (superset) passes a proctor capability check", async () => {
    mockRole = "Admin";
    const app = await buildCapabilityApp(Permission.AttemptForceSubmit);
    const res = await app.inject({
      method: "GET",
      url: "/cap",
      cookies: { "auth-token": await tokenFor("Admin") },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it("Proctor passes a proctor capability but is denied a grading capability", async () => {
    mockRole = "Proctor";
    // J4-I1B (ADR-015 §13): AttemptForceSubmit is REMOVED from the Proctor
    // preset — use the retained AttemptTimelineView as the Proctor capability.
    const proctorApp = await buildCapabilityApp(Permission.AttemptTimelineView);
    const ok = await proctorApp.inject({
      method: "GET",
      url: "/cap",
      cookies: { "auth-token": await tokenFor("Proctor") },
    });
    expect(ok.statusCode).toBe(200);
    await proctorApp.close();

    const gradingApp = await buildCapabilityApp(Permission.GradingScoreWrite);
    const denied = await gradingApp.inject({
      method: "GET",
      url: "/cap",
      cookies: { "auth-token": await tokenFor("Proctor") },
    });
    expect(denied.statusCode).toBe(403);
    await gradingApp.close();
  });

  it("Grader passes a grading capability but is denied a proctor capability", async () => {
    mockRole = "Grader";
    const gradingApp = await buildCapabilityApp(Permission.GradingScoreWrite);
    const ok = await gradingApp.inject({
      method: "GET",
      url: "/cap",
      cookies: { "auth-token": await tokenFor("Grader") },
    });
    expect(ok.statusCode).toBe(200);
    await gradingApp.close();

    const proctorApp = await buildCapabilityApp(Permission.AttemptForceSubmit);
    const denied = await proctorApp.inject({
      method: "GET",
      url: "/cap",
      cookies: { "auth-token": await tokenFor("Grader") },
    });
    expect(denied.statusCode).toBe(403);
    await proctorApp.close();
  });

  it("Candidate is denied proctor/grading/admin capabilities", async () => {
    mockRole = "Candidate";
    const app = await buildCapabilityApp(Permission.AttemptForceSubmit);
    const res = await app.inject({
      method: "GET",
      url: "/cap",
      cookies: { "auth-token": await tokenFor("Candidate") },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });

  it("Teacher is denied proctor/grading capabilities by default", async () => {
    mockRole = "Teacher";
    const app = await buildCapabilityApp(Permission.GradingScoreWrite);
    const res = await app.inject({
      method: "GET",
      url: "/cap",
      cookies: { "auth-token": await tokenFor("Teacher") },
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});

describe("auth plugin: E14 — loader failure fails closed (503 AUTHZ_UNAVAILABLE)", () => {
  beforeEach(() => {
    vi.stubEnv("APP_MODE", "test");
    vi.stubEnv("JWT_SECRET", "runtime-secret-A");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    resetRuntimeConfigForTest();
  });

  /**
   * Build an app whose assignment loader fails in a configurable way
   * (return a failed result, or throw). The protected route sets
   * `handlerReached = true` only if the handler runs — the invariant is that
   * the failing loader must prevent the handler from ever executing.
   */
  async function buildAppWithFailingLoader(
    loader: () => Promise<unknown>,
  ): Promise<FastifyInstance> {
    const app = Fastify();
    await app.register(cookie);
    app.decorate("db", {} as never);
    await app.register(
      buildAuthPluginFp({ loadAssignmentAuthority: loader as never }),
    );
    let handlerReached = false;
    app.get("/protected", { preHandler: app.authenticate }, async (req) => {
      handlerReached = true;
      return { actorId: req.ctx?.actorId };
    });
    await app.ready();
    // Attach an accessor so tests can inspect post-request state.
    Object.assign(app, { getHandlerReached: () => handlerReached });
    return app;
  }

  function validToken(): string {
    return signJWT(
      { actorId: "user-1", role: "Admin", organizationId: "org-1" },
      "runtime-secret-A",
    );
  }

  it("loader returns { ok:false, reason:'db_error' } -> 503 (handler NOT reached)", async () => {
    const app = await buildAppWithFailingLoader(async () => ({
      ok: false,
      reason: "db_error",
    }));
    const res = await app.inject({
      method: "GET",
      url: "/protected",
      cookies: { "auth-token": validToken() },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({
      error: { code: "AUTHZ_UNAVAILABLE" },
    });
    expect(
      (
        app as unknown as { getHandlerReached: () => boolean }
      ).getHandlerReached(),
    ).toBe(false);
    await app.close();
  });

  it("loader throws an exception -> 503 (handler NOT reached, never 500)", async () => {
    const app = await buildAppWithFailingLoader(async () => {
      throw new Error("boom");
    });
    const res = await app.inject({
      method: "GET",
      url: "/protected",
      cookies: { "auth-token": validToken() },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({
      error: { code: "AUTHZ_UNAVAILABLE" },
    });
    expect(
      (
        app as unknown as { getHandlerReached: () => boolean }
      ).getHandlerReached(),
    ).toBe(false);
    await app.close();
  });

  // Table-driven: every non-401 failure reason must map to 503, not 401.
  // no_active_assignments is the ONLY reason that maps to 401; everything
  // else is an operational/integrity failure -> fail closed with 503.
  it.each([
    ["multiple_primary", "multiple_primary"],
    ["zero_primary_with_active", "zero_primary_with_active"],
    ["unknown_role", "unknown_role"],
    ["subject_mismatch", "subject_mismatch"],
  ] as const)(
    "loader returns { ok:false, reason:'%s' } -> 503 (handler NOT reached)",
    async (_label, reason) => {
      const app = await buildAppWithFailingLoader(async () => ({
        ok: false,
        reason: reason as never,
      }));
      const res = await app.inject({
        method: "GET",
        url: "/protected",
        cookies: { "auth-token": validToken() },
      });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({
        error: { code: "AUTHZ_UNAVAILABLE" },
      });
      expect(
        (
          app as unknown as { getHandlerReached: () => boolean }
        ).getHandlerReached(),
      ).toBe(false);
      await app.close();
    },
  );

  // Control: the genuine "not authorized" reason still maps to 401 (this is
  // the one AUTHORITY_401_REASON, not a system failure).
  it("loader returns { ok:false, reason:'no_active_assignments' } -> 401 (control)", async () => {
    const app = await buildAppWithFailingLoader(async () => ({
      ok: false,
      reason: "no_active_assignments",
    }));
    const res = await app.inject({
      method: "GET",
      url: "/protected",
      cookies: { "auth-token": validToken() },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({
      error: { code: "AUTH_REQUIRED" },
    });
    expect(
      (
        app as unknown as { getHandlerReached: () => boolean }
      ).getHandlerReached(),
    ).toBe(false);
    await app.close();
  });
});
