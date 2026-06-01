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
  }
}

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
