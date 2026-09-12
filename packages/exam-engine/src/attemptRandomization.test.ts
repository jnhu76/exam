import { describe, expect, it } from "vitest";
import type {
  AttemptInterruption,
  AttemptInterruptionEvent,
  AttemptTimeAdjustment,
  Exam,
  ExamAttempt,
  ExamEnrollment,
  QuestionSnapshot,
} from "@exam/domain";
import type {
  AttemptRepository,
  EnrollmentRepository,
} from "./attemptCommands.js";
import { startOrRestoreAttempt } from "./attemptCommands.js";
import type { ExamRepository } from "./examCommands.js";
import { computeGradingResult } from "./grading.js";
import type { GradingWorksetRepository } from "./gradingWorkset.js";
import type {
  InterruptionEpisodeRepository,
  InterruptionEventRepository,
  TimeAdjustmentRepository,
} from "./interruptionRepositories.js";
import type { SubmitInterruptionResolution } from "./restoreInterruption.js";
import {
  materializeAttemptPresentation,
  type RandomSource,
} from "./attemptPresentation.js";

/**
 * #294 — engine-level integration matrix for snapshot-frozen randomization.
 * Proves the freeze semantics across the startOrRestoreAttempt seam:
 * resume/restore never re-randomize (T8, restore), duplicate start converges
 * to one frozen snapshot (T13), retake resolves independently (T14), and
 * save/grading stay identity-keyed through the real grading seam (T11/T12).
 * All proofs are deterministic via the injected RNG — no probabilistic
 * expectations anywhere.
 */

/** Deterministic [0,1) sequence; exhausted draws return 0. */
function sequenceRng(...values: number[]): RandomSource {
  let i = 0;
  return () => values[i++] ?? 0;
}

/** RNG that fails the test if it is ever consulted (resume/restore re-draw). */
function throwingRng(): RandomSource {
  return () => {
    throw new Error("rng must not be consulted on resume/restore");
  };
}

const FIXED_NOW = new Date("2025-01-01T10:30:00Z");

/** Published snapshot: q1 single_choice (a/b/c, answer b), q2 multiple_choice
 * (d/e, answer d), q3 fill_blank (answer x). Scores 34/33/33 = 100. */
function publishedSnapshot(): QuestionSnapshot[] {
  return [
    {
      originalQuestionId: "q1",
      type: "single_choice",
      content: "Q1",
      contentDocument: null,
      answerMode: null,
      attachments: [],
      options: [
        { id: "a", content: "A" },
        { id: "b", content: "B" },
        { id: "c", content: "C" },
      ],
      standardAnswer: "b",
      score: 34,
      gradingRule: {
        multiSelectScoring: "all_correct_full",
        fillBlankMatchMode: "exact",
      },
      order: 0,
      rubric: null,
    },
    {
      originalQuestionId: "q2",
      type: "multiple_choice",
      content: "Q2",
      contentDocument: null,
      answerMode: null,
      attachments: [],
      options: [
        { id: "d", content: "D" },
        { id: "e", content: "E" },
      ],
      standardAnswer: ["d"],
      score: 33,
      gradingRule: {
        multiSelectScoring: "all_correct_full",
        fillBlankMatchMode: "exact",
      },
      order: 1,
      rubric: null,
    },
    {
      originalQuestionId: "q3",
      type: "fill_blank",
      content: "Q3",
      contentDocument: null,
      answerMode: null,
      attachments: [],
      options: [],
      standardAnswer: "x",
      score: 33,
      gradingRule: {
        multiSelectScoring: "all_correct_full",
        fillBlankMatchMode: "exact",
      },
      order: 2,
      rubric: null,
    },
  ];
}

