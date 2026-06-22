import type { ExamAttempt } from "@exam/domain";
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
 * Saves (or overwrites) one manual grading entry for an attempt and, when the
 * last subjective question has been scored, flips `gradingStatus` to
 * `fully_graded`.
 *
 * P2D-J3 decisions (approved plan):
 * - Allowed on `pending_manual` AND `fully_graded` (re-grade overwrites,
 *   per spec §18). Only `auto_graded` attempts are rejected (FORBIDDEN) — they
 *   have no subjective questions to grade.
 * - Touches `gradingStatus` ONLY. Never mutates lifecycle `status`, `score`,
 *   `gradingResult`, `passed`, or the enrollment. Auto-grading results stay
 *   authoritative for objective questions; manual scores are layered on top
 *   for reporting (a future job may recompute the attempt total).
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

  if (fullyGraded && attempt.gradingStatus !== "fully_graded") {
    await attemptRepo.update(attemptId, { gradingStatus: "fully_graded" });
  }

  return {
    gradingStatus: fullyGraded ? "fully_graded" : "pending_manual",
    fullyGraded,
  };
}
