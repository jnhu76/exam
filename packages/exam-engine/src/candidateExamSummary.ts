import type { Exam, ExamAttempt, ExamEnrollment } from "@exam/domain";

export type AvailabilityStatus =
  | "available"
  | "in_progress"
  | "resumable"
  | "submitted_pending_grade"
  | "graded"
  | "max_attempts_exhausted"
  | "not_started_yet"
  | "expired"
  | "unavailable";

export type PrimaryAction =
  | "start"
  | "resume"
  | "view_result"
  | "view_history"
  | "none";

export interface DeriveCandidateExamSummaryInput {
  exam: Exam;
  enrollment: ExamEnrollment | null;
  activeAttempt: ExamAttempt | null;
  resumableAttempt: ExamAttempt | null;
  latestAttempt: ExamAttempt | null;
  finalAttempt: ExamAttempt | null;
  now: Date;
}

export function deriveCandidateExamState(
  input: DeriveCandidateExamSummaryInput,
): { availabilityStatus: AvailabilityStatus; primaryAction: PrimaryAction } {
  const {
    exam,
    enrollment,
    activeAttempt,
    resumableAttempt,
    latestAttempt,
    finalAttempt,
    now,
  } = input;

  const inWindow = now >= exam.openAt && now < exam.closeAt;
  const beforeWindow = now < exam.openAt;
  const afterWindow = now >= exam.closeAt;
  const attemptsUsed = enrollment?.attemptCount ?? 0;
  const maxAttemptsExhausted =
    exam.retakePolicy === "max_attempts" && attemptsUsed >= exam.maxAttempts;
  const alreadyPassed =
    exam.retakePolicy === "pass_then_stop" && enrollment?.finalPassed === true;
  const blocked = enrollment?.status === "blocked";
  const examOpen = exam.status === "published" || exam.status === "open";
  const hasResult = Boolean(
    finalAttempt ||
    (enrollment?.finalAttemptId && enrollment.finalScore != null),
  );

  if (!examOpen || blocked) {
    return { availabilityStatus: "unavailable", primaryAction: "none" };
  }

  if (beforeWindow) {
    return { availabilityStatus: "not_started_yet", primaryAction: "none" };
  }

  if (activeAttempt && activeAttempt.status === "in_progress") {
    return { availabilityStatus: "in_progress", primaryAction: "resume" };
  }

  if (resumableAttempt && resumableAttempt.status === "disrupted") {
    return { availabilityStatus: "resumable", primaryAction: "resume" };
  }

  if (latestAttempt) {
    if (
      latestAttempt.status === "submitted" ||
      latestAttempt.status === "grading"
    ) {
      return {
        availabilityStatus: "submitted_pending_grade",
        primaryAction: "view_history",
      };
    }
  }

  if (maxAttemptsExhausted || alreadyPassed) {
    return {
      availabilityStatus: "max_attempts_exhausted",
      primaryAction: hasResult ? "view_result" : "none",
    };
  }

  if (afterWindow) {
    return {
      availabilityStatus: "expired",
      primaryAction: hasResult ? "view_result" : "none",
    };
  }

  if (attemptsUsed > 0 && enrollment?.finalScore != null) {
    return {
      availabilityStatus: "graded",
      primaryAction: inWindow ? "start" : "view_result",
    };
  }

  return { availabilityStatus: "available", primaryAction: "start" };
}

export function pickDisplayAttempt(
  input: Pick<
    DeriveCandidateExamSummaryInput,
    "activeAttempt" | "resumableAttempt" | "latestAttempt" | "finalAttempt"
  >,
): ExamAttempt | null {
  return (
    input.activeAttempt ??
    input.resumableAttempt ??
    input.latestAttempt ??
    input.finalAttempt ??
    null
  );
}
