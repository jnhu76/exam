import type {
  AnswerRecord,
  AttemptGradingEntry,
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
import type { GradingWorksetRepository } from "./gradingWorkset.js";

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
 * P3-L0-2E Slice 3: manual scores are sourced from the materialized
 * `attempt_grading_entries` rows (status `completed_manual`). The
 * `AttemptGradingEntry` carries the authoritative `earnedScore`, so the
 * reconciler no longer depends on a separate legacy manual-score store.
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
 * @param entries all grading entries for the attempt (Slice 3 source of
 *   manual awarded scores — completed_manual rows contribute their
 *   `earnedScore`).
 * @param passingScore the exam's passing threshold.
 * @param now server time authority (used to shape reconstructed answer
 *   records; non-grading semantic).
 * @returns the reconciled per-question results, total score, and pass/fail.
 */
export function reconcileScores(
  attempt: ExamAttempt,
  entries: AttemptGradingEntry[],
  passingScore: number,
  now: Date,
): {
  questionResults: QuestionScoreResult[];
  totalScore: number;
  passed: boolean;
} {
  // Manual awarded score lookup from the authoritative grading entries. Only
  // completed_manual rows carry a grader-awarded score; pending_manual rows
  // contribute zero (they have null earnedScore).
  const manualScoreByQuestion = new Map(
    entries
      .filter(
        (e) => e.gradingMode === "manual" && e.status === "completed_manual",
      )
      .map((e) => [e.questionId, e.earnedScore ?? 0]),
  );
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
        const manualScore =
          manualScoreByQuestion.get(q.originalQuestionId) ?? 0;
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
 * P3-L0-2E Slice 3 — authoritative workset ownership:
 *
 * The single durable manual-score truth is the `attempt_grading_entries` row
 * materialized at submit-freeze time. The command flow is:
 *
 *   load/lock attempt
 *     → load the (attemptId, questionId) grading entry
 *     → entry missing?           fail closed (NotFoundError)
 *     → entry.gradingMode=auto?  reject (PermissionDeniedError)
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
 * Re-grade (entry already `completed_manual`) overwrites the same row via
 * `completeManualEntry`; no second row is ever created. Terminal
 * reconciliation is recomputed from the full entry set every call, so
 * re-grades are idempotent and never double-count.
 *
 * The caller is responsible for wrapping this in a transaction that has
 * locked the attempt row (findByIdForUpdate) — see the route handler.
 *
 * @throws {NotFoundError} attempt or its grading entry does not exist.
 * @throws {PermissionDeniedError} the entry is `grading_mode = auto`
 *   (nothing to manually grade). This subsumes the historical `auto_graded`
 *   attempt rejection: a fully-auto attempt has no manual entries at all, so
 *   the lookup itself misses or returns an auto entry.
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

  // Frozen maxScore authority (entry mirrors the frozen QuestionSnapshot).
  const maxScore = entry.maxScore;
  if (!Number.isFinite(score) || score < 0 || score > maxScore) {
    throw new ValidationError(`score must be between 0 and ${maxScore}`);
  }

  // UPDATE SAME ENTRY — pending_manual → completed_manual (or overwrite an
  // already-completed_manual entry on re-grade). No second row is created.
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
    // Reconcile the total from the complete objective + manual sets. Always
    // recomputed (never incremented) so re-grades are idempotent. Manual
    // scores are read from the authoritative grading entries.
    const allEntries = await worksetRepo.findByAttempt(attemptId);
    const reconciled = reconcileScores(attempt, allEntries, passingScore, now);
    // P3-L0-2C: this command owns the final submitted → graded lifecycle
    // transition for manual-grading attempts. Only this command may advance a
    // pending_manual attempt to graded once all subjective scores are
    // entered. Also re-runs the enrollment finalization (finalScore /
    // completion) so the candidate's record reflects the reconciled total.
    // This transition is only issued when the attempt is still at
    // `submitted`; a re-grade on an already-graded attempt (status=graded)
    // leaves status alone and just refreshes the score breakdown.
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
