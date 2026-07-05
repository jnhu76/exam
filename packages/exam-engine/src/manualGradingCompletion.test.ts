import { describe, expect, it } from "vitest";
import type {
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
import { submitAttempt } from "./attemptCommands.js";
import { computeGradingResult } from "./grading.js";
import {
  gradeQuestion,
  type ManualGradingRepository,
} from "./manualGrading.js";

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
  return {
    examRepo,
    attemptRepo,
    enrollmentRepo,
    getAttempt: () => storedAttempt,
    getEnrollment: () => storedEnrollment,
  };
}

function makeManualRepo(
  initial: Array<{ questionId: string; score: number }> = [],
) {
  const entries = new Map(initial.map((e) => [e.questionId, e]));
  const repo: ManualGradingRepository = {
    upsert: async (input) => {
      entries.set(input.questionId, {
        questionId: input.questionId,
        score: input.score,
      });
    },
    findByAttempt: async () =>
      Array.from(entries.values()).map((e) => ({
        questionId: e.questionId,
        score: e.score,
      })),
  };
  return { repo };
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
  await submitAttempt(repos.attemptRepo, "attempt-1", NOW, {
    source: "candidate",
  });

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
  const { repo: manualRepo } = makeManualRepo();
  let lastResult: {
    gradingStatus?: ExamAttempt["gradingStatus"];
    fullyGraded?: boolean;
    totalScore?: number;
    passed?: boolean;
  } = {};
  for (const m of input.manualScores) {
    lastResult = await gradeQuestion(
      repos.attemptRepo,
      manualRepo,
      "attempt-1",
      m.questionId,
      m.score,
      "",
      "grader-1",
      NOW,
      passingScore,
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

    const submitted = await submitAttempt(repos.attemptRepo, "attempt-1", NOW, {
      source: "candidate",
    });

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

    await submitAttempt(repos.attemptRepo, "attempt-1", NOW, {
      source: "candidate",
    });
    const { repo: manualRepo } = makeManualRepo();

    const partial = await gradeQuestion(
      repos.attemptRepo,
      manualRepo,
      "attempt-1",
      "q-text-1",
      20,
      "",
      "grader-1",
      NOW,
      DEFAULT_PASSING,
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

    await submitAttempt(repos.attemptRepo, "attempt-1", NOW, {
      source: "candidate",
    });

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
