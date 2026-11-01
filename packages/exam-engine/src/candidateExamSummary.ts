import type { Exam, ExamAttempt, ExamEnrollment } from "@exam/domain";
import { isCandidateRetakeDeferred } from "./candidateResultVisibility.js";

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
  // Untimed exams have no closeAt — never after-window.
  const afterWindow = exam.closeAt !== null && now >= exam.closeAt;
  const attemptsUsed = enrollment?.attemptCount ?? 0;
  const maxAttemptsExhausted =
    exam.retakePolicy === "max_attempts" && attemptsUsed >= exam.maxAttempts;
  const alreadyPassed =
    exam.retakePolicy === "pass_then_stop" && enrollment?.finalPassed === true;
  const blocked = enrollment?.status === "blocked";
  const examOpen = exam.status === "published" || exam.status === "open";
  // A `closed` exam has run past its window (auto-closed on access). It is
  // not administratively hidden like `archived`/`draft`, so candidates still
  // see it as "expired" rather than "unavailable".
  const examClosed = exam.status === "closed";
  const hasResult = Boolean(
    finalAttempt ||
    (enrollment?.finalAttemptId && enrollment.finalScore != null),
  );

  if ((!examOpen && !examClosed) || blocked) {
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
    if (latestAttempt.status === "submitted") {
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
    // INVARIANT: a committed final score is NOT the end of the exam
    // lifecycle. The start command (startOrRestoreAttempt) admits a new
    // attempt for a failed candidate while attempts remain under every
    // retake policy, and for a passed candidate under unlimited/max_attempts.
    // The only gate that must suppress the start action here is the #324
    // retake-defer decision (pass_then_stop + hidden result), decided by the
    // SAME authority the start route consults — otherwise the list/detail
    // projection and the start command disagree. The lifecycle projection
    // (projectEnrollmentForLifecycleState) strips finalPassed only; the
    // deferral decision reads finalAttemptId and the final attempt's
    // publication state, both preserved by that projection, so evaluating it
    // here is equivalent to evaluating it on the raw enrollment.
    const retakeDeferred = isCandidateRetakeDeferred(
      exam,
      enrollment,
      finalAttempt,
    );
    return {
      availabilityStatus: "graded",
      primaryAction: retakeDeferred ? "view_result" : "start",
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
