import type { Exam, ExamAttempt, ExamEnrollment } from "@exam/domain";

/**
 * Who is asking to see a candidate result. "own" is the candidate's own-view
 * capability path (ScoreOwnView); "all" is the administrative all-view path
 * (ScoreAllView) which bypasses the publication gate.
 */
export type CandidateResultView = "own" | "all";

/**
 * Why a candidate result is not visible. The literals deliberately match the
 * wire contract's HiddenReason union (@exam/contracts score.ts) so the API
 * layer can pass the value through without a mapping table.
 */
export type CandidateResultHiddenReason =
  | "not_started"
  | "not_graded"
  | "pending_publish";

/** The single visibility decision every candidate-facing projection shares. */
export type CandidateResultVisibility =
  | { visible: true }
  | { visible: false; hiddenReason: CandidateResultHiddenReason };

/**
 * Canonical candidate result visibility authority (issue #324).
 *
 * Grading completion is NOT candidate result visibility. An attempt may be
 * fully graded (durable score/passed/finalScore all committed) while the
 * exam's publication policy still hides the result from the candidate. Every
 * candidate-facing projection — the score detail endpoint, attempt
 * load/start/submit/restore responses, the take snapshot, and the candidate
 * exam list/detail summaries — must apply THIS decision, never a route-local
 * copy of it.
 *
 * Two-stage gate (P2D-J5a semantics, lifted from the score route):
 *
 *   1. resultReady — is the result computable? Requires status=graded AND all
 *      score fields present AND grading is no longer pending manual scoring.
 *      after_grading mode additionally requires gradingStatus to be exactly
 *      'fully_graded' (that mode means "wait for ALL grading, including
 *      manual, to finish").
 *   2. publication gate — applies only on the own-view capability path. The
 *      all-view path bypasses it:
 *        immediate     → visible as soon as resultReady
 *        after_grading → visible as soon as resultReady
 *        manual        → visible only after admin publish-results
 *                        (exam.resultsPublishedAt != null)
 *
 * A graded attempt with a null gradingStatus defaults to 'auto_graded',
 * matching the DB column default + migration 0004 backfill and the
 * pre-#324 authoritative /scores gate — in after_grading mode such a row
 * stays HIDDEN (that mode demands exactly 'fully_graded').
 */
export function resolveCandidateResultVisibility(
  exam: Exam,
  attempt: ExamAttempt,
  view: CandidateResultView = "own",
): CandidateResultVisibility {
  // Stage 1: is the result computable?
  if (attempt.status !== "graded") {
    return { visible: false, hiddenReason: "not_started" };
  }
  const scoreFieldsPresent =
    attempt.score != null &&
    attempt.passed != null &&
    attempt.gradedAt != null &&
    attempt.gradingResult != null;
  if (!scoreFieldsPresent) {
    return { visible: false, hiddenReason: "not_graded" };
  }

  // gradingStatus semantics: 'pending_manual' always means not-ready.
  // 'auto_graded' counts as ready UNLESS the exam mode is after_grading
  // (which demands 'fully_graded'). A null gradingStatus defaults to
  // 'auto_graded' — the DB column default and the migration 0004 backfill
  // both say legacy terminal rows were auto-graded. See the function doc.
  const gradingStatus = attempt.gradingStatus ?? "auto_graded";
  if (gradingStatus === "pending_manual") {
    return { visible: false, hiddenReason: "not_graded" };
  }
  if (
    exam.resultPublicationMode === "after_grading" &&
    gradingStatus !== "fully_graded"
  ) {
    return { visible: false, hiddenReason: "not_graded" };
  }

  // Stage 2: publication gate — own-view only; all-view bypasses.
  if (view === "all") {
    return { visible: true };
  }
  switch (exam.resultPublicationMode) {
    case "immediate":
      return { visible: true };
    case "after_grading":
      return { visible: true };
    case "manual":
      return exam.resultsPublishedAt != null
        ? { visible: true }
        : { visible: false, hiddenReason: "pending_publish" };
  }
}

/**
 * Resolves result visibility for the enrollment-level projection (candidate
 * exam list / detail). The enrollment's final facts (finalScore, finalPassed,
 * finalAttemptId) are durable grading truth written as soon as grading
 * selects the final attempt — they can exist long before the publication
 * policy lets the candidate see them. The decision is derived from the FINAL
 * attempt when present; without a selected final attempt there is no
 * published-worthy result to reveal.
 */
export function resolveCandidateEnrollmentResultVisibility(
  exam: Exam,
  enrollment: Pick<
    ExamEnrollment,
    "finalScore" | "finalPassed" | "finalAttemptId"
  > | null,
  finalAttempt: ExamAttempt | null,
  view: CandidateResultView = "own",
): CandidateResultVisibility {
  if (finalAttempt) {
    return resolveCandidateResultVisibility(exam, finalAttempt, view);
  }
  return { visible: false, hiddenReason: "not_graded" };
}

/**
 * Whether the candidate's retake eligibility is DEFERRED because a final
 * result exists but is not yet visible (#324 review P1-2).
 *
 * The engine enforces pass_then_stop on durable grading truth: a candidate
 * with finalPassed=true is rejected on start while a failed candidate gets a
 * new attempt. While the result is hidden that difference is a one-bit
 * pass/fail oracle (409 vs 201). When this returns true, callers must give
 * passed and failed candidates IDENTICAL behavior — the candidate start route
 * rejects both with the same opaque conflict, and the detail projection
 * reports canStartNewAttempt=false — until publication makes the result
 * visible and the durable policy resumes.
 */
export function isCandidateRetakeDeferred(
  exam: Exam,
  enrollment: Pick<
    ExamEnrollment,
    "finalScore" | "finalPassed" | "finalAttemptId"
  > | null,
  finalAttempt: ExamAttempt | null,
): boolean {
  if (exam.retakePolicy !== "pass_then_stop") {
    return false;
  }
  if (enrollment === null || enrollment.finalAttemptId == null) {
    return false;
  }
  return !resolveCandidateEnrollmentResultVisibility(
    exam,
    enrollment,
    finalAttempt,
  ).visible;
}

/**
 * Derivation input for deriveCandidateExamState — NOT a serialization-safe
 * projection: while the result is hidden, only the direct pass/fail fact
 * (finalPassed) is stripped; finalScore and finalAttemptId REMAIN because
 * their PRESENCE (not their value) drives the non-result lifecycle states
 * ("graded", view-result navigation) that stay visible by design. Never
 * serialize this object to a candidate — the numeric bestScore projection is
 * gated separately by the caller.
 */
export function projectEnrollmentForLifecycleState(
  enrollment: ExamEnrollment | null,
  resultVisible: boolean,
): ExamEnrollment | null {
  if (enrollment === null || resultVisible) {
    return enrollment;
  }
  const { finalPassed: _hidden, ...lifecycleFacts } = enrollment;
  return lifecycleFacts;
}
