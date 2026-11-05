import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
import authRoutes from "./auth.js";
import clientEventRoutes from "./clientEvents.js";
import { buildTestApp } from "./testHelpers.js";
import { schema } from "@exam/db/schema/pg";

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

  describe("client-event idempotency (#863)", () => {
    /**
     * Sends one batch as the given (already-authenticated) test user and
     * returns the parsed response body.
     */
    async function postBatch(
      token: string,
      events: Array<Record<string, unknown>>,
    ): Promise<{ status: number; body: { accepted?: number } }> {
      const res = await ctx.app.inject({
        method: "POST",
        url: "/api/client-events",
        cookies: { "auth-token": token },
        payload: { events },
      });
      return { status: res.statusCode, body: res.json() };
    }

    async function countRows(name: string): Promise<number> {
      const rows = await ctx.db
        .select({ id: schema.clientEvents.id })
        .from(schema.clientEvents)
        .where(eq(schema.clientEvents.name, name));
      return rows.length;
    }

    it("ACK lost then full batch resend stores exactly one row per eventId and still reports accepted = n (no infinite retry)", async () => {
      const batch = [
        validEvent({
          name: "test.event.idem1",
          eventId: "evt-idem-000000000001",
        }),
        validEvent({
          name: "test.event.idem1",
          eventId: "evt-idem-000000000002",
        }),
      ];
      const first = await postBatch(ctx.adminToken, batch);
      expect(first.status).toBe(200);
      expect(first.body.accepted).toBe(2);
      // The client never saw the ACK and resends the SAME batch verbatim.
      const replay = await postBatch(ctx.adminToken, batch);
      expect(replay.status).toBe(200);
      // Deduplicated rows MUST count as accepted — accepted < n is the
      // client's failure signal and would loop the resend forever.
      expect(replay.body.accepted).toBe(2);
      expect(await countRows("test.event.idem1")).toBe(2);

      await ctx.db
        .delete(schema.clientEvents)
        .where(eq(schema.clientEvents.name, "test.event.idem1"));
    });

    it("same eventId with a DIFFERENT payload does not duplicate or overwrite (first write wins)", async () => {
      await postBatch(ctx.adminToken, [
        validEvent({
          name: "test.event.idem2",
          level: "info",
          eventId: "evt-idem-000000000003",
        }),
      ]);
      await postBatch(ctx.adminToken, [
        validEvent({
          name: "test.event.idem2",
          level: "error",
          eventId: "evt-idem-000000000003",
        }),
      ]);
      expect(await countRows("test.event.idem2")).toBe(1);
      const [row] = await ctx.db
        .select()
        .from(schema.clientEvents)
        .where(eq(schema.clientEvents.name, "test.event.idem2"));
      // First write wins — a client eventId is a dedup key, never a trusted
      // identity: a replay cannot mutate the stored row.
      expect(row!.level).toBe("info");

      await ctx.db
        .delete(schema.clientEvents)
        .where(eq(schema.clientEvents.name, "test.event.idem2"));
    });

    it("the same eventId from a DIFFERENT user stores both rows (user boundary in the key)", async () => {
      const eventId = "evt-idem-000000000004";
      await postBatch(ctx.adminToken, [
        validEvent({ name: "test.event.idem3", eventId }),
      ]);
      await postBatch(ctx.candidateToken, [
        validEvent({ name: "test.event.idem3", eventId }),
      ]);
      expect(await countRows("test.event.idem3")).toBe(2);

      await ctx.db
        .delete(schema.clientEvents)
        .where(eq(schema.clientEvents.name, "test.event.idem3"));
    });

    it("a different clientSessionId with the same eventId still deduplicates (restart / new tab resend)", async () => {
      await postBatch(ctx.adminToken, [
        validEvent({
          name: "test.event.idem4",
          eventId: "evt-idem-000000000005",
          clientSessionId: "11111111-1111-1111-1111-111111111111",
        }),
      ]);
      await postBatch(ctx.adminToken, [
        validEvent({
          name: "test.event.idem4",
          eventId: "evt-idem-000000000005",
          clientSessionId: "22222222-2222-2222-2222-222222222222",
        }),
      ]);
      expect(await countRows("test.event.idem4")).toBe(1);

      await ctx.db
        .delete(schema.clientEvents)
        .where(eq(schema.clientEvents.name, "test.event.idem4"));
    });

    it("old clients without eventId keep the append-only behavior (no dedup, no rejection)", async () => {
      const legacy = validEvent({ name: "test.event.idem5" });
      await postBatch(ctx.adminToken, [legacy]);
      await postBatch(ctx.adminToken, [legacy]);
      expect(await countRows("test.event.idem5")).toBe(2);

      await ctx.db
        .delete(schema.clientEvents)
        .where(eq(schema.clientEvents.name, "test.event.idem5"));
    });

    it("deduplication lasts exactly as long as the row does (30-day retention window)", async () => {
      await postBatch(ctx.adminToken, [
        validEvent({
          name: "test.event.idem6",
          eventId: "evt-idem-000000000006",
        }),
      ]);
      // Retention deletes the original row — the resend inserts fresh: the
      // dedup key is row existence, not a second ledger.
      await ctx.db
        .delete(schema.clientEvents)
        .where(eq(schema.clientEvents.name, "test.event.idem6"));
      const resend = await postBatch(ctx.adminToken, [
        validEvent({
          name: "test.event.idem6",
          eventId: "evt-idem-000000000006",
        }),
      ]);
      expect(resend.body.accepted).toBe(1);
      expect(await countRows("test.event.idem6")).toBe(1);

      await ctx.db
        .delete(schema.clientEvents)
        .where(eq(schema.clientEvents.name, "test.event.idem6"));
    });
  });
});
