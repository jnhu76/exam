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
  AttemptStartSubmitInfeasibleError,
  AttemptSubmitTooEarlyError,
  AttemptDeadlineExceedsExamCloseError,
  ExamNotOpenError,
  InvalidStateTransitionError,
  NotFoundError,
  ValidationError,
  MaxAttemptsReachedError,
  ExamAlreadyPassedError,
  RetakeDeferredError,
  GradingStatus,
  requiresManualGrading,
} from "@exam/domain";
import { buildSubmittedAnswersSnapshot } from "./answerProtocol.js";
import { isCandidateRetakeDeferred } from "./candidateResultVisibility.js";
import {
  calculateDeadlineAt,
  computeEffectiveDeadline,
  computeSyncDeadline,
} from "./timer.js";
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
import type {
  InterruptionEpisodeRepository,
  InterruptionEventRepository,
  TimeAdjustmentRepository,
} from "./interruptionRepositories.js";
import type { SubmitInterruptionResolution } from "./restoreInterruption.js";
import {
  resolveActiveInterruptionOnTerminalization,
  restoreInterruptedAttempt,
} from "./restoreInterruption.js";
import { resolveAttemptTimingPolicySnapshotFromExam } from "./interruptionPolicy.js";
import {
  lockEnrollmentAndActiveAttempt,
  type EnrollmentActiveAttemptLock,
} from "./lockSeam.js";

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

/** Result returned when starting or restoring an attempt. */
export interface StartAttemptResult {
  attempt: ExamAttempt;
  isNew: boolean;
}

/** Options for customizing the un-assigned candidate error behavior. */
export interface StartAttemptOptions {
  unassignedErrorFactory?: (message: string) => Error;
}

/** Required interruption/grading dependencies for the restore path. */
export interface StartOrRestoreDependencies {
  episodeRepo: InterruptionEpisodeRepository;
  eventRepo: InterruptionEventRepository;
  adjustmentRepo: TimeAdjustmentRepository;
  gradingWorksetRepo: GradingWorksetRepository;
}

/**
 * Starts or restores an exam attempt for the given candidate.
 *
 * Uses the canonical Enrollment→active-Attempt lock seam (R3/R8). If an
 * active in-progress attempt exists, returns it directly. If a disrupted
 * attempt exists, restores it via the composed restore command. Otherwise,
 * validates eligibility and creates a new attempt with the interruption
 * timing policy snapshot.
 *
 * All interruption and grading repos are REQUIRED — there is no valid
 * production or test invocation that omits them.
 */
