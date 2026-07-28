import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "../database.js";
import { schema } from "../schema/pg.js";
import { setupIsolatedTestDb, type IsolatedTestDb } from "../testIsolation.js";

const migrationsDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../migrations/postgres",
);

function migrationStatements(fileName: string): string[] {
  return readFileSync(resolve(migrationsDir, fileName), "utf8")
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}

async function applyMigrationsThrough0020(
  sql: Awaited<ReturnType<typeof createDatabase>>["sql"],
): Promise<void> {
  const files = readdirSync(migrationsDir)
    .filter((file) => /^\d{4}_.+\.sql$/.test(file) && file < "0021_")
    .sort();
  for (const file of files) {
    for (const statement of migrationStatements(file)) {
      await sql.unsafe(statement);
    }
  }
}

describe("0021 interruption policy migration backfill", () => {
  let iso: IsolatedTestDb;
  let conn: Awaited<ReturnType<typeof createDatabase>>;
  const organizationId = randomUUID();
  const courseId = randomUUID();
  const examId = randomUUID();
  const userId = randomUUID();
  const candidateId = randomUUID();
  const enrollmentId = randomUUID();
  const attemptIds = {
    inProgress: randomUUID(),
    disruptedA: randomUUID(),
    disruptedB: randomUUID(),
    submitted: randomUUID(),
  };
  const deadlines = {
    inProgress: new Date("2026-01-01T01:00:00.000Z"),
    disruptedA: new Date("2026-01-01T02:00:00.000Z"),
    disruptedB: new Date("2026-01-01T03:00:00.000Z"),
    submitted: new Date("2026-01-01T04:00:00.000Z"),
  };

  beforeAll(async () => {
    iso = await setupIsolatedTestDb({ namespace: "mig0021" });
    conn = await createDatabase(iso.databaseUrl, iso.schemaName);
    await applyMigrationsThrough0020(conn.sql);

    const createdAt = new Date("2025-12-31T00:00:00.000Z");
    const lastActivityAt = new Date("2025-12-31T23:00:00.000Z");
    await conn.db.insert(schema.organizations).values({
      id: organizationId,
      name: "Migration Org",
      displayName: "Migration Org",
      slug: `migration-${organizationId}`,
      createdAt,
      updatedAt: createdAt,
    });
    await conn.db.insert(schema.courses).values({
      id: courseId,
      organizationId,
      name: "Migration Course",
      code: "MIG",
      description: "",
      createdAt,
      updatedAt: createdAt,
    });
    await conn.db.insert(schema.users).values({
      id: userId,
      organizationId,
      username: `candidate-${userId}`,
      passwordHash: "hash",
      name: "Candidate",
      role: "Candidate",
      isActive: true,
      createdAt,
      updatedAt: createdAt,
    });
    await conn.db.insert(schema.candidateProfiles).values({
      id: candidateId,
      organizationId,
      userId,
      fields: {},
      createdAt,
      updatedAt: createdAt,
    });
    await conn.db.insert(schema.exams).values({
      id: examId,
      organizationId,
      title: "Historical Exam",
      description: "",
      courseId,
      status: "open",
      timingMode: "timed_window",
      durationMinutes: 60,
      openAt: new Date("2025-12-31T00:00:00.000Z"),
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
      maxAttempts: 4,
      createdAt,
      updatedAt: createdAt,
    });
    await conn.db.insert(schema.examEnrollments).values({
      id: enrollmentId,
      organizationId,
      examId,
      candidateId,
      status: "started",
      attemptCount: 4,
      createdAt,
      updatedAt: createdAt,
    });
    await conn.db.insert(schema.examAttempts).values([
      {
        id: attemptIds.inProgress,
        organizationId,
        examId,
        enrollmentId,
        candidateId,
        attemptNo: 1,
        status: "in_progress",
        questionSnapshot: [],
        answers: [],
        deadlineAt: deadlines.inProgress,
        lastActivityAt,
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: attemptIds.disruptedA,
        organizationId,
        examId,
        enrollmentId,
        candidateId,
        attemptNo: 2,
        status: "disrupted",
        questionSnapshot: [],
        answers: [],
        deadlineAt: deadlines.disruptedA,
        lastActivityAt,
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: attemptIds.disruptedB,
        organizationId,
        examId,
        enrollmentId,
        candidateId,
        attemptNo: 3,
        status: "disrupted",
        questionSnapshot: [],
        answers: [],
        deadlineAt: deadlines.disruptedB,
        lastActivityAt,
        createdAt,
        updatedAt: createdAt,
      },
      {
        id: attemptIds.submitted,
        organizationId,
        examId,
        enrollmentId,
        candidateId,
        attemptNo: 4,
        status: "submitted",
        questionSnapshot: [],
        answers: [],
        deadlineAt: deadlines.submitted,
        submittedAt: new Date("2026-01-01T00:30:00.000Z"),
        submissionReason: "manual",
        createdAt,
        updatedAt: createdAt,
      },
    ]);

    const file = readdirSync(migrationsDir).find((name) =>
      name.startsWith("0021_"),
    );
    if (!file) throw new Error("0021 migration file not found");
    await conn.sql.begin(async (transaction) => {
      for (const statement of migrationStatements(file)) {
        await transaction.unsafe(statement);
      }
    });
  });

  afterAll(async () => {
    try {
      await conn?.sql.end();
    } finally {
      await iso?.cleanup();
    }
  });

  it("backfills strict Exam and immutable Attempt snapshots", async () => {
    const exams = await conn.db
      .select()
      .from(schema.exams)
      .where(eq(schema.exams.id, examId));
    const attempts = await conn.db
      .select()
      .from(schema.examAttempts)
      .where(eq(schema.examAttempts.organizationId, organizationId))
      .orderBy(asc(schema.examAttempts.attemptNo));

    expect(exams[0]).toMatchObject({
      interruptionTimePolicy: "strict",
      interruptionGracePerIncidentSeconds: null,
      interruptionGracePerAttemptSeconds: null,
    });
    expect(
      attempts.map((attempt) => ({
        version: attempt.interruptionPolicySnapshotVersion,
        policy: attempt.interruptionTimePolicySnapshot,
        incident: attempt.interruptionGracePerIncidentSecondsSnapshot,
        aggregate: attempt.interruptionGracePerAttemptSecondsSnapshot,
      })),
    ).toEqual(
      Array.from({ length: 4 }, () => ({
        version: 1,
        policy: "strict",
        incident: null,
        aggregate: null,
      })),
    );
  });

  it("creates one migration-labelled episode per historical disrupted attempt", async () => {
    const attempts = await conn.db
      .select()
      .from(schema.examAttempts)
      .where(eq(schema.examAttempts.organizationId, organizationId))
      .orderBy(asc(schema.examAttempts.attemptNo));
    const episodes = await conn.db
      .select()
      .from(schema.attemptInterruptions)
      .where(eq(schema.attemptInterruptions.organizationId, organizationId));
    const events = await conn.db
      .select()
      .from(schema.attemptInterruptionEvents)
      .where(
        eq(schema.attemptInterruptionEvents.organizationId, organizationId),
      );

    expect(episodes).toHaveLength(2);
    expect(events).toHaveLength(2);
    expect(attempts[0]!.currentInterruptionId).toBeNull();
    expect(attempts[3]!.currentInterruptionId).toBeNull();
    for (const attempt of [attempts[1]!, attempts[2]!]) {
      const event = events.find(
        (candidate) => candidate.attemptId === attempt.id,
      );
      expect(attempt.currentInterruptionId).not.toBeNull();
      expect(event).toMatchObject({
        interruptionId: attempt.currentInterruptionId,
        eventType: "detected",
        detectionSource: "migration_backfill",
        timeoutSeconds: null,
        policy: "strict",
        reasonCode: "migration_backfill_unknown_detected_at",
      });
      expect(event!.occurredAt).toEqual(attempt.interruptedAt);
      expect(event!.occurredAt).not.toEqual(attempt.lastActivityAt);
    }
    expect(events[0]!.occurredAt).toEqual(events[1]!.occurredAt);
  });

  it("preserves deadlines and lifecycle/submission fields without fabricating adjustments", async () => {
    const attempts = await conn.db
      .select()
      .from(schema.examAttempts)
      .where(eq(schema.examAttempts.organizationId, organizationId))
      .orderBy(asc(schema.examAttempts.attemptNo));
    const adjustments = await conn.db
      .select()
      .from(schema.attemptTimeAdjustments)
      .where(eq(schema.attemptTimeAdjustments.organizationId, organizationId));

    expect(attempts.map((attempt) => attempt.deadlineAt)).toEqual([
      deadlines.inProgress,
      deadlines.disruptedA,
      deadlines.disruptedB,
      deadlines.submitted,
    ]);
    expect(attempts.map((attempt) => attempt.status)).toEqual([
      "in_progress",
      "disrupted",
      "disrupted",
      "submitted",
    ]);
    expect(attempts[3]).toMatchObject({
      submittedAt: new Date("2026-01-01T00:30:00.000Z"),
      submissionReason: "manual",
    });
    expect(adjustments).toEqual([]);
  });
});
