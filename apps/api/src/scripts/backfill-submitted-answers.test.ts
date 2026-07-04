import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, migratePostgres } from "@exam/db";
import { resolveTestDbUrl } from "@exam/db/src/testDb.js";
import type { Database } from "@exam/db/src/types.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { setupIsolatedTestDb } from "@exam/db/src/testIsolation.js";
import { eq } from "drizzle-orm";
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
  status: string;
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
  });

  afterAll(async () => {
    await conn.sql.end();
    await cleanup();
  });

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
});