export async function startOrRestoreAttempt(
  examRepo: ExamRepository,
  enrollmentRepo: EnrollmentRepository,
  attemptRepo: AttemptRepository,
  examId: string,
  candidateId: string,
  now: Date,
  options: StartAttemptOptions & StartOrRestoreDependencies,
): Promise<StartAttemptResult> {
  const exam = await examRepo.findById(examId);
  if (!exam) {
    throw new ValidationError("Exam not found");
  }

  if (!OPEN_STATUSES.has(exam.status)) {
    throw new ExamNotOpenError("Exam is not open");
  }

  // Phase A (#291) admission. openAt gates every mode; closeAt gates only the
  // close-bound modes (timed_window/deadline) — untimed has no closeAt.
  if (now < exam.openAt || (exam.closeAt !== null && now >= exam.closeAt)) {
    throw new ExamNotOpenError("Current time is outside exam open window");
  }

  // #291 Phase B: timed_sync entry is owned by the operator-triggered sitting
  // (Model A freeze). Before T0 there is no shared clock to join; after the
  // global deadline a new attempt would be born expired. Both keep the
  // EXAM_NOT_OPEN (409) contract — the distinction is message-level only.
  let syncDeadline: Date | null = null;
  if (exam.timingMode === "timed_sync") {
    if (exam.syncStartedAt === null) {
      throw new ExamNotOpenError("Synchronized exam has not been started");
    }
    syncDeadline = computeSyncDeadline(exam);
    if (syncDeadline !== null && now.getTime() >= syncDeadline.getTime()) {
      throw new ExamNotOpenError("Synchronized exam deadline has passed");
    }
  }

  // Use the canonical Enrollment→active-Attempt lock seam (R3).
  let lockResult: EnrollmentActiveAttemptLock;
  try {
    lockResult = await lockEnrollmentAndActiveAttempt(
      enrollmentRepo,
      attemptRepo,
      examId,
      candidateId,
    );
  } catch (err) {
    // Convert NotFoundError from the seam to the caller's expected error type.
    if (err instanceof NotFoundError) {
      throw options.unassignedErrorFactory
        ? options.unassignedErrorFactory(NOT_ENROLLED_MESSAGE)
        : new ValidationError(NOT_ENROLLED_MESSAGE);
    }
    throw err;
  }

  if (lockResult.activeAttempt) {
    if (lockResult.activeAttempt.status === "in_progress") {
      return { attempt: lockResult.activeAttempt, isNew: false };
    }
    if (
      lockResult.activeAttempt.status === "disrupted" &&
      lockResult.capability
    ) {
      const result = await restoreInterruptedAttempt(
        examRepo,
        attemptRepo,
        enrollmentRepo,
        options.episodeRepo,
        options.eventRepo,
        options.adjustmentRepo,
        options.gradingWorksetRepo,
        lockResult.capability,
        now,
      );
      return { attempt: result.attempt, isNew: false };
    }
    throw new ValidationError(
      `Cannot start: active attempt in unexpected state ${lockResult.activeAttempt.status}`,
    );
  }

  // No active attempt — validate and create a new one.
  // The seam already locked the enrollment; use it directly.
  const enrollment = lockResult.enrollment;

  if (
    exam.retakePolicy === "max_attempts" &&
    enrollment.attemptCount >= exam.maxAttempts
  ) {
    throw new MaxAttemptsReachedError("Maximum attempt count reached");
  }

  if (exam.retakePolicy === "pass_then_stop") {
    // #324 review P1-3: the retake-defer decision is made UNDER the enrollment
    // lock — the SAME serialization boundary the grading finalizer uses when it
    // commits finalScore/finalPassed/finalAttemptId. A decision made from a
    // pre-transaction read (the round-1 route pre-check) could observe
    // pre-terminalization state and, once grading commits, leak a pass/fail
    // oracle (passed 409 vs failed 201) while the result is hidden. Under the
    // lock, terminalization either already committed — in which case we defer
    // BOTH outcomes until the result is visible — or it is still blocked behind
    // us. The final attempt row is read non-locking; because the finalizer
    // writes attempt-terminal and enrollment-final in one transaction, a
    // committed finalAttemptId always resolves to committed attempt state.
    const finalAttempt = enrollment.finalAttemptId
      ? await attemptRepo.findById(enrollment.finalAttemptId)
      : null;
    if (isCandidateRetakeDeferred(exam, enrollment, finalAttempt)) {
      throw new RetakeDeferredError();
    }
    if (enrollment.finalPassed === true) {
      throw new ExamAlreadyPassedError("Already passed this exam");
    }
  }

  // ADR-005 Slice 3 §4.3: late-entry cutoff on a NEW attempt only.
  // #291 Phase B: for timed_sync the buffer is anchored at the operator-
  // triggered sitting start (T0), not at openAt — the buffer is relative to
  // when the sitting actually began. The null-anchor branch is unreachable
  // (the pre-T0 guard above already threw) but keeps the type honest.
  if (exam.latestStartOffsetMinutes != null) {
    const lateEntryAnchor =
      exam.timingMode === "timed_sync" ? exam.syncStartedAt : exam.openAt;
    if (lateEntryAnchor !== null) {
      const latestStartAt = new Date(
        lateEntryAnchor.getTime() + exam.latestStartOffsetMinutes * 60_000,
      );
      if (now.getTime() > latestStartAt.getTime()) {
        throw new AttemptLateEntryClosedError({ latestStartAt, now });
      }
    }
  }

  const attemptNo = enrollment.attemptCount + 1;
  // #291 deadline model per timing mode. timed_window carries a personal
  // deadline (start instant + duration). timed_sync copies the sitting's
  // SHARED global deadline (derived from the durable T0, never from this
  // candidate's start instant — two starts at different instants resolve to
  // the same value). The global closeAt of a deadline-mode exam must never
  // be mis-modelled as a personal deadline (computeEffectiveDeadline derives
  // it from the exam row). Canonical policy validation guarantees
  // durationMinutes for reachable timed_window exams; the null guard keeps
  // that type-honest.
  const deadlineAt =
    exam.timingMode === "timed_window" && exam.durationMinutes !== null
      ? calculateDeadlineAt(now, exam.durationMinutes)
      : exam.timingMode === "timed_sync"
        ? syncDeadline
        : null;

  // #395: manual-submit feasibility for a NEW attempt. A candidate manual
  // submit is legal only in [earliestSubmitAt, effectiveDeadline) — the submit
  // guard admits now >= earliestSubmitAt while the canonical deadline kernel
  // expires (and freezes via reconciliation) at now >= effectiveDeadline. The
  // window is therefore reachable iff earliestSubmitAt < effectiveDeadline
  // STRICTLY: at equality the only guard-passing instant is already expired,
  // leaving the attempt's normal candidate completion path unreachable (only
  // the exempt deadline_scanner/proctor/system sources could submit it).
  //
  // INVARIANT: feasibility is evaluated on the same would-be attempt shape the
  // create below persists — the effective deadline flows through the canonical
  // computeEffectiveDeadline kernel (min(closeAt, deadlineAt)), never per-mode
  // arithmetic, so timed_window/deadline/timed_sync share one rule and B2
  // timed_sync is protected without a mode-specific implementation. Null
  // effective deadline (untimed) never rejects here. Resume/restore of
  // existing attempts is never subject to this guard (new attempts only); a
  // rejection precedes both the attempt create and the enrollment update.
  if (exam.minSubmitAfterStartMinutes != null) {
    const effectiveDeadline = computeEffectiveDeadline(exam, { deadlineAt });
    if (effectiveDeadline !== null) {
      const earliestSubmitAt = calculateDeadlineAt(
        now,
        exam.minSubmitAfterStartMinutes,
      );
      if (earliestSubmitAt.getTime() >= effectiveDeadline.getTime()) {
        throw new AttemptStartSubmitInfeasibleError({
          earliestSubmitAt,
          effectiveDeadline,
        });
      }
    }
  }

  // Resolve the timing policy snapshot for the new attempt.
  const snapshot = resolveAttemptTimingPolicySnapshotFromExam(exam);

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
    interruptionTimingPolicySnapshot: snapshot,
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
    /**
     * Interruption resolution for submit terminalization (R1/R9).
     * REQUIRED for every submit call. The caller must provide:
     * - `mode: "none"` when the attempt is `in_progress` (no active interruption).
     * - `mode: "active_interruption"` when the attempt is `disrupted`, with the
     *   policy evaluator's output hint.
     *
     * Under-lock enforcement:
     * - `disrupted + mode=none` → fail closed.
     * - `in_progress + mode=active_interruption` → fail closed.
     */
    resolution: SubmitInterruptionResolution;
  },
): Promise<ExamAttempt> {
  const attempt = await attemptRepo.findByIdForUpdate(attemptId);
  if (!attempt) {
    throw new ValidationError("Attempt not found");
  }

  // R1/R9: resolve interruption terminalization BEFORE the status transition.
  // Every submit call provides an explicit resolution. The resolution function
  // enforces the under-lock status/mode consistency rules.
  await resolveActiveInterruptionOnTerminalization(
    attempt,
    opts.resolution,
    now,
  );

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
  //    Clear interruption pointers when transitioning from disrupted (R1).
  const submitted = await attemptRepo.update(attemptId, {
    status: "submitted",
    submittedAt: now,
    submittedAnswers,
    submissionReason: opts.submissionReason ?? "manual",
    gradingStatus,
    currentInterruptionId: null,
    interruptedAt: null,
  });
  if (!submitted) throw new ValidationError("Attempt not found after update");

  // 7. P3-L0-2E: materialize the durable grading workset from frozen truth.
  // This is the sole workset creation site. Atomic with the submit update
  // within the same caller transaction.
  await materializeGradingWorkset(submitted, gradingWorksetRepo);

  return submitted;
}

