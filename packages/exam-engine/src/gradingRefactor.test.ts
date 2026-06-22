import { describe, expect, it } from "vitest";
import {
  readGradingSnapshot,
  computeGradingResult,
  finalizeGrading,
  shouldEnrollmentComplete,
} from "./grading.js";
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
        attachments: [],
        options: [],
        standardAnswer: "a",
        score: 10,
        gradingRule: {
          multiSelectScoring: "all_correct_full",
          fillBlankMatchMode: "exact",
        },
        order: 0,
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
    };
    const snapshot = await readGradingSnapshot(
      { findById: () => makeExam(), update: () => makeExam() },
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

// ── computeGradingResult ────────────────────────────────────────

describe("computeGradingResult", () => {
  it("produces a ScoreResult without touching any repo", () => {
    const exam = makeExam();
    const attempt = makeAttempt();

    const result = computeGradingResult(
      attempt,
      exam,
      new Date("2026-06-01T12:00:00Z"),
    );

    expect(result.totalScore).toBe(10);
    expect(result.passed).toBe(true);
    expect(result.questionResults).toHaveLength(1);
    expect(result.attemptId).toBe("attempt-1");
  });
});

// ── finalizeGrading ─────────────────────────────────────────────

describe("finalizeGrading", () => {
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

  it("atomically writes attempt score and enrollment finalScore", async () => {
    const exam = makeExam();
    const repos = makeRepos(
      exam,
      makeAttempt({ status: "submitted" }),
      makeEnrollment(),
    );

    const result = await finalizeGrading(
      repos.enrollmentRepo,
      repos.attemptRepo,
      "attempt-1",
      "enrollment-1",
      gradingResult,
      exam,
    );

    expect(result).toBe(true);
    expect(repos.getAttempt()).toMatchObject({
      status: "graded",
      score: 10,
      passed: true,
      gradingResult: gradingResult.questionResults,
    });
    expect(repos.getEnrollment()).toMatchObject({
      status: "started",
      finalScore: 10,
      finalPassed: true,
      finalAttemptId: "attempt-1",
    });
  });

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

    const result = await finalizeGrading(
      trackingEnrollmentRepo,
      trackingAttemptRepo,
      "attempt-1",
      "enrollment-1",
      gradingResult,
      exam,
    );

    expect(result).toBe(false);
    expect(updateCalled).toBe(false);
    expect(enrollmentUpdateCalled).toBe(false);
  });

  it("throws InvalidStateTransitionError when attempt is not submitted", async () => {
    const exam = makeExam();
    const repos = makeRepos(
      exam,
      makeAttempt({ status: "in_progress" }),
      makeEnrollment(),
    );

    await expect(
      finalizeGrading(
        repos.enrollmentRepo,
        repos.attemptRepo,
        "attempt-1",
        "enrollment-1",
        gradingResult,
        exam,
      ),
    ).rejects.toThrow(InvalidStateTransitionError);
  });

  it("does NOT persist grading status if it writes graded result and enrollment update in same call", async () => {
    const exam = makeExam();
    const repos = makeRepos(
      exam,
      makeAttempt({ status: "submitted" }),
      makeEnrollment(),
    );

    const statusesSeen: string[] = [];
    const trackingAttemptRepo: AttemptRepository = {
      ...repos.attemptRepo,
      update: async (id, data) => {
        if (data.status) statusesSeen.push(data.status);
        return repos.attemptRepo.update(id, data);
      },
    };

    await finalizeGrading(
      repos.enrollmentRepo,
      trackingAttemptRepo,
      "attempt-1",
      "enrollment-1",
      gradingResult,
      exam,
    );

    expect(statusesSeen).not.toContain("grading");
    expect(statusesSeen).toContain("graded");
  });

  it("respects score strategy — does not overwrite highest when score is lower", async () => {
    const exam = makeExam("highest");
    const repos = makeRepos(
      exam,
      makeAttempt({ status: "submitted" }),
      makeEnrollment({
        finalScore: 12,
        finalPassed: true,
        finalAttemptId: "previous-attempt",
      }),
    );

    await finalizeGrading(
      repos.enrollmentRepo,
      repos.attemptRepo,
      "attempt-1",
      "enrollment-1",
      gradingResult,
      exam,
    );

    expect(repos.getEnrollment().finalScore).toBe(12);
    expect(repos.getEnrollment().finalAttemptId).toBe("previous-attempt");
  });
});

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
    // Names the `enrollment.finalPassed === true` disjunct in grading.ts:66.
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
});

describe("finalizeGrading — enrollment status by retake policy", () => {
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

    await finalizeGrading(
      repos.enrollmentRepo,
      repos.attemptRepo,
      "attempt-1",
      "enrollment-1",
      gradingResult,
      exam,
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

    await finalizeGrading(
      repos.enrollmentRepo,
      repos.attemptRepo,
      "attempt-1",
      "enrollment-1",
      gradingResult,
      exam,
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

    await finalizeGrading(
      repos.enrollmentRepo,
      repos.attemptRepo,
      "attempt-1",
      "enrollment-1",
      gradingResult,
      exam,
    );

    expect(repos.getEnrollment().status).toBe("completed");
  });

  it("keeps enrollment started when pass_then_stop but not passed", async () => {
    const failResult: ScoreResult = {
      ...gradingResult,
      passed: false,
      totalScore: 3,
    };
    const exam = { ...makeExam(), retakePolicy: "pass_then_stop" as const };
    const repos = makeRepos(
      exam,
      makeAttempt({ status: "submitted" }),
      makeEnrollment({ attemptCount: 1 }),
    );

    await finalizeGrading(
      repos.enrollmentRepo,
      repos.attemptRepo,
      "attempt-1",
      "enrollment-1",
      failResult,
      exam,
    );

    expect(repos.getEnrollment().status).toBe("started");
  });
});
