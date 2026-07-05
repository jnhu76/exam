import type {
  AnswerRecord,
  QuestionScoreResult,
  QuestionSnapshot,
  ScoreResult,
} from "./types.js";

function makeResult(
  question: QuestionSnapshot,
  candidateAnswer: unknown,
  score: number,
): QuestionScoreResult {
  return {
    questionId: question.originalQuestionId,
    score,
    maxScore: question.score,
    correct: score === question.score,
    candidateAnswer,
    standardAnswer: question.standardAnswer,
  };
}

function gradePrecise(
  question: QuestionSnapshot,
  candidateAnswer: unknown,
): QuestionScoreResult {
  const score =
    candidateAnswer !== undefined &&
    candidateAnswer !== null &&
    candidateAnswer === question.standardAnswer
      ? question.score
      : 0;
  return makeResult(question, candidateAnswer, score);
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function gradeMultipleChoice(
  question: QuestionSnapshot,
  candidateAnswer: unknown,
): QuestionScoreResult {
  const candidate = [...new Set(toStringArray(candidateAnswer))].sort();
  const standard = [...new Set(toStringArray(question.standardAnswer))].sort();
  const hasWrongSelection = candidate.some(
    (answer) => !standard.includes(answer),
  );
  const isComplete =
    standard.length > 0 &&
    candidate.length === standard.length &&
    candidate.every((answer, index) => answer === standard[index]);
  const isPartial =
    candidate.length > 0 &&
    candidate.length < standard.length &&
    !hasWrongSelection;

  const score = isComplete
    ? question.score
    : isPartial && question.gradingRule.multiSelectScoring === "partial_half"
      ? question.score / 2
      : 0;
  return makeResult(question, candidateAnswer, score);
}

function normalizeBlank(value: string, caseSensitive: boolean): string {
  const trimmed = value.trim();
  return caseSensitive ? trimmed : trimmed.toLocaleLowerCase();
}

function matchesBlank(
  candidate: unknown,
  standard: unknown,
  question: QuestionSnapshot,
): boolean {
  if (typeof candidate !== "string" || typeof standard !== "string") {
    return false;
  }
  const caseSensitive = question.gradingRule.fillBlankCaseSensitive ?? false;
  const normalizedCandidate = normalizeBlank(candidate, caseSensitive);
  return standard.split("|").some((accepted) => {
    const normalizedAccepted = normalizeBlank(accepted, caseSensitive);
    if (normalizedAccepted.length === 0) return false;
    return question.gradingRule.fillBlankMatchMode === "keyword"
      ? normalizedCandidate.includes(normalizedAccepted)
      : normalizedCandidate === normalizedAccepted;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function gradeFillBlank(
  question: QuestionSnapshot,
  candidateAnswer: unknown,
): QuestionScoreResult {
  const standard = question.standardAnswer;
  let correct = false;

  if (isRecord(standard) && isRecord(candidateAnswer)) {
    const entries = Object.entries(standard);
    correct =
      entries.length > 0 &&
      entries.every(([key, answer]) =>
        matchesBlank(candidateAnswer[key], answer, question),
      );
  } else {
    correct = matchesBlank(candidateAnswer, standard, question);
  }

  return makeResult(question, candidateAnswer, correct ? question.score : 0);
}

/**
 * Grade a single question against a candidate's answer.
 *
 * Dispatches to the appropriate grading strategy based on question type:
 * - `single_choice` / `true_false`: exact value match.
 * - `multiple_choice`: set comparison with configurable partial scoring.
 * - `fill_blank`: string matching with exact or keyword mode.
 * - `text_response`: NOT auto-graded here. Returns a zero-score placeholder;
 *   manual scoring in {@link manualGrading} owns the real score. Including
 *   the case keeps the switch exhaustive as QuestionType widens.
 *
 * @returns A {@link QuestionScoreResult} with the awarded score and correctness flag.
 */
export function gradeQuestion(
  question: QuestionSnapshot,
  candidateAnswer: unknown,
): QuestionScoreResult {
  switch (question.type) {
    case "single_choice":
    case "true_false":
      return gradePrecise(question, candidateAnswer);
    case "multiple_choice":
      return gradeMultipleChoice(question, candidateAnswer);
    case "fill_blank":
      return gradeFillBlank(question, candidateAnswer);
    case "text_response":
      // Manual-graded: the auto-grading engine does not score this type.
      // The zero-score placeholder is overwritten by manualGrading on
      // score entry; makeResult sets correct=false (0 !== maxScore), which
      // is acceptable because correctness is not meaningful for manual types.
      return makeResult(question, candidateAnswer, 0);
  }
}

/**
 * Returns true when any question in the snapshot has no standard answer and
 * therefore requires manual scoring (P2D-J3 subjective-question detection).
 *
 * `QuestionSnapshot.standardAnswer` is typed `unknown`; a missing/null value
 * signals a subjective question. Empty snapshots return false.
 *
 * @param questions - The attempt's question snapshot.
 */
export function hasSubjectiveQuestions(questions: QuestionSnapshot[]): boolean {
  return questions.some((q) => q.standardAnswer == null);
}

/**
 * Returns true when any question in the snapshot requires manual grading.
 *
 * P3-L0-2C authoritative classification seam (exam-protocol.md §1.1, §1.4):
 * `text_response` is the canonical manual-graded QuestionType —
 * `gradingMode = manual` is derived from `QuestionType`, NOT from
 * `standardAnswer`. The protocol explicitly states
 * "`standardAnswer == null` 不再作为主观性判断依据".
 *
 * This is the single place that decides whether an attempt holds at
 * `submitted + pending_manual` after the submit/freeze barrier. Every
 * downstream grading orchestration consumes the resulting `gradingStatus`
 * instead of independently rescanning question types.
 *
 * Note: today this coincides with `hasSubjectiveQuestions` because
 * text_response carries a null standardAnswer. They are kept distinct so a
 * future subjective type (or a non-text_response null standardAnswer) does
 * not silently change lifecycle behavior.
 *
 * @param questions - The attempt's question snapshot.
 */
export function requiresManualGrading(questions: QuestionSnapshot[]): boolean {
  return questions.some((q) => q.type === "text_response");
}

/**
 * Grade all questions in an attempt and compute the total score.
 *
 * Matches answers to questions by `questionId`, grades each, sums the
 * scores, and determines pass/fail against `passingScore`.
 *
 * @param attemptId - The attempt being graded.
 * @param questions - The question snapshots for the attempt.
 * @param answers - The candidate's saved answer records.
 * @param passingScore - Minimum total score to pass.
 * @param gradedAt - Timestamp of grading (server authority).
 * @returns A {@link ScoreResult} with per-question results and the pass/fail flag.
 */
export function gradeAnswers(
  attemptId: string,
  questions: QuestionSnapshot[],
  answers: AnswerRecord[],
  passingScore: number,
  gradedAt: Date,
): ScoreResult {
  const answerMap = new Map(
    answers.map((answer) => [answer.questionId, answer]),
  );
  const questionResults = questions.map((question) =>
    gradeQuestion(question, answerMap.get(question.originalQuestionId)?.answer),
  );
  const totalScore = questionResults.reduce(
    (sum, question) => sum + question.score,
    0,
  );
  return {
    attemptId,
    totalScore,
    passed: totalScore >= passingScore,
    questionResults,
    gradedAt,
  };
}