/**
 * Outcome of the scanner's attempt to mark an attempt as disrupted.
 *
 * - `marked`: the attempt was successfully transitioned to `disrupted` with a
 *   new episode + detected event.
 * - `fresh_under_lock`: under the row lock the attempt was still `in_progress`
 *   but its `lastActivityAt` was recent enough that no disruption was needed
 *   (race between the scan and a heartbeat refresh).
 * - `state_changed_before_lock`: by the time the row lock was acquired the
 *   attempt was no longer `in_progress` (concurrent submit/restore/etc.).
 * - `missing`: no row exists for the given id.
 */
export type ScannerDisruptResult =
  | { outcome: "marked"; attempt: ExamAttempt }
  | { outcome: "fresh_under_lock" }
  | { outcome: "state_changed_before_lock" }
  | { outcome: "missing" };

/**
 * Marks an attempt as disrupted due to heartbeat timeout.
 *
 * Owns the authoritative staleness decision under the attempt row lock
 * (Attempt-only locking protocol, R12). Creates the interruption episode
 * parent, inserts a `detected` event, and transitions the attempt to
 * `disrupted` with the active pointer in one atomic unit.
 *
 * @param attemptRepo - Attempt repository (must support FOR UPDATE).
 * @param episodeRepo - Interruption episode repository.
 * @param eventRepo - Interruption event repository.
 * @param attemptId - The attempt to disrupt.
 * @param scannerTickNow - The scanner's single authoritative tick timestamp.
 * @param heartbeatTimeoutSeconds - Staleness threshold in whole seconds.
 * @returns The disruption outcome (see {@link ScannerDisruptResult}).
 */
