import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify from "fastify";
import { setupErrorHandler } from "./errors.js";
import rateLimitPlugin from "./rateLimit.js";

describe("rate limit plugin", () => {
  const app = Fastify();

  beforeAll(async () => {
    setupErrorHandler(app);
    await app.register(rateLimitPlugin);
    app.get(
      "/limited",
      { config: { rateLimit: { max: 1, timeWindow: 60_000 } } },
      async () => ({ ok: true }),
    );
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns ErrorResponse v0 when the limit is exceeded", async () => {
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
  });
});
