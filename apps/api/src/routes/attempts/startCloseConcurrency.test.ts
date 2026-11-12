import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import { schema } from "@exam/db/schema/pg";
import { createPostgresDatabase, migratePostgres } from "@exam/db/postgres";
import { setupIsolatedTestDb } from "@exam/db/testIsolation";
import { resolveTestDbUrl } from "@exam/db/testDb";
import { createAttemptRepo } from "@exam/db/repository/attemptRepo";
import { createExamRepo } from "@exam/db/repository/examRepo";
import { createEnrollmentRepo } from "@exam/db/repository/enrollmentRepo";
import { createAttemptGradingEntryRepo } from "@exam/db/repository/attemptGradingEntryRepo";
import { createAttemptInterruptionRepo } from "@exam/db/repository/attemptInterruptionRepo";
import { createAttemptInterruptionEventRepo } from "@exam/db/repository/attemptInterruptionEventRepo";
import { createAttemptTimeAdjustmentRepo } from "@exam/db/repository/attemptTimeAdjustmentRepo";
import { createExamAdmissionRepo } from "@exam/db/repository/examAdmissionRepo";
import { executeInTransaction } from "@exam/db/types";
import type { Database, TransactionDatabase } from "@exam/db/types";
import type { ExamRepository, EnrollmentRepository } from "@exam/exam-engine";
import {
  cancelExam,
  closeExam,
  markDisrupted,
  startOrRestoreAttempt,
} from "@exam/exam-engine";
import {
  createExamAdmissionRepoAdapter,
  createExamEngineRepos,
  createGradingWorksetRepoAdapter,
  createInterruptionEpisodeRepoAdapter,
  createInterruptionEventRepoAdapter,
  createTimeAdjustmentRepoAdapter,
} from "../../adapters/repoAdapters.js";
import { executeAdminExamTransition } from "../examTransitionExecutor.js";
import {
  ExamCancelNotAllowedError,
  ExamCloseNotAllowedError,
  ExamNotOpenError,
  InvalidStateTransitionError,
  type ControlFlags,
  type Exam,
  type Permission,
  type QuestionSnapshot,
  type RequestContext,
  type Role,
} from "@exam/domain";
import { hashPassword } from "@exam/auth/password";
import { createDeferred } from "../../testing/barrier.js";
import type { Deferred } from "../../testing/barrier.js";
import { collectConnectionEvidence } from "../../testing/operatorGrantConcurrencyHarness.js";
import {
  waitForBackendBlocked,
  type ObserverSql,
} from "../../testing/pgConcurrencyProbes.js";

/**
 * H-08 (#961): attempt start vs exam close/cancel lifecycle consistency.
 *
 * Fault model (as-built): the candidate start command reads the Exam
 * authority with a plain (non-locking) read BEFORE taking the
 * Enrollment→Attempt lock seam and never re-checks the exam status after the
 * seam. The admin close/cancel command locks the Exam row FOR UPDATE and
 * evaluates its unresolved-attempt guard with a plain MVCC count that can
 * neither see an uncommitted attempt INSERT nor (under REPEATABLE READ) an
 * attempt committed after the transaction snapshot was established. Start
 * takes no Exam-row lock at all, so the two commands have zero lock-conflict
 * surface and can interleave into a state no serial history explains:
 * Exam=closed/canceled while an in_progress attempt was created, the
 * enrollment attemptCount advanced, and the durable queue admission consumed.
 * In untimed mode no deadline ever freezes that attempt.
 *
 * Contracts pinned here:
 *   I1 — after close/cancel commits, a start holding only a stale OPEN read
 *        must not create an attempt (no phantom row, no attemptCount, no
 *        admission consumption);
 *   I2 — after a start has created an unresolved attempt (even one whose
 *        transaction is still open), a concurrent close/cancel must be
 *        serialized behind it and then reject UNRESOLVED_ATTEMPTS_EXIST —
 *        both operations must never succeed;
 *   I4 — resume/restore of existing attempts and their lock protocol stay
 *        intact (committed in_progress/disrupted attempts still block close).
 *
 * Each schedule pins the interleaving with two physically distinct backend
 * sessions (max:1 pools, PID evidence), barrier-controlled parking INSIDE the
 * production transaction composition (the same repo wiring the routes use),
 * bounded pg_locks overlap probes, and the durable rows as the sole oracle.
 * No sleep proves correctness: the bounded window only observes the "closed
 * while parked" violation signal, and the real-overlap proof is the
 * ungranted-lock row on the observer connection.
 */

type TimingDim = {
  name: string;
  timingMode: "untimed" | "timed_window" | "deadline";
  durationMinutes: number | null;
  closeAtOffsetMs: number | null;
};

