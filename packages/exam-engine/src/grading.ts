import type { ExamEnrollment, ScoreResult, ScoreStrategy } from "@exam/domain";
import {
  gradeAnswers,
  InvalidStateTransitionError,
  ValidationError,
} from "@exam/domain";
import type {
  AttemptRepository,
  EnrollmentRepository,
} from "./attemptCommands.js";
import type { ExamRepository } from "./examCommands.js";

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

export function gradeAttempt(
  examRepo: ExamRepository,
  enrollmentRepo: EnrollmentRepository,
  attemptRepo: AttemptRepository,
  attemptId: string,
  now: Date,
): ScoreResult {
  const attempt = attemptRepo.findById(attemptId);
  if (!attempt) {
    throw new ValidationError("Attempt not found");
  }
  if (attempt.status !== "submitted") {
    throw new InvalidStateTransitionError(
      `Cannot grade attempt in ${attempt.status} state`,
    );
  }
  const exam = examRepo.findById(attempt.examId);
  if (!exam) {
    throw new ValidationError("Exam not found");
  }
  const enrollment = enrollmentRepo.findByExamAndCandidate(
    attempt.examId,
    attempt.candidateId,
  );
  if (!enrollment) {
    throw new ValidationError("Enrollment not found");
  }

  attemptRepo.update(attemptId, { status: "grading" });
  const result = gradeAnswers(
    attempt.id,
    attempt.questionSnapshot,
    attempt.answers,
    exam.passingScore,
    now,
  );
  attemptRepo.update(attemptId, {
    status: "graded",
    gradingResult: result.questionResults,
    score: result.totalScore,
    passed: result.passed,
    gradedAt: result.gradedAt,
  });

  const selected = shouldSelectAttempt(
    exam.scoreStrategy,
    enrollment,
    result.totalScore,
  );
  enrollmentRepo.update(enrollment.id, {
    status: "completed",
    ...(selected
      ? {
          finalScore: result.totalScore,
          finalPassed: result.passed,
          finalAttemptId: attempt.id,
        }
      : {}),
  });

  return result;
}
