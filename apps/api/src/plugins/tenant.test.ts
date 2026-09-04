import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getErrorMessage } from "@exam/contracts";
import { validateTenantAccess } from "@exam/auth/src/tenantGuard.js";
import type { RuntimeRequestContext } from "../types/requestContext.js";
import tenantPlugin from "./tenant.js";

// C6 F-11 reachability reality: the Phase-1 guard (validateTenantAccess) is
// a single-tenant no-op with no throw path, so this hook's catch branch is
// dormant in production. The envelope contract is pinned here by mocking the
// guard at the auth-boundary seam — no tenant semantics are activated.
vi.mock("@exam/auth/src/tenantGuard.js", () => ({
  validateTenantAccess: vi.fn(),
}));

const mockGuard = vi.mocked(validateTenantAccess);

const testCtx = {
  actorId: "user-1",
  organizationId: "org-1",
  permissions: [],
  roles: [],
  capabilities: [],
} as unknown as RuntimeRequestContext;

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  // Minimal stand-in for the authenticate preHandler: satisfies the
  // `_isAuthenticate` marker the tenant plugin looks for and populates
  // request.ctx the way the real auth plugin would.
  const fakeAuthenticate = async (req: FastifyRequest) => {
    (req as { ctx?: unknown }).ctx = testCtx;
  };
  (
    fakeAuthenticate as unknown as { _isAuthenticate: boolean }
  )._isAuthenticate = true;
  // Await the plugin BEFORE declaring the route, so the plugin's onRoute
  // hook is installed when the route registers (same ordering as
  // routes/testHelpers.ts).
  await app.register(tenantPlugin);
  app.get("/api/tenant-probe", { preHandler: fakeAuthenticate }, async () => ({
    ok: true,
  }));
  await app.ready();
  return app;
}

describe("tenant guard hook envelope (C6 F-11)", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    mockGuard.mockReset();
    app = await buildApp();
  });

  afterEach(async () => {
    await app.close();
  });

  it("passes through when the dormant guard does not reject", async () => {
    mockGuard.mockImplementation(() => {});
    const res = await app.inject({ method: "GET", url: "/api/tenant-probe" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it("answers a legacy-shaped guard rejection with the canonical envelope", async () => {
    mockGuard.mockImplementation(() => {
      throw {
        statusCode: 403,
        // Raw guard prose must never reach the wire.
        message: "raw guard prose INTERNAL_SENTINEL_DO_NOT_LEAK",
        code: "TENANT_ACCESS_DENIED",
      };
    });
    const res = await app.inject({ method: "GET", url: "/api/tenant-probe" });
    expect(res.statusCode).toBe(403);
    const body = res.json();
    // Legacy code normalized through the existing map.
    expect(body.error.code).toBe("PERMISSION_DENIED");
    expect(body.error.message).toBe(getErrorMessage("PERMISSION_DENIED"));
    expect(body.error.message).not.toContain("INTERNAL_SENTINEL_DO_NOT_LEAK");
    expect(typeof body.error.requestId).toBe("string");
    expect(body.error.requestId.length).toBeGreaterThan(0);
  });

  it("falls back to the status-derived code when the guard carries none", async () => {
    mockGuard.mockImplementation(() => {
      throw { statusCode: 403 };
    });
    const res = await app.inject({ method: "GET", url: "/api/tenant-probe" });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("PERMISSION_DENIED");
  });
});
