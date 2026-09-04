import i18n from "@/i18n";
import { isErrorCode, type ErrorCode } from "@exam/contracts";
import { ApiError } from "./api";
import type zhCN from "@/i18n/locales/zh-CN";

/**
 * i18n key for the generic "operation failed" fallback used across the API
 * error layer. Kept as a shared constant so callers (api.ts, toast helpers)
 * reference the same key instead of hardcoding the Chinese string.
 */
export const API_ERROR_FALLBACK_KEY = "errors.unknown";

/**
 * Translate function accepted by the API error resolver. Both the global
 * `i18n.t` and the react-i18next `useTranslation().t` satisfy it.
 */
export type ApiErrorTranslateFn = typeof i18n.t;

/**
 * Web-owned i18n key suffixes for known ErrorCodes (message contract D0.11
 * Zone A): the active Web i18n instance is the presentation authority for
 * browser-visible known semantics; the server registry is NOT consulted.
 *
 * The catalog covers every registry code: all of them have first-party
 * browser-reachable producers (audited against apps/api + packages/domain),
 * so this is the Zone A authority catalog, not a mirror of unused entries.
 * Codes added to the server registry later resolve through the unknown-code
 * fallback chain until mapped here — forward compatible by design.
 */
const ERROR_CODE_KEYS: Record<ErrorCode, keyof typeof zhCN.errors.codes> = {
  AUTH_REQUIRED: "authRequired",
  AUTH_INVALID_CREDENTIALS: "authInvalidCredentials",
  PERMISSION_DENIED: "permissionDenied",
  VALIDATION_ERROR: "validationError",
  RESOURCE_NOT_FOUND: "resourceNotFound",
  RESOURCE_CONFLICT: "resourceConflict",
  INVALID_CURSOR: "invalidCursor",
  EXPORT_EXCEEDS_LIMIT: "exportExceedsLimit",
  RATE_LIMITED: "rateLimited",
  INTERNAL_ERROR: "internalError",
  CURRENT_PASSWORD_INVALID: "currentPasswordInvalid",
  USER_ALREADY_EXISTS: "userAlreadyExists",
  ADMIN_ALREADY_EXISTS: "adminAlreadyExists",
  CANDIDATE_IDENTITY_CONFLICT: "candidateIdentityConflict",
  CANDIDATE_FIELD_IN_USE: "candidateFieldInUse",
  CANDIDATE_IDENTITY_FIELD_CONFLICT: "candidateIdentityFieldConflict",
  INVALID_STATE_TRANSITION: "invalidStateTransition",
  ATTEMPT_ALREADY_STARTED: "attemptAlreadyStarted",
  ATTEMPT_CLOSED: "attemptClosed",
  ANSWER_VERSION_CONFLICT: "answerVersionConflict",
  OPS_POLICY_VERSION_CONFLICT: "opsPolicyVersionConflict",
  EXAM_NOT_OPEN: "examNotOpen",
  ATTEMPT_DEADLINE_EXCEEDED: "attemptDeadlineExceeded",
  DEADLINE_EXCEEDS_EXAM_CLOSE: "deadlineExceedsExamClose",
  EXAM_ALREADY_PUBLISHED: "examAlreadyPublished",
  EXAM_NOT_DRAFT: "examNotDraft",
  EXAM_CLOSE_NOT_ALLOWED: "examCloseNotAllowed",
  EXAM_ARCHIVE_NOT_ALLOWED: "examArchiveNotAllowed",
  EXAM_UNPUBLISH_NOT_ALLOWED: "examUnpublishNotAllowed",
  EXAM_EXTEND_NOT_ALLOWED: "examExtendNotAllowed",
  EXAM_UPDATE_NOT_ALLOWED: "examUpdateNotAllowed",
  EXAM_CANCEL_NOT_ALLOWED: "examCancelNotAllowed",
  EXAM_PUBLISH_RESULTS_NOT_ALLOWED: "examPublishResultsNotAllowed",
  EXAM_CANCELED_RESULTS_UNAVAILABLE: "examCanceledResultsUnavailable",
  ATTEMPT_SUBMIT_TOO_EARLY: "attemptSubmitTooEarly",
  ATTEMPT_LATE_ENTRY_CLOSED: "attemptLateEntryClosed",
  ATTEMPT_START_SUBMIT_INFEASIBLE: "attemptStartSubmitInfeasible",
  ENROLLMENT_NOT_REMOVABLE: "enrollmentNotRemovable",
  QUESTION_COURSE_MISMATCH: "questionCourseMismatch",
  MAX_ATTEMPTS_REACHED: "maxAttemptsReached",
  EXAM_ALREADY_PASSED: "examAlreadyPassed",
  IDEMPOTENCY_CONFLICT: "idempotencyConflict",
  INCIDENT_VERSION_CONFLICT: "incidentVersionConflict",
  INCIDENT_ACTION_ALREADY_LINKED: "incidentActionAlreadyLinked",
  CSRF_ORIGIN_REJECTED: "csrfOriginRejected",
  AUTH_REGISTER_DISABLED: "authRegisterDisabled",
  LAUNCHPAD_ALREADY_INITIALIZED: "launchpadAlreadyInitialized",
  LAUNCHPAD_INVALID_SETUP_TOKEN: "launchpadInvalidSetupToken",
  PASSWORD_RESET_TARGET_ROLE_NOT_ALLOWED: "passwordResetTargetRoleNotAllowed",
  INVITATION_INVALID: "invitationInvalid",
  PASSWORD_RESET_INVALID: "passwordResetInvalid",
  AUTHZ_UNAVAILABLE: "authzUnavailable",
  RATE_LIMIT_UNAVAILABLE: "rateLimitUnavailable",
};

