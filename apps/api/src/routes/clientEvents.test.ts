import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyPluginAsync } from "fastify";
import { eq } from "drizzle-orm";
import authRoutes from "./auth.js";
import clientEventRoutes from "./clientEvents.js";
import { buildTestApp } from "./testHelpers.js";
import { schema } from "@exam/db/schema/pg";
import { SPA_ROUTE_TEMPLATES } from "@exam/contracts";
import { signJWT } from "@exam/auth/session";
import { getRuntimeConfig } from "../config/runtimeConfig.js";

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

  /** Fetches the single client_event row persisted under a test event name. */
  async function fetchRow(name: string) {
    const rows = await ctx.db
      .select()
      .from(schema.clientEvents)
      .where(eq(schema.clientEvents.name, name));
    return rows[0] ?? null;
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

  describe("at-rest free-input minimization (#875)", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

    it("redacts a credential-shaped metadata VALUE under an innocent key before persist", async () => {
      const response = await ctx.app.inject({
        method: "POST",
        url: "/api/client-events",
        cookies: { "auth-token": ctx.adminToken },
        payload: {
          events: [
            validEvent({
              name: "test.event.value875",
              metadata: {
                note: `retry context ${jwt}`,
                dsn: "postgresql://exam:hunter2@db.local/exam",
                keep: { path: "/exam/1", count: 2 },
              },
            }),
          ],
        },
      });
      expect(response.statusCode).toBe(200);
      const row = await fetchRow("test.event.value875");
      expect(row).not.toBeNull();
      const meta = row!.metadata as Record<string, unknown>;
      // Credential-shaped values never reach storage verbatim…
      expect(meta.note).toBe("[redacted]");
      expect(meta.dsn).toBe("[redacted]");
      expect(JSON.stringify(row)).not.toContain("SflKxwRJSMeKKF2QT4fwpMeJf36");
      expect(JSON.stringify(row)).not.toContain("hunter2");
      // …while ordinary values survive intact.
      expect(meta.keep).toEqual({ path: "/exam/1", count: 2 });

      await ctx.db
        .delete(schema.clientEvents)
        .where(eq(schema.clientEvents.name, "test.event.value875"));
    });

    it("persists route as a closed template — query credentials never reach storage (#864)", async () => {
      const response = await ctx.app.inject({
        method: "POST",
        url: "/api/client-events",
        cookies: { "auth-token": ctx.adminToken },
        payload: {
          events: [
            validEvent({
              name: "test.event.route875",
              route: "/exam/list?token=supersecret&invite=alice%40x.local#frag",
            }),
          ],
        },
      });
      expect(response.statusCode).toBe(200);
      const row = await fetchRow("test.event.route875");
      expect(row).not.toBeNull();
      expect(row!.route).toBe("/exam/list");
      expect(JSON.stringify(row)).not.toContain("supersecret");
      expect(JSON.stringify(row)).not.toContain("invite");

      await ctx.db
        .delete(schema.clientEvents)
        .where(eq(schema.clientEvents.name, "test.event.route875"));
    });

    it("persists NULL for an unparseable route — no fallback bytes of any kind (#864)", async () => {
      const response = await ctx.app.inject({
        method: "POST",
        url: "/api/client-events",
        cookies: { "auth-token": ctx.adminToken },
        payload: {
          events: [
            validEvent({
              name: "test.event.route875bad",
              route: "http://[?token=supersecret&invite=alice%40x.local",
            }),
          ],
        },
      });
      expect(response.statusCode).toBe(200);
      const row = await fetchRow("test.event.route875bad");
      expect(row).not.toBeNull();
      // Fail-closed: the old hand-trimmed fallback (prefix before ?/#) is
      // gone; nothing from an unparseable input may be persisted.
      expect(row!.route).toBeNull();
      expect(JSON.stringify(row)).not.toContain("supersecret");
      expect(JSON.stringify(row)).not.toContain("invite");
      expect(JSON.stringify(row)).not.toContain("http://[");

      await ctx.db
        .delete(schema.clientEvents)
        .where(eq(schema.clientEvents.name, "test.event.route875bad"));
    });

    it("redacts a credential-shaped clientSessionId; the normal UUID passes through", async () => {
      const response = await ctx.app.inject({
        method: "POST",
        url: "/api/client-events",
        cookies: { "auth-token": ctx.adminToken },
        payload: {
          events: [
            validEvent({
              name: "test.event.session875a",
              clientSessionId: jwt,
            }),
            validEvent({
              name: "test.event.session875b",
              clientSessionId: "b5b1c5a3-4ae1-4aa1-9ffc-543872e2017b",
            }),
          ],
        },
      });
      expect(response.statusCode).toBe(200);
      const hostile = await fetchRow("test.event.session875a");
      const normal = await fetchRow("test.event.session875b");
      expect(hostile!.clientSessionId).toBe("[redacted]");
      expect(normal!.clientSessionId).toBe(
        "b5b1c5a3-4ae1-4aa1-9ffc-543872e2017b",
      );

      await ctx.db
        .delete(schema.clientEvents)
        .where(eq(schema.clientEvents.name, "test.event.session875a"));
      await ctx.db
        .delete(schema.clientEvents)
        .where(eq(schema.clientEvents.name, "test.event.session875b"));
    });
  });

  describe("closed route-template projection (#864)", () => {
    /**
     * Audit RT-series attack matrix (2026-11 secure-correlation audit, #922
     * archive 02-SECURITY-EVIDENCE.md). Every adversarial route must persist
     * as a member of the closed template vocabulary or NULL — never raw
     * client bytes. SECRET_AT_REST must be 0 across the whole batch.
     */
    const CANARY = "EXAMAUDIT-CANARY";
    const attackMatrix: Array<{
      id: string;
      route: string;
      expected: string | null;
    }> = [
      // RT-3 plaintext path secret (hostile root and real-root tail).
      { id: "rt3a", route: `/password-reset/${CANARY}-RT3`, expected: null },
      {
        id: "rt3b",
        route: `/exam/${CANARY}-RT3-SECRET/start`,
        expected: "/exam/:examId/start",
      },
      // RT-8 encoded query smuggling.
      { id: "rt8a", route: `/a%2Fb%3Ftoken%3D${CANARY}-RT8`, expected: null },
      {
        id: "rt8b",
        route: `/exam/a%2Fb%3Ftoken%3D${CANARY}-RT8/take`,
        expected: "/exam/:attemptId/take",
      },
      // RT-12B opaque-scheme userinfo credentials.
      {
        id: "rt12b",
        route: `user:${CANARY}-RT12B@example.com/path`,
        expected: null,
      },
      // RT-12C data: URL payload.
      { id: "rt12c", route: `data:text/html,${CANARY}-RT12C`, expected: null },
      // RT-14B malformed with raw CRLF.
      { id: "rt14b", route: `http://[\r\n${CANARY}-RT14B?x=y`, expected: null },
      // Semantic-equivalence variants.
      { id: "case", route: "/EXAM/list", expected: null },
      { id: "unicode", route: `/${CANARY}-中文/list`, expected: null },
      {
        id: "crlf-param",
        route: "/exam/a\r\nb/start",
        expected: "/exam/:examId/start",
      },
      {
        id: "double-enc",
        route: `/exam/%252F%253Ftoken%253D${CANARY}/take`,
        expected: "/exam/:attemptId/take",
      },
      {
        id: "opaque-id",
        route: "/admin/attempts/not-a-uuid-opaque",
        expected: "/admin/attempts/:id",
      },
      {
        id: "secret-tail",
        route: `/admin/exams/${CANARY}-TAIL`,
        expected: "/admin/exams/:id",
      },
      { id: "unknown", route: "/admin/nonexistent-page", expected: null },
      // WHATWG URL normalization decodes percent-encoded dot segments
      // (%2e%2e == ".."), resolving this to the canonical /admin/users —
      // the same thing the browser address bar would show. Output stays a
      // member of the closed set; %2F/%3F stay opaque (see rt8b).
      {
        id: "traversal",
        route: "/exam/%2e%2e/admin/users",
        expected: "/admin/users",
      },
      { id: "empty-seg", route: "/admin//users", expected: null },
      { id: "root", route: "/", expected: null },
      // Registered routes keep their diagnostic signal.
      {
        id: "legit-take",
        route: "/exam/e3b0c442-2fc8-4570-b9f2-9a2807b1b1e1/take",
        expected: "/exam/:attemptId/take",
      },
      { id: "legit-list", route: "/exam/list", expected: "/exam/list" },
    ];

    it("HTTP ingest: every adversarial route lands at-rest as a template or NULL, zero canary bytes", async () => {
      const response = await ctx.app.inject({
        method: "POST",
        url: "/api/client-events",
        cookies: { "auth-token": ctx.adminToken },
        payload: {
          events: attackMatrix.map((c) =>
            validEvent({
              name: `test.event.route864.${c.id}`,
              route: c.route,
              eventId: `rt864-${c.id}-0000000000`,
            }),
          ),
        },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ accepted: attackMatrix.length });

      const templateSet = new Set(SPA_ROUTE_TEMPLATES);
      for (const c of attackMatrix) {
        const row = await fetchRow(`test.event.route864.${c.id}`);
        expect(row, c.id).not.toBeNull();
        expect(row!.route, c.id).toBe(c.expected);
        if (row!.route !== null) {
          expect(templateSet.has(row!.route!), c.id).toBe(true);
        }
        expect(JSON.stringify(row), c.id).not.toContain(CANARY);
      }

      for (const c of attackMatrix) {
        await ctx.db
          .delete(schema.clientEvents)
          .where(eq(schema.clientEvents.name, `test.event.route864.${c.id}`));
      }
    });

    it("a batch WITHOUT route (undefined) still persists route = NULL", async () => {
      const response = await ctx.app.inject({
        method: "POST",
        url: "/api/client-events",
        cookies: { "auth-token": ctx.adminToken },
        payload: {
          events: [validEvent({ name: "test.event.route864.absent" })],
        },
      });
      expect(response.statusCode).toBe(200);
      const row = await fetchRow("test.event.route864.absent");
      expect(row!.route).toBeNull();

      await ctx.db
        .delete(schema.clientEvents)
        .where(eq(schema.clientEvents.name, "test.event.route864.absent"));
    });
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

    it("the same eventId under a DIFFERENT organization stores both rows (org boundary in the key)", async () => {
      // Cross-tenant proof at the route level. The same-user/same-eventId org
      // boundary is pinned by clientEventRepo.test.ts, where the repo accepts
      // a synthetic shared userId across two organization contexts.
      const otherOrgId = crypto.randomUUID();
      const otherUserId = crypto.randomUUID();
      const now = new Date();
      await ctx.db.insert(schema.organizations).values({
        id: otherOrgId,
        name: "Idempotency Org B",
        displayName: "Idempotency Org B",
        slug: `idem-org-${otherOrgId}`,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert(schema.users).values({
        id: otherUserId,
        organizationId: otherOrgId,
        username: `idem-user-${otherUserId}`,
        passwordHash: "unused",
        name: "Other Org User",
        role: "Candidate",
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert(schema.userRoleAssignments).values({
        id: crypto.randomUUID(),
        organizationId: otherOrgId,
        userId: otherUserId,
        role: "Candidate",
        isPrimary: true,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
      const otherToken = signJWT(
        {
          actorId: otherUserId,
          role: "Candidate",
          organizationId: otherOrgId,
          authEpoch: 0,
        },
        getRuntimeConfig().authSecret.jwtSecret,
      );

      const eventId = "evt-idem-org-000000001";
      await postBatch(ctx.adminToken, [
        validEvent({ name: "test.event.idem-org", eventId }),
      ]);
      await postBatch(otherToken, [
        validEvent({ name: "test.event.idem-org", eventId }),
      ]);
      expect(await countRows("test.event.idem-org")).toBe(2);
      const rows = await ctx.db
        .select({ organizationId: schema.clientEvents.organizationId })
        .from(schema.clientEvents)
        .where(eq(schema.clientEvents.name, "test.event.idem-org"));
      expect(new Set(rows.map((r) => r.organizationId))).toEqual(
        new Set([ctx.org.id, otherOrgId]),
      );

      await ctx.db
        .delete(schema.clientEvents)
        .where(eq(schema.clientEvents.name, "test.event.idem-org"));
      await ctx.db
        .delete(schema.userRoleAssignments)
        .where(eq(schema.userRoleAssignments.userId, otherUserId));
      await ctx.db.delete(schema.users).where(eq(schema.users.id, otherUserId));
      await ctx.db
        .delete(schema.organizations)
        .where(eq(schema.organizations.id, otherOrgId));
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

  // #874 PR-W write representability: year 0000 is not representable as a
  // PostgreSQL timestamptz (22008 date/time field value out of range), so on
  // the pre-PR-W schema a single client-claimed year-0000 instant failed the
  // whole batch INSERT with 500 and blocked its schema-valid peers. The
  // frozen contract (adjudication §C4): the accepted client-claim domain is
  // years 0001–9999; year 0000 is rejected at the schema boundary with the
  // STANDARD 400 VALIDATION_ERROR envelope carrying the precise per-event
  // field path `events.<index>.occurredAt`, and the whole batch stays
  // atomic (400 → zero rows). The success protocol is unchanged.
  describe("write representability (#874 PR-W)", () => {
    async function countRows(name: string): Promise<number> {
      const rows = await ctx.db
        .select({ id: schema.clientEvents.id })
        .from(schema.clientEvents)
        .where(eq(schema.clientEvents.name, name));
      return rows.length;
    }

    function detailFields(body: {
      error?: { details?: { fields?: Array<{ field: string }> } };
    }): string[] {
      return (body.error?.details?.fields ?? []).map((f) => f.field);
    }

    it("rejects a single year-0000 event with the standard 400 and the events.0.occurredAt path, writing zero rows", async () => {
      const response = await ctx.app.inject({
        method: "POST",
        url: "/api/client-events",
        cookies: { "auth-token": ctx.adminToken },
        payload: {
          events: [
            validEvent({
              name: "test.event.prw-y0-single",
              occurredAt: "0000-01-01T00:00:00.000Z",
            }),
          ],
        },
      });
      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
      expect(detailFields(body)).toContain("events.0.occurredAt");
      expect(await countRows("test.event.prw-y0-single")).toBe(0);
    });

    it("rejects a mixed [valid, year-0000, valid] batch atomically: 400, zero rows for ANY event, sub-batch index in the field path", async () => {
      const response = await ctx.app.inject({
        method: "POST",
        url: "/api/client-events",
        cookies: { "auth-token": ctx.adminToken },
        payload: {
          events: [
            validEvent({ name: "test.event.prw-mix-a" }),
            validEvent({
              name: "test.event.prw-mix-poison",
              occurredAt: "0000-06-15T12:00:00.000Z",
            }),
            validEvent({ name: "test.event.prw-mix-b" }),
          ],
        },
      });
      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
      // The index must be the event's actual position in THIS POST body.
      expect(detailFields(body)).toContain("events.1.occurredAt");
      // Atomic batch: the poison blocks its own row, never its peers'.
      expect(await countRows("test.event.prw-mix-a")).toBe(0);
      expect(await countRows("test.event.prw-mix-poison")).toBe(0);
      expect(await countRows("test.event.prw-mix-b")).toBe(0);
    });

    it("lists every invalid event index when several events are invalid", async () => {
      const response = await ctx.app.inject({
        method: "POST",
        url: "/api/client-events",
        cookies: { "auth-token": ctx.adminToken },
        payload: {
          events: [
            validEvent({
              name: "test.event.prw-multi-0",
              occurredAt: "0000-01-01T00:00:00.000Z",
            }),
            validEvent({ name: "test.event.prw-multi-1" }),
            validEvent({
              name: "test.event.prw-multi-2",
              occurredAt: "0000-12-31T23:59:59.999Z",
            }),
          ],
        },
      });
      expect(response.statusCode).toBe(400);
      const body = response.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
      const fields = detailFields(body);
      expect(fields).toContain("events.0.occurredAt");
      expect(fields).toContain("events.2.occurredAt");
      expect(fields).not.toContain("events.1.occurredAt");
      expect(await countRows("test.event.prw-multi-1")).toBe(0);
    });

    it("rejects an all-invalid batch and still writes zero rows", async () => {
      const response = await ctx.app.inject({
        method: "POST",
        url: "/api/client-events",
        cookies: { "auth-token": ctx.adminToken },
        payload: {
          events: [
            validEvent({
              name: "test.event.prw-all-0",
              occurredAt: "0000-01-01T00:00:00.000Z",
            }),
            validEvent({
              name: "test.event.prw-all-1",
              occurredAt: "0000-01-01T00:00:00.000Z",
            }),
          ],
        },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("VALIDATION_ERROR");
      expect(await countRows("test.event.prw-all-0")).toBe(0);
      expect(await countRows("test.event.prw-all-1")).toBe(0);
    });

    it("keeps the 0001–9999 support range: boundary years are still accepted", async () => {
      const response = await ctx.app.inject({
        method: "POST",
        url: "/api/client-events",
        cookies: { "auth-token": ctx.adminToken },
        payload: {
          events: [
            validEvent({
              name: "test.event.prw-lo",
              occurredAt: "0001-01-01T00:00:00.000Z",
            }),
            validEvent({
              name: "test.event.prw-hi",
              occurredAt: "9999-12-31T23:59:59.000Z",
            }),
          ],
        },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ accepted: 2 });
      expect(await countRows("test.event.prw-lo")).toBe(1);
      expect(await countRows("test.event.prw-hi")).toBe(1);

      await ctx.db
        .delete(schema.clientEvents)
        .where(eq(schema.clientEvents.name, "test.event.prw-lo"));
      await ctx.db
        .delete(schema.clientEvents)
        .where(eq(schema.clientEvents.name, "test.event.prw-hi"));
    });
  });
});
