import { describe, expect, it } from "vitest";
import {
  computeBatchRelease,
  deriveAdmissionState,
  joinAdmissionQueue,
  reconcileAdmission,
  previewAdmissionStatus,
  ensureStartAdmission,
  type AdmissionDeps,
  type AdmissionQueueView,
  type AdmissionState,
  type ExamAdmissionRecord,
  type ExamAdmissionRepository,
} from "./admissionCommands.js";
import { startOrRestoreAttempt } from "./attemptCommands.js";
import { QueueAdmissionRequiredError, ValidationError } from "@exam/domain";
import type { Exam, ExamAttempt } from "@exam/domain";
import {
  makeExam,
  makeEnrollment,
  makeExamRepo,
  makeEnrollmentRepo,
} from "./attemptMutation.testHelpers.js";
import type {
  AttemptRepository,
  EnrollmentRepository,
} from "./attemptCommands.js";

/** In-memory admission store reproducing the DB contract for unit tests. */
function makeAdmissionRepo(
  rows: ExamAdmissionRecord[] = [],
): ExamAdmissionRepository & { rows: ExamAdmissionRecord[] } {
  const store = rows;
  return {
    rows: store,
    async joinActive(input) {
      const existing = store.find(
        (r) =>
          r.organizationId === input.organizationId &&
          r.examId === input.examId &&
          r.candidateId === input.candidateId &&
          r.consumedAt === null,
      );
      if (existing) return existing;
      const row: ExamAdmissionRecord = {
        id: `adm-${store.length + 1}`,
        organizationId: input.organizationId,
        examId: input.examId,
        candidateId: input.candidateId,
        joinedAt: input.joinedAt,
        admittedAt: null,
        consumedAt: null,
        consumedAttemptId: null,
      };
      store.push(row);
      return row;
    },
    async findActive(organizationId, examId, candidateId) {
      return (
        store.find(
          (r) =>
            r.organizationId === organizationId &&
            r.examId === examId &&
            r.candidateId === candidateId &&
            r.consumedAt === null,
        ) ?? null
      );
    },
    async earliestJoinedAt(organizationId, examId) {
      const rows = store.filter(
        (r) => r.organizationId === organizationId && r.examId === examId,
      );
      if (rows.length === 0) return null;
      return rows.reduce(
        (min, r) => (r.joinedAt < min ? r.joinedAt : min),
        rows[0]!.joinedAt,
      );
    },
    async countAllAhead(organizationId, examId, joinedAt, id) {
      return store.filter(
        (r) =>
          r.organizationId === organizationId &&
          r.examId === examId &&
          (r.joinedAt < joinedAt ||
            (r.joinedAt.getTime() === joinedAt.getTime() && r.id < id)),
      ).length;
    },
    async countActiveAhead(organizationId, examId, joinedAt, id) {
      return store.filter(
        (r) =>
          r.organizationId === organizationId &&
          r.examId === examId &&
          r.consumedAt === null &&
          (r.joinedAt < joinedAt ||
            (r.joinedAt.getTime() === joinedAt.getTime() && r.id < id)),
      ).length;
    },
    async admitOnce(id, admittedAt) {
      const row = store.find((r) => r.id === id);
      if (!row || row.admittedAt !== null) return null;
      row.admittedAt = admittedAt;
      return row;
    },
    async consumeActive(
      organizationId,
      examId,
      candidateId,
      consumedAt,
      attemptId,
    ) {
      const row = store.find(
        (r) =>
          r.organizationId === organizationId &&
          r.examId === examId &&
          r.candidateId === candidateId &&
          r.consumedAt === null,
      );
      if (!row) return null;
      row.consumedAt = consumedAt;
      row.consumedAttemptId = attemptId;
      return row;
    },
    async listByExam(organizationId, examId) {
      return store.filter(
        (r) => r.organizationId === organizationId && r.examId === examId,
      );
    },
  };
}

