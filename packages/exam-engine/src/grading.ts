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
 * Persists the terminal grading result for an attempt by aggregating its
 * materialized grading workset, then transitions the attempt to `graded`,
 * updates the enrollment's final score per the score strategy, and transitions
 * the enrollment to completed if the exam is finished.
 *
 * P3-L0-2E Slice 4 — single terminal aggregation authority: the score is
 * computed ONLY by {@link aggregateGradingEntries} from the attempt's
 * `attempt_grading_entries` + frozen `questionSnapshot`. This function no
 * longer accepts an externally computed `ScoreResult` — that would permit a
 * second score authority to bypass grading-entry truth. Every caller
 * previously passed a fresh `computeGradingResult` output derived from the
 * same attempt in the same transaction, so internalizing the aggregation
 * yields identical input without any external-result injection point.
 *
 * P3-L0-2C terminal guard (unchanged): an attempt awaiting manual grading
 * must NOT be advanced to `graded` here — protocol §3.3/§4.2 mandate that
 * such an attempt holds at `submitted` until `gradeQuestion` (the
 * manual-completion command) performs the final transition.
 *
 * The caller MUST wrap this in a transaction holding the attempt row lock
 * (`findByIdForUpdate`) so the read-aggregate-write is atomic against
 * concurrent grading calls (see submitAndGradeAttempt, autoSubmitAndGrade,
 * admin force-submit, deadlineReconciliation).
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

  const tr = transition(attempt.status, "grade" as AttemptCommand);
  if (!isTransitionOk(tr)) {
    throw new InvalidStateTransitionError(
      `Cannot grade attempt in ${attempt.status} state`,
    );
  }

  // Slice 4: aggregate the terminal score from the materialized grading
  // entries. This is the single canonical score authority — no externally
  // supplied result, no gradingResult read, no submittedAnswers re-grade.
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
    // P3-L0-2C: gradingStatus is the authoritative scoring-lifecycle fact,
    // established at the submit/freeze barrier (attemptCommands.submitAttempt).
    // A pure-objective attempt reaching here carries auto_graded (set at
    // submit); preserve that classification. The `requiresManualGrading`
    // fallback below is retained only for legacy attempts whose gradingStatus
    // column predates P3-L0-2C (undefined). P3-L0-2D: the fallback now uses
    // the canonical QuestionType-based classifier (text_response) rather than
    // the deprecated standardAnswer==null heuristic, so legacy rows are
    // classified by the same authority as current rows (Defect B prevention).
    gradingStatus:
      attempt.gradingStatus ??
      (requiresManualGrading(attempt.questionSnapshot)
        ? GradingStatus.PendingManual
        : GradingStatus.AutoGraded),
  });
  if (!gradedUpdate) {
    throw new ValidationError("Failed to persist graded results");
  }

  // Lock the enrollment row (`FOR UPDATE`) in the SAME transaction the caller
  // wrapped us in (submitAndGradeAttempt, autoSubmitAndGrade, admin
  // force-submit, gradingQueue all pass tx-scoped repos). This serializes
  // concurrent finalization of different attempts on the same enrollment: a
  // second transaction cannot read the enrollment's finalScore/finalAttemptId
  // until the first commits. Recomputing `shouldSelectAttempt` against the
  // locked enrollment therefore defeats the last-writer-wins race where two
  // attempts otherwise each see the pre-existing finalScore and both overwrite.
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
