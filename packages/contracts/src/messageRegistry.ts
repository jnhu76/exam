import type { SaveAnswerRejectReason } from "./attempt.js";

export const errorMessages = {
  AUTH_REQUIRED: "请先登录",
  AUTH_INVALID_CREDENTIALS: "用户名或密码错误",
  PERMISSION_DENIED: "无权执行此操作",
  VALIDATION_ERROR: "请求参数无效",
  RESOURCE_NOT_FOUND: "资源不存在",
  RESOURCE_CONFLICT: "资源状态冲突",
  RATE_LIMITED: "请求过于频繁，请稍后重试",
  INTERNAL_ERROR: "服务器内部错误",
  CURRENT_PASSWORD_INVALID: "当前密码不正确",
  USER_ALREADY_EXISTS: "用户名已存在",
  CANDIDATE_IDENTITY_CONFLICT: "身份信息已存在",
  CANDIDATE_FIELD_IN_USE: "该身份字段正在使用，无法删除",
  CANDIDATE_IDENTITY_FIELD_CONFLICT: "只能设置一个唯一身份字段",
  INVALID_STATE_TRANSITION: "当前状态不允许执行此操作",
  ATTEMPT_ALREADY_STARTED: "考试尝试已开始",
  ATTEMPT_CLOSED: "考试已结束",
  ANSWER_VERSION_CONFLICT: "答案版本冲突",
  EXAM_NOT_OPEN: "考试尚未开放",
  ATTEMPT_DEADLINE_EXCEEDED: "考试时间已到",
  EXAM_ALREADY_PUBLISHED: "考试已发布，不能重复发布",
  EXAM_NOT_DRAFT: "仅草稿状态的考试允许此操作",
  ENROLLMENT_NOT_REMOVABLE: "已开始的报名不能移除",
  QUESTION_COURSE_MISMATCH: "题目不属于所选课程",
  MAX_ATTEMPTS_REACHED: "已达到最大考试次数",
  EXAM_ALREADY_PASSED: "本场考试已通过",
  CSRF_ORIGIN_REJECTED: "请求来源不被允许",
} as const;

export type ErrorCode = keyof typeof errorMessages;

export function isErrorCode(code: string): code is ErrorCode {
  return Object.hasOwn(errorMessages, code);
}

export function getErrorMessage(code: ErrorCode): string {
  return errorMessages[code];
}

export const candidateFieldValidationMessages = {
  configurationInvalid: "身份字段配置无效",
  required: (label: string) => `${label}为必填项`,
  numberRequired: (label: string) => `${label}必须为数字`,
  textRequired: (label: string) => `${label}必须为文本`,
};

export const saveAnswerMessages: Record<SaveAnswerRejectReason, string> = {
  STALE_VERSION: "服务器上存在更新的答案版本",
  ATTEMPT_ALREADY_SUBMITTED: "考试已提交，不能继续保存答案",
  ATTEMPT_CLOSED: "考试已结束",
  DEADLINE_EXCEEDED: "考试时间已到",
};

export function getSaveAnswerMessage(reason: SaveAnswerRejectReason): string {
  return saveAnswerMessages[reason];
}