// Inside the makeExam open window (2025-01-01T09:00Z .. 12:00Z).
const T0 = new Date("2025-01-01T09:30:00.000Z");

const ACTIVE_ATTEMPT = {
  id: "attempt-active",
  organizationId: "org-1",
  examId: "exam-1",
  enrollmentId: "enr-1",
  candidateId: "cand-1",
  attemptNo: 1,
  status: "in_progress",
  questionSnapshot: [],
  answers: [],
  startedAt: T0,
  deadlineAt: null,
  submittedAt: null,
  gradedAt: null,
  lastActivityAt: T0,
  misconduct: null,
  gradingStatus: "auto_graded",
  submittedAnswers: null,
  submissionReason: null,
  currentInterruptionId: null,
  interruptedAt: null,
  createdAt: T0,
  updatedAt: T0,
} as unknown as ExamAttempt;
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

function requireQueueExam(
  overrides: {
    batchSize?: number;
    batchInterval?: number;
  } = {},
): Exam {
  return makeExam({
    controlFlags: {
      shuffleQuestions: false,
      shuffleOptions: false,
      detectTabSwitch: false,
      disableCopyPaste: false,
      requireQueue: true,
      batchSize: overrides.batchSize ?? 2,
      batchInterval: overrides.batchInterval ?? 30,
      restrictIp: false,
      requireLockdown: false,
      showResultImmediately: true,
    },
  });
}

describe("computeBatchRelease (pure schedule math)", () => {
  it("releases nothing without an anchor", () => {
    expect(
      computeBatchRelease({
        anchor: null,
        now: at(1000),
        batchSize: 10,
        batchIntervalSeconds: 3,
      }),
    ).toEqual({ releasedBatches: 0, releasedCount: 0 });
  });

  it("releases the FIRST batch at the anchor instant (elapsed 0)", () => {
    expect(
      computeBatchRelease({
        anchor: T0,
        now: T0,
        batchSize: 10,
        batchIntervalSeconds: 3,
      }),
    ).toEqual({ releasedBatches: 1, releasedCount: 10 });
  });

  it("advances one batch per interval", () => {
    expect(
      computeBatchRelease({
        anchor: T0,
        now: at(2 * 30),
        batchSize: 2,
        batchIntervalSeconds: 30,
      }),
    ).toEqual({ releasedBatches: 3, releasedCount: 6 });
  });

  it("releases underfilled batches on schedule (count-independent)", () => {
    const released = computeBatchRelease({
      anchor: T0,
      now: at(5 * 30),
      batchSize: 50,
      batchIntervalSeconds: 30,
    });
    expect(released.releasedCount).toBe(300);
  });
});

describe("deriveAdmissionState", () => {
  it("derives waiting / admitted / consumed from timestamps only", () => {
    const state = (
      admittedAt: Date | null,
      consumedAt: Date | null,
    ): AdmissionState => deriveAdmissionState({ admittedAt, consumedAt });
    expect(state(null, null)).toBe("waiting");
    expect(state(at(1), null)).toBe("admitted");
    expect(state(at(1), at(2))).toBe("consumed");
  });
});

describe("joinAdmissionQueue (Q4 idempotency)", () => {
  it("returns the SAME active membership on retried joins", async () => {
    const repo = makeAdmissionRepo();
    const exam = requireQueueExam();
    const first = await joinAdmissionQueue({ repo }, exam, "cand-1", T0);
    const retry = await joinAdmissionQueue({ repo }, exam, "cand-1", at(5));
    expect(retry.id).toBe(first.id);
    expect(retry.joinedAt).toEqual(T0);
    expect(repo.rows).toHaveLength(1);
  });
});