export async function markDisrupted(
  attemptRepo: AttemptRepository,
  episodeRepo: InterruptionEpisodeRepository,
  eventRepo: InterruptionEventRepository,
  attemptId: string,
  scannerTickNow: Date,
  heartbeatTimeoutSeconds: number,
): Promise<ScannerDisruptResult> {
  // 1. Lock the attempt row (Attempt-only, R12).
  const attempt = await attemptRepo.findByIdForUpdate(attemptId);
  if (!attempt) {
    return { outcome: "missing" };
  }

  // 2. Recheck status under the row lock.
  if (attempt.status !== "in_progress") {
    return { outcome: "state_changed_before_lock" };
  }

  // 3. Recheck staleness under the row lock. A concurrent heartbeat refresh
  //    may have pushed lastActivityAt past the threshold between the scan and
  //    the row lock.
  if (
    !attempt.lastActivityAt ||
    scannerTickNow.getTime() - attempt.lastActivityAt.getTime() <
      heartbeatTimeoutSeconds * 1000
  ) {
    return { outcome: "fresh_under_lock" };
  }

  // 4. Resolve the policy snapshot for the detected event. Post-I2 migration,
  //    every active attempt MUST have a snapshot; fail closed if missing.
  if (!attempt.interruptionTimingPolicySnapshot) {
    throw new ValidationError(
      "Cannot disrupt attempt: missing interruption timing policy snapshot",
    );
  }
  const policy = attempt.interruptionTimingPolicySnapshot.policy;

  // 5. Create the episode parent.
  const episode = await episodeRepo.create(attemptId);

  // 6. Insert the detected event.
  await eventRepo.insert({
    attemptId,
    interruptionId: episode.id,
    eventType: "detected",
    occurredAt: scannerTickNow,
    observedLastActivityAt: attempt.lastActivityAt,
    detectionSource: "heartbeat_timeout",
    timeoutSeconds: heartbeatTimeoutSeconds,
    policy,
    eligibleSeconds: null,
    timeAdjustmentId: null,
    actorId: null,
    reasonCode: "heartbeat_timeout",
  });

  // 7. Transition the attempt to disrupted, set the active pointer.
  const updated = await attemptRepo.update(attemptId, {
    status: "disrupted",
    currentInterruptionId: episode.id,
    interruptedAt: scannerTickNow,
  });
  if (!updated) {
    return { outcome: "missing" };
  }

  return { outcome: "marked", attempt: updated };
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
