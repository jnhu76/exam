import type {
  AnswerRecord,
  ExamAttempt,
  QuestionScoreResult,
  QuestionSnapshot,
} from "@exam/domain";
import {
  gradeQuestion as gradeQuestionAuto,
  isManualGradedQuestion,
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
 * P3-L0-2D canonical manual-grading question ids for an attempt.
 *
 * Single semantic authority (protocol §1.4) — derived from
 * {@link isManualGradedQuestion}, NOT from `standardAnswer == null`. This is
 * the per-question selection list that the manual grading command consumes;
 * it is consulted by both the partial-vs-complete check and the
 * reconciliation fold, so question selection can never diverge from the
 * freeze-barrier classification in {@link submitAttempt}.
 *
 * Replaces the previous `standardAnswer == null` heuristic (Defect B): a
 * `text_response` question may legally carry a non-null `standardAnswer`
 * (a reference answer used as grader guidance). Such a question MUST remain
 * in the manual-grading queue.
 */
function manualGradedQuestionIds(attempt: ExamAttempt): string[] {
  return attempt.questionSnapshot
    .filter((q) => isManualGradedQuestion(q))
    .map((q) => q.originalQuestionId);
}

/**
 * Builds the per-question answer lookup the auto-grader consumes, sourced
 * from the frozen `submitted_answers` snapshot when present. Falls back to
 * draft `answers` only for legacy attempts whose `submitted_answers` column
 * is null (pre-P3-L0-2 rows); current attempts always freeze on submit.
 *
 * Mirrors {@link computeGradingResult}'s source-of-truth rule so manual
 * completion reconciles against the SAME locked answer set the freeze
 * barrier captured. Never reads mutable drafts for a submitted attempt that
 * has a frozen snapshot.
 */
function buildAutoGradingAnswers(
  attempt: ExamAttempt,
  now: Date,
): AnswerRecord[] {
  if (attempt.submittedAnswers) {
    return attempt.submittedAnswers.answers.map((a) => ({
      questionId: a.questionId,
      answer: a.value,
      version: 0,
      savedAt: now,
    }));
  }
  return attempt.answers;
}

/**
 * Reconstructs the objective per-question score for a snapshot question from
 * the frozen answer set, WITHOUT touching manual-grading contributions. Used
 * by {@link reconcileScores} so the objective total is never lost even when
 * the candidate-submit orchestrator held the attempt at
 * `submitted + pending_manual` and never wrote `gradingResult`.
 *
 * Reuses the canonical domain auto-grader ({@link gradeQuestion}) — there is
 * no second scoring formula. Manual-graded questions are skipped here; their
 * score is folded in by the caller from the manual entry set.
 */
function reconstructObjectiveScore(
  question: QuestionSnapshot,
  answerMap: Map<string, AnswerRecord>,
): QuestionScoreResult | null {
  if (isManualGradedQuestion(question)) {
    return null;
  }
  const answerRecord = answerMap.get(question.originalQuestionId);
  return gradeQuestionAuto(question, answerRecord?.answer);
}

/**
 * Pure reconciliation: folds manual grading scores into the attempt's score
 * breakdown. Objective questions keep their auto-graded result; subjective
 * questions take the manually-entered score (full marks = correct).
 *
 * P3-L0-2D repair (Defect A + Defect B):
 * - Objective contributions are RECONSTRUCTED from `submitted_answers` +
 *   the frozen `questionSnapshot` via the canonical domain auto-grader when
 *   the attempt's persisted `gradingResult` lacks the objective row. The
 *   candidate-submit orchestrator correctly holds a `pending_manual` attempt
 *   at `submitted` and never writes `gradingResult`, so the previous
 *   implementation read an empty `gradingResult` and silently dropped the
 *   objective total. Reconstruction is deterministic and reuses the SAME
 *   `gradeAnswers` formula the freeze barrier would have run; no second
 *   scoring path.
 * - Manual-question classification uses {@link isManualGradedQuestion}
 *   (QuestionType semantics), NOT `standardAnswer == null`. A
 *   `text_response` carrying a non-null reference answer is still recognized
 *   as manual-graded.
 *
 * Recomputed from the COMPLETE objective + manual sets every call, so a
 * re-grade (entry overwrite) is naturally idempotent — manual scores are
 * never added on top of an already-inclusive total. When both a
 * persisted `gradingResult` row AND a reconstructed row exist for the same
 * objective question, the persisted row wins (it is the authoritative
 * record an auto-grading path already wrote); reconstruction only fills
 * gaps.
 *
 * @param attempt the attempt (carries questionSnapshot + submittedAnswers +
 *   optional existing auto-graded gradingResult).
 * @param entries all manual grading entries for the attempt
 *   ({ questionId, score }).
 * @param passingScore the exam's passing threshold.
 * @param now server time authority (used to shape reconstructed answer
 *   records; non-grading semantic).
 * @returns the reconciled per-question results, total score, and pass/fail.
 */
export function reconcileScores(
  attempt: ExamAttempt,
  entries: Array<{ questionId: string; score: number }>,
  passingScore: number,
  now: Date,
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
  const frozenAnswerMap = new Map(
    buildAutoGradingAnswers(attempt, now).map((a) => [a.questionId, a]),
  );

  const questionResults: QuestionScoreResult[] = attempt.questionSnapshot.map(
    (q) => {
      if (isManualGradedQuestion(q)) {
        const manualScore = manualByQuestion.get(q.originalQuestionId) ?? 0;
        // Preserve the candidate's frozen answer for the grading-detail view;
        // standardAnswer is whatever the snapshot froze (may be non-null).
        const frozenAnswer = frozenAnswerMap.get(q.originalQuestionId);
        return {
          questionId: q.originalQuestionId,
          score: manualScore,
          maxScore: q.score,
          correct: manualScore >= q.score,
          candidateAnswer: frozenAnswer?.answer ?? null,
          standardAnswer: q.standardAnswer ?? null,
        };
      }
      // Objective: prefer the persisted auto-graded result when present
      // (authoritative — written by the auto-finalize path). Otherwise
      // RECONSTRUCT from submitted_answers + frozen snapshot so the objective
      // total is not lost on a held pending_manual attempt (Defect A).
      const persisted = autoByQuestion.get(q.originalQuestionId);
      if (persisted) {
        return persisted;
      }
      const reconstructed = reconstructObjectiveScore(q, frozenAnswerMap);
      return (
        reconstructed ?? {
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
 * last manual-graded question has been scored, flips `gradingStatus` to
 * `fully_graded` and reconciles the attempt total (objective + manual) into
 * `score`/`passed`/`gradingResult`.
 *
 * P2D-J3 decisions (approved plan):
 * - Allowed on `pending_manual` AND `fully_graded` (re-grade overwrites,
 *   per spec §18). Only `auto_graded` attempts are rejected (FORBIDDEN) — they
 *   have no manual-graded questions to grade.
 * - `gradingStatus` always reflects manual-completion. Once fully graded, the
 *   attempt `score`/`passed`/`gradingResult` are recomputed so the candidate
 *   result reflects objective + manual totals. Reconciliation rebuilds from the
 *   full objective + manual sets every call, so re-grades are idempotent and
 *   never double-count.
 *
 * P3-L0-2D: manual-question selection uses the canonical
 * {@link isManualGradedQuestion} / {@link manualGradedQuestionIds} authority
 * (protocol §1.4). The previous `standardAnswer == null` heuristic is removed:
 * a `text_response` question may carry a non-null reference answer and MUST
 * remain gradable (Defect B). Score reconciliation reconstructs objective
 * contributions from `submitted_answers` + frozen `questionSnapshot` so the
 * objective total is preserved across the manual hold (Defect A).
 *
 * The caller is responsible for wrapping this in a transaction that has
 * locked the attempt row (findByIdForUpdate) — see the route handler.
 *
 * @throws {NotFoundError} attempt does not exist.
 * @throws {PermissionDeniedError} attempt is `auto_graded` (nothing to grade).
 * @throws {ValidationError} questionId is not a manual-graded question in the
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

  // P3-L0-2D: canonical manual-grading question selection (QuestionType
  // semantics). Not standardAnswer-based.
  const manualIds = manualGradedQuestionIds(attempt);
  const question = attempt.questionSnapshot.find(
    (q) => q.originalQuestionId === questionId,
  );
  if (!question || !manualIds.includes(questionId)) {
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
    manualIds.length > 0 && manualIds.every((id) => scoredIds.has(id));

  if (fullyGraded) {
    // Reconcile the total from the complete objective + manual sets. Always
    // recomputed (never incremented) so re-grades are idempotent. P3-L0-2D:
    // objective contributions are reconstructed from the frozen snapshot when
    // the persisted gradingResult lacks them.
    const reconciled = reconcileScores(attempt, entries, passingScore, now);
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
