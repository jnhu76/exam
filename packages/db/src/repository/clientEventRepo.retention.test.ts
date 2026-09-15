import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { RequestContext } from "@exam/domain";
import { beforeAll, describe, expect, it, afterAll } from "vitest";
import { getIsolatedTestDb } from "../testDb.js";
import { createClientEventRepo } from "./clientEventRepo.js";
import { createOrganizationRepo } from "./organizationRepo.js";
import { retentionRuns, schema } from "../schema/pg.js";
import type { Database } from "../types.js";

/**
 * Client-event retention primitive (#544).
 *
 * Contract under test: `deleteOlderThan` deletes exactly the caller-org rows
 * with server-owned `receivedAt` strictly below the cutoff (boundary row is
 * kept), is idempotent, never touches any other table, and is fully
 * convergent from a bare run-once invocation (no in-memory state).
 *
 * Each test creates FRESH organizations: cutoffs move forward with wall-clock
 * time, so rows kept by an earlier test's boundary assertion are expired by a
 * later test's pass. Org isolation keeps exact deleted-count assertions sound.
 */
function createContext(organizationId: string): RequestContext {
  return {
    actorId: randomUUID(),
    organizationId,
    role: "Admin",
    permissions: [],
    sessionId: randomUUID(),
  };
}

