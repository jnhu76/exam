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
import {
  finalizeGrading,
  gradeAttempt,
  gradeAttemptIdempotent,
  computeGradingResult,
} from "./grading.js";

/**
 * P3-L0-2C — Manual-Grading Hold Lifecycle Closure (RED tests).
 *
 * Proves the protocol invariant (exam-protocol.md §3.3, §4.2):
 *
 *   pure objective:      in_progress → submitted → graded + auto_graded
 *   text_response/mixed: in_progress → submitted + pending_manual
 *                        → (completeManualGrading) → graded + fully_graded
 *
 * Universal invariant:
 *   gradingStatus === "pending_manual"
 *     => attemptStatus must NOT advance to "graded"
 *        through the automatic grading finalization path.
 *
 * These tests FAIL against the historical implementation, which
 * unconditionally writes status="graded" inside finalizeGrading for
 * every attempt and only afterwards derives gradingStatus. They drive
 * the corrective closure: classify at submit/freeze time, branch
 * orchestration on authoritative gradingStatus, and guard the engine
 * finalization boundary.
 */

// ── fixtures ───────────────────────────────────────────────────────

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
    scoreStrategy: "highest",
    maxAttempts: 3,
    latestStartOffsetMinutes: null,
    minSubmitAfterStartMinutes: null,
    resultPublicationMode: "immediate",
    resultsPublishedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
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
    content: "Objective question",
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

