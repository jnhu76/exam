import { describe, expect, it } from "vitest";
import { gradeAttempt } from "./grading.js";
import type {
  AttemptRepository,
  EnrollmentRepository,
} from "./attemptCommands.js";
import type { ExamRepository } from "./examCommands.js";
import type { Exam, ExamAttempt, ExamEnrollment } from "@exam/domain";
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

describe("gradeAttempt", () => {
  it("persists question results and marks a passing attempt graded", async () => {
    const repos = makeRepos(makeExam(), makeAttempt(), makeEnrollment());
    const gradedAt = new Date("2026-06-01T12:00:00Z");

    const result = await gradeAttempt(
      repos.examRepo,
      repos.enrollmentRepo,
      repos.attemptRepo,
      "attempt-1",
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
      status: "completed",
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

    await expect(
      gradeAttempt(
        repos.examRepo,
        repos.enrollmentRepo,
        repos.attemptRepo,
        "attempt-1",
        new Date(),
      ),
    ).rejects.toThrow(InvalidStateTransitionError);
  });

  it.each([
    ["latest", 8, 10, "attempt-1"],
    ["highest", 12, 12, "previous-attempt"],
    ["first", 8, 8, "previous-attempt"],
  ] as const)(
    "applies %s score strategy",
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

      await gradeAttempt(
        repos.examRepo,
        repos.enrollmentRepo,
        repos.attemptRepo,
        "attempt-1",
        new Date(),
      );

      expect(repos.getEnrollment().finalScore).toBe(expectedScore);
      expect(repos.getEnrollment().finalAttemptId).toBe(expectedAttemptId);
    },
  );

  it("throws ValidationError when persisting graded result fails", async () => {
    const exam = makeExam();
    const attempt = makeAttempt();
    const enrollment = makeEnrollment();
    const examRepo: ExamRepository = {
      findById: () => exam,
      update: () => exam,
    };
    const attemptRepo: AttemptRepository = {
      findById: () => attempt,
      findActiveByEnrollment: () => null,
      findByEnrollmentAndAttemptNo: () => null,
      create: () => attempt,
      update: () => null,
    };
    const enrollmentRepo: EnrollmentRepository = {
      findByExamAndCandidate: () => enrollment,
      create: () => enrollment,
      update: () => enrollment,
    };

    await expect(
      gradeAttempt(
        examRepo,
        enrollmentRepo,
        attemptRepo,
        "attempt-1",
        new Date(),
      ),
    ).rejects.toThrow("Failed to persist graded results");
  });

  it("throws ValidationError when updating enrollment result fails", async () => {
    const exam = makeExam();
    const attempt = makeAttempt();
    const enrollment = makeEnrollment();
    const gradingAttempt = { ...attempt, status: "grading" as const };
    const gradedAttempt = { ...attempt, status: "graded" as const };
    let attemptCallCount = 0;
    const examRepo: ExamRepository = {
      findById: () => exam,
      update: () => exam,
    };
    const attemptRepo: AttemptRepository = {
      findById: () => attempt,
      findActiveByEnrollment: () => null,
      findByEnrollmentAndAttemptNo: () => null,
      create: () => attempt,
      update: () => {
        attemptCallCount++;
        if (attemptCallCount === 1) return gradingAttempt;
        return gradedAttempt;
      },
    };
    const enrollmentRepo: EnrollmentRepository = {
      findByExamAndCandidate: () => enrollment,
      create: () => enrollment,
      update: () => null,
    };

    await expect(
      gradeAttempt(
        examRepo,
        enrollmentRepo,
        attemptRepo,
        "attempt-1",
        new Date(),
      ),
    ).rejects.toThrow("Failed to update enrollment");
  });
});
