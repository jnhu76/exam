import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyPluginAsync } from "fastify";
import apiSurfacePlugin from "./apiSurface.js";
import { buildTestApp, type TestContext } from "./testHelpers.js";

/**
 * #450 malformed-JSON HTTP boundary — production-composition witness.
 *
 * The whole /api surface (real route modules, the rate limiter registered
 * by apiSurface — disabled under the test helper's RATE_LIMIT_DISABLED —
 * and the production `setupErrorHandler`) is mounted exactly like
 * `server.ts` does. Malformed JSON bytes are sent through the custom
 * content-type parser in setupSecurity to prove the client-error
 * classification is systemic (any JSON route, any route module), not a
 * `/api/auth/login` special case.
 *
 * INVARIANT: body parsing happens before `authenticate` (preHandler), so
 * authenticated routes (courses/exams) share the same parser boundary as
 * public ones (auth/login).
 *
 * The internal-error probe route exists only as the negative control proving
 * genuine server failures still surface as 500 INTERNAL_ERROR — no 4xx
 * masking (INTERNAL_ERROR_5XX_MASK_COUNT=0).
 */
const apiSurfaceWithInternalErrorProbe: FastifyPluginAsync = async (
  fastify,
) => {
  await fastify.register(apiSurfacePlugin);
  fastify.post("/__probe/internal-error", async () => {
    throw new Error("boom");
  });
};

describe("malformed JSON boundary (#450)", () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await buildTestApp(apiSurfaceWithInternalErrorProbe, {
      prefix: "/api",
    });
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  /** Sends raw bytes as the request body with an explicit JSON content type. */
  function injectRawJsonBody(url: string, payload: string) {
    return ctx.app.inject({
      method: "POST",
      url,
      headers: { "content-type": "application/json" },
      payload,
    });
  }

  it.each(["/api/auth/login", "/api/courses", "/api/exams"])(
    "returns canonical 400 for malformed JSON on %s",
    async (url) => {
      const res = await injectRawJsonBody(url, "{not-valid-json");
      expect(res.statusCode, url).toBe(400);
      expect(res.headers["content-type"], url).toContain("application/json");
      const body = res.json();
      expect(body.error.code, url).toBe("VALIDATION_ERROR");
      expect(body.error.code, url).not.toBe("INTERNAL_ERROR");
      expect(typeof body.error.requestId, url).toBe("string");
      expect(body.error.requestId, url).not.toBe("");
    },
  );

  it("keeps parseable but schema-invalid JSON on the existing validation contract", async () => {
    const res = await injectRawJsonBody("/api/auth/login", "{}");
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.details.fields.length).toBeGreaterThan(0);
    expect(body.error.requestId).not.toBe("");
  });

  it("keeps the lenient empty-JSON-body contract (empty parses to {}, then schema validation)", async () => {
    // The custom application/json parser in setupSecurity deliberately
    // tolerates empty bodies (parses to {}); the rejection comes from the
    // route's schema, staying on the 400 validation contract — never a
    // parser-boundary 500 (#450 regression guard for the lenient branch).
    const res = await injectRawJsonBody("/api/auth/login", "");
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.requestId).not.toBe("");
  });

  it("keeps valid requests on normal business semantics (GET /api/health)", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("keeps genuine internal exceptions at 500 INTERNAL_ERROR", async () => {
    const res = await injectRawJsonBody(
      "/api/__probe/internal-error",
      '{"x":1}',
    );
    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(JSON.stringify(body)).not.toContain("boom");
  });
});
