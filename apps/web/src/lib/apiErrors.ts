import i18n from "@/i18n";

/**
 * i18n key for the generic "operation failed" fallback used across the API
 * error layer. Kept as a shared constant so callers (api.ts, toast helpers)
 * reference the same key instead of hardcoding the Chinese string.
 */
export const API_ERROR_FALLBACK_KEY = "errors.unknown";

/** Shape of a single field-level validation error detail from the API. */
interface ValidationFieldDetail {
  field: string;
  message: string;
  code?: string;
}

/** Returns true if value is a plain object (Record). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Returns true if value matches the ValidationFieldDetail shape. */
function isValidationFieldDetail(
  value: unknown,
): value is ValidationFieldDetail {
  if (!isRecord(value)) return false;
  return typeof value.field === "string" && typeof value.message === "string";
}

/**
 * Resolves the localized fallback message for the API error layer via the
 * shared i18n instance (works outside React — no useTranslation needed).
 */
function resolveFallback(): string {
  return i18n.t(API_ERROR_FALLBACK_KEY);
}

/** Extracts a human-readable error message from an unknown error value.
 * The fallback is i18n-resolved (errors.unknown); callers may override it. */
export function getApiErrorMessage(error: unknown, fallback?: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (isRecord(error) && typeof error.message === "string" && error.message) {
    return error.message;
  }
  return fallback ?? resolveFallback();
}

/** Extracts per-field validation errors from an API error's details object. */
export function getApiFieldErrors(error: unknown): Record<string, string> {
  if (!isRecord(error) || !isRecord(error.details)) return {};
  const fields = error.details.fields;
  if (!Array.isArray(fields)) return {};
  return Object.fromEntries(
    fields
      .filter(isValidationFieldDetail)
      .map((detail) => [detail.field, detail.message]),
  );
}
