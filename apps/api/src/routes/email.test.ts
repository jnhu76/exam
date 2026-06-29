import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { FastifyPluginAsync } from "fastify";
import { buildTestApp } from "./testHelpers.js";
import { resetRuntimeConfigForTest } from "../config/runtimeConfig.js";
import { emailRoutes } from "./email.js";

/**
 * Build a test app with the email plugin wired to a specific sender config.
 * Mirrors `buildTestApp` usage across the suite; mounts emailRoutes under
 * /api and installs the email plugin with the provided sender override.
 */
async function buildEmailApp(opts: {
  emailEnabled: boolean;
  fakeMode?: "success" | "failure";
}): Promise<Awaited<ReturnType<typeof buildTestApp>>> {
  // The email plugin reads runtime config; we stub env to drive transport
  // selection, reset the config cache so the stubs take effect, then rely on
  // the plugin to build the sender.
  resetRuntimeConfigForTest();
  return buildTestApp(emailRoutes as FastifyPluginAsync, { prefix: "/api" });
}

describe("POST /api/email/test", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;

  afterEach(() => {
    vi.unstubAllEnvs();
    resetRuntimeConfigForTest();
  });

  afterAll(async () => {
    if (ctx) await ctx.cleanup();
  });

  it("rejects an unauthenticated request with 401", async () => {
    vi.stubEnv("EMAIL_ENABLED", "false");
    ctx = await buildEmailApp({ emailEnabled: false });
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/email/test",
      payload: { to: "someone@example.com" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a non-admin (candidate) with 403", async () => {
    vi.stubEnv("EMAIL_ENABLED", "false");
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/email/test",
      payload: { to: "someone@example.com" },
      cookies: { "auth-token": ctx.candidateToken },
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects an invalid recipient address with 400", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/email/test",
      payload: { to: "not-an-email" },
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns disabled status when EMAIL_ENABLED=false", async () => {
    vi.stubEnv("EMAIL_ENABLED", "false");
    const app = await buildEmailApp({ emailEnabled: false });
    try {
      const res = await app.app.inject({
        method: "POST",
        url: "/api/email/test",
        payload: { to: "someone@example.com" },
        cookies: { "auth-token": app.adminToken },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ok).toBe(true);
      expect(body.status).toBe("disabled");
    } finally {
      await app.cleanup();
    }
  });

  it("returns sent status when fake sender succeeds", async () => {
    vi.stubEnv("EMAIL_ENABLED", "true");
    vi.stubEnv("EMAIL_TRANSPORT", "fake");
    vi.stubEnv("EMAIL_FAKE_MODE", "success");
    const app = await buildEmailApp({
      emailEnabled: true,
      fakeMode: "success",
    });
    try {
      const res = await app.app.inject({
        method: "POST",
        url: "/api/email/test",
        payload: { to: "someone@example.com" },
        cookies: { "auth-token": app.adminToken },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ok).toBe(true);
      expect(body.status).toBe("sent");
    } finally {
      await app.cleanup();
    }
  });

  it("returns a sanitized failure when fake sender fails", async () => {
    vi.stubEnv("EMAIL_ENABLED", "true");
    vi.stubEnv("EMAIL_TRANSPORT", "fake");
    vi.stubEnv("EMAIL_FAKE_MODE", "failure");
    const app = await buildEmailApp({
      emailEnabled: true,
      fakeMode: "failure",
    });
    try {
      const res = await app.app.inject({
        method: "POST",
        url: "/api/email/test",
        payload: { to: "someone@example.com" },
        cookies: { "auth-token": app.adminToken },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ok).toBe(false);
      expect(body.status).toBe("failed");
      expect(typeof body.error).toBe("string");
      expect(body.error).toContain("Fake email sender failure");
    } finally {
      await app.cleanup();
    }
  });
});
