import { describe, expect, it } from "vitest";
import type { Exam, ExamAttempt, ExamEnrollment } from "@exam/domain";
import {
  resolveCandidateResultVisibility,
  resolveCandidateEnrollmentResultVisibility,
  projectCandidateVisibleEnrollment,
} from "./candidateResultVisibility.js";

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
    openAt: new Date(),
    closeAt: new Date(Date.now() + 86400000),
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
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeGradedAttempt(overrides: Partial<ExamAttempt> = {}): ExamAttempt {
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
        score: 80,
        maxScore: 100,
        correct: true,
        candidateAnswer: "a",
        standardAnswer: "a",
      },
    ],
    score: 80,
    passed: true,
    startedAt: new Date(),
    submittedAt: new Date(),
    gradedAt: new Date(),
    deadlineAt: new Date(),
    lastActivityAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
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
    createdAt: new Date(),
    updatedAt: new Date(),
    finalScore: 80,
    finalPassed: true,
    finalAttemptId: "attempt-1",
    ...overrides,
  };
}

describe("resolveCandidateResultVisibility", () => {
  const graded = (overrides: Partial<ExamAttempt> = {}) =>
    makeGradedAttempt(overrides);

  it("manual + fully graded + unpublished → hidden pending_publish", () => {
    const exam = makeExam({
      resultPublicationMode: "manual",
      resultsPublishedAt: null,
    });
    expect(resolveCandidateResultVisibility(exam, graded())).toEqual({
      visible: false,
      hiddenReason: "pending_publish",
    });
  });

  it("manual + fully graded + published → visible", () => {
    const exam = makeExam({
      resultPublicationMode: "manual",
      resultsPublishedAt: new Date(),
    });
    expect(resolveCandidateResultVisibility(exam, graded())).toEqual({
      visible: true,
    });
  });

  it("manual + all-view → visible even when unpublished", () => {
    const exam = makeExam({
      resultPublicationMode: "manual",
      resultsPublishedAt: null,
    });
    expect(resolveCandidateResultVisibility(exam, graded(), "all")).toEqual({
      visible: true,
    });
  });

  it("after_grading + pending_manual → hidden not_graded", () => {
    const exam = makeExam({ resultPublicationMode: "after_grading" });
    const attempt = graded({ gradingStatus: "pending_manual" });
    expect(resolveCandidateResultVisibility(exam, attempt)).toEqual({
      visible: false,
      hiddenReason: "not_graded",
    });
  });

  it("after_grading + auto_graded → hidden not_graded", () => {
    const exam = makeExam({ resultPublicationMode: "after_grading" });
    expect(resolveCandidateResultVisibility(exam, graded())).toEqual({
      visible: false,
      hiddenReason: "not_graded",
    });
  });

  it("after_grading + fully_graded → visible", () => {
    const exam = makeExam({ resultPublicationMode: "after_grading" });
    const attempt = graded({ gradingStatus: "fully_graded" });
    expect(resolveCandidateResultVisibility(exam, attempt)).toEqual({
      visible: true,
    });
  });

  it("after_grading + legacy null gradingStatus on graded attempt → visible", () => {
    const exam = makeExam({ resultPublicationMode: "after_grading" });
    const { gradingStatus: _legacy, ...attempt } = makeGradedAttempt();
    expect(resolveCandidateResultVisibility(exam, attempt)).toEqual({
      visible: true,
    });
  });

  it("immediate + auto_graded → visible", () => {
    const exam = makeExam({ resultPublicationMode: "immediate" });
    expect(resolveCandidateResultVisibility(exam, graded())).toEqual({
      visible: true,
    });
  });

  it("immediate + pending_manual → hidden not_graded", () => {
    const exam = makeExam({ resultPublicationMode: "immediate" });
    const attempt = graded({ gradingStatus: "pending_manual" });
    expect(resolveCandidateResultVisibility(exam, attempt)).toEqual({
      visible: false,
      hiddenReason: "not_graded",
    });
  });

  it("non-graded lifecycle states → hidden not_started", () => {
    const exam = makeExam({ resultPublicationMode: "immediate" });
    for (const status of [
      "not_started",
      "queued",
      "in_progress",
      "disrupted",
      "submitted",
      "grading",
      "voided",
    ] as const) {
      const {
        score: _noScore,
        passed: _noPassed,
        ...lifecycleBase
      } = makeGradedAttempt();
      const attempt = { ...lifecycleBase, status };
      expect(resolveCandidateResultVisibility(exam, attempt)).toEqual({
        visible: false,
        hiddenReason: "not_started",
      });
    }
  });

  it("graded status but incomplete score fields → hidden not_graded", () => {
    const exam = makeExam({ resultPublicationMode: "immediate" });
    const { gradingResult: _incomplete, ...attempt } = makeGradedAttempt();
    expect(resolveCandidateResultVisibility(exam, attempt)).toEqual({
      visible: false,
      hiddenReason: "not_graded",
    });
  });
});

describe("resolveCandidateEnrollmentResultVisibility", () => {
  it("derives from the final attempt when present", () => {
    const exam = makeExam({
      resultPublicationMode: "manual",
      resultsPublishedAt: null,
    });
    const finalAttempt = makeGradedAttempt();
    expect(
      resolveCandidateEnrollmentResultVisibility(
        exam,
        makeEnrollment(),
        finalAttempt,
      ),
    ).toEqual({ visible: false, hiddenReason: "pending_publish" });
  });

  it("hidden without a selected final attempt, even if a stale finalScore exists", () => {
    const exam = makeExam({ resultPublicationMode: "immediate" });
    const { finalAttemptId: _none, ...stale } = makeEnrollment();
    expect(
      resolveCandidateEnrollmentResultVisibility(exam, stale, null),
    ).toEqual({ visible: false, hiddenReason: "not_graded" });
    expect(
      resolveCandidateEnrollmentResultVisibility(exam, null, null),
    ).toEqual({ visible: false, hiddenReason: "not_graded" });
  });
});

describe("projectCandidateVisibleEnrollment", () => {
  it("keeps the enrollment untouched when the result is visible", () => {
    const enrollment = makeEnrollment();
    expect(projectCandidateVisibleEnrollment(enrollment, true)).toBe(
      enrollment,
    );
  });

  it("strips finalPassed while keeping finalScore/finalAttemptId when hidden", () => {
    const projected = projectCandidateVisibleEnrollment(
      makeEnrollment(),
      false,
    );
    expect(projected?.finalPassed).toBeUndefined();
    expect(projected?.finalScore).toBe(80);
    expect(projected?.finalAttemptId).toBe("attempt-1");
  });

  it("passes null through", () => {
    expect(projectCandidateVisibleEnrollment(null, false)).toBeNull();
  });
});
