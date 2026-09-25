import type {
  AnswerRecord,
  ExamEnrollment,
  Exam,
  ScoreResult,
  ScoreStrategy,
} from "@exam/domain";
import {
  gradeAnswers,
  requiresManualGrading,
  InvalidStateTransitionError,
  ValidationError,
  GradingStatus,
} from "@exam/domain";
import type { ExamAttempt } from "@exam/domain";
import type {
  AttemptRepository,
  EnrollmentRepository,
} from "./attemptCommands.js";
import type { ExamRepository } from "./examCommands.js";
import type { GradingWorksetRepository } from "./gradingWorkset.js";
import { aggregateGradingEntries } from "./gradingWorkset.js";
import {
  transition,
  isTransitionOk,
  type AttemptCommand,
} from "./attemptStateMachine.js";
import { assertTransition as assertEnrollmentTransition } from "./enrollmentStateMachine.js";
import {
  assertCapabilityFor,
  type LockedEnrollmentAttemptIdentity,
} from "./lockSeam.js";

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
  // Untimed exams have no close cutoff — only the retake rules above can
  // complete the enrollment.
  if (exam.closeAt !== null && now >= exam.closeAt) {
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
 *
 * ADR-008: grading reads the frozen `submitted_answers` snapshot, NOT the
 * mutable draft `answers` column. A submitted attempt's score is derived from
 * exactly the answer set captured under the submit lock. The snapshot's
 * `{ questionId, value }` entries are mapped to the minimal AnswerRecord shape
 * gradeAnswers expects (version/savedAt are irrelevant to scoring — only
 * questionId + answer matter).
 *
 * COMPATIBILITY: rows persisted before the freeze column existed may still have
 * a NULL `submitted_answers` (see apps/api/src/scripts/backfill-submitted-answers.ts);
 * those fall back to draft answers so they remain gradeable. The fallback is
 * not a second scoring authority — remove it only when no reachable row can
 * have a NULL snapshot.
 */
export function computeGradingResult(
  attempt: ExamAttempt,
  exam: Exam,
  now: Date,
): ScoreResult {
  const sourceAnswers: AnswerRecord[] = attempt.submittedAnswers
    ? attempt.submittedAnswers.answers.map((a) => ({
        questionId: a.questionId,
        answer: a.value,
        version: 0,
        savedAt: now,
      }))
    : attempt.answers;

  return gradeAnswers(
    attempt.id,
    attempt.questionSnapshot,
    sourceAnswers,
    exam.passingScore,
    now,
  );
}

/**
 * Canonical terminal grading closure.
 *
 * One seam closes the terminal projection for both auto and manual grading.
 * It is provenance-agnostic: it does NOT know (and must not know) whether the
 * terminal entries came from auto materialization at submit-freeze time or
 * from `gradeQuestion` completing the last pending manual entry. Its sole
 * precondition is an authoritative terminal grading workset, which
 * {@link aggregateGradingEntries} validates up front (exact entry count,
 * question-universe match, per-entry terminal status, non-null in-range
 * earnedScore). If any entry is not terminal, the aggregator throws before any
 * projection is written.
 *
 * The closure writes the Attempt terminal projection (status, gradingResult,
 * score, passed, gradedAt, gradingStatus) and then the Enrollment projection
 * (status, finalScore, finalPassed, finalAttemptId when selected).
 *
 * Manual-path note: `gradeQuestion` completes the last pending manual entry
 * (setting it to `completed_manual`) BEFORE calling this closure. By the time
 * the closure runs, the workset is fully terminal regardless of whether any
 * manual entries existed — so the closure needs no mode parameter and makes no
 * mode-dependent decision. This is the convergence contract:
 *
 *     auto entry completion  ─┐
 *                             ├─→ terminal workset → finalizeTerminalGrading
 *     manual entry completion ┘
 *
 * The caller MUST hold the attempt row lock (`findByIdForUpdate`) for the
 * duration of this call so the read-aggregate-write + enrollment lock is
 * atomic against concurrent grading calls. `gradeQuestion` and the auto paths
 * (`submitAndGradeAttempt`, `autoSubmitAndGrade`, admin force-submit,
 * `deadlineReconciliation`) all wrap this in a transaction holding that lock.
 *
 * Idempotency vs. retry vs. historical inconsistency:
 *   - Transaction retry (40001/40P01): re-execution re-reads the attempt; if
 *     the prior attempt committed, the transition guard fires
 *     (`graded → grade` is not legal) and the caller's idempotent wrapper
 *     returns the committed result. Retry therefore never observes a
 *     half-closed committed state.
 *   - Pre-existing inconsistent historical rows (attempt graded but
 *     enrollment stale/NULL) are NOT repaired by this closure: the transition
 *     guard rejects `graded` attempts rather than re-projecting. Such rows
 *     require a separate data-repair path.
 *
 * @returns true if the attempt was newly transitioned to graded by this call;
 *   false if it was already graded (caller-treated as idempotent no-op).
 */
export async function finalizeTerminalGrading(
  enrollmentRepo: EnrollmentRepository,
  attemptRepo: AttemptRepository,
  gradingWorksetRepo: GradingWorksetRepository,
  capability: LockedEnrollmentAttemptIdentity,
  exam: Exam,
  now: Date,
): Promise<boolean> {
  // P3-FORMAL-P0-D2: the FIRST executable protocol action is the transaction-
  // affinity assertion. No repository read, lock, write, or workset access
  // may occur before it. The capability proves the caller's transaction
  // already acquired Enrollment before Attempt via the canonical seam, using
  // the exact repo pair this consumer is now using.
  assertCapabilityFor(capability, enrollmentRepo, attemptRepo);
  const { attemptId, enrollmentId } = capability;

  // Re-read mutable Attempt state through the current (tx-bound, affinity-
  // proven) AttemptRepository. Non-locking: the seam already holds the row
  // lock, and under REPEATABLE READ this tx sees its own prior writes.
  const attempt = await attemptRepo.findById(attemptId);
  if (!attempt) {
    throw new ValidationError("Attempt not found");
  }

  // Idempotency: an already-graded attempt has its terminal projection. The
  // caller (finalizeGrading / gradeQuestion) wraps this in a transaction and
  // discards a false return. This guard is for retry re-entry of a committed
  // closure within the SAME logical operation — NOT a historical-row repair
  // path (see the function doc).
  if (attempt.status === "graded") {
    return false;
  }

  const tr = transition(attempt.status, "grade" as AttemptCommand);
  if (!isTransitionOk(tr)) {
    throw new InvalidStateTransitionError(
      `Cannot grade attempt in ${attempt.status} state`,
    );
  }

  // Canonical terminal aggregation. This is BOTH the score authority AND the
  // terminal-workset precondition: aggregateGradingEntries validates that
  // every entry is in its terminal status (completed_auto / completed_manual)
  // and throws before any projection is written if the workset is incomplete.
  // No mode parameter is needed — terminality is a property of the workset.
  const entries = await gradingWorksetRepo.findByAttempt(attemptId);
  const aggregated = aggregateGradingEntries(
    attempt,
    entries,
    exam.passingScore,
  );

  const gradedUpdate = await attemptRepo.update(attemptId, {
    status: "graded",
    gradingResult: aggregated.questionResults,
    score: aggregated.totalScore,
    passed: aggregated.passed,
    gradedAt: now,
    // gradingStatus is the authoritative scoring-LIFECYCLE label, established
    // at the submit/freeze barrier: it advances PendingManual → FullyGraded
    // here, is preserved otherwise, and is classified on rows persisted before
    // the column existed. The closure derives it from the attempt's pre-closure
    // gradingStatus, never from a caller flag.
    gradingStatus:
      attempt.gradingStatus === GradingStatus.PendingManual
        ? GradingStatus.FullyGraded
        : (attempt.gradingStatus ??
          (requiresManualGrading(attempt.questionSnapshot)
            ? GradingStatus.PendingManual
            : GradingStatus.AutoGraded)),
  });
  if (!gradedUpdate) {
    throw new ValidationError("Failed to persist graded results");
  }

  // P3-FORMAL-P0-D2 / HR-2: the Enrollment row is NOT re-locked with an
  // explicit FOR UPDATE here. The capability's affinity assertion already
  // proved the caller's transaction acquired the Enrollment lock before the
  // Attempt lock via the canonical seam. We re-read mutable Enrollment state
  // through a NON-locking lookup; under REPEATABLE READ this tx observes its
  // own writes and the already-held lock serializes concurrent finalizers.
  //
  // The Enrollment UPDATE below remains and is itself a lock-acquiring
  // operation (implicit row write-lock). Its safety depends ENTIRELY on the
  // capability affinity assertion above having succeeded. Removing the
  // explicit FOR UPDATE does NOT remove the Enrollment lock dependency.
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
    aggregated.totalScore,
  );

  const targetStatus = shouldEnrollmentComplete(
    exam,
    enrollment,
    aggregated.passed,
    now,
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
          finalScore: aggregated.totalScore,
          finalPassed: aggregated.passed,
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
 * Auto-path entry into the canonical terminal closure.
 *
 * Validates the auto-path lifecycle preconditions, then delegates to
 * {@link finalizeTerminalGrading}. The terminal-workset precondition is
 * enforced inside the closure by {@link aggregateGradingEntries}.
 *
 * Terminal guard: an attempt awaiting manual grading
 * must NOT be advanced to `graded` through the automatic finalization path.
 * Fail closed — only `gradeQuestion` (manual completion) may close a
 * pending_manual attempt, and it does so by completing the last pending
 * manual entry first, after which the workset is terminal and this guard's
 * precondition is moot for the closure itself.
 *
 * @returns true if the attempt was transitioned to graded; false if it was
 *   already graded (idempotent no-op).
 */
export async function finalizeGrading(
  enrollmentRepo: EnrollmentRepository,
  attemptRepo: AttemptRepository,
  gradingWorksetRepo: GradingWorksetRepository,
  capability: LockedEnrollmentAttemptIdentity,
  exam: Exam,
  now: Date,
): Promise<boolean> {
  const attempt = await attemptRepo.findById(capability.attemptId);
  if (!attempt) {
    throw new ValidationError("Attempt not found");
  }

  if (attempt.status === "graded") {
    return false;
  }

  // P3-L0-2C engine invariant: an attempt awaiting manual grading must NOT
  // be advanced to `graded` through the automatic finalization path. Fail
  // closed — only gradeQuestion (manual completion) may close a
  // pending_manual attempt.
  if (attempt.gradingStatus === GradingStatus.PendingManual) {
    throw new InvalidStateTransitionError(
      `Cannot auto-finalize attempt ${capability.attemptId}: gradingStatus=pending_manual; ` +
        "manual grading completion owns the submitted → graded transition",
    );
  }

  return finalizeTerminalGrading(
    enrollmentRepo,
    attemptRepo,
    gradingWorksetRepo,
    capability,
    exam,
    now,
  );
}

/**
 * Grades an attempt end-to-end idempotently: reads the grading snapshot, then
 * finalizes via the canonical grading-entry aggregator. Returns the
 * ScoreResult (re-read or snapshot-backed so the response reflects committed
 * truth; an already-graded attempt replays its persisted result).
 *
 * The caller MUST mint the transaction-affine capability via
 * `lockEnrollmentAndAttempt` in the same transaction before calling this. The
 * capability is the EA protocol authority threaded through to
 * {@link finalizeTerminalGrading}. Terminal scoring flows through the SAME
 * {@link finalizeGrading} → {@link aggregateGradingEntries} authority — there
 * is no second score-computation path.
 */
export async function gradeAttemptIdempotent(
  examRepo: ExamRepository,
  enrollmentRepo: EnrollmentRepository,
  attemptRepo: AttemptRepository,
  gradingWorksetRepo: GradingWorksetRepository,
  capability: LockedEnrollmentAttemptIdentity,
  now: Date,
): Promise<ScoreResult> {
  const snapshot = await readGradingSnapshot(
    examRepo,
    enrollmentRepo,
    attemptRepo,
    capability.attemptId,
  );
  if (!snapshot) {
    throw new ValidationError("Attempt not found");
  }

  if (snapshot.attempt.status === "graded") {
    return {
      attemptId: snapshot.attempt.id,
      totalScore: snapshot.attempt.score ?? 0,
      passed: snapshot.attempt.passed ?? false,
      questionResults: snapshot.attempt.gradingResult ?? [],
      gradedAt: snapshot.attempt.gradedAt ?? now,
    };
  }

  // ADR-008: an attempt awaiting manual grading holds at `submitted` and the
  // automatic idempotent grading path must NOT advance it to `graded`. It
  // returns the partial auto-graded score (objective questions only) without
  // finalizing, so the manual-grading queue stays authoritative. Branches on
  // the established gradingStatus — no question-type rescan here.
  //
  // This partial score is a RESPONSE shape only (never persisted) and does NOT
  // flow into terminal persistence: no production terminal path may use its
  // output as a score authority.
  if (snapshot.attempt.gradingStatus === GradingStatus.PendingManual) {
    const partial = computeGradingResult(snapshot.attempt, snapshot.exam, now);
    return {
      attemptId: snapshot.attempt.id,
      totalScore: partial.totalScore,
      passed: partial.passed,
      questionResults: partial.questionResults,
      gradedAt: now,
    };
  }

  await finalizeGrading(
    enrollmentRepo,
    attemptRepo,
    gradingWorksetRepo,
    capability,
    snapshot.exam,
    now,
  );

  const graded = await attemptRepo.findById(capability.attemptId);
  if (!graded) {
    throw new ValidationError("Attempt not found after grading");
  }
  return {
    attemptId: graded.id,
    totalScore: graded.score ?? 0,
    passed: graded.passed ?? false,
    questionResults: graded.gradingResult ?? [],
    gradedAt: graded.gradedAt ?? now,
  };
}
