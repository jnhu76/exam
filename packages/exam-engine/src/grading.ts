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
import {
  transition,
  isTransitionOk,
  type AttemptCommand,
} from "./attemptStateMachine.js";

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

export async function gradeAttempt(
  examRepo: ExamRepository,
  enrollmentRepo: EnrollmentRepository,
  attemptRepo: AttemptRepository,
  attemptId: string,
  now: Date,
): Promise<ScoreResult> {
  const attempt = await attemptRepo.findById(attemptId);
  if (!attempt) {
    throw new ValidationError("Attempt not found");
  }

  const tr = transition(attempt.status, "grade" as AttemptCommand);
  if (!isTransitionOk(tr)) {
    throw new InvalidStateTransitionError(
      `Cannot grade attempt in ${attempt.status} state`,
    );
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

  const gradingUpdate = await attemptRepo.update(attemptId, {
    status: "grading",
  });
  if (!gradingUpdate) {
    throw new ValidationError("Failed to update attempt status to grading");
  }
  const result = gradeAnswers(
    attempt.id,
    attempt.questionSnapshot,
    attempt.answers,
    exam.passingScore,
    now,
  );
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

  const selected = shouldSelectAttempt(
    exam.scoreStrategy,
    enrollment,
    result.totalScore,
  );
  const enrollmentUpdate = await enrollmentRepo.update(enrollment.id, {
    status: "completed",
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

  return result;
}