describe("clientEventRepo.deleteOlderThan (retention primitive)", () => {
  let db: Database;
  let cleanup: () => Promise<void>;
  let repo: ReturnType<typeof createClientEventRepo>;
  let orgCounter = 0;

  beforeAll(async () => {
    const result = await getIsolatedTestDb("db-clientEventRetention");
    db = result.db;
    cleanup = result.cleanup;
    repo = createClientEventRepo(db);
  }, 30_000);

  afterAll(async () => {
    await cleanup();
  }, 30_000);

  const DAY_MS = 24 * 60 * 60 * 1000;

  /** Fresh org pair per test — immune to cross-test cutoff drift. */
  async function freshOrgPair(): Promise<[string, string]> {
    const orgRepo = createOrganizationRepo(db);
    const mk = async (name: string) =>
      orgRepo.create(createContext("system"), {
        name,
        displayName: name,
        slug: `${name.toLowerCase()}-${randomUUID().slice(0, 8)}`,
      });
    orgCounter++;
    const a = await mk(`RetentionA${orgCounter}`);
    const b = await mk(`RetentionB${orgCounter}`);
    return [a.id, b.id];
  }

  function eventRow(name: string, receivedAt: Date) {
    return {
      userId: null,
      attemptId: null,
      examId: null,
      questionId: null,
      kind: "log",
      level: "info",
      name,
      route: null,
      occurredAt: receivedAt,
      receivedAt,
      clientSessionId: null,
      metadata: {},
      userAgent: null,
    };
  }

  async function countRows(orgId: string, name: string): Promise<number> {
    const rows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(sql`client_events`)
      .where(sql`organization_id = ${orgId} and name = ${name}`);
    return Number(rows[0]!.n);
  }

  it("T11+T12+T13: deletes strictly-before-cutoff rows, keeps the exact boundary and fresh rows", async () => {
    const [orgA] = await freshOrgPair();
    const ctxA = createContext(orgA);
    const now = new Date();
    const cutoff = new Date(now.getTime() - 30 * DAY_MS);

    await repo.createMany(ctxA, [
      eventRow("ret-old", new Date(cutoff.getTime() - DAY_MS)), // T11: expired
      eventRow("ret-boundary", new Date(cutoff.getTime())), // T12: exact boundary
      eventRow("ret-fresh", new Date(now.getTime())), // T13: fresh
    ]);

    const deleted = await repo.deleteOlderThan(ctxA, cutoff);
    expect(deleted).toBe(1);

    expect(await countRows(orgA, "ret-old")).toBe(0);
    expect(await countRows(orgA, "ret-boundary")).toBe(1);
    expect(await countRows(orgA, "ret-fresh")).toBe(1);
  });

  it("T14: cleanup is org-isolated — org B's expired rows survive org A's pass", async () => {
    const [orgA, orgB] = await freshOrgPair();
    const now = new Date();
    const cutoff = new Date(now.getTime() - 30 * DAY_MS);

    await repo.createMany(createContext(orgA), [
      eventRow("ret-iso-a", new Date(cutoff.getTime() - DAY_MS)),
    ]);
    await repo.createMany(createContext(orgB), [
      eventRow("ret-iso-b", new Date(cutoff.getTime() - DAY_MS)),
    ]);

    const deleted = await repo.deleteOlderThan(createContext(orgA), cutoff);
    expect(deleted).toBe(1);

    expect(await countRows(orgA, "ret-iso-a")).toBe(0);
    expect(await countRows(orgB, "ret-iso-b")).toBe(1); // untouched until B's own pass
    const deletedB = await repo.deleteOlderThan(createContext(orgB), cutoff);
    expect(deletedB).toBe(1);
    expect(await countRows(orgB, "ret-iso-b")).toBe(0);
  });

  it("T15: is idempotent — a second run deletes 0 and the final state is identical", async () => {
    const [orgA] = await freshOrgPair();
    const ctxA = createContext(orgA);
    const now = new Date();
    const cutoff = new Date(now.getTime() - 30 * DAY_MS);
    await repo.createMany(ctxA, [
      eventRow("ret-idem", new Date(cutoff.getTime() - 2 * DAY_MS)),
    ]);

    const first = await repo.deleteOlderThan(ctxA, cutoff);
    const rowsAfterFirst = await countRows(orgA, "ret-idem");
    const second = await repo.deleteOlderThan(ctxA, cutoff);
    const rowsAfterSecond = await countRows(orgA, "ret-idem");

    expect(first).toBe(1);
    expect(second).toBe(0);
    expect(rowsAfterFirst).toBe(rowsAfterSecond);
  });

  it("T17: table guard — sentinel rows in adjacent authoritative tables are never touched", async () => {
    const [orgA] = await freshOrgPair();
    const ctxA = createContext(orgA);
    const now = new Date();
    const cutoff = new Date(now.getTime() - 30 * DAY_MS);

    await repo.createMany(ctxA, [
      eventRow("ret-guard", new Date(cutoff.getTime() - DAY_MS)),
    ]);

    // Sentinels in tables whose lifecycle must be independent of telemetry GC.
    const sentinelAuditId = randomUUID();
    await db.insert(schema.auditLogs).values({
      id: sentinelAuditId,
      organizationId: orgA,
      actorId: "guard",
      action: "guard.probe",
      targetType: "client_event_retention_guard",
      targetId: "guard",
      metadata: {},
      createdAt: new Date(cutoff.getTime() - DAY_MS), // even "expired-looking" rows
    });
    const sentinelRunId = randomUUID();
    await db.insert(retentionRuns).values({
      id: sentinelRunId,
      organizationId: orgA,
      operationId: `guard:${randomUUID().slice(0, 8)}`,
      tool: "guard",
      result: "succeeded",
      verificationStatus: "verified",
      startedAt: new Date(cutoff.getTime() - DAY_MS),
      completedAt: new Date(cutoff.getTime() - DAY_MS),
    });

    const deleted = await repo.deleteOlderThan(ctxA, cutoff);
    expect(deleted).toBe(1); // the client event went...

    const audit = await db
      .select({ id: schema.auditLogs.id })
      .from(schema.auditLogs)
      .where(eq(schema.auditLogs.id, sentinelAuditId));
    const run = await db
      .select({ id: retentionRuns.id })
      .from(retentionRuns)
      .where(eq(retentionRuns.id, sentinelRunId));
    // ...but the sentinel evidence rows are still present.
    expect(audit).toHaveLength(1);
    expect(run).toHaveLength(1);

    await db
      .delete(schema.auditLogs)
      .where(eq(schema.auditLogs.id, sentinelAuditId));
    await db.delete(retentionRuns).where(eq(retentionRuns.id, sentinelRunId));
  });
});
