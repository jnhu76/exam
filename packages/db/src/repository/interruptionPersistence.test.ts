import { randomUUID } from "node:crypto";
import type { RequestContext } from "@exam/domain";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { schema } from "../schema/pg.js";
import { getIsolatedTestDb } from "../testDb.js";
import type { Database } from "../types.js";
import { createAttemptInterruptionEventRepo } from "./attemptInterruptionEventRepo.js";
import { createAttemptInterruptionRepo } from "./attemptInterruptionRepo.js";
import { createAttemptTimeAdjustmentRepo } from "./attemptTimeAdjustmentRepo.js";

function context(organizationId: string, actorId: string): RequestContext {
  return {
    actorId,
    organizationId,
    role: "Admin",
    permissions: [],
    sessionId: randomUUID(),
  };
}

interface Fixture {
  organizationId: string;
  actorId: string;
  examId: string;
  attemptId: string;
  ctx: RequestContext;
}

async function createFixture(db: Database, suffix: string): Promise<Fixture> {
  const now = new Date("2026-01-01T00:00:00.000Z");
  const organizationId = randomUUID();
  const courseId = randomUUID();
  const examId = randomUUID();
  const actorId = randomUUID();
  const candidateUserId = randomUUID();
  const candidateId = randomUUID();
  const enrollmentId = randomUUID();
  const attemptId = randomUUID();

  await db.insert(schema.organizations).values({
    id: organizationId,
    name: `Org ${suffix}`,
    displayName: `Org ${suffix}`,
    slug: `org-${suffix}-${organizationId}`,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.courses).values({
    id: courseId,
    organizationId,
    name: "Course",
    code: `C-${suffix}-${courseId}`,
    description: "",
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
  await db.insert(schema.exams).values({
    id: examId,
    organizationId,
    title: "Exam",
    description: "",
    courseId,
    status: "open",
    timingMode: "timed_window",
    durationMinutes: 60,
    openAt: now,
    closeAt: new Date("2026-01-02T00:00:00.000Z"),
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
    deadlineAt: new Date("2026-01-01T01:00:00.000Z"),
    lastActivityAt: now,
    createdAt: now,
    updatedAt: now,
  });
  return {
    organizationId,
    actorId,
    examId,
    attemptId,
    ctx: context(organizationId, actorId),
  };
}

describe("interruption persistence foundation", () => {
  let db: Database;
  let cleanup: () => Promise<void>;
  let alpha: Fixture;
  let beta: Fixture;

  beforeAll(async () => {
    const result = await getIsolatedTestDb("interruption-persistence");
    db = result.db;
    cleanup = result.cleanup;
    alpha = await createFixture(db, "alpha");
    beta = await createFixture(db, "beta");
  });

  afterAll(async () => {
    await cleanup();
  });

  it("applies strict defaults to Exam and Attempt snapshot columns", async () => {
    const exam = await db
      .select()
      .from(schema.exams)
      .where(eq(schema.exams.id, alpha.examId));
    const attempt = await db
      .select()
      .from(schema.examAttempts)
      .where(eq(schema.examAttempts.id, alpha.attemptId));

    expect(exam[0]).toMatchObject({
      interruptionTimePolicy: "strict",
      interruptionGracePerIncidentSeconds: null,
      interruptionGracePerAttemptSeconds: null,
    });
    expect(attempt[0]).toMatchObject({
      interruptionPolicySnapshotVersion: 1,
      interruptionTimePolicySnapshot: "strict",
      interruptionGracePerIncidentSecondsSnapshot: null,
      interruptionGracePerAttemptSecondsSnapshot: null,
      currentInterruptionId: null,
      interruptedAt: null,
    });
  });

  it("enforces Exam and Attempt policy/cap shapes", async () => {
    await expect(
      db
        .update(schema.exams)
        .set({
          interruptionTimePolicy: "bounded_grace",
          interruptionGracePerIncidentSeconds: 60,
          interruptionGracePerAttemptSeconds: 180,
        })
        .where(eq(schema.exams.id, alpha.examId)),
    ).resolves.not.toThrow();
    await expect(
      db
        .update(schema.exams)
        .set({
          interruptionTimePolicy: "strict",
          interruptionGracePerIncidentSeconds: 1,
          interruptionGracePerAttemptSeconds: null,
        })
        .where(eq(schema.exams.id, alpha.examId)),
    ).rejects.toMatchObject({
      cause: { constraint_name: "exams_interruption_policy_caps_check" },
    });
    await expect(
      db
        .update(schema.exams)
        .set({
          interruptionTimePolicy: "bounded_grace",
          interruptionGracePerIncidentSeconds: null,
          interruptionGracePerAttemptSeconds: 180,
        })
        .where(eq(schema.exams.id, alpha.examId)),
    ).rejects.toMatchObject({
      cause: { constraint_name: "exams_interruption_policy_caps_check" },
    });
    await expect(
      db
        .update(schema.exams)
        .set({
          interruptionTimePolicy: "bounded_grace",
          interruptionGracePerIncidentSeconds: -1,
          interruptionGracePerAttemptSeconds: 180,
        })
        .where(eq(schema.exams.id, alpha.examId)),
    ).rejects.toMatchObject({
      cause: { constraint_name: "exams_interruption_policy_caps_check" },
    });
    await expect(
      db
        .update(schema.exams)
        .set({ interruptionTimePolicy: "unknown" as never })
        .where(eq(schema.exams.id, alpha.examId)),
    ).rejects.toMatchObject({
      cause: { constraint_name: "exams_interruption_time_policy_check" },
    });
    await expect(
      db
        .update(schema.exams)
        .set({
          interruptionTimePolicy: "operator_incident",
          interruptionGracePerIncidentSeconds: 1,
          interruptionGracePerAttemptSeconds: null,
        })
        .where(eq(schema.exams.id, alpha.examId)),
    ).rejects.toMatchObject({
      cause: { constraint_name: "exams_interruption_policy_caps_check" },
    });
    await expect(
      db
        .update(schema.exams)
        .set({
          interruptionTimePolicy: "bounded_grace",
          interruptionGracePerIncidentSeconds: 181,
          interruptionGracePerAttemptSeconds: 180,
        })
        .where(eq(schema.exams.id, alpha.examId)),
    ).rejects.toMatchObject({
      cause: { constraint_name: "exams_interruption_policy_caps_check" },
    });
    await expect(
      db
        .update(schema.examAttempts)
        .set({ interruptionPolicySnapshotVersion: 2 })
        .where(eq(schema.examAttempts.id, alpha.attemptId)),
    ).rejects.toMatchObject({
      cause: {
        constraint_name: "exam_attempts_interruption_snapshot_version_check",
      },
    });
    await expect(
      db
        .update(schema.examAttempts)
        .set({
          interruptionTimePolicySnapshot: "bounded_grace",
          interruptionGracePerIncidentSecondsSnapshot: 0,
          interruptionGracePerAttemptSecondsSnapshot: 10,
        })
        .where(eq(schema.examAttempts.id, alpha.attemptId)),
    ).rejects.toMatchObject({
      cause: {
        constraint_name: "exam_attempts_interruption_snapshot_caps_check",
      },
    });
    await expect(
      db
        .update(schema.examAttempts)
        .set({
          interruptionTimePolicySnapshot: "operator_incident",
          interruptionGracePerIncidentSecondsSnapshot: null,
          interruptionGracePerAttemptSecondsSnapshot: null,
        })
        .where(eq(schema.examAttempts.id, alpha.attemptId)),
    ).resolves.not.toThrow();
  });

  it("enforces active pointer attempt and organization identity", async () => {
    const repo = createAttemptInterruptionRepo(db);
    const episode = await repo.create(alpha.ctx, {
      attemptId: alpha.attemptId,
    });
    const interruptedAt = new Date("2026-01-01T00:10:00.000Z");

    await expect(
      db
        .update(schema.examAttempts)
        .set({ currentInterruptionId: episode.id, interruptedAt })
        .where(eq(schema.examAttempts.id, alpha.attemptId)),
    ).resolves.not.toThrow();
    await expect(
      db
        .update(schema.examAttempts)
        .set({ currentInterruptionId: randomUUID(), interruptedAt })
        .where(eq(schema.examAttempts.id, alpha.attemptId)),
    ).rejects.toMatchObject({
      cause: { constraint_name: "exam_attempts_current_interruption_fk" },
    });
    await expect(
      db
        .update(schema.examAttempts)
        .set({ currentInterruptionId: episode.id, interruptedAt })
        .where(eq(schema.examAttempts.id, beta.attemptId)),
    ).rejects.toMatchObject({
      cause: { constraint_name: "exam_attempts_current_interruption_fk" },
    });
    await expect(
      db
        .update(schema.examAttempts)
        .set({ currentInterruptionId: null, interruptedAt })
        .where(eq(schema.examAttempts.id, alpha.attemptId)),
    ).rejects.toMatchObject({
      cause: {
        constraint_name: "exam_attempts_current_interruption_pair_check",
      },
    });
  });

  it("round-trips tenant-scoped append-only repositories", async () => {
    const interruptionRepo = createAttemptInterruptionRepo(db);
    const eventRepo = createAttemptInterruptionEventRepo(db);
    const adjustmentRepo = createAttemptTimeAdjustmentRepo(db);
    const episode = await interruptionRepo.create(alpha.ctx, {
      attemptId: alpha.attemptId,
    });
    const occurredAt = new Date("2026-01-01T00:20:00.000Z");
    const detected = await eventRepo.insert(alpha.ctx, {
      attemptId: alpha.attemptId,
      interruptionId: episode.id,
      eventType: "detected",
      occurredAt,
      observedLastActivityAt: new Date("2026-01-01T00:18:00.000Z"),
      detectionSource: "heartbeat_timeout",
      timeoutSeconds: 60,
      policy: "bounded_grace",
      eligibleSeconds: 30,
      timeAdjustmentId: null,
      actorId: null,
      reasonCode: "heartbeat_timeout",
    });
    const adjustment = await adjustmentRepo.insert(alpha.ctx, {
      operationId: randomUUID(),
      attemptId: alpha.attemptId,
      interruptionId: episode.id,
      incidentId: null,
      policy: "bounded_grace",
      source: "bounded_grace",
      beforeDeadline: new Date("2026-01-01T01:00:00.000Z"),
      afterDeadline: new Date("2026-01-01T01:00:30.000Z"),
      addedSeconds: 30,
      eligibleSeconds: 30,
      reasonCode: "bounded_grace",
      reasonText: null,
      actorId: null,
    });
    await eventRepo.insert(alpha.ctx, {
      attemptId: alpha.attemptId,
      interruptionId: episode.id,
      eventType: "restored",
      occurredAt: new Date("2026-01-01T00:21:00.000Z"),
      observedLastActivityAt: null,
      detectionSource: null,
      timeoutSeconds: null,
      policy: "bounded_grace",
      eligibleSeconds: 30,
      timeAdjustmentId: adjustment.id,
      actorId: null,
      reasonCode: "restored",
    });

    expect(await interruptionRepo.findById(alpha.ctx, episode.id)).toEqual(
      episode,
    );
    expect(await interruptionRepo.findById(beta.ctx, episode.id)).toBeNull();
    expect(await eventRepo.findDetected(alpha.ctx, episode.id)).toEqual(
      detected,
    );
    expect(await eventRepo.findOutcome(alpha.ctx, episode.id)).toMatchObject({
      eventType: "restored",
    });
    expect(await eventRepo.listByAttempt(beta.ctx, alpha.attemptId)).toEqual(
      [],
    );
    expect(
      await adjustmentRepo.findByOperationId(alpha.ctx, adjustment.operationId),
    ).toEqual(adjustment);
    expect(
      await adjustmentRepo.findBoundedByInterruption(alpha.ctx, episode.id),
    ).toEqual(adjustment);
    expect(
      await adjustmentRepo.sumBoundedGraceSeconds(alpha.ctx, alpha.attemptId),
    ).toBe(30);
    expect(
      await adjustmentRepo.sumBoundedGraceSeconds(beta.ctx, alpha.attemptId),
    ).toBe(0);
    expect("update" in interruptionRepo).toBe(false);
    expect("delete" in interruptionRepo).toBe(false);
    expect("update" in eventRepo).toBe(false);
    expect("delete" in adjustmentRepo).toBe(false);
  });

  it("enforces event cardinality and field shapes", async () => {
    const interruptionRepo = createAttemptInterruptionRepo(db);
    const eventRepo = createAttemptInterruptionEventRepo(db);
    const episode = await interruptionRepo.create(alpha.ctx, {
      attemptId: alpha.attemptId,
    });
    const base = {
      attemptId: alpha.attemptId,
      interruptionId: episode.id,
      occurredAt: new Date("2026-01-01T00:30:00.000Z"),
      policy: "strict" as const,
      eligibleSeconds: null,
      timeAdjustmentId: null,
      actorId: null,
    };
    await eventRepo.insert(alpha.ctx, {
      ...base,
      eventType: "detected",
      observedLastActivityAt: null,
      detectionSource: "migration_backfill",
      timeoutSeconds: null,
      reasonCode: "migration_backfill_unknown_detected_at",
    });
    await expect(
      eventRepo.insert(alpha.ctx, {
        ...base,
        eventType: "detected",
        observedLastActivityAt: null,
        detectionSource: "migration_backfill",
        timeoutSeconds: null,
        reasonCode: "migration_backfill_unknown_detected_at",
      }),
    ).rejects.toMatchObject({
      cause: { constraint_name: "attempt_interruption_events_detected_unique" },
    });
    await eventRepo.insert(alpha.ctx, {
      ...base,
      eventType: "terminalized",
      observedLastActivityAt: null,
      detectionSource: null,
      timeoutSeconds: null,
      reasonCode: "terminalized",
    });
    await expect(
      eventRepo.insert(alpha.ctx, {
        ...base,
        eventType: "restored",
        observedLastActivityAt: null,
        detectionSource: null,
        timeoutSeconds: null,
        reasonCode: "restored",
      }),
    ).rejects.toMatchObject({
      cause: { constraint_name: "attempt_interruption_events_outcome_unique" },
    });
    const heartbeatEpisode = await interruptionRepo.create(alpha.ctx, {
      attemptId: alpha.attemptId,
    });
    await expect(
      eventRepo.insert(alpha.ctx, {
        ...base,
        interruptionId: heartbeatEpisode.id,
        eventType: "detected",
        observedLastActivityAt: null,
        detectionSource: "heartbeat_timeout",
        timeoutSeconds: 60,
        reasonCode: "heartbeat_timeout",
      }),
    ).rejects.toMatchObject({
      cause: { constraint_name: "attempt_interruption_events_shape_check" },
    });
    await expect(
      eventRepo.insert(alpha.ctx, {
        ...base,
        interruptionId: heartbeatEpisode.id,
        eventType: "detected",
        observedLastActivityAt: base.occurredAt,
        detectionSource: "heartbeat_timeout",
        timeoutSeconds: 0,
        reasonCode: "heartbeat_timeout",
      }),
    ).rejects.toMatchObject({
      cause: { constraint_name: "attempt_interruption_events_shape_check" },
    });
  });

  it("enforces adjustment identity, delta, source shape and bounded uniqueness", async () => {
    const interruptionRepo = createAttemptInterruptionRepo(db);
    const adjustmentRepo = createAttemptTimeAdjustmentRepo(db);
    const episode = await interruptionRepo.create(alpha.ctx, {
      attemptId: alpha.attemptId,
    });
    const operationId = randomUUID();
    const valid = {
      operationId,
      attemptId: alpha.attemptId,
      interruptionId: episode.id,
      incidentId: null,
      policy: "bounded_grace" as const,
      source: "bounded_grace" as const,
      beforeDeadline: new Date("2026-01-01T01:00:00.000Z"),
      afterDeadline: new Date("2026-01-01T01:00:10.000Z"),
      addedSeconds: 10,
      eligibleSeconds: 10,
      reasonCode: "bounded_grace",
      reasonText: null,
      actorId: null,
    };
    await adjustmentRepo.insert(alpha.ctx, valid);
    const secondEpisode = await interruptionRepo.create(alpha.ctx, {
      attemptId: alpha.attemptId,
    });
    await expect(
      adjustmentRepo.insert(alpha.ctx, {
        ...valid,
        interruptionId: secondEpisode.id,
      }),
    ).rejects.toMatchObject({
      cause: {
        constraint_name: "attempt_time_adjustments_org_operation_unique",
      },
    });
    const betaEpisode = await interruptionRepo.create(beta.ctx, {
      attemptId: beta.attemptId,
    });
    await expect(
      adjustmentRepo.insert(beta.ctx, {
        ...valid,
        attemptId: beta.attemptId,
        interruptionId: betaEpisode.id,
      }),
    ).resolves.not.toThrow();
    await expect(
      adjustmentRepo.insert(alpha.ctx, {
        ...valid,
        operationId: randomUUID(),
        interruptionId: betaEpisode.id,
      }),
    ).rejects.toMatchObject({
      cause: {
        constraint_name: "attempt_time_adjustments_org_interruption_fk",
      },
    });
    await expect(
      adjustmentRepo.insert(alpha.ctx, { ...valid, operationId: randomUUID() }),
    ).rejects.toMatchObject({
      cause: {
        constraint_name: "attempt_time_adjustments_bounded_interruption_unique",
      },
    });
    await expect(
      adjustmentRepo.insert(alpha.ctx, {
        ...valid,
        operationId: randomUUID(),
        interruptionId: null,
      }),
    ).rejects.toMatchObject({
      cause: { constraint_name: "attempt_time_adjustments_source_shape_check" },
    });
    await expect(
      adjustmentRepo.insert(alpha.ctx, {
        ...valid,
        operationId: randomUUID(),
        interruptionId: (
          await interruptionRepo.create(alpha.ctx, {
            attemptId: alpha.attemptId,
          })
        ).id,
        addedSeconds: 0,
        afterDeadline: valid.beforeDeadline,
      }),
    ).rejects.toMatchObject({
      cause: {
        constraint_name: "attempt_time_adjustments_added_seconds_check",
      },
    });
    await expect(
      adjustmentRepo.insert(alpha.ctx, {
        ...valid,
        operationId: randomUUID(),
        interruptionId: (
          await interruptionRepo.create(alpha.ctx, {
            attemptId: alpha.attemptId,
          })
        ).id,
        afterDeadline: new Date("2026-01-01T01:00:11.000Z"),
      }),
    ).rejects.toMatchObject({
      cause: {
        constraint_name: "attempt_time_adjustments_deadline_delta_check",
      },
    });
    await expect(
      adjustmentRepo.insert(alpha.ctx, {
        ...valid,
        operationId: randomUUID(),
        interruptionId: null,
        policy: "operator_incident",
        source: "operator",
        eligibleSeconds: null,
        actorId: null,
        reasonText: null,
      }),
    ).rejects.toMatchObject({
      cause: { constraint_name: "attempt_time_adjustments_source_shape_check" },
    });
  });
});
