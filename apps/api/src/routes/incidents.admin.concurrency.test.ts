/**
 * Incident version-race recovery — deterministic PostgreSQL concurrency test
 * (ADR-014 §9, Fix Group C).
 *
 * Proves the REPEATABLE READ version-race recovery that the production
 * `withIncidentOperationRecovery` wrapper provides. The specific scenario
 * the route-level `Promise.all` tests CANNOT deterministically force:
 *
 *   T1 and T2 both resolve the SAME incident with the SAME operationId.
 *   T2 locks the incident row FOR UPDATE before T1 commits; T1 commits
 *   (version bump + event); T2 wakes, but its REPEATABLE READ snapshot still
 *   misses T1's event, so T2 throws IncidentVersionConflictError / hits a
 *   serialization failure BEFORE the event insert. The recovery wrapper rolls
 *   back, re-checks the operationId in a FRESH transaction, finds T1's
 *   committed matching op, and returns idempotent_replayed.
 *
 * Determinism mechanism (NO sleep / head-start / timeout-based ordering):
 *   a test-only `IncidentRepo` proxy wraps the repo the primary invocation
 *   receives. Its hooks gate transactions at exact points (pre-read done,
 *   incident row lock held) on deferred barriers, so the interleaving is
 *   constructed precisely:
 *
 *     T2 pre-reads absent → signals t2PreReadAbsent → waits allowT2Proceed
 *     T1 locks the row    → signals t1LockHeld → waits allowT1Commit
 *     test: awaits both signals, releases T2
 *     T2 signals t2LockAttempted immediately before its real FOR UPDATE
 *       (which blocks on T1's row lock)
 *     test: awaits t2LockAttempted, releases T1
 *     T1 commits; T2 wakes with its stale snapshot → conflict → recovery →
 *       fresh lookup → idempotent_replayed
 *
 * Proxy hooks apply ONLY to the primary invocation: the fresh recovery
 * transaction creates its own repo inside the production wrapper, so it is
 * never blocked by the barrier.
 *
 * Uses the production `withIncidentOperationRecovery` + engine commands
 * against a real isolated PostgreSQL schema with two physical connections.
 * Asserts: one version bump, one resolve event, one resolve audit, distinct
 * PIDs/txids, T2 → idempotent_replayed.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { createPostgresDatabase } from "@exam/db/src/postgres.js";
import { migratePostgres } from "@exam/db/src/postgres.js";
import { withTestInfraLifecycleLock } from "@exam/db/src/testInfraLock.js";
import { setupIsolatedTestDb } from "@exam/db/src/testIsolation.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { createIncidentRepo } from "@exam/db/src/repository/incidentRepo.js";
import { createAuditLogRepo } from "@exam/db/src/repository/auditLogRepo.js";
import { createAuditLogWriter } from "@exam/db/src/repository/auditLogRepo.js";
import { resolveExamIncident, dismissExamIncident } from "@exam/exam-engine";
import type { IncidentRepo } from "@exam/exam-engine";
import type { RequestContext } from "@exam/domain";
import type { Database, TransactionDatabase } from "@exam/db/src/types.js";
import { withIncidentOperationRecovery } from "../orchestrators/incidentOperationRecovery.js";
import { createDeferred, type Deferred } from "../testing/barrier.js";

const ORG_ID = `ic-race-${randomUUID().slice(0, 8)}`;
const ACTOR_ID = `actor-${randomUUID().slice(0, 8)}`;

function makeCtx(): RequestContext {
  return {
    actorId: ACTOR_ID,
    organizationId: ORG_ID,
    role: "Admin",
    permissions: [],
    sessionId: randomUUID(),
  };
}

/** In-transaction identity captured by a proxy hook. */
interface TxObservation {
  /** Human-readable label ("T1" / "T2" / "R" / "D"). */
  label: string;
  /** PostgreSQL backend PID of the transaction. */
  pid: number;
  /** Transaction id captured inside the transaction callback. */
  txid: string;
}

