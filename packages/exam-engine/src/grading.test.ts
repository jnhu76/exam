import { describe, expect, it } from "vitest";
import {
  gradeAttemptIdempotent,
  finalizeGrading,
  computeGradingResult,
  readGradingSnapshot,
  shouldEnrollmentComplete,
} from "./grading.js";
import { lockEnrollmentAndAttempt } from "./lockSeam.js";
import type {
  AttemptRepository,
  EnrollmentRepository,
} from "./attemptCommands.js";
import type { ExamRepository } from "./examCommands.js";
import type {
  Exam,
  ExamAttempt,
  ExamEnrollment,
  ScoreResult,
} from "@exam/domain";
import { InvalidStateTransitionError } from "@exam/domain";
import type { GradingWorksetRepository } from "./gradingWorkset.js";

/**
 * P3-FORMAL-P0-D2 test helper: mints a genuine capability against the
 * provided repo pair by invoking the canonical seam. Test-only.
 */
async function mintCap(
  enrollmentRepo: EnrollmentRepository,
  attemptRepo: AttemptRepository,
  attemptId: string,
) {
  return lockEnrollmentAndAttempt(enrollmentRepo, attemptRepo, attemptId);
}

function makeExam(scoreStrategy: Exam["scoreStrategy"] = "highest"): Exam {
  return {
    id: "exam-1",
    organizationId: "org-1",
    title: "Exam",
    description: "",
    courseId: "course-1",
    status: "open",
    timingMode: "timed_window",
    durationMinutes: 60,
    openAt: new Date("2026-06-01T00:00:00Z"),
    closeAt: new Date("2026-06-02T00:00:00Z"),
    passingScore: 6,
    totalScore: 10,
    questionSelectionMode: "manual",
    questionIds: ["q1"],
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
    scoreStrategy,
    maxAttempts: 3,
    latestStartOffsetMinutes: null,
    minSubmitAfterStartMinutes: null,
    resultPublicationMode: "immediate",
    resultsPublishedAt: null,
    syncStartedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeAttempt(overrides: Partial<ExamAttempt> = {}): ExamAttempt {
  return {
    id: "attempt-1",
    organizationId: "org-1",
    examId: "exam-1",
    enrollmentId: "enrollment-1",
    candidateId: "candidate-1",
    attemptNo: 2,
    status: "submitted",
    questionSnapshot: [
      {
        originalQuestionId: "q1",
        type: "single_choice",
        content: "Question",
        contentDocument: null,
        answerMode: null,
        attachments: [],
        options: [],
        standardAnswer: "a",
        score: 10,
        gradingRule: {
          multiSelectScoring: "all_correct_full",
          fillBlankMatchMode: "exact",
        },
        order: 0,
        rubric: null,
      },
    ],
    answers: [
      {
        questionId: "q1",
        answer: "a",
        version: 1,
        savedAt: new Date(),
      },
    ],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeEnrollment(
  overrides: Partial<ExamEnrollment> = {},
): ExamEnrollment {
  return {
    id: "enrollment-1",
    organizationId: "org-1",
    examId: "exam-1",
    candidateId: "candidate-1",
    status: "started",
    attemptCount: 2,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeRepos(
  exam: Exam,
  attempt: ExamAttempt,
  enrollment: ExamEnrollment,
) {
  let storedAttempt = attempt;
  let storedEnrollment = enrollment;
  const examRepo: ExamRepository = {
    findById: () => exam,
    findByIdForUpdate: () => exam,
    update: () => exam,
  };
  const attemptRepo: AttemptRepository = {
    findById: () => storedAttempt,
    findByIdForUpdate: () => storedAttempt,
    findActiveByEnrollment: () => null,
    findByEnrollmentAndAttemptNo: () => null,
    create: () => storedAttempt,
    update: (_id, data) => {
      storedAttempt = { ...storedAttempt, ...data };
      return storedAttempt;
    },
    refreshLastActivityIfInProgress: () => storedAttempt,
  };
  const enrollmentRepo: EnrollmentRepository = {
    findByExamAndCandidate: () => storedEnrollment,
    findByExamAndCandidateForUpdate: () => storedEnrollment,
    create: () => storedEnrollment,
    update: (_id, data) => {
      storedEnrollment = { ...storedEnrollment, ...data };
      return storedEnrollment;
    },
  };
  // Slice 4: derive the workset repo from the canonical auto-grader output
  // so finalizeGrading/gradeAttemptIdempotent aggregate the same score the old
  // result-based path produced.
  const worksetRepo: GradingWorksetRepository = {
    findByAttempt: async (id) => {
      if (id !== storedAttempt.id) return [];
      const r = computeGradingResult(storedAttempt, exam, new Date());
      return r.questionResults.map((qr) => ({
        id: `entry-${qr.questionId}`,
        organizationId: storedAttempt.organizationId,
        attemptId: storedAttempt.id,
        questionId: qr.questionId,
        gradingMode: "auto" as const,
        status: "completed_auto" as const,
        maxScore: qr.maxScore,
        earnedScore: qr.score,
        candidateAnswer: qr.candidateAnswer,
        standardAnswer: qr.standardAnswer,
        correct: qr.correct,
        comment: "",
        gradedBy: null,
        gradedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));
    },
    findByAttemptAndQuestion: async () => null,
    bulkCreate: async () => {},
    completeManualEntry: async () => null,
    countPendingManualForAttempt: async () => 0,
  };
  return {
    examRepo,
    attemptRepo,
    enrollmentRepo,
    worksetRepo,
    getAttempt: () => storedAttempt,
    getEnrollment: () => storedEnrollment,
  };
}

// Retargeted rows from the deleted test-only `gradeAttempt` wrapper onto the
// production entry point `gradeAttemptIdempotent` — same finalizeGrading →
// aggregateGradingEntries path for submitted, non-pending-manual attempts.
describe("gradeAttemptIdempotent — auto command path", () => {
  it("persists question results and marks a passing attempt graded", async () => {
    const repos = makeRepos(makeExam(), makeAttempt(), makeEnrollment());
    const cap = await mintCap(
      repos.enrollmentRepo,
      repos.attemptRepo,
      "attempt-1",
    );
    const gradedAt = new Date("2026-06-01T12:00:00Z");

    const result = await gradeAttemptIdempotent(
      repos.examRepo,
      repos.enrollmentRepo,
      repos.attemptRepo,
      repos.worksetRepo,
      cap,
      gradedAt,
    );

    expect(result.totalScore).toBe(10);
    expect(result.passed).toBe(true);
    expect(result.questionResults).toHaveLength(1);
    expect(repos.getAttempt()).toMatchObject({
      status: "graded",
      score: 10,
      passed: true,
      gradedAt,
    });
    expect(repos.getEnrollment()).toMatchObject({
      status: "started",
      finalScore: 10,
      finalPassed: true,
      finalAttemptId: "attempt-1",
    });
  });

  it("rejects attempts that are not submitted", async () => {
    const repos = makeRepos(
      makeExam(),
      makeAttempt({ status: "in_progress" }),
      makeEnrollment(),
    );

    const cap = await mintCap(
      repos.enrollmentRepo,
      repos.attemptRepo,
      "attempt-1",
    );
    await expect(
      gradeAttemptIdempotent(
        repos.examRepo,
        repos.enrollmentRepo,
        repos.attemptRepo,
        repos.worksetRepo,
        cap,
        new Date(),
      ),
    ).rejects.toThrow(InvalidStateTransitionError);
  });

  it.each([
    ["latest", 8, 10, "attempt-1"],
    ["highest", 12, 12, "previous-attempt"],
    // highest: a new score equal to the existing final does NOT replace it
    // (`score > enrollment.finalScore`, not `>=`). Keeps the prior attempt as
    // the recorded final.
    ["highest", 10, 10, "previous-attempt"],
    ["first", 8, 8, "previous-attempt"],
  ] as const)(
    "applies %s score strategy (previous=%d)",
    async (scoreStrategy, previousScore, expectedScore, expectedAttemptId) => {
      const repos = makeRepos(
        makeExam(scoreStrategy),
        makeAttempt(),
        makeEnrollment({
          finalScore: previousScore,
          finalPassed: true,
          finalAttemptId: "previous-attempt",
        }),
      );

      const cap = await mintCap(
        repos.enrollmentRepo,
        repos.attemptRepo,
        "attempt-1",
      );
      await gradeAttemptIdempotent(
        repos.examRepo,
        repos.enrollmentRepo,
        repos.attemptRepo,
        repos.worksetRepo,
        cap,
        new Date(),
      );

      expect(repos.getEnrollment().finalScore).toBe(expectedScore);
      expect(repos.getEnrollment().finalAttemptId).toBe(expectedAttemptId);
    },
  );

  it("writes finalScore on the first graded attempt when none is set yet (all strategies)", async () => {
    // Explicitly names the "first-ever" branch: enrollment has no
    // finalScore/finalAttemptId, so every strategy must record this attempt.
    for (const scoreStrategy of ["latest", "highest", "first"] as const) {
      const repos = makeRepos(
        makeExam(scoreStrategy),
        makeAttempt(),
        // No finalScore/finalAttemptId set: simulates a first-ever grade.
        makeEnrollment(),
      );

      const cap = await mintCap(
        repos.enrollmentRepo,
        repos.attemptRepo,
        "attempt-1",
      );
      await gradeAttemptIdempotent(
        repos.examRepo,
        repos.enrollmentRepo,
        repos.attemptRepo,
        repos.worksetRepo,
        cap,
        new Date(),
      );

      expect(repos.getEnrollment().finalScore).toBe(10);
      expect(repos.getEnrollment().finalPassed).toBe(true);
      expect(repos.getEnrollment().finalAttemptId).toBe("attempt-1");
    }
  });

  it("throws ValidationError when persisting graded result fails", async () => {
    const exam = makeExam();
    const attempt = makeAttempt();
    const enrollment = makeEnrollment();
    const examRepo: ExamRepository = {
      findById: () => exam,
      findByIdForUpdate: () => exam,
      update: () => exam,
    };
    const attemptRepo: AttemptRepository = {
      findById: () => attempt,
      findByIdForUpdate: () => attempt,
      findActiveByEnrollment: () => null,
      findByEnrollmentAndAttemptNo: () => null,
      create: () => attempt,
      update: () => null,
      refreshLastActivityIfInProgress: () => attempt,
    };
    const enrollmentRepo: EnrollmentRepository = {
      findByExamAndCandidate: () => enrollment,
      findByExamAndCandidateForUpdate: () => enrollment,
      create: () => enrollment,
      update: () => enrollment,
    };

    // Slice 4: the grading path aggregates from a workset repo. Derive entries
    // from the canonical auto-grader so aggregation succeeds and the test
    // reaches the intended persist-failure point.
    const worksetRepo: GradingWorksetRepository = {
      findByAttempt: async (id) => {
        if (id !== attempt.id) return [];
        const r = computeGradingResult(attempt, exam, new Date());
        return r.questionResults.map((qr) => ({
          id: `entry-${qr.questionId}`,
          organizationId: attempt.organizationId,
          attemptId: attempt.id,
          questionId: qr.questionId,
          gradingMode: "auto" as const,
          status: "completed_auto" as const,
          maxScore: qr.maxScore,
          earnedScore: qr.score,
          candidateAnswer: qr.candidateAnswer,
          standardAnswer: qr.standardAnswer,
          correct: qr.correct,
          comment: "",
          gradedBy: null,
          gradedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }));
      },
      findByAttemptAndQuestion: async () => null,
      bulkCreate: async () => {},
      completeManualEntry: async () => null,
      countPendingManualForAttempt: async () => 0,
    };

    const cap = await mintCap(enrollmentRepo, attemptRepo, "attempt-1");
    await expect(
      gradeAttemptIdempotent(
        examRepo,
        enrollmentRepo,
        attemptRepo,
        worksetRepo,
        cap,
        new Date(),
      ),
    ).rejects.toThrow("Failed to persist graded results");
  });

  it("throws ValidationError when updating enrollment result fails", async () => {
    const exam = makeExam();
    const attempt = makeAttempt();
    const enrollment = makeEnrollment();
    const gradedAttempt = { ...attempt, status: "graded" as const };
    let attemptCallCount = 0;
    const examRepo: ExamRepository = {
      findById: () => exam,
      findByIdForUpdate: () => exam,
      update: () => exam,
    };
    const attemptRepo: AttemptRepository = {
      findById: () => attempt,
      findByIdForUpdate: () => attempt,
      findActiveByEnrollment: () => null,
      findByEnrollmentAndAttemptNo: () => null,
      create: () => attempt,
      update: () => {
        attemptCallCount++;
        return gradedAttempt;
      },
      refreshLastActivityIfInProgress: () => attempt,
    };
    const enrollmentRepo: EnrollmentRepository = {
      findByExamAndCandidate: () => enrollment,
      findByExamAndCandidateForUpdate: () => enrollment,
      create: () => enrollment,
      update: () => null,
    };

    // Slice 4: the grading path aggregates from a workset repo. Derive entries
    // from the canonical auto-grader so aggregation succeeds and the test
    // reaches the intended persist-failure point.
    const worksetRepo: GradingWorksetRepository = {
      findByAttempt: async (id) => {
        if (id !== attempt.id) return [];
        const r = computeGradingResult(attempt, exam, new Date());
        return r.questionResults.map((qr) => ({
          id: `entry-${qr.questionId}`,
          organizationId: attempt.organizationId,
          attemptId: attempt.id,
          questionId: qr.questionId,
          gradingMode: "auto" as const,
          status: "completed_auto" as const,
          maxScore: qr.maxScore,
          earnedScore: qr.score,
          candidateAnswer: qr.candidateAnswer,
          standardAnswer: qr.standardAnswer,
          correct: qr.correct,
          comment: "",
          gradedBy: null,
          gradedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }));
      },
      findByAttemptAndQuestion: async () => null,
      bulkCreate: async () => {},
      completeManualEntry: async () => null,
      countPendingManualForAttempt: async () => 0,
    };

    const cap = await mintCap(enrollmentRepo, attemptRepo, "attempt-1");
    await expect(
      gradeAttemptIdempotent(
        examRepo,
        enrollmentRepo,
        attemptRepo,
        worksetRepo,
        cap,
        new Date(),
      ),
    ).rejects.toThrow("Failed to update enrollment");
  });
});

// ── P3-L0-2: grading reads submitted_answers, not draft answers ──────────

describe("computeGradingResult — submitted_answers read path (P3-L0-2)", () => {
  const exam = makeExam();

  it("scores from submitted_answers when present, ignoring draft answers", () => {
    // Draft says "x" (wrong); submitted_answers says "a" (correct). Grading
    // must use the frozen submitted snapshot, not the mutable draft.
    const attempt = makeAttempt({
      answers: [
        { questionId: "q1", answer: "x", version: 1, savedAt: new Date() },
      ],
      submittedAnswers: {
        schemaVersion: 1,
        answers: [{ questionId: "q1", value: "a" }],
      },
    });

    const result = computeGradingResult(attempt, exam, new Date());

    expect(result.totalScore).toBe(10);
    expect(result.questionResults[0]?.candidateAnswer).toBe("a");
    expect(result.questionResults[0]?.correct).toBe(true);
  });

  it("falls back to draft answers when submitted_answers is null (legacy)", () => {
    // Pre-L0-2 attempts have a NULL submitted_answers column. Grading must
    // still work during the migration window by reading draft answers.
    const attempt = makeAttempt({
      submittedAnswers: null,
      answers: [
        { questionId: "q1", answer: "a", version: 1, savedAt: new Date() },
      ],
    });

    const result = computeGradingResult(attempt, exam, new Date());

    expect(result.totalScore).toBe(10);
    expect(result.questionResults[0]?.candidateAnswer).toBe("a");
  });

  it("RED #13 — text_response grading reflects submitted_answers, not draft", () => {
    // text_response is manual-graded; the auto-grader returns a zero-score
    // placeholder. But the candidateAnswer captured in the grading result
    // must come from submitted_answers (the frozen value B), NOT from the
    // draft value A. This is the read-path proof for L0-2 §4.4/§6.2.
    const textAttempt: ExamAttempt = {
      ...makeAttempt(),
      questionSnapshot: [
        {
          originalQuestionId: "q-text",
          type: "text_response",
          content: "阐述你的观点",
          contentDocument: null,
          answerMode: null,
          attachments: [],
          options: [],
          standardAnswer: null,
          score: 20,
          gradingRule: {
            multiSelectScoring: "all_correct_full",
            fillBlankMatchMode: "exact",
          },
          order: 0,
          rubric: "按逻辑给分",
        },
      ],
      // Draft still says A (e.g. an in-flight edit before submit locked).
      answers: [
        {
          questionId: "q-text",
          answer: "draft-value-A",
          version: 1,
          savedAt: new Date(),
        },
      ],
      // Frozen submitted snapshot says B — the authoritative answer.
      submittedAnswers: {
        schemaVersion: 1,
        answers: [{ questionId: "q-text", value: "submitted-value-B" }],
      },
    };

    const result = computeGradingResult(textAttempt, exam, new Date());

    expect(result.questionResults[0]?.candidateAnswer).toBe(
      "submitted-value-B",
    );
    // Manual type: auto-grader does not score it; placeholder is 0.
    expect(result.questionResults[0]?.score).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// P0-2 — grading transactional boundary.
//
// @exam/exam-engine depends only on @exam/domain and CANNOT open a transaction
// itself (no @exam/db). Per the repo's established Plan A pattern, the
// transaction is owned by the CALLER (submitAndGradeAttempt TX2,
// autoSubmitAndGrade, attempts.admin force-submit, gradingQueue.ts), which
// wraps finalizeGrading in executeInTransaction with tx-scoped
// repos and a locked attempt row. The engine logic only needs to be provably
// ATOMIC UNDER THAT CONTRACT: a failure after the attempt write must roll the
// attempt write back too (the caller's tx does this), not leave a half-graded
// attempt. These tests prove the contract via a commit/rollback-capable repo
// harness that mirrors executeInTransaction semantics.
// ---------------------------------------------------------------------------

/**
 * Commit/rollback-capable repo harness. Mutations go to a staged buffer; they
 * are promoted to the visible store ONLY when commit() is called. If the work
 * throws before commit, staged writes are discarded — exactly what a real
 * Postgres transaction does for the caller-wrapped grading path. Mirrors the
 * pattern the production callers rely on (executeInTransaction + tx repos).
 */
/**
 * Slice 4 helper: builds an in-memory GradingWorksetRepository whose
 * findByAttempt returns terminal completed_auto entries derived from the
 * canonical auto-grader output for the given attempt/exam. Used by the
 * transactional-boundary tests so finalizeGrading can aggregate.
 */
function makeResultWorksetRepo(
  attempt: ExamAttempt,
  exam: Exam,
  now: Date,
): GradingWorksetRepository {
  const result = computeGradingResult(attempt, exam, now);
  const entries = result.questionResults.map((qr) => ({
    id: `entry-${qr.questionId}`,
    organizationId: attempt.organizationId,
    attemptId: attempt.id,
    questionId: qr.questionId,
    gradingMode: "auto" as const,
    status: "completed_auto" as const,
    maxScore: qr.maxScore,
    earnedScore: qr.score,
    candidateAnswer: qr.candidateAnswer,
    standardAnswer: qr.standardAnswer,
    correct: qr.correct,
    comment: "",
    gradedBy: null,
    gradedAt: null,
    createdAt: now,
    updatedAt: now,
  }));
  return {
    findByAttempt: async (id) =>
      id === attempt.id ? entries.map((e) => ({ ...e })) : [],
    findByAttemptAndQuestion: async () => null,
    bulkCreate: async () => {},
    completeManualEntry: async () => null,
    countPendingManualForAttempt: async () => 0,
  };
}

function makeTransactionalRepos(
  exam: Exam,
  attempt: ExamAttempt,
  enrollment: ExamEnrollment,
) {
  // Committed (visible) state.
  let committedAttempt = attempt;
  let committedEnrollment = enrollment;
  const examRepo: ExamRepository = {
    findById: () => exam,
    findByIdForUpdate: () => exam,
    update: () => exam,
  };

  function scopedRepos() {
    // Per-tx staged overlay; reads fall through to committed state.
    const stagedAttempt: Partial<ExamAttempt> = {};
    const stagedEnrollment: Partial<ExamEnrollment> = {};
    let staged = false;
    const attemptRepo: AttemptRepository = {
      findById: () => ({ ...committedAttempt, ...stagedAttempt }),
      findByIdForUpdate: () => ({ ...committedAttempt, ...stagedAttempt }),
      findActiveByEnrollment: () => null,
      findByEnrollmentAndAttemptNo: () => null,
      create: () => committedAttempt,
      update: (_id, data) => {
        staged = true;
        Object.assign(stagedAttempt, data);
        return { ...committedAttempt, ...stagedAttempt };
      },
      refreshLastActivityIfInProgress: () => ({
        ...committedAttempt,
        ...stagedAttempt,
      }),
    };
    const enrollmentRepo: EnrollmentRepository = {
      findByExamAndCandidate: () => ({
        ...committedEnrollment,
        ...stagedEnrollment,
      }),
      findByExamAndCandidateForUpdate: () => ({
        ...committedEnrollment,
        ...stagedEnrollment,
      }),
      create: () => committedEnrollment,
      update: (_id, data) => {
        staged = true;
        Object.assign(stagedEnrollment, data);
        return { ...committedEnrollment, ...stagedEnrollment };
      },
    };
    return {
      attemptRepo,
      enrollmentRepo,
      commit: () => {
        if (staged) {
          committedAttempt = { ...committedAttempt, ...stagedAttempt };
          committedEnrollment = { ...committedEnrollment, ...stagedEnrollment };
        }
      },
    };
  }

  return {
    examRepo,
    scopedRepos,
    getAttempt: () => committedAttempt,
    getEnrollment: () => committedEnrollment,
  };
}

/**
 * Minimal mirror of the caller's executeInTransaction: run the work in a tx
 * scope; promote staged writes to visible state ONLY on a clean return; on
 * throw, discard them (rollback).
 */
async function runInTransaction<T>(
  harness: ReturnType<typeof makeTransactionalRepos>,
  work: (repos: {
    attemptRepo: AttemptRepository;
    enrollmentRepo: EnrollmentRepository;
  }) => Promise<T>,
): Promise<T> {
  const scope = harness.scopedRepos();
  try {
    const out = await work(scope);
    scope.commit();
    return out;
  } catch (err) {
    // Rollback: staged writes are dropped because commit() was never called.
    throw err;
  }
}

describe("grading transactional boundary (P0-2)", () => {
  const gradedAt = new Date("2026-06-01T12:00:00Z");

  // Case B: under the transactional harness, the happy path commits
  // the full result (attempt graded + enrollment finalized) atomically.
  it("commits the full graded result on success (score/status/enrollment consistent)", async () => {
    const exam = makeExam();
    const attempt = makeAttempt();
    const enrollment = makeEnrollment();
    const harness = makeTransactionalRepos(exam, attempt, enrollment);
    const result = computeResult(attempt, exam, gradedAt);

    await runInTransaction(harness, async (repos) => {
      const cap = await mintCap(
        repos.enrollmentRepo,
        repos.attemptRepo,
        "attempt-1",
      );
      return finalizeGrading(
        repos.enrollmentRepo,
        repos.attemptRepo,
        makeResultWorksetRepo(attempt, exam, gradedAt),
        cap,
        exam,
        gradedAt,
      );
    });

    expect(harness.getAttempt()).toMatchObject({
      status: "graded",
      score: 10,
      passed: true,
      gradedAt,
    });
    expect(harness.getEnrollment()).toMatchObject({
      status: "started",
      finalScore: 10,
      finalPassed: true,
      finalAttemptId: "attempt-1",
    });
  });
});

/** Helper: compute the ScoreResult the way gradeAttemptIdempotent does, for
 * direct finalizeGrading calls in the transactional tests. Reuses the engine's
 * own computeGradingResult so semantics stay identical. */
function computeResult(
  attempt: ExamAttempt,
  exam: Exam,
  now: Date,
): import("@exam/domain").ScoreResult {
  return computeGradingResult(attempt, exam, now);
}

describe("gradeAttemptIdempotent", () => {
  const fixedGradedAt = new Date("2026-06-01T12:00:00Z");

  it("returns the existing ScoreResult without re-grading when already graded", async () => {
    const attempt = makeAttempt({
      status: "graded",
      score: 7,
      passed: true,
      gradedAt: fixedGradedAt,
      gradingResult: [
        {
          questionId: "q1",
          score: 7,
          maxScore: 10,
          correct: true,
          candidateAnswer: "prev-candidate",
          standardAnswer: "a",
        },
      ],
    });
    const repos = makeRepos(makeExam(), attempt, makeEnrollment());
    let updateCalls = 0;
    const spiedAttemptRepo: AttemptRepository = {
      ...repos.attemptRepo,
      update: async (id, data) => {
        updateCalls++;
        return repos.attemptRepo.update(id, data);
      },
    };

    const cap = await mintCap(
      repos.enrollmentRepo,
      spiedAttemptRepo,
      "attempt-1",
    );
    const result = await gradeAttemptIdempotent(
      repos.examRepo,
      repos.enrollmentRepo,
      spiedAttemptRepo,
      repos.worksetRepo,
      cap,
      new Date("2026-06-05T00:00:00Z"),
    );

    expect(result.totalScore).toBe(7);
    expect(result.passed).toBe(true);
    expect(result.gradedAt).toEqual(fixedGradedAt);
    expect(result.questionResults[0]!.candidateAnswer).toBe("prev-candidate");
    expect(updateCalls).toBe(0);
  });

  it("grades normally when attempt is submitted (not yet graded)", async () => {
    const attempt = makeAttempt({ status: "submitted" });
    const repos = makeRepos(makeExam(), attempt, makeEnrollment());

    const cap = await mintCap(
      repos.enrollmentRepo,
      repos.attemptRepo,
      "attempt-1",
    );
    const result = await gradeAttemptIdempotent(
      repos.examRepo,
      repos.enrollmentRepo,
      repos.attemptRepo,
      repos.worksetRepo,
      cap,
      fixedGradedAt,
    );

    expect(result.totalScore).toBe(10);
    expect(result.passed).toBe(true);
    expect(repos.getAttempt().status).toBe("graded");
    expect(repos.getAttempt().gradedAt).toEqual(fixedGradedAt);
  });

  it("rejects attempts in non-submittable/non-graded states (in_progress)", async () => {
    const repos = makeRepos(
      makeExam(),
      makeAttempt({ status: "in_progress" }),
      makeEnrollment(),
    );

    const cap = await mintCap(
      repos.enrollmentRepo,
      repos.attemptRepo,
      "attempt-1",
    );
    await expect(
      gradeAttemptIdempotent(
        repos.examRepo,
        repos.enrollmentRepo,
        repos.attemptRepo,
        repos.worksetRepo,
        cap,
        new Date(),
      ),
    ).rejects.toThrow(InvalidStateTransitionError);
  });

  it("throws ValidationError when attempt not found", async () => {
    const repos = makeRepos(makeExam(), makeAttempt(), makeEnrollment());
    const cap = await mintCap(
      repos.enrollmentRepo,
      repos.attemptRepo,
      "attempt-1",
    );
    const missingAttemptRepo: AttemptRepository = {
      ...repos.attemptRepo,
      findById: () => null,
    };
    await expect(
      gradeAttemptIdempotent(
        repos.examRepo,
        repos.enrollmentRepo,
        missingAttemptRepo,
        repos.worksetRepo,
        cap,
        new Date(),
      ),
    ).rejects.toThrow("Attempt not found");
  });
});

// ── readGradingSnapshot ─────────────────────────────────────────

describe("readGradingSnapshot", () => {
  it("returns attempt, exam, and enrollment for a submitted attempt", async () => {
    const repos = makeRepos(makeExam(), makeAttempt(), makeEnrollment());
    const snapshot = await readGradingSnapshot(
      repos.examRepo,
      repos.enrollmentRepo,
      repos.attemptRepo,
      "attempt-1",
    );

    expect(snapshot).not.toBeNull();
    expect(snapshot!.attempt.status).toBe("submitted");
    expect(snapshot!.exam.id).toBe("exam-1");
    expect(snapshot!.enrollment.id).toBe("enrollment-1");
  });

  it("returns null when attempt does not exist", async () => {
    const attemptRepo: AttemptRepository = {
      findById: () => null,
      findByIdForUpdate: () => null,
      findActiveByEnrollment: () => null,
      findByEnrollmentAndAttemptNo: () => null,
      create: () => makeAttempt(),
      update: () => null,
      refreshLastActivityIfInProgress: () => null,
    };
    const snapshot = await readGradingSnapshot(
      {
        findById: () => makeExam(),
        findByIdForUpdate: () => makeExam(),
        update: () => makeExam(),
      },
      {
        findByExamAndCandidate: () => makeEnrollment(),
        findByExamAndCandidateForUpdate: () => makeEnrollment(),
        create: () => makeEnrollment(),
        update: () => null,
      },
      attemptRepo,
      "nonexistent",
    );
    expect(snapshot).toBeNull();
  });
});

// ── finalizeGrading: idempotency + retake policy ───────────────

describe("finalizeGrading — idempotent replay and retake policy", () => {
  const gradingResult: ScoreResult = {
    attemptId: "attempt-1",
    totalScore: 10,
    passed: true,
    questionResults: [
      {
        questionId: "q1",
        correct: true,
        score: 10,
        maxScore: 10,
        candidateAnswer: "a",
        standardAnswer: "a",
      },
    ],
    gradedAt: new Date("2026-06-01T12:00:00Z"),
  };
  const now = new Date("2026-06-01T12:00:00Z");

  /**
   * Derives a workset repo from an explicit ScoreResult so retake-policy
   * outcomes can be driven independently of the fixture's auto-graded
   * snapshot answer.
   */
  function makeWorksetRepoFromResult(
    result: ScoreResult,
    attemptId = "attempt-1",
  ): GradingWorksetRepository {
    const entries = result.questionResults.map((qr) => ({
      id: `entry-${qr.questionId}`,
      organizationId: "org-1",
      attemptId,
      questionId: qr.questionId,
      gradingMode: "auto" as const,
      status: "completed_auto" as const,
      maxScore: qr.maxScore,
      earnedScore: qr.score,
      candidateAnswer: qr.candidateAnswer,
      standardAnswer: qr.standardAnswer,
      correct: qr.correct,
      comment: "",
      gradedBy: null,
      gradedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    return {
      findByAttempt: async (id) =>
        id === attemptId ? entries.map((e) => ({ ...e })) : [],
      findByAttemptAndQuestion: async () => null,
      bulkCreate: async () => {},
      completeManualEntry: async () => null,
      countPendingManualForAttempt: async () => 0,
    };
  }

  it("is idempotent when attempt is already graded — returns false, does not re-write", async () => {
    const exam = makeExam();
    const repos = makeRepos(
      exam,
      makeAttempt({
        status: "graded",
        score: 10,
        passed: true,
      }),
      makeEnrollment({ finalScore: 10, finalPassed: true }),
    );

    let updateCalled = false;
    const trackingAttemptRepo: AttemptRepository = {
      ...repos.attemptRepo,
      update: (...args: Parameters<typeof repos.attemptRepo.update>) => {
        updateCalled = true;
        return repos.attemptRepo.update(...args);
      },
    };
    let enrollmentUpdateCalled = false;
    const trackingEnrollmentRepo: EnrollmentRepository = {
      ...repos.enrollmentRepo,
      update: (...args: Parameters<typeof repos.enrollmentRepo.update>) => {
        enrollmentUpdateCalled = true;
        return repos.enrollmentRepo.update(...args);
      },
    };

    const cap = await mintCap(
      trackingEnrollmentRepo,
      trackingAttemptRepo,
      "attempt-1",
    );
    const result = await finalizeGrading(
      trackingEnrollmentRepo,
      trackingAttemptRepo,
      repos.worksetRepo,
      cap,
      exam,
      now,
    );

    expect(result).toBe(false);
    expect(updateCalled).toBe(false);
    expect(enrollmentUpdateCalled).toBe(false);
  });

  it("keeps enrollment started when max_attempts not exhausted", async () => {
    const exam = {
      ...makeExam(),
      retakePolicy: "max_attempts" as const,
      maxAttempts: 3,
    };
    const repos = makeRepos(
      exam,
      makeAttempt({ status: "submitted" }),
      makeEnrollment({ attemptCount: 2 }),
    );

    const cap = await mintCap(
      repos.enrollmentRepo,
      repos.attemptRepo,
      "attempt-1",
    );
    await finalizeGrading(
      repos.enrollmentRepo,
      repos.attemptRepo,
      makeWorksetRepoFromResult(gradingResult),
      cap,
      exam,
      now,
    );

    expect(repos.getEnrollment().status).toBe("started");
  });

  it("marks enrollment completed when max_attempts exhausted", async () => {
    const exam = {
      ...makeExam(),
      retakePolicy: "max_attempts" as const,
      maxAttempts: 2,
    };
    const repos = makeRepos(
      exam,
      makeAttempt({ status: "submitted" }),
      makeEnrollment({ attemptCount: 2 }),
    );

    const cap = await mintCap(
      repos.enrollmentRepo,
      repos.attemptRepo,
      "attempt-1",
    );
    await finalizeGrading(
      repos.enrollmentRepo,
      repos.attemptRepo,
      makeWorksetRepoFromResult(gradingResult),
      cap,
      exam,
      now,
    );

    expect(repos.getEnrollment().status).toBe("completed");
  });

  it("marks enrollment completed when pass_then_stop and passed", async () => {
    const exam = { ...makeExam(), retakePolicy: "pass_then_stop" as const };
    const repos = makeRepos(
      exam,
      makeAttempt({ status: "submitted" }),
      makeEnrollment({ attemptCount: 1 }),
    );

    const cap = await mintCap(
      repos.enrollmentRepo,
      repos.attemptRepo,
      "attempt-1",
    );
    await finalizeGrading(
      repos.enrollmentRepo,
      repos.attemptRepo,
      makeWorksetRepoFromResult(gradingResult),
      cap,
      exam,
      now,
    );

    expect(repos.getEnrollment().status).toBe("completed");
  });

  it("keeps enrollment started when pass_then_stop but not passed", async () => {
    const failResult: ScoreResult = {
      ...gradingResult,
      passed: false,
      totalScore: 3,
      questionResults: [
        {
          questionId: "q1",
          correct: false,
          score: 3,
          maxScore: 10,
          candidateAnswer: "a",
          standardAnswer: "a",
        },
      ],
    };
    const exam = { ...makeExam(), retakePolicy: "pass_then_stop" as const };
    const repos = makeRepos(
      exam,
      makeAttempt({ status: "submitted" }),
      makeEnrollment({ attemptCount: 1 }),
    );

    const cap = await mintCap(
      repos.enrollmentRepo,
      repos.attemptRepo,
      "attempt-1",
    );
    await finalizeGrading(
      repos.enrollmentRepo,
      repos.attemptRepo,
      makeWorksetRepoFromResult(failResult),
      cap,
      exam,
      now,
    );

    expect(repos.getEnrollment().status).toBe("started");
  });
});

// ── shouldEnrollmentComplete ────────────────────────────────────

describe("shouldEnrollmentComplete", () => {
  const baseExam = makeExam();
  const baseEnrollment = makeEnrollment();
  const now = new Date("2026-06-01T12:00:00Z");

  it("returns false for unlimited retake with window still open", () => {
    expect(
      shouldEnrollmentComplete(
        { ...baseExam, retakePolicy: "unlimited" },
        { ...baseEnrollment, attemptCount: 5 },
        false,
        now,
      ),
    ).toBe(false);
  });

  it("returns true for max_attempts when attemptCount >= maxAttempts", () => {
    expect(
      shouldEnrollmentComplete(
        { ...baseExam, retakePolicy: "max_attempts", maxAttempts: 2 },
        { ...baseEnrollment, attemptCount: 2 },
        false,
        now,
      ),
    ).toBe(true);
  });

  it("returns false for max_attempts when attemptCount < maxAttempts", () => {
    expect(
      shouldEnrollmentComplete(
        { ...baseExam, retakePolicy: "max_attempts", maxAttempts: 3 },
        { ...baseEnrollment, attemptCount: 2 },
        false,
        now,
      ),
    ).toBe(false);
  });

  it("returns true for pass_then_stop when graded attempt passed", () => {
    expect(
      shouldEnrollmentComplete(
        { ...baseExam, retakePolicy: "pass_then_stop" },
        baseEnrollment,
        true,
        now,
      ),
    ).toBe(true);
  });

  it("returns false for pass_then_stop when graded attempt did not pass", () => {
    expect(
      shouldEnrollmentComplete(
        { ...baseExam, retakePolicy: "pass_then_stop" },
        baseEnrollment,
        false,
        now,
      ),
    ).toBe(false);
  });

  it("returns true for pass_then_stop when a previous attempt already passed even if the current one fails", () => {
    // Names the `enrollment.finalPassed === true` disjunct in grading.ts.
    // A candidate who passed once, then re-attempted and failed, must still
    // be treated as completed under pass_then_stop.
    expect(
      shouldEnrollmentComplete(
        { ...baseExam, retakePolicy: "pass_then_stop" },
        { ...baseEnrollment, finalPassed: true },
        false,
        now,
      ),
    ).toBe(true);
  });

  it("returns true when exam window has closed", () => {
    expect(
      shouldEnrollmentComplete(
        { ...baseExam, retakePolicy: "unlimited" },
        baseEnrollment,
        false,
        new Date("2026-06-03T00:00:00Z"),
      ),
    ).toBe(true);
  });

  it("returns false for an untimed exam (closeAt null) — no window cutoff can ever complete it", () => {
    // #291 Phase A: untimed exams have no close cutoff; only the retake rules
    // above can complete the enrollment. Any `now` must keep it started.
    expect(
      shouldEnrollmentComplete(
        { ...baseExam, retakePolicy: "unlimited", closeAt: null },
        baseEnrollment,
        false,
        new Date("9999-01-01T00:00:00Z"),
      ),
    ).toBe(false);
  });
});
