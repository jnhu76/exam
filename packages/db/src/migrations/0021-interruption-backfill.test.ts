import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { asc, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
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

/**
 * Apply migrations up to 0020 by creating a temporary journal that excludes
 * the 0021 entry, then using Drizzle's migrate function. This correctly
 * handles the full migration lifecycle including drizzle schema tracking.
 */
async function applyMigrationsThrough0020(
  db: Awaited<ReturnType<typeof createDatabase>>["db"],
  schemaName: string,
): Promise<void> {
  const journalPath = resolve(migrationsDir, "meta/_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
    version: string;
    dialect: string;
    entries: Array<{
      idx: number;
      version: string;
      when: number;
      tag: string;
      breakpoints: boolean;
    }>;
  };
  const tmpDir = mkdtempSync("mig-0021-");
  const tmpMigrationsDir = resolve(tmpDir, "migrations");
  const tmpMetaDir = resolve(tmpMigrationsDir, "meta");

  try {
    mkdirSync(tmpMetaDir, { recursive: true });
    // Copy all migration SQL files up to 0020 to temp dir
    const files = readdirSync(migrationsDir).filter(
      (f) => f.endsWith(".sql") && f < "0021_",
    );
    for (const f of files) {
      writeFileSync(
        resolve(tmpMigrationsDir, f),
        readFileSync(resolve(migrationsDir, f)),
      );
    }
    // Write journal with only 0000-0020 entries
    journal.entries = journal.entries.filter((e) => e.idx <= 20);
    writeFileSync(
      resolve(tmpMetaDir, "_journal.json"),
      JSON.stringify(journal, null, 2),
    );
    // Copy snapshot files for 0000-0020
    for (let i = 0; i <= 20; i++) {
      const candidates = readdirSync(resolve(migrationsDir, "meta")).filter(
        (f) => f.startsWith(`${String(i).padStart(4, "0")}_`),
      );
      for (const c of candidates) {
        writeFileSync(
          resolve(tmpMetaDir, c),
          readFileSync(resolve(migrationsDir, "meta", c)),
        );
      }
    }

    await migrate(db, {
      migrationsFolder: tmpMigrationsDir,
      migrationsSchema: schemaName,
    });
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** Raw SQL helper: insert pre-0021 exam rows without the 0021 columns. */
async function insertPre0021Exam(
  conn: Awaited<ReturnType<typeof createDatabase>>,
  values: {
    id: string;
    organizationId: string;
    title: string;
    description: string;
    courseId: string;
    status: string;
    timingMode: string;
    durationMinutes: number;
    openAt: Date;
    closeAt: Date;
    passingScore: number;
    totalScore: number;
    questionSelectionMode: string;
    questionIds: string[];
    questionSnapshot: string;
    controlFlags: Record<string, unknown>;
    retakePolicy: string;
    scoreStrategy: string;
    maxAttempts: number;
    latestStartOffsetMinutes: number | null;
    minSubmitAfterStartMinutes: number | null;
    resultPublicationMode: string;
    resultsPublishedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  },
): Promise<void> {
  await conn.sql.unsafe(
    `INSERT INTO exams (
      id, organization_id, title, description, course_id,
      status, timing_mode, duration_minutes, open_at, close_at,
      passing_score, total_score, question_selection_mode,
      question_ids, question_snapshot, control_flags,
      retake_policy, score_strategy, max_attempts,
      latest_start_offset_minutes, min_submit_after_start_minutes,
      result_publication_mode, results_published_at,
      created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5,
      $6, $7, $8, $9, $10,
      $11, $12, $13,
      $14, $15, $16,
      $17, $18, $19,
      $20, $21,
      $22, $23,
      $24, $25
    )`,
    [
      values.id,
      values.organizationId,
      values.title,
      values.description,
      values.courseId,
      values.status,
      values.timingMode,
      values.durationMinutes,
      values.openAt,
      values.closeAt,
      values.passingScore,
      values.totalScore,
      values.questionSelectionMode,
      JSON.stringify(values.questionIds),
      values.questionSnapshot,
      JSON.stringify(values.controlFlags),
      values.retakePolicy,
      values.scoreStrategy,
      values.maxAttempts,
      values.latestStartOffsetMinutes,
      values.minSubmitAfterStartMinutes,
      values.resultPublicationMode,
      values.resultsPublishedAt,
      values.createdAt,
      values.updatedAt,
    ],
  );
}

/** Raw SQL helper: insert pre-0021 exam_attempt rows without the 0021 columns. */
async function insertPre0021Attempt(
  conn: Awaited<ReturnType<typeof createDatabase>>,
  values: {
    id: string;
    organizationId: string;
    examId: string;
    enrollmentId: string;
    candidateId: string;
    attemptNo: number;
    status: string;
    questionSnapshot: string;
    answers: string;
    gradingResult: string | null;
    score: number | null;
    passed: boolean | null;
    startedAt: Date | null;
    deadlineAt: Date | null;
    submittedAt: Date | null;
    gradedAt: Date | null;
    lastActivityAt: Date | null;
    misconduct: string | null;
    gradingStatus: string | null;
    submittedAnswers: string | null;
    submissionReason: string | null;
    createdAt: Date;
    updatedAt: Date;
  },
): Promise<void> {
  await conn.sql.unsafe(
    `INSERT INTO exam_attempts (
      id, organization_id, exam_id, enrollment_id, candidate_id,
      attempt_no, status, question_snapshot, answers,
      grading_result, total_score, passed,
      started_at, deadline_at, submitted_at, graded_at, last_activity_at,
      misconduct, grading_status, submitted_answers, submission_reason,
      created_at, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5,
      $6, $7, $8, $9,
      $10, $11, $12,
      $13, $14, $15, $16, $17,
      $18, $19, $20, $21,
      $22, $23
    )`,
    [
      values.id,
      values.organizationId,
      values.examId,
      values.enrollmentId,
      values.candidateId,
      values.attemptNo,
      values.status,
      values.questionSnapshot,
      values.answers,
      values.gradingResult,
      values.score,
      values.passed,
      values.startedAt,
      values.deadlineAt,
      values.submittedAt,
      values.gradedAt,
      values.lastActivityAt,
      values.misconduct,
      values.gradingStatus,
      values.submittedAnswers,
      values.submissionReason,
      values.createdAt,
      values.updatedAt,
    ],
  );
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
    await applyMigrationsThrough0020(conn.db, iso.schemaName);

    const createdAt = new Date("2025-12-31T00:00:00.000Z");
    const lastActivityAt = new Date("2025-12-31T23:00:00.000Z");

    // Pre-0021 fixtures: use raw SQL to avoid referencing columns that
    // migration 0021 adds. Tables not touched by 0021 may use Drizzle.
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

    // exams and exam_attempts are modified by 0021 — use pre-0021 raw SQL
    await insertPre0021Exam(conn, {
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
      questionSnapshot: "[]",
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
      latestStartOffsetMinutes: null,
      minSubmitAfterStartMinutes: null,
      resultPublicationMode: "immediate",
      resultsPublishedAt: null,
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

    await insertPre0021Attempt(conn, {
      id: attemptIds.inProgress,
      organizationId,
      examId,
      enrollmentId,
      candidateId,
      attemptNo: 1,
      status: "in_progress",
      questionSnapshot: "[]",
      answers: "[]",
      gradingResult: null,
      score: null,
      passed: null,
      startedAt: null,
      deadlineAt: deadlines.inProgress,
      submittedAt: null,
      gradedAt: null,
      lastActivityAt,
      misconduct: null,
      gradingStatus: null,
      submittedAnswers: null,
      submissionReason: null,
      createdAt,
      updatedAt: createdAt,
    });
    await insertPre0021Attempt(conn, {
      id: attemptIds.disruptedA,
      organizationId,
      examId,
      enrollmentId,
      candidateId,
      attemptNo: 2,
      status: "disrupted",
      questionSnapshot: "[]",
      answers: "[]",
      gradingResult: null,
      score: null,
      passed: null,
      startedAt: null,
      deadlineAt: deadlines.disruptedA,
      submittedAt: null,
      gradedAt: null,
      lastActivityAt,
      misconduct: null,
      gradingStatus: null,
      submittedAnswers: null,
      submissionReason: null,
      createdAt,
      updatedAt: createdAt,
    });
    await insertPre0021Attempt(conn, {
      id: attemptIds.disruptedB,
      organizationId,
      examId,
      enrollmentId,
      candidateId,
      attemptNo: 3,
      status: "disrupted",
      questionSnapshot: "[]",
      answers: "[]",
      gradingResult: null,
      score: null,
      passed: null,
      startedAt: null,
      deadlineAt: deadlines.disruptedB,
      submittedAt: null,
      gradedAt: null,
      lastActivityAt,
      misconduct: null,
      gradingStatus: null,
      submittedAnswers: null,
      submissionReason: null,
      createdAt,
      updatedAt: createdAt,
    });
    await insertPre0021Attempt(conn, {
      id: attemptIds.submitted,
      organizationId,
      examId,
      enrollmentId,
      candidateId,
      attemptNo: 4,
      status: "submitted",
      questionSnapshot: "[]",
      answers: "[]",
      gradingResult: null,
      score: null,
      passed: null,
      startedAt: null,
      deadlineAt: deadlines.submitted,
      submittedAt: new Date("2026-01-01T00:30:00.000Z"),
      gradedAt: null,
      lastActivityAt,
      misconduct: null,
      gradingStatus: null,
      submittedAnswers: null,
      submissionReason: "manual",
      createdAt,
      updatedAt: createdAt,
    });

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
