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
   * tenant. Used by {@link materializeGradingWorkset} for fresh-submit
   * precondition check, by {@link validateGradingWorksetConsistency} for
   * idempotent re-entry, by {@link reconcileScores} for terminal aggregation,
   * and by {@link gradeQuestion} to read the per-question manual state.
   */
  findByAttempt(attemptId: string): Promise<AttemptGradingEntry[]>;

  /**
   * Returns the single grading entry for (attemptId, questionId), scoped to
   * the caller's tenant, or null when no entry exists. Slice 3 authoritative
   * manual-work lookup: {@link gradeQuestion} consumes this to fail closed on
   * a missing entry and to authorize grading from the materialized
   * `gradingMode` (NOT from question-type/standardAnswer rescanning).
   */
  findByAttemptAndQuestion(
    attemptId: string,
    questionId: string,
  ): Promise<AttemptGradingEntry | null>;

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

  /**
   * Updates the single (attemptId, questionId) entry to completed_manual with
   * the grader's awarded score. Slice 3 manual-score write authority —
   * {@link gradeQuestion} reads the entry first then calls this to UPDATE the
   * SAME row (no second row created). Targets pending_manual OR
   * completed_manual (re-grade) entries; never creates a new row. Returns the
   * updated entry or null if no row matched (which the caller treats as a
   * fail-closed missing-entry condition).
   */
  completeManualEntry(input: {
    attemptId: string;
    questionId: string;
    earnedScore: number;
    maxScore: number;
    comment: string;
    gradedBy: string;
    gradedAt: Date;
    now: Date;
  }): Promise<AttemptGradingEntry | null>;

  /**
   * Counts the remaining pending_manual manual-mode entries for an attempt,
   * scoped to the caller's tenant. {@link gradeQuestion} uses this to detect
   * terminal completion (when the last manual question has been scored).
   */
  countPendingManualForAttempt(attemptId: string): Promise<number>;
}

/** Expected grading entry derived from frozen submitted truth. */
export interface ExpectedGradingEntry {
  questionId: string;
  gradingMode: GradingEntryMode;
  status: GradingEntryStatus;
  maxScore: number;
  earnedScore: number | null;
  candidateAnswer: unknown;
  standardAnswer: unknown;
  correct: boolean | null;
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
      `Cannot compute grading workset for attempt ${attempt.id}: ` +
        "submittedAnswers is null. The submit freeze barrier must run before " +
        "workset computation.",
    );
  }
  return new Map(submitted.answers.map((a) => [a.questionId, a.value]));
}

/**
 * Computes the expected grading entries from frozen submitted truth (P3-L0-2E).
 *
 * Pure function — no side effects, no repo calls. Derives exactly one expected
 * entry per frozen question from:
 * - `attempt.submittedAnswers` (frozen at submit-freeze time)
 * - `attempt.questionSnapshot` (frozen at attempt-creation time)
 * - canonical `gradeQuestion` for objective scoring
 * - canonical `isManualGradedQuestion` for manual classification
 *
 * No live questions, no draft answer fallback, no `standardAnswer` nullness
 * classification.
 */