function textResponseSnapshot(id: string, score: number): QuestionSnapshot {
  return {
    originalQuestionId: id,
    type: "text_response",
    content: "Subjective question",
    attachments: [],
    options: [],
    // Protocol §1.4: standardAnswer is optional/null for text_response;
    // subjectivity is determined by QuestionType, not standardAnswer.
    standardAnswer: null,
    score,
    gradingRule: {
      multiSelectScoring: "all_correct_full",
      fillBlankMatchMode: "exact",
    },
    order: 0,
    rubric: "按逻辑完整性、关键概念、论证质量给分",
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
    questionSnapshot: [objectiveSnapshot("q1", 10)],
    answers: [
      { questionId: "q1", answer: "a", version: 1, savedAt: new Date() },
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
    attemptCount: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
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

const NOW = new Date("2026-06-01T12:00:00Z");

// ── A. Mixed manual submit hold ───────────────────────────────────

describe("P3-L0-2C: mixed objective + text_response submit hold", () => {
  it("submitAttempt establishes gradingStatus=pending_manual at the freeze barrier", async () => {
    // Frozen snapshot: objective true_false + text_response.
    const mixedSnapshot = [
      {
        ...objectiveSnapshot("q-obj", 5, true),
        type: "true_false" as const,
      },
      textResponseSnapshot("q-text", 5),
    ];
    const attempt = makeAttempt({
      questionSnapshot: mixedSnapshot,
      answers: [
        { questionId: "q-obj", answer: true, version: 1, savedAt: NOW },
        {
          questionId: "q-text",
          answer: "主观文本答案",
          version: 1,
          savedAt: NOW,
        },
      ],
    });
    const repos = makeRepos(attempt);

    const submitted = await submitAttempt(repos.attemptRepo, "attempt-1", NOW, {
      source: "candidate",
    });

    // Protocol §4.2 step 6/8: submit freeze barrier sets BOTH the lifecycle
    // status AND the authoritative gradingStatus.
    expect(submitted.status).toBe("submitted");
    expect(submitted.gradingStatus).toBe("pending_manual");
  });

  it("does NOT auto-finalize a mixed attempt to status=graded", async () => {
    const mixedSnapshot = [
      {
        ...objectiveSnapshot("q-obj", 5, true),
        type: "true_false" as const,
      },
      textResponseSnapshot("q-text", 5),
    ];
    const attempt = makeAttempt({
      questionSnapshot: mixedSnapshot,
      answers: [
        { questionId: "q-obj", answer: true, version: 1, savedAt: NOW },
        {
          questionId: "q-text",
          answer: "主观文本答案",
          version: 1,
          savedAt: NOW,
        },
      ],
    });
    const repos = makeRepos(attempt);

    await submitAttempt(repos.attemptRepo, "attempt-1", NOW, {
      source: "candidate",
    });

    // After submit, the attempt MUST rest at submitted + pending_manual.
    // The historical bug advanced to graded in the same submit transaction.
    expect(repos.getAttempt().status).toBe("submitted");
    expect(repos.getAttempt().gradingStatus).toBe("pending_manual");
  });
});

// ── B. Pure text_response submit hold ─────────────────────────────

describe("P3-L0-2C: pure text_response submit hold", () => {
  it("a pure text_response attempt holds at submitted + pending_manual", async () => {
    const textOnly = makeAttempt({
      questionSnapshot: [textResponseSnapshot("q-text", 10)],
      answers: [
        {
          questionId: "q-text",
          answer: "纯主观题答案",
          version: 1,
          savedAt: NOW,
        },
      ],
    });
    const repos = makeRepos(textOnly);

    const submitted = await submitAttempt(repos.attemptRepo, "attempt-1", NOW, {
      source: "candidate",
    });

    expect(submitted.status).toBe("submitted");
    expect(submitted.gradingStatus).toBe("pending_manual");
    expect(repos.getAttempt().status).toBe("submitted");
  });
});

// ── C. Pure-objective regression ──────────────────────────────────

describe("P3-L0-2C: pure-objective inline auto-grade regression", () => {
  it("a pure-objective attempt still grades inline to graded + auto_graded", async () => {
    const objectiveOnly = makeAttempt({
      questionSnapshot: [objectiveSnapshot("q1", 10, "a")],
      answers: [{ questionId: "q1", answer: "a", version: 1, savedAt: NOW }],
    });
    const repos = makeRepos(objectiveOnly);

    // Submit then finalize via the synchronous objective path.
    await submitAttempt(repos.attemptRepo, "attempt-1", NOW, {
      source: "candidate",
    });
    const result = computeGradingResult(repos.getAttempt(), makeExam(), NOW);
    await finalizeGrading(
      repos.enrollmentRepo,
      repos.attemptRepo,
      "attempt-1",
      "enrollment-1",
      result,
      makeExam(),
    );

    expect(repos.getAttempt().status).toBe("graded");
    expect(repos.getAttempt().gradingStatus).toBe("auto_graded");
  });
});

// ── E. Terminal finalization guard (engine boundary) ──────────────

describe("P3-L0-2C: finalizeGrading terminal guard on pending_manual", () => {
  it("refuses to advance a pending_manual attempt to graded via finalizeGrading", async () => {
    // Pre-conditions: the freeze barrier already established the authoritative
    // pending_manual classification. finalizeGrading (the automatic terminal
    // path) must NOT overwrite status to graded for such an attempt.
    const submittedPendingManual = makeAttempt({
      status: "submitted",
      gradingStatus: "pending_manual",
      submittedAt: NOW,
      submissionReason: "manual",
      submittedAnswers: {
        schemaVersion: 1 as const,
        answers: [
          { questionId: "q-text", value: "主观答案" },
          { questionId: "q-obj", value: true },
        ],
      },
      questionSnapshot: [
        {
          ...objectiveSnapshot("q-obj", 5, true),
          type: "true_false" as const,
        },
        textResponseSnapshot("q-text", 5),
      ],
    });
    const repos = makeRepos(submittedPendingManual);

    const result = computeGradingResult(repos.getAttempt(), makeExam(), NOW);

    // The engine boundary must fail closed (or return a non-finalized
    // outcome). It must NOT write graded + pending_manual.
    await expect(
      finalizeGrading(
        repos.enrollmentRepo,
        repos.attemptRepo,
        "attempt-1",
        "enrollment-1",
        result,
        makeExam(),
      ),
    ).rejects.toThrow();

    expect(repos.getAttempt().status).toBe("submitted");
    expect(repos.getAttempt().gradingStatus).toBe("pending_manual");
  });

  it("gradeAttemptIdempotent does not advance a pending_manual attempt", async () => {
    const submittedPendingManual = makeAttempt({
      status: "submitted",
      gradingStatus: "pending_manual",
      submittedAt: NOW,
      submissionReason: "manual",
      submittedAnswers: {
        schemaVersion: 1 as const,
        answers: [{ questionId: "q-text", value: "主观答案" }],
      },
      questionSnapshot: [textResponseSnapshot("q-text", 10)],
    });
    const repos = makeRepos(submittedPendingManual);

    await expect(
      gradeAttemptIdempotent(
        repos.examRepo,
        repos.enrollmentRepo,
        repos.attemptRepo,
        "attempt-1",
        NOW,
      ),
    ).resolves.toBeDefined();

    expect(repos.getAttempt().status).toBe("submitted");
    expect(repos.getAttempt().gradingStatus).toBe("pending_manual");
  });

  it("gradeAttempt does not advance a pending_manual attempt", async () => {
    const submittedPendingManual = makeAttempt({
      status: "submitted",
      gradingStatus: "pending_manual",
      submittedAt: NOW,
      submissionReason: "manual",
      submittedAnswers: {
        schemaVersion: 1 as const,
        answers: [{ questionId: "q-text", value: "主观答案" }],
      },
      questionSnapshot: [textResponseSnapshot("q-text", 10)],
    });
    const repos = makeRepos(submittedPendingManual);

    await expect(
      gradeAttempt(
        repos.examRepo,
        repos.enrollmentRepo,
        repos.attemptRepo,
        "attempt-1",
        NOW,
      ),
    ).rejects.toThrow();

    expect(repos.getAttempt().status).toBe("submitted");
  });
});
