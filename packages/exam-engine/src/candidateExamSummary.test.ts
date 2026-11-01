import { describe, expect, it } from "vitest";
import type { Exam, ExamAttempt, ExamEnrollment } from "@exam/domain";
import { deriveCandidateExamState } from "./candidateExamSummary.js";
import {
  resolveCandidateEnrollmentResultVisibility,
  projectEnrollmentForLifecycleState,
} from "./candidateResultVisibility.js";

// Fixtures mirror candidateResultVisibility.test.ts so both suites describe
// the same domain objects.

function makeExam(overrides: Partial<Exam> = {}): Exam {
  return {
    id: "exam-1",
    organizationId: "org-1",
    title: "Test Exam",
    description: "",
    courseId: "course-1",
    status: "published",
    timingMode: "timed_window",
    durationMinutes: 60,
    openAt: new Date("2026-01-01T00:00:00Z"),
    closeAt: new Date("2026-01-02T00:00:00Z"),
    passingScore: 60,
    totalScore: 100,
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
    maxAttempts: 1,
    latestStartOffsetMinutes: null,
    minSubmitAfterStartMinutes: null,
    resultPublicationMode: "immediate",
    resultsPublishedAt: null,
    syncStartedAt: null,
    createdAt: new Date("2025-12-31T00:00:00Z"),
    updatedAt: new Date("2025-12-31T00:00:00Z"),
    ...overrides,
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
    status: "graded",
    questionSnapshot: [],
    answers: [],
    gradingResult: [
      {
        questionId: "q1",
        score: 0,
        maxScore: 100,
        correct: false,
        candidateAnswer: "b",
        standardAnswer: "a",
      },
    ],
    score: 0,
    passed: false,
    startedAt: new Date("2026-01-01T01:00:00Z"),
    submittedAt: new Date("2026-01-01T02:00:00Z"),
    gradedAt: new Date("2026-01-01T02:01:00Z"),
    deadlineAt: new Date("2026-01-01T02:00:00Z"),
    lastActivityAt: new Date("2026-01-01T02:00:00Z"),
    createdAt: new Date("2026-01-01T01:00:00Z"),
    updatedAt: new Date("2026-01-01T02:01:00Z"),
    gradingStatus: "auto_graded",
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
    createdAt: new Date("2025-12-31T00:00:00Z"),
    updatedAt: new Date("2026-01-01T02:01:00Z"),
    finalScore: 0,
    finalPassed: false,
    finalAttemptId: "attempt-1",
    ...overrides,
  };
}

const NOW = new Date("2026-01-01T12:00:00Z"); // inside openAt..closeAt

/**
 * A started-but-not-graded attempt (in_progress or submitted): grading facts
 * are ABSENT properties, not nulls (exactOptionalPropertyTypes).
 */
function makeUngradedAttempt(
  status: "in_progress" | "submitted",
  overrides: Partial<ExamAttempt> = {},
): ExamAttempt {
  const base = makeAttempt({ status, ...overrides });
  const {
    score: _score,
    passed: _passed,
    gradedAt: _gradedAt,
    gradingResult: _gradingResult,
    gradingStatus: _gradingStatus,
    ...rest
  } = base;
  if (status === "submitted") {
    return rest; // keeps submittedAt: a submitted attempt has one
  }
  const { submittedAt: _submittedAt, ...started } = rest;
  return started; // an in-progress attempt has not been submitted
}

/**
 * Mirrors the exact composition of the candidate list/detail routes
 * (apps/api/src/routes/attempts.candidate.ts): resolve result visibility on
 * the raw enrollment, project the lifecycle facts, then derive the state.
 */
function deriveForCandidate(
  exam: Exam,
  rawEnrollment: ExamEnrollment | null,
  attempts: {
    activeAttempt?: ExamAttempt | null;
    resumableAttempt?: ExamAttempt | null;
    latestAttempt?: ExamAttempt | null;
    finalAttempt?: ExamAttempt | null;
  } = {},
) {
  const activeAttempt = attempts.activeAttempt ?? null;
  const resumableAttempt = attempts.resumableAttempt ?? null;
  const latestAttempt = attempts.latestAttempt ?? null;
  const finalAttempt = attempts.finalAttempt ?? null;
  const resultVisible = resolveCandidateEnrollmentResultVisibility(
    exam,
    rawEnrollment,
    finalAttempt,
  ).visible;
  return deriveCandidateExamState({
    exam,
    enrollment: projectEnrollmentForLifecycleState(
      rawEnrollment,
      resultVisible,
    ),
    activeAttempt,
    resumableAttempt,
    latestAttempt,
    finalAttempt,
    now: NOW,
  });
}

