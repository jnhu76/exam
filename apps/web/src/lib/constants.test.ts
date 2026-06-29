import { describe, expect, it } from "vitest";
import i18n from "i18next";
import {
  TYPE_LABELS,
  TYPE_VARIANT,
  QUESTION_TYPE_LABEL_KEYS,
  isQuestionType,
  getTypeLabel,
  getTypeLabelKey,
  getTypeVariant,
} from "./constants";

describe("QUESTION_TYPE_LABEL_KEYS", () => {
  it("maps each question type to a questionType.* i18n key (no display copy)", () => {
    expect(QUESTION_TYPE_LABEL_KEYS.single_choice).toBe(
      "questionType.single_choice",
    );
    expect(QUESTION_TYPE_LABEL_KEYS.multiple_choice).toBe(
      "questionType.multiple_choice",
    );
    expect(QUESTION_TYPE_LABEL_KEYS.fill_blank).toBe("questionType.fill_blank");
    expect(QUESTION_TYPE_LABEL_KEYS.true_false).toBe("questionType.true_false");
  });
});

describe("TYPE_LABELS (deprecated convenience)", () => {
  it("resolves to the localized zh-CN label via the default i18n instance", () => {
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

  it("getTypeLabelKey returns the i18n key or undefined", () => {
    expect(getTypeLabelKey("single_choice")).toBe("questionType.single_choice");
    expect(getTypeLabelKey("essay")).toBeUndefined();
  });

  it("getTypeLabel resolves the localized label via the provided t", () => {
    const t = (key: string) => i18n.t(key as never);
    expect(getTypeLabel("single_choice", t)).toBe("单选");
    expect(getTypeLabel("multiple_choice", t)).toBe("多选");
    expect(getTypeLabel("fill_blank", t)).toBe("填空");
    expect(getTypeLabel("true_false", t)).toBe("判断");
  });

  it("getTypeLabel falls back to the raw i18n key when no t is provided", () => {
    expect(getTypeLabel("single_choice")).toBe("questionType.single_choice");
    expect(getTypeLabel("essay")).toBeUndefined();
  });

  it("getTypeVariant returns variant or undefined", () => {
    expect(getTypeVariant("single_choice")).toBe("default");
    expect(getTypeVariant("essay")).toBeUndefined();
  });
});
