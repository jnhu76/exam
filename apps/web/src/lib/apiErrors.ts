interface ValidationFieldDetail {
  field: string;
  message: string;
  code?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isValidationFieldDetail(
  value: unknown,
): value is ValidationFieldDetail {
  if (!isRecord(value)) return false;
  return typeof value.field === "string" && typeof value.message === "string";
}

export function getApiErrorMessage(
  error: unknown,
  fallback = "操作失败，请稍后重试",
): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

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
