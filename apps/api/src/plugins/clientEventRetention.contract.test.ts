import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import type { RequestContext } from "@exam/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { getIsolatedTestDb } from "@exam/db/testDb";
import { createPostgresDatabase } from "@exam/db/postgres";
import { createOrganizationRepo } from "@exam/db/repository/organizationRepo";
import { createClientEventRepo } from "@exam/db/repository/clientEventRepo";
import type { Database } from "@exam/db/types";
import {
  CLIENT_EVENT_RETENTION_SWEEP_INTERVAL_MS,
  cleanupOrganizationClientEvents,
  clientEventRetentionMetrics,
  retentionCutoff,
  runClientEventRetentionOnce,
  default as clientEventRetentionPlugin,
} from "./clientEventRetention.js";
import { classifyLoopStall } from "./operabilityMonitor.js";

/**
 * TASK-CONTRACT §5.2/§5.4 retention acceptance (#923 verification closure).
 *
 * Real isolated PostgreSQL + controllable clock (fixed NOW, or the explicit
 * `now` argument of {@link runClientEventRetentionOnce}) + PostgreSQL-native
 * fault injection (BEFORE DELETE triggers, the repo's established injection
 * convention — see candidate-save-submit.test.ts). These tests CHARACTERIZE
 * the executor as built (#544/#547/#871); they intentionally add no product
 * behavior. The DB-level primitive contract (strict cutoff boundary,
 * org isolation, idempotency, adjacent-table guard) is owned by
 * `clientEventRepo.retention.test.ts`; this file proves the EXECUTOR-level
 * conditions: one pass over multiple orgs, per-org failure isolation and
 * recovery, restart compensation, empty sweep, structured logs, concurrent
 * ingest/cleanup, shutdown joining an in-flight sweep, and the legacy-route
 * at-rest → retention interaction (#864/§5.4).
 *
 * Tests run in declaration order and share one schema (orgs accumulate);
 * exact-count assertions account for that explicitly.
 */

