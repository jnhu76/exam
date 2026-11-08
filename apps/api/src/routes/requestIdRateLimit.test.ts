/**
 * #865 429 coverage: the rate-limit rejection is the one status path the
 * status-matrix suite leaves out (its helper disables the limiter). This
 * probe builds the PRODUCTION hook ordering — root request-id hook FIRST,
 * then the limiter plugin — so the 429 response is proven to carry the
 * server-owned x-request-id equal to its envelope requestId, without a
 * second UUID mint.
 *
 * Composition mirrors plugins/rateLimit.test.ts (APP_MODE=test with
 * RATE_LIMIT_DISABLED explicitly off, max=1) rather than buildTestApp,
 * because the hook-order property under test is exactly the registration
 * order a shared helper would hide.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import rateLimitPlugin from "../plugins/rateLimit.js";
import { setupRequestIdHeader } from "../plugins/requestIdHeader.js";
import { setupErrorHandler } from "../plugins/errors.js";
import { resetRuntimeConfigForTest } from "../config/runtimeConfig.js";

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let app: FastifyInstance;

beforeAll(async () => {
  vi.stubEnv("APP_MODE", "test");
  vi.stubEnv("RATE_LIMIT_DISABLED", "false");
  vi.stubEnv("RATE_LIMIT_MAX", "1");
  vi.stubEnv("RATE_LIMIT_WINDOW_MS", "60000");
  resetRuntimeConfigForTest();

  app = Fastify({
    logger: false,
    genReqId: () => randomUUID(),
    requestIdHeader: false,
  });
  setupRequestIdHeader(app);
  setupErrorHandler(app);
  await app.register(rateLimitPlugin);
  app.get("/limited", async () => ({ ok: true }));
  await app.ready();
});

afterAll(async () => {
  await app.close();
  vi.unstubAllEnvs();
  resetRuntimeConfigForTest();
});

describe("X-Request-Id on the 429 rate-limit rejection (#865)", () => {
  it("a 429 carries the header == envelope requestId (no second id minted)", async () => {
    const first = await app.inject({ method: "GET", url: "/limited" });
    const second = await app.inject({ method: "GET", url: "/limited" });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(429);

    const header = second.headers["x-request-id"];
    expect(header).toMatch(UUID_V4);
    const body = second.json() as {
      error?: { code?: string; requestId?: string };
    };
    expect(body.error?.code).toBe("RATE_LIMITED");
    expect(body.error?.requestId).toBe(header);
  });
});
