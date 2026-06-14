import type {
  Exam,
  ExamAttempt,
  ExamEnrollment,
  QuestionSnapshot,
} from "@exam/domain";
import {
  ExamNotOpenError,
  InvalidStateTransitionError,
  ValidationError,
  MaxAttemptsReachedError,
  ExamAlreadyPassedError,
} from "@exam/domain";
import { calculateDeadlineAt } from "./timer.js";
import type { ExamRepository } from "./examCommands.js";
import {
  transition,
  isTransitionOk,
  type AttemptCommand,
} from "./attemptStateMachine.js";

export interface AttemptRepository {
  findById(attemptId: string): Promise<ExamAttempt | null> | ExamAttempt | null;
  findActiveByEnrollment(
    enrollmentId: string,
  ): Promise<ExamAttempt | null> | ExamAttempt | null;
  findByEnrollmentAndAttemptNo(
    enrollmentId: string,
    attemptNo: number,
  ): Promise<ExamAttempt | null> | ExamAttempt | null;
  create(
    input: Omit<ExamAttempt, "id" | "createdAt" | "updatedAt"> & {
      id?: string;
    },
  ): Promise<ExamAttempt> | ExamAttempt;
  update(
    attemptId: string,
    data: Partial<ExamAttempt>,
  ): Promise<ExamAttempt | null> | ExamAttempt | null;
}

export interface EnrollmentRepository {
  findByExamAndCandidate(
    examId: string,
    candidateId: string,
  ): Promise<ExamEnrollment | null> | ExamEnrollment | null;
  create(
    input: Omit<ExamEnrollment, "id" | "createdAt" | "updatedAt"> & {
      id?: string;
    },
  ): Promise<ExamEnrollment> | ExamEnrollment;
  update(
    enrollmentId: string,
    data: Partial<ExamEnrollment>,
  ): Promise<ExamEnrollment | null> | ExamEnrollment | null;
}

const OPEN_STATUSES: Set<string> = new Set(["published", "open"]);

export async function startAttempt(
  examRepo: ExamRepository,
  enrollmentRepo: EnrollmentRepository,
  attemptRepo: AttemptRepository,
  examId: string,
  candidateId: string,
  now: Date,
): Promise<ExamAttempt> {
  const exam = await examRepo.findById(examId);
  if (!exam) {
    throw new ValidationError("Exam not found");
  }

  if (!OPEN_STATUSES.has(exam.status)) {
    throw new ExamNotOpenError("Exam is not open");
  }

  if (now < exam.openAt || now >= exam.closeAt) {
    throw new ExamNotOpenError("Current time is outside exam open window");
  }

  let enrollment = await enrollmentRepo.findByExamAndCandidate(
    examId,
    candidateId,
  );
  if (!enrollment) {
    enrollment = await enrollmentRepo.create({
      organizationId: exam.organizationId,
      examId,
      candidateId,
      status: "assigned",
      attemptCount: 0,
    });
  }

  const activeAttempt = await attemptRepo.findActiveByEnrollment(enrollment.id);
  if (activeAttempt) {
    return activeAttempt;
  }

  if (
    exam.retakePolicy === "max_attempts" &&
    enrollment.attemptCount >= exam.maxAttempts
  ) {
    throw new MaxAttemptsReachedError("Maximum attempt count reached");
  }

  if (
    exam.retakePolicy === "pass_then_stop" &&
    enrollment.finalPassed === true
  ) {
    throw new ExamAlreadyPassedError("Already passed this exam");
  }

  const attemptNo = enrollment.attemptCount + 1;
  const deadlineAt = calculateDeadlineAt(now, exam.durationMinutes);

  const attempt = await attemptRepo.create({
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

  const updatedEnrollment = await enrollmentRepo.update(enrollment.id, {
    status: "started",
    attemptCount: attemptNo,
  });
  if (!updatedEnrollment) {
    throw new ValidationError("Enrollment not found after update");
  }

  return attempt;
}

export async function submitAttempt(
  attemptRepo: AttemptRepository,
  attemptId: string,
  now: Date,
): Promise<ExamAttempt> {
  const attempt = await attemptRepo.findById(attemptId);
  if (!attempt) {
    throw new ValidationError("Attempt not found");
  }

  const result = transition(attempt.status, "submit" as AttemptCommand);

  if (!isTransitionOk(result)) {
    throw new InvalidStateTransitionError(
      `Cannot submit attempt in ${attempt.status} state`,
    );
  }

  const submitted = await attemptRepo.update(attemptId, {
    status: "submitted",
    submittedAt: now,
  });
  if (!submitted) throw new ValidationError("Attempt not found after update");
  return submitted;
}

export async function markDisrupted(
  attemptRepo: AttemptRepository,
  attemptId: string,
): Promise<ExamAttempt> {
  const attempt = await attemptRepo.findById(attemptId);
  if (!attempt) {
    throw new ValidationError("Attempt not found");
  }

  const result = transition(attempt.status, "disrupt" as AttemptCommand);
  if (!isTransitionOk(result)) {
    throw new InvalidStateTransitionError(
      `Cannot mark disrupted from ${attempt.status} state`,
    );
  }

  const disrupted = await attemptRepo.update(attemptId, {
    status: "disrupted",
  });
  if (!disrupted) throw new ValidationError("Attempt not found after update");
  return disrupted;
}

export async function restoreAttempt(
  examRepo: ExamRepository,
  attemptRepo: AttemptRepository,
  attemptId: string,
  now: Date,
): Promise<ExamAttempt> {
  const attempt = await attemptRepo.findById(attemptId);
  if (!attempt) {
    throw new ValidationError("Attempt not found");
  }

  const result = transition(attempt.status, "restore" as AttemptCommand);
  if (!isTransitionOk(result)) {
    throw new InvalidStateTransitionError(
      `Cannot restore attempt from ${attempt.status} state`,
    );
  }

  const exam = await examRepo.findById(attempt.examId);
  if (!exam) {
    throw new ValidationError("Exam not found");
  }

  const updateData: Partial<ExamAttempt> = {
    status: "in_progress",
    lastActivityAt: now,
  };

  const restored = await attemptRepo.update(attemptId, updateData);
  if (!restored) throw new ValidationError("Attempt not found after update");
  return restored;
}