/**
 * (ErrorCode, details.reason) → Web i18n key suffix. Scoped per code: a
 * reason lives inside its code's namespace (D0.2), so a reason is only
 * consulted when the pair is known. Unknown reasons (and deliberately
 * unmapped ones) fall through to the code-level presentation (D0.10).
 */
const ERROR_REASON_KEYS: Partial<
  Record<ErrorCode, Record<string, keyof typeof zhCN.errors.reasons>>
> = {
  RESOURCE_CONFLICT: {
    COURSE_CODE_EXISTS: "courseCodeExists",
    COURSE_HAS_QUESTIONS: "courseHasQuestions",
    EXAM_PROFILE_NAME_EXISTS: "examProfileNameExists",
    EXAM_NOT_FINISHED: "examNotFinished",
    UNRESOLVED_ATTEMPTS_EXIST: "unresolvedAttemptsExist",
  },
  VALIDATION_ERROR: {
    CANNOT_DISABLE_SELF: "cannotDisableSelf",
    TARGET_USER_INACTIVE: "targetUserInactive",
    TARGET_NOT_TEACHER: "targetNotTeacher",
    TARGET_NOT_GRADER: "targetNotGrader",
    ADMIN_MAINTAINER_EXCLUSION: "adminMaintainerExclusion",
  },
};

/** Returns true if value is a plain object (Record). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Extracts the wire `details.reason` string from an API error's details. */
function readReason(details: unknown): string | undefined {
  if (!isRecord(details)) return undefined;
  const reason = details.reason;
  return typeof reason === "string" && reason ? reason : undefined;
}

/** Extracts the wire `details.params` interpolation values from details. */
function readParams(
  details: unknown,
): Record<string, string | number> | undefined {
  if (!isRecord(details) || !isRecord(details.params)) return undefined;
  const params: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(details.params)) {
    if (typeof value === "string" || typeof value === "number") {
      params[key] = value;
    }
  }
  return Object.keys(params).length > 0 ? params : undefined;
}

