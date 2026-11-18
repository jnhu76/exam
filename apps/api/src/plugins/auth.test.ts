import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Writable } from "node:stream";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import { signJWT } from "@exam/auth/session";
import { Permission, permissionsForRole, type RoleKey } from "@exam/authz";
import { buildAuthPluginFp } from "./auth.js";
import type { AssignmentAuthorityResult } from "../authz/assignmentAuthority.js";
import { resetRuntimeConfigForTest } from "../config/runtimeConfig.js";

/** The role the mocked userRepo returns; override per-test. */
let mockRole = "Admin";

/**
 * Per-test failure injection for the user-query path (#1002). When `error`
 * is set, the mocked `findByOrganizationAndId` rejects; every existing suite
 * leaves it unset, so the mock resolves a user exactly as before. Hoisted so
 * the `vi.mock` factory can read it at call time.
 */
const userQueryFailure = vi.hoisted(() => ({
  error: undefined as Error | undefined,
}));

vi.mock("@exam/db/repository/userRepo", () => ({
  createUserRepo: () => ({
    findByOrganizationAndId: async () => {
      if (userQueryFailure.error) {
        throw userQueryFailure.error;
      }
      return {
        id: "user-1",
        organizationId: "org-1",
        role: mockRole,
        isActive: true,
        // #325: authenticate compares the JWT authEpoch claim against this
        // durable authority; fixture tokens are minted with epoch 0.
        authEpoch: 0,
      };
    },
  }),
}));

/**
 * Captures pino JSON lines written by the app logger, for log-payload
 * assertions (#1002). Same capture pattern as requestIdWireContract.test.ts.
 */
class LogCapture extends Writable {
  readonly lines: string[] = [];
  override _write(
    chunk: Buffer,
    _enc: BufferEncoding,
    done: (err?: Error | null) => void,
  ) {
    this.lines.push(chunk.toString("utf8"));
    done();
  }
  /** All captured lines, parsed. */
  parsed(): Array<Record<string, unknown>> {
    return this.lines.map((l) => JSON.parse(l) as Record<string, unknown>);
  }
}

/** Typed accessor for apps built with a LogCapture stream. */
type LoggedApp = FastifyInstance & {
  getLogLines: () => Array<Record<string, unknown>>;
};

/** The requestId the client received in the error envelope. */
function envelopeRequestIdOf(res: { json: () => unknown }): string {
  const body = res.json() as { error: { requestId: string } };
  return body.error.requestId;
}

/** The log line carrying exactly `msg`; asserts presence so a missing row is a distinct failure. */
function logLineFor(
  app: FastifyInstance,
  msg: string,
): Record<string, unknown> {
  const line = (app as LoggedApp).getLogLines().find((l) => l.msg === msg);
  expect(line, `expected a captured log line "${msg}"`).toBeDefined();
  return line!;
}

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

describe("auth plugin: API JWT path uses runtimeConfig.authSecret.jwtSecret", () => {
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
      {
        actorId: "user-1",
        role: "Admin",
        organizationId: "org-1",
        authEpoch: 0,
      },
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
      {
        actorId: "user-1",
        role: "Admin",
        organizationId: "org-1",
        authEpoch: 0,
      },
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
      {
        actorId: "user-1",
        role: role as never,
        organizationId: "org-1",
        authEpoch: 0,
      },
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
    const logs = new LogCapture();
    const app = Fastify({ logger: { level: "info", stream: logs } });
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
    // Attach accessors so tests can inspect post-request state and the
    // captured log rows.
    Object.assign(app, {
      getHandlerReached: () => handlerReached,
      getLogLines: () => logs.parsed(),
    });
    return app;
  }

  function validToken(): string {
    return signJWT(
      {
        actorId: "user-1",
        role: "Admin",
        organizationId: "org-1",
        authEpoch: 0,
      },
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
    // #1002: the 503 error row must carry requestId so it is locatable by
    // the id the client received in the envelope (audit matrix S6 gap:
    // hasReqId=false). `err` is intentionally absent on this site — only
    // the thrown-loader site has an err to serialize.
    const line = logLineFor(
      app,
      "authenticate: assignment authority resolution failed — fail closed",
    );
    expect(line.requestId).toBe(envelopeRequestIdOf(res));
    expect(line.actorId).toBe("user-1");
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
    // #1002: the thrown-loader error row must carry requestId (audit
    // matrix S6 gap: hasReqId=false), preserving the err and actorId
    // payload fields.
    const line = logLineFor(
      app,
      "authenticate: assignment authority loader threw — fail closed",
    );
    expect(line.requestId).toBe(envelopeRequestIdOf(res));
    expect(line.err).toBeDefined();
    expect(line.actorId).toBe("user-1");
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
      // #1002: every operational-failure row carries requestId (audit
      // matrix S6 gap: hasReqId=false); the reason itself stays in the
      // payload.
      const line = logLineFor(
        app,
        "authenticate: assignment authority resolution failed — fail closed",
      );
      expect(line.requestId).toBe(envelopeRequestIdOf(res));
      expect(line.reason).toBe(reason);
      expect(line.actorId).toBe("user-1");
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

describe("auth plugin: user-query failure log carries requestId (#1002)", () => {
  beforeEach(() => {
    vi.stubEnv("APP_MODE", "test");
    vi.stubEnv("JWT_SECRET", "runtime-secret-A");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    resetRuntimeConfigForTest();
    userQueryFailure.error = undefined;
  });

  async function buildAppWithCapturedLogs(): Promise<FastifyInstance> {
    resetRuntimeConfigForTest();
    const logs = new LogCapture();
    const app = Fastify({ logger: { level: "info", stream: logs } });
    await app.register(cookie);
    app.decorate("db", {} as never);
    await app.register(
      buildAuthPluginFp({ loadAssignmentAuthority: mockLoadAuthority() }),
    );
    app.get("/protected", { preHandler: app.authenticate }, async (req) => ({
      actorId: req.ctx?.actorId,
    }));
    await app.ready();
    Object.assign(app, { getLogLines: () => logs.parsed() });
    return app;
  }

  function validToken(): string {
    return signJWT(
      {
        actorId: "user-1",
        role: "Admin",
        organizationId: "org-1",
        authEpoch: 0,
      },
      "runtime-secret-A",
    );
  }

  it("DB failure while loading the user (500) logs requestId matching the envelope", async () => {
    userQueryFailure.error = new Error("db pool exhausted");
    const app = await buildAppWithCapturedLogs();

    const res = await app.inject({
      method: "GET",
      url: "/protected",
      cookies: { "auth-token": validToken() },
    });

    // Response contract unchanged: 500 INTERNAL_ERROR envelope.
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({
      error: { code: "INTERNAL_ERROR" },
    });

    // #1002: the error row must be locatable by the requestId the client
    // received — the gap the audit matrix measured as S5 hasReqId=false
    // (indistinguishable from a handler-bug 500 by the envelope alone).
    const line = logLineFor(app, "Database error during authentication");
    expect(line.requestId).toBe(envelopeRequestIdOf(res));
    // Existing payload fields preserved: err (#998 channel) and actorId.
    expect(line.err).toBeDefined();
    expect(line.actorId).toBe("user-1");
    await app.close();
  });
});