describe("reconcileAdmission (Q5 idempotency + batch eligibility)", () => {
  it("admits the first batchSize joiners immediately", async () => {
    const repo = makeAdmissionRepo();
    const deps: AdmissionDeps = { repo };
    const exam = requireQueueExam({ batchSize: 2, batchInterval: 30 });
    await joinAdmissionQueue(deps, exam, "c1", T0);
    await joinAdmissionQueue(deps, exam, "c2", at(1));
    const c3 = await joinAdmissionQueue(deps, exam, "c3", at(2));

    expect(
      (await reconcileAdmission(deps, exam, "c1", at(3)))!.admittedAt,
    ).not.toBeNull();
    expect(
      (await reconcileAdmission(deps, exam, "c2", at(3)))!.admittedAt,
    ).not.toBeNull();
    expect(
      (await reconcileAdmission(deps, exam, "c3", at(3)))!.admittedAt,
    ).toBeNull();

    // After the second batch releases, c3 becomes eligible.
    expect(
      (await reconcileAdmission(deps, exam, "c3", at(35)))!.admittedAt,
    ).not.toBeNull();
    void c3;
  });

  it("admission is a write-once fact — repeated reconcile never moves admitted_at", async () => {
    const repo = makeAdmissionRepo();
    const deps: AdmissionDeps = { repo };
    const exam = requireQueueExam();
    await joinAdmissionQueue(deps, exam, "c1", T0);
    const first = await reconcileAdmission(deps, exam, "c1", at(1));
    const again = await reconcileAdmission(deps, exam, "c1", at(999));
    expect(again!.admittedAt).toEqual(first!.admittedAt);
  });

  it("returns null for a candidate who never joined (no lazy join)", async () => {
    const repo = makeAdmissionRepo();
    const deps: AdmissionDeps = { repo };
    const exam = requireQueueExam();
    expect(await reconcileAdmission(deps, exam, "ghost", T0)).toBeNull();
    expect(repo.rows).toHaveLength(0);
  });

  it("does not depend on the exam timing mode (Q9 — admission is not time authority)", async () => {
    for (const timingMode of ["timed_window", "deadline", "untimed"] as const) {
      const repo = makeAdmissionRepo();
      const deps: AdmissionDeps = { repo };
      const exam = requireQueueExam({ batchSize: 1, batchInterval: 3600 });
      exam.timingMode = timingMode;
      await joinAdmissionQueue(deps, exam, "c1", T0);
      await reconcileAdmission(deps, exam, "c1", T0);
      const view = await previewAdmissionStatus(deps, exam, "c1", T0);
      expect(view.ready).toBe(true);
      expect(view.position).toBe(1);
    }
  });
});

describe("previewAdmissionStatus (derived position — never stored)", () => {
  it("positions derive from durable (joinedAt, id) order over active rows", async () => {
    const repo = makeAdmissionRepo();
    const deps: AdmissionDeps = { repo };
    const exam = requireQueueExam({ batchSize: 1, batchInterval: 3600 });
    await joinAdmissionQueue(deps, exam, "c1", T0);
    await joinAdmissionQueue(deps, exam, "c2", at(1));
    await joinAdmissionQueue(deps, exam, "c3", at(2));
    await reconcileAdmission(deps, exam, "c1", T0);

    const v1: AdmissionQueueView = await previewAdmissionStatus(
      deps,
      exam,
      "c1",
      at(2),
    );
    const v2 = await previewAdmissionStatus(deps, exam, "c2", at(2));
    const v3 = await previewAdmissionStatus(deps, exam, "c3", at(2));
    expect(v1).toMatchObject({ position: 1, ready: true, state: "admitted" });
    expect(v2).toMatchObject({ position: 2, ready: false, state: "waiting" });
    expect(v3).toMatchObject({ position: 3, ready: false, state: "waiting" });
    expect(v2.estimatedWaitSeconds).toBe(3600);
  });

  it("consumed rows stop counting toward positions (legacy parity: queue shrinks)", async () => {
    const repo = makeAdmissionRepo();
    const deps: AdmissionDeps = { repo };
    const exam = requireQueueExam({ batchSize: 1, batchInterval: 3600 });
    await joinAdmissionQueue(deps, exam, "c1", T0);
    await joinAdmissionQueue(deps, exam, "c2", at(1));
    repo.rows[0]!.consumedAt = at(2);
    repo.rows[0]!.consumedAttemptId = "attempt-1";

    const v2 = await previewAdmissionStatus(deps, exam, "c2", at(2));
    expect(v2.position).toBe(1);
  });
});

