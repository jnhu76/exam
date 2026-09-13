/**
 * System incident delivery — durable completion evidence (#304 freeze C1–C4).
 *
 * Runs the production reconciliation leg (`reconcileSystemIncidents` +
 * `deliverSystemIncidentForHeartbeatEpisode` + the engine's
 * `createSystemIncidentFromHeartbeatEpisode`) against a real isolated
 * PostgreSQL schema and proves the freeze's crash/concurrency obligations:
 *
 *   C1  episode commits → (no delivery yet) → reconciliation → exactly one
 *       System incident; a second pass creates nothing (probe skips it).
 *   C2  the System create commits → the caller loses the result → a retry
 *       with the same deterministic operationId replays the SAME incident.
 *   C3  two concurrent reconcilers race on one episode → the deterministic
 *       operationId + the op-unique arbiter converge to exactly one System
 *       incident and one evidence link (invariant holds for every
 *       interleaving; no barriers needed).
 *   C4  a human-created incident references the episode while System
 *       delivery runs → both authorities coexist; the System path still
 *       converges to exactly one SYSTEM incident; human-path semantics are
 *       unchanged.
 *   C5  a caller-supplied human operationId collides with the episode's
 *       derived System operationId (different command + payload committed
 *       first) → reconciliation reports a VISIBLE conflict (never a silent
 *       skip): "operationId exists" ≠ "System command completed".
 *   C6  storm/backpressure: repeated reconciliation over a large completed
 *       history plus a few pending episodes → zero duplicates, pending
 *       converge, no per-cycle failure mode.
 *
 * Episodes are committed through the production heartbeat path
 * (`markAttemptDisrupted`), so the durable fact source is the real
 * `attempt_interruptions` ledger + `detected` event with
 * `detection_source="heartbeat_timeout"`. Each test owns an isolated
 * organization fixture because one attempt commits exactly one episode.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  createPostgresDatabase,
  migratePostgres,
} from "@exam/db/src/postgres.js";
import { withTestInfraLifecycleLock } from "@exam/db/src/testInfraLock.js";
import { setupIsolatedTestDb } from "@exam/db/src/testIsolation.js";
import { resolveTestDbUrl } from "@exam/db/src/testDb.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { createAttemptInterruptionRepo } from "@exam/db/src/repository/attemptInterruptionRepo.js";
import { createAttemptInterruptionEventRepo } from "@exam/db/src/repository/attemptInterruptionEventRepo.js";
import { createIncidentRepo } from "@exam/db/src/repository/incidentRepo.js";
import type { RequestContext } from "@exam/domain";
import { IdempotencyConflictError } from "@exam/domain";
import { SYSTEM_ACTOR_IDS, createSystemRequestContext } from "@exam/authz";
import type { IncidentRepo } from "@exam/exam-engine";
import {
  linkIncidentInterruption,
  systemIncidentOperationId,
} from "@exam/exam-engine";
import type { Database } from "@exam/db/src/types.js";
import { markAttemptDisrupted } from "../plugins/heartbeat.js";
import {
  deliverSystemIncidentForHeartbeatEpisode,
  reconcileSystemIncidents,
} from "./systemIncidentDelivery.js";

const NOW = new Date("2026-09-13T12:00:00.000Z");
const DETECTOR_ACTOR_ID = SYSTEM_ACTOR_IDS.IncidentDetector;

interface Fixture {
  organizationId: string;
  examId: string;
  attemptId: string;
  candidateId: string;
  detectorCtx: RequestContext;
  humanCtx: RequestContext;
}

async function seedFixture(db: Database, suffix: string): Promise<Fixture> {
  const now = NOW;
  const organizationId = `sysinc-${suffix}-${randomUUID().slice(0, 8)}`;
  const actorId = randomUUID();
  const candidateUserId = randomUUID();
  const candidateId = randomUUID();
  const courseId = randomUUID();
  const examId = randomUUID();
  const enrollmentId = randomUUID();
  const attemptId = randomUUID();

  await db.insert(schema.organizations).values({
    id: organizationId,
    name: organizationId,
    displayName: organizationId,
    slug: organizationId,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.users).values([
    {
      id: actorId,
      organizationId,
      username: `actor-${suffix}-${actorId}`,
      passwordHash: "hash",
      name: "Actor",
      role: "Admin",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: candidateUserId,
      organizationId,
      username: `candidate-${suffix}-${candidateUserId}`,
      passwordHash: "hash",
      name: "Candidate",
      role: "Candidate",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await db.insert(schema.candidateProfiles).values({
    id: candidateId,
    organizationId,
    userId: candidateUserId,
    fields: {},
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.courses).values({
    id: courseId,
    organizationId,
    name: "c",
    code: `code-${randomUUID().slice(0, 6)}`,
    description: "",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.exams).values({
    id: examId,
    organizationId,
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
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.examEnrollments).values({
    id: enrollmentId,
    organizationId,
    examId,
    candidateId,
    status: "started",
    attemptCount: 1,
    createdAt: now,
    updatedAt: now,
  });
  // Stale in-progress attempt: the heartbeat timeout commits an episode when
  // the production scanner path runs against it.
  await db.insert(schema.examAttempts).values({
    id: attemptId,
    organizationId,
    examId,
    enrollmentId,
    candidateId,
    attemptNo: 1,
    status: "in_progress",
    questionSnapshot: [],
    answers: [],
    startedAt: now,
    deadlineAt: new Date(now.getTime() + 3600_000),
    lastActivityAt: new Date(now.getTime() - 120_000),
    createdAt: now,
    updatedAt: now,
  });

  return {
    organizationId,
    examId,
    attemptId,
    candidateId,
    detectorCtx: createSystemRequestContext(organizationId, DETECTOR_ACTOR_ID),
    humanCtx: {
      actorId: `human-admin-${suffix}`,
      organizationId,
      role: "Admin",
      permissions: [],
      sessionId: randomUUID(),
    },
  };
}

describe("system incident delivery — durable completion evidence (#304 C1–C4)", () => {
  let iso: Awaited<ReturnType<typeof setupIsolatedTestDb>>;
  let dbShared: Database;
  let db1: Database;
  let db2: Database;
  let sqlShared: { end(): Promise<void> };
  let sql1: { end(): Promise<void> };
  let sql2: { end(): Promise<void> };

  beforeAll(async () => {
    const testDbUrl = resolveTestDbUrl();
    iso = await setupIsolatedTestDb({
      namespace: "sysinc",
      databaseUrl: testDbUrl,
    });
    const shared = await createPostgresDatabase(
      iso.databaseUrl,
      iso.schemaName,
    );
    dbShared = shared.db;
    sqlShared = shared.sql;
    await withTestInfraLifecycleLock(iso.databaseUrl, () =>
      migratePostgres(dbShared, { migrationsSchema: iso.schemaName }),
    );
    const c1 = await createPostgresDatabase(iso.databaseUrl, iso.schemaName);
    const c2 = await createPostgresDatabase(iso.databaseUrl, iso.schemaName);
    db1 = c1.db;
    db2 = c2.db;
    sql1 = c1.sql;
    sql2 = c2.sql;
  }, 120_000);

  afterAll(async () => {
    await Promise.allSettled([
      sql2?.end() ?? Promise.resolve(),
      sql1?.end() ?? Promise.resolve(),
      sqlShared?.end() ?? Promise.resolve(),
    ]);
    await iso?.cleanup().catch(() => {});
  }, 30_000);

  /** Commits one real heartbeat episode through the production scanner path. */
  async function commitHeartbeatEpisode(
    db: Database,
    fixture: Fixture,
  ): Promise<string> {
    const marked = await markAttemptDisrupted(
      db,
      createSystemRequestContext(
        fixture.organizationId,
        SYSTEM_ACTOR_IDS.Heartbeat,
      ),
      fixture.attemptId,
      60,
      NOW,
    );
    expect(marked).toBe(true);
    const episode = await db
      .select()
      .from(schema.attemptInterruptions)
      .where(
        and(
          eq(
            schema.attemptInterruptions.organizationId,
            fixture.organizationId,
          ),
          eq(schema.attemptInterruptions.attemptId, fixture.attemptId),
        ),
      );
    expect(episode).toHaveLength(1);
    return episode[0]!.id;
  }

  function orgSystemIncidents(fixture: Fixture) {
    return dbShared
      .select()
      .from(schema.examIncidents)
      .where(eq(schema.examIncidents.organizationId, fixture.organizationId));
  }

  /**
   * Commits `count` durable heartbeat episodes for the fixture attempt via
   * direct ledger inserts (the same shape the production scanner path
   * commits). Used to build a bounded large history without mutating the
   * attempt's status pointer once per episode.
   */
  async function commitEpisodes(
    db: Database,
    fixture: Fixture,
    count: number,
  ): Promise<string[]> {
    const episodeIds = Array.from({ length: count }, () => randomUUID());
    await db.insert(schema.attemptInterruptions).values(
      episodeIds.map((id) => ({
        id,
        organizationId: fixture.organizationId,
        attemptId: fixture.attemptId,
        createdAt: NOW,
      })),
    );
    const eventRepo = createAttemptInterruptionEventRepo(db);
    for (const id of episodeIds) {
      await eventRepo.insert(fixture.humanCtx, {
        attemptId: fixture.attemptId,
        interruptionId: id,
        eventType: "detected",
        detectionSource: "heartbeat_timeout",
        occurredAt: NOW,
        observedLastActivityAt: new Date(NOW.getTime() - 120_000),
        timeoutSeconds: 60,
        policy: "operator_incident",
        eligibleSeconds: null,
        timeAdjustmentId: null,
        actorId: null,
        reasonCode: "heartbeat_timeout",
      });
    }
    return episodeIds;
  }

  it("C1: episode commits → reconciliation creates exactly one System incident; a second pass creates nothing", async () => {
    const fixture = await seedFixture(dbShared, "c1");
    const episodeId = await commitHeartbeatEpisode(dbShared, fixture);

    const counts = await reconcileSystemIncidents(
      dbShared,
      fixture.detectorCtx,
      {
        now: NOW,
      },
    );
    expect(counts.createdCount).toBe(1);
    expect(counts.failedCount).toBe(0);

    const incidents = await orgSystemIncidents(fixture);
    expect(incidents).toHaveLength(1);
    const incident = incidents[0]!;
    expect(incident.reportedBy).toBe(DETECTOR_ACTOR_ID);
    expect(incident.attemptId).toBe(fixture.attemptId);
    expect(incident.candidateId).toBe(fixture.candidateId);
    expect(incident.examId).toBe(fixture.examId);
    expect(incident.type).toBe("network_interruption");
    expect(incident.severity).toBe("info");
    expect(incident.description).toContain("heartbeat_timeout");
    expect(incident.description).toContain(episodeId);

    // Evidence link bound to the same episode + detector identity.
    const link = (
      await dbShared
        .select()
        .from(schema.examIncidentInterruptionLinks)
        .where(
          eq(schema.examIncidentInterruptionLinks.interruptionId, episodeId),
        )
    )[0]!;
    expect(link.incidentId).toBe(incident.id);
    expect(link.linkedBy).toBe(DETECTOR_ACTOR_ID);

    // Canonical audit: incident.created with the System actor identity (F8).
    const audit = (
      await dbShared
        .select()
        .from(schema.auditLogs)
        .where(
          and(
            eq(schema.auditLogs.action, "incident.created"),
            eq(schema.auditLogs.actorId, DETECTOR_ACTOR_ID),
            eq(schema.auditLogs.targetId, incident.id),
          ),
        )
    )[0]!;
    expect(audit).toBeTruthy();

    // Restart/sweep simulation: the completed episode is no longer pending.
    const second = await reconcileSystemIncidents(
      dbShared,
      fixture.detectorCtx,
      { now: NOW },
    );
    expect(second.createdCount).toBe(0);
    expect(second.failedCount).toBe(0);
    expect(await orgSystemIncidents(fixture)).toHaveLength(1);
  });

  it("C2: committed delivery replayed by a retry returns the SAME System incident", async () => {
    const fixture = await seedFixture(dbShared, "c2");
    const episodeId = await commitHeartbeatEpisode(dbShared, fixture);
    const fact = {
      interruptionId: episodeId,
      examId: fixture.examId,
      attemptId: fixture.attemptId,
      candidateId: fixture.candidateId,
      detected: {
        occurredAt: NOW,
        observedLastActivityAt: new Date(NOW.getTime() - 120_000),
        timeoutSeconds: 60,
      },
    };

    const first = await deliverSystemIncidentForHeartbeatEpisode(
      dbShared,
      fixture.detectorCtx,
      fact,
      { now: NOW },
    );
    expect(first.outcome).toBe("applied");

    // Caller loses the result and retries with the same deterministic facts.
    const second = await deliverSystemIncidentForHeartbeatEpisode(
      dbShared,
      fixture.detectorCtx,
      fact,
      { now: NOW },
    );
    expect(second.outcome).toBe("idempotent_replayed");
    expect(second.incident.id).toBe(first.incident.id);
    expect(await orgSystemIncidents(fixture)).toHaveLength(1);
  });

  it("C3: two concurrent reconcilers race on one episode → exactly one System incident/link", async () => {
    const fixture = await seedFixture(dbShared, "c3");
    const episodeId = await commitHeartbeatEpisode(dbShared, fixture);

    const [a, b] = await Promise.all([
      reconcileSystemIncidents(db1, fixture.detectorCtx, { now: NOW }),
      reconcileSystemIncidents(db2, fixture.detectorCtx, { now: NOW }),
    ]);

    expect(a.failedCount + b.failedCount).toBe(0);
    // The op-unique arbiter commits the create operation EXACTLY once: one
    // reconciler reports `applied`, the racing one converges to `replayed`
    // (via 23505 + fresh-transaction recovery) — never two created.
    expect(a.createdCount + b.createdCount).toBe(1);
    expect(
      a.createdCount + b.createdCount + a.replayedCount + b.replayedCount,
    ).toBe(2);

    expect(await orgSystemIncidents(fixture)).toHaveLength(1);
    const links = await dbShared
      .select()
      .from(schema.examIncidentInterruptionLinks)
      .where(
        eq(schema.examIncidentInterruptionLinks.interruptionId, episodeId),
      );
    expect(links).toHaveLength(1);
  });

  it("C4: human incident references the episode while System delivery runs → both coexist, exactly one SYSTEM incident", async () => {
    const fixture = await seedFixture(dbShared, "c4");
    const episodeId = await commitHeartbeatEpisode(dbShared, fixture);

    // A human-created incident WITH an evidence link to the SAME episode,
    // racing the System reconciliation pass (true Human ∥ System overlap:
    // both run to completion regardless of commit ordering).
    const humanIncidentId = (async () => {
      const repo = createIncidentRepo(dbShared);
      const incident = await repo.insert(fixture.humanCtx, {
        examId: fixture.examId,
        attemptId: fixture.attemptId,
        candidateId: fixture.candidateId,
        type: "other",
        severity: "info",
        occurredAt: null,
        description: "human operator case for the same episode",
        reportedBy: fixture.humanCtx.actorId,
        createdAt: NOW,
        updatedAt: NOW,
      });
      await repo.appendEvent(fixture.humanCtx, {
        incidentId: incident.id,
        eventType: "incident_created",
        commandType: "createExamIncident",
        operationId: randomUUID(),
        actorId: fixture.humanCtx.actorId,
        beforeVersion: 0,
        afterVersion: 1,
        payload: {},
        createdAt: NOW,
      });
      // Human evidence link through the PRODUCTION link command — the human
      // path keeps its own operationId, transaction, and semantics.
      await linkIncidentInterruption(
        repo as unknown as IncidentRepo,
        fixture.humanCtx,
        incident.id,
        { operationId: randomUUID(), interruptionId: episodeId },
        {
          now: NOW,
          audit: async () => {},
          lookupInterruptionAttempt: async (iid) => {
            const ep = await createAttemptInterruptionRepo(dbShared).findById(
              fixture.humanCtx,
              iid,
            );
            return ep ? ep.attemptId : null;
          },
          lookupAttempt: async (aid) => {
            const attempt = await createAttemptRepo(dbShared).findById(
              fixture.humanCtx,
              aid,
            );
            return attempt
              ? {
                  examId: attempt.examId,
                  candidateId: attempt.candidateId,
                  organizationId: attempt.organizationId,
                }
              : null;
          },
        },
      );
      return incident.id;
    })();

    const systemDelivery = reconcileSystemIncidents(db1, fixture.detectorCtx, {
      now: NOW,
    });

    const [, sys] = await Promise.all([humanIncidentId, systemDelivery]);
    expect(sys.failedCount).toBe(0);
    expect(sys.createdCount).toBe(1);

    // Human path semantics unchanged: the human incident + its evidence link
    // coexist with exactly one System incident + its own link.
    const incidents = await orgSystemIncidents(fixture);
    expect(incidents).toHaveLength(2);
    expect(
      incidents.filter((i) => i.reportedBy === DETECTOR_ACTOR_ID),
    ).toHaveLength(1);
    expect(
      incidents.filter((i) => i.reportedBy === fixture.humanCtx.actorId),
    ).toHaveLength(1);

    const episodeLinks = await dbShared
      .select()
      .from(schema.examIncidentInterruptionLinks)
      .where(
        eq(schema.examIncidentInterruptionLinks.interruptionId, episodeId),
      );
    expect(episodeLinks).toHaveLength(2);
    const humanIncident = await humanIncidentId;
    const humanLink = episodeLinks.find(
      (l) => l.incidentId === humanIncident && l.linkedBy !== DETECTOR_ACTOR_ID,
    );
    const systemLink = episodeLinks.find(
      (l) => l.linkedBy === DETECTOR_ACTOR_ID,
    );
    expect(humanLink).toBeTruthy();
    expect(systemLink).toBeTruthy();
  });

  it("C5: caller-supplied human operationId colliding with the derived System operationId → VISIBLE conflict, never a silent skip", async () => {
    const fixture = await seedFixture(dbShared, "c5");
    const episodeId = await commitHeartbeatEpisode(dbShared, fixture);
    const collisionOperationId = systemIncidentOperationId(episodeId);

    // The human incident API accepts a caller-supplied operationId. The
    // human create command commits FIRST under the episode-derived
    // operationId, with its own command identity and payload — the exact
    // adversarial case a bare-existence probe would mistake for completion.
    const humanRepo = createIncidentRepo(dbShared);
    const humanIncident = await humanRepo.insert(fixture.humanCtx, {
      examId: fixture.examId,
      attemptId: fixture.attemptId,
      candidateId: fixture.candidateId,
      type: "other",
      severity: "info",
      occurredAt: null,
      description: "human case committed under the colliding operationId",
      reportedBy: fixture.humanCtx.actorId,
      createdAt: NOW,
      updatedAt: NOW,
    });
    await humanRepo.appendEvent(fixture.humanCtx, {
      incidentId: humanIncident.id,
      eventType: "incident_created",
      commandType: "createExamIncident",
      operationId: collisionOperationId,
      actorId: fixture.humanCtx.actorId,
      beforeVersion: 0,
      afterVersion: 1,
      payload: {},
      createdAt: NOW,
    });

    const failures: Array<{ interruptionId: string; err: unknown }> = [];
    const counts = await reconcileSystemIncidents(
      dbShared,
      fixture.detectorCtx,
      {
        now: NOW,
        onError: (interruptionId, err) => {
          failures.push({ interruptionId, err });
        },
      },
    );

    // NOT completed: no System incident exists for the episode.
    expect(counts.createdCount).toBe(0);
    // NOT silently skipped: the conflicting operation is counted and
    // reported — the engine pre-read raises IdempotencyConflictError, the
    // same arbiter semantics as every other incident command.
    expect(counts.failedCount).toBe(1);
    expect(counts.conflictCount).toBe(1);
    expect(failures).toHaveLength(1);
    expect(failures[0]!.interruptionId).toBe(episodeId);
    expect(failures[0]!.err).toBeInstanceOf(IdempotencyConflictError);

    // The arbiter row still belongs to the human command; a later pass
    // surfaces the same conflict again (never converts it into a skip).
    const again = await reconcileSystemIncidents(
      dbShared,
      fixture.detectorCtx,
      { now: NOW },
    );
    expect(again.createdCount).toBe(0);
    expect(again.conflictCount).toBe(1);
    expect(await orgSystemIncidents(fixture)).toHaveLength(1);
  });

  it("C6: storm/backpressure — large completed history + pending episodes converge with zero duplicates across repeated cycles", async () => {
    const fixture = await seedFixture(dbShared, "c6");
    const COMPLETED_EPISODES = 200;
    const PENDING_EPISODES = 5;
    const TOTAL = COMPLETED_EPISODES + PENDING_EPISODES;

    const factFor = (episodeId: string) => ({
      interruptionId: episodeId,
      examId: fixture.examId,
      attemptId: fixture.attemptId,
      candidateId: fixture.candidateId,
      detected: {
        occurredAt: NOW,
        observedLastActivityAt: new Date(NOW.getTime() - 120_000),
        timeoutSeconds: 60,
      },
    });

    // Bounded large history: real heartbeat episodes on the fixture attempt,
    // delivered through the PRODUCTION path so the arbiter rows are genuine
    // committed System operations, not synthetic rows.
    const completedIds = await commitEpisodes(
      dbShared,
      fixture,
      COMPLETED_EPISODES,
    );
    for (const episodeId of completedIds) {
      const result = await deliverSystemIncidentForHeartbeatEpisode(
        dbShared,
        fixture.detectorCtx,
        factFor(episodeId),
        { now: NOW },
      );
      expect(result.outcome).toBe("applied");
    }

    // A few pending episodes on top of the large completed history.
    const pendingIds = await commitEpisodes(
      dbShared,
      fixture,
      PENDING_EPISODES,
    );

    // Repeated reconciliation cycles over the full history: pending
    // converge, then every steady-state cycle is a clean no-op.
    const cycle1 = await reconcileSystemIncidents(
      dbShared,
      fixture.detectorCtx,
      { now: NOW },
    );
    expect(cycle1.createdCount).toBe(PENDING_EPISODES);
    expect(cycle1.replayedCount).toBe(0);
    expect(cycle1.failedCount).toBe(0);
    expect(cycle1.conflictCount).toBe(0);

    for (let cycle = 0; cycle < 2; cycle++) {
      const steady = await reconcileSystemIncidents(
        dbShared,
        fixture.detectorCtx,
        { now: NOW },
      );
      expect(steady.createdCount).toBe(0);
      expect(steady.replayedCount).toBe(0);
      expect(steady.failedCount).toBe(0);
      expect(steady.conflictCount).toBe(0);
    }

    // Zero duplicates: exactly one arbiter event, incident, and evidence
    // link per episode — no storm, no pathological commit behavior.
    expect(await orgSystemIncidents(fixture)).toHaveLength(TOTAL);
    const events = await dbShared
      .select({ operationId: schema.examIncidentEvents.operationId })
      .from(schema.examIncidentEvents)
      .where(
        eq(schema.examIncidentEvents.organizationId, fixture.organizationId),
      );
    expect(events).toHaveLength(TOTAL);
    const opIds = new Set(events.map((e) => e.operationId));
    expect(opIds.size).toBe(TOTAL);
    for (const id of [...completedIds, ...pendingIds]) {
      expect(opIds.has(systemIncidentOperationId(id))).toBe(true);
    }
    const links = await dbShared
      .select({ id: schema.examIncidentInterruptionLinks.id })
      .from(schema.examIncidentInterruptionLinks)
      .where(
        eq(
          schema.examIncidentInterruptionLinks.organizationId,
          fixture.organizationId,
        ),
      );
    expect(links).toHaveLength(TOTAL);
  }, 180_000);
});