/** Frozen sweep clock for every executor invocation in this file. */
const NOW = new Date("2026-11-08T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const CUTOFF = retentionCutoff(NOW);

function createContext(organizationId: string): RequestContext {
  return {
    actorId: randomUUID(),
    organizationId,
    role: "Admin",
    permissions: [],
    sessionId: randomUUID(),
  };
}

/** Bounded polling barrier on observable state (repo waitFor convention). */
async function waitFor(
  predicate: () => Promise<boolean> | boolean,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("waitFor: condition not met before deadline");
}

function captureStream(): { lines: string[]; stream: Writable } {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  return { lines, stream };
}

function jsonLogs(lines: string[]): Array<Record<string, unknown>> {
  return lines.map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("client-event retention contract (§5.2 executor conditions)", () => {
  let db: Database;
  let cleanupDb: () => Promise<void>;
  let databaseUrl: string | undefined;
  let schemaName: string | undefined;

  /** Cleanup handle shared between the failure-isolation and recovery tests. */
  let removeFailTrigger: (() => Promise<void>) | null = null;
  /** Org ids shared between the same two tests (declaration-order coupling). */
  let orgFailId = "";

  beforeAll(async () => {
    const iso = await getIsolatedTestDb("api-client-event-retention-contract");
    db = iso.db;
    cleanupDb = iso.cleanup;
    databaseUrl = iso.databaseUrl;
    schemaName = iso.schemaName;
  }, 30_000);

  afterAll(async () => {
    await removeFailTrigger?.().catch(() => {});
    await cleanupDb();
  }, 30_000);

  async function makeOrg(name: string): Promise<string> {
    const org = await createOrganizationRepo(db).create(
      createContext("system"),
      {
        name,
        displayName: name,
        slug: `${name.toLowerCase()}-${randomUUID().slice(0, 8)}`,
      },
    );
    return org.id;
  }

  function eventRow(input: {
    name: string;
    receivedAt: Date;
    route?: string | null;
    attemptId?: string | null;
  }) {
    return {
      userId: null,
      attemptId: input.attemptId ?? null,
      examId: null,
      questionId: null,
      kind: "log",
      level: "info",
      name: input.name,
      route: input.route ?? null,
      occurredAt: input.receivedAt,
      receivedAt: input.receivedAt,
      clientSessionId: null,
      eventId: null,
      metadata: {},
      userAgent: null,
    };
  }

  async function insertRows(
    orgId: string,
    rows: ReturnType<typeof eventRow>[],
  ) {
    await createClientEventRepo(db).createMany(createContext(orgId), rows);
  }

  async function countRows(orgId: string, name: string): Promise<number> {
    const rows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(sql`client_events`)
      .where(sql`organization_id = ${orgId} and name = ${name}`);
    return Number(rows[0]!.n);
  }

  async function countExpired(
    orgId: string | null,
    cutoff: Date,
  ): Promise<number> {
    const orgFilter = orgId ? sql`organization_id = ${orgId} and ` : sql``;
    const rows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(sql`client_events`)
      .where(sql`${orgFilter}received_at < ${cutoff.toISOString()}`);
    return Number(rows[0]!.n);
  }

  async function rawRoute(orgId: string, name: string): Promise<string | null> {
    const rows = await db
      .select({ route: sql<string | null>`route` })
      .from(sql`client_events`)
      .where(sql`organization_id = ${orgId} and name = ${name}`);
    return rows[0]?.route ?? null;
  }

  /** Minimal executor host: real db + fixed clock, plugin NOT registered. */
  function buildExecutorApp(now: Date, stream?: Writable): FastifyInstance {
    const app = stream
      ? Fastify({ logger: { level: "info", stream } })
      : Fastify({ logger: false });
    app.decorate<Database>("db", db);
    app.decorate("now", () => now);
    return app;
  }

  function resetMetrics() {
    clientEventRetentionMetrics.startedAt = null;
    clientEventRetentionMetrics.lastStartedAt = null;
    clientEventRetentionMetrics.lastSettledAt = null;
    clientEventRetentionMetrics.activeSince = null;
    clientEventRetentionMetrics.consecutiveFailedTicks = 0;
    clientEventRetentionMetrics.scanIntervalMs = 0;
  }

  /**
   * Real PostgreSQL failure injection: a BEFORE DELETE trigger that raises for
   * one organization's rows only (repo convention — see
   * candidate-save-submit.test.ts installSubmitAuditFailure).
   */
  async function installFailDeleteTrigger(
    orgId: string,
  ): Promise<() => Promise<void>> {
    const suffix = randomUUID().replaceAll("-", "");
    const functionName = `fail_retention_delete_${suffix}`;
    const triggerName = `fail_retention_delete_trigger_${suffix}`;
    await db.execute(
      sql.raw(`
        CREATE FUNCTION ${functionName}() RETURNS trigger AS $$
        BEGIN
          RAISE EXCEPTION 'injected retention delete failure';
        END;
        $$ LANGUAGE plpgsql
      `),
    );
    await db.execute(
      sql.raw(`
        CREATE TRIGGER ${triggerName}
        BEFORE DELETE ON client_events
        FOR EACH ROW
        WHEN (OLD.organization_id = '${orgId}')
        EXECUTE FUNCTION ${functionName}()
      `),
    );
    return async () => {
      await db.execute(
        sql.raw(`DROP TRIGGER IF EXISTS ${triggerName} ON client_events`),
      );
      await db.execute(sql.raw(`DROP FUNCTION IF EXISTS ${functionName}()`));
    };
  }

  /**
   * Gated DELETE for the shutdown test: the trigger blocks on an advisory
   * xact lock held by a SECOND physical connection, so one org's DELETE is
   * provably in flight until that connection releases the lock.
   */
  async function installGateDeleteTrigger(
    orgId: string,
    key: number,
  ): Promise<() => Promise<void>> {
    const suffix = randomUUID().replaceAll("-", "");
    const functionName = `gate_retention_delete_${suffix}`;
    const triggerName = `gate_retention_delete_trigger_${suffix}`;
    await db.execute(
      sql.raw(`
        CREATE FUNCTION ${functionName}() RETURNS trigger AS $$
        BEGIN
          PERFORM pg_advisory_xact_lock(${key});
          RETURN OLD;
        END;
        $$ LANGUAGE plpgsql
      `),
    );
    await db.execute(
      sql.raw(`
        CREATE TRIGGER ${triggerName}
        BEFORE DELETE ON client_events
        FOR EACH ROW
        WHEN (OLD.organization_id = '${orgId}')
        EXECUTE FUNCTION ${functionName}()
      `),
    );
    return async () => {
      await db.execute(
        sql.raw(`DROP TRIGGER IF EXISTS ${triggerName} ON client_events`),
      );
      await db.execute(sql.raw(`DROP FUNCTION IF EXISTS ${functionName}()`));
    };
  }

  it("29d kept / >30d deleted / ==cutoff kept — one executor pass covers multiple orgs", async () => {
    const orgA = await makeOrg("ContractBoundaryA");
    const orgB = await makeOrg("ContractBoundaryB");
    await insertRows(orgA, [
      eventRow({
        name: "c-a-29d",
        receivedAt: new Date(NOW.getTime() - 29 * DAY_MS),
      }),
      eventRow({ name: "c-a-exact", receivedAt: CUTOFF }),
      eventRow({
        name: "c-a-expired",
        receivedAt: new Date(CUTOFF.getTime() - 1),
      }),
    ]);
    await insertRows(orgB, [
      eventRow({
        name: "c-b-expired",
        receivedAt: new Date(CUTOFF.getTime() - 40 * DAY_MS),
      }),
      eventRow({ name: "c-b-fresh", receivedAt: NOW }),
    ]);

    const expiredBefore = await countExpired(null, CUTOFF);
    expect(expiredBefore).toBe(2); // fresh schema, first test: exactly these two

    const app = buildExecutorApp(NOW);
    try {
      const result = await runClientEventRetentionOnce(app, NOW);
      expect(result).toEqual({
        deletedCount: expiredBefore,
        organizationCount: 2,
        failedOrganizationCount: 0,
      });
    } finally {
      await app.close();
    }

    expect(await countRows(orgA, "c-a-29d")).toBe(1);
    expect(await countRows(orgA, "c-a-exact")).toBe(1);
    expect(await countRows(orgA, "c-a-expired")).toBe(0);
    expect(await countRows(orgB, "c-b-expired")).toBe(0);
    expect(await countRows(orgB, "c-b-fresh")).toBe(1);
  });

  it("empty sweep: no expired data anywhere → clean settle, healthy signal, silent by design", async () => {
    const orgEmpty = await makeOrg("ContractEmpty");
    await insertRows(orgEmpty, [
      eventRow({ name: "c-empty-fresh", receivedAt: NOW }),
    ]);

    const { lines, stream } = captureStream();
    resetMetrics();
    const app = Fastify({ logger: { level: "info", stream } });
    app.decorate<Database>("db", db);
    app.decorate("now", () => NOW);
    await app.register(clientEventRetentionPlugin);
    await app.ready();
    try {
      await waitFor(() => clientEventRetentionMetrics.lastSettledAt !== null);
      // Zero deletions is a CLEAN pass, not a failure (#871 semantics).
      expect(clientEventRetentionMetrics.consecutiveFailedTicks).toBe(0);
      expect(
        classifyLoopStall(
          clientEventRetentionMetrics,
          CLIENT_EVENT_RETENTION_SWEEP_INTERVAL_MS,
          NOW,
        ),
      ).toBe("healthy");
      expect(await countRows(orgEmpty, "c-empty-fresh")).toBe(1);
      // #544 design: a clean empty pass emits NO retention log line — the
      // operability channel is the metrics consumed above (plus the
      // per-deletion/per-failure logs proven by the next tests).
      expect(
        jsonLogs(lines).filter((l) => l.subsystem === "client_event_retention"),
      ).toHaveLength(0);
    } finally {
      await app.close();
    }
  }, 15_000);

  it("single-org failure isolation + structured logs: failed org untouched, other orgs cleaned, error and success logs carry the contract fields", async () => {
    orgFailId = await makeOrg("ContractFail");
    const orgOk = await makeOrg("ContractOk");
    await insertRows(orgFailId, [
      eventRow({
        name: "c-fail-expired",
        receivedAt: new Date(CUTOFF.getTime() - 5 * DAY_MS),
      }),
      eventRow({ name: "c-fail-fresh", receivedAt: NOW }),
    ]);
    await insertRows(orgOk, [
      eventRow({
        name: "c-ok-expired",
        receivedAt: new Date(CUTOFF.getTime() - 6 * DAY_MS),
      }),
      eventRow({ name: "c-ok-fresh", receivedAt: NOW }),
    ]);

    removeFailTrigger = await installFailDeleteTrigger(orgFailId);
    const { lines, stream } = captureStream();
    const app = buildExecutorApp(NOW, stream);
    try {
      const result = await runClientEventRetentionOnce(app, NOW);
      expect(result.failedOrganizationCount).toBe(1);
      // The failed org is fully untouched (both rows remain at rest)…
      expect(await countRows(orgFailId, "c-fail-expired")).toBe(1);
      expect(await countRows(orgFailId, "c-fail-fresh")).toBe(1);
      // …while the healthy org is fully cleaned by the SAME pass.
      expect(await countRows(orgOk, "c-ok-expired")).toBe(0);
      expect(await countRows(orgOk, "c-ok-fresh")).toBe(1);

      const logs = jsonLogs(lines).filter(
        (l) => l.subsystem === "client_event_retention",
      );
      const failLog = logs.find(
        (l) =>
          l.organizationId === orgFailId &&
          l.msg === "Client-event retention pass failed for organization",
      );
      expect(failLog).toBeDefined();
      expect(failLog!.cutoff).toBe(CUTOFF.toISOString());
      // The injected PostgreSQL failure text must survive serialization
      // (drizzle may wrap it as a cause — match the whole serialized line).
      expect(JSON.stringify(failLog)).toContain(
        "injected retention delete failure",
      );

      const okLog = logs.find(
        (l) =>
          l.organizationId === orgOk &&
          l.msg === "Client-event retention deleted expired rows",
      );
      expect(okLog).toBeDefined();
      expect(okLog!.deletedCount).toBe(1);
      expect(okLog!.cutoff).toBe(CUTOFF.toISOString());
      expect(typeof okLog!.durationMs).toBe("number");
    } finally {
      // Keep the trigger installed for the recovery test (declaration order).
      await app.close();
    }
  });

  it("failure recovery: once the fault is gone, the very next pass converges the previously failed org", async () => {
    await removeFailTrigger?.();
    removeFailTrigger = null;
    const app = buildExecutorApp(NOW);
    try {
      const result = await runClientEventRetentionOnce(app, NOW);
      expect(result.failedOrganizationCount).toBe(0);
    } finally {
      await app.close();
    }
    expect(await countRows(orgFailId, "c-fail-expired")).toBe(0);
    expect(await countRows(orgFailId, "c-fail-fresh")).toBe(1);
  });

  it("restart compensation: rows that expired while the process was down are deleted by the startup pass", async () => {
    // Restart clock: two sweep-days after NOW. Rows below were written while
    // the (single) process was down across the intervening sweep windows.
    const RESTART_NOW = new Date(NOW.getTime() + 2 * DAY_MS);
    const orgRestart = await makeOrg("ContractRestart");
    await insertRows(orgRestart, [
      eventRow({
        name: "c-restart-missed",
        receivedAt: new Date(RESTART_NOW.getTime() - 32 * DAY_MS),
      }),
      eventRow({
        name: "c-restart-fresh",
        receivedAt: new Date(RESTART_NOW.getTime() - 5 * DAY_MS),
      }),
    ]);

    resetMetrics();
    const app = Fastify({ logger: false });
    app.decorate<Database>("db", db);
    app.decorate("now", () => RESTART_NOW);
    await app.register(clientEventRetentionPlugin);
    await app.ready();
    try {
      // Startup convergence: the missed window is caught up immediately, no
      // interval tick involved.
      await waitFor(
        async () => (await countRows(orgRestart, "c-restart-missed")) === 0,
      );
      expect(await countRows(orgRestart, "c-restart-fresh")).toBe(1);
    } finally {
      await app.close();
    }
  }, 15_000);

  it("concurrent ingest and cleanup (two physical connections): no rejections, fresh rows never deleted, expired converge after writers stop", async () => {
    const orgConc = await makeOrg("ContractConc");
    const conn2 = await createPostgresDatabase(databaseUrl!, schemaName!);
    const repoMain = createClientEventRepo(db);
    const repoSecond = createClientEventRepo(conn2.db);
    const ctx = createContext(orgConc);
    try {
      const writers = [0, 1, 2, 3].map((i) => async () => {
        for (let j = 0; j < 5; j++) {
          await repoMain.createMany(ctx, [
            eventRow({
              name: `c-conc-${i}-${j}-old`,
              receivedAt: new Date(CUTOFF.getTime() - 3_600_000),
            }),
            eventRow({ name: `c-conc-${i}-${j}-new`, receivedAt: NOW }),
          ]);
        }
      });
      const cleaners = [0, 1, 2].map(() => async () => {
        for (let k = 0; k < 5; k++) {
          await repoSecond.deleteOlderThan(ctx, CUTOFF);
        }
      });
      // Promise.all rejects on ANY failure — a rejection here is the bug.
      await Promise.all([...writers, ...cleaners].map((task) => task()));

      // Writers stopped → one authoritative pass must converge everything
      // expired and delete exactly what remained.
      const expiredLeft = await countExpired(orgConc, CUTOFF);
      const finalDeleted = await cleanupOrganizationClientEvents(
        db,
        ctx,
        CUTOFF,
      );
      expect(finalDeleted).toBe(expiredLeft);
      expect(await countExpired(orgConc, CUTOFF)).toBe(0);

      let freshLeft = 0;
      let staleLeft = 0;
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 5; j++) {
          freshLeft += await countRows(orgConc, `c-conc-${i}-${j}-new`);
          staleLeft += await countRows(orgConc, `c-conc-${i}-${j}-old`);
        }
      }
      expect(freshLeft).toBe(20); // concurrent cleanup never took a fresh row
      expect(staleLeft).toBe(0);
    } finally {
      await conn2.sql.end();
    }
  }, 30_000);

  it("shutdown: app.close() waits for an in-flight gated sweep, which then converges", async () => {
    const orgGate = await makeOrg("ContractGate");
    await insertRows(orgGate, [
      eventRow({
        name: "c-gate-expired",
        receivedAt: new Date(CUTOFF.getTime() - 7 * DAY_MS),
      }),
    ]);
    // Deterministic 9-digit advisory key, valid for both lock variants.
    const key = 100_000_000 + Math.floor(Math.random() * 899_999_999);
    const conn2 = await createPostgresDatabase(databaseUrl!, schemaName!);
    const removeGate = await installGateDeleteTrigger(orgGate, key);
    resetMetrics();
    let app: FastifyInstance | null = null;
    try {
      // Hold the session-level lock FIRST (awaited — deterministic ordering):
      // the gated DELETE cannot pass its trigger until we release below.
      await conn2.sql.unsafe(`select pg_advisory_lock(${key})`);

      app = Fastify({ logger: false });
      app.decorate<Database>("db", db);
      app.decorate("now", () => NOW);
      await app.register(clientEventRetentionPlugin);
      await app.ready();

      // The startup pass is now provably in flight: it holds activeSince and
      // is blocked inside orgGate's DELETE on the advisory lock.
      await waitFor(() => clientEventRetentionMetrics.activeSince !== null);

      let closed = false;
      const closing = app.close().then(() => {
        closed = true;
      });
      // Deterministic negative witness (no timing window needed): onClose
      // awaits activeRun, which cannot settle while the lock is held.
      expect(closed).toBe(false);

      await conn2.sql.unsafe(`select pg_advisory_unlock(${key})`);
      await waitFor(() => closed);
      await closing;

      expect(await countRows(orgGate, "c-gate-expired")).toBe(0);
      expect(clientEventRetentionMetrics.activeSince).toBeNull();
      expect(clientEventRetentionMetrics.lastSettledAt).not.toBeNull();
    } finally {
      await conn2.sql
        .unsafe(`select pg_advisory_unlock(${key})`)
        .catch(() => {});
      await app?.close().catch(() => {});
      await removeGate();
      await conn2.sql.end();
    }
  }, 20_000);
});

