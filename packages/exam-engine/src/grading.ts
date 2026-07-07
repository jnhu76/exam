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
 *
 * P3-L0-2 (ADR-008): grading reads the frozen `submitted_answers` snapshot,
 * NOT the mutable draft `answers` column. A submitted attempt's score is
 * derived from exactly the answer set captured under the submit lock. The
 * snapshot's `{ questionId, value }` entries are mapped to the minimal
 * AnswerRecord shape gradeAnswers expects (version/savedAt are irrelevant
 * to scoring — only questionId + answer matter).
 *
 * TODO(P3-L0-4): once the backfill script populates submitted_answers for
 * all historical submitted/graded attempts, drop the draft fallback and
 * require submitted_answers strictly. Until then, legacy attempts with a
 * NULL submitted_answers column fall back to draft answers so they remain
 * gradeable during the migration window.
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
 * Canonical terminal grading closure (P3-FORMAL-P0-A).
 *
 * One seam closes the terminal projection for both auto and manual grading.
 * It is provenance-agnostic: it does NOT know (and must not know) whether the
 * terminal entries came from auto materialization at submit-freeze time or
 * from `gradeQuestion` completing the last pending manual entry. Its sole
 * precondition is an authoritative terminal grading workset, which
 * {@link aggregateGradingEntries} validates up front (exact entry count,
 * question-universe match, per-entry terminal status: `auto→completed_auto`,
 * `manual→completed_manual`, non-null in-range earnedScore). If any entry is
 * not terminal, the aggregator throws before any projection is written.
 *
 * The closure performs exactly:
 *
 *   1. load attempt; reject if missing
 *   2. validate the submitted → graded state-machine transition is legal
 *      (no graded/voided/canceled attempts; an attempt awaiting manual work
 *      still passes — see the manual-path note below)
 *   3. load entries + aggregate via the single canonical scorer (this is the
 *      authority for terminality: a non-terminal workset throws here)
 *   4. write Attempt terminal projection (status, gradingResult, score,
 *      passed, gradedAt, gradingStatus — fully_graded once the workset is
 *      terminal under both modes)
 *   5. lock Enrollment `FOR UPDATE` (same caller transaction)
 *   6. select enrollment result via {@link shouldSelectAttempt}
 *   7. evaluate enrollment completion via {@link shouldEnrollmentComplete}
 *   8. write Enrollment projection (status, finalScore, finalPassed,
 *      finalAttemptId) when selected
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
 * atomic against concurrent grading calls. `gradeQuestion` and the auto
 * paths (`submitAndGradeAttempt`, `autoSubmitAndGrade`, admin force-submit,
 * `deadlineReconciliation`) all wrap this in a transaction holding that lock.
 *
 * Idempotency vs. retry vs. historical inconsistency:
 *   - Transaction retry (40001/40P01): re-execution re-reads the attempt; if
 *     the prior attempt committed, the transition guard at step 2 fires
 *     (`graded → grade` is not legal) and the caller's idempotent wrapper
 *     returns the committed result. Retry therefore never observes a
 *     half-closed committed state.
 *   - Pre-existing inconsistent historical rows (attempt graded but
 *     enrollment stale/NULL from the pre-repair manual path) are NOT repaired
 *     by this closure: the transition guard rejects `graded` attempts rather
 *     than re-projecting. Such rows require a separate data-repair follow-up
 *     (out of scope for P3-FORMAL-P0-A; reported in the final report).
 *
 * @returns true if the attempt was newly transitioned to graded by this call;
 *   false if it was already graded (caller-treated as idempotent no-op).
 */
