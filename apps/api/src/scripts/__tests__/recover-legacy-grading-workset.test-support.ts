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
import type { Exam, QuestionSnapshot, RequestContext } from "@exam/domain";
import { gradeQuestion, lockEnrollmentAndAttempt } from "@exam/exam-engine";
import {
  createExamEngineRepos,
  createGradingWorksetRepoAdapter,
} from "../../adapters/repoAdapters.js";
import { submitAndGradeAttempt } from "../../orchestrators/submitAndGradeAttempt.js";
import { runBackfill } from "../backfill-submitted-answers.js";

const now = new Date();

export const SYSTEM_CTX: RequestContext = {
  actorId: crypto.randomUUID(),
  organizationId: "",
  role: "Admin",
  permissions: [],
  sessionId: crypto.randomUUID(),
};

export interface RecoveryTestEnvironment {
  db: Database;
  conn: Awaited<ReturnType<typeof createDatabase>>;
  cleanup: () => Promise<void>;
  orgId: string;
  ctx: RequestContext;
}

export async function setupRecoveryTestEnvironment(
  namespace: string,
  orgName: string,
  slugPrefix: string,
): Promise<RecoveryTestEnvironment> {
  const iso = await setupIsolatedTestDb({
    namespace,
    databaseUrl: resolveTestDbUrl(),
  });
  const conn = await createDatabase(resolveTestDbUrl(), iso.schemaName);
  const db = conn.db;
  await migratePostgres(db, { migrationsSchema: iso.schemaName });
  const rows = await db
    .insert(schema.organizations)
    .values({
      id: crypto.randomUUID(),
      name: orgName,
      displayName: orgName,
      slug: `${slugPrefix}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`,
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: schema.organizations.id });
  const orgId = rows[0]!.id;
  return {
    db,
    conn,
    cleanup: iso.cleanup,
    orgId,
    ctx: { ...SYSTEM_CTX, organizationId: orgId },
  };
}

export async function teardownRecoveryTestEnvironment(
  env: RecoveryTestEnvironment,
): Promise<void> {
  await env.conn.sql.end();
  await env.cleanup();
}

/** Objective-only frozen snapshot (same shape the live submit path freezes). */
export function objectiveSnapshot(
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
export function manualSnapshot(questionId: string): QuestionSnapshot[] {
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

export function draftAnswer(questionId: string, value: unknown) {
  return [{ questionId, answer: value, version: 1, savedAt: now }];
}

interface ResidueSeedInput {
  id: string;
  questionSnapshot: QuestionSnapshot[];
  answers: unknown[];
}

/** Seeds the exact historical #542 grading crash residue. */
export async function seedLegacyResidue(
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

  await dropStatusCheck(db);
  await db.execute(
    sql.raw(
      `UPDATE exam_attempts SET status = 'grading' WHERE id = '${input.id}'`,
    ),
  );

  return { examId, enrollmentId, candidateId };
}

export async function dropStatusCheck(db: Database) {
  await db.execute(
    sql.raw(
      `ALTER TABLE exam_attempts DROP CONSTRAINT IF EXISTS exam_attempts_status_check`,
    ),
  );
}

export async function reinstallStatusCheck(db: Database) {
  await db.execute(
    sql.raw(`
      ALTER TABLE exam_attempts ADD CONSTRAINT exam_attempts_status_check
      CHECK ("status" IN ('not_started', 'queued', 'in_progress', 'disrupted', 'submitted', 'graded', 'voided'))
    `),
  );
}

export async function restorePostMigrationShape(db: Database) {
  await db.execute(
    sql.raw(
      `UPDATE exam_attempts SET status = 'submitted' WHERE status = 'grading'`,
    ),
  );
  await dropStatusCheck(db);
  await reinstallStatusCheck(db);
}

export async function rewindGradingToSubmitted(
  db: Database,
  attemptId: string,
) {
  await db.execute(
    sql.raw(
      `UPDATE exam_attempts SET status = 'submitted' WHERE id = '${attemptId}' AND status = 'grading'`,
    ),
  );
}

export async function getAttemptRow(db: Database, id: string) {
  return (
    await db
      .select()
      .from(schema.examAttempts)
      .where(eq(schema.examAttempts.id, id))
  )[0]!;
}

export async function getEntryRows(db: Database, attemptId: string) {
  return db
    .select()
    .from(schema.attemptGradingEntries)
    .where(eq(schema.attemptGradingEntries.attemptId, attemptId));
}

export function gradeViaCandidateResubmit(
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

export async function gradeManualViaGradingSurface(
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

/** Seeds a submitted+backfilled residue row ready for workset injection. */
export async function seedReadyResidue(
  db: Database,
  orgId: string,
  questionSnapshot: QuestionSnapshot[],
  answers: unknown[],
): Promise<string> {
  const id = crypto.randomUUID();
  await seedLegacyResidue(db, orgId, { id, questionSnapshot, answers });
  await rewindGradingToSubmitted(db, id);
  await runBackfill(db);
  return id;
}

export async function setGradingStatus(
  db: Database,
  id: string,
  label: string,
) {
  await db.execute(
    sql.raw(
      `UPDATE exam_attempts SET grading_status = '${label}' WHERE id = '${id}'`,
    ),
  );
}
