import type { SaveAnswerRejectReason } from "./attempt.js";

/** Default locale used for error and status messages. */
export const DEFAULT_LOCALE = "zh-CN" as const;

/** List of locales supported by the message registry. Currently only zh-CN. */
export const SUPPORTED_LOCALES = ["zh-CN"] as const;

/** Union type of all supported locale identifiers. */
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/**
 * Type guard that checks whether a given string is a supported locale.
 * @param locale - The locale string to check.
 * @returns `true` if the locale is in the supported locales list.
 */
export function isSupportedLocale(locale: string): locale is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(locale);
}

/**
 * Registry of all application error messages keyed by error code.
 * Each value is the user-facing Chinese (zh-CN) message for that error code.
 */
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
  EXAM_CLOSE_NOT_ALLOWED: "考试当前状态不允许关闭",
  EXAM_ARCHIVE_NOT_ALLOWED: "考试当前状态不允许归档",
  EXAM_UNPUBLISH_NOT_ALLOWED: "已开放的考试不能撤回发布",
  EXAM_EXTEND_NOT_ALLOWED: "考试当前状态不能延长",
  EXAM_UPDATE_NOT_ALLOWED: "考试当前状态不允许修改",
  EXAM_CANCEL_NOT_ALLOWED: "考试当前状态不能取消",
  EXAM_PUBLISH_RESULTS_NOT_ALLOWED: "考试当前状态不能公布成绩",
  EXAM_CANCELED_RESULTS_UNAVAILABLE: "已取消的考试不提供成绩",
  ATTEMPT_SUBMIT_TOO_EARLY: "考试开始时间过短，暂时无法交卷",
  ATTEMPT_LATE_ENTRY_CLOSED: "已超过最晚进入考试时间",
  ENROLLMENT_NOT_REMOVABLE: "已开始的报名不能移除",
  QUESTION_COURSE_MISMATCH: "题目不属于所选课程",
  MAX_ATTEMPTS_REACHED: "已达到最大考试次数",
  EXAM_ALREADY_PASSED: "本场考试已通过",
  IDEMPOTENCY_CONFLICT: "操作标识符与已有请求冲突",
  CSRF_ORIGIN_REJECTED: "请求来源不被允许",
  AUTH_REGISTER_DISABLED: "Phase 1 不支持公开注册",
  PASSWORD_RESET_TARGET_ROLE_NOT_ALLOWED: "不能重置该角色用户的密码",
  AUTHZ_UNAVAILABLE: "授权服务暂不可用，请稍后重试",
} as const;

/** Union type of all valid error message codes. */
export type ErrorCode = keyof typeof errorMessages;

/**
 * Type guard that checks whether a string is a valid error code.
 * @param code - The string to check.
 * @returns `true` if the code exists in the errorMessages registry.
 */
export function isErrorCode(code: string): code is ErrorCode {
  return Object.hasOwn(errorMessages, code);
}

/**
 * Fallback messages used when no locale-specific message is found for a given code.
 */
export const fallbackMessages = {
  unknownError: "未知错误",
  operationFailed: "操作失败，请重试",
} as const;

const localeCatalogs: Record<SupportedLocale, typeof errorMessages> = {
  "zh-CN": errorMessages,
};

/**
 * Returns the error message string for the given error code in the default locale.
 * @param code - A valid error code from the errorMessages registry.
 * @returns The localized error message string.
 */
export function getErrorMessage(code: ErrorCode): string {
  return errorMessages[code];
}

/**
 * Returns the error message for a given code and locale, falling back to the
 * default locale and then to the unknown error message if the code is unrecognized.
 * @param code - The error code to look up.
 * @param locale - The locale to use (defaults to zh-CN).
 * @returns The localized error message string.
 */
export function getMessageForLocale(
  code: string,
  locale: SupportedLocale = DEFAULT_LOCALE,
): string {
  const catalog = isSupportedLocale(locale)
    ? localeCatalogs[locale]
    : localeCatalogs[DEFAULT_LOCALE];
  const message = (catalog as Record<string, string>)[code];
  return message ?? fallbackMessages.unknownError;
}

/**
 * Validation messages for candidate identity fields.
 * Includes a static configuration message and per-field label functions.
 */
export const candidateFieldValidationMessages = {
  configurationInvalid: "身份字段配置无效",
  required: (label: string) => `${label}为必填项`,
  numberRequired: (label: string) => `${label}必须为数字`,
  textRequired: (label: string) => `${label}必须为文本`,
};

/**
 * User-facing messages for each save-answer rejection reason.
 */
export const saveAnswerMessages: Record<SaveAnswerRejectReason, string> = {
  STALE_VERSION: "服务器上存在更新的答案版本",
  ATTEMPT_ALREADY_SUBMITTED: "考试已提交，不能继续保存答案",
  ATTEMPT_CLOSED: "考试已结束",
  DEADLINE_EXCEEDED: "考试时间已到",
  CONFLICTING_PAYLOAD: "答案数据冲突，请刷新页面后重试",
};

/**
 * Returns the user-facing message for a given save-answer rejection reason.
 * @param reason - The rejection reason from the save-answer protocol.
 * @returns The corresponding error message string.
 */
export function getSaveAnswerMessage(reason: SaveAnswerRejectReason): string {
  return saveAnswerMessages[reason];
}
