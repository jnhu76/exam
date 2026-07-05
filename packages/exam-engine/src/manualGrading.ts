import type { ExamAttempt, QuestionScoreResult } from "@exam/domain";
import {
  NotFoundError,
  PermissionDeniedError,
  ValidationError,
} from "@exam/domain";
import type { AttemptRepository } from "./attemptCommands.js";

/**
 * Repository surface the manual-grading command depends on (subset of
 * `createManualGradingRepo`). Defined here so the engine layer does not
 * import from `@exam/db`.
 */
export interface ManualGradingRepository {
  /** Persist (insert-or-overwrite) a manual grading entry. */
  upsert(input: {
    attemptId: string;
    questionId: string;
    score: number;
    maxScore: number;
    comment: string;
    gradedBy: string;
    gradedAt: Date;
    now: Date;
  }): Promise<void>;
  /** All manual grading entries for an attempt. */
  findByAttempt(
    attemptId: string,
  ): Promise<Array<{ questionId: string; score: number }>>;
}

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
 * Returns the subjective question ids in an attempt's snapshot: those whose
 * `standardAnswer` is null/undefined (mirrors `hasSubjectiveQuestions`).
 */
function subjectiveQuestionIds(attempt: ExamAttempt): string[] {
  return attempt.questionSnapshot
    .filter((q) => q.standardAnswer == null)
    .map((q) => q.originalQuestionId);
}

/**
 * Pure reconciliation: folds manual grading scores into the attempt's score
 * breakdown. Objective questions keep their auto-graded result; subjective
 * questions take the manually-entered score (full marks = correct).
 *
 * Recomputed from the COMPLETE objective + manual sets every call, so a
 * re-grade (entry overwrite) is naturally idempotent — manual scores are never
 * added on top of an already-inclusive total. Subjective auto-graded rows
 * always carry score 0 (a null standardAnswer never matches), so they do not
 * double-count.
 *
 * @param attempt the attempt (carries questionSnapshot + existing auto-graded
 *   gradingResult).
 * @param entries all manual grading entries for the attempt
 *   ({ questionId, score }).
 * @param passingScore the exam's passing threshold.
 * @returns the reconciled per-question results, total score, and pass/fail.
 */
export function reconcileScores(
  attempt: ExamAttempt,
  entries: Array<{ questionId: string; score: number }>,
  passingScore: number,
): {
  questionResults: QuestionScoreResult[];
  totalScore: number;
  passed: boolean;
} {
  const manualByQuestion = new Map(entries.map((e) => [e.questionId, e.score]));
  const snapshotByQuestion = new Map(
    attempt.questionSnapshot.map((q) => [q.originalQuestionId, q]),
  );
  const autoByQuestion = new Map(
    (attempt.gradingResult ?? []).map((r) => [r.questionId, r]),
  );

  const questionResults: QuestionScoreResult[] = attempt.questionSnapshot.map(
    (q) => {
      const auto = autoByQuestion.get(q.originalQuestionId);
      const isSubjective = q.standardAnswer == null;
      if (isSubjective) {
        const manualScore = manualByQuestion.get(q.originalQuestionId) ?? 0;
        return {
          questionId: q.originalQuestionId,
          score: manualScore,
          maxScore: q.score,
          correct: manualScore >= q.score,
          candidateAnswer: auto?.candidateAnswer ?? null,
          standardAnswer: null,
        };
      }
      // Objective: keep the auto-graded result authoritative. Fall back to a
      // zero-scored row if the snapshot has no auto result yet.
      return (
        auto ?? {
          questionId: q.originalQuestionId,
          score: 0,
          maxScore: q.score,
          correct: false,
          candidateAnswer: null,
          standardAnswer:
            snapshotByQuestion.get(q.originalQuestionId)?.standardAnswer ??
            null,
        }
      );
    },
  );

  const totalScore = questionResults.reduce((sum, r) => sum + r.score, 0);
  return { questionResults, totalScore, passed: totalScore >= passingScore };
}

