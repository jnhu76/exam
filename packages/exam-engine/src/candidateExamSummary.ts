import type { Exam, ExamAttempt, ExamEnrollment } from "@exam/domain";

/** The computed availability status of an exam for a specific candidate. */
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

/** The primary action a candidate can take on an exam given its current state. */
export type PrimaryAction =
  | "start"
  | "resume"
  | "view_result"
  | "view_history"
  | "none";

/** Input data required to derive the candidate-facing exam summary state. */
export interface DeriveCandidateExamSummaryInput {
  exam: Exam;
  enrollment: ExamEnrollment | null;
  activeAttempt: ExamAttempt | null;
  resumableAttempt: ExamAttempt | null;
  latestAttempt: ExamAttempt | null;
  finalAttempt: ExamAttempt | null;
  now: Date;
}

/**
 * Derives the availability status and primary action for a candidate viewing an exam.
 * Returns a deterministic state based on enrollment, attempt, and exam window conditions.
 */
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
      primaryAction: "view_result",
    };
  }

  return { availabilityStatus: "available", primaryAction: "start" };
}

/**
 * Selects the best attempt to display to a candidate, preferring active, then resumable,
 * then latest, then final.
 */
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
