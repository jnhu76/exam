import type { QuestionType } from "@exam/domain";
import i18n from "i18next";

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
};

/** Minimal translation function shape (mirrors statusMeta.StatusTranslateFn). */
export type QuestionTypeTranslateFn = (key: string) => string;

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
  };

/**
 * @deprecated Convenience map resolving each question type to its current
 * localized label via the default i18n instance. Kept for the few legacy
 * call sites that still read `TYPE_LABELS[key]` directly; new code should
 * render via `t(getTypeLabelKey(key))` (or `getTypeLabel(key, t)`) so the
 * label is resolved by the caller's own `useTranslation()` scope. No
 * hardcoded copy lives here — the values come from `questionType.*` keys.
 * Typed as `Record<string, string>` (not `Record<QuestionType, ...>`) so the
 * legacy `TYPE_LABELS[q.type]` lookup with a runtime `string` stays valid.
 */
export const TYPE_LABELS: Record<string, string> = Object.fromEntries(
  (Object.keys(QUESTION_TYPE_LABEL_KEYS) as QuestionType[]).map((key) => [
    key,
    i18n.t(QUESTION_TYPE_LABEL_KEYS[key] as never),
  ]),
);
