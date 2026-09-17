import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { setupErrorHandler } from "../plugins/errors.js";
import rateLimitPlugin from "../plugins/rateLimit.js";
import { resetRuntimeConfigForTest } from "../config/runtimeConfig.js";
import apiSurfacePlugin from "./apiSurface.js";
import { buildTestApp, type TestContext } from "./testHelpers.js";

/**
 * #547 GET /api/ready — the deployment readiness gate.
 *
 * Layer split under test (01-semantics-and-design.md):
 * - /api/health stays dependency-blind liveness (must keep answering ok
 *   independently of anything /ready does);
 * - /api/ready answers ONLY the mandatory-dependency gate and its body leaks
 *   nothing beyond the gate answer (privacy);
 * - the route lives under the default /api rate-limit policy, and the Compose
 *   healthcheck cadence (2/min from container loopback) can never self-429.
 *
 * The 503 leg (real DB loss) is proven by the deployment suite
 * (tests/deployment/readiness-gate.sh D2) against a real stopped container —
 * not simulated here; probe classification (throw/hang/redis legs) is unit
 * tested in plugins/operabilityMonitor.test.ts.
 */
describe("GET /api/ready — readiness gate (real app, real DB)", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await buildTestApp(apiSurfacePlugin, { prefix: "/api" });
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("answers 200 {status:'ready'} when the database is reachable", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/api/ready" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ready" });
  });

  it("the response body carries ONLY the gate answer — no latency, dependency, or error detail", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/api/ready" });
    expect(Object.keys(res.json()).sort()).toEqual(["status"]);
    expect(res.body).toBe(JSON.stringify({ status: "ready" }));
  });

  it("does not require authentication and tolerates irrelevant credentials", async () => {
    const withAuth = await ctx.app.inject({
      method: "GET",
      url: "/api/ready",
      headers: {
        cookie: "auth-token=malformed-value",
        authorization: "Bearer x",
      },
    });
    expect(withAuth.statusCode).toBe(200);
  });

  it("liveness /api/health keeps its own cheap contract alongside the gate", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });
});

describe("readiness probe × default rate-limit policy (coexistence)", () => {
  // The /ready route declares NO route-level limiter override, so it sits under
  // the same default per-IP policy as every /api route. What must be pinned at
  // the limiter level (the real route adds no policy of its own): a steady
  // healthcheck cadence (2/min from one identity — the Compose probe shape)
  // stays 200 even while a DIFFERENT identity exhausts its own budget. This is
  // the same policy position /api/health already occupies today.
  const app: FastifyInstance = Fastify({ logger: false });

  beforeAll(async () => {
    delete process.env.RATE_LIMIT_DISABLED;
    resetRuntimeConfigForTest();
    setupErrorHandler(app);
    await app.register(rateLimitPlugin);
    app.get("/ready", async () => ({ status: "ready" }));
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    process.env.RATE_LIMIT_DISABLED = "true";
    resetRuntimeConfigForTest();
  });

  it("healthcheck-cadence probes never 429 while another identity bursts", async () => {
    const probeIp = "127.0.0.200";
    const burstIp = "127.0.0.201";

    // A hostile identity spends its whole default budget (101st/min → 429,
    // same wire fact as the #546 topology suite)…
    const burstMax = 101;
    let lastBurst = 0;
    for (let i = 0; i < burstMax; i++) {
      const res = await app.inject({
        method: "GET",
        url: "/ready",
        remoteAddress: burstIp,
      });
      lastBurst = res.statusCode;
    }
    expect(lastBurst).toBe(429);

    // …while the container-loopback probe shape (well under max/min) is
    // unaffected: per-IP budgets are independent (#546 topology contract).
    for (let i = 0; i < 3; i++) {
      const res = await app.inject({
        method: "GET",
        url: "/ready",
        remoteAddress: probeIp,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ status: "ready" });
    }
  });
});

import { decorateApiRouteStubs } from "../openapi/swagger.js";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";

/**
 * F3 (adversarial review) — REDIS_MODE=required with Redis unusable: the
 * limiter (the /api scope's anti-abuse bound) fails closed BEFORE the route
 * handler runs, so the wire answer is the standard 503 API error envelope,
 * NOT the gate body. The GATE DIRECTION is unchanged (503 = not ready =
 * unhealthy), and the redis readiness alert still fires from the monitor's
 * internal probe. This test pins that scoping so the docs cannot overclaim
 * the body contract.
 */
describe("readiness gate × REDIS_MODE=required, Redis unusable (limiter fail-closed)", () => {
  it("answers 503 via the limiter's fail-closed envelope (handler never runs; gate direction preserved)", async () => {
    delete process.env.RATE_LIMIT_DISABLED;
    resetRuntimeConfigForTest();

    const app = Fastify({ logger: false });
    setupErrorHandler(app);
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    // Minimal required-mode runtime double: no client (never usable), which
    // is exactly the condition the DelegatingRateLimitStore fail-closes on.
    app.decorate("redisRuntime", {
      mode: "required",
      shouldUseRedis: () => false,
      noteRedisCommandError: () => {},
      client: null,
    } as never);
    decorateApiRouteStubs(app);
    await app.register(apiSurfacePlugin, { prefix: "/api" });
    await app.ready();

    try {
      const res = await app.inject({ method: "GET", url: "/api/ready" });
      // 503, never a 500: the route's 503 schema is a UNION (gate body ∪
      // error envelope, apiSurface.ts) so the limiter's fail-closed answer
      // serializes truthfully. Regression: with the old narrow
      // `503: readyResponseSchema`, this request came back 500
      // FST_ERR_RESPONSE_SERIALIZATION — masking the outage class.
      expect(res.statusCode).toBe(503);
      const body = res.json();
      expect(body.status).toBeUndefined();
      expect(body.error?.code).toBe("RATE_LIMIT_UNAVAILABLE");
    } finally {
      await app.close();
      process.env.RATE_LIMIT_DISABLED = "true";
      resetRuntimeConfigForTest();
    }
  });
});
