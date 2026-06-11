import type { ExamStatus, QuestionType } from "@exam/domain";

export type { ExamStatus, QuestionType };

export type BadgeVariant = "default" | "secondary" | "outline" | "destructive";

export function isExamStatus(key: string): key is ExamStatus {
  return key in STATUS_LABELS;
}

export function isQuestionType(key: string): key is QuestionType {
  return key in TYPE_LABELS;
}

export function getStatusLabel(key: string): string | undefined {
  return STATUS_LABELS[key];
}

export function getStatusVariant(key: string): BadgeVariant | undefined {
  return STATUS_VARIANT[key];
}

export function getTypeLabel(key: string): string | undefined {
  return TYPE_LABELS[key];
}

export function getTypeVariant(
  key: string,
): "default" | "secondary" | "outline" | undefined {
  return TYPE_VARIANT[key];
}

export const STATUS_LABELS: Record<string, string> = {
  draft: "草稿",
  published: "已发布",
  open: "进行中",
  closed: "已结束",
  archived: "已归档",
};

export const STATUS_VARIANT: Record<
  string,
  "default" | "secondary" | "outline" | "destructive"
> = {
  draft: "outline",
  published: "default",
  open: "default",
  closed: "secondary",
  archived: "outline",
};

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

export const CONNECTION_STATUS_LABELS: Record<string, string> = {
  connected: "连接正常",
  degraded: "连接不稳定",
  offline: "连接已断开",
};