describe("batch schedule semantics corrective", () => {
  it("T1 — consumption of predecessor must NOT accelerate release (batchSize=1, interval=30)", async () => {
    const repo = makeAdmissionRepo();
    const deps: AdmissionDeps = { repo };
    const exam = requireQueueExam({ batchSize: 1, batchInterval: 30 });

    await joinAdmissionQueue(deps, exam, "A", T0);
    await joinAdmissionQueue(deps, exam, "B", at(0.1));

    // A is admitted and starts immediately (first batch).
    await reconcileAdmission(deps, exam, "A", at(1));
    await repo.consumeActive(
      exam.organizationId,
      exam.id,
      "A",
      at(1),
      "attempt-A",
    );

    // OLD BUG: with anchor = earliest ACTIVE joined_at, B becomes position 1
    // and the elapsed time from B's join is <30s, yet releasedBatches=1
    // admits B immediately. This must NOT happen.
    const early = await reconcileAdmission(deps, exam, "B", at(2));
    expect(early?.admittedAt).toBeNull();

    const view = await previewAdmissionStatus(deps, exam, "B", at(2));
    expect(view.ready).toBe(false);
    expect(view.state).toBe("waiting");
    expect(view.estimatedWaitSeconds).toBe(30);

    // B's legitimate second-batch boundary is at T0+30s.
    const atBoundary = await reconcileAdmission(deps, exam, "B", at(30));
    expect(atBoundary?.admittedAt).not.toBeNull();
  });

  it("T2 — multiple consumed predecessors must not keep moving C earlier", async () => {
    const repo = makeAdmissionRepo();
    const deps: AdmissionDeps = { repo };
    const exam = requireQueueExam({ batchSize: 1, batchInterval: 30 });

    await joinAdmissionQueue(deps, exam, "A", T0);
    await joinAdmissionQueue(deps, exam, "B", at(0.1));
    await joinAdmissionQueue(deps, exam, "C", at(0.2));

    await reconcileAdmission(deps, exam, "A", at(1));
    await repo.consumeActive(
      exam.organizationId,
      exam.id,
      "A",
      at(1),
      "attempt-A",
    );

    // B's boundary is t0+30; do not let B start before then.
    expect(
      (await reconcileAdmission(deps, exam, "B", at(2)))?.admittedAt,
    ).toBeNull();
    const bAdmitted = await reconcileAdmission(deps, exam, "B", at(30));
    expect(bAdmitted?.admittedAt).not.toBeNull();
    await repo.consumeActive(
      exam.organizationId,
      exam.id,
      "B",
      at(31),
      "attempt-B",
    );

    // C is now the only active candidate but must still wait for batch 3.
    expect(
      (await reconcileAdmission(deps, exam, "C", at(32)))?.admittedAt,
    ).toBeNull();
    expect(
      (await previewAdmissionStatus(deps, exam, "C", at(32)))
        .estimatedWaitSeconds,
    ).toBeGreaterThan(0);
    const cAdmitted = await reconcileAdmission(deps, exam, "C", at(60));
    expect(cAdmitted?.admittedAt).not.toBeNull();
  });

  it("T5 — late join is placed at the next unreleased batch boundary", async () => {
    const repo = makeAdmissionRepo();
    const deps: AdmissionDeps = { repo };
    const exam = requireQueueExam({ batchSize: 2, batchInterval: 30 });

    await joinAdmissionQueue(deps, exam, "A", T0);
    await joinAdmissionQueue(deps, exam, "B", at(1));
    // First batch (A+B) releases at T0.
    await reconcileAdmission(deps, exam, "A", at(2));
    await reconcileAdmission(deps, exam, "B", at(2));

    // C joins after the first batch has already released.
    await joinAdmissionQueue(deps, exam, "C", at(10));
    // C's ordinal is 3 → batch 2 → release at T0+30, not immediately.
    expect(
      (await reconcileAdmission(deps, exam, "C", at(11)))?.admittedAt,
    ).toBeNull();
    expect(
      (await previewAdmissionStatus(deps, exam, "C", at(11)))
        .estimatedWaitSeconds,
    ).toBe(30);

    const cAdmitted = await reconcileAdmission(deps, exam, "C", at(30));
    expect(cAdmitted?.admittedAt).not.toBeNull();
  });

  it("T6 — retake inserts a fresh membership with a new schedule identity", async () => {
    const repo = makeAdmissionRepo();
    const deps: AdmissionDeps = { repo };
    const exam = requireQueueExam({ batchSize: 1, batchInterval: 30 });

    const aFirst = await joinAdmissionQueue(deps, exam, "A", T0);
    await joinAdmissionQueue(deps, exam, "B", at(1));

    await reconcileAdmission(deps, exam, "A", at(2));
    await repo.consumeActive(
      exam.organizationId,
      exam.id,
      "A",
      at(2),
      "attempt-A",
    );

    // A retakes: fresh membership must be after B in the schedule.
    const aRetake = await joinAdmissionQueue(deps, exam, "A", at(3));
    expect(aRetake.id).not.toBe(aFirst.id);

    // B is batch 2 (t0+30); A's retake is batch 3 (t0+60).
    expect(
      (await reconcileAdmission(deps, exam, "A", at(30)))?.admittedAt,
    ).toBeNull();
    const bAdmitted = await reconcileAdmission(deps, exam, "B", at(30));
    expect(bAdmitted?.admittedAt).not.toBeNull();

    const aAdmitted = await reconcileAdmission(deps, exam, "A", at(60));
    expect(aAdmitted?.admittedAt).not.toBeNull();
  });

  it("M4 — restoring active-anchor semantics re-introduces the acceleration bug", async () => {
    // Mutation proof: if schedule authority is incorrectly derived from the
    // ACTIVE set, T1's consumption cascade makes B ready immediately.
    const correctedRepo = makeAdmissionRepo();
    const activeAnchorRepo: ExamAdmissionRepository = {
      ...correctedRepo,
      earliestJoinedAt: async (organizationId, examId) => {
        const active = correctedRepo.rows.filter(
          (r) =>
            r.organizationId === organizationId &&
            r.examId === examId &&
            r.consumedAt === null,
        );
        if (active.length === 0) return null;
        return active.reduce(
          (min, r) => (r.joinedAt < min ? r.joinedAt : min),
          active[0]!.joinedAt,
        );
      },
      countAllAhead: async (organizationId, examId, joinedAt, id) =>
        correctedRepo.rows.filter(
          (r) =>
            r.organizationId === organizationId &&
            r.examId === examId &&
            r.consumedAt === null &&
            (r.joinedAt < joinedAt ||
              (r.joinedAt.getTime() === joinedAt.getTime() && r.id < id)),
        ).length,
    };
    const deps: AdmissionDeps = { repo: activeAnchorRepo };
    const exam = requireQueueExam({ batchSize: 1, batchInterval: 30 });

    await joinAdmissionQueue(deps, exam, "A", T0);
    await joinAdmissionQueue(deps, exam, "B", at(0.1));
    await reconcileAdmission(deps, exam, "A", at(1));
    await correctedRepo.consumeActive(
      exam.organizationId,
      exam.id,
      "A",
      at(1),
      "attempt-A",
    );

    const early = await reconcileAdmission(deps, exam, "B", at(2));
    expect(early?.admittedAt).not.toBeNull();
  });
});

