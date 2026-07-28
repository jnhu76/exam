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
  GradingStatus,
  requiresManualGrading,
} from "@exam/domain";
import { buildSubmittedAnswersSnapshot } from "./answerProtocol.js";
import { calculateDeadlineAt } from "./timer.js";
import type { ExamRepository } from "./examCommands.js";
import { assertTransition as assertEnrollmentTransition } from "./enrollmentStateMachine.js";
import {
  transition,
  isTransitionOk,
  type AttemptCommand,
} from "./attemptStateMachine.js";
import type { GradingWorksetRepository } from "./gradingWorkset.js";
import {
  materializeGradingWorkset,
  validateGradingWorksetConsistency,
} from "./gradingWorkset.js";

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
  /**
   * Atomic status-qualified heartbeat write. Updates `lastActivityAt`
   * iff the row is still `in_progress`, returning the updated row or null
   * (zero rows). This is the write-time predicate that closes the
   * heartbeat/scanner TOCTOU: a `disrupted` or terminal row updates zero
   * rows and cannot produce heartbeat success.
   */
  refreshLastActivityIfInProgress(
    attemptId: string,
    now: Date,
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
 * This is the SINGLE authoritative submit/freeze/materialization seam
 * (P3-L0-2E). A successful return guarantees:
 *
 *   - `submitted_answers` is frozen from draft answers
 *   - exactly one grading entry exists per frozen question
 *   - every grading entry is consistent with frozen grading truth
 *   - attempt lifecycle state is consistent with the grading workset
 *
 * Row-lock discipline: the attempt is read via `findByIdForUpdate` so the
 * read → validate → write window is serialized against a concurrent
 * deadline-scanner autoSubmit (and admin force-submit) on the same row.
 *
 * ADR-005 Slice 3 §4.4 guard ordering (binding):
 * 1. Idempotent already-submitted path FIRST: if the attempt is already in a
 *    terminal/post-submit state (submitted/grading/graded), validate the
 *    existing workset for exact consistency and return it as-is. A re-submit
 *    after the deadline scanner already submitted must not be re-rejected by
 *    the early-submit guard.
 * 2. State-machine transition assertion.
 * 3. Only for a genuine in_progress/disrupted -> submitted transition with
 *    `source === "candidate"` -> apply minSubmitAfterStartMinutes. Other
 *    sources (deadline_scanner/proctor/system) bypass it.
 *
 * Workset materialization is owned by this function, NOT by callers. The
 * `gradingWorksetRepo` parameter is REQUIRED — there is no valid production
 * invocation that skips grading workset ownership.
 */
export async function submitAttempt(
  attemptRepo: AttemptRepository,
  gradingWorksetRepo: GradingWorksetRepository,
  attemptId: string,
  now: Date,
  opts: {
    source?: SubmitSource;
    minSubmitAfterStartMinutes?: number | null;
    /**
     * P3-L0-2: why the attempt is being submitted. Defaults to `'manual'`
     * (candidate submit). Deadline auto-submit callers pass `'deadline'`.
     * Persisted to `exam_attempts.submission_reason` alongside the frozen
     * `submitted_answers` snapshot.
     */
    submissionReason?: "manual" | "deadline";
  } = {},
): Promise<ExamAttempt> {
  const attempt = await attemptRepo.findByIdForUpdate(attemptId);
  if (!attempt) {
    throw new ValidationError("Attempt not found");
  }

  const existingEntries = await gradingWorksetRepo.findByAttempt(attemptId);

  // 1. Idempotent already-submitted path — runs BEFORE any other check.
  // P3-L0-2: do NOT rebuild submittedAnswers here — return the existing
  // frozen snapshot + reason + submittedAt unchanged (double-submit safety).
  // P3-L0-2E: validate the existing workset for exact consistency — fail
  // closed on partial, mismatched, or extra entries.
  if (
    attempt.status === "submitted" ||
    attempt.status === "grading" ||
    attempt.status === "graded"
  ) {
    validateGradingWorksetConsistency(attempt, existingEntries);
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

  // 4. P3-L0-2E fresh-submit precondition: zero pre-existing grading entries.
  // If entries exist before the authoritative submission freeze, the model is
  // violated — fail closed. Do not merge, fill gaps, or delete-and-rebuild.
  if (existingEntries.length > 0) {
    throw new Error(
      `Grading workset entries exist before authoritative submission freeze ` +
        `for attempt ${attemptId}: found ${existingEntries.length} entries. ` +
        "The submit freeze barrier must be the sole workset creation authority.",
    );
  }

  // 5. P3-L0-2 submit freeze barrier (ADR-008): normalize the locked draft
  // answers into a clean SubmittedAnswersSnapshot BEFORE the status flip.
  const submittedAnswers = buildSubmittedAnswersSnapshot(
    attempt.answers,
    attempt.questionSnapshot,
  );

  // P3-L0-2C: classify the manual-grading requirement ONCE, at the freeze
  // barrier, from the authoritative frozen question snapshot. protocol §1.4
  // — text_response is the manual-grading QuestionType, NOT standardAnswer.
  const gradingStatus = requiresManualGrading(attempt.questionSnapshot)
    ? GradingStatus.PendingManual
    : GradingStatus.AutoGraded;

  // 6. Persist submit lifecycle state (freeze barrier).
  const submitted = await attemptRepo.update(attemptId, {
    status: "submitted",
    submittedAt: now,
    submittedAnswers,
    submissionReason: opts.submissionReason ?? "manual",
    gradingStatus,
  });
  if (!submitted) throw new ValidationError("Attempt not found after update");

  // 7. P3-L0-2E: materialize the durable grading workset from frozen truth.
  // This is the sole workset creation site. Atomic with the submit update
  // within the same caller transaction.
  await materializeGradingWorkset(submitted, gradingWorksetRepo);

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
 * Lifecycle outcome of {@link restoreAttemptState}. The composed restore
 * command interprets these to build its internal result.
 */
export type RestoreLifecycleOutcome =
  | "restored"
  | "already_in_progress"
  | "terminal";

/**
 * Performs the lifecycle-only portion of an interrupted-attempt restore
 * (ADR-013 §6, R7).
 *
 * This function consumes the **already-locked** attempt (the composed
 * command owns all locking). It ONLY performs the `disrupted → in_progress`
 * transition plus the `lastActivityAt` refresh and active-pointer/interrupted
 * mirror clearing. It MUST NOT:
 *   - read `lastActivityAt` to compute compensation;
 *   - read the Exam policy;
 *   - mutate the deadline;
 *   - insert a time-adjustment ledger row;
 *   - decide bounded caps.
 *
 * Compensation is the separate {@link evaluateInterruptionTimePolicy}
 * concern, composed in one transaction by {@link restoreInterruptedAttempt}.
 *
 * Returns:
 *   - `"already_in_progress"` when the locked attempt is already in_progress;
 *   - `"terminal"` when it is in a terminal (submitted|grading|graded|voided)
 *     state;
 *   - `"restored"` after a successful disrupted → in_progress transition.
 *
 * Non-disrupted, non-terminal states (not_started|queued) fail closed.
 */
export async function restoreAttemptState(
  attempt: ExamAttempt,
  attemptRepo: AttemptRepository,
  now: Date,
): Promise<{ outcome: RestoreLifecycleOutcome; attempt: ExamAttempt }> {
  if (attempt.status === "in_progress") {
    return { outcome: "already_in_progress", attempt };
  }
  if (
    attempt.status === "submitted" ||
    attempt.status === "grading" ||
    attempt.status === "graded" ||
    attempt.status === "voided"
  ) {
    return { outcome: "terminal", attempt };
  }
  if (attempt.status !== "disrupted") {
    throw new InvalidStateTransitionError(
      `Cannot restore attempt from ${attempt.status} state`,
    );
  }
  const restored = await attemptRepo.update(attempt.id, {
    status: "in_progress",
    lastActivityAt: now,
    currentInterruptionId: null,
    interruptedAt: null,
  });
  if (!restored) throw new ValidationError("Attempt not found after update");
  return { outcome: "restored", attempt: restored };
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

/**
 * Extends an attempt's deadline by a positive number of minutes (admin
 * intervention). Allowed for in_progress/disrupted attempts only. Unlike
 * `restoreAttempt`, the extension is REJECTED (not clamped) when the new
 * deadline would exceed `exam.closeAt`.
 *
 * P2C-J3 §16/§17: no state transition — only `deadlineAt` is updated. The
 * caller is expected to wrap this in `executeInTransaction` and to use a
 * `findByIdForUpdate`-backed attempt repo so the read+update is atomic
 * against concurrent candidate saves / scanner activity.
 */
export async function extendAttemptTime(
  examRepo: ExamRepository,
  attemptRepo: AttemptRepository,
  attemptId: string,
  additionalMinutes: number,
  now: Date,
): Promise<ExamAttempt> {
  if (!Number.isInteger(additionalMinutes) || additionalMinutes <= 0) {
    throw new ValidationError("additionalMinutes must be a positive integer");
  }

  const attempt = await attemptRepo.findByIdForUpdate(attemptId);
  if (!attempt) {
    throw new NotFoundError("Attempt not found");
  }

  // No state transition, but only active/abandoned attempts are extendable.
  if (attempt.status !== "in_progress" && attempt.status !== "disrupted") {
    throw new InvalidStateTransitionError(
      `Cannot extend time for attempt in ${attempt.status} state`,
    );
  }

  const exam = await examRepo.findById(attempt.examId);
  if (!exam) {
    throw new NotFoundError("Exam not found");
  }

  // Base the extension on the existing deadline, or `now` if none is set.
  const baseMs = attempt.deadlineAt
    ? attempt.deadlineAt.getTime()
    : now.getTime();
  const newDeadlineAt = new Date(baseMs + additionalMinutes * 60_000);

  if (newDeadlineAt.getTime() > exam.closeAt.getTime()) {
    throw new AttemptDeadlineExceedsExamCloseError({
      newDeadlineAt,
      examCloseAt: exam.closeAt,
    });
  }

  const updated = await attemptRepo.update(attemptId, {
    deadlineAt: newDeadlineAt,
  });
  if (!updated) throw new NotFoundError("Attempt not found after update");
  return updated;
}
