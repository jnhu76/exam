import { describe, it, expect } from "vitest";
import { QuestionType } from "../enums";

describe("QuestionType — text_response 扩展 (P3-L0-1)", () => {
  it("题型集合为 5 个封闭值（single/multiple/true_false/fill_blank/text_response）", () => {
    const values = Object.values(QuestionType);
    expect(values).toEqual([
      "single_choice",
      "multiple_choice",
      "fill_blank",
      "true_false",
      "text_response",
    ]);
  });
});