describe("deriveCandidateExamState — retake reachability (R1-F1)", () => {
  it("max_attempts, failed, attempts remaining → graded with start action", () => {
    const exam = makeExam({ retakePolicy: "max_attempts", maxAttempts: 2 });
    const finalAttempt = makeAttempt(); // failed
    const enrollment = makeEnrollment({
      attemptCount: 1,
      finalScore: 0,
      finalPassed: false,
      finalAttemptId: finalAttempt.id,
    });
    expect(
      deriveForCandidate(exam, enrollment, {
        latestAttempt: finalAttempt,
        finalAttempt,
      }),
    ).toEqual({
      availabilityStatus: "graded",
      primaryAction: "start",
    });
  });

  it("unlimited, failed after several attempts → start; numeric maxAttempts never blocks", () => {
    const exam = makeExam({ retakePolicy: "unlimited", maxAttempts: 1 });
    const finalAttempt = makeAttempt();
    const enrollment = makeEnrollment({
      attemptCount: 3,
      finalScore: 0,
      finalPassed: false,
      finalAttemptId: finalAttempt.id,
    });
    expect(
      deriveForCandidate(exam, enrollment, {
        latestAttempt: finalAttempt,
        finalAttempt,
      }),
    ).toEqual({
      availabilityStatus: "graded",
      primaryAction: "start",
    });
  });

  it("max_attempts, passed with attempts remaining → start (passing does not stop this policy)", () => {
    const exam = makeExam({ retakePolicy: "max_attempts", maxAttempts: 3 });
    const finalAttempt = makeAttempt({ score: 90, passed: true });
    const enrollment = makeEnrollment({
      attemptCount: 1,
      finalScore: 90,
      finalPassed: true,
      finalAttemptId: finalAttempt.id,
    });
    expect(
      deriveForCandidate(exam, enrollment, {
        latestAttempt: finalAttempt,
        finalAttempt,
      }),
    ).toEqual({
      availabilityStatus: "graded",
      primaryAction: "start",
    });
  });

  it("unlimited, passed → start", () => {
    const exam = makeExam({ retakePolicy: "unlimited" });
    const finalAttempt = makeAttempt({ score: 90, passed: true });
    const enrollment = makeEnrollment({
      attemptCount: 1,
      finalScore: 90,
      finalPassed: true,
      finalAttemptId: finalAttempt.id,
    });
    expect(
      deriveForCandidate(exam, enrollment, {
        latestAttempt: finalAttempt,
        finalAttempt,
      }),
    ).toEqual({
      availabilityStatus: "graded",
      primaryAction: "start",
    });
  });

  it("pass_then_stop, failed, result visible → start (durable policy admits the retake)", () => {
    const exam = makeExam({ retakePolicy: "pass_then_stop" });
    const finalAttempt = makeAttempt();
    const enrollment = makeEnrollment({
      attemptCount: 1,
      finalScore: 0,
      finalPassed: false,
      finalAttemptId: finalAttempt.id,
    });
    expect(
      deriveForCandidate(exam, enrollment, {
        latestAttempt: finalAttempt,
        finalAttempt,
      }),
    ).toEqual({
      availabilityStatus: "graded",
      primaryAction: "start",
    });
  });

  it("pass_then_stop, failed, result hidden → retake-deferred: view_result, no start (#324)", () => {
    const exam = makeExam({
      retakePolicy: "pass_then_stop",
      resultPublicationMode: "manual",
      resultsPublishedAt: null,
    });
    const finalAttempt = makeAttempt();
    const enrollment = makeEnrollment({
      attemptCount: 1,
      finalScore: 0,
      finalPassed: false,
      finalAttemptId: finalAttempt.id,
    });
    expect(
      deriveForCandidate(exam, enrollment, {
        latestAttempt: finalAttempt,
        finalAttempt,
      }),
    ).toEqual({
      availabilityStatus: "graded",
      primaryAction: "view_result",
    });
  });

  it("pass_then_stop, passed, result hidden → retake-deferred: identical to failed-hidden (no pass/fail oracle)", () => {
    const exam = makeExam({
      retakePolicy: "pass_then_stop",
      resultPublicationMode: "manual",
      resultsPublishedAt: null,
    });
    const finalAttempt = makeAttempt({ score: 90, passed: true });
    const enrollment = makeEnrollment({
      attemptCount: 1,
      finalScore: 90,
      finalPassed: true,
      finalAttemptId: finalAttempt.id,
    });
    expect(
      deriveForCandidate(exam, enrollment, {
        latestAttempt: finalAttempt,
        finalAttempt,
      }),
    ).toEqual({
      availabilityStatus: "graded",
      primaryAction: "view_result",
    });
  });

  it("unlimited, result hidden (manual unpublished) → start (hidden result never blocks this policy; pass/fail get the same UI)", () => {
    const exam = makeExam({
      retakePolicy: "unlimited",
      resultPublicationMode: "manual",
      resultsPublishedAt: null,
    });
    const finalAttempt = makeAttempt();
    const enrollment = makeEnrollment({
      attemptCount: 1,
      finalScore: 0,
      finalPassed: false,
      finalAttemptId: finalAttempt.id,
    });
    expect(
      deriveForCandidate(exam, enrollment, {
        latestAttempt: finalAttempt,
        finalAttempt,
      }),
    ).toEqual({
      availabilityStatus: "graded",
      primaryAction: "start",
    });
  });
});