/**
 * Deferred barrier for the deterministic incident race. Every deferred is
 * one-shot; `dispose()` settles anything left pending so a stuck or failed
 * test can never leave a timer or an unawaited promise behind.
 */
interface IncidentRaceBarrier {
  /** Fired when T2's pre-read `findEventByOperationId` returned absent. */
  t2PreReadAbsent: Deferred<TxObservation>;
  /** Resolved by the controller to release T2 past its pre-read gate. */
  allowT2Proceed: Deferred<void>;
  /** Fired when T1's `findByIdForUpdate` has ACQUIRED the row lock. */
  t1LockHeld: Deferred<TxObservation>;
  /** Resolved by the controller to release T1 past its lock-hold gate. */
  allowT1Commit: Deferred<void>;
  /** Fired immediately before T2's real `findByIdForUpdate` (which blocks). */
  t2LockAttempted: Deferred<TxObservation>;
  /** Fired when each of the two different-opId transactions finished its pre-read. */
  ready: Deferred<TxObservation>[];
  /** Resolved by the controller to release both different-opId transactions. */
  releaseBoth: Deferred<void>;
  dispose(): void;
}

function createIncidentRaceBarrier(): IncidentRaceBarrier {
  const deferreds = {
    t2PreReadAbsent: createDeferred<TxObservation>("T2 pre-read absent"),
    allowT2Proceed: createDeferred<void>("allow T2 proceed"),
    t1LockHeld: createDeferred<TxObservation>("T1 lock held"),
    allowT1Commit: createDeferred<void>("allow T1 commit"),
    t2LockAttempted: createDeferred<TxObservation>("T2 lock attempted"),
    ready: [
      createDeferred<TxObservation>("ready A"),
      createDeferred<TxObservation>("ready B"),
    ],
    releaseBoth: createDeferred<void>("release both"),
  };
  return {
    ...deferreds,
    dispose() {
      for (const d of [
        deferreds.t2PreReadAbsent,
        deferreds.allowT2Proceed,
        deferreds.t1LockHeld,
        deferreds.allowT1Commit,
        deferreds.t2LockAttempted,
        deferreds.releaseBoth,
        ...deferreds.ready,
      ]) {
        if (!d.isSettled()) d.resolve(undefined as never);
      }
    },
  };
}

/**
 * Builds a test-only `IncidentRepo` proxy around the transaction-bound repo.
 *
 * Hooks (all optional) gate the PRIMARY invocation at exact transaction
 * points:
 *   - `onPreReadAbsent` fires after the FIRST `findEventByOperationId` call
 *     (the engine's idempotency pre-read) and may await a gate deferred. Later
 *     calls (the in-lock re-check, or a retry's pre-read) are NOT gated.
 *   - `beforeFindByIdForUpdate` fires immediately before the REAL
 *     `findByIdForUpdate` call — used to prove the caller is about to block.
 *   - `afterFindByIdForUpdate` fires after the real call returned (i.e. the
 *     row lock is held) and may await a gate deferred.
 *
 * The proxy is created per primary invocation inside `run(tx)`; the fresh
 * recovery transaction constructs its OWN repo in the production wrapper, so
 * proxy hooks never re-block recovery.
 */
function createBarrierIncidentRepoProxy(
  tx: TransactionDatabase,
  label: string,
  hooks: {
    onPreReadAbsent?: (obs: TxObservation) => Promise<void>;
    beforeFindByIdForUpdate?: (obs: TxObservation) => Promise<void>;
    afterFindByIdForUpdate?: (obs: TxObservation) => Promise<void>;
  },
): IncidentRepo {
  const real = createIncidentRepo(tx);
  let preReadCount = 0;

  async function capture(): Promise<TxObservation> {
    const rows = (await tx.execute(
      sql`SELECT pg_backend_pid() AS pid, txid_current()::text AS txid`,
    )) as unknown as Array<{ pid: number; txid: string }>;
    return {
      label,
      pid: Number(rows[0]?.pid ?? 0),
      txid: String(rows[0]?.txid ?? ""),
    };
  }

  return {
    ...real,
    findEventByOperationId: async (
      ctx: RequestContext,
      operationId: string,
    ) => {
      preReadCount += 1;
      if (preReadCount === 1 && hooks.onPreReadAbsent) {
        await hooks.onPreReadAbsent(await capture());
      }
      return real.findEventByOperationId(ctx, operationId);
    },
    findByIdForUpdate: async (ctx: RequestContext, incidentId: string) => {
      if (hooks.beforeFindByIdForUpdate) {
        await hooks.beforeFindByIdForUpdate(await capture());
      }
      const row = await real.findByIdForUpdate(ctx, incidentId);
      if (hooks.afterFindByIdForUpdate) {
        await hooks.afterFindByIdForUpdate(await capture());
      }
      return row;
    },
  } as unknown as IncidentRepo;
}