describe("ensureStartAdmission (Q2/Q3 — the start gate fails closed)", () => {
  it("rejects a candidate who never joined", async () => {
    const deps: AdmissionDeps = { repo: makeAdmissionRepo() };
    const exam = requireQueueExam();
    await expect(ensureStartAdmission(deps, exam, "c1", T0)).rejects.toThrow(
      QueueAdmissionRequiredError,
    );
  });

  it("rejects a waiting (not yet admitted) candidate", async () => {
    const repo = makeAdmissionRepo();
    const deps: AdmissionDeps = { repo };
    const exam = requireQueueExam({ batchSize: 1, batchInterval: 3600 });
    await joinAdmissionQueue(deps, exam, "c2", at(1));
    await joinAdmissionQueue(deps, exam, "c3", at(2));
    await expect(ensureStartAdmission(deps, exam, "c3", at(2))).rejects.toThrow(
      QueueAdmissionRequiredError,
    );
  });
});

describe("startOrRestoreAttempt admission integration (Q2/Q6)", () => {
  const startDeps = makeStartDeps();

  it("creates an attempt for an admitted candidate and consumes the membership atomically", async () => {
    const repo = makeAdmissionRepo();
    const exam = requireQueueExam();
    const ctx = makeEngineContext(exam);
    await joinAdmissionQueue({ repo }, exam, "cand-1", T0);

    const result = await startOrRestoreAttempt(
      ctx.exams,
      ctx.enrollments,
      ctx.attempts,
      exam.id,
      "cand-1",
      T0,
      { ...startDeps, admission: { repo } },
    );
    expect(result.isNew).toBe(true);
    const membership = repo.rows[0]!;
    expect(membership.admittedAt).not.toBeNull();
    expect(membership.consumedAt).not.toBeNull();
    expect(membership.consumedAttemptId).toBe(result.attempt.id);
  });

  it("refuses a requireQueue candidate without durable admission (no lazy join)", async () => {
    const repo = makeAdmissionRepo();
    const exam = requireQueueExam();
    const ctx = makeEngineContext(exam);

    await expect(
      startOrRestoreAttempt(
        ctx.exams,
        ctx.enrollments,
        ctx.attempts,
        exam.id,
        "cand-1",
        T0,
        { ...startDeps, admission: { repo } },
      ),
    ).rejects.toThrow(QueueAdmissionRequiredError);
    expect(repo.rows).toHaveLength(0);
  });

  it("FAILS CLOSED when the admission dependency is missing for a requireQueue exam (M1 structural kill)", async () => {
    const exam = requireQueueExam();
    const ctx = makeEngineContext(exam);
    await expect(
      startOrRestoreAttempt(
        ctx.exams,
        ctx.enrollments,
        ctx.attempts,
        exam.id,
        "cand-1",
        T0,
        startDeps,
      ),
    ).rejects.toThrow(ValidationError);
  });

  it("resume of an active attempt does NOT consult admission (re-entry is not start)", async () => {
    const repo = makeAdmissionRepo();
    const exam = requireQueueExam();
    const ctx = makeEngineContext(exam, {
      activeAttempt: ACTIVE_ATTEMPT,
    });
    const result = await startOrRestoreAttempt(
      ctx.exams,
      ctx.enrollments,
      ctx.attempts,
      exam.id,
      "cand-1",
      T0,
      { ...startDeps, admission: { repo } },
    );
    expect(result.isNew).toBe(false);
    expect(repo.rows).toHaveLength(0);
  });

  it("requireQueue=false exams start exactly as before (Q1)", async () => {
    const repo = makeAdmissionRepo();
    const exam = makeExam();
    const ctx = makeEngineContext(exam);
    const result = await startOrRestoreAttempt(
      ctx.exams,
      ctx.enrollments,
      ctx.attempts,
      exam.id,
      "cand-1",
      T0,
      { ...startDeps, admission: { repo } },
    );
    expect(result.isNew).toBe(true);
    expect(repo.rows).toHaveLength(0);
  });
});