/**
 * Resolves the user-facing presentation for an error thrown by the API layer
 * (message contract D0.10/D0.11 Zone A). Resolution priority:
 *
 * 1. known (ErrorCode, reason) pair  → `errors.reasons.*`
 * 2. known ErrorCode                 → `errors.codes.*`
 * 3. unknown/known-but-unmapped code → server compatibility message
 * 4. otherwise                       → localized generic fallback
 *
 * Non-ApiError values never surface raw diagnostic prose to users — they
 * resolve straight to the fallback (api.ts wraps transport failures into
 * ApiError; any remaining Error is a web-runtime defect, not user copy).
 */
export function getApiErrorMessage(
  error: unknown,
  t: ApiErrorTranslateFn,
  fallback?: string,
): string {
  if (!(error instanceof ApiError)) {
    return fallback ?? t(API_ERROR_FALLBACK_KEY);
  }
  if (error.code && isErrorCode(error.code)) {
    const reasonKey =
      ERROR_REASON_KEYS[error.code]?.[readReason(error.details) ?? ""];
    if (reasonKey) {
      // i18next's resource-typed t() demands the exact interpolation params
      // of the concrete key; the resolver resolves (key, params) at runtime
      // from the wire shape (D0.4), which readParams validates — the same
      // dynamic-key escape the recovery pages use for t(dynamicKey).
      return t(
        `errors.reasons.${reasonKey}`,
        readParams(error.details) as never,
      ) as unknown as string;
    }
    const codeKey = ERROR_CODE_KEYS[error.code];
    if (codeKey) {
      return t(`errors.codes.${codeKey}`);
    }
  }
  if (error.serverMessage) {
    return error.serverMessage;
  }
  return fallback ?? t(API_ERROR_FALLBACK_KEY);
}

/** Shape of a single field-level validation error detail from the API (message contract D0.7). */
export interface ApiFieldErrorDetail {
  field: string;
  code?: string;
  params?: Record<string, string | number>;
  message: string;
}

/**
 * i18n namespace for wire field-violation codes (message contract D0.7,
 * C2 slice). Keyed by the machine field `code`, so first-party field
 * semantics never depend on server compatibility wording. The vocabulary
 * is open: codes without a catalog entry take the fallback chain in
 * {@link resolveFieldError}.
 */
const FIELD_ERROR_KEY_PREFIX = "validation.field.";

/** Returns true if value matches the ApiFieldErrorDetail shape. */
function isValidationFieldDetail(value: unknown): value is ApiFieldErrorDetail {
  if (!isRecord(value)) return false;
  return typeof value.field === "string" && typeof value.message === "string";
}

/**
 * Resolves one field violation to display text (message contract D0.7/D0.10):
 * known field code → localized semantic from `code + params`; unknown code →
 * the required server compatibility `message` (non-authoritative display
 * fallback); generic localized fallback when neither is usable. Known codes
 * never consult the compatibility message, so server wording changes cannot
 * alter first-party field semantics.
 */
export function resolveFieldError(detail: ApiFieldErrorDetail): string {
  if (detail.code && i18n.exists(`${FIELD_ERROR_KEY_PREFIX}${detail.code}`)) {
    const params: Record<string, string | number> = { ...detail.params };
    const resource = params.resource;
    if (
      typeof resource === "string" &&
      i18n.exists(`${FIELD_ERROR_KEY_PREFIX}resources.${resource}`)
    ) {
      params.resource = i18n.t(
        `${FIELD_ERROR_KEY_PREFIX}resources.${resource}` as never,
      );
    }
    return i18n.t(`${FIELD_ERROR_KEY_PREFIX}${detail.code}` as never, params);
  }
  return detail.message || i18n.t(`${FIELD_ERROR_KEY_PREFIX}fallback` as never);
}

/** Extracts per-field validation errors from an API error's details object,
 * resolving each to localized display text via its machine code/params. */
export function getApiFieldErrors(error: unknown): Record<string, string> {
  if (!isRecord(error) || !isRecord(error.details)) return {};
  const fields = error.details.fields;
  if (!Array.isArray(fields)) return {};
  return Object.fromEntries(
    fields
      .filter(isValidationFieldDetail)
      .map((detail) => [detail.field, resolveFieldError(detail)]),
  );
}
