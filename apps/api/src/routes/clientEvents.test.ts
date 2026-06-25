import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
import authRoutes from "./auth.js";
import clientEventRoutes from "./clientEvents.js";
import { buildTestApp } from "./testHelpers.js";
import { schema } from "@exam/db/src/schema/pg.js";

const combinedPlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(authRoutes, { prefix: "/auth" });
  await fastify.register(clientEventRoutes);
};

describe("POST /api/client-events", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let orgId: string;
  let adminId: string;
  let candidateId: string;

  beforeAll(async () => {
    ctx = await buildTestApp(combinedPlugin, { prefix: "/api" });
    orgId = ctx.org.id;
    adminId = ctx.admin.id;
    candidateId = ctx.candidate.id;
  });

  afterAll(async () => {
    // Clean up any rows we wrote, scoped by the users in this test.
    await ctx.db
      .delete(schema.clientEvents)
      .where(eq(schema.clientEvents.userId, adminId));
    await ctx.db
      .delete(schema.clientEvents)
      .where(eq(schema.clientEvents.userId, candidateId));
    await ctx.cleanup();
  });

  function validEvent(overrides: Record<string, unknown> = {}) {
    return {
      kind: "log",
      level: "info",
      name: "system_diagnostics.refreshed",
      occurredAt: "2026-06-25T00:00:00.000Z",
      ...overrides,
    };
  }

  it("writes a valid batch scoped to the authenticated user/org", async () => {
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/client-events",
      cookies: { "auth-token": ctx.adminToken },
      payload: {
        events: [
          validEvent({ name: "test.event.one" }),
          validEvent({ name: "test.event.two", level: "warn" }),
        ],
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ accepted: 2 });

    const rows = await ctx.db
      .select()
      .from(schema.clientEvents)
      .where(eq(schema.clientEvents.userId, adminId));
    const ours = rows.filter((r) => r.name.startsWith("test.event."));
    expect(ours).toHaveLength(2);
    expect(ours.every((r) => r.organizationId === orgId)).toBe(true);
    expect(ours.every((r) => r.userId === adminId)).toBe(true);
    // Server stamps receivedAt; client supplied occurredAt.
    expect(ours.every((r) => r.receivedAt instanceof Date)).toBe(true);
    expect(
      ours.every(
        (r) => r.occurredAt.toISOString() === "2026-06-25T00:00:00.000Z",
      ),
    ).toBe(true);
  });

  it("allows a Candidate to report its own events", async () => {
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/client-events",
      cookies: { "auth-token": ctx.candidateToken },
      payload: { events: [validEvent({ name: "candidate.event.one" })] },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ accepted: 1 });

    const rows = await ctx.db
      .select()
      .from(schema.clientEvents)
      .where(eq(schema.clientEvents.userId, candidateId));
    expect(rows.some((r) => r.name === "candidate.event.one")).toBe(true);
    expect(rows.every((r) => r.organizationId === orgId)).toBe(true);
  });

  it("rejects an unauthenticated request with 401", async () => {
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/client-events",
      payload: { events: [validEvent()] },
    });
    expect(response.statusCode).toBe(401);
    const body = response.json();
    expect(body.error.code).toBe("AUTH_REQUIRED");
  });

  it("rejects an invalid payload with 400 VALIDATION_ERROR", async () => {
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/client-events",
      cookies: { "auth-token": ctx.adminToken },
      payload: {
        events: [
          validEvent({ level: "not-a-level" }), // invalid level
        ],
      },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects a too-large batch with 400", async () => {
    const events = Array.from({ length: 51 }, () => validEvent());
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/client-events",
      cookies: { "auth-token": ctx.adminToken },
      payload: { events },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  it("records the user-agent truncated", async () => {
    const longUa = "M".repeat(600);
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/client-events",
      cookies: { "auth-token": ctx.adminToken },
      headers: { "user-agent": longUa },
      payload: { events: [validEvent({ name: "test.event.ua" })] },
    });
    expect(response.statusCode).toBe(200);
    const rows = await ctx.db
      .select()
      .from(schema.clientEvents)
      .where(eq(schema.clientEvents.name, "test.event.ua"));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userAgent?.length).toBe(500);
  });

  it("server-side sanitizes sensitive metadata as defense-in-depth (H7)", async () => {
    // A client that bypassed (or never ran) client-side redaction sends raw
    // secrets / exam content. The server MUST redact before persisting.
    const response = await ctx.app.inject({
      method: "POST",
      url: "/api/client-events",
      cookies: { "auth-token": ctx.adminToken },
      payload: {
        events: [
          validEvent({
            name: "test.event.sanitize",
            metadata: {
              password: "pwn",
              authorization: "Bearer evil",
              answer: "A",
              answerText: "the real answer",
              questionText: "leaked question",
              keep: 42,
            },
          }),
        ],
      },
    });
    expect(response.statusCode).toBe(200);

    const rows = await ctx.db
      .select()
      .from(schema.clientEvents)
      .where(eq(schema.clientEvents.name, "test.event.sanitize"));
    expect(rows).toHaveLength(1);
    const meta = rows[0]!.metadata as Record<string, unknown>;
    expect(meta.password).toBe("[redacted]");
    expect(meta.authorization).toBe("[redacted]");
    expect(meta.answer).toBe("[redacted]");
    expect(meta.answerText).toBe("[redacted]");
    expect(meta.questionText).toBe("[redacted]");
    // Non-sensitive data is preserved.
    expect(meta.keep).toBe(42);

    await ctx.db
      .delete(schema.clientEvents)
      .where(eq(schema.clientEvents.name, "test.event.sanitize"));
  });
});
