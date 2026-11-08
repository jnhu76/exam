/**
 * #865 X-Request-Id status-path coverage with real PostgreSQL-backed
 * routes (the wire-socket cases that need DB fixtures): 200 business
 * accept, 204 no-content, 403 role denial, 409 unique-violation conflict,
 * and 500 from a thrown handler — all through the one production hook.
 *
 * Rate-limit 429 is deliberately NOT asserted here: the limiter is
 * structurally disabled in test/e2e modes (runtimeConfig), matching the
 * audit's U2 boundary; production limiter behavior stays a separate item.
 *
 * Id FORMAT (UUIDv4 from production genReqId) is pinned in
 * requestIdWireContract.test.ts, which builds the app with the production
 * composition; buildTestApp uses Fastify's default req-N ids, so THIS file
 * pins per-status coverage: header presence on every status path and
 * equality with the envelope requestId wherever an envelope exists.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
import authRoutes from "./auth.js";
import clientEventRoutes from "./clientEvents.js";
import candidateRoutes from "./candidate.js";
import { buildTestApp, createCandidateViaApi } from "./testHelpers.js";
import { setupRequestIdHeader } from "../plugins/requestIdHeader.js";
import { schema } from "@exam/db/schema/pg";

/** Registers the production hook at THIS scope plus the routes under test. */
const combinedPlugin: FastifyPluginAsync = async (fastify) => {
  setupRequestIdHeader(fastify);
  await fastify.register(authRoutes, { prefix: "/auth" });
  await fastify.register(clientEventRoutes);
  await fastify.register(candidateRoutes);
  // Test-only route: a handler that throws, exercising the unified error
  // handler's 500 path through the same hook.
  fastify.get("/__test/throw", async () => {
    throw new Error("intentional test failure for requestId coverage");
  });
};

describe("X-Request-Id across status paths (real DB fixtures) (#865)", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;

  beforeAll(async () => {
    ctx = await buildTestApp(combinedPlugin, { prefix: "/api" });
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("200 business accept (client-events): header is a fresh UUIDv4", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/client-events",
      cookies: { "auth-token": ctx.adminToken },
      payload: {
        events: [
          {
            kind: "log",
            level: "info",
            name: "requestid.probe.one",
            occurredAt: "2026-06-25T00:00:00.000Z",
          },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["x-request-id"]).toBeTruthy();

    await ctx.db
      .delete(schema.clientEvents)
      .where(eq(schema.clientEvents.name, "requestid.probe.one"));
  });

  it("204 no-content (logout): header present with empty body", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/logout",
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers["x-request-id"]).toBeTruthy();
    expect(res.body).toBe("");
  });

  it("401 unauthenticated: header == error envelope requestId", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/client-events",
      payload: {
        events: [
          {
            kind: "log",
            level: "info",
            name: "requestid.probe.401",
            occurredAt: "2026-06-25T00:00:00.000Z",
          },
        ],
      },
    });
    expect(res.statusCode).toBe(401);
    const header = res.headers["x-request-id"];
    expect(header).toBeTruthy();
    expect(res.json().error.requestId).toBe(header);
  });

  it("403 role denial: header == error envelope requestId", async () => {
    // Candidate token against an Admin-write route (valid body, so the
    // 400 validation layer passes and the capability gate answers 403).
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/candidates",
      cookies: { "auth-token": ctx.candidateToken },
      payload: {
        username: `reqid-403-${Date.now()}`,
        password: "password123",
        name: "Forbidden Create",
        fields: {},
      },
    });
    expect(res.statusCode).toBe(403);
    const header = res.headers["x-request-id"];
    expect(header).toBeTruthy();
    expect(res.json().error.requestId).toBe(header);
  });

  it("409 conflict (duplicate candidate username): header == envelope requestId", async () => {
    const username = `reqid-dup-${Date.now()}`;
    await createCandidateViaApi(ctx.app, ctx.adminToken, username, ctx.org.id);
    const dup = await ctx.app.inject({
      method: "POST",
      url: "/api/candidates",
      cookies: { "auth-token": ctx.adminToken },
      payload: {
        username,
        password: "password123",
        name: "Duplicate",
        fields: {},
      },
    });
    expect(dup.statusCode).toBe(409);
    const header = dup.headers["x-request-id"];
    expect(header).toBeTruthy();
    expect(dup.json().error.requestId).toBe(header);
  });

  it("500 thrown handler: header present on the unified error response", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/__test/throw",
      cookies: { "auth-token": ctx.adminToken },
    });
    expect(res.statusCode).toBe(500);
    const header = res.headers["x-request-id"];
    expect(header).toBeTruthy();
    expect(res.json().error.requestId).toBe(header);
  });

  it("two sequential requests never reuse an id (fresh id per request)", async () => {
    const a = await ctx.app.inject({ method: "POST", url: "/api/auth/logout" });
    const b = await ctx.app.inject({ method: "POST", url: "/api/auth/logout" });
    const idA = a.headers["x-request-id"] as string;
    const idB = b.headers["x-request-id"] as string;
    expect(idA).toBeTruthy();
    expect(idB).toBeTruthy();
    expect(idA).not.toBe(idB);
  });
});
