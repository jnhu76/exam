import { afterEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { setupErrorHandler } from "./errors.js";
import rateLimitPlugin from "./rateLimit.js";
import { resetRuntimeConfigForTest } from "../config/runtimeConfig.js";

/**
 * Build an isolated Fastify app whose `/limited` route has a route-level
 * rate limit of `max: 1` per 60s window. Each test owns its own app (and
 * closes it in a `finally`) so runtime-config cache and per-IP request
 * counts cannot leak between tests.
 *
 * The route-level `max: 1` is intentional: it is the tightest boundary at
 * which the limiter can be observed — the 2nd request is exactly the one
 * that proves whether the limiter is active.
 */
async function buildRateLimitProbeApp(): Promise<FastifyInstance> {
  const app = Fastify();
  setupErrorHandler(app);
  await app.register(rateLimitPlugin);
  app.get(
    "/limited",
    { config: { rateLimit: { max: 1, timeWindow: 60_000 } } },
    async () => ({ ok: true }),
  );
  await app.ready();
  return app;
}

describe("rate limit plugin", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetRuntimeConfigForTest();
  });

  it("enforces the limit in test mode (first request OK, second request 429 with RATE_LIMITED ErrorResponse)", async () => {
    vi.stubEnv("APP_MODE", "test");
    // Explicitly enable the limiter: `enabled` is `mode !== "e2e" &&
    // !isTruthy(RATE_LIMIT_DISABLED)`, and there is no shared setup forcing
    // this env, so an inherited RATE_LIMIT_DISABLED=true would otherwise make
    // both requests 200. Keeps this test fully hermetic.
    vi.stubEnv("RATE_LIMIT_DISABLED", "false");
    resetRuntimeConfigForTest();

    const app = await buildRateLimitProbeApp();
    try {
      const first = await app.inject({ method: "GET", url: "/limited" });
      const second = await app.inject({ method: "GET", url: "/limited" });

      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(429);
      expect(second.json()).toMatchObject({
        error: {
          code: "RATE_LIMITED",
          message: "请求过于频繁，请稍后重试",
          requestId: expect.any(String),
        },
      });
    } finally {
      await app.close();
    }
  });

  it("APP_MODE=e2e bypasses the limiter entirely (route max=1: the 2nd request is the complete boundary proof)", async () => {
    // #231: the plugin-level E2E bypass proof belongs here, not in the auth
    // route E2E amplification test. With route max=1, the 2nd request is the
    // exact boundary at which a limiter would fire — so a 200 on the 2nd
    // request proves the limiter did not register at all. This is a
    // database-free plugin test; it needs no auth/argon2/audit amplification.
    vi.stubEnv("APP_MODE", "e2e");
    vi.stubEnv("RATE_LIMIT_MAX", "1");
    resetRuntimeConfigForTest();

    const app = await buildRateLimitProbeApp();
    try {
      const first = await app.inject({ method: "GET", url: "/limited" });
      const second = await app.inject({ method: "GET", url: "/limited" });

      expect(first.statusCode).toBe(200);
      // Still 200: in e2e mode the plugin skips registration, so the route's
      // max=1 is never enforced.
      expect(second.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});
