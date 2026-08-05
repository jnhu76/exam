import { ApiError } from "./api";

/**
 * J5-I1B Recovery Center — pure error classification (P2-1).
 *
 * Maps an arbitrary thrown value to a closed {@link RecoveryErrorKind} so the
 * Recovery pages can render distinct loading / permission-denied / not-found /
 * unavailable / invalid / network states instead of a single generic
 * "loadFailed". This function is PURE: no React, no i18n, no side effects —
 * pages resolve the localized message from the kind via
 * {@link recoveryErrorMessageKey}.
 *
 * Status mapping (ADR-014 / J5-R0 §8):
 *   401 → unauthenticated   (the API client also redirects to /login)
 *   403 → permission-denied
 *   404 → not-found         (missing / cross-org — anti-enumeration)
 *   400 → invalid           (filter / cursor validation)
 *   503 → unavailable       (broken parent/relationship chain — fail-closed
 *                            AUTHZ_UNAVAILABLE)
 *   0   → network           (transport failure; ApiError.status === 0)
 *   *   → unknown
 */
export type RecoveryErrorKind =
  | "unauthenticated"
  | "permission-denied"
  | "not-found"
  | "unavailable"
  | "invalid"
  | "network"
  | "unknown";

export interface ClassifiedRecoveryError {
  kind: RecoveryErrorKind;
  error: Error;
  status: number | null;
}

/** Classifies a thrown value into a {@link ClassifiedRecoveryError}. */
export function classifyRecoveryError(error: unknown): ClassifiedRecoveryError {
  if (error instanceof ApiError) {
    return {
      kind: kindFromStatus(error.status),
      error,
      status: error.status,
    };
  }
  // A plain Error (e.g. transport/abort before ApiError wrapping) or a
  // non-Error throw: treat as unknown. The API client wraps genuine network
  // failures in `new ApiError(0, ...)`, so reaching here is rare.
  const asError = error instanceof Error ? error : new Error(String(error));
  return { kind: "unknown", error: asError, status: null };
}

function kindFromStatus(status: number): RecoveryErrorKind {
  switch (status) {
    case 401:
      return "unauthenticated";
    case 403:
      return "permission-denied";
    case 404:
      return "not-found";
    case 400:
      return "invalid";
    case 503:
      return "unavailable";
    case 0:
      return "network";
    default:
      return "unknown";
  }
}

/**
 * Returns the i18n message key for a classified recovery error, scoped to the
 * given page namespace (e.g. "admin.recoveryQueue", "admin.recoveryExam").
 * Pages pick their own namespace so the message stays page-appropriate while
 * the classification logic stays generic.
 */
export function recoveryErrorMessageKey(
  kind: RecoveryErrorKind,
  namespace: string,
): string {
  switch (kind) {
    case "unauthenticated":
      return `${namespace}.permissionDenied`;
    case "permission-denied":
      return `${namespace}.permissionDenied`;
    case "not-found":
      return `${namespace}.notFound`;
    case "unavailable":
      return `${namespace}.unavailable`;
    case "invalid":
      return `${namespace}.invalidFilter`;
    case "network":
      return `${namespace}.networkError`;
    case "unknown":
    default:
      return `${namespace}.loadFailed`;
  }
}
