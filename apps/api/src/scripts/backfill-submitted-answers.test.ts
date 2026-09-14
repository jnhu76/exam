import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migratePostgres } from "@exam/db";
import { resolveTestDbUrl } from "@exam/db/src/testDb.js";
import type { Database } from "@exam/db/src/types.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { setupIsolatedTestDb } from "@exam/db/src/testIsolation.js";
import { eq, sql } from "drizzle-orm";
import type { AttemptStatus } from "@exam/domain";
import {
  runBackfill,
  buildSnapshotForAttempt,
} from "./backfill-submitted-answers.js";

const now = new Date();

const QUESTION_SNAPSHOT = [
  {
    originalQuestionId: "q1",
    type: "single_choice" as const,
    content: "Q1",
    contentDocument: null,
    answerMode: null,
    attachments: [],
    options: [],
    standardAnswer: "b",
    score: 100,
    gradingRule: {
      multiSelectScoring: "all_correct_full" as const,
      fillBlankMatchMode: "exact" as const,
    },
    order: 0,
    rubric: null,
  },
];

interface SeedInput {
  id: string;
  status: AttemptStatus;
  answers: unknown[];
  submittedAnswers?: unknown;
  submittedAt?: Date | null;
}

async function seedAttempt(db: Database, orgId: string, input: SeedInput) {
  const enrollmentId = crypto.randomUUID();
  const candidateId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const examId = crypto.randomUUID();
  const courseId = crypto.randomUUID();

  // Minimal course + exam + user + candidate + enrollment to satisfy FKs.
  await db.insert(schema.courses).values({
    id: courseId,
    organizationId: orgId,
    name: "Test Course",
    code: `TC-${courseId.slice(0, 8)}`,
    description: "",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.exams).values({
    id: examId,
    organizationId: orgId,
    title: `T-${input.id}`,
    description: "",
    courseId,
    status: "open",
    timingMode: "timed_window",
    durationMinutes: 60,
    openAt: now,
    closeAt: new Date(now.getTime() + 86400000),
    passingScore: 0,
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
      batchSize: 1,
      batchInterval: 1,
      restrictIp: false,
      requireLockdown: false,
      showResultImmediately: true,
    },
    retakePolicy: "unlimited",
    scoreStrategy: "highest",
    maxAttempts: 1,
    latestStartOffsetMinutes: null,
    minSubmitAfterStartMinutes: null,
    resultPublicationMode: "immediate",
    resultsPublishedAt: null,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.users).values({
    id: userId,
    organizationId: orgId,
    username: `u-${userId.slice(0, 8)}`,
    passwordHash: "x",
    name: "Test",
    role: "Candidate",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.candidateProfiles).values({
    id: candidateId,
    organizationId: orgId,
    userId,
    fields: {},
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.examEnrollments).values({
    id: enrollmentId,
    organizationId: orgId,
    examId,
    candidateId,
    status: "started",
    attemptCount: 1,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.examAttempts).values({
    id: input.id,
    organizationId: orgId,
    examId,
    enrollmentId,
    candidateId,
    attemptNo: 1,
    status: input.status,
    questionSnapshot: QUESTION_SNAPSHOT,
    answers: input.answers as never,
    submittedAnswers: (input.submittedAnswers ?? null) as never,
    submittedAt: input.submittedAt ?? now,
    createdAt: now,
    updatedAt: now,
  });
}

async function freshOrg(db: Database): Promise<string> {
  const rows = await db
    .insert(schema.organizations)
    .values({
      id: crypto.randomUUID(),
      name: "Backfill Org",
      displayName: "Backfill Org",
      slug: `bf-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: schema.organizations.id });
  return rows[0]!.id;
}

describe("backfill-submitted-answers (P3-L0-4)", () => {
  let db: Database;
  let conn: Awaited<ReturnType<typeof createDatabase>>;
  let cleanup: () => Promise<void>;
  let orgId: string;

  beforeAll(async () => {
    const iso = await setupIsolatedTestDb({
      namespace: "script-backfill",
      databaseUrl: resolveTestDbUrl(),
    });
    cleanup = iso.cleanup;
    conn = await createDatabase(resolveTestDbUrl(), iso.schemaName);
    db = conn.db;
    await migratePostgres(db, { migrationsSchema: iso.schemaName });
    orgId = await freshOrg(db);
  }, 30_000);

  afterAll(async () => {
    await conn.sql.end();
    await cleanup();
  }, 30_000);

  it("buildSnapshotForAttempt normalizes draft answers into the frozen shape", () => {
    const attempt = {
      id: "a",
      organizationId: orgId,
      examId: "e",
      enrollmentId: "enr",
      candidateId: "c",
      attemptNo: 1,
      status: "submitted" as const,
      questionSnapshot: QUESTION_SNAPSHOT,
      answers: [{ questionId: "q1", answer: "b", version: 2, savedAt: now }],
      createdAt: now,
      updatedAt: now,
    };
    const snap = buildSnapshotForAttempt(attempt);
    expect(snap).toEqual({
      schemaVersion: 1,
      answers: [{ questionId: "q1", value: "b" }],
    });
  });

  it("backfills a graded attempt with NULL submitted_answers", async () => {
    const id = crypto.randomUUID();
    await seedAttempt(db, orgId, {
      id,
      status: "graded",
      answers: [{ questionId: "q1", answer: "b", version: 1, savedAt: now }],
      submittedAnswers: null,
    });

    const stats = await runBackfill(db);
    expect(stats.backfilled).toBeGreaterThanOrEqual(1);

    const rows = await db
      .select()
      .from(schema.examAttempts)
      .where(eq(schema.examAttempts.id, id));
    expect(rows[0]?.submittedAnswers).toEqual({
      schemaVersion: 1,
      answers: [{ questionId: "q1", value: "b" }],
    });
  });

  it("includes voided-with-submittedAt in scope", async () => {
    const id = crypto.randomUUID();
    await seedAttempt(db, orgId, {
      id,
      status: "voided",
      submittedAt: now,
      answers: [{ questionId: "q1", answer: "b", version: 1, savedAt: now }],
    });

    const stats = await runBackfill(db, { dryRun: true });
    expect(stats.total).toBeGreaterThanOrEqual(1);
    expect(stats.backfilled).toBeGreaterThanOrEqual(1);
  });

  it("excludes voided-without-submittedAt (no submit semantics)", async () => {
    const id = crypto.randomUUID();
    await seedAttempt(db, orgId, {
      id,
      status: "voided",
      submittedAt: null,
      answers: [],
    });

    const stats = await runBackfill(db, { dryRun: true });
    // This candidate should NOT appear in the total (filtered out by the
    // voided-with-submittedAt clause).
    const row = await db
      .select()
      .from(schema.examAttempts)
      .where(eq(schema.examAttempts.id, id));
    expect(row[0]?.submittedAnswers).toBeNull();
    expect(stats.skippedNoSubmitSemantics).toBe(0);
  });

  it("is idempotent — a second run does not re-process backfilled rows", async () => {
    const first = await runBackfill(db);
    const second = await runBackfill(db);
    // All in-scope rows now have non-null submitted_answers → candidates = 0.
    expect(second.total).toBe(0);
    expect(second.backfilled).toBe(0);
    expect(first.total).toBeGreaterThanOrEqual(second.total);
  });

  it("dry-run computes the plan without writing", async () => {
    const id = crypto.randomUUID();
    await seedAttempt(db, orgId, {
      id,
      status: "submitted",
      answers: [{ questionId: "q1", answer: "b", version: 1, savedAt: now }],
    });

    const stats = await runBackfill(db, { dryRun: true });
    expect(stats.backfilled).toBeGreaterThanOrEqual(1);

    const row = await db
      .select()
      .from(schema.examAttempts)
      .where(eq(schema.examAttempts.id, id));
    expect(row[0]?.submittedAnswers).toBeNull();
  });

  it("T4: fails closed when unresolved legacy grading rows exist — nothing is processed, nothing is silently skipped", async () => {
    // Simulate a pre-0043 deployment holding historical crash residue: drop
    // the status CHECK (0043 refuses to install over such rows anyway), then
    // flip a seeded submitted row to the raw historical vocabulary value.
    // Raw SQL on purpose — 'grading' is NOT current AttemptStatus vocabulary.
    const stuckId = crypto.randomUUID();
    const inScopeId = crypto.randomUUID();
    await seedAttempt(db, orgId, {
      id: stuckId,
      status: "submitted",
      answers: [{ questionId: "q1", answer: "b", version: 1, savedAt: now }],
    });
    await seedAttempt(db, orgId, {
      id: inScopeId,
      status: "submitted",
      answers: [{ questionId: "q1", answer: "b", version: 1, savedAt: now }],
    });
    await db.execute(
      sql.raw(
        `ALTER TABLE exam_attempts DROP CONSTRAINT exam_attempts_status_check`,
      ),
    );
    await db.execute(
      sql.raw(
        `UPDATE exam_attempts SET status = 'grading' WHERE id = '${stuckId}'`,
      ),
    );

    // Refuses in both real and dry-run mode, before any candidate work.
    await expect(runBackfill(db)).rejects.toThrow(
      /legacy status='grading'.*0043_persisted_state_status_checks/s,
    );
    await expect(runBackfill(db, { dryRun: true })).rejects.toThrow(
      /legacy status='grading'/,
    );

    // Fail-closed means fail-BEFORE-processing: the in-scope row was not
    // written, and the stuck row still holds its historical status.
    for (const id of [stuckId, inScopeId]) {
      const row = await db
        .select()
        .from(schema.examAttempts)
        .where(eq(schema.examAttempts.id, id));
      expect(row[0]?.submittedAnswers).toBeNull();
    }
    const stuck = await db
      .select()
      .from(schema.examAttempts)
      .where(eq(schema.examAttempts.id, stuckId));
    expect(stuck[0]?.status as string).toBe("grading");

    // Restore the pre-test shape: disposition the stuck row with the same
    // supported rewind recipe (ADD CONSTRAINT validates existing rows, so
    // the residue must be dispositioned before the CHECK comes back).
    await db.execute(
      sql.raw(
        `UPDATE exam_attempts SET status = 'submitted' WHERE id = '${stuckId}' AND status = 'grading'`,
      ),
    );
    await db.execute(
      sql.raw(`
        ALTER TABLE exam_attempts ADD CONSTRAINT exam_attempts_status_check
        CHECK ("status" IN ('not_started', 'queued', 'in_progress', 'disrupted', 'submitted', 'graded', 'voided'))
      `),
    );
  });

  it("T5: after the documented disposition (rewind to submitted), the formerly stuck row enters scope and is backfilled", async () => {
    // Simulates the runbook Option A precondition — the human repair has
    // already rewound the residue row to 'submitted' (the state the
    // historical writer's guard proves it held). The test proves the
    // backfill then picks the row up; it does NOT claim the repair itself
    // was performed by runtime code.
    const id = crypto.randomUUID();
    await seedAttempt(db, orgId, {
      id,
      status: "submitted",
      answers: [{ questionId: "q1", answer: "b", version: 1, savedAt: now }],
    });

    const stats = await runBackfill(db);
    expect(stats.backfilled).toBeGreaterThanOrEqual(1);

    const row = await db
      .select()
      .from(schema.examAttempts)
      .where(eq(schema.examAttempts.id, id));
    expect(row[0]?.submittedAnswers).toEqual({
      schemaVersion: 1,
      answers: [{ questionId: "q1", value: "b" }],
    });
  });
});
