import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import { signJWT } from "@exam/auth/src/session.js";
import authPlugin from "./auth.js";
import { resetRuntimeConfigForTest } from "../config/runtimeConfig.js";

vi.mock("@exam/db/src/repository/userRepo.js", () => ({
  createUserRepo: () => ({
    findByOrganizationAndId: async () => ({
      id: "user-1",
      role: "Admin",
      isActive: true,
    }),
  }),
}));

async function buildAppWithAuth(): Promise<FastifyInstance> {
  resetRuntimeConfigForTest();
  const app = Fastify();
  await app.register(cookie);
  app.decorate("db", {} as never);
  await app.register(authPlugin);
  app.get("/protected", { preHandler: app.authenticate }, async (req) => ({
    actorId: req.ctx?.actorId,
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
    expect(res.json()).toEqual({ actorId: "user-1" });
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
