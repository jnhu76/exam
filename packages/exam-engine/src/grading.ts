import type {
  ExamEnrollment,
  Exam,
  ScoreResult,
  ScoreStrategy,
} from "@exam/domain";
import {
  gradeAnswers,
  InvalidStateTransitionError,
  ValidationError,
} from "@exam/domain";
import type { ExamAttempt } from "@exam/domain";
import type {
  AttemptRepository,
  EnrollmentRepository,
} from "./attemptCommands.js";
import type { ExamRepository } from "./examCommands.js";
import {
  transition,
  isTransitionOk,
  type AttemptCommand,
} from "./attemptStateMachine.js";
import { assertTransition as assertEnrollmentTransition } from "./enrollmentStateMachine.js";

/**
 * Determines whether this attempt's score should replace the current final score
 * on the enrollment, based on the exam's score strategy (latest, highest, or first).
 */
function shouldSelectAttempt(
  strategy: ScoreStrategy,
  enrollment: ExamEnrollment,
  score: number,
): boolean {
  if (!enrollment.finalAttemptId || enrollment.finalScore === undefined) {
    return true;
  }
  switch (strategy) {
    case "latest":
      return true;
    case "highest":
      return score > enrollment.finalScore;
    case "first":
      return false;
  }
}

/**
 * Determines whether the enrollment should transition to completed status.
 * Completes when max attempts are exhausted, the candidate passes a pass_then_stop exam,
 * or the exam window has closed.
 */
export function shouldEnrollmentComplete(
  exam: Exam,
  enrollment: ExamEnrollment,
  gradedPassed: boolean,
  now: Date,
): boolean {
  if (
    exam.retakePolicy === "max_attempts" &&
    enrollment.attemptCount >= exam.maxAttempts
  ) {
    return true;
  }
  if (
    exam.retakePolicy === "pass_then_stop" &&
    (gradedPassed || enrollment.finalPassed === true)
  ) {
    return true;
  }
  if (now >= exam.closeAt) {
    return true;
  }
  return false;
}

/** Snapshot of data required for grading an attempt: the attempt, its exam, and the enrollment. */
export interface GradingSnapshot {
  attempt: ExamAttempt;
  exam: Exam;
  enrollment: ExamEnrollment;
}

/**
 * Reads the grading snapshot for a given attempt: loads the attempt, its exam,
 * and the candidate's enrollment. Returns null if the attempt does not exist.
 */
export async function readGradingSnapshot(
  examRepo: ExamRepository,
  enrollmentRepo: EnrollmentRepository,
  attemptRepo: AttemptRepository,
  attemptId: string,
): Promise<GradingSnapshot | null> {
  const attempt = await attemptRepo.findById(attemptId);
  if (!attempt) {
    return null;
  }

  const exam = await examRepo.findById(attempt.examId);
  if (!exam) {
    throw new ValidationError("Exam not found");
  }

  const enrollment = await enrollmentRepo.findByExamAndCandidate(
    attempt.examId,
    attempt.candidateId,
  );
  if (!enrollment) {
    throw new ValidationError("Enrollment not found");
  }

  return { attempt, exam, enrollment };
}

/**
 * Computes the grading result by delegating to the domain-gradeAnswers function.
 * Returns a ScoreResult with per-question scores, total, and pass/fail.
 */
export function computeGradingResult(
  attempt: ExamAttempt,
  exam: Exam,
  now: Date,
): ScoreResult {
  return gradeAnswers(
    attempt.id,
    attempt.questionSnapshot,
    attempt.answers,
    exam.passingScore,
    now,
  );
}

/**
 * Persists the grading results: transitions the attempt to graded, updates the
 * enrollment's final score per the score strategy, and transitions the enrollment
 * to completed if the exam is finished.
 */
export async function finalizeGrading(
  enrollmentRepo: EnrollmentRepository,
  attemptRepo: AttemptRepository,
  attemptId: string,
  enrollmentId: string,
  result: ScoreResult,
  exam: Exam,
): Promise<boolean> {
  const attempt = await attemptRepo.findById(attemptId);
  if (!attempt) {
    throw new ValidationError("Attempt not found");
  }

  if (attempt.status === "graded") {
    return false;
  }

  const tr = transition(attempt.status, "grade" as AttemptCommand);
  if (!isTransitionOk(tr)) {
    throw new InvalidStateTransitionError(
      `Cannot grade attempt in ${attempt.status} state`,
    );
  }

  const gradedUpdate = await attemptRepo.update(attemptId, {
    status: "graded",
    gradingResult: result.questionResults,
    score: result.totalScore,
    passed: result.passed,
    gradedAt: result.gradedAt,
  });
  if (!gradedUpdate) {
    throw new ValidationError("Failed to persist graded results");
  }

  const enrollment = await enrollmentRepo.findByExamAndCandidate(
    attempt.examId,
    attempt.candidateId,
  );
  if (!enrollment || enrollment.id !== enrollmentId) {
    throw new ValidationError("Enrollment not found");
  }

  const selected = shouldSelectAttempt(
    exam.scoreStrategy,
    enrollment,
    result.totalScore,
  );

  const targetStatus = shouldEnrollmentComplete(
    exam,
    enrollment,
    result.passed,
    result.gradedAt,
  )
    ? "completed"
    : "started";

  if (enrollment.status !== targetStatus) {
    assertEnrollmentTransition(enrollment.status, targetStatus);
  }

  const enrollmentUpdate = await enrollmentRepo.update(enrollment.id, {
    status: targetStatus,
    ...(selected
      ? {
          finalScore: result.totalScore,
          finalPassed: result.passed,
          finalAttemptId: attempt.id,
        }
      : {}),
  });
  if (!enrollmentUpdate) {
    throw new ValidationError("Failed to update enrollment");
  }

  return true;
}

/**
 * Grades an attempt end-to-end: reads the grading snapshot, computes the result,
 * and finalizes the enrollment. Returns the ScoreResult.
 */
export async function gradeAttempt(
  examRepo: ExamRepository,
  enrollmentRepo: EnrollmentRepository,
  attemptRepo: AttemptRepository,
  attemptId: string,
  now: Date,
): Promise<ScoreResult> {
  const snapshot = await readGradingSnapshot(
    examRepo,
    enrollmentRepo,
    attemptRepo,
    attemptId,
  );
  if (!snapshot) {
    throw new ValidationError("Attempt not found");
  }

  const result = computeGradingResult(snapshot.attempt, snapshot.exam, now);
  await finalizeGrading(
    enrollmentRepo,
    attemptRepo,
    attemptId,
    snapshot.enrollment.id,
    result,
    snapshot.exam,
  );

  return result;
}
