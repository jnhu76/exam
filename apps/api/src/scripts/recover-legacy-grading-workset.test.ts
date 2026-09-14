import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createDatabase,
  executeInTransaction,
  migratePostgres,
} from "@exam/db";
import { resolveTestDbUrl } from "@exam/db/src/testDb.js";
import type { Database } from "@exam/db/src/types.js";
import { schema } from "@exam/db/src/schema/pg.js";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { createEnrollmentRepo } from "@exam/db/src/repository/enrollmentRepo.js";
import { createExamRepo } from "@exam/db/src/repository/examRepo.js";
import { createAttemptGradingEntryRepo } from "@exam/db/src/repository/attemptGradingEntryRepo.js";
import { setupIsolatedTestDb } from "@exam/db/src/testIsolation.js";
import { eq, sql } from "drizzle-orm";
import type {
  AttemptStatus,
  Exam,
  QuestionSnapshot,
  RequestContext,
} from "@exam/domain";
import { gradeQuestion, lockEnrollmentAndAttempt } from "@exam/exam-engine";
import {
  createExamEngineRepos,
  createGradingWorksetRepoAdapter,
} from "../adapters/repoAdapters.js";
import { submitAndGradeAttempt } from "../orchestrators/submitAndGradeAttempt.js";
import { runBackfill } from "./backfill-submitted-answers.js";
import { recoverLegacyGradingWorkset } from "./recover-legacy-grading-workset.js";

const now = new Date();

const SYSTEM_CTX: RequestContext = {
  actorId: crypto.randomUUID(),
  organizationId: "", // filled per-org in the tests
  role: "Admin",
  permissions: [],
  sessionId: crypto.randomUUID(),
};

/** Objective-only frozen snapshot (same shape the live submit path freezes). */
function objectiveSnapshot(
  questionId: string,
  standardAnswer: string,
): QuestionSnapshot[] {
  return [
    {
      originalQuestionId: questionId,
      type: "single_choice" as const,
      content: "Q",
      contentDocument: null,
      answerMode: null,
      attachments: [],
      options: [],
      standardAnswer,
      score: 100,
      gradingRule: {
        multiSelectScoring: "all_correct_full" as const,
        fillBlankMatchMode: "exact" as const,
      },
      order: 0,
      rubric: null,
    },
  ];
}

/** Manual (text_response) frozen snapshot — the T4 manual-grading case. */
function manualSnapshot(questionId: string): QuestionSnapshot[] {
  return [
    {
      originalQuestionId: questionId,
      type: "text_response" as const,
      content: "Essay",
      contentDocument: null,
      answerMode: null,
      attachments: [],
      options: [],
      standardAnswer: "参考答案",
      score: 100,
      gradingRule: {
        multiSelectScoring: "all_correct_full" as const,
        fillBlankMatchMode: "exact" as const,
      },
      order: 0,
      rubric: null,
    },
  ];
}

function draftAnswer(questionId: string, value: unknown) {
  return [{ questionId, answer: value, version: 1, savedAt: now }];
}

interface ResidueSeedInput {
  id: string;
  questionSnapshot: QuestionSnapshot[];
  answers: unknown[];
}

/**
 * Seeds the EXACT historical grading crash residue (#542 proven shape): a
 * legacy attempt the pre-J2 writer left at status='grading' with every
 * terminal fact NULL, no frozen submitted_answers, and (the window predating
 * the grading workset) zero attempt_grading_entries. grading_status holds the
 * migration default 'auto_graded' (column added at 0004 with that default).
 *
 * Raw SQL on purpose: 'grading' is NOT current AttemptStatus vocabulary, so
 * the row is flipped outside the 0043 CHECK (the residue-era DB has no CHECK
 * — 0043 refuses to install over such rows).
 */
