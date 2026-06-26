import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify from "fastify";
import { setupErrorHandler } from "./errors.js";
import rateLimitPlugin from "./rateLimit.js";

/**
 * F-005: Security test for rate-limit abuse on the login path. Confirms that a
 * sustained brute-force pattern (many rapid attempts from the same client) is
 * blocked by the rate limiter, returning 429 RATE_LIMITED. No production code
 * changes — this exercises the existing rateLimit plugin from an attacker's
 * perspective (defense-in-depth validation).
 */
describe("rate limit — login brute-force abuse", () => {
  const app = Fastify();
  /** Tracks how many attempts reached the handler (i.e. were NOT blocked). */
  let reachedHandler = 0;

  beforeAll(async () => {
    setupErrorHandler(app);
    await app.register(rateLimitPlugin);
    // A login-like POST endpoint with a tight limit, mirroring how auth routes
    // would be configured for brute-force protection.
    app.post(
      "/auth/login",
      { config: { rateLimit: { max: 5, timeWindow: 60_000 } } },
      async () => {
        reachedHandler += 1;
        // Always reject (wrong password) — the attacker keeps retrying.
        return { statusCode: 401, error: { code: "AUTH_FAILED" } };
      },
    );
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("blocks repeated login attempts after the limit is reached", async () => {
    const LIMIT = 5;
    const results: number[] = [];
    // Fire LIMIT + 4 rapid attempts (a sustained burst).
    for (let i = 0; i < LIMIT + 4; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/auth/login",
        payload: { username: "victim", password: `guess-${i}` },
      });
      results.push(res.statusCode);
    }

    // The first LIMIT attempts reach the handler (401 from the handler).
    // The remaining 4 are blocked by the rate limiter (429).
    const allowed = results.filter((c) => c !== 429).length;
    const blocked = results.filter((c) => c === 429).length;

    expect(reachedHandler).toBe(LIMIT);
    expect(allowed).toBe(LIMIT);
    expect(blocked).toBe(4);

    // The blocked responses use the canonical RATE_LIMITED error code.
    const lastBlocked = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { username: "victim", password: "still-trying" },
    });
    expect(lastBlocked.statusCode).toBe(429);
    expect(lastBlocked.json().error.code).toBe("RATE_LIMITED");
  });
});