describe("deriveCandidateExamState — preserved lifecycle priorities", () => {
  it("max_attempts exhausted → max_attempts_exhausted/view_result", () => {
    const exam = makeExam({ retakePolicy: "max_attempts", maxAttempts: 2 });
    const finalAttempt = makeAttempt();
    const enrollment = makeEnrollment({
      attemptCount: 2,
      finalScore: 0,
      finalPassed: false,
      finalAttemptId: finalAttempt.id,
    });
    expect(
      deriveForCandidate(exam, enrollment, {
        latestAttempt: finalAttempt,
        finalAttempt,
      }),
    ).toEqual({
      availabilityStatus: "max_attempts_exhausted",
      primaryAction: "view_result",
    });
  });

  it("pass_then_stop, passed, result visible → max_attempts_exhausted/view_result (already-passed block)", () => {
    const exam = makeExam({ retakePolicy: "pass_then_stop" });
    const finalAttempt = makeAttempt({ score: 90, passed: true });
    const enrollment = makeEnrollment({
      attemptCount: 1,
      finalScore: 90,
      finalPassed: true,
      finalAttemptId: finalAttempt.id,
    });
    expect(
      deriveForCandidate(exam, enrollment, {
        latestAttempt: finalAttempt,
        finalAttempt,
      }),
    ).toEqual({
      availabilityStatus: "max_attempts_exhausted",
      primaryAction: "view_result",
    });
  });

  it("window closed takes precedence over a retake-eligible graded state", () => {
    const exam = makeExam({
      retakePolicy: "unlimited",
      openAt: new Date("2025-12-30T00:00:00Z"),
      closeAt: new Date("2025-12-31T00:00:00Z"),
    });
    const finalAttempt = makeAttempt();
    const enrollment = makeEnrollment({
      attemptCount: 1,
      finalScore: 0,
      finalPassed: false,
      finalAttemptId: finalAttempt.id,
    });
    expect(
      deriveForCandidate(exam, enrollment, {
        latestAttempt: finalAttempt,
        finalAttempt,
      }),
    ).toEqual({
      availabilityStatus: "expired",
      primaryAction: "view_result",
    });
  });

  it("active in-progress attempt beats a prior graded result", () => {
    const exam = makeExam({ retakePolicy: "max_attempts", maxAttempts: 3 });
    const finalAttempt = makeAttempt();
    const active = makeUngradedAttempt("in_progress", {
      id: "attempt-2",
      attemptNo: 2,
    });
    const enrollment = makeEnrollment({
      attemptCount: 2,
      finalScore: 0,
      finalPassed: false,
      finalAttemptId: finalAttempt.id,
    });
    expect(
      deriveForCandidate(exam, enrollment, {
        activeAttempt: active,
        latestAttempt: active,
        finalAttempt,
      }),
    ).toEqual({
      availabilityStatus: "in_progress",
      primaryAction: "resume",
    });
  });

  it("submitted attempt awaiting grading beats a prior graded result", () => {
    const exam = makeExam({ retakePolicy: "unlimited" });
    const finalAttempt = makeAttempt();
    const submitted = makeUngradedAttempt("submitted", {
      id: "attempt-2",
      attemptNo: 2,
    });
    const enrollment = makeEnrollment({
      attemptCount: 2,
      finalScore: 0,
      finalPassed: false,
      finalAttemptId: finalAttempt.id,
    });
    expect(
      deriveForCandidate(exam, enrollment, {
        latestAttempt: submitted,
        finalAttempt,
      }),
    ).toEqual({
      availabilityStatus: "submitted_pending_grade",
      primaryAction: "view_history",
    });
  });
});
