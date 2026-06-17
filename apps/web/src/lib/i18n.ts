import {
  isErrorCode,
  getMessageForLocale,
  fallbackMessages,
} from "@exam/contracts";
import { ApiError } from "./api";

/**
 * Resolves a user-facing error message from an unknown error value.
 * Uses the contracts error code map for ApiError instances, falling back
 * to the generic operationFailed message.
 */
export function resolveErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code && isErrorCode(error.code)) {
      return getMessageForLocale(error.code);
    }
    if (error.message) {
      return error.message;
    }
    return fallbackMessages.operationFailed;
  }
  if (error instanceof Error) {
    return error.message || fallbackMessages.operationFailed;
  }
  return fallbackMessages.operationFailed;
}
