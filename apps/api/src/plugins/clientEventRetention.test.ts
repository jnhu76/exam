import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import type { RequestContext } from "@exam/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { getIsolatedTestDb } from "@exam/db/testDb";
import { createOrganizationRepo } from "@exam/db/repository/organizationRepo";
import { createClientEventRepo } from "@exam/db/repository/clientEventRepo";
import { schema } from "@exam/db/schema/pg";
import type { Database } from "@exam/db/types";
import {
  CLIENT_EVENT_RETENTION_DAYS,
  CLIENT_EVENT_RETENTION_SWEEP_INTERVAL_MS,
  cleanupOrganizationClientEvents,
  clientEventRetentionMetrics,
  retentionCutoff,
  default as clientEventRetentionPlugin,
} from "./clientEventRetention.js";
import { organizations } from "@exam/db/schema/pg";
import { classifyLoopStall } from "./operabilityMonitor.js";
import { vi } from "vitest";

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
      eventId: null,
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

describe("client-event retention loop — activity + escalation facts (#871)", () => {
  const ORG = { id: "org-1" };

  function resetFacts() {
    clientEventRetentionMetrics.startedAt = null;
    clientEventRetentionMetrics.lastStartedAt = null;
    clientEventRetentionMetrics.lastSettledAt = null;
    clientEventRetentionMetrics.activeSince = null;
    clientEventRetentionMetrics.consecutiveFailedTicks = 0;
    clientEventRetentionMetrics.scanIntervalMs = 0;
  }

  /**
   * Fake db routing by drizzle table identity (same pattern as the
   * heartbeat/deadline #862 fakes): org discovery resolves one org (or
   * THROWS while `orgDiscoveryThrows()` — a tick-level throw); each org's
   * cleanup delete either resolves empty (clean pass — zero deleted is NOT
   * a failure) or THROWS while `cleanupThrows()` (business failure).
   */
  function buildDb(legs: {
    orgDiscoveryThrows: () => boolean;
    cleanupThrows: () => boolean;
    /** Optional gate: a hung cleanup awaits this before resolving (#871). */
    beforeCleanupResolve?: () => Promise<void>;
  }): unknown {
    return {
      select: () => ({
        from: (table: unknown) => {
          if (table === organizations) {
            if (legs.orgDiscoveryThrows()) {
              throw new Error("forced org discovery failure");
            }
            return Promise.resolve([ORG]);
          }
          throw new Error("unexpected table in retention fake db");
        },
      }),
      delete: () => ({
        where: () => ({
          returning: async () => {
            if (legs.cleanupThrows()) {
              throw new Error("forced cleanup failure");
            }
            if (legs.beforeCleanupResolve) await legs.beforeCleanupResolve();
            return [];
          },
        }),
      }),
    };
  }

  function buildApp(db: unknown) {
    const clock = { current: new Date("2026-11-05T08:00:00Z") };
    const app = Fastify({ logger: false });
    app.decorate<unknown>("db", db as never);
    app.decorate("now", () => clock.current);
    return { app, clock };
  }

  async function runPass(clock: { current: Date }) {
    clock.current = new Date(clock.current.getTime() + 86_400_000);
    await vi.advanceTimersByTimeAsync(86_400_000);
  }

  it("stamps registration/start/settle facts; a settled pass with failed orgs increments, a clean pass (zero deleted) resets", async () => {
    vi.useFakeTimers();
    let cleanupThrows = true;
    const { app, clock } = buildApp(
      buildDb({
        orgDiscoveryThrows: () => false,
        cleanupThrows: () => cleanupThrows,
      }),
    );
    resetFacts();
    await app.register(clientEventRetentionPlugin);
    await app.ready();

    try {
      // Registration: warming origin + interval written; the STARTUP pass
      // (failed org) settles and increments immediately.
      expect(clientEventRetentionMetrics.startedAt).not.toBeNull();
      expect(clientEventRetentionMetrics.scanIntervalMs).toBe(
        CLIENT_EVENT_RETENTION_SWEEP_INTERVAL_MS,
      );
      await vi.advanceTimersByTimeAsync(0);
      expect(clientEventRetentionMetrics.lastSettledAt).not.toBeNull();
      expect(clientEventRetentionMetrics.activeSince).toBeNull();
      expect(clientEventRetentionMetrics.consecutiveFailedTicks).toBe(1);

      await runPass(clock);
      expect(clientEventRetentionMetrics.consecutiveFailedTicks).toBe(2);

      // A clean pass with ZERO deleted rows is still a clean settle — the
      // counter tracks failed passes, not deletions.
      cleanupThrows = false;
      await runPass(clock);
      expect(clientEventRetentionMetrics.consecutiveFailedTicks).toBe(0);
      expect(
        classifyLoopStall(
          clientEventRetentionMetrics,
          CLIENT_EVENT_RETENTION_SWEEP_INTERVAL_MS,
          clock.current,
        ),
      ).toBe("healthy");
    } finally {
      await app.close();
      vi.useRealTimers();
    }
  });

  it("a tick-level THROW freezes the counter — neither resets nor advances (same ownership boundary as #862)", async () => {
    vi.useFakeTimers();
    let orgDiscoveryThrows = false;
    let cleanupThrows = true;
    const { app, clock } = buildApp(
      buildDb({
        orgDiscoveryThrows: () => orgDiscoveryThrows,
        cleanupThrows: () => cleanupThrows,
      }),
    );
    resetFacts();
    await app.register(clientEventRetentionPlugin);
    await app.ready();

    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(clientEventRetentionMetrics.consecutiveFailedTicks).toBe(1);

      orgDiscoveryThrows = true;
      await runPass(clock);
      // The throw path still SETTLES at the tick clock (the finally stamps it)
      // — the counter freeze must not come from a missing settle stamp.
      expect(clientEventRetentionMetrics.lastSettledAt).toEqual(clock.current);
      expect(clientEventRetentionMetrics.consecutiveFailedTicks).toBe(1);

      // The frozen run continues from where it froze.
      orgDiscoveryThrows = false;
      await runPass(clock);
      expect(clientEventRetentionMetrics.consecutiveFailedTicks).toBe(2);

      cleanupThrows = false;
      await runPass(clock);
      expect(clientEventRetentionMetrics.consecutiveFailedTicks).toBe(0);
    } finally {
      await app.close();
      vi.useRealTimers();
    }
  });

  it("a HUNG pass holds activeSince at its start instant — stalled even while the timer is alive; release clears it (#871)", async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { app, clock } = buildApp(
      buildDb({
        orgDiscoveryThrows: () => false,
        cleanupThrows: () => false,
        beforeCleanupResolve: () => gate,
      }),
    );
    resetFacts();
    await app.register(clientEventRetentionPlugin);
    await app.ready();

    try {
      // The startup pass is in flight, blocked inside the cleanup delete.
      await vi.advanceTimersByTimeAsync(0);
      const startedAt = clientEventRetentionMetrics.lastStartedAt!;
      expect(clientEventRetentionMetrics.activeSince).toEqual(startedAt);

      // Five days later the pass is still hung: the interval cannot start a
      // second run, activeSince still holds the start instant, and the SAME
      // classifyLoopStall the monitor uses reports stalled — the timer being
      // alive is not evidence of progress.
      clock.current = new Date(clock.current.getTime() + 5 * 86_400_000);
      expect(clientEventRetentionMetrics.activeSince).toEqual(startedAt);
      expect(
        classifyLoopStall(
          clientEventRetentionMetrics,
          CLIENT_EVENT_RETENTION_SWEEP_INTERVAL_MS,
          clock.current,
        ),
      ).toBe("stalled");

      release();
      await vi.advanceTimersByTimeAsync(0);
      expect(clientEventRetentionMetrics.activeSince).toBeNull();
      expect(clientEventRetentionMetrics.lastSettledAt).toEqual(clock.current);
    } finally {
      // Idempotent on the happy path; if an assertion above regresses, this
      // keeps the hung pass from blocking app.close() (and leaking fake
      // timers into the remaining tests).
      release();
      await app.close();
      vi.useRealTimers();
    }
  });
});