describe("incident version-race recovery (ADR-014 §9)", () => {
  let iso: Awaited<ReturnType<typeof setupIsolatedTestDb>>;
  let dbShared: Database;
  let db1: Database;
  let db2: Database;
  let sqlShared: { end(): Promise<void> };
  let sql1: { end(): Promise<void> };
  let sql2: { end(): Promise<void> };
  let examId: string;
  let incidentId: string;

  beforeAll(async () => {
    const testDbUrl =
      process.env.TEST_DATABASE_URL ??
      process.env.TEST_DB_URL ??
      (() => {
        throw new Error("TEST_DATABASE_URL must be set");
      })();
    iso = await setupIsolatedTestDb({
      namespace: "incrace",
      databaseUrl: testDbUrl,
    });
    const shared = await createPostgresDatabase(
      iso.databaseUrl,
      iso.schemaName,
    );
    dbShared = shared.db;
    sqlShared = shared.sql;
    // Migrate the isolated schema under the test-infra lifecycle lock (the
    // canonical coordination DB serializes it against sibling CREATE/DROP
    // SCHEMA + CREATE/DROP DATABASE under parallel runs).
    await withTestInfraLifecycleLock(iso.databaseUrl, () =>
      migratePostgres(dbShared, { migrationsSchema: iso.schemaName }),
    );

    // Seed org, exam, and an open incident.
    const now = new Date();
    examId = randomUUID();
    await dbShared.insert(schema.organizations).values({
      id: ORG_ID,
      name: ORG_ID,
      displayName: ORG_ID,
      slug: ORG_ID,
      createdAt: now,
      updatedAt: now,
    });
    await dbShared.insert(schema.users).values({
      id: ACTOR_ID,
      organizationId: ORG_ID,
      username: `usr-${ACTOR_ID}`,
      passwordHash: "x",
      name: "Actor",
      role: "Admin",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    const courseId = randomUUID();
    await dbShared.insert(schema.courses).values({
      id: courseId,
      organizationId: ORG_ID,
      name: "c",
      code: `code-${randomUUID().slice(0, 6)}`,
      description: "",
      createdAt: now,
      updatedAt: now,
    });
    await dbShared.insert(schema.exams).values({
      id: examId,
      organizationId: ORG_ID,
      title: "t",
      description: "",
      courseId,
      status: "open",
      timingMode: "timed_window",
      durationMinutes: 60,
      openAt: now,
      closeAt: new Date(now.getTime() + 86400_000),
      passingScore: 60,
      totalScore: 100,
      questionSelectionMode: "manual",
      questionIds: [],
      questionSnapshot: [],
      controlFlags: {
        shuffleQuestions: false,
        shuffleOptions: false,
        detectTabSwitch: false,
        disableCopyPaste: false,
        requireQueue: false,
        batchSize: 10,
        batchInterval: 3,
        restrictIp: false,
        requireLockdown: false,
        showResultImmediately: true,
      },
      retakePolicy: "unlimited",
      scoreStrategy: "highest",
      maxAttempts: 1,
      interruptionTimePolicy: "operator_incident",
      createdAt: now,
      updatedAt: now,
    });

    // Create an open incident directly via repo (version 1, status open).
    const repo = createIncidentRepo(dbShared);
    const incident = await repo.insert(
      { organizationId: ORG_ID } as RequestContext,
      {
        examId,
        attemptId: null,
        candidateId: null,
        type: "other",
        severity: "info",
        occurredAt: null,
        description: "race test incident",
        reportedBy: ACTOR_ID,
        createdAt: now,
        updatedAt: now,
      },
    );
    incidentId = incident.id;
    await repo.appendEvent({ organizationId: ORG_ID } as RequestContext, {
      incidentId,
      eventType: "incident_created",
      commandType: "createExamIncident",
      operationId: randomUUID(),
      actorId: ACTOR_ID,
      beforeVersion: 0,
      afterVersion: 1,
      payload: {},
      createdAt: now,
    });

    // Two separate physical connections to the same isolated schema.
    const c1 = await createPostgresDatabase(iso.databaseUrl, iso.schemaName);
    const c2 = await createPostgresDatabase(iso.databaseUrl, iso.schemaName);
    db1 = c1.db;
    db2 = c2.db;
    sql1 = c1.sql;
    sql2 = c2.sql;
  }, 120_000);

  afterAll(async () => {
    // Close every connection before dropping the schema; fail-safe so one
    // close failure cannot block the remaining resource releases.
    await Promise.allSettled([
      sql2?.end() ?? Promise.resolve(),
      sql1?.end() ?? Promise.resolve(),
      sqlShared?.end() ?? Promise.resolve(),
    ]);
    await iso?.cleanup().catch(() => {});
  });

  it("same operationId concurrent resolve → one applied + one idempotent_replayed", async () => {
    const ctx = makeCtx();
    const opId = randomUUID();
    const canonicalPayload = {
      incidentId,
      expectedVersion: 1,
      resolutionSummary: "resolved via race",
      reasonCode: null,
    };
    const now = new Date();

    const barrier = createIncidentRaceBarrier();

    // T1: resolves the incident (the winner). Runs on db1. After its
    // findByIdForUpdate ACQUIRES the row lock it signals t1LockHeld and waits
    // for allowT1Commit.
    const t1Promise = withIncidentOperationRecovery(
      db1,
      ctx,
      opId,
      "resolveExamIncident",
      canonicalPayload,
      async (tx) => {
        const repo = createBarrierIncidentRepoProxy(tx, "T1", {
          afterFindByIdForUpdate: async (obs) => {
            barrier.t1LockHeld.resolve(obs);
            await barrier.allowT1Commit.promise;
          },
        });
        const audit = createAuditFn(tx, ctx);
        return resolveExamIncident(
          repo,
          ctx,
          incidentId,
          {
            operationId: opId,
            expectedVersion: 1,
            resolutionSummary: "resolved via race",
            reasonCode: null,
          },
          { now, audit },
        );
      },
    );

    // T2: resolves the SAME incident with the SAME operationId. Its pre-read
    // runs first and is gated; after release it attempts the row lock while
    // T1 still holds it, then wakes with a stale snapshot and recovers to
    // idempotent_replayed.
    const t2Promise = withIncidentOperationRecovery(
      db2,
      ctx,
      opId,
      "resolveExamIncident",
      canonicalPayload,
      async (tx) => {
        const repo = createBarrierIncidentRepoProxy(tx, "T2", {
          onPreReadAbsent: async (obs) => {
            barrier.t2PreReadAbsent.resolve(obs);
            await barrier.allowT2Proceed.promise;
          },
          beforeFindByIdForUpdate: async (obs) => {
            barrier.t2LockAttempted.resolve(obs);
          },
        });
        const audit = createAuditFn(tx, ctx);
        return resolveExamIncident(
          repo,
          ctx,
          incidentId,
          {
            operationId: opId,
            expectedVersion: 1,
            resolutionSummary: "resolved via race",
            reasonCode: null,
          },
          { now, audit },
        );
      },
    );

    try {
      // 1) T2's pre-read completed AND T1 holds the row lock.
      const [t2Pre, t1Held] = await Promise.all([
        barrier.t2PreReadAbsent.promise,
        barrier.t1LockHeld.promise,
      ]);

      // PID/txid evidence: two physical backends, two distinct live txids,
      // both non-zero.
      expect(t2Pre.pid).toBeGreaterThan(0);
      expect(t1Held.pid).toBeGreaterThan(0);
      expect(t2Pre.pid).not.toBe(t1Held.pid);
      expect(t2Pre.txid).not.toBe("");
      expect(t1Held.txid).not.toBe("");
      expect(t2Pre.txid).not.toBe(t1Held.txid);

      // 2) Release T2; it signals t2LockAttempted right before blocking on
      //    T1's row lock.
      barrier.allowT2Proceed.resolve();
      const t2Attempt = await barrier.t2LockAttempted.promise;

      // Same primary transaction, same backend, same txid as its pre-read.
      expect(t2Attempt.pid).toBe(t2Pre.pid);
      expect(t2Attempt.txid).toBe(t2Pre.txid);

      // 3) Release T1; it commits while T2 is blocked on the row lock.
      barrier.allowT1Commit.resolve();
      const [r1, r2] = await Promise.all([t1Promise, t2Promise]);

      // Exactly one applied, one replayed.
      const outcomes = [r1.outcome, r2.outcome].sort();
      expect(outcomes).toEqual(["applied", "idempotent_replayed"]);

      // The incident version bumped exactly once (1 → 2).
      const finalIncident = await createIncidentRepo(dbShared).findById(
        ctx,
        incidentId,
      );
      expect(finalIncident?.version).toBe(2);
      expect(finalIncident?.status).toBe("resolved");

      // Exactly one incident_resolved event, carrying the operationId — no
      // duplicate rows (total events: created + resolved).
      const events = await dbShared
        .select()
        .from(schema.examIncidentEvents)
        .where(eq(schema.examIncidentEvents.incidentId, incidentId));
      expect(events).toHaveLength(2);
      const resolveEvents = events.filter(
        (e) => e.eventType === "incident_resolved",
      );
      expect(resolveEvents).toHaveLength(1);
      expect(resolveEvents[0]!.operationId).toBe(opId);
      expect(events.filter((e) => e.operationId === opId)).toHaveLength(1);

      // Exactly one incident.resolved audit row.
      const auditRows = await createAuditLogRepo(dbShared).listByTarget(
        ctx,
        "incident",
        incidentId,
      );
      const resolveAudits = auditRows.filter(
        (r) => r.auditLog.action === "incident.resolved",
      );
      expect(resolveAudits).toHaveLength(1);
    } finally {
      // Settle every deferred + every promise even on assertion failure, so
      // no transaction, connection, or timer is left hanging.
      barrier.dispose();
      await Promise.allSettled([t1Promise, t2Promise]);
    }
  }, 60_000);

  it("resolve vs dismiss with different opId → one winner, one version conflict", async () => {
    // Reset: create a fresh open incident for this scenario.
    const ctx = makeCtx();
    const now = new Date();
    const repo = createIncidentRepo(dbShared);
    const incident = await repo.insert(ctx, {
      examId,
      attemptId: null,
      candidateId: null,
      type: "other",
      severity: "info",
      occurredAt: null,
      description: "second race incident",
      reportedBy: ACTOR_ID,
      createdAt: now,
      updatedAt: now,
    });
    await repo.appendEvent(ctx, {
      incidentId: incident.id,
      eventType: "incident_created",
      commandType: "createExamIncident",
      operationId: randomUUID(),
      actorId: ACTOR_ID,
      beforeVersion: 0,
      afterVersion: 1,
      payload: {},
      createdAt: now,
    });

    const resolveOp = randomUUID();
    const dismissOp = randomUUID();

    const barrier = createIncidentRaceBarrier();

    // Both transactions gate AFTER their operation pre-read (absent): the row
    // lock then selects the winner deterministically; the loser wakes with a
    // stale snapshot and receives a legitimate version/state conflict. No
    // winner is required — either command may win.
    const resolvePromise = withIncidentOperationRecovery(
      db1,
      ctx,
      resolveOp,
      "resolveExamIncident",
      {
        incidentId: incident.id,
        expectedVersion: 1,
        resolutionSummary: "winner resolve",
        reasonCode: null,
      },
      async (tx) => {
        const r = createBarrierIncidentRepoProxy(tx, "R", {
          onPreReadAbsent: async (obs) => {
            barrier.ready[0]!.resolve(obs);
            await barrier.releaseBoth.promise;
          },
        });
        return resolveExamIncident(
          r,
          ctx,
          incident.id,
          {
            operationId: resolveOp,
            expectedVersion: 1,
            resolutionSummary: "winner resolve",
            reasonCode: null,
          },
          { now, audit: createAuditFn(tx, ctx) },
        );
      },
    );

    const dismissPromise = withIncidentOperationRecovery(
      db2,
      ctx,
      dismissOp,
      "dismissExamIncident",
      {
        incidentId: incident.id,
        expectedVersion: 1,
        reasonText: "loser dismiss",
        reasonCode: null,
      },
      async (tx) => {
        const r = createBarrierIncidentRepoProxy(tx, "D", {
          onPreReadAbsent: async (obs) => {
            barrier.ready[1]!.resolve(obs);
            await barrier.releaseBoth.promise;
          },
        });
        return dismissExamIncident(
          r,
          ctx,
          incident.id,
          {
            operationId: dismissOp,
            expectedVersion: 1,
            reasonText: "loser dismiss",
            reasonCode: null,
          },
          { now, audit: createAuditFn(tx, ctx) },
        );
      },
    );

    try {
      // Both transactions completed their pre-reads (absent) — release both.
      const [rObs, dObs] = await Promise.all([
        barrier.ready[0]!.promise,
        barrier.ready[1]!.promise,
      ]);
      expect(rObs.pid).not.toBe(dObs.pid);
      expect(rObs.txid).not.toBe(dObs.txid);
      barrier.releaseBoth.resolve();

      // Exactly one wins (applied); the other conflicts (version or terminal)
      // and is rejected — the opIds differ, so no replay is possible.
      const results = await Promise.allSettled([
        resolvePromise,
        dismissPromise,
      ]);
      const fulfilled = results.filter(
        (r) => r.status === "fulfilled",
      ) as PromiseFulfilledResult<{ outcome: string }>[];
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(fulfilled[0]!.value.outcome).toBe("applied");
      expect(rejected).toHaveLength(1);

      // The final incident is terminal (resolved or dismissed), version 2.
      const finalIncident = await repo.findById(ctx, incident.id);
      expect(finalIncident?.version).toBe(2);
      expect(["resolved", "dismissed"]).toContain(finalIncident?.status);

      // Exactly one terminal event (resolved OR dismissed).
      const events = await dbShared
        .select()
        .from(schema.examIncidentEvents)
        .where(eq(schema.examIncidentEvents.incidentId, incident.id));
      const terminalEvents = events.filter(
        (e) =>
          e.eventType === "incident_resolved" ||
          e.eventType === "incident_dismissed",
      );
      expect(terminalEvents).toHaveLength(1);

      // Exactly one terminal audit (resolved OR dismissed).
      const auditRows = await createAuditLogRepo(dbShared).listByTarget(
        ctx,
        "incident",
        incident.id,
      );
      const terminalAudits = auditRows.filter(
        (r) =>
          r.auditLog.action === "incident.resolved" ||
          r.auditLog.action === "incident.dismissed",
      );
      expect(terminalAudits).toHaveLength(1);
    } finally {
      // Settle every deferred + every promise even on assertion failure.
      barrier.dispose();
      await Promise.allSettled([resolvePromise, dismissPromise]);
    }
  }, 60_000);

  /** Builds a tx-bound audit fn that writes a real audit row. */
  function createAuditFn(tx: Database, auditCtx: RequestContext) {
    const writer = createAuditLogWriter(tx);
    return async (action: string, metadata: Record<string, unknown>) => {
      await writer.insert(auditCtx, {
        actorId: auditCtx.actorId,
        action: action as never,
        targetType: "incident",
        targetId: (metadata.incidentId as string) ?? incidentId,
        metadata,
      });
    };
  }
});