/**
 * Saves (or overwrites) one manual grading entry for an attempt and, when the
 * last subjective question has been scored, flips `gradingStatus` to
 * `fully_graded` and reconciles the attempt total (objective + manual) into
 * `score`/`passed`/`gradingResult`.
 *
 * P2D-J3 decisions (approved plan):
 * - Allowed on `pending_manual` AND `fully_graded` (re-grade overwrites,
 *   per spec §18). Only `auto_graded` attempts are rejected (FORBIDDEN) — they
 *   have no subjective questions to grade.
 * - `gradingStatus` always reflects manual-completion. Once fully graded, the
 *   attempt `score`/`passed`/`gradingResult` are recomputed so the candidate
 *   result reflects objective + manual totals. Reconciliation rebuilds from the
 *   full objective + manual sets every call, so re-grades are idempotent and
 *   never double-count.
 *
 * The caller is responsible for wrapping this in a transaction that has
 * locked the attempt row (findByIdForUpdate) — see the route handler.
 *
 * @throws {NotFoundError} attempt does not exist.
 * @throws {PermissionDeniedError} attempt is `auto_graded` (nothing to grade).
 * @throws {ValidationError} questionId is not a subjective question in the
 *   attempt, or score is outside `[0, maxScore]`.
 */
export async function gradeQuestion(
  attemptRepo: AttemptRepository,
  manualGradingRepo: ManualGradingRepository,
  attemptId: string,
  questionId: string,
  score: number,
  comment: string,
  graderId: string,
  now: Date,
  passingScore: number,
): Promise<GradeQuestionResult> {
  const attempt = await attemptRepo.findById(attemptId);
  if (!attempt) {
    throw new NotFoundError("Attempt not found");
  }

  if (attempt.gradingStatus === "auto_graded") {
    throw new PermissionDeniedError(
      "Attempt has no subjective questions to grade",
    );
  }

  const subjectiveIds = subjectiveQuestionIds(attempt);
  const question = attempt.questionSnapshot.find(
    (q) => q.originalQuestionId === questionId,
  );
  if (!question || !subjectiveIds.includes(questionId)) {
    throw new ValidationError(
      `Question ${questionId} is not a subjective question in this attempt`,
    );
  }
  const maxScore = question.score;
  if (!Number.isFinite(score) || score < 0 || score > maxScore) {
    throw new ValidationError(`score must be between 0 and ${maxScore}`);
  }

  await manualGradingRepo.upsert({
    attemptId,
    questionId,
    score,
    maxScore,
    comment,
    gradedBy: graderId,
    gradedAt: now,
    now,
  });

  const entries = await manualGradingRepo.findByAttempt(attemptId);
  const scoredIds = new Set(entries.map((e) => e.questionId));
  const fullyGraded =
    subjectiveIds.length > 0 && subjectiveIds.every((id) => scoredIds.has(id));

  if (fullyGraded) {
    // Reconcile the total from the complete objective + manual sets. Always
    // recomputed (never incremented) so re-grades are idempotent.
    const reconciled = reconcileScores(attempt, entries, passingScore);
    // P3-L0-2C: completeManualGrading owns the final submitted → graded
    // lifecycle transition for manual-grading attempts. protocol §3.3/§4.2 —
    // only this command may advance a pending_manual attempt to graded once
    // all subjective scores are entered. Also re-runs the enrollment
    // finalization (finalScore / completion) so the candidate's record
    // reflects the reconciled total. This transition is only issued when the
    // attempt is still at `submitted`; a re-grade on an already-graded
    // attempt (status=graded) leaves status alone and just refreshes the
    // score breakdown.
    const statusUpdate =
      attempt.status === "submitted" ? { status: "graded" as const } : {};
    await attemptRepo.update(attemptId, {
      ...statusUpdate,
      gradingStatus: "fully_graded",
      score: reconciled.totalScore,
      passed: reconciled.passed,
      gradingResult: reconciled.questionResults,
    });
    return {
      gradingStatus: "fully_graded",
      fullyGraded: true,
      totalScore: reconciled.totalScore,
      passed: reconciled.passed,
    };
  }

  return {
    gradingStatus: "pending_manual",
    fullyGraded: false,
  };
}
