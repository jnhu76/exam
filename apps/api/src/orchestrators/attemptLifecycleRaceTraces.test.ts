/**
 * EXAM-341 — bounded deterministic attempt-lifecycle traces.
 *
 * A named, replayable schedule drives TWO real racing transactions against
 * real PostgreSQL through the canonical attempt composition seams (the SAME
 * engine commands and lock/preparation seams the routes compose), with the
 * controller fixing the interleaving via deferred gates — never sleeps. The
 * attempt lifecycle serializes every mutation on the Enrollment→Attempt row
 * lock inside one REPEATABLE READ transaction with 40001/40P01 auto-retry
 * (executeInTransaction), so PostgreSQL — not an in-memory simulator — is the
 * oracle for every ordering asserted here.
 *
 * The gate/once plumbing reuses the existing test-only barrier primitives
 * (testing/barrier.ts, onceAsync from the proctor-assignment harness). The
 * compositions below are the documented caller role of each seam (save route:
 * attempts.candidate.ts; submit: submitAndGradeAttempt.ts; deadline freeze:
 * the scanner's ensureAttemptDeadlineReconciled composition) — no production
 * code is gated or changed.
 *
 * Each trace runs REPLAYS times with a fresh attempt fixture per repetition;
 * a repetition that lands in any other ordering fails the trace. Fixed
 * timestamps only — ordering is controlled exclusively by the gates.
 *
 * Traces:
 *   S1A_SAVE_WINS     — a save that acquires the row lock before submit is
 *                       the answer set grading freezes (freeze-barrier
 *                       consistency under the save-wins ordering).
 *   S1B_SUBMIT_WINS   — a save whose read snapshot predates the submit commit
 *                       resumes after terminalization and must be rejected by
 *                       the answer protocol without mutating terminal truth.
 *   S2_DEADLINE_FIRST — deadline finalization commits while an explicit
 *                       submit is blocked on the row lock; the submit
 *                       converges on the one deadline-freeze.
 *   S3_DOUBLE_SUBMIT  — two concurrent submit deliveries produce one
 *                       semantic grading effect; the loser converges.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  AnswerRecord,
  QuestionSnapshot,
  RequestContext,
} from "@exam/domain";
import { NotFoundError } from "@exam/domain";
import { createAttemptRepo } from "@exam/db/src/repository/attemptRepo.js";
import { createCandidateRepo } from "@exam/db/src/repository/candidateRepo.js";
import { createExamRepo } from "@exam/db/src/repository/examRepo.js";
import { createEnrollmentRepo } from "@exam/db/src/repository/enrollmentRepo.js";
import { createAttemptGradingEntryRepo } from "@exam/db/src/repository/attemptGradingEntryRepo.js";
import { createAttemptInterruptionRepo } from "@exam/db/src/repository/attemptInterruptionRepo.js";
import { createAttemptInterruptionEventRepo } from "@exam/db/src/repository/attemptInterruptionEventRepo.js";
import { schema } from "@exam/db/src/schema/pg.js";
import {
  createPostgresDatabase,
  migratePostgres,
} from "@exam/db/src/postgres.js";
import { setupIsolatedTestDb } from "@exam/db/src/testIsolation.js";
import { resolveTestDbUrl } from "@exam/db/src/testDb.js";
import { withTestInfraLifecycleLock } from "@exam/db/src/testInfraLock.js";
import {
  executeInTransaction,
  type TransactionDatabase,
} from "@exam/db/src/types.js";
import type { Database } from "@exam/db/src/types.js";
import {
  ensureAttemptDeadlineReconciled,
  finalizeGrading,
  lockEnrollmentAndAttempt,
  prepareReconciledAttemptMutation,
  readGradingSnapshot,
  saveAnswer,
  submitAttempt,
} from "@exam/exam-engine";
import type {
  GradingWorksetRepository,
  SubmitInterruptionResolution,
} from "@exam/exam-engine";
import { submitAndGradeAttempt } from "./submitAndGradeAttempt.js";
import {
  createExamEngineRepos,
  createGradingWorksetRepoAdapter,
  createInterruptionEpisodeRepoAdapter,
  createInterruptionEventRepoAdapter,
} from "../adapters/repoAdapters.js";
import { validateAnswerForQuestion } from "../lib/validateAnswerForQuestion.js";
import { createDeferred } from "../testing/barrier.js";
import { onceAsync } from "../testing/proctorAssignmentConcurrencyHarness.js";

// ── Fixed trace timeline (ADR-006: no wall-clock reads) ────────────────────

const T0 = new Date("2026-01-01T00:00:00.000Z"); // org/user/course/exam stamps
const STARTED_AT = new Date("2026-02-01T00:00:00.000Z"); // attempt start
const DEADLINE_AT = new Date("2026-02-01T01:00:00.000Z"); // personal deadline
const TRACE_NOW = new Date("2026-02-01T00:30:00.000Z"); // mid-exam instant
const PAST_DEADLINE_NOW = new Date("2026-02-01T02:00:00.000Z"); // expired

const REPLAYS = 10;

function context(organizationId: string, actorId: string): RequestContext {
  return {
    actorId,
    organizationId,
    role: "Candidate",
    permissions: [],
    sessionId: randomUUID(),
  };
}

// ── Race env: two physical racing pools + one setup/assertion pool ─────────

describe("attempt lifecycle deterministic race traces (EXAM-341)", () => {
  let db1: Database;
  let db2: Database;
  let db: Database;
  let sql1: { end(): Promise<void> };
  let sql2: { end(): Promise<void> };
  let sqlSetup: { end(): Promise<void> };
  let cleanup: () => Promise<void>;
  let organizationId: string;
  let candidateUserId: string;
  let candidateProfileId: string;
  let ctx: RequestContext;

  beforeAll(async () => {
    const iso = await setupIsolatedTestDb({
      namespace: "attempt-lifecycle-race-traces",
      databaseUrl: resolveTestDbUrl(),
    });
    const conn1 = await createPostgresDatabase(iso.databaseUrl, iso.schemaName);
    const conn2 = await createPostgresDatabase(iso.databaseUrl, iso.schemaName);
    const connSetup = await createPostgresDatabase(
      iso.databaseUrl,
      iso.schemaName,
    );
    db1 = conn1.db;
    db2 = conn2.db;
    db = connSetup.db;
    sql1 = conn1.sql;
    sql2 = conn2.sql;
    sqlSetup = connSetup.sql;

    await withTestInfraLifecycleLock(iso.databaseUrl, () =>
      migratePostgres(connSetup.db, { migrationsSchema: iso.schemaName }),
    );

    organizationId = randomUUID();
    candidateUserId = randomUUID();
    ctx = context(organizationId, candidateUserId);
    await db.insert(schema.organizations).values({
      id: organizationId,
      name: "Org traces",
      displayName: "Org traces",
      slug: `org-traces-${organizationId}`,
      createdAt: T0,
      updatedAt: T0,
    });
    await db.insert(schema.users).values({
      id: candidateUserId,
      organizationId,
      username: `cand-${candidateUserId}`,
      passwordHash: "hash",
      name: "Candidate",
      role: "Candidate",
      isActive: true,
      createdAt: T0,
      updatedAt: T0,
    });
    const profileId = randomUUID();
    await db
      .insert(schema.candidateProfiles)
      .values({
        id: profileId,
        organizationId,
        userId: candidateUserId,
        fields: {},
        createdAt: T0,
        updatedAt: T0,
      })
      .returning({ id: schema.candidateProfiles.id });
    candidateProfileId = profileId;

    cleanup = async () => {
      const errors: unknown[] = [];
      for (const step of [
        () => sql1.end(),
        () => sql2.end(),
        () => sqlSetup.end(),
        () => iso.cleanup(),
      ]) {
        try {
          await step();
        } catch (err) {
          errors.push(err);
        }
      }
      if (errors.length > 0) {
        throw new Error(`teardown failed: ${errors.map(String).join(" | ")}`);
      }
    };
  }, 60_000);

  afterAll(async () => {
    await cleanup();
  }, 30_000);

  // ── Fixture: one fresh exam + enrollment + in-progress attempt ───────────

  const QUESTION_ID = "q-trace";
  const CORRECT = "a";
  const WRONG = "b";

  function makeQuestionSnapshot(): QuestionSnapshot[] {
    return [
      {
        originalQuestionId: QUESTION_ID,
        type: "single_choice",
        content: "Trace question",
        contentDocument: null,
        answerMode: null,
        attachments: [],
        options: [
          { id: "a", content: "A" },
          { id: "b", content: "B" },
        ],
        standardAnswer: CORRECT,
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

  /**
   * Fresh (exam, enrollment, attempt) triple — no state shared across
   * traces or replays. `deadlinePassed` shifts the personal deadline into
   * the past relative to PAST_DEADLINE_NOW for the deadline traces.
   */
  async function newAttemptFixture(suffix: string, deadlinePassed: boolean) {
    const courseId = randomUUID();
    const examId = randomUUID();
    const enrollmentId = randomUUID();
    const attemptId = randomUUID();
    const snapshot = makeQuestionSnapshot();
    const personalDeadline = deadlinePassed
      ? new Date(STARTED_AT.getTime() + 60_000)
      : DEADLINE_AT;

    await db.insert(schema.courses).values({
      id: courseId,
      organizationId,
      name: `Course ${suffix}`,
      code: `TC-${suffix}-${courseId}`,
      description: "",
      createdAt: T0,
      updatedAt: T0,
    });
    await db.insert(schema.exams).values({
      id: examId,
      organizationId,
      title: `Exam ${suffix}`,
      description: "",
      courseId,
      status: "open",
      timingMode: "timed_window",
      durationMinutes: 60,
      openAt: T0,
      closeAt: new Date("2026-06-01T00:00:00.000Z"),
      passingScore: 60,
      totalScore: 100,
      questionSelectionMode: "manual",
      questionIds: [QUESTION_ID],
      questionSnapshot: snapshot,
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
      createdAt: T0,
      updatedAt: T0,
    });
    await db.insert(schema.examEnrollments).values({
      id: enrollmentId,
      organizationId,
      examId,
      candidateId: candidateProfileId,
      status: "started",
      attemptCount: 1,
      createdAt: T0,
      updatedAt: T0,
    });
    await db.insert(schema.examAttempts).values({
      id: attemptId,
      organizationId,
      examId,
      enrollmentId,
      candidateId: candidateProfileId,
      attemptNo: 1,
      status: "in_progress",
      questionSnapshot: snapshot,
      // The draft-answer JSONB carries the protocol idempotency receipts
      // (clientSeq/clientSeqHistory) alongside the declared AnswerRecord
      // shape — same widening the engine's applyAcceptedResult persists.
      answers: [
        {
          questionId: QUESTION_ID,
          answer: CORRECT,
          version: 1,
          savedAt: STARTED_AT,
          clientSeq: 1,
          clientSeqHistory: [],
        },
      ] as unknown as AnswerRecord[],
      startedAt: STARTED_AT,
      deadlineAt: personalDeadline,
      lastActivityAt: STARTED_AT,
      createdAt: T0,
      updatedAt: T0,
    });
    return { examId, enrollmentId, attemptId, personalDeadline };
  }

  // ── Canonical compositions (the documented caller role of each seam) ─────

  interface TxRepos {
    exams: ReturnType<typeof createExamEngineRepos>["exams"];
    enrollments: ReturnType<typeof createExamEngineRepos>["enrollments"];
    attempts: ReturnType<typeof createExamEngineRepos>["attempts"];
    gradingWorkset: GradingWorksetRepository;
    episodeRepo: ReturnType<typeof createInterruptionEpisodeRepoAdapter>;
    eventRepo: ReturnType<typeof createInterruptionEventRepoAdapter>;
  }

  function buildTxRepos(tx: TransactionDatabase): TxRepos {
    const { exams, enrollments, attempts } = createExamEngineRepos(
      {
        examRepo: createExamRepo(tx),
        attemptRepo: createAttemptRepo(tx),
        enrollmentRepo: createEnrollmentRepo(tx),
      },
      ctx,
    );
    return {
      exams,
      enrollments,
      attempts,
      gradingWorkset: createGradingWorksetRepoAdapter(
        createAttemptGradingEntryRepo(tx),
        ctx,
      ),
      episodeRepo: createInterruptionEpisodeRepoAdapter(
        createAttemptInterruptionRepo(tx),
        ctx,
      ),
      eventRepo: createInterruptionEventRepoAdapter(
        createAttemptInterruptionEventRepo(tx),
        ctx,
      ),
    };
  }

  /** Mirrors the route's resolution construction for the given attempt status. */
  function buildResolution(
    repos: TxRepos,
    status: string | null,
  ): SubmitInterruptionResolution {
    if (status === "disrupted") {
      return {
        mode: "active_interruption",
        episodeRepo: repos.episodeRepo,
        eventRepo: repos.eventRepo,
        hint: {
          policy: "strict",
          eligibleSeconds: null,
          adjustmentId: null,
          reasonCode: "candidate_submit_terminalization",
        },
      };
    }
    return {
      mode: "none",
      episodeRepo: repos.episodeRepo,
      eventRepo: repos.eventRepo,
    };
  }

  /**
   * Save racer — composes the save route's canonical body
   * (attempts.candidate.ts): candidate lookup → EA lock → preparation seam →
   * engine saveAnswer. `beforeLock` (optional) runs inside the tx BEFORE the
   * EA lock seam — used by S1B to park the racer after its REPEATABLE READ
   * snapshot exists but before it requests the row lock.
   * `afterSave` (optional) parks the racer after saveAnswer returned but
   * before commit — used by S1A to hold the row lock with the save landed.
   */
  function saveRacer(
    racerDb: Database,
    args: {
      attemptId: string;
      answer: string;
      clientSeq: number;
      baseVersion: number;
      now: Date;
      beforeLock?: () => Promise<void>;
      afterSave?: () => Promise<void>;
    },
  ) {
    const attemptId = args.attemptId;
    return executeInTransaction(racerDb, async (tx) => {
      const candidateProfile = await createCandidateRepo(tx).findByUserId(
        ctx,
        ctx.actorId,
      );
      if (!candidateProfile) {
        throw new NotFoundError("候选人资料不存在");
      }
      const repos = buildTxRepos(tx);
      if (args.beforeLock) {
        await args.beforeLock();
      }
      const cap = await lockEnrollmentAndAttempt(
        repos.enrollments,
        repos.attempts,
        attemptId,
      );
      const preAttempt = await repos.attempts.findById(attemptId);
      const resolution = buildResolution(repos, preAttempt?.status ?? null);
      const { attempt: currentAttempt, mutationContext } =
        await prepareReconciledAttemptMutation(
          repos.exams,
          repos.enrollments,
          repos.attempts,
          repos.gradingWorkset,
          cap,
          args.now,
          resolution,
        );
      if (currentAttempt.candidateId !== candidateProfile.id) {
        throw new NotFoundError("尝试不存在");
      }
      const saved = await saveAnswer(
        repos.attempts,
        mutationContext,
        {
          attemptId,
          questionId: QUESTION_ID,
          answer: args.answer,
          clientSeq: args.clientSeq,
          clientSavedAt: args.now.toISOString(),
          baseVersion: args.baseVersion,
        },
        validateAnswerForQuestion,
      );
      if (args.afterSave) {
        await args.afterSave();
      }
      return saved;
    });
  }

  /**
   * Deadline-freeze racer — the scanner/route reconciliation composition:
   * EA lock → canonical lazy deadline reconciliation → hold before commit.
   */
  function deadlineFreezeRacer(
    racerDb: Database,
    args: { attemptId: string; now: Date; hold: () => Promise<void> },
  ) {
    const attemptId = args.attemptId;
    return executeInTransaction(racerDb, async (tx) => {
      const repos = buildTxRepos(tx);
      const cap = await lockEnrollmentAndAttempt(
        repos.enrollments,
        repos.attempts,
        attemptId,
      );
      const attempt = await repos.attempts.findById(attemptId);
      const resolution = buildResolution(repos, attempt?.status ?? null);
      await ensureAttemptDeadlineReconciled(
        repos.exams,
        repos.enrollments,
        repos.attempts,
        repos.gradingWorkset,
        cap,
        args.now,
        resolution,
      );
      await args.hold();
    });
  }

  /**
   * Gated submit racer — mirrors the submitAndGradeAttempt orchestrator body
   * (lock → lazy reconciliation → submitAttempt → grading snapshot →
   * finalize) with a controller hold before commit. Only used for the racer
   * that must pause mid-flight; the racing racer always runs the REAL
   * orchestrator unchanged.
   */
  function gatedSubmitRacer(
    racerDb: Database,
    args: { attemptId: string; now: Date; hold: () => Promise<void> },
  ) {
    const attemptId = args.attemptId;
    return executeInTransaction(racerDb, async (tx) => {
      const repos = buildTxRepos(tx);
      const cap = await lockEnrollmentAndAttempt(
        repos.enrollments,
        repos.attempts,
        attemptId,
      );
      const lockedAttempt = await repos.attempts.findById(attemptId);
      if (!lockedAttempt) {
        throw new NotFoundError("Attempt not found");
      }
      let currentStatus = lockedAttempt.status;
      if (currentStatus === "in_progress" || currentStatus === "disrupted") {
        const reconciled = await ensureAttemptDeadlineReconciled(
          repos.exams,
          repos.enrollments,
          repos.attempts,
          repos.gradingWorkset,
          cap,
          args.now,
          buildResolution(repos, currentStatus),
        );
        const reconciledStatus = reconciled.status;
        if (
          reconciledStatus === "graded" ||
          reconciledStatus === "submitted" ||
          reconciledStatus === "grading"
        ) {
          await args.hold();
          return;
        }
        currentStatus = reconciledStatus;
      }
      if (currentStatus === "in_progress" || currentStatus === "disrupted") {
        await submitAttempt(
          repos.attempts,
          repos.gradingWorkset,
          attemptId,
          args.now,
          {
            source: "candidate",
            minSubmitAfterStartMinutes: null,
            resolution: buildResolution(repos, currentStatus),
          },
        );
      }
      const postSubmit = await repos.attempts.findByIdForUpdate(attemptId);
      if (!postSubmit) {
        throw new NotFoundError("Attempt not found after submit");
      }
      if (postSubmit.gradingStatus === "pending_manual") {
        await args.hold();
        return;
      }
      const snapshot = await readGradingSnapshot(
        repos.exams,
        repos.enrollments,
        repos.attempts,
        attemptId,
      );
      if (!snapshot) {
        throw new NotFoundError("Attempt not found after submit");
      }
      await finalizeGrading(
        repos.enrollments,
        repos.attempts,
        repos.gradingWorkset,
        cap,
        snapshot.exam,
        args.now,
      );
      await args.hold();
    });
  }

  // ── Assertion helpers ─────────────────────────────────────────────────────

  async function readAttemptRow(traceId: string, attemptId: string) {
    const rows = await db
      .select()
      .from(schema.examAttempts)
      .where(eq(schema.examAttempts.id, attemptId));
    if (rows.length !== 1) {
      throw new Error(
        `[${traceId}] expected exactly one attempt row, got ${rows.length}`,
      );
    }
    return rows[0]!;
  }

  async function countGradingEntries(traceId: string, attemptId: string) {
    const rows = await db
      .select({ id: schema.attemptGradingEntries.id })
      .from(schema.attemptGradingEntries)
      .where(eq(schema.attemptGradingEntries.attemptId, attemptId));
    if (rows.length !== 1) {
      throw new Error(
        `[${traceId}] expected exactly one grading workset, got ${rows.length}`,
      );
    }
  }

  /** Paired gate: the racer signals `entered`, then parks on `hold`. */
  function makeGate(label: string) {
    const entered = createDeferred<void>(`${label} entered`);
    const hold = createDeferred<void>(`${label} hold`);
    let signalled = false;
    return {
      entered: entered.promise,
      release: () => hold.resolve(undefined as never),
      dispose: (reason: string) => {
        if (!entered.isSettled()) entered.resolve(reason as never);
        if (!hold.isSettled()) hold.resolve(reason as never);
      },
      gate: async () => {
        if (!signalled) {
          signalled = true;
          entered.resolve(undefined as never);
        }
        await hold.promise;
      },
    };
  }

  // ── Traces ────────────────────────────────────────────────────────────────

  it(
    "TRACE S1A_SAVE_WINS: a save holding the row lock commits first and its " +
      "answer is what grading freezes (10 deterministic replays)",
    async () => {
      for (let i = 0; i < REPLAYS; i++) {
        const traceId = `S1A_SAVE_WINS#${i}`;
        const { attemptId } = await newAttemptFixture(`s1a-${i}`, false);
        const gate = makeGate(traceId);

        // 1. Save racer runs, lands its write, parks pre-commit holding the
        //    attempt row lock.
        const savePromise = saveRacer(db1, {
          attemptId,
          answer: WRONG,
          clientSeq: 2,
          baseVersion: 1,
          now: TRACE_NOW,
          afterSave: gate.gate,
        });
        await gate.entered;

        // 2. Submit racer fires — deterministically blocks on the EA lock
        //    (racer 1 holds it) until the save commits.
        const submitPromise = submitAndGradeAttempt(
          db2,
          ctx,
          attemptId,
          candidateProfileId,
          TRACE_NOW,
        );

        // 3. Release the save; both racers settle.
        gate.release();
        const saved = await savePromise;
        const submit = await submitPromise;
        gate.dispose("settled");

        // 4. Observe authoritative state: the save-wins ordering must grade
        //    the racing save's answer (freeze-barrier consistency, J1).
        if (!saved.accepted) {
          throw new Error(
            `[${traceId}] save should win the lock and be accepted, got ` +
              `conflict ${JSON.stringify(saved.conflict)}`,
          );
        }
        expect(submit.alreadyGraded).toBe(false);
        expect(submit.attempt.status).toBe("graded");
        const row = await readAttemptRow(traceId, attemptId);
        expect(row.submissionReason).toBe("manual");
        const draft = (row.answers as AnswerRecord[])[0]!;
        expect(draft.answer).toBe(WRONG);
        expect(draft.version).toBe(2);
        const frozen = row.submittedAnswers as {
          answers: Array<{ questionId: string; value: unknown }>;
        };
        expect(frozen.answers[0]!.value).toBe(WRONG);
        expect(row.score).toBe(0); // WRONG answer → 0, consistent with freeze
        expect(row.passed).toBe(false);
        await countGradingEntries(traceId, attemptId);
      }
    },
    60_000,
  );

  it(
    "TRACE S1B_SUBMIT_WINS: a save whose snapshot predates the submit commit " +
      "resumes after terminalization and is rejected without mutating " +
      "terminal truth (10 deterministic replays)",
    async () => {
      for (let i = 0; i < REPLAYS; i++) {
        const traceId = `S1B_SUBMIT_WINS#${i}`;
        const { attemptId } = await newAttemptFixture(`s1b-${i}`, false);

        // Park the save racer after its REPEATABLE READ snapshot exists (the
        // locator read inside the lock seam) but BEFORE it requests the
        // enrollment row lock. onceAsync keeps the park one-shot so the
        // 40001 auto-retry pass is never re-gated.
        const snapshotTaken = createDeferred<void>(`${traceId} snapshot taken`);
        const releaseSave = createDeferred<void>(`${traceId} release save`);
        const parkOnce = onceAsync(async () => {
          snapshotTaken.resolve(undefined as never);
          await releaseSave.promise;
        });

        // 1. Save racer starts, takes its snapshot, parks lock-free.
        const savePromise = saveRacer(db1, {
          attemptId,
          answer: WRONG,
          clientSeq: 2,
          baseVersion: 1,
          now: TRACE_NOW,
          beforeLock: parkOnce,
        });
        await snapshotTaken.promise;

        // 2. Submit racer (real orchestrator, unchanged) runs to commit —
        //    nothing blocks it (the parked save holds no lock).
        const submit = await submitAndGradeAttempt(
          db2,
          ctx,
          attemptId,
          candidateProfileId,
          TRACE_NOW,
        );

        // 3. Release the save: it resumes after terminalization. Its
        //    pre-commit snapshot makes the row locks conflict (40001) and
        //    executeInTransaction retries into the committed terminal state.
        releaseSave.resolve(undefined as never);
        const saved = await savePromise;

        // 4. Observe: late save rejected by protocol, terminal truth intact.
        expect(submit.attempt.status).toBe("graded");
        if (saved.accepted) {
          throw new Error(
            `[${traceId}] late save must be rejected after terminalization, ` +
              `got accepted with serverVersion ${saved.serverVersion}`,
          );
        }
        expect(saved.conflict?.reason).toBe("ATTEMPT_ALREADY_SUBMITTED");
        const row = await readAttemptRow(traceId, attemptId);
        expect(row.status).toBe("graded");
        expect(row.score).toBe(100); // frozen CORRECT answer, untouched
        expect(row.passed).toBe(true);
        const draft = (row.answers as AnswerRecord[])[0]!;
        expect(draft.answer).toBe(CORRECT); // no draft mutation post-freeze
        expect(draft.version).toBe(1);
        const frozen = row.submittedAnswers as {
          answers: Array<{ questionId: string; value: unknown }>;
        };
        expect(frozen.answers[0]!.value).toBe(CORRECT);
        await countGradingEntries(traceId, attemptId);
      }
    },
    60_000,
  );

  it(
    "TRACE S2_DEADLINE_FIRST: deadline finalization commits while an explicit " +
      "submit is blocked; the submit converges on the one deadline-freeze " +
      "(10 deterministic replays)",
    async () => {
      for (let i = 0; i < REPLAYS; i++) {
        const traceId = `S2_DEADLINE_FIRST#${i}`;
        // deadlinePassed: personal deadline = STARTED_AT+60s, long past
        // PAST_DEADLINE_NOW; effectiveDeadline = that past deadline.
        const { attemptId, personalDeadline } = await newAttemptFixture(
          `s2-${i}`,
          true,
        );

        const gate = makeGate(traceId);
        // 1. Deadline racer freezes + grades, parks pre-commit holding the
        //    attempt row lock.
        const deadlinePromise = deadlineFreezeRacer(db1, {
          attemptId,
          now: PAST_DEADLINE_NOW,
          hold: gate.gate,
        });
        await gate.entered;

        // 2. Explicit submit (real orchestrator) fires — blocks on the EA
        //    lock until the deadline freeze commits.
        const submitPromise = submitAndGradeAttempt(
          db2,
          ctx,
          attemptId,
          candidateProfileId,
          PAST_DEADLINE_NOW,
        );

        // 3. Release; both racers settle.
        gate.release();
        await deadlinePromise;
        const submit = await submitPromise;
        gate.dispose("settled");

        // 4. Observe: exactly one deadline-freeze; the submit converged.
        expect(submit.alreadyGraded).toBe(true);
        const row = await readAttemptRow(traceId, attemptId);
        expect(row.status).toBe("graded");
        expect(row.submissionReason).toBe("deadline");
        expect(row.submittedAt?.getTime()).toBe(personalDeadline.getTime());
        expect(row.score).toBe(100);
        await countGradingEntries(traceId, attemptId);
      }
    },
    60_000,
  );

  it(
    "TRACE S3_DOUBLE_SUBMIT: two concurrent submit deliveries produce one " +
      "grading effect and the loser converges idempotently " +
      "(10 deterministic replays)",
    async () => {
      for (let i = 0; i < REPLAYS; i++) {
        const traceId = `S3_DOUBLE_SUBMIT#${i}`;
        const { attemptId } = await newAttemptFixture(`s3-${i}`, false);

        const gate = makeGate(traceId);
        // 1. First submit parks pre-commit holding the attempt row lock.
        const firstPromise = gatedSubmitRacer(db1, {
          attemptId,
          now: TRACE_NOW,
          hold: gate.gate,
        });
        await gate.entered;

        // 2. Second submit (real orchestrator) fires — blocks until the
        //    first commits.
        const secondPromise = submitAndGradeAttempt(
          db2,
          ctx,
          attemptId,
          candidateProfileId,
          TRACE_NOW,
        );

        // 3. Release; both racers settle.
        gate.release();
        await firstPromise;
        const second = await secondPromise;
        gate.dispose("settled");

        // 4. Observe: one semantic effect; duplicate delivery converged.
        expect(second.alreadyGraded).toBe(true);
        const row = await readAttemptRow(traceId, attemptId);
        expect(row.status).toBe("graded");
        expect(row.submissionReason).toBe("manual");
        expect(row.submittedAt?.getTime()).toBe(TRACE_NOW.getTime());
        expect(row.score).toBe(100);
        await countGradingEntries(traceId, attemptId);
      }
    },
    60_000,
  );
});
