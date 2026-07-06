import type {
  AttemptGradingEntry,
  ExamAttempt,
  GradingEntryMode,
  GradingEntryStatus,
  QuestionScoreResult,
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
   * idempotent re-entry, by {@link aggregateGradingEntries} for terminal
   * aggregation, and by {@link gradeQuestion} to read the per-question
   * manual state.
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
   * SAME row (no second row created). Slice 3C: the command guarantees the
   * entry is `pending_manual` when this is called; a `completed_manual` entry
   * is never re-touched by the ordinary grading command. Returns the updated
   * entry or null if no row matched (which the caller treats as a fail-closed
   * missing-entry condition).
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

// ── P3-L0-2E Slice 4: canonical terminal aggregation ─────────────

/**
 * Result of {@link aggregateGradingEntries}: the single terminal-aggregate
 * truth that owns `attempt.score` / `gradingResult` / `passed`.
 *
 * `maxScore` is the sum of the validated entry max-scores (the canonical
 * denominator). It is returned alongside `totalScore` so callers that need a
 * percentage use the SAME validated universe for both numerator and
 * denominator — never a mixed source.
 */
export interface GradingEntryAggregate {
  questionResults: QuestionScoreResult[];
  totalScore: number;
  maxScore: number;
  passed: boolean;
}

/**
 * Expected terminal status for a grading entry of the given mode.
 *
 * `auto` mode must be `completed_auto`; `manual` mode must be
 * `completed_manual`. Any other status means the workset is not terminal and
 * aggregation must refuse.
 */
function expectedTerminalStatus(mode: GradingEntryMode): GradingEntryStatus {
  return mode === "auto" ? "completed_auto" : "completed_manual";
}

/**
 * Aggregates the materialized grading workset into the terminal score result
 * (P3-L0-2E Slice 4).
 *
 * This is the **single canonical terminal aggregation authority**. Every
 * production path that persists `attempt.score` / `attempt.gradingResult` /
 * `attempt.passed` for a graded attempt flows through here. It reads ONLY:
 *
 *   - the frozen `attempt.questionSnapshot` (question universe, order,
 *     metadata: type/maxScore/standardAnswer)
 *   - the materialized `attempt_grading_entries` (earned score, candidate
 *     answer, correctness)
 *
 * It NEVER reads:
 *   - `attempt.gradingResult` (that is a denormalized *output* projection,
 *     never a scoring input)
 *   - draft `attempt.answers`
 *   - live questions
 *   - `submittedAnswers` (re-running the objective grader to fill gaps is
 *     forbidden — the entries already carry the frozen earned score)
 *
 * ## Validation (fail-closed, runs BEFORE any projection)
 *
 * The workset must be exactly complete and terminal before any score is
 * summed. Each check throws a descriptive `Error` (surfaced as a 500 by the
 * API error handler — these are invariant violations, not user input errors):
 *
 *   1. exact entry count === frozen question count
 *   2. entry questionId set === frozen questionId set (no missing, no extra)
 *   3. no duplicate questionIds within the entry set (defensive — the DB
 *      UNIQUE(attempt_id, question_id) already prevents this; the check exists
 *      so an in-memory fake or a corrupt read cannot silently pass)
 *   4. per entry: `entry.maxScore === frozenQuestion.score`
 *   5. per entry: `entry.gradingMode` matches canonical question semantics
 *      (`isManualGradedQuestion` — text_response → manual; all others → auto).
 *      NOT `standardAnswer == null`.
 *   6. per entry: terminal status (`auto`→`completed_auto`,
 *      `manual`→`completed_manual`). A `pending_manual` entry blocks
 *      aggregation — the caller must not invoke this until all manual work is
 *      complete.
 *   7. per entry: `earnedScore != null` and `0 <= earnedScore <= maxScore`
 *
 * ## Projection (Steps 7-8)
 *
 * Iterates `attempt.questionSnapshot` in **frozen order** (NOT entry DB order)
 * so the final `gradingResult` row order is stable and matches the snapshot.
 * One result row per frozen question. Earned score + candidateAnswer +
 * correctness come from the matching entry; maxScore + standardAnswer come
 * from the frozen snapshot (already mirrored on the entry — both are checked
 * for consistency).
 *
 * @throws {Error} on ANY workset inconsistency (missing/extra/duplicate entry,
 *   mode mismatch, maxScore mismatch, non-terminal status, null/out-of-range
 *   earnedScore).
 */
export function aggregateGradingEntries(
  attempt: ExamAttempt,
  entries: AttemptGradingEntry[],
  passingScore: number,
): GradingEntryAggregate {
  const questions = attempt.questionSnapshot;
  const attemptId = attempt.id;

  // 1. Exact count.
  if (entries.length !== questions.length) {
    throw new Error(
      `Grading aggregation inconsistency for attempt ${attemptId}: ` +
        `expected ${questions.length} entries (one per frozen question), ` +
        `found ${entries.length}. Aggregation requires an exactly complete ` +
        "terminal workset — no fill-gaps, no ignore-extras.",
    );
  }

  // Index entries by questionId for O(1) lookup. Detect duplicates defensively
  // (the DB UNIQUE constraint already prevents this; the check guards against
  // in-memory fakes / corrupt reads).
  const entryByQuestion = new Map<string, AttemptGradingEntry>();
  for (const entry of entries) {
    if (entryByQuestion.has(entry.questionId)) {
      throw new Error(
        `Grading aggregation inconsistency for attempt ${attemptId}: ` +
          `duplicate grading entry for question ${entry.questionId}. ` +
          "Exactly one entry per frozen question is required.",
      );
    }
    entryByQuestion.set(entry.questionId, entry);
  }

  // 2. Validate each frozen question has exactly one matching entry, and that
  //    the entry's mode/maxScore/status/earnedScore are terminal-consistent.
  for (const question of questions) {
    const qid = question.originalQuestionId;
    const entry = entryByQuestion.get(qid);
    if (!entry) {
      throw new Error(
        `Grading aggregation inconsistency for attempt ${attemptId}: ` +
          `missing grading entry for question ${qid}. ` +
          "Missing entries cannot be reconstructed during aggregation.",
      );
    }

    // 5. gradingMode must match canonical question semantics (NOT standardAnswer).
    const expectedMode: GradingEntryMode = isManualGradedQuestion(question)
      ? "manual"
      : "auto";
    if (entry.gradingMode !== expectedMode) {
      throw new Error(
        `Grading aggregation inconsistency for attempt ${attemptId}, ` +
          `question ${qid}: gradingMode ${entry.gradingMode} != expected ` +
          `${expectedMode} (canonical QuestionType semantics).`,
      );
    }

    // 4. maxScore must match the frozen snapshot.
    if (entry.maxScore !== question.score) {
      throw new Error(
        `Grading aggregation inconsistency for attempt ${attemptId}, ` +
          `question ${qid}: entry maxScore ${entry.maxScore} != frozen ` +
          `${question.score}.`,
      );
    }

    // 6. terminal status for this mode.
    const expectedStatus = expectedTerminalStatus(entry.gradingMode);
    if (entry.status !== expectedStatus) {
      throw new Error(
        `Grading aggregation inconsistency for attempt ${attemptId}, ` +
          `question ${qid}: status ${entry.status} is not terminal ` +
          `(expected ${expectedStatus}). Aggregation requires every entry ` +
          "to be terminal.",
      );
    }

    // 7. earnedScore present and in range.
    if (entry.earnedScore === null) {
      throw new Error(
        `Grading aggregation inconsistency for attempt ${attemptId}, ` +
          `question ${qid}: terminal entry has null earnedScore.`,
      );
    }
    if (
      !Number.isFinite(entry.earnedScore) ||
      entry.earnedScore < 0 ||
      entry.earnedScore > entry.maxScore
    ) {
      throw new Error(
        `Grading aggregation inconsistency for attempt ${attemptId}, ` +
          `question ${qid}: earnedScore ${entry.earnedScore} out of range ` +
          `[0, ${entry.maxScore}].`,
      );
    }
  }

  // 3. Extra entries (entry questionIds not in the frozen snapshot) — the
  //    count check above (1) catches the common case, but an equal count with
  //    a swapped questionId would slip through to here. Verify every entry
  //    maps back to a frozen question.
  for (const entry of entries) {
    if (!questions.some((q) => q.originalQuestionId === entry.questionId)) {
      throw new Error(
        `Grading aggregation inconsistency for attempt ${attemptId}: ` +
          `extra grading entry for question ${entry.questionId} not in ` +
          "the frozen QuestionSnapshot.",
      );
    }
  }

  // ── Projection: iterate frozen questionSnapshot order ───────────────
  const questionResults: QuestionScoreResult[] = questions.map((question) => {
    const entry = entryByQuestion.get(question.originalQuestionId)!;
    const earned = entry.earnedScore as number;
    // `correct` is materialized on the entry at submit-freeze (auto) /
    // completeManualEntry (manual = earnedScore >= maxScore). Fall back to
    // the canonical manual semantic defensively.
    const correct = entry.correct ?? earned >= entry.maxScore;
    return {
      questionId: question.originalQuestionId,
      score: earned,
      maxScore: entry.maxScore,
      correct,
      candidateAnswer: entry.candidateAnswer ?? null,
      standardAnswer: question.standardAnswer ?? null,
    };
  });

  const totalScore = questionResults.reduce((sum, r) => sum + r.score, 0);
  const maxScore = questionResults.reduce((sum, r) => sum + r.maxScore, 0);
  return {
    questionResults,
    totalScore,
    maxScore,
    passed: totalScore >= passingScore,
  };
}
