import { describe, expect, it } from "vitest";
import { gradeQuestion } from "@exam/domain";
import type { QuestionSnapshot } from "@exam/domain";

function makeQuestion(
  overrides: Partial<QuestionSnapshot> = {},
): QuestionSnapshot {
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

describe("gradeQuestion", () => {
  it.each([
    ["single_choice", "a", "a", 10],
    ["single_choice", "b", "a", 0],
    ["single_choice", undefined, "a", 0],
    ["true_false", true, true, 10],
    ["true_false", false, true, 0],
    ["true_false", undefined, true, 0],
  ] as const)(
    "grades %s answers precisely",
    (type, candidateAnswer, standardAnswer, expectedScore) => {
      const result = gradeQuestion(
        makeQuestion({ type, standardAnswer }),
        candidateAnswer,
      );

      expect(result.score).toBe(expectedScore);
      expect(result.correct).toBe(expectedScore === 10);
    },
  );

  it.each([
    [["a", "b"], ["b", "a"], "partial_half", 10],
    [["a"], ["a", "b"], "partial_half", 5],
    [["a", "c"], ["a", "b"], "partial_half", 0],
    [[], ["a", "b"], "partial_half", 0],
    [["c"], ["a", "b"], "partial_half", 0],
    [["a"], ["a", "b"], "all_correct_full", 0],
  ] as const)(
    "grades multiple choice candidate=%j standard=%j strategy=%s",
    (candidateAnswer, standardAnswer, multiSelectScoring, expectedScore) => {
      const result = gradeQuestion(
        makeQuestion({
          type: "multiple_choice",
          standardAnswer,
          gradingRule: {
            multiSelectScoring,
            fillBlankMatchMode: "exact",
          },
        }),
        candidateAnswer,
      );

      expect(result.score).toBe(expectedScore);
    },
  );

  it.each([
    [" atom ", "atom", "exact", 10],
    ["ATOM", "atom", "exact", 10],
    ["atom", "原子|atom", "exact", 10],
    ["the atom model", "atom", "keyword", 10],
    ["molecule", "atom", "keyword", 0],
  ] as const)(
    "grades fill blank candidate=%s standard=%s mode=%s",
    (candidateAnswer, standardAnswer, fillBlankMatchMode, expectedScore) => {
      const result = gradeQuestion(
        makeQuestion({
          type: "fill_blank",
          standardAnswer,
          gradingRule: {
            multiSelectScoring: "all_correct_full",
            fillBlankMatchMode,
          },
        }),
        candidateAnswer,
      );

      expect(result.score).toBe(expectedScore);
    },
  );

  it("grades every blank in a fill blank record", () => {
    const result = gradeQuestion(
      makeQuestion({
        type: "fill_blank",
        standardAnswer: { blank1: "atom", blank2: "electron|电子" },
      }),
      { blank1: " ATOM ", blank2: "电子" },
    );

    expect(result.score).toBe(10);
  });

  it("supports case-sensitive fill blank matching when configured", () => {
    const result = gradeQuestion(
      makeQuestion({
        type: "fill_blank",
        standardAnswer: "Atom",
        gradingRule: {
          multiSelectScoring: "all_correct_full",
          fillBlankMatchMode: "exact",
          fillBlankCaseSensitive: true,
        },
      }),
      "atom",
    );

    expect(result.score).toBe(0);
  });
});
