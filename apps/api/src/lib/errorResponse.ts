import {
  getErrorMessage,
  isErrorCode,
  type ErrorCode,
  type ErrorResponse,
  type ValidationErrorDetails,
} from "@exam/contracts";
import type { ZodError } from "zod";

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

function codeForStatus(statusCode: number): ErrorCode {
  if (statusCode === 401) return "AUTH_REQUIRED";
  if (statusCode === 403) return "PERMISSION_DENIED";
  if (statusCode === 404) return "RESOURCE_NOT_FOUND";
  if (statusCode === 409) return "RESOURCE_CONFLICT";
  if (statusCode === 429) return "RATE_LIMITED";
  if (statusCode >= 400 && statusCode < 500) return "VALIDATION_ERROR";
  return "INTERNAL_ERROR";
}

export function normalizeErrorCode(
  code: string | undefined,
  statusCode: number,
): ErrorCode {
  if (code && isErrorCode(code)) return code;
  if (code && legacyCodeMap[code]) return legacyCodeMap[code];
  return codeForStatus(statusCode);
}

export function buildErrorResponse(
  requestId: string,
  code: ErrorCode,
  details?: unknown,
  messageOverride?: string,
): ErrorResponse {
  return {
    error: {
      code,
      message: messageOverride ?? getErrorMessage(code),
      ...(details === undefined ? {} : { details }),
      requestId,
    },
  };
}

export function getValidationErrorDetails(
  error: ZodError,
): ValidationErrorDetails {
  return {
    fields: error.issues.map((issue) => ({
      field: issue.path.map(String).join(".") || "_root",
      code: issue.code.toUpperCase(),
      message: issue.message,
    })),
  };
}

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
