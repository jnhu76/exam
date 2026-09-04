import {
  getErrorMessage,
  isErrorCode,
  type ErrorCode,
  type ErrorResponse,
  type ValidationErrorDetails,
} from "@exam/contracts";
import type { ZodError, ZodIssue } from "zod";

/** Legacy string error codes mapped to the current {@link ErrorCode} domain values. */
const legacyCodeMap: Readonly<Record<string, ErrorCode>> = {
  UNAUTHORIZED: "AUTH_REQUIRED",
  INVALID_CREDENTIALS: "AUTH_INVALID_CREDENTIALS",
  FORBIDDEN: "PERMISSION_DENIED",
  TENANT_ACCESS_DENIED: "PERMISSION_DENIED",
  NOT_FOUND: "RESOURCE_NOT_FOUND",
  USER_NOT_FOUND: "RESOURCE_NOT_FOUND",
  CONFLICT: "RESOURCE_CONFLICT",
  DUPLICATE: "RESOURCE_CONFLICT",
  USER_EXISTS: "USER_ALREADY_EXISTS",
  INVALID_PASSWORD: "CURRENT_PASSWORD_INVALID",
  TOO_MANY_REQUESTS: "RATE_LIMITED",
  INTERNAL_SERVER_ERROR: "INTERNAL_ERROR",
};

/**
 * Derive a canonical {@link ErrorCode} from an HTTP status code.
 *
 * 4xx codes map to specific domain errors; anything else falls back to
 * `"INTERNAL_ERROR"`.
 */
function codeForStatus(statusCode: number): ErrorCode {
  if (statusCode === 401) return "AUTH_REQUIRED";
  if (statusCode === 403) return "PERMISSION_DENIED";
  if (statusCode === 404) return "RESOURCE_NOT_FOUND";
  if (statusCode === 409) return "RESOURCE_CONFLICT";
  if (statusCode === 429) return "RATE_LIMITED";
  if (statusCode === 503) return "AUTHZ_UNAVAILABLE";
  if (statusCode >= 400 && statusCode < 500) return "VALIDATION_ERROR";
  return "INTERNAL_ERROR";
}

/**
 * Normalise an arbitrary error code string (possibly a legacy code) into
 * a valid {@link ErrorCode}. When the code is already valid it is returned
 * as-is; when it is a recognised legacy alias the mapped value is used;
 * otherwise the status code determines the fallback.
 *
 * @param code - Raw error code from the caller (may be `undefined`).
 * @param statusCode - HTTP status code associated with the response.
 * @returns A valid {@link ErrorCode}.
 */
export function normalizeErrorCode(
  code: string | undefined,
  statusCode: number,
): ErrorCode {
  if (code && isErrorCode(code)) return code;
  if (code && legacyCodeMap[code]) return legacyCodeMap[code];
  return codeForStatus(statusCode);
}

/**
 * Build a standardised {@link ErrorResponse} payload.
 *
 * INVARIANT (message contract D0.5): the top-level message is always the
 * canonical registry compatibility text for `code` — callers cannot
 * override it, so machine wording channels cannot reappear ad hoc.
 *
 * @param requestId - Correlation ID for the current request.
 * @param code - Canonical error code.
 * @param details - Optional structured details (e.g. validation fields).
 * @returns A fully-formed `ErrorResponse` object.
 */
export function buildErrorResponse(
  requestId: string,
  code: ErrorCode,
  details?: unknown,
): ErrorResponse {
  return {
    error: {
      code,
      message: getErrorMessage(code),
      ...(details === undefined ? {} : { details }),
      requestId,
    },
  };
}

/**
 * Derive the machine `params` for a Zod issue from its structured
 * properties only (message contract D0.4/D0.7) — never from
 * `issue.message`. Values outside the frozen `string | number` domain
 * (e.g. the string[] `options` of `invalid_enum_value`) are omitted;
 * `code` still carries the semantic and `message` stays the compatibility
 * text.
 */
function structuredIssueParams(
  issue: ZodIssue,
): Record<string, string | number> | undefined {
  switch (issue.code) {
    case "invalid_type":
      return { expected: issue.expected, received: issue.received };
    case "too_small":
      return typeof issue.minimum === "number"
        ? { minimum: issue.minimum }
        : undefined;
    case "too_big":
      return typeof issue.maximum === "number"
        ? { maximum: issue.maximum }
        : undefined;
    case "invalid_string":
      // Regex-based string checks type `validation` as RegExp — outside the
      // frozen param domain, so only the named string checks carry it.
      return typeof issue.validation === "string"
        ? { validation: issue.validation }
        : undefined;
    case "invalid_enum_value":
      return { received: issue.received };
    default:
      return undefined;
  }
}

/**
 * Extract field-level validation details from a Zod error.
 *
 * Each entry carries the machine contract (`field` path, `code`, `params`
 * where structured issue metadata exists) plus the required
 * non-authoritative compatibility `message` (message contract D0.7).
 *
 * @param error - The thrown `ZodError`.
 * @returns A {@link ValidationErrorDetails} object listing each failing field.
 */
export function getValidationErrorDetails(
  error: ZodError,
): ValidationErrorDetails {
  return {
    fields: error.issues.map((issue) => {
      const params = structuredIssueParams(issue);
      return {
        field: issue.path.map(String).join(".") || "_root",
        code: issue.code.toUpperCase(),
        ...(params ? { params } : {}),
        message: issue.message,
      };
    }),
  };
}

/**
 * Convenience wrapper that builds a `VALIDATION_ERROR` response directly
 * from a Zod error.
 *
 * @param requestId - Correlation ID for the current request.
 * @param error - The thrown `ZodError`.
 * @returns A fully-formed `ErrorResponse` with validation details attached.
 */
export function buildValidationErrorResponse(
  requestId: string,
  error: ZodError,
): ErrorResponse {
  return buildErrorResponse(
    requestId,
    "VALIDATION_ERROR",
    getValidationErrorDetails(error),
  );
}
