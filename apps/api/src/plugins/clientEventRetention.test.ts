import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import type { RequestContext } from "@exam/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { getIsolatedTestDb } from "@exam/db/src/testDb.js";
import { createOrganizationRepo } from "@exam/db/src/repository/organizationRepo.js";
import { createClientEventRepo } from "@exam/db/src/repository/clientEventRepo.js";
import { schema } from "@exam/db/src/schema/pg.js";
import type { Database } from "@exam/db/src/types.js";
import {
  CLIENT_EVENT_RETENTION_DAYS,
  CLIENT_EVENT_RETENTION_SWEEP_INTERVAL_MS,
  cleanupOrganizationClientEvents,
  retentionCutoff,
  default as clientEventRetentionPlugin,
} from "./clientEventRetention.js";

/**
 * Client-event retention executor (#544).
 *
 * The DB-level convergence/idempotency/org-isolation contract is covered by
 * `clientEventRepo.retention.test.ts` (T11-T15). These tests prove the API
 * layer: the executor function works end-to-end, the plugin registers and
 * shuts down cleanly, and the sweep interval constant is fixed at 24h.
 */

/** Bounded polling barrier on observable DB state (repo waitFor convention). */
async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("waitFor: condition not met before deadline");
}

function createContext(organizationId: string): RequestContext {
  return {
    actorId: randomUUID(),
    organizationId,
    role: "Admin",
    permissions: [],
    sessionId: randomUUID(),
  };
}

describe("client-event retention executor", () => {
  let db: Database;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    const result = await getIsolatedTestDb("api-client-event-retention");
    db = result.db;
    cleanup = result.cleanup;
  }, 30_000);

  afterAll(async () => {
    await cleanup();
  }, 30_000);

  const DAY_MS = 24 * 60 * 60 * 1000;

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

  async function countRows(name: string): Promise<number> {
    const rows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.clientEvents)
      .where(eq(schema.clientEvents.name, name));
    return Number(rows[0]!.n);
  }

  it("retentionCutoff: cutoff = now - 30d, exactly", () => {
    const now = new Date("2026-09-15T12:00:00.000Z");
    expect(retentionCutoff(now).toISOString()).toBe("2026-08-16T12:00:00.000Z");
    expect(CLIENT_EVENT_RETENTION_DAYS).toBe(30);
    expect(CLIENT_EVENT_RETENTION_SWEEP_INTERVAL_MS).toBe(24 * 60 * 60 * 1000);
  });

  it("T16: cleanupOrganizationClientEvents deletes expired rows and is idempotent", async () => {
    const now = new Date();
    const cutoff = retentionCutoff(now);
    const orgRepo = createOrganizationRepo(db);
    const org = await orgRepo.create(createContext("system"), {
      name: "ExecutorConvergeOrg",
      displayName: "ExecutorConvergeOrg",
      slug: `exec-conv-${randomUUID().slice(0, 8)}`,
    });

    await createClientEventRepo(db).createMany(createContext(org.id), [
      eventRow("exec-old", new Date(cutoff.getTime() - DAY_MS)),
      eventRow("exec-fresh", new Date(now.getTime())),
    ]);

    const first = await cleanupOrganizationClientEvents(
      db,
      createContext(org.id),
      cutoff,
    );
    expect(first).toBe(1);
    expect(await countRows("exec-old")).toBe(0);
    expect(await countRows("exec-fresh")).toBe(1);

    const second = await cleanupOrganizationClientEvents(
      db,
      createContext(org.id),
      cutoff,
    );
    expect(second).toBe(0);
  });

  it("T16b: plugin registers, startup pass converges, and close joins cleanly", async () => {
    const now = new Date();
    const cutoff = retentionCutoff(now);
    const orgRepo = createOrganizationRepo(db);
    const org = await orgRepo.create(createContext("system"), {
      name: "ExecutorStartupOrg",
      displayName: "ExecutorStartupOrg",
      slug: `exec-startup-${randomUUID().slice(0, 8)}`,
    });
    const sentinelName = `exec-startup-old-${randomUUID().slice(0, 8)}`;
    await createClientEventRepo(db).createMany(createContext(org.id), [
      eventRow(sentinelName, new Date(cutoff.getTime() - DAY_MS)),
    ]);

    const app = Fastify({ logger: false });
    app.decorate<Database>("db", db);
    app.decorate("now", () => now);
    await app.register(clientEventRetentionPlugin);
    await app.ready();

    try {
      // The startup pass enumerates all orgs and deletes expired rows; we
      // observe convergence by waiting for the sentinel name to vanish from
      // the global client_events table. No interval tick is involved.
      await waitFor(async () => (await countRows(sentinelName)) === 0);
    } finally {
      await app.close();
    }

    // Fresh rows survive the startup pass.
    expect(await countRows("exec-fresh")).toBe(1);
  }, 15_000);
});
