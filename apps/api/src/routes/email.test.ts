import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyPluginAsync } from "fastify";
import { buildTestApp } from "./testHelpers.js";
import { resetRuntimeConfigForTest } from "../config/runtimeConfig.js";
import { emailRoutes } from "./email.js";

/**
 * Build a test app with the email plugin wired to a specific sender config,
 * and return the ctx + a cleanup thunk. Each test builds its OWN app — there
 * is no shared `ctx` across tests.
 *
 * Why per-test apps (not a single beforeAll): each test needs a different
 * sender config (disabled / fake-success / fake-failure), and the email
 * plugin resolves the sender once at registration time from the STUBBED env.
 * A shared app would freeze whichever config the first test happened to set.
 * The previous shared-`ctx` design borrowed the first test's app for the
 * auth/role/validation tests, which broke if that first test failed or the
 * suite was filtered — `ctx` would be `undefined` and every dependent test
 * would cascade-fail with "Cannot read properties of undefined". Per-test
 * isolation removes that fragility.
 *
 * The app is built inside a `try/finally` so cleanup always runs even when an
 * assertion throws. Network/SMTP behavior is NOT exercised here — the sender
 * layer (DisabledEmailSender / FakeEmailSender / SmtpEmailSender, including
 * real-SMTP payload formatting and secret-scrubbing) is covered exhaustively
 * in `src/email/senders.test.ts`. This file covers the HTTP integration only:
 * auth, role gating, input validation, and the three response shapes
 * (disabled / sent / failed).
 */
async function buildEmailApp(opts: {
  emailEnabled: boolean;
  fakeMode?: "success" | "failure";
}): Promise<{
  ctx: Awaited<ReturnType<typeof buildTestApp>>;
  cleanup: () => Promise<void>;
}> {
  // The email plugin reads runtime config; we stub env to drive transport
  // selection, reset the config cache so the stubs take effect, then rely on
  // the plugin to build the sender.
  resetRuntimeConfigForTest();
  const ctx = await buildTestApp(emailRoutes as FastifyPluginAsync, {
    prefix: "/api",
  });
  return { ctx, cleanup: () => ctx.cleanup() };
}

describe("POST /api/email/test", () => {
  // Env stubs leak across tests; always restore so the next test starts clean.
  afterEach(() => {
    vi.unstubAllEnvs();
    resetRuntimeConfigForTest();
  });

  it("rejects an unauthenticated request with 401", async () => {
    vi.stubEnv("EMAIL_ENABLED", "false");
    const { ctx, cleanup } = await buildEmailApp({ emailEnabled: false });
    try {
      const res = await ctx.app.inject({
        method: "POST",
        url: "/api/email/test",
        payload: { to: "someone@example.com" },
      });
      expect(res.statusCode).toBe(401);
    } finally {
      await cleanup();
    }
  });

  it("rejects a non-admin (candidate) with 403", async () => {
    vi.stubEnv("EMAIL_ENABLED", "false");
    const { ctx, cleanup } = await buildEmailApp({ emailEnabled: false });
    try {
      const res = await ctx.app.inject({
        method: "POST",
        url: "/api/email/test",
        payload: { to: "someone@example.com" },
        cookies: { "auth-token": ctx.candidateToken },
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await cleanup();
    }
  });

  it("rejects an invalid recipient address with 400", async () => {
    vi.stubEnv("EMAIL_ENABLED", "false");
    const { ctx, cleanup } = await buildEmailApp({ emailEnabled: false });
    try {
      const res = await ctx.app.inject({
        method: "POST",
        url: "/api/email/test",
        payload: { to: "not-an-email" },
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(res.statusCode).toBe(400);
    } finally {
      await cleanup();
    }
  });

  it("returns disabled status when EMAIL_ENABLED=false", async () => {
    vi.stubEnv("EMAIL_ENABLED", "false");
    const { ctx, cleanup } = await buildEmailApp({ emailEnabled: false });
    try {
      const res = await ctx.app.inject({
        method: "POST",
        url: "/api/email/test",
        payload: { to: "someone@example.com" },
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ok).toBe(true);
      expect(body.status).toBe("disabled");
    } finally {
      await cleanup();
    }
  });

  it("returns sent status when fake sender succeeds", async () => {
    vi.stubEnv("EMAIL_ENABLED", "true");
    vi.stubEnv("EMAIL_TRANSPORT", "fake");
    vi.stubEnv("EMAIL_FAKE_MODE", "success");
    const { ctx, cleanup } = await buildEmailApp({
      emailEnabled: true,
      fakeMode: "success",
    });
    try {
      const res = await ctx.app.inject({
        method: "POST",
        url: "/api/email/test",
        payload: { to: "someone@example.com" },
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ok).toBe(true);
      expect(body.status).toBe("sent");
    } finally {
      await cleanup();
    }
  });

  it("returns a sanitized failure when fake sender fails", async () => {
    vi.stubEnv("EMAIL_ENABLED", "true");
    vi.stubEnv("EMAIL_TRANSPORT", "fake");
    vi.stubEnv("EMAIL_FAKE_MODE", "failure");
    const { ctx, cleanup } = await buildEmailApp({
      emailEnabled: true,
      fakeMode: "failure",
    });
    try {
      const res = await ctx.app.inject({
        method: "POST",
        url: "/api/email/test",
        payload: { to: "someone@example.com" },
        cookies: { "auth-token": ctx.adminToken },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ok).toBe(false);
      expect(body.status).toBe("failed");
      expect(typeof body.error).toBe("string");
      expect(body.error).toContain("Fake email sender failure");
    } finally {
      await cleanup();
    }
  });
});
