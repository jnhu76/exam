import type { QuestionType } from "@exam/domain";

export type { QuestionType };

export function isQuestionType(key: string): key is QuestionType {
  return key in TYPE_LABELS;
}

export function getTypeLabel(key: string): string | undefined {
  return TYPE_LABELS[key];
}

export function getTypeVariant(
  key: string,
): "default" | "secondary" | "outline" | undefined {
  return TYPE_VARIANT[key];
}

export const TYPE_LABELS: Record<string, string> = {
  single_choice: "单选",
  multiple_choice: "多选",
  fill_blank: "填空",
  true_false: "判断",
};

export const TYPE_VARIANT: Record<string, "default" | "secondary" | "outline"> =
  {
    single_choice: "default",
    multiple_choice: "secondary",
    fill_blank: "outline",
    true_false: "outline",
  };