const DIM_UNTIMED_QUEUE: TimingDim = {
  name: "untimed+queue",
  timingMode: "untimed",
  durationMinutes: null,
  closeAtOffsetMs: null,
};
const DIM_TIMED_WINDOW_NO_QUEUE: TimingDim = {
  name: "timed_window/no-queue",
  timingMode: "timed_window",
  durationMinutes: 60,
  closeAtOffsetMs: 86_400_000,
};
const DIM_DEADLINE_QUEUE: TimingDim = {
  name: "deadline+queue",
  timingMode: "deadline",
  durationMinutes: null,
  closeAtOffsetMs: 86_400_000,
};

interface StartCloseFixture {
  ctx: RequestContext;
  adminCtx: RequestContext;
  organizationId: string;
  candidateId: string;
  examId: string;
  enrollmentId: string;
  admissionId: string | null;
}

function makeCtx(orgId: string, actorId: string): RequestContext {
  return {
    actorId,
    organizationId: orgId,
    role: "Admin" as Role,
    permissions: [] as Permission[],
    sessionId: "start-close-race-test",
    targetOrganizationId: orgId,
  };
}

function singleChoiceSnapshot(questionId: string): QuestionSnapshot[] {
  return [
    {
      originalQuestionId: questionId,
      type: "single_choice",
      content: "1+1=?",
      contentDocument: null,
      answerMode: null,
      attachments: [],
      options: [
        { id: "a", content: "1" },
        { id: "b", content: "2" },
        { id: "c", content: "3" },
      ],
      standardAnswer: "b",
      score: 100,
      gradingRule: {
        multiSelectScoring: "all_correct_full",
        fillBlankMatchMode: "exact",
      },
      order: 0,
      rubric: null,
    },
  ];
}