describe("legacy route rows at rest (§5.4)", () => {
  let db: Database;
  let cleanupDb: () => Promise<void>;

  beforeAll(async () => {
    const iso = await getIsolatedTestDb("api-client-event-retention-legacy");
    db = iso.db;
    cleanupDb = iso.cleanup;
  }, 30_000);

  afterAll(async () => {
    await cleanupDb();
  }, 30_000);

  function createContext(organizationId: string): RequestContext {
    return {
      actorId: randomUUID(),
      organizationId,
      role: "Admin",
      permissions: [],
      sessionId: randomUUID(),
    };
  }

  async function makeOrg(name: string): Promise<string> {
    const org = await createOrganizationRepo(db).create(
      createContext("system"),
      {
        name,
        displayName: name,
        slug: `${name.toLowerCase()}-${randomUUID().slice(0, 8)}`,
      },
    );
    return org.id;
  }

  const DAY_MS = 24 * 60 * 60 * 1000;
  const NOW = new Date("2026-11-08T12:00:00.000Z");
  const CUTOFF = new Date(NOW.getTime() - 30 * DAY_MS);

  function legacyRow(input: {
    name: string;
    route: string | null;
    receivedAt: Date;
    attemptId?: string;
  }) {
    return {
      userId: null,
      attemptId: input.attemptId ?? null,
      examId: null,
      questionId: null,
      kind: "log",
      level: "info",
      name: input.name,
      route: input.route,
      occurredAt: input.receivedAt,
      receivedAt: input.receivedAt,
      clientSessionId: null,
      eventId: null,
      metadata: {},
      userAgent: null,
    };
  }

  async function insertRows(
    orgId: string,
    rows: ReturnType<typeof legacyRow>[],
  ) {
    await createClientEventRepo(db).createMany(createContext(orgId), rows);
  }

  async function countRows(orgId: string, name: string): Promise<number> {
    const rows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(sql`client_events`)
      .where(sql`organization_id = ${orgId} and name = ${name}`);
    return Number(rows[0]!.n);
  }

  async function rawRoute(orgId: string, name: string): Promise<string | null> {
    const rows = await db
      .select({ route: sql<string | null>`route` })
      .from(sql`client_events`)
      .where(sql`organization_id = ${orgId} and name = ${name}`);
    return rows[0]?.route ?? null;
  }

  it("raw legacy routes persist at rest; the owning org's pass deletes exactly its expired legacy rows and never touches another org", async () => {
    const orgLeg = await makeOrg("ContractLegacy");
    const orgOther = await makeOrg("ContractLegacyOther");
    const CANARY = "EXAMAUDIT-CANARY-LEGACY-REST";
    const expiredAt = new Date(CUTOFF.getTime() - 3 * DAY_MS);

    // Real pre-#864 shapes: raw pathname, query-smuggled template path,
    // absolute URL with userinfo+query, non-http scheme, and one already-safe
    // template. Written through the REPO (the route-level ingest projection
    // did not exist pre-#864) — exactly how legacy rows were produced.
    await insertRows(orgLeg, [
      legacyRow({
        name: "c-leg-path",
        route: `/password-reset/${CANARY}`,
        receivedAt: expiredAt,
        attemptId: "legacy-attempt",
      }),
      legacyRow({
        name: "c-leg-query",
        route: "/exam/legacy-attempt/take?token=SECRET-LEGACY-QUERY",
        receivedAt: expiredAt,
        attemptId: "legacy-attempt",
      }),
      legacyRow({
        name: "c-leg-url",
        route:
          "https://user:legacypw@example.invalid/exam/legacy-attempt/take?token=SECRET-LEGACY-URL",
        receivedAt: expiredAt,
        attemptId: "legacy-attempt",
      }),
      legacyRow({
        name: "c-leg-data",
        route: "data:text/html,<script>LEGACY-DATA-PAYLOAD</script>",
        receivedAt: expiredAt,
        attemptId: "legacy-attempt",
      }),
      legacyRow({
        name: "c-leg-template",
        route: "/exam/:attemptId/take",
        receivedAt: expiredAt,
        attemptId: "legacy-attempt",
      }),
      legacyRow({
        name: "c-leg-fresh-raw",
        route: `/password-reset/${CANARY}-FRESH`,
        receivedAt: NOW,
        attemptId: "legacy-attempt",
      }),
    ]);
    await insertRows(orgOther, [
      legacyRow({
        name: "c-other-valid-fresh",
        route: "/admin/proctor",
        receivedAt: NOW,
      }),
      legacyRow({
        name: "c-other-expired",
        route: "/admin/proctor",
        receivedAt: new Date(CUTOFF.getTime() - 2 * DAY_MS),
      }),
    ]);

    // §5.4.1 — at rest, BEFORE any cleanup: the raw hostile bytes are still
    // stored verbatim (the accepted historical residual risk, Decision B).
    expect(await rawRoute(orgLeg, "c-leg-path")).toBe(
      `/password-reset/${CANARY}`,
    );
    expect(await rawRoute(orgLeg, "c-leg-url")).toBe(
      "https://user:legacypw@example.invalid/exam/legacy-attempt/take?token=SECRET-LEGACY-URL",
    );

    // §5.4.2 (repo layer witness) — the repo SELECT returns the RAW stored
    // route; the closed-template projection is applied by the API service
    // layer above it. The authorized end-to-end projection (raw at rest →
    // template-or-null in the response) is proven through the real route by
    // the "#864 LEGACY rows" test in proctorMonitoring.test.ts.
    const timeline = await createClientEventRepo(
      db,
    ).listTimelinePrefixByAttempt(createContext(orgLeg), "legacy-attempt", 10);
    const timelineRoutes = timeline.map((r) => r.route);
    expect(timelineRoutes).toContain(`/password-reset/${CANARY}`);
    expect(timelineRoutes).toContain(
      "/exam/legacy-attempt/take?token=SECRET-LEGACY-QUERY",
    );

    // §5.4.3 — the owning org's pass deletes exactly its 5 expired legacy
    // rows; the still-fresh raw row is retained by the same 30-day rule.
    const deleted = await cleanupOrganizationClientEvents(
      db,
      createContext(orgLeg),
      CUTOFF,
    );
    expect(deleted).toBe(5);
    expect(await rawRoute(orgLeg, "c-leg-path")).toBeNull();
    expect(await rawRoute(orgLeg, "c-leg-url")).toBeNull();
    expect(await rawRoute(orgLeg, "c-leg-fresh-raw")).toBe(
      `/password-reset/${CANARY}-FRESH`,
    );

    // §5.4.4 — another org's rows (valid AND expired) are untouched by
    // orgLeg's pass; its own pass then removes only its expired row.
    expect(await countRows(orgOther, "c-other-valid-fresh")).toBe(1);
    expect(await countRows(orgOther, "c-other-expired")).toBe(1);
    const deletedOther = await cleanupOrganizationClientEvents(
      db,
      createContext(orgOther),
      CUTOFF,
    );
    expect(deletedOther).toBe(1);
    expect(await countRows(orgOther, "c-other-valid-fresh")).toBe(1);
    expect(await countRows(orgOther, "c-other-expired")).toBe(0);
  });
});
