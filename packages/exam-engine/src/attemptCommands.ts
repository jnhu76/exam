import type {
  Exam,
  ExamAttempt,
  ExamEnrollment,
  MisconductFlag,
  MisconductSeverity,
  QuestionSnapshot,
  SubmitSource,
} from "@exam/domain";
import {
  AttemptLateEntryClosedError,
  AttemptSubmitTooEarlyError,
  AttemptDeadlineExceedsExamCloseError,
  ExamNotOpenError,
  InvalidStateTransitionError,
  NotFoundError,
  ValidationError,
  MaxAttemptsReachedError,
  ExamAlreadyPassedError,
} from "@exam/domain";
import { calculateDeadlineAt } from "./timer.js";
import type { ExamRepository } from "./examCommands.js";
import { assertTransition as assertEnrollmentTransition } from "./enrollmentStateMachine.js";
import {
  transition,
  isTransitionOk,
  type AttemptCommand,
} from "./attemptStateMachine.js";

/** Repository interface for persisting exam attempt records. */
export interface AttemptRepository {
  findById(attemptId: string): Promise<ExamAttempt | null> | ExamAttempt | null;
  findByIdForUpdate(
    attemptId: string,
  ): Promise<ExamAttempt | null> | ExamAttempt | null;
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

/** Repository interface for persisting exam enrollment records. */
export interface EnrollmentRepository {
  findByExamAndCandidate(
    examId: string,
    candidateId: string,
  ): Promise<ExamEnrollment | null> | ExamEnrollment | null;
  findByExamAndCandidateForUpdate(
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

/** Exam statuses that are considered open for candidate participation. */
const OPEN_STATUSES: Set<string> = new Set(["published", "open"]);

/** Error message returned when a candidate is not enrolled in the exam. */
const NOT_ENROLLED_MESSAGE =
  "Candidate is not enrolled in this exam. An Admin must assign the candidate first.";

/** Starts a new attempt or restores a disrupted attempt for the given candidate. */
export async function startAttempt(
  examRepo: ExamRepository,
  enrollmentRepo: EnrollmentRepository,
  attemptRepo: AttemptRepository,
  examId: string,
  candidateId: string,
  now: Date,
): Promise<ExamAttempt> {
  const { attempt } = await startOrRestoreAttempt(
    examRepo,
    enrollmentRepo,
    attemptRepo,
    examId,
    candidateId,
    now,
  );
  return attempt;
}

/** Result returned when starting or restoring an attempt. */
export interface StartAttemptResult {
  attempt: ExamAttempt;
  isNew: boolean;
}

/** Options for customizing the un-assigned candidate error behavior. */
export interface StartAttemptOptions {
  unassignedErrorFactory?: (message: string) => Error;
}

/**
 * Starts or restores an exam attempt for the given candidate.
 *
 * If an active in-progress attempt exists, returns it directly.
 * If a disrupted attempt exists, restores it to in_progress.
 * Otherwise, validates eligibility and creates a new attempt.
 */
export async function startOrRestoreAttempt(
  examRepo: ExamRepository,
  enrollmentRepo: EnrollmentRepository,
  attemptRepo: AttemptRepository,
  examId: string,
  candidateId: string,
  now: Date,
  options: StartAttemptOptions = {},
): Promise<StartAttemptResult> {
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

  const enrollment = await enrollmentRepo.findByExamAndCandidateForUpdate(
    examId,
    candidateId,
  );
  if (!enrollment) {
    throw options.unassignedErrorFactory
      ? options.unassignedErrorFactory(NOT_ENROLLED_MESSAGE)
      : new ValidationError(NOT_ENROLLED_MESSAGE);
  }

  const activeAttempt = await attemptRepo.findActiveByEnrollment(enrollment.id);
  if (activeAttempt) {
    if (activeAttempt.status === "disrupted") {
      const restored = await restoreAttempt(
        examRepo,
        attemptRepo,
        activeAttempt.id,
        now,
      );
      return { attempt: restored, isNew: false };
    }
    return { attempt: activeAttempt, isNew: false };
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

  // ADR-005 Slice 3 §4.3: late-entry cutoff on a NEW attempt only. resume/
  // restore (handled above) never hits this. latestStartAt = openAt + offset.
  if (exam.latestStartOffsetMinutes != null) {
    const latestStartAt = new Date(
      exam.openAt.getTime() + exam.latestStartOffsetMinutes * 60_000,
    );
    if (now.getTime() > latestStartAt.getTime()) {
      throw new AttemptLateEntryClosedError({ latestStartAt, now });
    }
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

  if (enrollment.status !== "started") {
    assertEnrollmentTransition(enrollment.status, "started");
  }
  const updatedEnrollment = await enrollmentRepo.update(enrollment.id, {
    status: "started",
    attemptCount: attemptNo,
  });
  if (!updatedEnrollment) {
    throw new ValidationError("Enrollment not found after update");
  }

  return { attempt, isNew: true };
}

/**
 * Submits an attempt, transitioning in_progress/disrupted -> submitted.
 *
 * ADR-005 Slice 3 §4.4 guard ordering (binding):
 * 1. Idempotent already-submitted path FIRST: if the attempt is already in a
 *    terminal/post-submit state (submitted/grading/graded), return it as-is.
 *    A re-submit after the deadline scanner already submitted must not be
 *    re-rejected by the early-submit guard.
 * 2. State-machine transition assertion.
 * 3. Only for a genuine in_progress/disrupted -> submitted transition with
 *    `source === "candidate"` -> apply minSubmitAfterStartMinutes. Other
 *    sources (deadline_scanner/proctor/system) bypass it.
 */
export async function submitAttempt(
  attemptRepo: AttemptRepository,
  attemptId: string,
  now: Date,
  opts: {
    source?: SubmitSource;
    minSubmitAfterStartMinutes?: number | null;
  } = {},
): Promise<ExamAttempt> {
  const attempt = await attemptRepo.findById(attemptId);
  if (!attempt) {
    throw new ValidationError("Attempt not found");
  }

  // 1. Idempotent already-submitted path — runs BEFORE any other check.
  if (
    attempt.status === "submitted" ||
    attempt.status === "grading" ||
    attempt.status === "graded"
  ) {
    return attempt;
  }

  // 2. State-machine transition assertion.
  const result = transition(attempt.status, "submit" as AttemptCommand);
  if (!isTransitionOk(result)) {
    throw new InvalidStateTransitionError(
      `Cannot submit attempt in ${attempt.status} state`,
    );
  }

  // 3. Candidate min-submit guard (source-gated).
  if (opts.source === "candidate" && opts.minSubmitAfterStartMinutes != null) {
    const startedAt = attempt.startedAt;
    if (startedAt) {
      const earliestSubmitAt = new Date(
        startedAt.getTime() + opts.minSubmitAfterStartMinutes * 60_000,
      );
      if (now.getTime() < earliestSubmitAt.getTime()) {
        throw new AttemptSubmitTooEarlyError({
          earliestSubmitAt,
          remainingSeconds: Math.ceil(
            (earliestSubmitAt.getTime() - now.getTime()) / 1000,
          ),
        });
      }
    }
  }

  const submitted = await attemptRepo.update(attemptId, {
    status: "submitted",
    submittedAt: now,
  });
  if (!submitted) throw new ValidationError("Attempt not found after update");
  return submitted;
}

/**
 * Marks an attempt as disrupted (e.g., client heartbeat timeout).
 * Only applies to in_progress attempts.
 */
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

/**
 * Restores a disrupted attempt to in_progress state, refreshing the last activity timestamp
 * and adjusting the deadline to compensate for time spent disconnected.
 * Uses row-level locking to prevent concurrent restore double-applying the adjustment.
 */
export async function restoreAttempt(
  examRepo: ExamRepository,
  attemptRepo: AttemptRepository,
  attemptId: string,
  now: Date,
): Promise<ExamAttempt> {
  const attempt = await attemptRepo.findByIdForUpdate(attemptId);
  if (!attempt) {
    throw new ValidationError("Attempt not found");
  }

  if (attempt.status === "in_progress") {
    return attempt;
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

  const disconnectedDuration = Math.max(
    0,
    now.getTime() - (attempt.lastActivityAt?.getTime() ?? now.getTime()),
  );

  let updatedDeadline: Date | undefined;
  if (attempt.deadlineAt) {
    const adjustedDeadline =
      attempt.deadlineAt.getTime() + disconnectedDuration;
    updatedDeadline = exam.closeAt
      ? new Date(Math.min(adjustedDeadline, exam.closeAt.getTime()))
      : new Date(adjustedDeadline);
  }

  const updateData: Partial<ExamAttempt> = {
    status: "in_progress",
    lastActivityAt: now,
    ...(updatedDeadline !== undefined && { deadlineAt: updatedDeadline }),
  };

  const restored = await attemptRepo.update(attemptId, updateData);
  if (!restored) throw new ValidationError("Attempt not found after update");
  return restored;
}

/**
 * Records a misconduct flag on an attempt (P2C-J4). Does NOT change
 * `status` — the flag is informational. Allowed on any attempt status (§16).
 * Idempotent: re-flagging overwrites the previous flag. No transaction or row
 * lock (§17) — a single best-effort jsonb update.
 */
export async function flagMisconduct(
  attemptRepo: AttemptRepository,
  attemptId: string,
  actorId: string,
  severity: MisconductSeverity,
  notes: string,
  now: Date,
): Promise<ExamAttempt> {
  const trimmed = notes.trim();
  if (trimmed.length === 0) {
    throw new ValidationError("misconduct notes must not be empty");
  }
  if (trimmed.length > 1000) {
    throw new ValidationError("misconduct notes must be at most 1000 chars");
  }

  // P2C-J4 §16: allowed on any attempt status. No state transition, no
  // row lock (§17: transaction=no, row lock=no) — flagging is a single
  // best-effort jsonb update.
  const attempt = await attemptRepo.findById(attemptId);
  if (!attempt) {
    throw new NotFoundError("Attempt not found");
  }

  const flag: MisconductFlag = {
    flaggedAt: now,
    flaggedBy: actorId,
    notes: trimmed,
    severity,
  };

  const updated = await attemptRepo.update(attemptId, { misconduct: flag });
  if (!updated) throw new NotFoundError("Attempt not found after update");
  return updated;
}
