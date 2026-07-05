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
 * Persists the grading results: transitions the attempt to graded, updates the
 * enrollment's final score per the score strategy, and transitions the enrollment
 * to completed if the exam is finished.
 *
 * P3-L0-2C terminal guard: this is the AUTOMATIC terminal finalization command.
 * It is forbidden from advancing a `pending_manual` attempt to `graded` —
 * protocol §3.3/§4.2 mandate that such an attempt holds at `submitted` until
 * `completeManualGrading` (the manual-completion command) performs the final
 * transition. The guard reads the authoritative `gradingStatus` established at
 * the submit/freeze barrier; it does NOT rescan question types. This protects
 * every caller (candidate submit, deadline reconciliation, deadline scanner,
 * admin force-submit) even if a caller incorrectly reaches this path.
 */
export async function finalizeGrading(
  enrollmentRepo: EnrollmentRepository,
  attemptRepo: AttemptRepository,
  attemptId: string,
  enrollmentId: string,
  result: ScoreResult,
  exam: Exam,
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
  // closed — only completeManualGrading may close a pending_manual attempt.
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

  const gradedUpdate = await attemptRepo.update(attemptId, {
    status: "graded",
    gradingResult: result.questionResults,
    score: result.totalScore,
    passed: result.passed,
    gradedAt: result.gradedAt,
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
    result.totalScore,
  );

  const targetStatus = shouldEnrollmentComplete(
    exam,
    enrollment,
    result.passed,
    result.gradedAt,
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
          finalScore: result.totalScore,
          finalPassed: result.passed,
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
 * Grades an attempt end-to-end: reads the grading snapshot, computes the result,
 * and finalizes the enrollment. Returns the ScoreResult.
 */
export async function gradeAttempt(
  examRepo: ExamRepository,
  enrollmentRepo: EnrollmentRepository,
  attemptRepo: AttemptRepository,
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

  const result = computeGradingResult(snapshot.attempt, snapshot.exam, now);
  await finalizeGrading(
    enrollmentRepo,
    attemptRepo,
    attemptId,
    snapshot.enrollment.id,
    result,
    snapshot.exam,
  );

  return result;
}

export async function gradeAttemptIdempotent(
  examRepo: ExamRepository,
  enrollmentRepo: EnrollmentRepository,
  attemptRepo: AttemptRepository,
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

  const result = computeGradingResult(snapshot.attempt, snapshot.exam, now);
  await finalizeGrading(
    enrollmentRepo,
    attemptRepo,
    attemptId,
    snapshot.enrollment.id,
    result,
    snapshot.exam,
  );

  return result;
}
