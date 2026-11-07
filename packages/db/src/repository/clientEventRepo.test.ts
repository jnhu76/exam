import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { RequestContext } from "@exam/domain";
import { beforeAll, describe, expect, it, afterAll } from "vitest";
import { getIsolatedTestDb } from "../testDb.js";
import { createClientEventRepo } from "./clientEventRepo.js";
import { createOrganizationRepo } from "./organizationRepo.js";
import { schema } from "../schema/pg.js";
import type { Database } from "../types.js";

function createContext(organizationId: string): RequestContext {
  return {
    actorId: randomUUID(),
    organizationId,
    role: "Admin",
    permissions: [],
    sessionId: randomUUID(),
  };
}

describe("clientEventRepo.createMany", () => {
  let db: Database;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const result = await getIsolatedTestDb("db-clientEventRepo");
    db = result.db;
    cleanup = result.cleanup;
  }, 30_000);

  afterAll(async () => {
    await cleanup();
  }, 30_000);

  async function seedOrg(name: string) {
    const orgRepo = createOrganizationRepo(db);
    const org = await orgRepo.create(createContext("system"), {
      name,
      displayName: name,
      slug: `${name.toLowerCase()}-${randomUUID().slice(0, 8)}`,
    });
    return org.id;
  }

  it("inserts a batch scoped to the context organizationId", async () => {
    const orgId = await seedOrg("ClientEventOrg");
    const ctx = createContext(orgId);
    const repo = createClientEventRepo(db);
    const receivedAt = new Date();

    const inserted = await repo.createMany(ctx, [
      {
        userId: ctx.actorId,
        attemptId: null,
        examId: null,
        questionId: null,
        kind: "log",
        level: "warn",
        name: "test.repo.one",
        route: null,
        occurredAt: new Date("2026-06-25T00:00:00.000Z"),
        receivedAt,
        clientSessionId: null,
        eventId: null,
        metadata: { foo: "bar" },
        userAgent: "vitest",
      },
      {
        userId: ctx.actorId,
        attemptId: null,
        examId: null,
        questionId: null,
        kind: "log",
        level: "error",
        name: "test.repo.two",
        route: null,
        occurredAt: new Date("2026-06-25T00:00:01.000Z"),
        receivedAt,
        clientSessionId: null,
        eventId: null,
        metadata: {},
        userAgent: null,
      },
    ]);

    expect(inserted).toEqual({ inserted: 2, deduplicated: 0 });

    const rows = await db
      .select()
      .from(schema.clientEvents)
      .where(eq(schema.clientEvents.organizationId, orgId));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.userId === ctx.actorId)).toBe(true);
    expect(rows.map((r) => r.name).sort()).toEqual([
      "test.repo.one",
      "test.repo.two",
    ]);
    expect(rows[0]!.metadata).toEqual({ foo: "bar" });

    // Clean up this org's rows.
    await db
      .delete(schema.clientEvents)
      .where(eq(schema.clientEvents.organizationId, orgId));
  });

  it("returns 0 and writes nothing for an empty batch", async () => {
    const orgId = await seedOrg("ClientEventEmpty");
    const ctx = createContext(orgId);
    const repo = createClientEventRepo(db);

    const result = await repo.createMany(ctx, []);
    expect(result).toEqual({ inserted: 0, deduplicated: 0 });
  });

  it("keeps events isolated per organization", async () => {
    const orgA = await seedOrg("ClientEventOrgA");
    const orgB = await seedOrg("ClientEventOrgB");
    const repo = createClientEventRepo(db);
    const marker = `isolation.${randomUUID()}`;

    await repo.createMany(createContext(orgA), [
      {
        userId: "u-a",
        attemptId: null,
        examId: null,
        questionId: null,
        kind: "log",
        level: "info",
        name: marker,
        route: null,
        occurredAt: new Date(),
        receivedAt: new Date(),
        clientSessionId: null,
        eventId: null,
        metadata: {},
        userAgent: null,
      },
    ]);

    const inB = await db
      .select()
      .from(schema.clientEvents)
      .where(eq(schema.clientEvents.organizationId, orgB));
    expect(inB.filter((r) => r.name === marker)).toHaveLength(0);

    await db
      .delete(schema.clientEvents)
      .where(eq(schema.clientEvents.name, marker));
  });

  it("keeps the SAME user+eventId in two organizations as two rows (#863 org boundary)", async () => {
    // The unique key is (organization_id, user_id, event_id). Same userId and
    // eventId across organizations MUST both insert; a regression to
    // (user_id, event_id) would dedupe the second one.
    const orgA = await seedOrg("ClientEventIdemOrgA");
    const orgB = await seedOrg("ClientEventIdemOrgB");
    const repo = createClientEventRepo(db);
    const marker = `idem.org.${randomUUID()}`;
    const userId = randomUUID();
    const eventId = "evt-repo-org-00000001";
    const row = {
      userId,
      attemptId: null,
      examId: null,
      questionId: null,
      kind: "log" as const,
      level: "info" as const,
      name: marker,
      route: null,
      occurredAt: new Date(),
      receivedAt: new Date(),
      clientSessionId: null,
      eventId,
      metadata: {},
      userAgent: null,
    };

    const inA = await repo.createMany(createContext(orgA), [row]);
    const inB = await repo.createMany(createContext(orgB), [row]);
    expect(inA).toEqual({ inserted: 1, deduplicated: 0 });
    expect(inB).toEqual({ inserted: 1, deduplicated: 0 });

    const rows = await db
      .select()
      .from(schema.clientEvents)
      .where(eq(schema.clientEvents.name, marker));
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.organizationId))).toEqual(
      new Set([orgA, orgB]),
    );

    await db
      .delete(schema.clientEvents)
      .where(eq(schema.clientEvents.name, marker));
  });
});

