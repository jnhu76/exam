import type { AttemptGradingEntry, ExamAttempt } from "@exam/domain";
import {
  InvalidStateTransitionError,
  NotFoundError,
  PermissionDeniedError,
  ValidationError,
} from "@exam/domain";
import type { AttemptRepository } from "./attemptCommands.js";
import type { GradingWorksetRepository } from "./gradingWorkset.js";
import { aggregateGradingEntries } from "./gradingWorkset.js";

/** Result of {@link gradeQuestion}: grading status after the entry was saved. */
export interface GradeQuestionResult {
  gradingStatus: ExamAttempt["gradingStatus"];
  fullyGraded: boolean;
  /**
   * Recomputed attempt total (objective + manual) and pass/fail, present only
   * once the attempt becomes fully graded. Re-grading re-derives these from the
   * full entry set, so repeated calls are idempotent.
   */
  totalScore?: number;
  passed?: boolean;
}

/**
 * Completes one pending manual grading entry for an attempt and, when the
 * last manual-graded question has been scored, flips `gradingStatus` to
 * `fully_graded` and reconciles the attempt total (objective + manual) into
 * `score`/`passed`/`gradingResult`.
 *
 * P3-L0-2E Slice 3 + Slice 3C — authoritative workset ownership and strict
 * completion boundary:
 *
 * The single durable manual-score truth is the `attempt_grading_entries` row
 * materialized at submit-freeze time. The command flow is:
 *
 *   load/lock attempt
 *     → validate attempt.status === submitted
 *     → validate attempt.gradingStatus === pending_manual
 *     → load the (attemptId, questionId) grading entry
 *     → entry missing?               fail closed (NotFoundError)
 *     → entry.gradingMode = auto?    reject (PermissionDeniedError)
 *     → entry.status != pending?     reject (InvalidStateTransitionError)
 *     → validate 0 ≤ score ≤ entry.maxScore
 *     → UPDATE SAME ENTRY pending_manual → completed_manual
 *     → count remaining pending manual entries
 *     → if 0: reconcile + terminal lifecycle flip; else hold
 *
 * The materialized entry's `gradingMode` is the SOLE authority for whether
 * this question may be manually scored — NOT `questionSnapshot` rescanning,
 * NOT `standardAnswer == null`, NOT a parallel manual-question id list.
 * `QuestionSnapshot` remains the frozen-metadata truth (maxScore validation,
 * expected question universe), but it does not authorize manual work after
 * the workset is materialized.
 *
 * Slice 3C: gradeQuestion completes pending manual grading work ONLY. Manual
 * grading completion is one-way; terminal score revision is not part of the
 * current protocol. Once an entry becomes `completed_manual` the ordinary
 * grading command cannot mutate that entry (neither same-value nor
 * different-value overwrites are permitted); once the attempt reaches
 * `graded + fully_graded` no ordinary manual grading call can mutate grading
 * entries or final score/result fields.
 *
 * The caller is responsible for wrapping this in a transaction that has
 * locked the attempt row (findByIdForUpdate) — see the route handler.
 *
 * @throws {NotFoundError} attempt or its grading entry does not exist.
 * @throws {PermissionDeniedError} the entry is `grading_mode = auto`
 *   (nothing to manually grade). This subsumes the historical `auto_graded`
 *   attempt rejection: a fully-auto attempt has no manual entries at all, so
 *   the lookup itself misses or returns an auto entry.
 * @throws {InvalidStateTransitionError} the attempt is not in the
 *   `submitted + pending_manual` lifecycle, or the entry is already
 *   `completed_manual` (manual work has already been completed for this
 *   question and cannot be revised by the ordinary grading command).
 * @throws {ValidationError} score is outside `[0, entry.maxScore]`.
 */
