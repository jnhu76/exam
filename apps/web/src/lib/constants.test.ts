import { describe, expect, it } from "vitest";
import {
  TYPE_LABELS,
  TYPE_VARIANT,
  isQuestionType,
  getTypeLabel,
  getTypeVariant,
} from "./constants";

describe("TYPE_LABELS", () => {
  it("contains all expected question types", () => {
    expect(TYPE_LABELS.single_choice).toBe("单选");
    expect(TYPE_LABELS.multiple_choice).toBe("多选");
    expect(TYPE_LABELS.fill_blank).toBe("填空");
    expect(TYPE_LABELS.true_false).toBe("判断");
  });
});

describe("TYPE_VARIANT", () => {
  it("maps each type to a valid badge variant", () => {
    const validVariants = ["default", "secondary", "outline"];
    for (const variant of Object.values(TYPE_VARIANT)) {
      expect(validVariants).toContain(variant);
    }
  });
});

describe("type guards and getters", () => {
  it("isQuestionType identifies valid and invalid types", () => {
    expect(isQuestionType("single_choice")).toBe(true);
    expect(isQuestionType("essay")).toBe(false);
  });

  it("getTypeLabel returns label or undefined", () => {
    expect(getTypeLabel("single_choice")).toBe("单选");
    expect(getTypeLabel("essay")).toBeUndefined();
  });

  it("getTypeVariant returns variant or undefined", () => {
    expect(getTypeVariant("single_choice")).toBe("default");
    expect(getTypeVariant("essay")).toBeUndefined();
  });
});
