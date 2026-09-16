/**
 * System incident delivery discovery reads (#304 F4A) — repo contract tests
 * against real PostgreSQL:
 *
 * - `listHeartbeatDetectedEpisodes` returns exactly the organization's
 *   committed heartbeat-detected episode facts (joined attempt identity),
 *   excluding other detection sources and other organizations; episode age is
 *   never a horizon — a year-old pending episode stays discoverable (#545
 *   T3), because the only completion authority is the arbiter probe;
 * - `listCommittedOperations` probes the `exam_incident_events`
 *   operation-unique arbiter, returning each hit with its commandType and
 *   canonical payload (existence alone is not completion), short-circuits on
 *   empty input, and unions chunked probes across the bind-safe batch
 *   boundary exactly like a single unbounded probe (#545).
 */

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { RequestContext } from "@exam/domain";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema } from "../schema/pg.js";
import { getIsolatedTestDb } from "../testDb.js";
import type { Database } from "../types.js";
import { createAttemptInterruptionEventRepo } from "./attemptInterruptionEventRepo.js";
import { createIncidentRepo, OPERATION_PROBE_BATCH } from "./incidentRepo.js";

const NOW = new Date("2026-01-01T00:00:00.000Z");

function context(organizationId: string): RequestContext {
  return {
    actorId: randomUUID(),
    organizationId,
    role: "Admin",
    permissions: [],
    sessionId: randomUUID(),
  };
}

interface OrgFixture {
  organizationId: string;
  attemptId: string;
  heartbeatEpisodeId: string;
  backfillEpisodeId: string;
}

async function createOrgFixture(
  db: Database,
  suffix: string,
): Promise<OrgFixture> {
  const organizationId = `org-${suffix}-${randomUUID().slice(0, 8)}`;
  const courseId = randomUUID();
  const examId = randomUUID();
  const enrollmentId = randomUUID();
  const attemptId = randomUUID();
  const candidateUserId = randomUUID();
  const candidateId = randomUUID();

  await db.insert(schema.organizations).values({
    id: organizationId,
    name: organizationId,
    displayName: organizationId,
    slug: organizationId,
    createdAt: NOW,
    updatedAt: NOW,
  });
  await db.insert(schema.users).values({
    id: candidateUserId,
    organizationId,
    username: `candidate-${suffix}-${candidateUserId}`,
    passwordHash: "hash",
    name: "Candidate",
    role: "Candidate",
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
  });
  await db.insert(schema.candidateProfiles).values({
    id: candidateId,
    organizationId,
    userId: candidateUserId,
    fields: {},
    createdAt: NOW,
    updatedAt: NOW,
  });
  await db.insert(schema.courses).values({
    id: courseId,
    organizationId,
    name: "c",
    code: `code-${randomUUID().slice(0, 6)}`,
    description: "",
    createdAt: NOW,
    updatedAt: NOW,
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
    openAt: NOW,
    closeAt: new Date(NOW.getTime() + 86400_000),
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
    createdAt: NOW,
    updatedAt: NOW,
  });
  await db.insert(schema.examEnrollments).values({
    id: enrollmentId,
    organizationId,
    examId,
    candidateId,
    status: "started",
    attemptCount: 1,
    createdAt: NOW,
    updatedAt: NOW,
  });
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
    startedAt: NOW,
    deadlineAt: new Date(NOW.getTime() + 3600_000),
    lastActivityAt: new Date(NOW.getTime() - 120_000),
    createdAt: NOW,
    updatedAt: NOW,
  });

  const eventRepo = createAttemptInterruptionEventRepo(db);
  const heartbeatEpisodeId = randomUUID();
  const backfillEpisodeId = randomUUID();
  for (const [episodeId, detectionSource] of [
    [heartbeatEpisodeId, "heartbeat_timeout"],
    [backfillEpisodeId, "migration_backfill"],
  ] as const) {
    await db.insert(schema.attemptInterruptions).values({
      id: episodeId,
      organizationId,
      attemptId,
      createdAt: NOW,
    });
    await eventRepo.insert(context(organizationId), {
      attemptId,
      interruptionId: episodeId,
      eventType: "detected",
      detectionSource,
      occurredAt: NOW,
      // The shape CHECK requires the heartbeat evidence only for
      // heartbeat_timeout detections; migration_backfill carries none.
      observedLastActivityAt:
        detectionSource === "heartbeat_timeout"
          ? new Date(NOW.getTime() - 120_000)
          : null,
      timeoutSeconds: detectionSource === "heartbeat_timeout" ? 60 : null,
      policy: "operator_incident",
      eligibleSeconds: null,
      timeAdjustmentId: null,
      actorId: null,
      // The shape CHECK freezes reasonCode per detection source.
      reasonCode:
        detectionSource === "heartbeat_timeout"
          ? "heartbeat_timeout"
          : "migration_backfill_unknown_detected_at",
    });
  }

  return {
    organizationId,
    attemptId,
    heartbeatEpisodeId,
    backfillEpisodeId,
  };
}

