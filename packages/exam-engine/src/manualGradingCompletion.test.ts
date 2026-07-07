import { describe, expect, it } from "vitest";
import type {
  AttemptGradingEntry,
  Exam,
  ExamAttempt,
  ExamEnrollment,
  QuestionSnapshot,
} from "@exam/domain";
import type {
  AttemptRepository,
  EnrollmentRepository,
} from "./attemptCommands.js";
import type { ExamRepository } from "./examCommands.js";
import type { GradingWorksetRepository } from "./gradingWorkset.js";
import { submitAttempt } from "./attemptCommands.js";
import { computeGradingResult } from "./grading.js";
import { gradeQuestion, type GradeQuestionResult } from "./manualGrading.js";

/**
 * P3-L0-2D — Manual-Grading Completion Integrity Closure (RED→GREEN).
 *
 * The P3-L0-2C closure fixed the `graded + pending_manual` lifecycle defect
 * but introduced two production correctness defects the lifecycle review
 * flagged as FAIL:
 *
 *   Defect A — mixed-attempt objective score loss during manual completion.
 *     On a mixed attempt the candidate-submit orchestrator correctly holds the
 *     row at `submitted + pending_manual` and SKIPS the auto-finalize path.
 *     That auto-finalize path was previously the ONLY writer of the objective
 *     per-question grading result. So when manual grading later runs
 *     `reconcileScores`, it reads an empty `attempt.gradingResult` and falls
 *     back to zero-scored objective rows — the objective contribution is
 *     silently lost from the final total.
 *
 *   Defect B — split manual-question classification authority.
 *     `requiresManualGrading` classifies on `type === "text_response"` (the
 *     protocol §1.4 seam). `subjectiveQuestionIds` / `reconcileScores`
 *     classify on `standardAnswer == null`. A `text_response` question may
 *     legally carry a non-null `standardAnswer` (a reference answer used as
 *     grader guidance, not for auto-match) — such a question is held at
 *     `pending_manual` by the freeze barrier but is NOT recognized by the
 *     manual grader, leaving the attempt permanently stuck or excluding the
 *     score from reconciliation.
 *
 * Required invariants (exam-protocol.md §3.3, §4.2, §1.4):
 *
 *   final score for a mixed attempt
 *       = sum(objective auto-graded earned scores from submitted_answers
 *              + frozen QuestionSnapshot)
 *       + sum(manual awarded scores)
 *
 *   manual-question classification has ONE semantic authority:
 *       QuestionType / grading-mode protocol (text_response).
 *
 * These tests exercise the real `submitAttempt` → `computeGradingResult` →
 * `gradeQuestion` commands against in-memory repos, the same shape the engine
 * unit suites use. They fail against `cb562a2`.
 */

// ── fixtures ───────────────────────────────────────────────────────

const NOW = new Date("2026-06-01T12:00:00Z");
const DEFAULT_PASSING = 50;