function shuffledExam(): Exam {
  return {
    id: "exam-1",
    organizationId: "org-1",
    title: "Shuffled Exam",
    description: "",
    courseId: "course-1",
    status: "open",
    timingMode: "timed_window",
    durationMinutes: 60,
    openAt: new Date("2025-01-01T09:00:00Z"),
    closeAt: new Date("2025-01-01T12:00:00Z"),
    passingScore: 60,
    totalScore: 100,
    questionSelectionMode: "manual",
    questionIds: ["q1", "q2", "q3"],
    questionSnapshot: publishedSnapshot(),
    controlFlags: {
      shuffleQuestions: true,
      shuffleOptions: true,
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
    maxAttempts: 3,
    latestStartOffsetMinutes: null,
    minSubmitAfterStartMinutes: null,
    resultPublicationMode: "immediate",
    resultsPublishedAt: null,
    syncStartedAt: null,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
  };
}

function makeEnrollment(
  overrides: Partial<ExamEnrollment> = {},
): ExamEnrollment {
  return {
    id: "enr-1",
    organizationId: "org-1",
    examId: "exam-1",
    candidateId: "cand-1",
    status: "assigned",
    attemptCount: 0,
    createdAt: FIXED_NOW,
    updatedAt: FIXED_NOW,
    ...overrides,
  };
}

function makeAttemptRepo(attempts: ExamAttempt[] = []): AttemptRepository {
  const store = [...attempts];
  return {
    findById(id) {
      return store.find((a) => a.id === id) ?? null;
    },
    findByIdForUpdate(id) {
      return store.find((a) => a.id === id) ?? null;
    },
    findActiveByEnrollment(enrollmentId) {
      return (
        store.find(
          (a) =>
            a.enrollmentId === enrollmentId &&
            (a.status === "in_progress" || a.status === "disrupted"),
        ) ?? null
      );
    },
    findByEnrollmentAndAttemptNo(enrollmentId, attemptNo) {
      return (
        store.find(
          (a) => a.enrollmentId === enrollmentId && a.attemptNo === attemptNo,
        ) ?? null
      );
    },
    create(input) {
      const attempt = {
        id: input.id ?? "attempt-new",
        organizationId: input.organizationId,
        examId: input.examId,
        enrollmentId: input.enrollmentId,
        candidateId: input.candidateId,
        attemptNo: input.attemptNo,
        status: input.status,
        questionSnapshot: input.questionSnapshot,
        answers: input.answers,
        startedAt: input.startedAt,
        deadlineAt: input.deadlineAt,
        lastActivityAt: input.lastActivityAt,
        createdAt: FIXED_NOW,
        updatedAt: FIXED_NOW,
      } as ExamAttempt;
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
      const idx = store.findIndex((a) => a.id === id);
      if (idx === -1) return null;
      if (store[idx]!.status !== "in_progress") return null;
      store[idx] = { ...store[idx]!, lastActivityAt: now };
      return store[idx]!;
    },
  };
}

function makeEnrollmentRepo(
  enrollments: ExamEnrollment[],
): EnrollmentRepository {
  const store = [...enrollments];
  return {
    findByExamAndCandidate(examId, candidateId) {
      return (
        store.find(
          (e) => e.examId === examId && e.candidateId === candidateId,
        ) ?? null
      );
    },
    findByExamAndCandidateForUpdate(examId, candidateId) {
      return (
        store.find(
          (e) => e.examId === examId && e.candidateId === candidateId,
        ) ?? null
      );
    },
    create() {
      throw new Error("not used");
    },
    update(id, data) {
      const idx = store.findIndex((e) => e.id === id);
      if (idx === -1) return null;
      store[idx] = { ...store[idx]!, ...data };
      return store[idx]!;
    },
  };
}

function makeExamRepo(exams: Exam[]): ExamRepository {
  const store = [...exams];
  return {
    findById(examId) {
      return store.find((e) => e.id === examId) ?? null;
    },
    findByIdForUpdate(examId) {
      return store.find((e) => e.id === examId) ?? null;
    },
    update() {
      throw new Error("not used");
    },
  };
}

const stubEpisodeRepo: InterruptionEpisodeRepository = {
  create: async () => ({ id: "stub" }) as never,
  findById: async () => null,
  findByAttemptForUpdate: async () => null,
  findLatestByAttempt: async () => null,
};
const stubEventRepo: InterruptionEventRepository = {
  insert: async (input) => ({ id: "stub-event", ...input }) as never,
  findDetected: async () => null,
  findOutcome: async () => null,
  findLatestOutcomeByAttempt: async () => null,
};
const stubAdjustmentRepo: TimeAdjustmentRepository = {
  insert: async (input) => ({ id: "stub-adj", ...input }) as never,
  findById: async () => null,
  findByOperationId: async () => null,
  findBoundedByInterruption: async () => null,
  sumBoundedGraceSeconds: async () => 0,
};
const stubGradingWorksetRepo: GradingWorksetRepository = {
  findByAttempt: async () => [],
  findByAttemptAndQuestion: async () => null,
  bulkCreate: async () => {},
  completeManualEntry: async () => null,
  countPendingManualForAttempt: async () => 0,
};

const startDeps = {
  episodeRepo: stubEpisodeRepo,
  eventRepo: stubEventRepo,
  adjustmentRepo: stubAdjustmentRepo,
  gradingWorksetRepo: stubGradingWorksetRepo,
};

/** Starts a fresh attempt; returns the harness and the created attempt. */
async function startNewAttempt(rng: RandomSource) {
  const exam = shuffledExam();
  const enrollment = makeEnrollment();
  const examRepo = makeExamRepo([exam]);
  const enrRepo = makeEnrollmentRepo([enrollment]);
  const attRepo = makeAttemptRepo();

  const result = await startOrRestoreAttempt(
    examRepo,
    enrRepo,
    attRepo,
    "exam-1",
    "cand-1",
    FIXED_NOW,
    { ...startDeps, rng },
  );

  return { exam, examRepo, enrRepo, attRepo, result };
}

describe("snapshot-frozen randomization (#294) — engine seam", () => {
  // T8 — same attempt resumed returns the exact frozen order; the RNG must
  // never be consulted again (a re-draw would throw here).
  it("T8: resume returns the same attempt with the same frozen order, no re-draw", async () => {
    const { exam, enrRepo, attRepo, result } = await startNewAttempt(
      sequenceRng(0.1, 0, 0.1, 0.1, 0),
    );
    const first = result.attempt;
    expect(first.questionSnapshot.map((q) => q.originalQuestionId)).toEqual([
      "q2",
      "q3",
      "q1",
    ]);

    const resumed = await startOrRestoreAttempt(
      makeExamRepo([exam]),
      enrRepo,
      attRepo,
      "exam-1",
      "cand-1",
      FIXED_NOW,
      { ...startDeps, rng: throwingRng() },
    );

    expect(resumed.isNew).toBe(false);
    expect(resumed.attempt.id).toBe(first.id);
    expect(resumed.attempt.questionSnapshot).toEqual(first.questionSnapshot);
    // The stored row was returned as-is; no new snapshot was materialized.
    const stored = await attRepo.findById(first.id);
    expect(stored!.questionSnapshot).toEqual(first.questionSnapshot);
  });

  // T13 — duplicate/retried start converges to ONE frozen snapshot even when
  // the retry supplies a different RNG sequence.
  it("T13: duplicate start converges to the same frozen snapshot (no re-randomize)", async () => {
    const { enrRepo, attRepo, result } = await startNewAttempt(
      sequenceRng(0.1, 0, 0.1, 0.1, 0),
    );
    const first = result.attempt;

    const second = await startOrRestoreAttempt(
      makeExamRepo([shuffledExam()]),
      enrRepo,
      attRepo,
      "exam-1",
      "cand-1",
      FIXED_NOW,
      // Deliberately a sequence whose fresh draw would produce a DIFFERENT
      // permutation ([q3,q2,q1]) than the frozen one ([q2,q3,q1]) — a
      // re-randomize on duplicate start would fail the equality below. (The
      // identity permutation would be a legal draw and could mask a
      // re-randomize regression; this sequence cannot.)
      { ...startDeps, rng: sequenceRng(0.1, 0.9, 0.1, 0.1, 0) },
    );

    expect(second.isNew).toBe(false);
    expect(second.attempt.id).toBe(first.id);
    expect(second.attempt.questionSnapshot).toEqual(first.questionSnapshot);
  });

  // T14 — a retake is a NEW attempt and resolves an independently drawn
  // order; attempt 1's frozen order is untouched.
  it("T14: retake creates a new attempt with independently resolved order", async () => {
    const exam = shuffledExam();
    const enrollment = makeEnrollment({ attemptCount: 1 });
    const firstAttempt: ExamAttempt = {
      id: "attempt-1",
      organizationId: "org-1",
      examId: "exam-1",
      enrollmentId: "enr-1",
      candidateId: "cand-1",
      attemptNo: 1,
      status: "graded",
      questionSnapshot: materializeAttemptPresentation(
        publishedSnapshot(),
        exam.controlFlags,
        sequenceRng(0.1, 0, 0.1, 0.1, 0),
      ),
      answers: [],
      startedAt: new Date("2025-01-01T09:30:00Z"),
      deadlineAt: new Date("2025-01-01T10:30:00Z"),
      lastActivityAt: new Date("2025-01-01T09:30:00Z"),
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    };
    const examRepo = makeExamRepo([exam]);
    const enrRepo = makeEnrollmentRepo([enrollment]);
    const attRepo = makeAttemptRepo([firstAttempt]);

    const retake = await startOrRestoreAttempt(
      examRepo,
      enrRepo,
      attRepo,
      "exam-1",
      "cand-1",
      FIXED_NOW,
      { ...startDeps, rng: sequenceRng(0.99, 0.99, 0.99, 0.99, 0.99) },
    );

    expect(retake.isNew).toBe(true);
    expect(retake.attempt.attemptNo).toBe(2);
    expect(retake.attempt.id).not.toBe(firstAttempt.id);
    // Identity permutation is a legal draw; the invariant is that the order
    // was re-resolved from the RNG, not copied from attempt 1.
    expect(retake.attempt.questionSnapshot).toEqual(
      materializeAttemptPresentation(
        publishedSnapshot(),
        exam.controlFlags,
        sequenceRng(0.99, 0.99, 0.99, 0.99, 0.99),
      ),
    );
    expect(retake.attempt.questionSnapshot).not.toEqual(
      firstAttempt.questionSnapshot,
    );
    // Attempt 1's frozen order remains immutable.
    const attempt1Stored = await attRepo.findById("attempt-1");
    expect(attempt1Stored!.questionSnapshot).toEqual(
      firstAttempt.questionSnapshot,
    );
  });

  // M2 base — restore of a disrupted attempt replays the frozen snapshot;
  // the RNG is never consulted (a re-draw would throw).
  it("restore: disrupted attempt restores the exact frozen randomized order, no re-draw", async () => {
    const exam = shuffledExam();
    const enrollment = makeEnrollment({ status: "started", attemptCount: 1 });
    const frozen = materializeAttemptPresentation(
      publishedSnapshot(),
      exam.controlFlags,
      sequenceRng(0.1, 0, 0.1, 0.1, 0),
    );
    const detectedAt = new Date("2025-01-01T10:00:00Z");
    const disrupted: ExamAttempt = {
      id: "attempt-1",
      organizationId: "org-1",
      examId: "exam-1",
      enrollmentId: "enr-1",
      candidateId: "cand-1",
      attemptNo: 1,
      status: "disrupted",
      questionSnapshot: frozen,
      answers: [],
      startedAt: new Date("2025-01-01T09:30:00Z"),
      // Future deadline relative to FIXED_NOW (10:30) so restore resolves to
      // in_progress instead of triggering deadline terminalization (which
      // would need a full grading workset — not what this test proves).
      deadlineAt: new Date("2025-01-01T11:00:00Z"),
      lastActivityAt: new Date("2025-01-01T09:55:00Z"),
      interruptionTimingPolicySnapshot: {
        schemaVersion: 1,
        policy: "strict",
        perIncidentCapSeconds: null,
        perAttemptAggregateCapSeconds: null,
      },
      currentInterruptionId: "ep-1",
      interruptedAt: detectedAt,
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    } as unknown as ExamAttempt;

    const episodeRepo: InterruptionEpisodeRepository = {
      create: async () => ({ id: "ep-1" }) as AttemptInterruption,
      findById: async () => null,
      findByAttemptForUpdate: async () =>
        ({
          id: "ep-1",
          attemptId: "attempt-1",
          organizationId: "org-1",
          createdAt: detectedAt,
        }) as AttemptInterruption,
      findLatestByAttempt: async () => null,
    };
    const eventRepo: InterruptionEventRepository = {
      insert: async () => ({ id: "evt-1" }) as AttemptInterruptionEvent,
      findDetected: async () =>
        ({
          id: "evt-detected",
          organizationId: "org-1",
          attemptId: "attempt-1",
          interruptionId: "ep-1",
          eventType: "detected",
          occurredAt: detectedAt,
          observedLastActivityAt: new Date("2025-01-01T09:55:00Z"),
          detectionSource: "heartbeat_timeout",
          timeoutSeconds: 60,
          policy: "strict",
          eligibleSeconds: null,
          timeAdjustmentId: null,
          actorId: null,
          reasonCode: "heartbeat_timeout",
          createdAt: detectedAt,
        }) as AttemptInterruptionEvent,
      findOutcome: async () => null,
      findLatestOutcomeByAttempt: async () => null,
    };
    const adjustmentRepo: TimeAdjustmentRepository = {
      insert: async () =>
        ({
          id: "adj-1",
          operationId: "op-1",
          organizationId: "org-1",
          attemptId: "attempt-1",
          interruptionId: null,
          incidentId: null,
          policy: "strict",
          source: "operator",
          beforeDeadline: detectedAt,
          afterDeadline: detectedAt,
          addedSeconds: 0,
          eligibleSeconds: 0,
          reasonCode: "strict_zero_grant",
          reasonText: null,
          actorId: null,
          createdAt: detectedAt,
        }) as AttemptTimeAdjustment,
      findById: async () => null,
      findByOperationId: async () => null,
      findBoundedByInterruption: async () => null,
      sumBoundedGraceSeconds: async () => 0,
    };

    const result = await startOrRestoreAttempt(
      makeExamRepo([exam]),
      makeEnrollmentRepo([enrollment]),
      makeAttemptRepo([disrupted]),
      "exam-1",
      "cand-1",
      FIXED_NOW,
      {
        episodeRepo,
        eventRepo,
        adjustmentRepo,
        gradingWorksetRepo: stubGradingWorksetRepo,
        rng: throwingRng(),
      },
    );

    expect(result.isNew).toBe(false);
    expect(result.attempt.status).toBe("in_progress");
    expect(result.attempt.questionSnapshot).toEqual(frozen);
  });

  // T11 — question identity survives a permutation: answers saved by
  // originalQuestionId grade correctly even though presentation order differs
  // from identity order (q1 renders at index 2, not 0).
  it("T11: grading by originalQuestionId is correct under a question permutation", async () => {
    const exam = shuffledExam();
    const attempt: ExamAttempt = {
      id: "attempt-1",
      organizationId: "org-1",
      examId: "exam-1",
      enrollmentId: "enr-1",
      candidateId: "cand-1",
      attemptNo: 1,
      status: "submitted",
      // Deterministic permutation: [q2, q3, q1] — q1 moved off its published
      // index so a presentation-index lookup would grade the wrong answer.
      questionSnapshot: materializeAttemptPresentation(
        publishedSnapshot(),
        exam.controlFlags,
        sequenceRng(0.1, 0, 0.1, 0.1, 0),
      ),
      answers: [
        {
          questionId: "q1",
          answer: "b",
          version: 1,
          savedAt: FIXED_NOW,
        },
        {
          questionId: "q2",
          answer: ["d"],
          version: 1,
          savedAt: FIXED_NOW,
        },
        {
          questionId: "q3",
          answer: "x",
          version: 1,
          savedAt: FIXED_NOW,
        },
      ],
      startedAt: new Date("2025-01-01T09:30:00Z"),
      deadlineAt: new Date("2025-01-01T10:30:00Z"),
      lastActivityAt: new Date("2025-01-01T09:30:00Z"),
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    };
    // Non-vacuity: the presentation order genuinely differs from identity order.
    expect(attempt.questionSnapshot.map((q) => q.originalQuestionId)).toEqual([
      "q2",
      "q3",
      "q1",
    ]);

    const result = computeGradingResult(attempt, exam, FIXED_NOW);

    expect(result.totalScore).toBe(100);
    const q1 = result.questionResults.find((r) => r.questionId === "q1")!;
    const q3 = result.questionResults.find((r) => r.questionId === "q3")!;
    expect(q1.score).toBe(34);
    expect(q3.score).toBe(33);
  });

  // T12 — option identity survives a permutation: the answer is keyed by
  // option.id ("b"), not by visual position; an index-based answer at the
  // position where "b" renders ("c") would grade wrong.
  it("T12: grading by option.id is correct under an option permutation", async () => {
    const exam = shuffledExam();
    const attempt: ExamAttempt = {
      id: "attempt-1",
      organizationId: "org-1",
      examId: "exam-1",
      enrollmentId: "enr-1",
      candidateId: "cand-1",
      attemptNo: 1,
      status: "submitted",
      // q1 options [a,b,c] → [b,c,a]: "b" renders at presentation index 0,
      // but the standard answer identity is option.id "b".
      questionSnapshot: materializeAttemptPresentation(
        publishedSnapshot(),
        exam.controlFlags,
        sequenceRng(0.99, 0.99, 0.99, 0.1, 0, 0.1),
      ),
      answers: [
        // q2 answer placed at index 0 — different position from q1.
        // Identity grading finds q1 by originalQuestionId (answer "b" → 34);
        // M3 index-based pairing would give q1 the answer at index 0 ("["d"]")
        // and q2 the answer at index 1 ("b"), producing 0 for both.
        {
          questionId: "q2",
          answer: ["d"],
          version: 1,
          savedAt: FIXED_NOW,
        },
        {
          questionId: "q1",
          answer: "b", // option.id, NOT presentation position
          version: 1,
          savedAt: FIXED_NOW,
        },
      ],
      startedAt: new Date("2025-01-01T09:30:00Z"),
      deadlineAt: new Date("2025-01-01T10:30:00Z"),
      lastActivityAt: new Date("2025-01-01T09:30:00Z"),
      createdAt: FIXED_NOW,
      updatedAt: FIXED_NOW,
    };
    // Non-vacuity: option "b" is NOT at its published index 1 in the frozen
    // presentation. Draws: 0.99,0.99 for the question shuffle (identity
    // order), then q1's options consume 0.99 (no-op) and 0.1 → [b,a,c].
    const q1 = attempt.questionSnapshot.find(
      (q) => q.originalQuestionId === "q1",
    )!;
    expect(q1.options.map((o) => o.id)).toEqual(["b", "a", "c"]);

    const result = computeGradingResult(attempt, exam, FIXED_NOW);

    // q1 correct (34) + q2 correct (33) = 67. Under M3 (index pairing),
    // q1 would receive q2's answer and vice-versa — total 0 → RED proof.
    expect(result.totalScore).toBe(67);
    const q1r = result.questionResults.find((r) => r.questionId === "q1")!;
    const q2r = result.questionResults.find((r) => r.questionId === "q2")!;
    expect(q1r.score).toBe(34);
    expect(q2r.score).toBe(33);

    // Answering by the wrong identity (option "c" instead of "b") produces
    // 0 for q1 — proves grading consults option.id, not presentation index.
    const wrongByPosition: ExamAttempt = {
      ...attempt,
      answers: [
        { questionId: "q2", answer: ["d"], version: 1, savedAt: FIXED_NOW },
        {
          questionId: "q1",
          answer: "c", // wrong identity (not the standard answer option.id "b")
          version: 1,
          savedAt: FIXED_NOW,
        },
      ],
    };
    expect(
      computeGradingResult(wrongByPosition, exam, FIXED_NOW).totalScore,
    ).toBe(
      33, // only q2 scores; q1 scores 0
    );
  });
});
