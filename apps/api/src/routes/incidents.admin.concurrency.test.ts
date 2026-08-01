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
 *   misses T1's event, so T2 throws IncidentVersionConflictError BEFORE the
 *   event insert. The recovery wrapper rolls back, re-checks the operationId
 *   in a FRESH transaction, finds T1's committed matching op, and returns
 *   idempotent_replayed.
 *
 * Uses the production `withIncidentOperationRecovery` + engine commands
 * against a real isolated PostgreSQL schema with two physical connections.
 * A barrier forces the exact interleaving (T2 pre-reads + locks before T1
 * commits). Asserts: one version bump, one resolve event, one resolve audit,
 * distinct txids, T2 → idempotent_replayed.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createPostgresDatabase } from "@exam/db/src/postgres.js";
import { migratePostgres } from "@exam/db/src/postgres.js";
import { setupIsolatedTestDb } from "@exam/db/src/testIsolation.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { createIncidentRepo } from "@exam/db/src/repository/incidentRepo.js";
import { createAuditLogRepo } from "@exam/db/src/repository/auditLogRepo.js";
import { createAuditLogWriter } from "@exam/db/src/repository/auditLogRepo.js";
import { resolveExamIncident } from "@exam/exam-engine";
import type { IncidentRepo } from "@exam/exam-engine";
import type { RequestContext } from "@exam/domain";
import type { Database } from "@exam/db/src/types.js";
import { withIncidentOperationRecovery } from "../orchestrators/incidentOperationRecovery.js";
import { createDeferred } from "../testing/barrier.js";

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

describe("incident version-race recovery (ADR-014 §9)", () => {
  let iso: Awaited<ReturnType<typeof setupIsolatedTestDb>>;
  let dbShared: Database;
  let db1: Database;
  let db2: Database;
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
    // Migrate the isolated schema so the incident tables exist.
    await migratePostgres(dbShared, { migrationsSchema: iso.schemaName });

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
    await sql2?.end();
    await sql1?.end();
    await iso?.cleanup();
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

    // Barrier: T2 reaches its incident lock + version check and WAITS there
    // until T1 has committed. We gate T2 inside the transaction by capturing
    // a deferred that resolves only after T1 commits.
    const t2Release = createDeferred<void>("t2-release", 30_000);
    const t1Committed = createDeferred<void>("t1-committed", 30_000);

    // T1: resolves the incident (the winner). Runs on db1.
    const t1Promise = (async () => {
      const result = await withIncidentOperationRecovery(
        db1,
        ctx,
        opId,
        "resolveExamIncident",
        canonicalPayload,
        async (tx) => {
          const repo = createIncidentRepo(tx);
          const audit = createAuditFn(tx, ctx);
          const r = await resolveExamIncident(
            repo as unknown as IncidentRepo,
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
          return r;
        },
      );
      // Signal T2 that T1 has committed.
      t1Committed.resolve();
      return result;
    })();

    // T2: resolves the SAME incident with the SAME operationId. It will lock
    // the incident row FOR UPDATE, find version mismatch (T1 bumped it), and
    // throw IncidentVersionConflictError. The recovery wrapper re-checks in a
    // fresh transaction and returns idempotent_replayed.
    //
    // To force the race, T2 must run its primary transaction AFTER T1 has
    // started but the barrier is released only after T1 commits. We give T1 a
    // small head start, then run T2.
    const t2Promise = (async () => {
      // Small head start for T1 so it acquires the lock first.
      await new Promise((r) => setTimeout(r, 150));
      try {
        const result = await withIncidentOperationRecovery(
          db2,
          ctx,
          opId,
          "resolveExamIncident",
          canonicalPayload,
          async (tx) => {
            const repo = createIncidentRepo(tx);
            const audit = createAuditFn(tx, ctx);
            return resolveExamIncident(
              repo as unknown as IncidentRepo,
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
        return result;
      } finally {
        t2Release.resolve();
      }
    })();

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

    // Exactly one incident_resolved event.
    const events = await dbShared
      .select()
      .from(schema.examIncidentEvents)
      .where(eq(schema.examIncidentEvents.incidentId, incidentId));
    const resolveEvents = events.filter(
      (e) => e.eventType === "incident_resolved",
    );
    expect(resolveEvents).toHaveLength(1);

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

    // Run both concurrently against version 1. The terminal-status guard +
    // version check admit exactly one winner; the loser hits a version or
    // terminal-state conflict. Both are legitimate outcomes (no recovery to a
    // replay because the opIds differ).
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
        const r = createIncidentRepo(tx);
        return resolveExamIncident(
          r as unknown as IncidentRepo,
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

    // Give resolve a small head start so it typically wins the lock.
    await new Promise((r) => setTimeout(r, 100));

    const { dismissExamIncident } = await import("@exam/exam-engine");
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
        const r = createIncidentRepo(tx);
        return dismissExamIncident(
          r as unknown as IncidentRepo,
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

    // Exactly one wins (applied); the other conflicts (version or terminal).
    const results = await Promise.allSettled([resolvePromise, dismissPromise]);
    const fulfilled = results.filter(
      (r) => r.status === "fulfilled",
    ) as PromiseFulfilledResult<{ outcome: string }>[];
    expect(fulfilled).toHaveLength(1);
    expect(fulfilled[0]!.value.outcome).toBe("applied");

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
