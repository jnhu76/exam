import { describe, expect, it } from "vitest";
import { gradeAnswers, gradeQuestion } from "../gradingEngine.js";
import type { AnswerRecord, QuestionSnapshot } from "../types.js";

function makeQuestion(overrides: Partial<QuestionSnapshot>): QuestionSnapshot {
  return {
    originalQuestionId: "q1",
    type: "single_choice",
    content: "Question",
    attachments: [],
    options: [],
    standardAnswer: "a",
    score: 10,
    gradingRule: {
      multiSelectScoring: "all_correct_full",
      fillBlankMatchMode: "exact",
    },
    order: 0,
    ...overrides,
  };
}

function answer(
  questionId: string,
  answer: unknown,
  version = 1,
): AnswerRecord {
  return {
    questionId,
    answer,
    version,
    savedAt: new Date("2026-06-01T00:00:00Z"),
  };
}

// P2D-J1 regression coverage for the multi-question aggregation path in
// gradeAnswers. The per-question dispatch is covered by exam-engine's
// gradingEngine.test.ts; here we assert how scores combine into totalScore,
// how unanswered questions are treated, the passingScore boundary, and that
// gradedAt is echoed unchanged (server time authority).

describe("gradeAnswers — aggregation", () => {
  const gradedAt = new Date("2026-06-01T12:00:00Z");

  // One correct answer per objective question type, each worth 10 points.
  const allTypesCorrect: {
    question: QuestionSnapshot;
    answer: AnswerRecord;
  }[] = [
    {
      question: makeQuestion({
        originalQuestionId: "sc",
        type: "single_choice",
        standardAnswer: "a",
      }),
      answer: answer("sc", "a"),
    },
    {
      question: makeQuestion({
        originalQuestionId: "tf",
        type: "true_false",
        standardAnswer: true,
      }),
      answer: answer("tf", true),
    },
    {
      question: makeQuestion({
        originalQuestionId: "mc",
        type: "multiple_choice",
        standardAnswer: ["a", "b"],
        gradingRule: {
          multiSelectScoring: "partial_half",
          fillBlankMatchMode: "exact",
        },
      }),
      answer: answer("mc", ["a", "b"]),
    },
    {
      question: makeQuestion({
        originalQuestionId: "fb",
        type: "fill_blank",
        standardAnswer: "atom",
      }),
      answer: answer("fb", "atom"),
    },
  ];

  it("sums per-question scores across all objective types into totalScore", () => {
    const questions = allTypesCorrect.map((row) => row.question);
    const answers = allTypesCorrect.map((row) => row.answer);

    const result = gradeAnswers("attempt-1", questions, answers, 40, gradedAt);

    expect(result.attemptId).toBe("attempt-1");
    expect(result.totalScore).toBe(40);
    expect(result.passed).toBe(true);
    expect(result.questionResults).toHaveLength(4);
    expect(result.questionResults.every((qr) => qr.correct)).toBe(true);
  });

  it("scores an unanswered question as 0 (no AnswerRecord for that questionId)", () => {
    // Drop the single_choice answer: its question stays in the snapshot but
    // has no matching record, so it must contribute 0 to the total.
    const questions = allTypesCorrect.map((row) => row.question);
    const answers = allTypesCorrect
      .filter((row) => row.question.type !== "single_choice")
      .map((row) => row.answer);

    const result = gradeAnswers("attempt-1", questions, answers, 40, gradedAt);

    expect(result.totalScore).toBe(30);
    const unanswered = result.questionResults.find(
      (qr) => qr.questionId === "sc",
    );
    expect(unanswered?.score).toBe(0);
    expect(unanswered?.correct).toBe(false);
    expect(unanswered?.candidateAnswer).toBeUndefined();
  });

  it("passes when totalScore exactly equals passingScore (boundary)", () => {
    const questions = allTypesCorrect.map((row) => row.question);
    const answers = allTypesCorrect.map((row) => row.answer);

    const atBoundary = gradeAnswers(
      "attempt-1",
      questions,
      answers,
      40,
      gradedAt,
    );
    expect(atBoundary.totalScore).toBe(40);
    expect(atBoundary.passed).toBe(true);

    const oneAbove = gradeAnswers(
      "attempt-1",
      questions,
      answers,
      41,
      gradedAt,
    );
    expect(oneAbove.passed).toBe(false);
  });

  it("echoes the server-authoritative gradedAt timestamp unchanged", () => {
    const questions = allTypesCorrect.map((row) => row.question);
    const answers = allTypesCorrect.map((row) => row.answer);

    const result = gradeAnswers("attempt-1", questions, answers, 40, gradedAt);

    expect(result.gradedAt).toBe(gradedAt);
  });

  it("uses question.originalQuestionId to join with AnswerRecord.questionId", () => {
    // Guards the join key: answer keyed by originalQuestionId, not by any
    // snapshot-local id. A right answer keyed correctly scores full.
    const question = makeQuestion({
      originalQuestionId: "q-join",
      type: "single_choice",
      standardAnswer: "a",
      score: 10,
    });

    const result = gradeAnswers(
      "attempt-1",
      [question],
      [answer("q-join", "a")],
      0,
      gradedAt,
    );

    expect(result.totalScore).toBe(10);
    expect(result.questionResults[0]?.correct).toBe(true);
  });
});

// Sanity cross-check that gradeQuestion (covered in depth by exam-engine) is
// the unit gradeAnswers delegates to. Kept minimal here to avoid duplicating
// exam-engine coverage.

describe("gradeAnswers — delegates per-question grading", () => {
  it("returns a QuestionScoreResult per snapshot question in order", () => {
    const q = makeQuestion({
      originalQuestionId: "q1",
      type: "single_choice",
      standardAnswer: "a",
    });
    const result = gradeAnswers("att", [q], [answer("q1", "a")], 0, new Date());
    expect(result.questionResults).toEqual([gradeQuestion(q, "a")]);
  });
});
