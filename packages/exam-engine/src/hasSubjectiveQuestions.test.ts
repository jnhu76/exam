import { describe, expect, it } from "vitest";
import { hasSubjectiveQuestions } from "@exam/domain";
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
    rubric: null,
    ...overrides,
  };
}

describe("hasSubjectiveQuestions", () => {
  it("returns false for an empty snapshot", () => {
    expect(hasSubjectiveQuestions([])).toBe(false);
  });

  it("returns false when every question has a standardAnswer", () => {
    expect(
      hasSubjectiveQuestions([
        makeQuestion({ originalQuestionId: "q1", standardAnswer: "a" }),
        makeQuestion({ originalQuestionId: "q2", standardAnswer: true }),
      ]),
    ).toBe(false);
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
  ])(
    "returns true when any question's standardAnswer is %s",
    (_label, value) => {
      expect(
        hasSubjectiveQuestions([
          makeQuestion({ originalQuestionId: "q1", standardAnswer: "a" }),
          makeQuestion({ originalQuestionId: "q2", standardAnswer: value }),
        ]),
      ).toBe(true);
    },
  );
});
