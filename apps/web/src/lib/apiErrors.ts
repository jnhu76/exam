import i18n from "@/i18n";

/**
 * i18n key for the generic "operation failed" fallback used across the API
 * error layer. Kept as a shared constant so callers (api.ts, toast helpers)
 * reference the same key instead of hardcoding the Chinese string.
 */
export const API_ERROR_FALLBACK_KEY = "errors.unknown";

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

/** Returns true if value is a plain object (Record). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Returns true if value matches the ApiFieldErrorDetail shape. */
function isValidationFieldDetail(value: unknown): value is ApiFieldErrorDetail {
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
