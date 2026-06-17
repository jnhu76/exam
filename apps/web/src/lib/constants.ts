import type { QuestionType } from "@exam/domain";

export type { QuestionType };

/** Returns true if the given string is a known QuestionType key. */
export function isQuestionType(key: string): key is QuestionType {
  return key in TYPE_LABELS;
}

/** Returns the Chinese display label for a question type key, or undefined if unknown. */
export function getTypeLabel(key: string): string | undefined {
  return TYPE_LABELS[key];
}

/** Returns the badge variant for a question type key, or undefined if unknown. */
export function getTypeVariant(
  key: string,
): "default" | "secondary" | "outline" | undefined {
  return TYPE_VARIANT[key];
}

/** Maps question type keys to Chinese display labels. */
export const TYPE_LABELS: Record<string, string> = {
  single_choice: "单选",
  multiple_choice: "多选",
  fill_blank: "填空",
  true_false: "判断",
};

/** Maps question type keys to badge UI variant names. */
export const TYPE_VARIANT: Record<string, "default" | "secondary" | "outline"> =
  {
    single_choice: "default",
    multiple_choice: "secondary",
    fill_blank: "outline",
    true_false: "outline",
  };