describe("system incident delivery discovery reads (#304)", () => {
  let db: Database;
  let cleanup: () => Promise<void>;
  let alpha: OrgFixture;
  let beta: OrgFixture;

  beforeAll(async () => {
    const result = await getIsolatedTestDb("sysinc-delivery-repo");
    db = result.db;
    cleanup = result.cleanup;
    alpha = await createOrgFixture(db, "alpha");
    beta = await createOrgFixture(db, "beta");
  }, 30_000);

  afterAll(async () => {
    await cleanup();
  }, 30_000);

  it("listHeartbeatDetectedEpisodes returns only the org's heartbeat episodes with joined attempt facts", async () => {
    const ctx = context(alpha.organizationId);
    const episodes =
      await createAttemptInterruptionEventRepo(
        db,
      ).listHeartbeatDetectedEpisodes(ctx);

    expect(episodes).toHaveLength(1);
    const episode = episodes[0]!;
    expect(episode.interruptionId).toBe(alpha.heartbeatEpisodeId);
    expect(episode.attemptId).toBe(alpha.attemptId);
    expect(episode.examId).toBeTruthy();
    expect(episode.candidateId).toBeTruthy();
    expect(episode.occurredAt).toEqual(NOW);
    expect(episode.observedLastActivityAt).toEqual(
      new Date(NOW.getTime() - 120_000),
    );
    expect(episode.timeoutSeconds).toBe(60);

    // Other organizations are invisible.
    const betaEpisodes = await createAttemptInterruptionEventRepo(
      db,
    ).listHeartbeatDetectedEpisodes(context(beta.organizationId));
    expect(betaEpisodes).toHaveLength(1);
    expect(betaEpisodes[0]!.interruptionId).toBe(beta.heartbeatEpisodeId);
  });

  it("listCommittedOperations returns command identity + payload from the arbiter and short-circuits on empty input", async () => {
    const ctx = context(alpha.organizationId);
    const repo = createIncidentRepo(db);

    const incident = await repo.insert(ctx, {
      examId: (
        await db
          .select()
          .from(schema.exams)
          .where(eq(schema.exams.organizationId, alpha.organizationId))
      )[0]!.id,
      attemptId: null,
      candidateId: null,
      type: "other",
      severity: "info",
      occurredAt: null,
      description: "probe fixture",
      reportedBy: "fixture",
      createdAt: NOW,
      updatedAt: NOW,
    });
    const committedId = randomUUID();
    const absentId = randomUUID();
    await repo.appendEvent(ctx, {
      incidentId: incident.id,
      eventType: "incident_created",
      commandType: "createExamIncident",
      operationId: committedId,
      actorId: ctx.actorId,
      beforeVersion: 0,
      afterVersion: 1,
      payload: {},
      createdAt: NOW,
    });

    expect(await repo.listCommittedOperations(ctx, [])).toEqual(new Map());
    const probed = await repo.listCommittedOperations(ctx, [
      committedId,
      absentId,
    ]);
    expect(probed.size).toBe(1);
    // The hit carries its command identity + payload so the caller can
    // classify completion — this fixture row is a HUMAN command, which the
    // System reconciler must treat as a conflict, not completion.
    expect(probed.get(committedId)).toEqual({
      operationId: committedId,
      commandType: "createExamIncident",
      payload: {},
    });
    expect(probed.has(absentId)).toBe(false);

    // Cross-organization operation ids are invisible.
    const betaProbed = await createIncidentRepo(db).listCommittedOperations(
      context(beta.organizationId),
      [committedId],
    );
    expect(betaProbed.size).toBe(0);
  });

  it("listHeartbeatDetectedEpisodes keeps year-old episodes discoverable — age is never a horizon (#545 T3)", async () => {
    const org = await createOrgFixture(db, "horizon");
    const ctx = context(org.organizationId);
    const OLD = new Date("2024-12-25T00:00:00.000Z");
    const oldEpisodeId = randomUUID();

    await db.insert(schema.attemptInterruptions).values({
      id: oldEpisodeId,
      organizationId: org.organizationId,
      attemptId: org.attemptId,
      createdAt: OLD,
    });
    await createAttemptInterruptionEventRepo(db).insert(ctx, {
      attemptId: org.attemptId,
      interruptionId: oldEpisodeId,
      eventType: "detected",
      detectionSource: "heartbeat_timeout",
      occurredAt: OLD,
      observedLastActivityAt: new Date(OLD.getTime() - 120_000),
      timeoutSeconds: 60,
      policy: "operator_incident",
      eligibleSeconds: null,
      timeAdjustmentId: null,
      actorId: null,
      reasonCode: "heartbeat_timeout",
    });

    // The year-old episode is returned, ordered oldest first — discovery is
    // bounded by the committed-episode ledger, never by a timestamp horizon:
    // only the arbiter probe decides completion.
    const episodes =
      await createAttemptInterruptionEventRepo(
        db,
      ).listHeartbeatDetectedEpisodes(ctx);
    expect(episodes.map((e) => e.interruptionId)).toEqual([
      oldEpisodeId,
      org.heartbeatEpisodeId,
    ]);
    expect(episodes[0]!.occurredAt).toEqual(OLD);
  });

  it("listCommittedOperations unions chunked probes across the batch boundary like a single probe (#545)", async () => {
    const ctx = context(alpha.organizationId);
    const repo = createIncidentRepo(db);

    const examId = (
      await db
        .select()
        .from(schema.exams)
        .where(eq(schema.exams.organizationId, alpha.organizationId))
    )[0]!.id;

    // Committed arbiter rows split across the batch boundary: the first 13
    // land inside chunk 1, the last 12 inside chunk 2.
    const committedIds = Array.from({ length: 25 }, () => randomUUID());
    for (const operationId of committedIds) {
      const incident = await repo.insert(ctx, {
        examId,
        attemptId: null,
        candidateId: null,
        type: "other",
        severity: "info",
        occurredAt: null,
        description: "chunk-boundary probe fixture",
        reportedBy: "fixture",
        createdAt: NOW,
        updatedAt: NOW,
      });
      await repo.appendEvent(ctx, {
        incidentId: incident.id,
        eventType: "incident_created",
        commandType: "createExamIncident",
        operationId,
        actorId: ctx.actorId,
        beforeVersion: 0,
        afterVersion: 1,
        payload: { operationId },
        createdAt: NOW,
      });
    }

    const probeIds = Array.from({ length: OPERATION_PROBE_BATCH + 12 }, () =>
      randomUUID(),
    );
    // Chunk 1 = probeIds[0 .. BATCH-1]: committed[0..12] inside.
    probeIds.splice(0, 13, ...committedIds.slice(0, 13));
    // Chunk 2 = the 12 trailing ids: committed[13..24] inside.
    probeIds.splice(OPERATION_PROBE_BATCH, 12, ...committedIds.slice(13));

    const probed = await repo.listCommittedOperations(ctx, probeIds);
    expect(probed.size).toBe(committedIds.length);
    expect([...probed.keys()].sort()).toEqual([...committedIds].sort());
    for (const operationId of committedIds) {
      expect(probed.get(operationId)!.payload).toEqual({ operationId });
    }
  });
});