async function seedLegacyResidue(
  db: Database,
  orgId: string,
  input: ResidueSeedInput,
): Promise<{ examId: string; enrollmentId: string; candidateId: string }> {
  const enrollmentId = crypto.randomUUID();
  const candidateId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const examId = crypto.randomUUID();
  const courseId = crypto.randomUUID();

  await db.insert(schema.courses).values({
    id: courseId,
    organizationId: orgId,
    name: "Recovery Course",
    code: `RC-${courseId.slice(0, 8)}`,
    description: "",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.exams).values({
    id: examId,
    organizationId: orgId,
    title: `Recovery-${input.id.slice(0, 8)}`,
    description: "",
    courseId,
    status: "closed",
    timingMode: "timed_window",
    durationMinutes: 60,
    openAt: now,
    closeAt: new Date(now.getTime() + 86400000),
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
    name: "Candidate",
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
    status: "submitted",
    questionSnapshot: input.questionSnapshot,
    answers: input.answers as never,
    submittedAnswers: null,
    submittedAt: now,
    createdAt: now,
    updatedAt: now,
  });

  // The residue-era vocabulary: flip outside the 0043 CHECK (which the
  // historical DB cannot carry — the preflight refuses to install over
  // residue rows).
  await dropStatusCheck(db);
  await db.execute(
    sql.raw(
      `UPDATE exam_attempts SET status = 'grading' WHERE id = '${input.id}'`,
    ),
  );

  return { examId, enrollmentId, candidateId };
}

async function dropStatusCheck(db: Database) {
  await db.execute(
    sql.raw(
      `ALTER TABLE exam_attempts DROP CONSTRAINT IF EXISTS exam_attempts_status_check`,
    ),
  );
}

/**
 * Reinstalls the 0043 attempts CHECK. ADD CONSTRAINT validates existing rows,
 * so this doubles as the "re-run 0043" step: it passes only when every row is
 * back inside the current vocabulary.
 */
async function reinstallStatusCheck(db: Database) {
  await db.execute(
    sql.raw(`
      ALTER TABLE exam_attempts ADD CONSTRAINT exam_attempts_status_check
      CHECK ("status" IN ('not_started', 'queued', 'in_progress', 'disrupted', 'submitted', 'graded', 'voided'))
    `),
  );
}

/**
 * Restores the post-migration shape for the shared test schema: dispositions
 * any leftover legacy 'grading' rows (runbook Option A) and reinstalls the
 * 0043 CHECK. Idempotent. The backfill preflight and the CHECK are both
 * schema-global, so every test ends by restoring this shape for the next one.
 */
async function restorePostMigrationShape(db: Database) {
  await db.execute(
    sql.raw(
      `UPDATE exam_attempts SET status = 'submitted' WHERE status = 'grading'`,
    ),
  );
  await dropStatusCheck(db);
  await reinstallStatusCheck(db);
}

/**
 * Runbook 0043 Option A, verbatim: the offline rewind recipe (manual,
 * migration-time-only legacy data repair — NOT a runtime transition).
 */
async function rewindGradingToSubmitted(db: Database, attemptId: string) {
  await db.execute(
    sql.raw(
      `UPDATE exam_attempts SET status = 'submitted' WHERE id = '${attemptId}' AND status = 'grading'`,
    ),
  );
}

async function getAttemptRow(db: Database, id: string) {
  return (
    await db
      .select()
      .from(schema.examAttempts)
      .where(eq(schema.examAttempts.id, id))
  )[0]!;
}

async function getEntryRows(db: Database, attemptId: string) {
  return db
    .select()
    .from(schema.attemptGradingEntries)
    .where(eq(schema.attemptGradingEntries.attemptId, attemptId));
}

/**
 * Drives the REAL candidate grading path (submitAndGradeAttempt — the exact
 * orchestrator behind POST /attempts/:attemptId/submit) for an already
 * submitted attempt.
 */
function gradeViaCandidateResubmit(
  db: Database,
  ctx: RequestContext,
  attemptId: string,
  candidateProfileId: string,
) {
  return submitAndGradeAttempt(
    db,
    ctx,
    attemptId,
    candidateProfileId,
    new Date(),
  );
}

/**
 * Drives the REAL manual grading path (the exact transaction seam behind
 * POST /admin/attempts/:attemptId/grade-question): canonical EA capability →
 * gradeQuestion → finalizeTerminalGrading, all in one locked transaction.
 */
async function gradeManualViaGradingSurface(
  db: Database,
  ctx: RequestContext,
  attemptId: string,
  questionId: string,
  score: number,
) {
  return executeInTransaction(db, async (tx) => {
    const txAttemptRepo = createAttemptRepo(tx);
    const txEnrollmentRepo = createEnrollmentRepo(tx);
    const txEntryRepo = createAttemptGradingEntryRepo(tx);
    const { enrollments, attempts } = createExamEngineRepos(
      {
        examRepo: createExamRepo(tx),
        attemptRepo: txAttemptRepo,
        enrollmentRepo: txEnrollmentRepo,
      },
      ctx,
    );
    const cap = await lockEnrollmentAndAttempt(
      enrollments,
      attempts,
      attemptId,
    );
    const attempt = await attempts.findById(attemptId);
    if (!attempt) throw new Error("attempt disappeared");
    const exam = (await createExamRepo(tx).findById(
      ctx,
      attempt.examId,
    )) as unknown as Exam;
    return gradeQuestion(
      attempts,
      enrollments,
      createGradingWorksetRepoAdapter(txEntryRepo, ctx),
      cap,
      questionId,
      score,
      "",
      ctx.actorId,
      new Date(),
      exam,
    );
  });
}

describe("recover-legacy-grading-workset (EXAM-542-CORRECTIVE-4)", () => {
  let db: Database;
  let conn: Awaited<ReturnType<typeof createDatabase>>;
  let cleanup: () => Promise<void>;
  let orgId: string;
  let ctx: RequestContext;

  beforeAll(async () => {
    const iso = await setupIsolatedTestDb({
      namespace: "script-recover-workset",
      databaseUrl: resolveTestDbUrl(),
    });
    cleanup = iso.cleanup;
    conn = await createDatabase(resolveTestDbUrl(), iso.schemaName);
    db = conn.db;
    await migratePostgres(db, { migrationsSchema: iso.schemaName });
    const rows = await db
      .insert(schema.organizations)
      .values({
        id: crypto.randomUUID(),
        name: "Recovery Org",
        displayName: "Recovery Org",
        slug: `rw-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: schema.organizations.id });
    orgId = rows[0]!.id;
    ctx = { ...SYSTEM_CTX, organizationId: orgId };
  }, 30_000);

  afterAll(async () => {
    await conn.sql.end();
    await cleanup();
  }, 30_000);

  it("T1: documented Option A alone does NOT reach the normal grading path — FAIL CLOSED on the missing workset", async () => {
    const id = crypto.randomUUID();
    await seedLegacyResidue(db, orgId, {
      id,
      questionSnapshot: objectiveSnapshot("q1", "b"),
      answers: draftAnswer("q1", "b"),
    });

    // 1. Offline rewind (runbook Option A).
    await rewindGradingToSubmitted(db, id);
    expect((await getAttemptRow(db, id)).status as AttemptStatus).toBe(
      "submitted",
    );

    // 2. submitted_answers backfill now accepts the row.
    const stats = await runBackfill(db);
    expect(stats.backfilled).toBeGreaterThanOrEqual(1);
    expect((await getAttemptRow(db, id)).submittedAnswers).toEqual({
      schemaVersion: 1,
      answers: [{ questionId: "q1", value: "b" }],
    });

    // 3. The current normal grading path (candidate re-submit crash-recovery
    //    branch → finalizeGrading → aggregateGradingEntries) MUST fail closed:
    //    the attempt has ZERO attempt_grading_entries and no current surface
    //    materializes a workset outside the fresh-submit freeze barrier.
    await expect(
      gradeViaCandidateResubmit(
        db,
        ctx,
        id,
        (await getAttemptRow(db, id)).candidateId,
      ),
    ).rejects.toThrow(
      /Grading aggregation inconsistency.*expected 1 entries.*found 0/s,
    );

    // Fail-closed proof: nothing was terminalized.
    const after = await getAttemptRow(db, id);
    expect(after.status).toBe("submitted");
    expect(after.score).toBeNull();
    expect(after.passed).toBeNull();
    expect(after.gradingResult).toBeNull();
    expect(after.gradedAt).toBeNull();

    await restorePostMigrationShape(db);
  });

  it("T2: zero workset is materialized exactly once with canonical fields", async () => {
    const id = crypto.randomUUID();
    await seedLegacyResidue(db, orgId, {
      id,
      questionSnapshot: objectiveSnapshot("q1", "b"),
      answers: draftAnswer("q1", "b"),
    });
    await rewindGradingToSubmitted(db, id);
    await runBackfill(db);

    const result = await recoverLegacyGradingWorkset(db, id);
    expect(result.action).toBe("materialized");
    expect(result.entryCount).toBe(1);
    // Migration-default label matches the canonical objective classification.
    expect(result.gradingStatusAlignment).toBeNull();

    const entries = await getEntryRows(db, id);
    expect(entries).toHaveLength(1);
    const e = entries[0]!;
    expect(e.questionId).toBe("q1");
    expect(e.gradingMode).toBe("auto");
    expect(e.status).toBe("completed_auto");
    expect(e.maxScore).toBe(100);
    expect(e.earnedScore).toBe(100);
    expect(e.candidateAnswer).toBe("b");
    expect(e.standardAnswer).toBe("b");
    expect(e.correct).toBe(true);
    expect(e.comment).toBe("");
    expect(e.gradedBy).toBeNull();
    expect(e.gradedAt).toBeNull();

    await restorePostMigrationShape(db);
  });

  it("T8: recovery fabricates NO terminal attempt or enrollment facts", async () => {
    const id = crypto.randomUUID();
    const { enrollmentId } = await seedLegacyResidue(db, orgId, {
      id,
      questionSnapshot: objectiveSnapshot("q1", "b"),
      answers: draftAnswer("q1", "b"),
    });
    await rewindGradingToSubmitted(db, id);
    await runBackfill(db);

    await recoverLegacyGradingWorkset(db, id);

    const attempt = await getAttemptRow(db, id);
    expect(attempt.status).toBe("submitted");
    expect(attempt.score).toBeNull();
    expect(attempt.passed).toBeNull();
    expect(attempt.gradingResult).toBeNull();
    expect(attempt.gradedAt).toBeNull();

    const enrollment = (
      await db
        .select()
        .from(schema.examEnrollments)
        .where(eq(schema.examEnrollments.id, enrollmentId))
    )[0]!;
    expect(enrollment.finalScore).toBeNull();
    expect(enrollment.finalPassed).toBeNull();
    expect(enrollment.finalAttemptId).toBeNull();
    expect(enrollment.status).toBe("started");

    await restorePostMigrationShape(db);
  });

  it("T3: objective-only residue reaches canonical terminal closure through the normal grading path", async () => {
    const id = crypto.randomUUID();
    const { enrollmentId } = await seedLegacyResidue(db, orgId, {
      id,
      questionSnapshot: objectiveSnapshot("q1", "b"),
      answers: draftAnswer("q1", "b"),
    });
    await rewindGradingToSubmitted(db, id);
    await runBackfill(db);
    await recoverLegacyGradingWorkset(db, id);

    const { attempt } = await gradeViaCandidateResubmit(
      db,
      ctx,
      id,
      (await getAttemptRow(db, id)).candidateId,
    );

    expect(attempt.status).toBe("graded");
    expect(attempt.score).toBe(100);
    expect(attempt.passed).toBe(true);
    expect(attempt.gradingStatus).toBe("auto_graded");
    expect(attempt.gradedAt).not.toBeNull();
    expect(attempt.gradingResult).toEqual([
      {
        questionId: "q1",
        score: 100,
        maxScore: 100,
        correct: true,
        candidateAnswer: "b",
        standardAnswer: "b",
      },
    ]);

    const enrollment = (
      await db
        .select()
        .from(schema.examEnrollments)
        .where(eq(schema.examEnrollments.id, enrollmentId))
    )[0]!;
    expect(enrollment.finalScore).toBe(100);
    expect(enrollment.finalPassed).toBe(true);
    expect(enrollment.finalAttemptId).toBe(id);

    await restorePostMigrationShape(db);
  });

  it("T4: manual residue recovers to pending_manual and closes only through normal manual grading", async () => {
    const id = crypto.randomUUID();
    const { enrollmentId } = await seedLegacyResidue(db, orgId, {
      id,
      questionSnapshot: manualSnapshot("m1"),
      answers: draftAnswer("m1", "考生作答"),
    });
    await rewindGradingToSubmitted(db, id);
    await runBackfill(db);

    const result = await recoverLegacyGradingWorkset(db, id);
    expect(result.action).toBe("materialized");
    // The migration-default 'auto_graded' label is realigned to the canonical
    // freeze-barrier classification — without it the manual grading command
    // would refuse the attempt forever.
    expect(result.gradingStatusAlignment).toEqual({
      from: "auto_graded",
      to: "pending_manual",
    });

    const attempt = await getAttemptRow(db, id);
    expect(attempt.status).toBe("submitted");
    expect(attempt.gradingStatus).toBe("pending_manual");
    expect(attempt.score).toBeNull();
    expect(attempt.passed).toBeNull();
    expect(attempt.gradingResult).toBeNull();
    expect(attempt.gradedAt).toBeNull();

    const entries = await getEntryRows(db, id);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.gradingMode).toBe("manual");
    expect(entries[0]!.status).toBe("pending_manual");
    expect(entries[0]!.earnedScore).toBeNull();
    expect(entries[0]!.candidateAnswer).toBe("考生作答");
    expect(entries[0]!.standardAnswer).toBe("参考答案");

    // No auto-promotion: the normal candidate grading path HOLDS a
    // pending_manual attempt at submitted (the manual queue owns closure).
    const held = await gradeViaCandidateResubmit(
      db,
      ctx,
      id,
      attempt.candidateId,
    );
    expect(held.alreadyGraded).toBe(false);
    expect(held.attempt.status).toBe("submitted");
    expect(held.attempt.score).toBeNull();
    expect(held.attempt.gradingStatus).toBe("pending_manual");

    // Normal manual grading surface completes the entry → canonical closure.
    const graded = await gradeManualViaGradingSurface(db, ctx, id, "m1", 80);
    expect(graded.fullyGraded).toBe(true);

    const closed = await getAttemptRow(db, id);
    expect(closed.status).toBe("graded");
    expect(closed.score).toBe(80);
    expect(closed.passed).toBe(true);
    expect(closed.gradingStatus).toBe("fully_graded");
    expect(closed.gradedAt).not.toBeNull();

    const enrollment = (
      await db
        .select()
        .from(schema.examEnrollments)
        .where(eq(schema.examEnrollments.id, enrollmentId))
    )[0]!;
    expect(enrollment.finalScore).toBe(80);
    expect(enrollment.finalPassed).toBe(true);
    expect(enrollment.finalAttemptId).toBe(id);

    await restorePostMigrationShape(db);
  });

  it("T5: partial workset FAILS CLOSED — no inserts, no gap filling", async () => {
    const id = crypto.randomUUID();
    await seedLegacyResidue(db, orgId, {
      id,
      questionSnapshot: [
        ...objectiveSnapshot("q1", "b"),
        ...objectiveSnapshot("q2", "a").map((q) => ({ ...q, order: 1 })),
      ],
      answers: [...draftAnswer("q1", "b"), ...draftAnswer("q2", "a")],
    });
    await rewindGradingToSubmitted(db, id);
    await runBackfill(db);

    // A partial workset: only q1 exists (one entry short of the 2-question
    // universe). Note this is NOT the proven zero-workset residue shape —
    // recovery must never fill it.
    await db.insert(schema.attemptGradingEntries).values({
      id: crypto.randomUUID(),
      organizationId: orgId,
      attemptId: id,
      questionId: "q1",
      gradingMode: "auto",
      status: "completed_auto",
      maxScore: 100,
      earnedScore: 100,
      candidateAnswer: "b",
      standardAnswer: "b",
      correct: true,
    });

    await expect(recoverLegacyGradingWorkset(db, id)).rejects.toThrow(
      /Grading workset inconsistency.*expected 2 entries, found 1.*not repairable/s,
    );
    expect(await getEntryRows(db, id)).toHaveLength(1);

    await restorePostMigrationShape(db);
  });

  it("T6: mismatched full workset FAILS CLOSED — no overwrite", async () => {
    const id = crypto.randomUUID();
    await seedLegacyResidue(db, orgId, {
      id,
      questionSnapshot: objectiveSnapshot("q1", "b"),
      answers: draftAnswer("q1", "b"),
    });
    await rewindGradingToSubmitted(db, id);
    await runBackfill(db);

    // Complete count, wrong objective earnedScore (canonical truth: 100).
    await db.insert(schema.attemptGradingEntries).values({
      id: crypto.randomUUID(),
      organizationId: orgId,
      attemptId: id,
      questionId: "q1",
      gradingMode: "auto",
      status: "completed_auto",
      maxScore: 100,
      earnedScore: 0,
      candidateAnswer: "b",
      standardAnswer: "b",
      correct: false,
    });

    await expect(recoverLegacyGradingWorkset(db, id)).rejects.toThrow(
      /Grading workset inconsistency.*earnedScore 0 != expected 100/s,
    );
    const entries = await getEntryRows(db, id);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.earnedScore).toBe(0);

    await restorePostMigrationShape(db);
  });

  it("T7: idempotency — a second run on a restored workset validates without writing", async () => {
    const id = crypto.randomUUID();
    await seedLegacyResidue(db, orgId, {
      id,
      questionSnapshot: objectiveSnapshot("q1", "b"),
      answers: draftAnswer("q1", "b"),
    });
    await rewindGradingToSubmitted(db, id);
    await runBackfill(db);

    const first = await recoverLegacyGradingWorkset(db, id);
    expect(first.action).toBe("materialized");

    const second = await recoverLegacyGradingWorkset(db, id);
    expect(second.action).toBe("validated_no_op");
    expect(second.entryCount).toBe(1);
    expect(second.gradingStatusAlignment).toBeNull();
    expect(await getEntryRows(db, id)).toHaveLength(1);

    await restorePostMigrationShape(db);
  });

  it("T9: unresolved legacy grading is refused — the rewind disposition must come first", async () => {
    const id = crypto.randomUUID();
    await seedLegacyResidue(db, orgId, {
      id,
      questionSnapshot: objectiveSnapshot("q1", "b"),
      answers: draftAnswer("q1", "b"),
    });

    await expect(recoverLegacyGradingWorkset(db, id)).rejects.toThrow(
      /status='grading'.*only accepts the post-disposition shape\s*status='submitted'/s,
    );
    const row = await getAttemptRow(db, id);
    expect(row.status as string).toBe("grading");
    expect(await getEntryRows(db, id)).toHaveLength(0);

    await restorePostMigrationShape(db);
  });

  it("T10: the full documented operator sequence reaches canonical grading (canonical #542 recovery proof)", async () => {
    const id = crypto.randomUUID();
    const { enrollmentId } = await seedLegacyResidue(db, orgId, {
      id,
      questionSnapshot: objectiveSnapshot("q1", "b"),
      answers: draftAnswer("q1", "b"),
    });

    // 1. 0043 detects the residue: the backfill preflight refuses to run.
    await expect(runBackfill(db)).rejects.toThrow(
      /legacy status='grading'.*0043_persisted_state_status_checks/s,
    );

    // 2. Offline rewind (runbook Option A).
    await rewindGradingToSubmitted(db, id);

    // 3. Re-run 0043: reinstalling the CHECK proves the dispositioned row is
    //    legal vocabulary again (ADD CONSTRAINT validates existing rows).
    await restorePostMigrationShape(db);

    // 4. Backfill now succeeds and freezes submitted_answers.
    const stats = await runBackfill(db);
    expect(stats.backfilled).toBeGreaterThanOrEqual(1);

    // 5. Legacy workset recovery reconstructs the missing grading input.
    const recovered = await recoverLegacyGradingWorkset(db, id);
    expect(recovered.action).toBe("materialized");

    // 6. The normal current grading surface terminalizes the attempt.
    const { attempt } = await gradeViaCandidateResubmit(
      db,
      ctx,
      id,
      (await getAttemptRow(db, id)).candidateId,
    );
    expect(attempt.status).toBe("graded");
    expect(attempt.score).toBe(100);
    expect(attempt.passed).toBe(true);
    expect(attempt.gradedAt).not.toBeNull();

    const enrollment = (
      await db
        .select()
        .from(schema.examEnrollments)
        .where(eq(schema.examEnrollments.id, enrollmentId))
    )[0]!;
    expect(enrollment.finalScore).toBe(100);
    expect(enrollment.finalPassed).toBe(true);
    expect(enrollment.finalAttemptId).toBe(id);
  });

  it("dry-run reports the materialization plan without writing", async () => {
    const id = crypto.randomUUID();
    await seedLegacyResidue(db, orgId, {
      id,
      questionSnapshot: objectiveSnapshot("q1", "b"),
      answers: draftAnswer("q1", "b"),
    });
    await rewindGradingToSubmitted(db, id);
    await runBackfill(db);

    const result = await recoverLegacyGradingWorkset(db, id, { dryRun: true });
    expect(result.action).toBe("would_materialize");
    expect(result.entryCount).toBe(1);
    expect(await getEntryRows(db, id)).toHaveLength(0);
    const row = await getAttemptRow(db, id);
    expect(row.gradingStatus).toBe("auto_graded");
    expect(row.score).toBeNull();

    await restorePostMigrationShape(db);
  });

  it("dry-run reports an exact-complete workset as would_validate without writing", async () => {
    const id = crypto.randomUUID();
    await seedLegacyResidue(db, orgId, {
      id,
      questionSnapshot: objectiveSnapshot("q1", "b"),
      answers: draftAnswer("q1", "b"),
    });
    await rewindGradingToSubmitted(db, id);
    await runBackfill(db);
    await recoverLegacyGradingWorkset(db, id);

    const result = await recoverLegacyGradingWorkset(db, id, { dryRun: true });
    expect(result.action).toBe("would_validate");
    expect(await getEntryRows(db, id)).toHaveLength(1);

    await restorePostMigrationShape(db);
  });

  it("refuses an attempt whose submitted_answers is still NULL (backfill must run first)", async () => {
    const id = crypto.randomUUID();
    await seedLegacyResidue(db, orgId, {
      id,
      questionSnapshot: objectiveSnapshot("q1", "b"),
      answers: draftAnswer("q1", "b"),
    });
    await rewindGradingToSubmitted(db, id);
    // No backfill here — submitted_answers stays NULL.

    await expect(recoverLegacyGradingWorkset(db, id)).rejects.toThrow(
      /no frozen submitted_answers.*backfill:submitted-answers/s,
    );
    expect(await getEntryRows(db, id)).toHaveLength(0);

    await restorePostMigrationShape(db);
  });

  it("refuses a submitted row that already carries a terminal fact (contradictory data, not residue)", async () => {
    const id = crypto.randomUUID();
    await seedLegacyResidue(db, orgId, {
      id,
      questionSnapshot: objectiveSnapshot("q1", "b"),
      answers: draftAnswer("q1", "b"),
    });
    await rewindGradingToSubmitted(db, id);
    await runBackfill(db);
    // Contradictory shape: terminal score present while status='submitted'
    // (physical column is total_score — see the 0043 runbook's identify SQL).
    await db.execute(
      sql.raw(`UPDATE exam_attempts SET total_score = 100 WHERE id = '${id}'`),
    );

    await expect(recoverLegacyGradingWorkset(db, id)).rejects.toThrow(
      /already carries terminal fact\(s\): score.*investigate its origin first/s,
    );
    expect(await getEntryRows(db, id)).toHaveLength(0);

    await restorePostMigrationShape(db);
  });

  it("refuses grading_status='fully_graded' on a non-graded attempt", async () => {
    const id = crypto.randomUUID();
    await seedLegacyResidue(db, orgId, {
      id,
      questionSnapshot: objectiveSnapshot("q1", "b"),
      answers: draftAnswer("q1", "b"),
    });
    await rewindGradingToSubmitted(db, id);
    await runBackfill(db);
    await db.execute(
      sql.raw(
        `UPDATE exam_attempts SET grading_status = 'fully_graded' WHERE id = '${id}'`,
      ),
    );

    await expect(recoverLegacyGradingWorkset(db, id)).rejects.toThrow(
      /grading_status='fully_graded'.*contradictory terminal grading lifecycle/s,
    );
    expect(await getEntryRows(db, id)).toHaveLength(0);

    await restorePostMigrationShape(db);
  });

  it("refuses an absent or empty questionSnapshot (canonical derivation has no question universe)", async () => {
    const id = crypto.randomUUID();
    await seedLegacyResidue(db, orgId, {
      id,
      questionSnapshot: [],
      answers: [],
    });
    await rewindGradingToSubmitted(db, id);
    await runBackfill(db);

    await expect(recoverLegacyGradingWorkset(db, id)).rejects.toThrow(
      /absent or empty questionSnapshot.*frozen question universe/s,
    );
    expect(await getEntryRows(db, id)).toHaveLength(0);

    await restorePostMigrationShape(db);
  });
});