export function computeExpectedGradingEntries(
  attempt: ExamAttempt,
): ExpectedGradingEntry[] {
  const answerMap = buildFrozenAnswerMap(attempt);

  return attempt.questionSnapshot.map((question: QuestionSnapshot) => {
    const candidateAnswer = answerMap.get(question.originalQuestionId) ?? null;

    if (isManualGradedQuestion(question)) {
      return {
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
}

/**
 * Materializes the durable grading workset for a fresh submit (P3-L0-2E).
 *
 * Creates exactly one `attempt_grading_entries` row per frozen question via a
 * single atomic bulk insert. This function does NOT check for existing entries
 * — the caller (submitAttempt) is responsible for ensuring the fresh-submit
 * precondition (zero pre-existing entries) before calling this.
 *
 * Inputs are exclusively `submitted_answers` + the frozen `questionSnapshot`.
 * No live questions, no draft answer fallback.
 *
 * Must be called inside the submit transaction holding the attempt row lock.
 */
export async function materializeGradingWorkset(
  attempt: ExamAttempt,
  repo: GradingWorksetRepository,
): Promise<void> {
  const expected = computeExpectedGradingEntries(attempt);

  await repo.bulkCreate(
    expected.map((e) => ({
      attemptId: attempt.id,
      ...e,
    })),
  );
}

/**
 * Validates that existing workset entries exactly match the expected truth
 * derived from the frozen attempt (P3-L0-2E idempotent re-entry).
 *
 * Throws on ANY inconsistency. Does not modify entries, does not fill gaps,
 * does not repair partial state, does not overwrite mismatched rows.
 *
 * Validation checks per frozen question:
 * - Entry exists (count + question ID set match)
 * - `gradingMode` matches canonical classification
 * - `maxScore` matches frozen `QuestionSnapshot.score`
 * - Objective: `status === completed_auto` and `earnedScore` matches canonical
 *   `gradeQuestion` result from frozen submitted answer
 * - Manual: `status ∈ {pending_manual, completed_manual}`; pending requires
 *   `earnedScore === null`; completed requires `0 <= earnedScore <= maxScore`
 *
 * @throws {Error} on any workset inconsistency.
 */
export function validateGradingWorksetConsistency(
  attempt: ExamAttempt,
  existing: AttemptGradingEntry[],
): void {
  const expected = computeExpectedGradingEntries(attempt);
  const expectedMap = new Map(expected.map((e) => [e.questionId, e]));
  const existingMap = new Map(existing.map((e) => [e.questionId, e]));

  if (existing.length !== expected.length) {
    throw new Error(
      `Grading workset inconsistency for attempt ${attempt.id}: ` +
        `expected ${expected.length} entries, found ${existing.length}. ` +
        "Partial or extra workset entries are not repairable.",
    );
  }

  for (const exp of expected) {
    const entry = existingMap.get(exp.questionId);
    if (!entry) {
      throw new Error(
        `Grading workset inconsistency for attempt ${attempt.id}: ` +
          `missing entry for question ${exp.questionId}.`,
      );
    }

    if (entry.gradingMode !== exp.gradingMode) {
      throw new Error(
        `Grading workset inconsistency for attempt ${attempt.id}, ` +
          `question ${exp.questionId}: ` +
          `gradingMode ${entry.gradingMode} != expected ${exp.gradingMode}.`,
      );
    }

    if (entry.maxScore !== exp.maxScore) {
      throw new Error(
        `Grading workset inconsistency for attempt ${attempt.id}, ` +
          `question ${exp.questionId}: ` +
          `maxScore ${entry.maxScore} != expected ${exp.maxScore}.`,
      );
    }

    if (exp.gradingMode === "auto") {
      if (entry.status !== "completed_auto") {
        throw new Error(
          `Grading workset inconsistency for attempt ${attempt.id}, ` +
            `question ${exp.questionId}: ` +
            `auto entry status ${entry.status} != expected completed_auto.`,
        );
      }
      if (entry.earnedScore !== exp.earnedScore) {
        throw new Error(
          `Grading workset inconsistency for attempt ${attempt.id}, ` +
            `question ${exp.questionId}: ` +
            `earnedScore ${entry.earnedScore} != expected ${exp.earnedScore} ` +
            "(objective score must match canonical frozen truth).",
        );
      }
    } else {
      if (
        entry.status !== "pending_manual" &&
        entry.status !== "completed_manual"
      ) {
        throw new Error(
          `Grading workset inconsistency for attempt ${attempt.id}, ` +
            `question ${exp.questionId}: ` +
            `manual entry status ${entry.status} is not valid ` +
            "(expected pending_manual or completed_manual).",
        );
      }
      if (entry.status === "pending_manual" && entry.earnedScore !== null) {
        throw new Error(
          `Grading workset inconsistency for attempt ${attempt.id}, ` +
            `question ${exp.questionId}: ` +
            "pending_manual entry must have null earnedScore.",
        );
      }
      if (entry.status === "completed_manual") {
        if (entry.earnedScore === null) {
          throw new Error(
            `Grading workset inconsistency for attempt ${attempt.id}, ` +
              `question ${exp.questionId}: ` +
              "completed_manual entry must have non-null earnedScore.",
          );
        }
        if (entry.earnedScore < 0 || entry.earnedScore > entry.maxScore) {
          throw new Error(
            `Grading workset inconsistency for attempt ${attempt.id}, ` +
              `question ${exp.questionId}: ` +
              `completed_manual earnedScore ${entry.earnedScore} out of range ` +
              `[0, ${entry.maxScore}].`,
          );
        }
      }
    }
  }

  for (const entry of existing) {
    if (!expectedMap.has(entry.questionId)) {
      throw new Error(
        `Grading workset inconsistency for attempt ${attempt.id}: ` +
          `extra entry for question ${entry.questionId} ` +
          "not in frozen QuestionSnapshot.",
      );
    }
  }
}
