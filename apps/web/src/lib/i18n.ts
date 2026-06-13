import {
  isErrorCode,
  getMessageForLocale,
  fallbackMessages,
} from "@exam/contracts";
import { ApiError } from "./api";

// 接入用户偏好或 Accept-Language 时改为传入实际 locale。
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
