import { describe, expect, it } from "vitest";
import {
  readGradingSnapshot,
  computeGradingResult,
  finalizeGrading,
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
 * P3-FORMAL-P0-D2 test helper: mints a genuine capability against the provided
 * repo pair via the canonical seam. Test-only.
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

/**
 * Slice 4: finalizeGrading now aggregates from `attempt_grading_entries` and
 * no longer accepts an externally computed ScoreResult. These tests pre-date
 * the workset; this helper derives a workset repo from the canonical
 * auto-grader output so the aggregator sees the same score the old
 * result-based path produced.
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
  // Slice 4: derive the workset repo from the canonical auto-grader output.
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
  const now = new Date("2026-06-01T12:00:00Z");

  it("atomically writes attempt score and enrollment finalScore", async () => {
    const exam = makeExam();
    const repos = makeRepos(
      exam,
      makeAttempt({ status: "submitted" }),
      makeEnrollment(),
    );

    const cap = await mintCap(
      repos.enrollmentRepo,
      repos.attemptRepo,
      "attempt-1",
    );
    const result = await finalizeGrading(
      repos.enrollmentRepo,
      repos.attemptRepo,
      repos.worksetRepo,
      cap,
      exam,
      now,
    );

    expect(result).toBe(true);
    expect(repos.getAttempt()).toMatchObject({
      status: "graded",
      score: 10,
      passed: true,
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

  it("throws InvalidStateTransitionError when attempt is not submitted", async () => {
    const exam = makeExam();
    const repos = makeRepos(
      exam,
      makeAttempt({ status: "in_progress" }),
      makeEnrollment(),
    );

    const cap = await mintCap(
      repos.enrollmentRepo,
      repos.attemptRepo,
      "attempt-1",
    );
    await expect(
      finalizeGrading(
        repos.enrollmentRepo,
        repos.attemptRepo,
        repos.worksetRepo,
        cap,
        exam,
        now,
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

    const cap = await mintCap(
      repos.enrollmentRepo,
      trackingAttemptRepo,
      "attempt-1",
    );
    await finalizeGrading(
      repos.enrollmentRepo,
      trackingAttemptRepo,
      repos.worksetRepo,
      cap,
      exam,
      now,
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

    const cap = await mintCap(
      repos.enrollmentRepo,
      repos.attemptRepo,
      "attempt-1",
    );
    await finalizeGrading(
      repos.enrollmentRepo,
      repos.attemptRepo,
      repos.worksetRepo,
      cap,
      exam,
      now,
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
  const now = new Date("2026-06-01T12:00:00Z");

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
