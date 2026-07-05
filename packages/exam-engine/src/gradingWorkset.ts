import type {
  AttemptGradingEntry,
  ExamAttempt,
  GradingEntryMode,
  GradingEntryStatus,
  QuestionSnapshot,
} from "@exam/domain";
import { gradeQuestion, isManualGradedQuestion } from "@exam/domain";

/**
 * Repository port for the materialized grading workset (P3-L0-2E). The
 * exam-engine layer defines this interface so it does not depend on
 * `@exam/db`; the API adapter layer bridges the concrete Drizzle repo to
 * this port.
 *
 * This is the single durable grading truth surface. Entries are created at
 * submit-freeze time, updated by manual scoring, and read by terminal
 * aggregation.
 */
export interface GradingWorksetRepository {
  /**
   * Returns all grading entries for an attempt, scoped to the caller's
   * tenant. Used by {@link materializeGradingWorkset} for idempotent retry
   * detection and by terminal aggregation.
   */
  findByAttempt(attemptId: string): Promise<AttemptGradingEntry[]>;

  /**
   * Bulk-inserts grading workset entries. Exactly one entry per frozen
   * question. Must throw on unique-constraint violation (no silent
   * `ON CONFLICT DO NOTHING`).
   */
  bulkCreate(
    inputs: Array<{
      attemptId: string;
      questionId: string;
      gradingMode: GradingEntryMode;
      status: GradingEntryStatus;
      maxScore: number;
      earnedScore: number | null;
      candidateAnswer: unknown;
      standardAnswer: unknown;
      correct: boolean | null;
    }>,
  ): Promise<void>;
}

/**
 * Builds the per-question answer lookup from the frozen `submitted_answers`
 * snapshot. Never reads mutable draft `answers`. Returns a Map keyed by
 * `questionId`.
 */
function buildFrozenAnswerMap(attempt: ExamAttempt): Map<string, unknown> {
  const submitted = attempt.submittedAnswers;
  if (!submitted) {
    throw new Error(
      `Cannot materialize grading workset for attempt ${attempt.id}: ` +
        "submittedAnswers is null. The submit freeze barrier must run before " +
        "materialization.",
    );
  }
  return new Map(submitted.answers.map((a) => [a.questionId, a.value]));
}

/**
 * Materializes the durable grading workset for a submitted attempt (P3-L0-2E).
 *
 * Creates exactly one `attempt_grading_entries` row per frozen question:
 * - Objective questions (`single_choice`, `multiple_choice`, `true_false`,
 *   `fill_blank`) are auto-graded immediately via the canonical domain
 *   {@link gradeQuestion} and stored as `completed_auto`.
 * - `text_response` questions are stored as `pending_manual` with the frozen
 *   candidate answer and frozen standard answer for the grading view.
 *
 * Inputs are exclusively `submitted_answers` + the frozen `questionSnapshot`.
 * No live questions, no draft answer fallback.
 *
 * Idempotent: if entries already exist for this attempt (retry after a
 * crash), the function returns without creating duplicates. This is NOT
 * `ON CONFLICT DO NOTHING` — the function explicitly checks for existing
 * entries and only creates them when the workset is absent.
 *
 * Must be called inside the submit transaction holding the attempt row lock.
 */
export async function materializeGradingWorkset(
  attempt: ExamAttempt,
  repo: GradingWorksetRepository,
): Promise<void> {
  const existing = await repo.findByAttempt(attempt.id);
  if (existing.length > 0) {
    return;
  }

  const answerMap = buildFrozenAnswerMap(attempt);

  const inputs = attempt.questionSnapshot.map((question: QuestionSnapshot) => {
    const candidateAnswer = answerMap.get(question.originalQuestionId) ?? null;

    if (isManualGradedQuestion(question)) {
      return {
        attemptId: attempt.id,
        questionId: question.originalQuestionId,
        gradingMode: "manual" as GradingEntryMode,
        status: "pending_manual" as GradingEntryStatus,
        maxScore: question.score,
        earnedScore: null,
        candidateAnswer,
        standardAnswer: question.standardAnswer ?? null,
        correct: null,
      };
    }

    const result = gradeQuestion(question, candidateAnswer);
    return {
      attemptId: attempt.id,
      questionId: question.originalQuestionId,
      gradingMode: "auto" as GradingEntryMode,
      status: "completed_auto" as GradingEntryStatus,
      maxScore: question.score,
      earnedScore: result.score,
      candidateAnswer,
      standardAnswer: question.standardAnswer ?? null,
      correct: result.correct,
    };
  });

  await repo.bulkCreate(inputs);
}
