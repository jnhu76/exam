import type { QuestionType } from "@exam/domain";

export type { QuestionType };

/**
 * Maps question type keys to their i18n label key under the `questionType`
 * namespace (see `locales/zh-CN.ts`). `constants` stores NO display copy —
 * labels are resolved at render time via `t(QUESTION_TYPE_LABEL_KEYS[key])`,
 * mirroring the `statusMeta.labelKey` pattern.
 */
export const QUESTION_TYPE_LABEL_KEYS: Record<QuestionType, string> = {
  single_choice: "questionType.single_choice",
  multiple_choice: "questionType.multiple_choice",
  fill_blank: "questionType.fill_blank",
  true_false: "questionType.true_false",
  // P3-L0-1: text_response is registered so the type map stays exhaustive.
  // The TakeExam runtime branch (textarea rendering) is P3-MOD-P0-2.
  text_response: "questionType.text_response",
};

/** Minimal translation function shape — accepts i18next's TFunction. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type QuestionTypeTranslateFn = (...args: any[]) => string;

/** Returns true if the given string is a known QuestionType key. */
export function isQuestionType(key: string): key is QuestionType {
  return key in QUESTION_TYPE_LABEL_KEYS;
}

/**
 * Returns the i18n label key for a question type, or undefined if unknown.
 * Render with `t(getTypeLabelKey(key))`.
 */
export function getTypeLabelKey(key: string): string | undefined {
  return QUESTION_TYPE_LABEL_KEYS[key as QuestionType];
}

/**
 * Resolves the localized display label for a question type via the provided
 * `t` function. Falls back to the raw key when `t` is not provided
 * (non-i18n contexts / unit tests asserting tone/icon only).
 */
export function getTypeLabel(
  key: string,
  t?: QuestionTypeTranslateFn,
): string | undefined {
  const labelKey = getTypeLabelKey(key);
  if (!labelKey) return undefined;
  return t ? t(labelKey) : labelKey;
}

/** Returns the badge variant for a question type key, or undefined if unknown. */
export function getTypeVariant(
  key: string,
): "default" | "secondary" | "outline" | undefined {
  return TYPE_VARIANT[key];
}

/** Maps question type keys to badge UI variant names. */
export const TYPE_VARIANT: Record<string, "default" | "secondary" | "outline"> =
  {
    single_choice: "default",
    multiple_choice: "secondary",
    fill_blank: "outline",
    true_false: "outline",
    // P3-MOD-P2-1C: text_response gets an explicit variant so it never
    // silently falls back to default; secondary keeps it visually neutral.
    text_response: "secondary",
  };
