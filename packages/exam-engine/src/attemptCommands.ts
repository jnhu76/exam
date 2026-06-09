import type {
  Exam,
  ExamAttempt,
  ExamEnrollment,
  QuestionSnapshot,
} from "@exam/domain";
import {
  ExamNotOpenError,
  ExamTimeExpiredError,
  InvalidStateTransitionError,
  ValidationError,
} from "@exam/domain";
import { calculateDeadlineAt } from "./timer.js";
import type { ExamRepository } from "./examCommands.js";
import {
  transition,
  isTransitionOk,
  type AttemptCommand,
} from "./attemptStateMachine.js";

export interface AttemptRepository {
  findById(attemptId: string): ExamAttempt | null;
  findActiveByEnrollment(enrollmentId: string): ExamAttempt | null;
  findByEnrollmentAndAttemptNo(
    enrollmentId: string,
    attemptNo: number,
  ): ExamAttempt | null;
  create(
    input: Omit<ExamAttempt, "id" | "createdAt" | "updatedAt"> & {
      id?: string;
    },
  ): ExamAttempt;
  update(attemptId: string, data: Partial<ExamAttempt>): ExamAttempt | null;
}

export interface EnrollmentRepository {
  findByExamAndCandidate(
    examId: string,
    candidateId: string,
  ): ExamEnrollment | null;
  create(
    input: Omit<ExamEnrollment, "id" | "createdAt" | "updatedAt"> & {
      id?: string;
    },
  ): ExamEnrollment;
  update(
    enrollmentId: string,
    data: Partial<ExamEnrollment>,
  ): ExamEnrollment | null;
}

const OPEN_STATUSES: Set<string> = new Set(["published", "open"]);

export function startAttempt(
  examRepo: ExamRepository,
  enrollmentRepo: EnrollmentRepository,
  attemptRepo: AttemptRepository,
  examId: string,
  candidateId: string,
  now: Date,
): ExamAttempt {
  const exam = examRepo.findById(examId);
  if (!exam) {
    throw new ValidationError("Exam not found");
  }

  if (!OPEN_STATUSES.has(exam.status)) {
    throw new ExamNotOpenError("Exam is not open");
  }

  if (now < exam.openAt || now >= exam.closeAt) {
    throw new ExamNotOpenError("Current time is outside exam open window");
  }

  let enrollment = enrollmentRepo.findByExamAndCandidate(examId, candidateId);
  if (!enrollment) {
    enrollment = enrollmentRepo.create({
      organizationId: exam.organizationId,
      examId,
      candidateId,
      status: "assigned",
      attemptCount: 0,
    });
  }

  const activeAttempt = attemptRepo.findActiveByEnrollment(enrollment.id);
  if (activeAttempt) {
    return activeAttempt;
  }

  if (
    exam.retakePolicy === "max_attempts" &&
    enrollment.attemptCount >= exam.maxAttempts
  ) {
    throw new ValidationError("Maximum attempt count reached");
  }

  if (
    exam.retakePolicy === "pass_then_stop" &&
    enrollment.finalPassed === true
  ) {
    throw new ValidationError("Already passed this exam");
  }

  const attemptNo = enrollment.attemptCount + 1;
  const deadlineAt = calculateDeadlineAt(now, exam.durationMinutes);

  const attempt = attemptRepo.create({
    organizationId: exam.organizationId,
    examId,
    enrollmentId: enrollment.id,
    candidateId,
    attemptNo,
    status: "in_progress",
    questionSnapshot: exam.questionSnapshot as QuestionSnapshot[],
    answers: [],
    startedAt: now,
    deadlineAt,
    lastActivityAt: now,
  });

  enrollmentRepo.update(enrollment.id, {
    status: "started",
    attemptCount: attemptNo,
  });

  return attempt;
}

export function submitAttempt(
  attemptRepo: AttemptRepository,
  attemptId: string,
  now: Date,
): ExamAttempt {
  const attempt = attemptRepo.findById(attemptId);
  if (!attempt) {
    throw new ValidationError("Attempt not found");
  }

  const guards = attempt.deadlineAt
    ? { deadlineAt: attempt.deadlineAt, now }
    : { now };

  const result = transition(attempt.status, "submit" as AttemptCommand, guards);

  if (!isTransitionOk(result)) {
    if (result.reason === "DEADLINE_EXCEEDED") {
      throw new ExamTimeExpiredError("Attempt deadline exceeded");
    }
    throw new InvalidStateTransitionError(
      `Cannot submit attempt in ${attempt.status} state`,
    );
  }

  return attemptRepo.update(attemptId, {
    status: "submitted",
    submittedAt: now,
  })!;
}

export function markDisrupted(
  attemptRepo: AttemptRepository,
  attemptId: string,
): ExamAttempt {
  const attempt = attemptRepo.findById(attemptId);
  if (!attempt) {
    throw new ValidationError("Attempt not found");
  }

  const result = transition(attempt.status, "disrupt" as AttemptCommand);
  if (!isTransitionOk(result)) {
    throw new InvalidStateTransitionError(
      `Cannot mark disrupted from ${attempt.status} state`,
    );
  }

  return attemptRepo.update(attemptId, { status: "disrupted" })!;
}

export function restoreAttempt(
  examRepo: ExamRepository,
  attemptRepo: AttemptRepository,
  attemptId: string,
  now: Date,
): ExamAttempt {
  const attempt = attemptRepo.findById(attemptId);
  if (!attempt) {
    throw new ValidationError("Attempt not found");
  }

  const result = transition(attempt.status, "restore" as AttemptCommand);
  if (!isTransitionOk(result)) {
    throw new InvalidStateTransitionError(
      `Cannot restore attempt from ${attempt.status} state`,
    );
  }

  const exam = examRepo.findById(attempt.examId);
  if (!exam) {
    throw new ValidationError("Exam not found");
  }

  const updateData: Partial<ExamAttempt> = {
    status: "in_progress",
    lastActivityAt: now,
  };

  return attemptRepo.update(attemptId, updateData)!;
}