describe("clientEventRepo read methods (proctor monitoring)", () => {
  let db: Database;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const result = await getIsolatedTestDb("db-clientEventRepo-read");
    db = result.db;
    cleanup = result.cleanup;
  }, 30_000);

  afterAll(async () => {
    await cleanup();
  }, 30_000);

  async function seedOrg(name: string) {
    const orgRepo = createOrganizationRepo(db);
    const org = await orgRepo.create(createContext("system"), {
      name,
      displayName: name,
      slug: `${name.toLowerCase()}-${randomUUID().slice(0, 8)}`,
    });
    return org.id;
  }

  /** Seeds N events for an attempt with a given name. */
  async function seedEvents(
    orgId: string,
    rows: Array<{
      attemptId: string;
      examId: string;
      name: string;
      level?: string;
      metadata?: Record<string, unknown>;
    }>,
  ) {
    const ctx = createContext(orgId);
    const repo = createClientEventRepo(db);
    const at = new Date();
    await repo.createMany(
      ctx,
      rows.map((r, i) => ({
        userId: null,
        attemptId: r.attemptId,
        examId: r.examId,
        questionId: null,
        kind: "exam_telemetry",
        level: r.level ?? "info",
        name: r.name,
        route: null,
        occurredAt: new Date(at.getTime() + i),
        receivedAt: new Date(at.getTime() + i),
        clientSessionId: null,
        eventId: null,
        metadata: r.metadata ?? {},
        userAgent: null,
      })),
    );
  }

  it("countByNamesForExam groups counts by (attemptId, name) for the exam", async () => {
    const orgId = await seedOrg("ProctorCountOrg");
    const attemptA = randomUUID();
    const attemptB = randomUUID();
    const examId = randomUUID();
    await seedEvents(orgId, [
      { attemptId: attemptA, examId, name: "visibility_lost" },
      { attemptId: attemptA, examId, name: "visibility_lost" },
      { attemptId: attemptA, examId, name: "browser_offline" },
      { attemptId: attemptA, examId, name: "answer_autosave_failed" },
      { attemptId: attemptA, examId, name: "answer_manual_save_failed" },
      { attemptId: attemptA, examId, name: "submit_failed" },
      { attemptId: attemptB, examId, name: "visibility_lost" },
    ]);

    const repo = createClientEventRepo(db);
    const counts = await repo.countByNamesForExam(
      createContext(orgId),
      examId,
      [
        "visibility_lost",
        "browser_offline",
        "answer_autosave_failed",
        "answer_manual_save_failed",
        "submit_failed",
        "answer_autosave_success",
      ],
    );

    const a = counts.get(attemptA);
    expect(a?.get("visibility_lost")).toBe(2);
    expect(a?.get("browser_offline")).toBe(1);
    expect(a?.get("answer_autosave_failed")).toBe(1);
    expect(a?.get("answer_manual_save_failed")).toBe(1);
    expect(a?.get("submit_failed")).toBe(1);
    expect(a?.get("answer_autosave_success")).toBeUndefined();
    expect(counts.get(attemptB)?.get("visibility_lost")).toBe(1);

    // cleanup
    await db
      .delete(schema.clientEvents)
      .where(eq(schema.clientEvents.examId, examId));
  });

  it("countByNamesForExam is tenant-isolated (other org invisible)", async () => {
    const orgA = await seedOrg("ProctorIsoA");
    const orgB = await seedOrg("ProctorIsoB");
    const examId = randomUUID();
    const attemptId = randomUUID();
    await seedEvents(orgA, [{ attemptId, examId, name: "visibility_lost" }]);
    // orgB queries the same examId — must see nothing.
    const repo = createClientEventRepo(db);
    const counts = await repo.countByNamesForExam(createContext(orgB), examId, [
      "visibility_lost",
    ]);
    expect(counts.get(attemptId)).toBeUndefined();

    await db
      .delete(schema.clientEvents)
      .where(eq(schema.clientEvents.examId, examId));
  });

  it("listTimelinePrefixByAttempt orders by receivedAt (occurredAt never decides) and bounds the prefix", async () => {
    const orgId = await seedOrg("ProctorTimelineOrg");
    const attemptId = randomUUID();
    const examId = randomUUID();
    const repo = createClientEventRepo(db);
    const at = new Date();
    // receivedAt ascends with index while occurredAt (client-asserted,
    // display-only) DESCENDS: the returned order must follow receivedAt
    // alone — a discriminating seed that catches an occurredAt ordering.
    await repo.createMany(createContext(orgId), [
      {
        userId: null,
        attemptId,
        examId,
        questionId: null,
        kind: "exam_telemetry",
        level: "info",
        name: "visibility_lost",
        route: null,
        occurredAt: new Date(at.getTime() + 9000),
        receivedAt: new Date(at.getTime() + 1000),
        clientSessionId: null,
        eventId: null,
        metadata: {},
        userAgent: null,
      },
      {
        userId: null,
        attemptId,
        examId,
        questionId: null,
        kind: "exam_telemetry",
        level: "warn",
        name: "answer_autosave_failed",
        route: null,
        occurredAt: new Date(at.getTime() + 8000),
        receivedAt: new Date(at.getTime() + 2000),
        clientSessionId: null,
        eventId: null,
        metadata: { answer: "SECRET_ANSWER", token: "abc", errorCode: "NET" },
        userAgent: null,
      },
      {
        userId: null,
        attemptId,
        examId,
        questionId: null,
        kind: "exam_telemetry",
        level: "info",
        name: "browser_online",
        route: null,
        occurredAt: new Date(at.getTime() + 7000),
        receivedAt: new Date(at.getTime() + 3000),
        clientSessionId: null,
        eventId: null,
        metadata: {},
        userAgent: null,
      },
    ]);

    const rows = await repo.listTimelinePrefixByAttempt(
      createContext(orgId),
      attemptId,
      10,
    );
    expect(rows).toHaveLength(3);
    // Newest first by the server-owned receivedAt (occurredAt runs the other
    // way here and must not decide).
    expect(rows.map((r) => r.name)).toEqual([
      "browser_online",
      "answer_autosave_failed",
      "visibility_lost",
    ]);

    // Prefix semantics: LIMIT bounds the window to the newest prefixSize
    // rows of the (receivedAt DESC, id DESC) order.
    const first2 = await repo.listTimelinePrefixByAttempt(
      createContext(orgId),
      attemptId,
      2,
    );
    expect(first2.map((r) => r.name)).toEqual([
      "browser_online",
      "answer_autosave_failed",
    ]);

    // Safe columns present.
    for (const r of rows) {
      expect(typeof r.id).toBe("string");
      expect(typeof r.name).toBe("string");
      expect(["debug", "info", "warn", "error"]).toContain(r.level);
      expect(["log", "exam_telemetry", "proctor"]).toContain(r.kind);
      // The repo returns the raw metadata blob; the API service applies the
      // per-event-name allowlist projection (drop answer/token/cookie/...).
      expect(typeof r.metadata).toBe("object");
    }
    // No userId / userAgent leak through this projection.
    expect(rows[0]).not.toHaveProperty("userId");
    expect(rows[0]).not.toHaveProperty("userAgent");

    await db
      .delete(schema.clientEvents)
      .where(eq(schema.clientEvents.attemptId, attemptId));
  });

  it("lastReceivedAtForExam maps each attempt to its max receivedAt", async () => {
    const orgId = await seedOrg("ProctorLastOrg");
    const attemptA = randomUUID();
    const attemptB = randomUUID();
    const examId = randomUUID();
    await seedEvents(orgId, [
      { attemptId: attemptA, examId, name: "visibility_lost" },
      { attemptId: attemptA, examId, name: "browser_offline" },
      { attemptId: attemptB, examId, name: "visibility_lost" },
    ]);

    const repo = createClientEventRepo(db);
    const lastByAttempt = await repo.lastReceivedAtForExam(
      createContext(orgId),
      examId,
    );
    expect(lastByAttempt.has(attemptA)).toBe(true);
    expect(lastByAttempt.has(attemptB)).toBe(true);
    expect(lastByAttempt.get(attemptA) instanceof Date).toBe(true);
    expect(lastByAttempt.get(attemptB) instanceof Date).toBe(true);

    // Cross-check against a direct max query for attemptA (2 events).
    const direct = await db
      .select({ max: sql`max(${schema.clientEvents.receivedAt})` })
      .from(schema.clientEvents)
      .where(eq(schema.clientEvents.attemptId, attemptA));
    const directMax = new Date(direct[0]!.max as string).getTime();
    expect(lastByAttempt.get(attemptA)!.getTime()).toBe(directMax);

    await db
      .delete(schema.clientEvents)
      .where(eq(schema.clientEvents.examId, examId));
  });
});