export async function finalizeTerminalGrading(
  enrollmentRepo: EnrollmentRepository,
  attemptRepo: AttemptRepository,
  gradingWorksetRepo: GradingWorksetRepository,
  attemptId: string,
  enrollmentId: string,
  exam: Exam,
  now: Date,
): Promise<boolean> {
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
    // at the submit/freeze barrier. Three reaching states are possible:
    //   - AutoGraded (pure-objective auto path): preserved as-is.
    //   - PendingManual reaching closure via the manual path: by this point
    //     gradeQuestion has completed the last pending manual entry, so the
    //     lifecycle advances to FullyGraded.
    //   - undefined (legacy column predating P3-L0-2C): classified via the
    //     canonical text_response classifier (Defect B prevention).
    // The closure itself is mode-agnostic; it derives the lifecycle label
    // from the attempt's pre-closure gradingStatus, not from a caller flag.
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

  // Lock the enrollment row (`FOR UPDATE`) in the SAME transaction the caller
  // wrapped us in. This serializes concurrent finalization of different
  // attempts on the same enrollment: a second transaction cannot read the
  // enrollment's finalScore/finalAttemptId until the first commits.
  // Recomputing `shouldSelectAttempt` against the locked enrollment therefore
  // defeats the last-writer-wins race where two attempts otherwise each see
  // the pre-existing finalScore and both overwrite.
  const enrollment = await enrollmentRepo.findByExamAndCandidateForUpdate(
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
 * P3-L0-2C terminal guard (unchanged): an attempt awaiting manual grading
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
  attemptId: string,
  enrollmentId: string,
  exam: Exam,
  now: Date,
): Promise<boolean> {
  const attempt = await attemptRepo.findById(attemptId);
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
      `Cannot auto-finalize attempt ${attemptId}: gradingStatus=pending_manual; ` +
        "manual grading completion owns the submitted → graded transition",
    );
  }

  return finalizeTerminalGrading(
    enrollmentRepo,
    attemptRepo,
    gradingWorksetRepo,
    attemptId,
    enrollmentId,
    exam,
    now,
  );
}

/**
 * Grades an attempt end-to-end: reads the grading snapshot, then finalizes
 * via the canonical grading-entry aggregator. Returns the persisted ScoreResult
 * (re-read from the attempt so the response reflects committed truth).
 *
 * Note: `gradeAttempt` is retained for test compatibility; production callers
 * use {@link gradeAttemptIdempotent}. Both flow terminal scoring through the
 * SAME {@link finalizeGrading} → {@link aggregateGradingEntries} authority —
 * there is no second score-computation path.
 */
export async function gradeAttempt(
  examRepo: ExamRepository,
  enrollmentRepo: EnrollmentRepository,
  attemptRepo: AttemptRepository,
  gradingWorksetRepo: GradingWorksetRepository,
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

  await finalizeGrading(
    enrollmentRepo,
    attemptRepo,
    gradingWorksetRepo,
    attemptId,
    snapshot.enrollment.id,
    snapshot.exam,
    now,
  );

  // Build the response ScoreResult from the now-committed attempt state.
  const graded = await attemptRepo.findById(attemptId);
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

export async function gradeAttemptIdempotent(
  examRepo: ExamRepository,
  enrollmentRepo: EnrollmentRepository,
  attemptRepo: AttemptRepository,
  gradingWorksetRepo: GradingWorksetRepository,
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

  if (snapshot.attempt.status === "graded") {
    return {
      attemptId: snapshot.attempt.id,
      totalScore: snapshot.attempt.score ?? 0,
      passed: snapshot.attempt.passed ?? false,
      questionResults: snapshot.attempt.gradingResult ?? [],
      gradedAt: snapshot.attempt.gradedAt ?? now,
    };
  }

  // P3-L0-2C: an attempt awaiting manual grading holds at `submitted`. The
  // automatic idempotent grading path must NOT advance it to `graded`; it
  // returns the partial auto-graded score (objective questions only) without
  // finalizing, so the manual-grading queue remains authoritative. Branches
  // on the established gradingStatus — no question-type rescan here.
  //
  // This partial score is a RESPONSE shape only (never persisted); it is the
  // one remaining use of `computeGradingResult` in the grading pipeline, and
  // it does NOT flow into terminal persistence. Slice 4 forbids any
  // production terminal path from using its output as a score authority.
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
    attemptId,
    snapshot.enrollment.id,
    snapshot.exam,
    now,
  );

  const graded = await attemptRepo.findById(attemptId);
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
