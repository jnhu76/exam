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

/** Extracts a human-readable error message from an unknown error value. */
export function getApiErrorMessage(
  error: unknown,
  fallback = "操作失败，请稍后重试",
): string {
  if (error instanceof Error && error.message) return error.message;
  if (isRecord(error) && typeof error.message === "string" && error.message) {
    return error.message;
  }
  return fallback;
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