/**
 * #874 PR-R (temporal read totality): rows already stored with extreme
 * client-asserted occurredAt must not block the attempt timeline.
 *
 * Failure this guards: the native column projection decodes timestamptz via
 * the driver's `new Date(text)` parser. Node maps years 1–99 onto 1900+y
 * (0001 → 2001) and cannot parse pre-1901 second-precision LMT offsets
 * (`+08:05:43` → Invalid Date), so the service layer's `.toISOString()` either
 * throws RangeError (timeline 500) or silently projects a wrong year.
 *
 * The repo contract is the adjudicated SELECT projection: `occurredAt` leaves
 * this query as UTC ISO TEXT with the stored year and microseconds intact,
 * independent of the session TimeZone. Ordering (receivedAt DESC, id DESC),
 * prefix windows, org scoping, and retention are unchanged.
 */
describe("clientEventRepo.listTimelinePrefixByAttempt extreme-year read totality (#874 PR-R)", () => {
  let db: Database;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const result = await getIsolatedTestDb("db-clientEventRepo-extreme");
    db = result.db;
    cleanup = result.cleanup;
  }, 30_000);

  afterAll(async () => {
    await cleanup();
  }, 30_000);

  async function seedOrg(name: string) {
    const orgRepo = createOrganizationRepo(db);
    const org = await orgRepo.create(createContext("system"), {
      name,
      displayName: name,
      slug: `${name.toLowerCase()}-${randomUUID().slice(0, 8)}`,
    });
    return org.id;
  }

  /**
   * Stored-row fixture: years the current wire contract supports (0001–9999),
   * each carrying sub-second microseconds, inserted directly as EXISTING rows
   * (the .123456 µs storage the current ms write path can no longer produce
   * but older rows hold). receivedAt stays modern and distinct so ordering is
   * deterministic and unrelated to the occurredAt extremes.
   */
  const EXTREME_YEARS = [
    "0001",
    "0099",
    "0100",
    "1900",
    "1901",
    "1970",
    "2038",
    "9999",
  ] as const;

  /** The exact UTC text each stored instant must project as. */
  const expectedOccurredAt = (year: string): string =>
    `${year}-01-02T03:04:05.123456Z`;

  async function seedExtremeRows(orgId: string, attemptId: string) {
    const base = new Date("2026-09-15T10:00:00.000Z");
    for (let i = 0; i < EXTREME_YEARS.length; i++) {
      await db.execute(sql`
        INSERT INTO client_events
          (id, organization_id, user_id, attempt_id, exam_id, kind, level, name,
           occurred_at, received_at, metadata)
        VALUES (
          ${randomUUID()}, ${orgId}, NULL, ${attemptId}, NULL,
          'exam_telemetry', 'info', ${`extreme_${EXTREME_YEARS[i]}`},
          ${`${EXTREME_YEARS[i]}-01-02 03:04:05.123456+00`}::timestamptz,
          ${new Date(base.getTime() + i * 1000).toISOString()}::timestamptz,
          '{}'
        )
      `);
    }
  }

  /**
   * The session-timezone matrix: the projection must yield the SAME UTC text
   * regardless of the database session TimeZone. Asia/Shanghai is the
   * discriminating case — pre-1901 instants render with a second-precision LMT
   * offset there, which the driver's Date decoder turns into Invalid Date.
   */
  it.each(["UTC", "Asia/Shanghai"] as const)(
    "projects stored extreme occurredAt as exact UTC text under session TimeZone %s (µs preserved, no wrong year, no Invalid Date)",
    async (timeZone) => {
      const orgId = await seedOrg(`ExtremeRead-${timeZone}`);
      const attemptId = randomUUID();
      await seedExtremeRows(orgId, attemptId);

      // max:1 pinned connection (isolated-schema fixture): the session SET
      // applies to every statement this fixture issues afterwards. The
      // identifier comes from the fixed it.each tuple, never from input.
      await db.execute(sql.raw(`SET TIME ZONE '${timeZone}'`));

      const repo = createClientEventRepo(db);
      const rows = await repo.listTimelinePrefixByAttempt(
        createContext(orgId),
        attemptId,
        10,
      );

      expect(rows).toHaveLength(EXTREME_YEARS.length);
      for (const row of rows) {
        // The runtime value must BE a string, not a Date in string clothing.
        expect(typeof row.occurredAt).toBe("string");
        const year = row.name.slice("extreme_".length);
        expect(row.occurredAt).toBe(expectedOccurredAt(year));
        // Ordering authority untouched: modern receivedAt still decodes.
        expect(row.receivedAt instanceof Date).toBe(true);
      }

      // Prefix-window membership: fetching a smaller prefix then the full one
      // must not duplicate or lose any stored row (page-boundary totality).
      const prefix4 = await repo.listTimelinePrefixByAttempt(
        createContext(orgId),
        attemptId,
        4,
      );
      expect(prefix4).toHaveLength(4);
      const allNames = rows.map((r) => r.name);
      const prefix4Names = prefix4.map((r) => r.name);
      expect(new Set(prefix4Names).size).toBe(4);
      for (const name of prefix4Names) {
        expect(allNames).toContain(name);
      }
      // Newest first by server-owned receivedAt: the 4-row prefix is exactly
      // the head of the 10-row prefix.
      expect(prefix4Names).toEqual(allNames.slice(0, 4));

      await db
        .delete(schema.clientEvents)
        .where(eq(schema.clientEvents.attemptId, attemptId));
    },
    30_000,
  );

  it("keeps shared-receivedAt rows total and id-tiebroken while projecting occurredAt text", async () => {
    const orgId = await seedOrg("ExtremeReadShared");
    const attemptId = randomUUID();
    const sharedReceivedAt = new Date("2026-09-15T10:00:00.000Z");
    const sharedIds = [
      "00000000-0000-4000-8000-0000000000a1",
      "00000000-0000-4000-8000-0000000000a2",
      "00000000-0000-4000-8000-0000000000a3",
    ];
    for (const id of sharedIds) {
      await db.execute(sql`
        INSERT INTO client_events
          (id, organization_id, user_id, attempt_id, exam_id, kind, level, name,
           occurred_at, received_at, metadata)
        VALUES (
          ${id}, ${orgId}, NULL, ${attemptId}, NULL,
          'exam_telemetry', 'info', ${`shared_${id.slice(-2)}`},
          '1900-01-01 00:00:00.123456+00'::timestamptz,
          ${sharedReceivedAt.toISOString()}::timestamptz,
          '{}'
        )
      `);
    }

    await db.execute(sql.raw(`SET TIME ZONE 'Asia/Shanghai'`));

    const rows = await createClientEventRepo(db).listTimelinePrefixByAttempt(
      createContext(orgId),
      attemptId,
      10,
    );
    // All three tied rows surface exactly once (no loss, no duplication) with
    // the deterministic id DESC tiebreaker.
    expect(rows.map((r) => r.id)).toEqual([...sharedIds].reverse());
    for (const row of rows) {
      expect(row.occurredAt).toBe("1900-01-01T00:00:00.123456Z");
    }

    await db
      .delete(schema.clientEvents)
      .where(eq(schema.clientEvents.attemptId, attemptId));
  });
});