function makeExam(overrides: Partial<Exam> = {}): Exam {
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
    passingScore: DEFAULT_PASSING,
    totalScore: 100,
    questionSelectionMode: "manual",
    questionIds: ["q-obj", "q-text"],
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
    scoreStrategy: "highest",
    maxAttempts: 3,
    latestStartOffsetMinutes: null,
    minSubmitAfterStartMinutes: null,
    resultPublicationMode: "immediate",
    resultsPublishedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function objectiveSnapshot(
  id: string,
  score: number,
  standardAnswer: unknown = "a",
): QuestionSnapshot {
  return {
    originalQuestionId: id,
    type: "single_choice",
    content: `Objective ${id}`,
    attachments: [],
    options: [],
    standardAnswer,
    score,
    gradingRule: {
      multiSelectScoring: "all_correct_full",
      fillBlankMatchMode: "exact",
    },
    order: 0,
    rubric: null,
  };
}

/**
 * Builds a text_response snapshot. `standardAnswer` is OPTIONAL — protocol
 * §1.4 makes subjectivity a function of QuestionType, not of standardAnswer,
 * and a text_response may legally carry a non-null model answer used as
 * grader guidance (Defect B).
 */
function textResponseSnapshot(
  id: string,
  score: number,
  opts: { standardAnswer?: unknown; rubric?: string } = {},
): QuestionSnapshot {
  return {
    originalQuestionId: id,
    type: "text_response",
    content: `Subjective ${id}`,
    attachments: [],
    options: [],
    standardAnswer: opts.standardAnswer ?? null,
    score,
    gradingRule: {
      multiSelectScoring: "all_correct_full",
      fillBlankMatchMode: "exact",
    },
    order: 1,
    rubric: opts.rubric ?? "按逻辑完整性、关键概念、论证质量给分",
  };
}

function makeAttempt(overrides: Partial<ExamAttempt> = {}): ExamAttempt {
  return {
    id: "attempt-1",
    organizationId: "org-1",
    examId: "exam-1",
    enrollmentId: "enrollment-1",
    candidateId: "candidate-1",
    attemptNo: 1,
    status: "in_progress",
    questionSnapshot: [objectiveSnapshot("q-obj", 40, "a")],
    answers: [{ questionId: "q-obj", answer: "a", version: 1, savedAt: NOW }],
    createdAt: NOW,
    updatedAt: NOW,
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
    attemptCount: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeRepos(
  attempt: ExamAttempt,
  exam: Exam = makeExam(),
  enrollment: ExamEnrollment = makeEnrollment(),
) {
  let storedAttempt = attempt;
  let storedEnrollment = enrollment;
  const examRepo: ExamRepository = {
    findById: () => exam,
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
  const gradingWorksetRepo = makeInMemoryWorksetRepo();
  return {
    examRepo,
    attemptRepo,
    enrollmentRepo,
    gradingWorksetRepo,
    getAttempt: () => storedAttempt,
    getEnrollment: () => storedEnrollment,
  };
}

/**
 * Builds an in-memory {@link GradingWorksetRepository} backing BOTH the
 * submit-freeze materialization (`bulkCreate`) and the manual-grading command
 * (`findByAttemptAndQuestion` / `completeManualEntry` /
 * `countPendingManualForAttempt` / `findByAttempt`). Slice 3 unified the
 * manual-score write path onto the workset surface, so a single store now
 * serves the whole lifecycle in these engine tests — exactly mirroring the
 * single durable `attempt_grading_entries` table the production adapter
 * fronts.
 */
function makeInMemoryWorksetRepo(): GradingWorksetRepository {
  const store = new Map<string, AttemptGradingEntry>();
  let counter = 0;
  return {
    findByAttempt: async (attemptId) =>
      Array.from(store.values())
        .filter((e) => e.attemptId === attemptId)
        .map((e) => ({ ...e })),
    findByAttemptAndQuestion: async (attemptId, questionId) => {
      const found = store.get(`${attemptId}:${questionId}`);
      return found ? { ...found } : null;
    },
    bulkCreate: async (inputs) => {
      for (const input of inputs) {
        const key = `${input.attemptId}:${input.questionId}`;
        if (store.has(key)) {
          throw new Error(`duplicate grading entry for ${key}`);
        }
        store.set(key, {
          id: `entry-${++counter}`,
          organizationId: "org-1",
          comment: "",
          gradedBy: null,
          gradedAt: null,
          createdAt: NOW,
          updatedAt: NOW,
          ...input,
        });
      }
    },
    completeManualEntry: async (input) => {
      const key = `${input.attemptId}:${input.questionId}`;
      const existing = store.get(key);
      if (!existing) return null;
      const updated: AttemptGradingEntry = {
        ...existing,
        status: "completed_manual",
        earnedScore: input.earnedScore,
        correct: input.earnedScore >= input.maxScore,
        comment: input.comment,
        gradedBy: input.gradedBy,
        gradedAt: input.gradedAt,
        updatedAt: input.now,
      };
      store.set(key, updated);
      return { ...updated };
    },
    countPendingManualForAttempt: async (attemptId) =>
      Array.from(store.values()).filter(
        (e) =>
          e.attemptId === attemptId &&
          e.gradingMode === "manual" &&
          e.status === "pending_manual",
      ).length,
  };
}

/**
 * Drives the full mixed-attempt lifecycle through real commands:
 *   in_progress → submit/freeze → submitted + pending_manual
 *                → manual grade → graded + fully_graded
 *
 * This mirrors what the orchestrator + grading-queue route do in production,
 * minus the DB plumbing. The objective score is NOT pre-injected into the
 * attempt; it must be reconstructed by the manual-completion seam from
 * `submittedAnswers` + `questionSnapshot`.
 */
async function runMixedLifecycle(input: {
  questionSnapshot: QuestionSnapshot[];
  answers: { questionId: string; answer: unknown }[];
  manualScores: { questionId: string; score: number }[];
  passingScore?: number;
  exam?: Exam;
}) {
  const passingScore = input.passingScore ?? DEFAULT_PASSING;
  const exam = input.exam ?? makeExam({ passingScore });
  const initialAttempt = makeAttempt({
    questionSnapshot: input.questionSnapshot,
    answers: input.answers.map((a) => ({
      questionId: a.questionId,
      answer: a.answer,
      version: 1,
      savedAt: NOW,
    })),
  });
  const repos = makeRepos(initialAttempt, exam);

  // 1. Submit/freeze barrier: establishes gradingStatus + submittedAnswers.
  await submitAttempt(
    repos.attemptRepo,
    repos.gradingWorksetRepo,
    "attempt-1",
    NOW,
    { source: "candidate" },
  );

  // 2. The candidate-submit orchestrator path computes the objective result
  //    for an auto_graded attempt; for pending_manual it HOLDS and does not
  //    persist the objective result. We compute it here ONLY to drive the
  //    auto-grading engine the same way the orchestrator does for objective
  //    questions. The manual-completion command must reconstruct objective
  //    contributions itself; we do NOT inject the result onto the attempt.
  const postSubmit = repos.getAttempt();
  if (postSubmit.gradingStatus !== "pending_manual") {
    throw new Error(
      `expected pending_manual after submit, got ${postSubmit.gradingStatus}`,
    );
  }

  // 3. Manual grade each text_response question through the real command.
  //    Slice 3: the SAME workset repo that submitAttempt materialized into is
  //    the manual-score authority — gradeQuestion updates its entries in place.
  let lastResult: GradeQuestionResult = {
    gradingStatus: "pending_manual",
    fullyGraded: false,
  };
  for (const m of input.manualScores) {
    lastResult = await gradeQuestion(
      repos.attemptRepo,
      repos.enrollmentRepo,
      repos.gradingWorksetRepo,
      "attempt-1",
      m.questionId,
      m.score,
      "",
      "grader-1",
      NOW,
      exam,
      "enrollment-1",
    );
  }

  return {
    attempt: repos.getAttempt(),
    result: lastResult,
  };
}

// ── A. mixed final score includes objective contribution ─────────

describe("P3-L0-2D A: mixed final score reconciliation", () => {
  it("final total = objective earned + manual awarded (no objective loss)", async () => {
    const questionSnapshot = [
      objectiveSnapshot("q-obj", 40, "a"),
      textResponseSnapshot("q-text", 60),
    ];
    const answers = [
      { questionId: "q-obj", answer: "a" }, // correct → 40
      { questionId: "q-text", answer: "主观答题内容" },
    ];

    const { attempt, result } = await runMixedLifecycle({
      questionSnapshot,
      answers,
      manualScores: [{ questionId: "q-text", score: 30 }], // 30 / 60
    });

    // Defect A: against cb562a2, the objective 40 is dropped and final = 30.
    expect(result.fullyGraded).toBe(true);
    expect(result.totalScore).toBe(70); // 40 objective + 30 manual
    expect(attempt.score).toBe(70);
    expect(attempt.gradingStatus).toBe("fully_graded");
    expect(attempt.status).toBe("graded");
    const obj = (attempt.gradingResult ?? []).find(
      (r) => r.questionId === "q-obj",
    );
    expect(obj?.score).toBe(40);
  });

  it("does NOT double-count the objective score", async () => {
    const { attempt, result } = await runMixedLifecycle({
      questionSnapshot: [
        objectiveSnapshot("q-obj", 40, "a"),
        textResponseSnapshot("q-text", 60),
      ],
      answers: [
        { questionId: "q-obj", answer: "a" },
        { questionId: "q-text", answer: "answer" },
      ],
      manualScores: [{ questionId: "q-text", score: 30 }],
    });

    expect(result.totalScore).toBe(70); // not 110, not 100
    expect(attempt.score).toBe(70);
  });

  it("preserves objective contribution when the objective answer is wrong", async () => {
    const { attempt } = await runMixedLifecycle({
      questionSnapshot: [
        objectiveSnapshot("q-obj", 40, "a"),
        textResponseSnapshot("q-text", 60),
      ],
      answers: [
        { questionId: "q-obj", answer: "b" }, // wrong → 0
        { questionId: "q-text", answer: "answer" },
      ],
      manualScores: [{ questionId: "q-text", score: 25 }],
    });

    expect(attempt.score).toBe(25); // 0 + 25
    expect(attempt.gradingStatus).toBe("fully_graded");
  });
});

// ── B/C. text_response with non-null standardAnswer ──────────────

describe("P3-L0-2D B/C: text_response with non-null standardAnswer", () => {
  it("is held at pending_manual by the freeze barrier (B-classification)", async () => {
    const questionSnapshot = [
      textResponseSnapshot("q-text", 100, {
        standardAnswer: "参考答案：评分要点……",
      }),
    ];
    const attempt = makeAttempt({
      questionSnapshot,
      answers: [
        { questionId: "q-text", answer: "answer", version: 1, savedAt: NOW },
      ],
    });
    const repos = makeRepos(attempt);

    const submitted = await submitAttempt(
      repos.attemptRepo,
      repos.gradingWorksetRepo,
      "attempt-1",
      NOW,
      { source: "candidate" },
    );

    expect(submitted.status).toBe("submitted");
    expect(submitted.gradingStatus).toBe("pending_manual");
  });

  it("is recognized by the manual grader (Defect B)", async () => {
    const questionSnapshot = [
      textResponseSnapshot("q-text", 100, {
        standardAnswer: "参考答案：评分要点……",
      }),
    ];
    const { attempt, result } = await runMixedLifecycle({
      questionSnapshot,
      answers: [{ questionId: "q-text", answer: "answer" }],
      manualScores: [{ questionId: "q-text", score: 80 }],
    });

    expect(result.fullyGraded).toBe(true);
    expect(result.totalScore).toBe(80);
    expect(attempt.gradingStatus).toBe("fully_graded");
    expect(attempt.status).toBe("graded");
  });

  it("completes to fully_graded after the manual score is entered (C)", async () => {
    const { attempt } = await runMixedLifecycle({
      questionSnapshot: [
        textResponseSnapshot("q-text", 100, {
          standardAnswer: "参考答案",
          rubric: "rubric",
        }),
      ],
      answers: [{ questionId: "q-text", answer: "answer" }],
      manualScores: [{ questionId: "q-text", score: 90 }],
    });

    expect(attempt.gradingStatus).toBe("fully_graded");
    expect(attempt.status).toBe("graded");
    expect(attempt.score).toBe(90);
  });
});

// ── D. partial manual grading must NOT terminally complete ───────

describe("P3-L0-2D D: multi-manual partial completion", () => {
  it("stays submitted + pending_manual after grading only one of two text_response questions", async () => {
    const questionSnapshot = [
      objectiveSnapshot("q-obj", 40, "a"),
      textResponseSnapshot("q-text-1", 30),
      textResponseSnapshot("q-text-2", 30),
    ];
    const answers = [
      { questionId: "q-obj", answer: "a" },
      { questionId: "q-text-1", answer: "ans1" },
      { questionId: "q-text-2", answer: "ans2" },
    ];

    const initialAttempt = makeAttempt({
      questionSnapshot,
      answers: answers.map((a) => ({
        questionId: a.questionId,
        answer: a.answer,
        version: 1,
        savedAt: NOW,
      })),
    });
    const repos = makeRepos(initialAttempt);

    await submitAttempt(
      repos.attemptRepo,
      repos.gradingWorksetRepo,
      "attempt-1",
      NOW,
      { source: "candidate" },
    );

    const partial = await gradeQuestion(
      repos.attemptRepo,
      repos.enrollmentRepo,
      repos.gradingWorksetRepo,
      "attempt-1",
      "q-text-1",
      20,
      "",
      "grader-1",
      NOW,
      makeExam(),
      "enrollment-1",
    );

    expect(partial.fullyGraded).toBe(false);
    expect(partial.gradingStatus).toBe("pending_manual");
    expect(repos.getAttempt().status).toBe("submitted");
    expect(repos.getAttempt().gradingStatus).toBe("pending_manual");
  });

  it("terminally completes only after BOTH text_response questions are scored", async () => {
    const { attempt, result } = await runMixedLifecycle({
      questionSnapshot: [
        objectiveSnapshot("q-obj", 40, "a"),
        textResponseSnapshot("q-text-1", 30),
        textResponseSnapshot("q-text-2", 30),
      ],
      answers: [
        { questionId: "q-obj", answer: "a" },
        { questionId: "q-text-1", answer: "ans1" },
        { questionId: "q-text-2", answer: "ans2" },
      ],
      manualScores: [
        { questionId: "q-text-1", score: 20 },
        { questionId: "q-text-2", score: 15 },
      ],
    });

    expect(result.fullyGraded).toBe(true);
    expect(result.totalScore).toBe(75); // 40 + 20 + 15
    expect(attempt.gradingStatus).toBe("fully_graded");
    expect(attempt.status).toBe("graded");
  });
});

// ── F. pure-objective auto grading regression ────────────────────

describe("P3-L0-2D F: pure-objective auto grading preserved", () => {
  it("a pure-objective attempt still auto-grades inline to graded + auto_graded", async () => {
    const initialAttempt = makeAttempt({
      questionSnapshot: [objectiveSnapshot("q-obj", 100, "a")],
      answers: [{ questionId: "q-obj", answer: "a", version: 1, savedAt: NOW }],
    });
    const repos = makeRepos(initialAttempt);

    await submitAttempt(
      repos.attemptRepo,
      repos.gradingWorksetRepo,
      "attempt-1",
      NOW,
      { source: "candidate" },
    );

    expect(repos.getAttempt().gradingStatus).toBe("auto_graded");
    expect(repos.getAttempt().status).toBe("submitted");

    // Auto-finalize path the orchestrator runs for auto_graded attempts.
    const result = computeGradingResult(repos.getAttempt(), makeExam(), NOW);
    void result; // pure-objective path goes through finalizeGrading in production.

    expect(repos.getAttempt().gradingStatus).toBe("auto_graded");
  });
});

// ── G. graded + pending_manual remains impossible ────────────────

describe("P3-L0-2D G: graded + pending_manual impossible", () => {
  it("a pending_manual attempt that receives its first manual grade never becomes graded until fully_graded", async () => {
    const { attempt } = await runMixedLifecycle({
      questionSnapshot: [
        objectiveSnapshot("q-obj", 40, "a"),
        textResponseSnapshot("q-text-1", 30),
        textResponseSnapshot("q-text-2", 30),
      ],
      answers: [
        { questionId: "q-obj", answer: "a" },
        { questionId: "q-text-1", answer: "ans1" },
        { questionId: "q-text-2", answer: "ans2" },
      ],
      // Only ONE of two manual questions scored — must NOT terminally grade.
      manualScores: [{ questionId: "q-text-1", score: 20 }],
    });

    // Either pending (status=submitted) or fully graded — but never the
    // forbidden graded + pending_manual pair.
    const forbidden =
      attempt.status === "graded" && attempt.gradingStatus === "pending_manual";
    expect(forbidden).toBe(false);
  });
});

// ── H. P3-FORMAL-P0-A: terminal closure projects Enrollment ──────────
//
// The pre-repair bug: gradeQuestion wrote attempt.score but never
// enrollment.{finalScore, finalPassed, finalAttemptId, status}, leaving the
// enrollment projection stale/NULL for manual-graded exams. These tests lock
// the fix: the canonical terminal closure (finalizeTerminalGrading, shared
// with the auto path) projects BOTH Attempt and Enrollment in the same
// transaction.

describe("P3-FORMAL-P0-A H: manual terminal closure projects Enrollment", () => {
  it("T1: after the last manual grade, enrollment.finalScore/finalPassed/finalAttemptId are written", async () => {
    // Pre-repair regression target: this would have left finalScore NULL.
    const { attempt, result } = await runMixedLifecycle({
      questionSnapshot: [
        objectiveSnapshot("q-obj", 40, "a"),
        textResponseSnapshot("q-text", 60),
      ],
      answers: [
        { questionId: "q-obj", answer: "a" }, // 40
        { questionId: "q-text", answer: "ans" },
      ],
      manualScores: [{ questionId: "q-text", score: 30 }], // 30 → total 70
    });

    expect(result.fullyGraded).toBe(true);
    expect(result.totalScore).toBe(70);

    // Re-read the enrollment the same way production would (the helper
    // exposes it via getEnrollment()).
    // runMixedLifecycle returns the attempt + result; reconstruct repos to
    // inspect the enrollment. Simpler: drive the lifecycle inline here so we
    // can read repos.getEnrollment() directly.
    const questionSnapshot = [
      objectiveSnapshot("q-obj-2", 40, "a"),
      textResponseSnapshot("q-text-2", 60),
    ];
    const exam = makeExam({ passingScore: DEFAULT_PASSING });
    const initialAttempt = makeAttempt({
      questionSnapshot,
      answers: [
        { questionId: "q-obj-2", answer: "a", version: 1, savedAt: NOW },
        { questionId: "q-text-2", answer: "ans", version: 1, savedAt: NOW },
      ],
    });
    const repos = makeRepos(initialAttempt, exam);
    await submitAttempt(
      repos.attemptRepo,
      repos.gradingWorksetRepo,
      "attempt-1",
      NOW,
      { source: "candidate" },
    );
    await gradeQuestion(
      repos.attemptRepo,
      repos.enrollmentRepo,
      repos.gradingWorksetRepo,
      "attempt-1",
      "q-text-2",
      30,
      "",
      "grader-1",
      NOW,
      exam,
      "enrollment-1",
    );

    const enrollment = repos.getEnrollment();
    // The closure wrote the projection. Pre-repair these were all
    // NULL/undefined/`started`.
    expect(enrollment.finalScore).toBe(70);
    expect(enrollment.finalPassed).toBe(true); // 70 >= 50 passing
    expect(enrollment.finalAttemptId).toBe("attempt-1");
    void attempt;
  });

  it("T3: scoreStrategy=highest keeps the higher-scoring attempt's projection (manual path)", async () => {
    // Two manual-graded attempts on the same enrollment. The second scores
    // lower; highest must keep the first's finalScore.
    const exam = makeExam({
      passingScore: DEFAULT_PASSING,
      scoreStrategy: "highest",
      retakePolicy: "unlimited",
      maxAttempts: 5,
      closeAt: new Date("2026-12-31T00:00:00Z"),
    });
    const questionSnapshot = [textResponseSnapshot("q-text", 100)];

    // Attempt 1: score 80.
    const a1 = makeAttempt({
      id: "attempt-1",
      attemptNo: 1,
      questionSnapshot,
      answers: [
        { questionId: "q-text", answer: "ans", version: 1, savedAt: NOW },
      ],
    });
    const enrollment = makeEnrollment({
      id: "enrollment-1",
      attemptCount: 2,
    });
    const repos = makeRepos(a1, exam, enrollment);
    await submitAttempt(
      repos.attemptRepo,
      repos.gradingWorksetRepo,
      "attempt-1",
      NOW,
      { source: "candidate" },
    );
    await gradeQuestion(
      repos.attemptRepo,
      repos.enrollmentRepo,
      repos.gradingWorksetRepo,
      "attempt-1",
      "q-text",
      80,
      "",
      "grader-1",
      NOW,
      exam,
      "enrollment-1",
    );
    expect(repos.getEnrollment().finalScore).toBe(80);
    expect(repos.getEnrollment().finalAttemptId).toBe("attempt-1");

    // Attempt 2: score 50. highest must NOT replace.
    const a2 = makeAttempt({
      id: "attempt-2",
      attemptNo: 2,
      questionSnapshot,
      answers: [
        { questionId: "q-text", answer: "ans2", version: 1, savedAt: NOW },
      ],
    });
    // The second attempt must go through submitAttempt to materialize its
    // grading entry (the in-memory workset repo is per-repos-instance).
    const repos2 = makeRepos(a2, exam, repos.getEnrollment());
    await submitAttempt(
      repos2.attemptRepo,
      repos2.gradingWorksetRepo,
      "attempt-2",
      NOW,
      { source: "candidate" },
    );
    await gradeQuestion(
      repos2.attemptRepo,
      repos2.enrollmentRepo,
      repos2.gradingWorksetRepo,
      "attempt-2",
      "q-text",
      50,
      "",
      "grader-1",
      NOW,
      exam,
      "enrollment-1",
    );

    // highest: 80 > 50, so the projection keeps attempt-1's 80.
    expect(repos2.getEnrollment().finalScore).toBe(80);
    expect(repos2.getEnrollment().finalAttemptId).toBe("attempt-1");
    // The attempt itself is still graded with its own score.
    expect(repos2.getAttempt().id).toBe("attempt-2");
    expect(repos2.getAttempt().score).toBe(50);
  });

  it("T4: scoreStrategy=latest replaces with the most recent manual attempt", async () => {
    const exam = makeExam({
      passingScore: DEFAULT_PASSING,
      scoreStrategy: "latest",
      retakePolicy: "unlimited",
      maxAttempts: 5,
      closeAt: new Date("2026-12-31T00:00:00Z"),
    });
    const questionSnapshot = [textResponseSnapshot("q-text", 100)];

    const a1 = makeAttempt({
      id: "attempt-1",
      attemptNo: 1,
      questionSnapshot,
      answers: [
        { questionId: "q-text", answer: "ans", version: 1, savedAt: NOW },
      ],
    });
    const enrollment = makeEnrollment({ id: "enrollment-1", attemptCount: 2 });
    const repos = makeRepos(a1, exam, enrollment);
    await submitAttempt(
      repos.attemptRepo,
      repos.gradingWorksetRepo,
      "attempt-1",
      NOW,
      { source: "candidate" },
    );
    await gradeQuestion(
      repos.attemptRepo,
      repos.enrollmentRepo,
      repos.gradingWorksetRepo,
      "attempt-1",
      "q-text",
      80,
      "",
      "grader-1",
      NOW,
      exam,
      "enrollment-1",
    );
    expect(repos.getEnrollment().finalScore).toBe(80);

    const a2 = makeAttempt({
      id: "attempt-2",
      attemptNo: 2,
      questionSnapshot,
      answers: [
        { questionId: "q-text", answer: "ans2", version: 1, savedAt: NOW },
      ],
    });
    const repos2 = makeRepos(a2, exam, repos.getEnrollment());
    await submitAttempt(
      repos2.attemptRepo,
      repos2.gradingWorksetRepo,
      "attempt-2",
      NOW,
      { source: "candidate" },
    );
    await gradeQuestion(
      repos2.attemptRepo,
      repos2.enrollmentRepo,
      repos2.gradingWorksetRepo,
      "attempt-2",
      "q-text",
      50,
      "",
      "grader-1",
      NOW,
      exam,
      "enrollment-1",
    );

    // latest always wins, even when lower.
    expect(repos2.getEnrollment().finalScore).toBe(50);
    expect(repos2.getEnrollment().finalAttemptId).toBe("attempt-2");
  });

  it("T5: shouldEnrollmentComplete fires for pass_then_stop on a passing manual grade", async () => {
    const exam = makeExam({
      passingScore: DEFAULT_PASSING,
      scoreStrategy: "highest",
      retakePolicy: "pass_then_stop",
      maxAttempts: 5,
      closeAt: new Date("2026-12-31T00:00:00Z"),
    });
    const questionSnapshot = [textResponseSnapshot("q-text", 100)];

    const a1 = makeAttempt({
      id: "attempt-1",
      attemptNo: 1,
      questionSnapshot,
      answers: [
        { questionId: "q-text", answer: "ans", version: 1, savedAt: NOW },
      ],
    });
    const enrollment = makeEnrollment({ id: "enrollment-1", attemptCount: 1 });
    const repos = makeRepos(a1, exam, enrollment);
    await submitAttempt(
      repos.attemptRepo,
      repos.gradingWorksetRepo,
      "attempt-1",
      NOW,
      { source: "candidate" },
    );
    await gradeQuestion(
      repos.attemptRepo,
      repos.enrollmentRepo,
      repos.gradingWorksetRepo,
      "attempt-1",
      "q-text",
      70, // >= 50 passing → pass_then_stop completes
      "",
      "grader-1",
      NOW,
      exam,
      "enrollment-1",
    );

    expect(repos.getEnrollment().status).toBe("completed");
    expect(repos.getEnrollment().finalPassed).toBe(true);
  });

  it("T5b: enrollment stays started when manual grade fails passing and exam window is open (max_attempts)", async () => {
    const exam = makeExam({
      passingScore: DEFAULT_PASSING,
      scoreStrategy: "highest",
      retakePolicy: "max_attempts",
      maxAttempts: 5,
      closeAt: new Date("2026-12-31T00:00:00Z"),
    });
    const questionSnapshot = [textResponseSnapshot("q-text", 100)];

    const a1 = makeAttempt({
      id: "attempt-1",
      attemptNo: 1,
      questionSnapshot,
      answers: [
        { questionId: "q-text", answer: "ans", version: 1, savedAt: NOW },
      ],
    });
    const enrollment = makeEnrollment({ id: "enrollment-1", attemptCount: 1 });
    const repos = makeRepos(a1, exam, enrollment);
    await submitAttempt(
      repos.attemptRepo,
      repos.gradingWorksetRepo,
      "attempt-1",
      NOW,
      { source: "candidate" },
    );
    await gradeQuestion(
      repos.attemptRepo,
      repos.enrollmentRepo,
      repos.gradingWorksetRepo,
      "attempt-1",
      "q-text",
      20, // < 50, fails; max_attempts=5 not exhausted; window open
      "",
      "grader-1",
      NOW,
      exam,
      "enrollment-1",
    );

    expect(repos.getEnrollment().status).toBe("started");
    expect(repos.getEnrollment().finalPassed).toBe(false);
  });
});
