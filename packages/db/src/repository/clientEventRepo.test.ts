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
  });

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
        metadata: {},
        userAgent: null,
      },
    ]);

    expect(inserted).toBe(2);

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

    const inserted = await repo.createMany(ctx, []);
    expect(inserted).toBe(0);
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
  });

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

  it("listRecentByAttempt returns timeline rows (raw metadata returned; filtering is the service's job)", async () => {
    const orgId = await seedOrg("ProctorTimelineOrg");
    const attemptId = randomUUID();
    const examId = randomUUID();
    await seedEvents(orgId, [
      { attemptId, examId, name: "visibility_lost", level: "info" },
      {
        attemptId,
        examId,
        name: "answer_autosave_failed",
        level: "warn",
        metadata: { answer: "SECRET_ANSWER", token: "abc", errorCode: "NET" },
      },
      { attemptId, examId, name: "browser_online", level: "info" },
    ]);

    const repo = createClientEventRepo(db);
    const rows = await repo.listRecentByAttempt(
      createContext(orgId),
      attemptId,
      {
        limit: 10,
      },
    );
    expect(rows).toHaveLength(3);
    // Most recent first (occurredAt desc).
    expect(rows[0]!.occurredAt.getTime()).toBeGreaterThanOrEqual(
      rows[2]!.occurredAt.getTime(),
    );
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