// ── engine context helpers (attempt repo supports create + active lookup) ──

function makeStartDeps() {
  const stubEpisodeRepo = {
    create: async () => ({ id: "stub" }) as never,
    findById: async () => null,
    findByAttemptForUpdate: async () => null,
    findLatestByAttempt: async () => null,
  };
  const stubEventRepo = {
    insert: async (input: unknown) =>
      ({ id: "stub-event", ...(input as object) }) as never,
    findDetected: async () => null,
    findOutcome: async () => null,
    findLatestOutcomeByAttempt: async () => null,
  };
  const stubAdjustmentRepo = {
    insert: async (input: unknown) =>
      ({ id: "stub-adj", ...(input as object) }) as never,
    findById: async () => null,
    findByOperationId: async () => null,
    findBoundedByInterruption: async () => null,
    sumBoundedGraceSeconds: async () => 0,
  };
  const stubGradingWorksetRepo = {
    findByAttempt: async () => [],
    findByAttemptAndQuestion: async () => null,
    bulkCreate: async () => {},
    completeManualEntry: async () => null,
    countPendingManualForAttempt: async () => 0,
  };
  return {
    episodeRepo: stubEpisodeRepo,
    eventRepo: stubEventRepo,
    adjustmentRepo: stubAdjustmentRepo,
    gradingWorksetRepo: stubGradingWorksetRepo,
  };
}