export async function gradeQuestion(
  attemptRepo: AttemptRepository,
  worksetRepo: GradingWorksetRepository,
  attemptId: string,
  questionId: string,
  score: number,
  comment: string,
  graderId: string,
  now: Date,
  passingScore: number,
): Promise<GradeQuestionResult> {
  const attempt = await attemptRepo.findByIdForUpdate(attemptId);
  if (!attempt) {
    throw new NotFoundError("Attempt not found");
  }

  // Slice 3C strict completion boundary — manual-work completion only.
  // gradeQuestion is the command that completes a pending_manual entry while
  // the attempt is submitted + pending_manual; it REJECTS score-revision /
  // re-grade attempts. Lifecycle guards run BEFORE any workset lookup or score
  // mutation so a rejected call cannot touch truth. exam-protocol.md §3.3:
  // submitted(pending_manual) → graded(fully_graded) is one-way; post-terminal
  // score revision is not part of the current protocol.
  if (attempt.status !== "submitted") {
    throw new InvalidStateTransitionError(
      `Cannot grade attempt ${attemptId}: attempt status is ${attempt.status}, ` +
        "expected submitted (manual grading is only allowed while the attempt " +
        "is awaiting manual completion)",
    );
  }
  if (attempt.gradingStatus !== "pending_manual") {
    throw new InvalidStateTransitionError(
      `Cannot grade attempt ${attemptId}: gradingStatus is ` +
        `${attempt.gradingStatus}, expected pending_manual`,
    );
  }

  // Slice 3 authoritative workset lookup. The materialized entry is the sole
  // manual-work authority — fail closed when it is missing (no lazy create,
  // no legacy fallback) and authorize grading purely from its gradingMode.
  const entry = await worksetRepo.findByAttemptAndQuestion(
    attemptId,
    questionId,
  );
  if (!entry) {
    throw new NotFoundError(
      `Grading entry not found for attempt ${attemptId}, question ${questionId}`,
    );
  }
  if (entry.gradingMode === "auto") {
    throw new PermissionDeniedError(
      "Question is auto-graded and cannot be manually scored",
    );
  }
  // Slice 3C: only a pending_manual entry may be completed. A completed_manual
  // entry is terminal for that question — same-value retry and different-value
  // revision are both rejected. The entry's status (NOT score equality) is the
  // authority: the API carries no idempotency key, so payload equality is not
  // proof of the same operation.
  if (entry.status !== "pending_manual") {
    throw new InvalidStateTransitionError(
      `Cannot grade question ${questionId} for attempt ${attemptId}: grading ` +
        `entry status is ${entry.status}, expected pending_manual. Manual ` +
        "grading completion is one-way; score revision is not supported.",
    );
  }

  // Frozen maxScore authority (entry mirrors the frozen QuestionSnapshot).
  const maxScore = entry.maxScore;
  if (!Number.isFinite(score) || score < 0 || score > maxScore) {
    throw new ValidationError(`score must be between 0 and ${maxScore}`);
  }

  // UPDATE SAME ENTRY — pending_manual → completed_manual. The guards above
  // guarantee the entry is currently pending, so this is a one-way
  // completion; no second row is created and completed entries are never
  // re-touched by this command.
  const updated = await worksetRepo.completeManualEntry({
    attemptId,
    questionId,
    earnedScore: score,
    maxScore,
    comment,
    gradedBy: graderId,
    gradedAt: now,
    now,
  });
  if (!updated) {
    // Defensive: the lookup above succeeded, so the UPDATE should match. If
    // it does not, the workset was mutated concurrently in a way that broke
    // the (attemptId, questionId) invariant — fail closed rather than
    // silently treating the grade as applied.
    throw new NotFoundError(
      `Grading entry disappeared during update for attempt ${attemptId}, question ${questionId}`,
    );
  }

  // Terminal detection: any pending manual entries left for this attempt?
  const remainingPending =
    await worksetRepo.countPendingManualForAttempt(attemptId);
  const fullyGraded = remainingPending === 0;

  if (fullyGraded) {
    // Slice 4: aggregate the terminal total from the complete grading-entry
    // workset via the single canonical authority. This reads ONLY the entries
    // + the frozen questionSnapshot — never `attempt.gradingResult`, never
    // draft answers, never a re-grade of submittedAnswers. Same aggregator
    // pure-objective `finalizeGrading` uses, so there is ONE terminal score
    // algorithm for every lifecycle.
    const allEntries = await worksetRepo.findByAttempt(attemptId);
    const aggregated = aggregateGradingEntries(
      attempt,
      allEntries,
      passingScore,
    );
    // P3-L0-2C: this command owns the final submitted → graded lifecycle
    // transition for manual-grading attempts. Only this command may advance a
    // pending_manual attempt to graded once all subjective scores are entered.
    // The status transition fires only when the attempt is still at
    // `submitted`; once terminal, the Slice 3C lifecycle guards reject any
    // further grading call before this branch is reached.
    const statusUpdate =
      attempt.status === "submitted" ? { status: "graded" as const } : {};
    await attemptRepo.update(attemptId, {
      ...statusUpdate,
      gradingStatus: "fully_graded",
      score: aggregated.totalScore,
      passed: aggregated.passed,
      gradingResult: aggregated.questionResults,
    });
    return {
      gradingStatus: "fully_graded",
      fullyGraded: true,
      totalScore: aggregated.totalScore,
      passed: aggregated.passed,
    };
  }

  return {
    gradingStatus: "pending_manual",
    fullyGraded: false,
  };
}