async function buildFixture(
  db: Database,
  dim: TimingDim,
): Promise<StartCloseFixture> {
  const slug = `start-close-${crypto.randomUUID().slice(0, 8)}`;
  const now = new Date();
  const organizationId = crypto.randomUUID();
  const courseId = crypto.randomUUID();
  const questionId = crypto.randomUUID();
  const candidateUserId = crypto.randomUUID();
  const profileId = crypto.randomUUID();
  const examId = crypto.randomUUID();
  const enrollmentId = crypto.randomUUID();
  const requireQueue = dim.name.includes("queue");

  await db.insert(schema.organizations).values({
    id: organizationId,
    name: slug,
    displayName: slug,
    slug,
    createdAt: now,
    updatedAt: now,
  });
  const passwordHash = await hashPassword("password123");
  await db.insert(schema.users).values({
    id: candidateUserId,
    organizationId,
    username: `cand-${slug}`,
    passwordHash,
    name: "SC Candidate",
    role: "Candidate",
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.candidateProfiles).values({
    id: profileId,
    organizationId,
    userId: candidateUserId,
    fields: {},
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.courses).values({
    id: courseId,
    organizationId,
    name: `SC Course ${slug}`,
    code: `SC-${slug}`,
    description: "",
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(schema.questions).values({
    id: questionId,
    organizationId,
    courseId,
    type: "single_choice",
    content: "1+1=?",
    options: [
      { id: "a", content: "1" },
      { id: "b", content: "2" },
      { id: "c", content: "3" },
    ],
    standardAnswer: "b",
    attachments: [],
    score: 100,
    difficulty: 1,
    tags: [],
    gradingRule: {
      multiSelectScoring: "all_correct_full",
      fillBlankMatchMode: "exact",
    },
    createdAt: now,
    updatedAt: now,
  });

  const controlFlags: ControlFlags = {
    shuffleQuestions: false,
    shuffleOptions: false,
    detectTabSwitch: false,
    disableCopyPaste: false,
    requireQueue,
    batchSize: 10,
    batchInterval: 3,
    restrictIp: false,
    requireLockdown: false,
    showResultImmediately: true,
  };
  const exam: Exam = {
    id: examId,
    organizationId,
    title: "SC Exam",
    description: "",
    courseId,
    status: "open",
    timingMode: dim.timingMode,
    durationMinutes: dim.durationMinutes,
    openAt: new Date(now.getTime() - 3600_000),
    closeAt:
      dim.closeAtOffsetMs === null
        ? null
        : new Date(now.getTime() + dim.closeAtOffsetMs),
    passingScore: 60,
    totalScore: 100,
    questionSelectionMode: "manual",
    questionIds: [questionId],
    questionSnapshot: singleChoiceSnapshot(questionId),
    controlFlags,
    retakePolicy: "unlimited",
    scoreStrategy: "highest",
    maxAttempts: 3,
    latestStartOffsetMinutes: null,
    minSubmitAfterStartMinutes: null,
    resultPublicationMode: "immediate",
    resultsPublishedAt: null,
    syncStartedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(schema.exams).values({
    id: examId,
    organizationId,
    title: exam.title,
    description: exam.description,
    courseId,
    status: exam.status,
    timingMode: exam.timingMode,
    durationMinutes: exam.durationMinutes,
    openAt: exam.openAt,
    closeAt: exam.closeAt,
    passingScore: exam.passingScore,
    totalScore: exam.totalScore,
    questionSelectionMode: exam.questionSelectionMode,
    questionIds: exam.questionIds,
    questionSnapshot: exam.questionSnapshot,
    controlFlags: exam.controlFlags,
    retakePolicy: exam.retakePolicy,
    scoreStrategy: exam.scoreStrategy,
    maxAttempts: exam.maxAttempts,
    latestStartOffsetMinutes: null,
    minSubmitAfterStartMinutes: null,
    resultPublicationMode: exam.resultPublicationMode,
    resultsPublishedAt: null,
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(schema.examEnrollments).values({
    id: enrollmentId,
    organizationId,
    examId,
    candidateId: profileId,
    status: "assigned",
    attemptCount: 0,
    finalScore: null,
    finalPassed: null,
    finalAttemptId: null,
    createdAt: now,
    updatedAt: now,
  });

  let admissionId: string | null = null;
  if (requireQueue) {
    // Pre-admitted active membership: the start gate reads admittedAt != null
    // and passes; consumeActive is the consumption under test.
    admissionId = crypto.randomUUID();
    await db.insert(schema.examAdmissions).values({
      id: admissionId,
      organizationId,
      examId,
      candidateId: profileId,
      joinedAt: now,
      admittedAt: now,
      consumedAt: null,
      consumedAttemptId: null,
      createdAt: now,
      updatedAt: now,
    });
  }

  return {
    ctx: makeCtx(organizationId, "candidate-racer"),
    adminCtx: makeCtx(organizationId, "admin-racer"),
    organizationId,
    candidateId: profileId,
    examId,
    enrollmentId,
    admissionId,
  };
}

/** Durable end-state of the exam's lifecycle rows, read OUTSIDE both racers. */
interface FinalState {
  examStatus: string;
  attemptCount: number;
  attempts: Array<{ id: string; status: string; attemptNo: number }>;
  enrollmentStatus: string;
  admissionConsumedAt: Date | null;
  admissionConsumedAttemptId: string | null;
  auditActions: string[];
}

async function readFinalState(
  observer: ObserverSql,
  f: StartCloseFixture,
): Promise<FinalState> {
  const examRows = (await observer.unsafe(
    "SELECT status::text AS status FROM exams WHERE organization_id = $1 AND id = $2",
    [f.organizationId, f.examId],
  )) as Array<{ status: string }>;
  const attemptRows = (await observer.unsafe(
    "SELECT id, status::text AS status, attempt_no FROM exam_attempts WHERE organization_id = $1 AND exam_id = $2 ORDER BY attempt_no",
    [f.organizationId, f.examId],
  )) as Array<{ id: string; status: string; attempt_no: number }>;
  const enrollmentRows = (await observer.unsafe(
    "SELECT status::text AS status, attempt_count FROM exam_enrollments WHERE organization_id = $1 AND id = $2",
    [f.organizationId, f.enrollmentId],
  )) as Array<{ status: string; attempt_count: number }>;
  const admissionRows = f.admissionId
    ? ((await observer.unsafe(
        "SELECT consumed_at, consumed_attempt_id FROM exam_admissions WHERE id = $1",
        [f.admissionId],
      )) as Array<{
        consumed_at: Date | null;
        consumed_attempt_id: string | null;
      }>)
    : [];
  const auditRows = (await observer.unsafe(
    "SELECT action FROM audit_logs WHERE organization_id = $1 AND target_id = $2 ORDER BY created_at",
    [f.organizationId, f.examId],
  )) as Array<{ action: string }>;
  return {
    examStatus: examRows[0]!.status,
    attemptCount: Number(enrollmentRows[0]!.attempt_count),
    attempts: attemptRows.map((r) => ({
      id: r.id,
      status: r.status,
      attemptNo: Number(r.attempt_no),
    })),
    enrollmentStatus: enrollmentRows[0]!.status,
    admissionConsumedAt: admissionRows[0]?.consumed_at ?? null,
    admissionConsumedAttemptId: admissionRows[0]?.consumed_attempt_id ?? null,
    auditActions: auditRows.map((r) => r.action),
  };
}

async function captureIsolation(tx: TransactionDatabase): Promise<string> {
  const rows = (await tx.execute(
    sql`SHOW transaction_isolation`,
  )) as unknown as Array<{ transaction_isolation: string }>;
  return String(rows[0]?.transaction_isolation ?? "unknown");
}

/** Where a schedule parks the start transaction inside the engine flow. */
type StartParkPoint =
  /** After the plain Exam OPEN read, before the Enrollment FOR UPDATE. */
  | "seam-entry"
  /** After the attempt INSERT + admission consumption, before commit. */
  | "enrollment-update";

interface StartParkGate {
  parked: Deferred<void>;
  release: Deferred<void>;
}

/** Decorates the tx-bound engine-facing enrollment adapter to park at the
 * chosen engine point. One-shot per decoration instance; an
 * executeInTransaction retry passes straight through because the gate is
 * already settled by then. */
function parkEnrollments(
  enrollments: EnrollmentRepository,
  point: StartParkPoint,
  gate: StartParkGate,
): EnrollmentRepository {
  let parkedOnce = false;
  const park = async () => {
    if (parkedOnce) return;
    parkedOnce = true;
    gate.parked.resolve();
    await gate.release.promise;
  };
  if (point === "seam-entry") {
    return {
      ...enrollments,
      findByExamAndCandidateForUpdate: async (examId, candidateId) => {
        await park();
        return enrollments.findByExamAndCandidateForUpdate(examId, candidateId);
      },
    };
  }
  return {
    ...enrollments,
    update: async (enrollmentId, data) => {
      await park();
      return enrollments.update(enrollmentId, data);
    },
  };
}

/**
 * Mirrors the production /attempts/:examId/start transaction composition
 * (attempts.candidate.ts start route): executeInTransaction READ COMMITTED
 * with tx-scoped repo adapters driving the engine startOrRestoreAttempt.
 */
async function startComposition(
  db: Database,
  ctx: RequestContext,
  f: Pick<StartCloseFixture, "examId" | "candidateId">,
  now: Date,
  park?: { point: StartParkPoint; gate: StartParkGate },
): Promise<
  | { ok: true; attemptId: string; isNew: boolean; isolation: string }
  | { ok: false; error: unknown; isolation: string }
> {
  // In-transaction evidence survives the failure path for schedule recording.
  const evidence = { isolation: "not-captured" };
  try {
    const started = await executeInTransaction(
      db,
      async (tx) => {
        evidence.isolation = await captureIsolation(tx);
        const { exams, enrollments, attempts } = createExamEngineRepos(
          {
            examRepo: createExamRepo(tx),
            attemptRepo: createAttemptRepo(tx),
            enrollmentRepo: createEnrollmentRepo(tx),
          },
          ctx,
        );
        const episodeRepo = createInterruptionEpisodeRepoAdapter(
          createAttemptInterruptionRepo(tx),
          ctx,
        );
        const eventRepo = createInterruptionEventRepoAdapter(
          createAttemptInterruptionEventRepo(tx),
          ctx,
        );
        const adjustmentRepo = createTimeAdjustmentRepoAdapter(
          createAttemptTimeAdjustmentRepo(tx),
          ctx,
        );
        const gradingWorksetRepo = createGradingWorksetRepoAdapter(
          createAttemptGradingEntryRepo(tx),
          ctx,
        );
        const effectiveEnrollments = park
          ? parkEnrollments(enrollments, park.point, park.gate)
          : enrollments;
        const result = await startOrRestoreAttempt(
          exams,
          effectiveEnrollments,
          attempts,
          f.examId,
          f.candidateId,
          now,
          {
            episodeRepo,
            eventRepo,
            adjustmentRepo,
            gradingWorksetRepo,
            admission: {
              repo: createExamAdmissionRepoAdapter(
                createExamAdmissionRepo(tx),
                ctx,
              ),
            },
          },
        );
        return { attemptId: result.attempt.id, isNew: result.isNew };
      },
      "read committed",
    );
    return {
      ok: true,
      attemptId: started.attemptId,
      isNew: started.isNew,
      isolation: evidence.isolation,
    };
  } catch (error) {
    return { ok: false, error, isolation: evidence.isolation };
  }
}

function fakeRequest(id: string): FastifyRequest {
  return { id, ip: "127.0.0.1", headers: {} } as unknown as FastifyRequest;
}

type TransitionKind = "close" | "cancel";

/**
 * Mirrors the production admin transition composition for close/cancel
 * (exam.ts routes): executeAdminExamTransition owns the transaction, the
 * Exam FOR UPDATE lock, the reconcile step, the unresolved-attempt guard and
 * the atomic audit. The recorded in-transaction isolation is returned with
 * the result so the schedule evidence names it.
 */
async function adminTransitionComposition(
  db: Database,
  ctx: RequestContext,
  examId: string,
  now: Date,
  kind: TransitionKind,
  reason: string,
): Promise<
  | { ok: true; isolation: string; fromStatus: string; unresolvedCount: number }
  | { ok: false; error: unknown; isolation: string }
> {
  const evidence = { isolation: "not-captured" };
  try {
    const result = await executeAdminExamTransition(
      db,
      ctx,
      examId,
      now,
      async ({ tx, repo, exam }) => {
        evidence.isolation = await captureIsolation(tx);
        const attemptRepo = createAttemptRepo(tx);
        const unresolvedCount = await attemptRepo.countUnresolvedByExam(
          ctx,
          examId,
        );
        if (unresolvedCount > 0) {
          throw kind === "close"
            ? new ExamCloseNotAllowedError({
                reason: "UNRESOLVED_ATTEMPTS_EXIST",
                activeAttemptCount: unresolvedCount,
              })
            : new ExamCancelNotAllowedError({
                reason: "UNRESOLVED_ATTEMPTS_EXIST",
                activeAttemptCount: unresolvedCount,
              });
        }
        try {
          const updated =
            kind === "close"
              ? await closeExam(repo, examId)
              : await cancelExam(repo, examId);
          return {
            updated,
            fromStatus: exam.status,
            unresolvedCount,
          };
        } catch (err) {
          if (err instanceof InvalidStateTransitionError) {
            throw kind === "close"
              ? new ExamCloseNotAllowedError()
              : new ExamCancelNotAllowedError();
          }
          throw err;
        }
      },
      fakeRequest(`start-close-race-${kind}`),
      (data) =>
        data.fromStatus === (kind === "close" ? "closed" : "canceled")
          ? []
          : [
              {
                action: kind === "close" ? "exam.close" : "exam.cancel",
                targetType: "exam",
                targetId: examId,
                metadata: {
                  reason,
                  fromStatus: data.fromStatus,
                  toStatus: kind === "close" ? "closed" : "canceled",
                  activeAttemptCount: data.unresolvedCount,
                },
              },
            ],
    );
    if (!result) {
      return {
        ok: false,
        error: new Error("exam not found"),
        isolation: evidence.isolation,
      };
    }
    return {
      ok: true,
      isolation: evidence.isolation,
      fromStatus: result.data.fromStatus,
      unresolvedCount: result.data.unresolvedCount,
    };
  } catch (error) {
    return { ok: false, error, isolation: evidence.isolation };
  }
}

/** Settles every outstanding gate so a failed schedule cannot leave a parked
 * transaction waiting on a deferred that nobody will resolve. */
function settleGates(gates: Array<StartParkGate>): void {
  for (const gate of gates) {
    if (!gate.parked.isSettled()) gate.parked.resolve();
    if (!gate.release.isSettled()) gate.release.resolve();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Extracts the AppError code/details from a rejected transition outcome. */
function errorSignature(error: unknown): {
  code: string | undefined;
  reason: string | undefined;
  message: string;
} {
  const err = error as {
    code?: string;
    details?: { reason?: string };
    message?: string;
  };
  return {
    code: err?.code,
    reason: err?.details?.reason,
    message: String(err?.message ?? error),
  };
}

describe("attempt start vs exam close/cancel lifecycle consistency (H-08)", () => {
  let iso: Awaited<ReturnType<typeof setupIsolatedTestDb>>;
  let db1: Database;
  let db2: Database;
  let observerSql: ObserverSql;
  let teardown: () => Promise<void>;

  beforeAll(async () => {
    iso = await setupIsolatedTestDb({
      namespace: "start_close_race",
      databaseUrl: resolveTestDbUrl(),
    });
    const conn1 = await createPostgresDatabase(iso.databaseUrl, iso.schemaName);
    const conn2 = await createPostgresDatabase(iso.databaseUrl, iso.schemaName);
    const connObserver = await createPostgresDatabase(
      iso.databaseUrl,
      iso.schemaName,
    );
    db1 = conn1.db;
    db2 = conn2.db;
    observerSql = connObserver.sql;
    await migratePostgres(db1, { migrationsSchema: iso.schemaName });
    teardown = async () => {
      await connObserver.sql.end();
      await conn2.sql.end();
      await conn1.sql.end();
      await iso.cleanup();
    };
  }, 60_000);

  afterAll(async () => {
    await teardown();
  }, 30_000);

  /**
   * Scenario A — close-first after stale read.
   *
   * Schedule: A's start reads the Exam OPEN (plain read) and parks at the
   * Enrollment seam entry (barrier: aParked). B then runs the full admin
   * close/cancel to commit (its count=0 is truthful at that instant). A is
   * released. The contract (I1): A must NOT create an attempt — no phantom
   * in_progress row, attemptCount stays 0, the queue admission stays
   * unconsumed, and the exam keeps only the truthful transition audit.
   */
  async function runScenarioA(dim: TimingDim, kind: TransitionKind) {
    const f = await buildFixture(db1, dim);
    const now = new Date();
    const pid1 = (await collectConnectionEvidence(db1)).pid;
    const pid2 = (await collectConnectionEvidence(db2)).pid;
    expect(pid1).not.toBe(pid2);

    const gate: StartParkGate = {
      parked: createDeferred<void>("A parked at seam entry"),
      release: createDeferred<void>("A release"),
    };
    try {
      const aPromise = startComposition(db1, f.ctx, f, now, {
        point: "seam-entry",
        gate,
      });
      await gate.parked.promise; // A completed its OPEN read, pre-lock.

      // B runs the full close/cancel to commit while A is parked.
      const b = await adminTransitionComposition(
        db2,
        f.adminCtx,
        f.examId,
        now,
        kind,
        "scenario-A",
      );
      expect(b.ok).toBe(true);
      expect(b.isolation).toBeTypeOf("string");

      gate.release.resolve();
      const a = await aPromise;

      // THE CONTRACT (I1): the stale-read start must be rejected.
      expect(a.ok).toBe(false);
      if (!a.ok) {
        expect(errorSignature(a.error).code).toBe("EXAM_NOT_OPEN");
        expect(a.error).toBeInstanceOf(ExamNotOpenError);
      }

      const finalState = await readFinalState(observerSql, f);
      expect(finalState.examStatus).toBe(
        kind === "close" ? "closed" : "canceled",
      );
      expect(finalState.attempts).toEqual([]);
      expect(finalState.attemptCount).toBe(0);
      expect(finalState.enrollmentStatus).toBe("assigned");
      expect(finalState.admissionConsumedAt).toBeNull();
      expect(finalState.admissionConsumedAttemptId).toBeNull();
      // Only the truthful transition audit exists — no attempt lifecycle lie.
      expect(finalState.auditActions).toEqual([
        kind === "close" ? "exam.close" : "exam.cancel",
      ]);
    } finally {
      settleGates([gate]);
    }
  }

  /**
   * Scenario B — start-first with close waiting.
   *
   * Schedule: A's start parks at the enrollment UPDATE entry — the attempt
   * INSERT and the admission consumption are durable-in-flight (uncommitted)
   * and A holds the Enrollment+Attempt row locks (barrier: aParkedWithInsert).
   * B starts the close/cancel. The contract (I2):
   *   1. B must NOT complete while A is parked (bounded observation window —
   *      a transition that settles here closed an exam over an unresolved,
   *      about-to-commit attempt);
   *   2. B must be genuinely blocked (pg_locks ungranted request on B's pid);
   *   3. after A commits, B must reject UNRESOLVED_ATTEMPTS_EXIST;
   *   4. the durable end state is exam still open + exactly one in_progress
   *      attempt + consumed admission + attemptCount 1 — never both-succeeded.
   */
  async function runScenarioB(dim: TimingDim, kind: TransitionKind) {
    const f = await buildFixture(db1, dim);
    const now = new Date();
    const pid1 = (await collectConnectionEvidence(db1)).pid;
    const pid2 = (await collectConnectionEvidence(db2)).pid;
    expect(pid1).not.toBe(pid2);

    const gate: StartParkGate = {
      parked: createDeferred<void>("A parked at enrollment update"),
      release: createDeferred<void>("A release"),
    };
    try {
      const aPromise = startComposition(db1, f.ctx, f, now, {
        point: "enrollment-update",
        gate,
      });
      await gate.parked.promise; // A: attempt INSERTed + admission consumed, uncommitted.

      // Launch B while A is parked and record whether it settles early.
      const bPromise = adminTransitionComposition(
        db2,
        f.adminCtx,
        f.examId,
        now,
        kind,
        "scenario-B",
      );
      let bOutcome: "pending" | "completed" | "rejected" = "pending";
      void bPromise.then(
        () => {
          bOutcome = "completed";
        },
        () => {
          bOutcome = "rejected";
        },
      );

      // Bounded observation window: a correct close/cancel CANNOT settle here
      // — A's unresolved attempt is uncommitted and A holds conflicting locks.
      await sleep(700);
      expect(bOutcome).toBe("pending");

      // Real-overlap proof: B is blocked on an ungranted lock (the Exam row
      // write lock A must hold across its INSERT→commit critical section).
      const blocked = await waitForBackendBlocked(observerSql, pid2, 8_000);
      expect(["relation", "transactionid", "tuple"]).toContain(
        blocked.blockedOnLocktype,
      );

      gate.release.resolve();
      const a = await aPromise;
      expect(a.ok).toBe(true);
      if (a.ok) {
        expect(a.isNew).toBe(true);
        expect(a.isolation).toBe("read committed");
      }

      const b = await bPromise;
      expect(b.ok).toBe(false);
      if (!b.ok) {
        const sig = errorSignature(b.error);
        expect(sig.code).toBe(
          kind === "close"
            ? "EXAM_CLOSE_NOT_ALLOWED"
            : "EXAM_CANCEL_NOT_ALLOWED",
        );
        expect(sig.reason).toBe("UNRESOLVED_ATTEMPTS_EXIST");
      }

      const finalState = await readFinalState(observerSql, f);
      expect(finalState.examStatus).toBe("open");
      expect(finalState.attempts).toHaveLength(1);
      expect(finalState.attempts[0]!.status).toBe("in_progress");
      expect(finalState.attemptCount).toBe(1);
      expect(finalState.enrollmentStatus).toBe("started");
      if (f.admissionId) {
        expect(finalState.admissionConsumedAt).not.toBeNull();
        expect(finalState.admissionConsumedAttemptId).toBe(
          finalState.attempts[0]!.id,
        );
      }
      // The rejected transition must not have written its audit.
      expect(finalState.auditActions).toEqual([]);
    } finally {
      settleGates([gate]);
    }
  }

  it("Scenario A (close-first after stale read), untimed+queue: start must not create an attempt on a committed-closed exam", async () => {
    await runScenarioA(DIM_UNTIMED_QUEUE, "close");
  }, 30_000);

  it("Scenario A, timed_window/no-queue: stale-read start must be rejected after close commits", async () => {
    await runScenarioA(DIM_TIMED_WINDOW_NO_QUEUE, "close");
  }, 30_000);

  it("Scenario A, deadline+queue: stale-read start must be rejected after close commits", async () => {
    await runScenarioA(DIM_DEADLINE_QUEUE, "close");
  }, 30_000);

  it("Scenario D-A (cancel variant), untimed+queue: stale-read start must not create an attempt on a committed-canceled exam", async () => {
    await runScenarioA(DIM_UNTIMED_QUEUE, "cancel");
  }, 30_000);

  it("Scenario B (start-first with close waiting), untimed+queue: close must block on the in-flight start, then reject UNRESOLVED_ATTEMPTS_EXIST", async () => {
    await runScenarioB(DIM_UNTIMED_QUEUE, "close");
  }, 30_000);

  it("Scenario B, timed_window/no-queue: close must block on the in-flight start, then reject", async () => {
    await runScenarioB(DIM_TIMED_WINDOW_NO_QUEUE, "close");
  }, 30_000);

  it("Scenario D-B (cancel waiting variant), untimed+queue: cancel must block on the in-flight start, then reject", async () => {
    await runScenarioB(DIM_UNTIMED_QUEUE, "cancel");
  }, 30_000);

  /**
   * Scenario C — close fully committed, THEN a plain (unpaused) start.
   * Trivially serial on master too; pinned so the fix cannot regress the
   * already-correct boundary (zero new attempts / counters / consumption).
   */
  it("Scenario C (close committed, then plain start): no new attempt, no counter, no admission consumption", async () => {
    const f = await buildFixture(db1, DIM_UNTIMED_QUEUE);
    const now = new Date();

    const b = await adminTransitionComposition(
      db2,
      f.adminCtx,
      f.examId,
      now,
      "close",
      "scenario-C",
    );
    expect(b.ok).toBe(true);

    const a = await startComposition(db1, f.ctx, f, new Date(), undefined);
    expect(a.ok).toBe(false);
    if (!a.ok) {
      expect(errorSignature(a.error).code).toBe("EXAM_NOT_OPEN");
    }

    const finalState = await readFinalState(observerSql, f);
    expect(finalState.examStatus).toBe("closed");
    expect(finalState.attempts).toEqual([]);
    expect(finalState.attemptCount).toBe(0);
    expect(finalState.admissionConsumedAt).toBeNull();
    expect(finalState.auditActions).toEqual(["exam.close"]);
  }, 30_000);

  /**
   * I4 guard — the resume path: a COMMITTED in_progress attempt blocks close
   * (unresolved guard), and start resumes the existing attempt (isNew=false)
   * without creating a new row. Passes on master; pins non-regression.
   */
  it("I4 resume guard: committed in_progress attempt blocks close; start resumes without creating a second attempt", async () => {
    const f = await buildFixture(db1, DIM_UNTIMED_QUEUE);
    const now = new Date();
    const attemptId = crypto.randomUUID();
    await db1.insert(schema.examAttempts).values({
      id: attemptId,
      organizationId: f.organizationId,
      examId: f.examId,
      enrollmentId: f.enrollmentId,
      candidateId: f.candidateId,
      attemptNo: 1,
      status: "in_progress",
      questionSnapshot: singleChoiceSnapshot(crypto.randomUUID()),
      answers: [],
      startedAt: now,
      lastActivityAt: now,
      createdAt: now,
      updatedAt: now,
    });
    // The seeded attempt No.1 was created out of band; the durable counter
    // must reflect it exactly as the real start path would have left it.
    await db1
      .update(schema.examEnrollments)
      .set({ attemptCount: 1, updatedAt: now })
      .where(eq(schema.examEnrollments.id, f.enrollmentId));

    const b = await adminTransitionComposition(
      db2,
      f.adminCtx,
      f.examId,
      now,
      "close",
      "resume-guard",
    );
    expect(b.ok).toBe(false);
    if (!b.ok) {
      expect(errorSignature(b.error).reason).toBe("UNRESOLVED_ATTEMPTS_EXIST");
    }

    const a = await startComposition(db1, f.ctx, f, new Date(), undefined);
    expect(a.ok).toBe(true);
    if (a.ok) {
      expect(a.isNew).toBe(false);
      expect(a.attemptId).toBe(attemptId);
    }

    const finalState = await readFinalState(observerSql, f);
    expect(finalState.examStatus).toBe("open");
    expect(finalState.attempts).toHaveLength(1);
    expect(finalState.attempts[0]!.status).toBe("in_progress");
    expect(finalState.attemptCount).toBe(1);
    // The admission stays unconsumed: resume is re-entry, not a new start.
    expect(finalState.admissionConsumedAt).toBeNull();
    expect(finalState.auditActions).toEqual([]);
  }, 30_000);

  /**
   * I4 guard — the restore path: a COMMITTED disrupted attempt blocks close
   * (disrupted is an unresolved status), and start restores it through the
   * production disruption machinery without creating a new row. Passes on
   * master; pins non-regression.
   */
  it("I4 restore guard: committed disrupted attempt blocks close; start restores the same attempt", async () => {
    const f = await buildFixture(db1, DIM_UNTIMED_QUEUE);
    const now = new Date();
    const startedAt = new Date(now.getTime() - 120_000);
    const attemptId = crypto.randomUUID();
    await db1.insert(schema.examAttempts).values({
      id: attemptId,
      organizationId: f.organizationId,
      examId: f.examId,
      enrollmentId: f.enrollmentId,
      candidateId: f.candidateId,
      attemptNo: 1,
      status: "in_progress",
      questionSnapshot: singleChoiceSnapshot(crypto.randomUUID()),
      answers: [],
      startedAt,
      lastActivityAt: new Date(now.getTime() - 60_000),
      createdAt: startedAt,
      updatedAt: startedAt,
    });
    // The seeded attempt No.1 was created out of band; the durable counter
    // must reflect it exactly as the real start path would have left it.
    await db1
      .update(schema.examEnrollments)
      .set({ attemptCount: 1, updatedAt: now })
      .where(eq(schema.examEnrollments.id, f.enrollmentId));
    // Produce the disrupted state through the PRODUCTION disrupt command so
    // the episode + detected event exist exactly as the scanner leaves them.
    await executeInTransaction(db1, async (tx) => {
      const { attempts } = createExamEngineRepos(
        {
          examRepo: createExamRepo(tx),
          attemptRepo: createAttemptRepo(tx),
          enrollmentRepo: createEnrollmentRepo(tx),
        },
        f.ctx,
      );
      const episodeRepo = createInterruptionEpisodeRepoAdapter(
        createAttemptInterruptionRepo(tx),
        f.ctx,
      );
      const eventRepo = createInterruptionEventRepoAdapter(
        createAttemptInterruptionEventRepo(tx),
        f.ctx,
      );
      const result = await markDisrupted(
        attempts,
        episodeRepo,
        eventRepo,
        attemptId,
        now,
        10,
      );
      expect(result.outcome).toBe("marked");
    });

    const closeNow = new Date();
    const b = await adminTransitionComposition(
      db2,
      f.adminCtx,
      f.examId,
      closeNow,
      "close",
      "restore-guard",
    );
    expect(b.ok).toBe(false);
    if (!b.ok) {
      expect(errorSignature(b.error).reason).toBe("UNRESOLVED_ATTEMPTS_EXIST");
    }

    const a = await startComposition(db1, f.ctx, f, new Date(), undefined);
    expect(a.ok).toBe(true);
    if (a.ok) {
      expect(a.isNew).toBe(false);
      expect(a.attemptId).toBe(attemptId);
    }

    const finalState = await readFinalState(observerSql, f);
    expect(finalState.examStatus).toBe("open");
    expect(finalState.attempts).toHaveLength(1);
    expect(finalState.attempts[0]!.status).toBe("in_progress");
    expect(finalState.attemptCount).toBe(1);
    expect(finalState.admissionConsumedAt).toBeNull();
    expect(finalState.auditActions).toEqual([]);
  }, 30_000);
});