function makeCreatingAttemptRepo(
  attempts: ExamAttempt[],
  opts: { activeAttempt?: ExamAttempt | null } = {},
): AttemptRepository {
  const store = [...attempts];
  let no = 0;
  return {
    findById(id) {
      return store.find((a) => a.id === id) ?? null;
    },
    findByIdForUpdate(id) {
      return store.find((a) => a.id === id) ?? null;
    },
    findActiveByEnrollment() {
      return opts.activeAttempt ?? null;
    },
    findByEnrollmentAndAttemptNo() {
      return null;
    },
    create(input) {
      no += 1;
      const attempt = {
        id: input.id ?? `attempt-new-${no}`,
        organizationId: input.organizationId,
        examId: input.examId,
        enrollmentId: input.enrollmentId,
        candidateId: input.candidateId,
        attemptNo: input.attemptNo,
        status: input.status,
        questionSnapshot: input.questionSnapshot,
        answers: input.answers,
        startedAt: input.startedAt ?? null,
        deadlineAt: input.deadlineAt ?? null,
        submittedAt: null,
        gradedAt: null,
        lastActivityAt: input.lastActivityAt ?? null,
        misconduct: null,
        gradingStatus: "auto_graded",
        submittedAnswers: null,
        submissionReason: null,
        currentInterruptionId: null,
        interruptedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as ExamAttempt;
      store.push(attempt);
      return attempt;
    },
    update(id, data) {
      const idx = store.findIndex((a) => a.id === id);
      if (idx === -1) return null;
      store[idx] = { ...store[idx]!, ...data };
      return store[idx]!;
    },
    refreshLastActivityIfInProgress(id, now) {
      const row = store.find((a) => a.id === id && a.status === "in_progress");
      if (!row) return null;
      row.lastActivityAt = now;
      return row;
    },
  };
}

function makeEngineContext(
  exam: Exam,
  opts: { activeAttempt?: ExamAttempt | null } = {},
) {
  const enrollment = makeEnrollment({
    examId: exam.id,
    attemptCount: 0,
    status: "assigned",
  });
  return {
    exams: makeExamRepo([exam]),
    enrollments: makeEnrollmentRepo([enrollment]) as EnrollmentRepository,
    attempts: makeCreatingAttemptRepo(
      opts.activeAttempt ? [opts.activeAttempt] : [],
      {
        activeAttempt: opts.activeAttempt ?? null,
      },
    ),
  };
}
