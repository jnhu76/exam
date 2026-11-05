import { toast } from "sonner";
import i18n from "@/i18n";
import { routes } from "@/lib/routes";
import { logger } from "@/lib/logger";
import { createTelemetryRateLimiter } from "@/lib/telemetryRateLimit";
import type { ErrorResponse } from "@exam/contracts";

/** Base URL for API requests, derived from the VITE_API_BASE_URL env var. */
const baseUrl = import.meta.env.VITE_API_BASE_URL ?? "";

let navigateFn: ((path: string) => void) | null = null;

/**
 * Module-level limiter: dedup state must persist across requests so a polling
 * page hammering a dead gateway stays a bounded number of persisted rows
 * (one warn per endpoint category per window).
 */
const networkFailureLimiter = createTelemetryRateLimiter();

/** Test-only: clears the network-failure limiter window. */
export function __resetNetworkFailureLimiterForTest(): void {
  networkFailureLimiter.reset();
}

/**
 * Static route-segment vocabulary derived from every production `/api/` call
 * site under apps/web/src. WHY a closed vocabulary: a segment is persisted
 * in `api.network_failed` metadata only when it matches this codebase's own
 * static route vocabulary; any other segment (opaque identifier, slug,
 * token, encoded value) degrades to `:id`, so unknown content can never
 * reach persisted metadata. The set drifts safe: a missing entry only
 * coarsens the category, never leaks a raw segment. A vocabulary-sync test
 * in api.test.ts pins this — a new endpoint without a vocabulary entry
 * fails that test instead of silently persisting raw segments.
 */
export const API_STATIC_SEGMENTS = new Set([
  "accept",
  "actions",
  "admin",
  "answer-save-receipt-summary",
  "answers",
  "api",
  "archive",
  "assignable",
  "attempts",
  "audit-log",
  "audit-logs",
  "auth",
  "bootstrap",
  "branding",
  "cancel",
  "candidate",
  "candidate-fields",
  "candidates",
  "client-events",
  "close",
  "consume",
  "course-assignments",
  "courses",
  "csv",
  "dashboard",
  "detail",
  "diagnostics",
  "effective-authority",
  "enrollments",
  "exam-assignments",
  "exam-profiles",
  "exams",
  "export",
  "extend",
  "force-submit",
  "grade-question",
  "grading-details",
  "grading-queue",
  "health",
  "heartbeat",
  "import",
  "import-logs",
  "incidents",
  "invitations",
  "launchpad",
  "login",
  "logout",
  "me",
  "misconduct",
  "notifications",
  "password",
  "password-reset",
  "permission-registry",
  "proctor",
  "proctor-events",
  "proctors",
  "profile",
  "publish",
  "publish-results",
  "questions",
  "queue",
  "read",
  "read-all",
  "recovery",
  "request",
  "reset-password",
  "restore",
  "result",
  "revoke",
  "roles",
  "scores",
  "settings",
  "start",
  "status",
  "submit",
  "system",
  "tags",
  "take",
  "template",
  "time-grants",
  "timeline",
  "unpublish",
  "unread-count",
  "users",
]);

/** Matches a segment that is exactly a UUID (case-insensitive). */
const UUID_SEGMENT =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Matches a segment that is entirely digits. */
const DIGIT_SEGMENT = /^\d+$/;

/**
 * Defensive upper bound: a categorized path is built from vocabulary
 * segments and `:id` markers, so it is naturally short; the cap only guards
 * against an absurd input path producing an oversized metadata value.
 */
const MAX_CATEGORY_LENGTH = 300;

/**
 * Reduces a request path to a stable endpoint category for telemetry: the
 * query string is dropped, and each segment collapses to `:id` unless it is
 * a UUID, all digits, or a member of {@link API_STATIC_SEGMENTS}. The
 * persisted value identifies the endpoint shape — never a raw entity id,
 * token, or query content.
 */
function toPathCategory(path: string): string {
  const categorized = path
    .split("?")[0]!
    .split("/")
    .map((segment) => {
      if (segment === "") return segment;
      if (UUID_SEGMENT.test(segment) || DIGIT_SEGMENT.test(segment)) {
        return ":id";
      }
      return API_STATIC_SEGMENTS.has(segment) ? segment : ":id";
    })
    .join("/");
  return categorized.slice(0, MAX_CATEGORY_LENGTH);
}

/**
 * Anonymous-legal surfaces: the session-restore probe (`/api/auth/me`) 401s
 * BY DESIGN for a visitor without a cookie (#297 added several such public
 * pages). Redirecting them to /login would bounce the very page they opened;
 * protected-route entry is owned by the admin layout guard, not by this
 * global interceptor.
 */
const ANONYMOUS_LEGAL_PATHS = new Set<string>([
  routes.login,
  routes.launchpad,
  routes.inviteAccept,
  routes.forgotPassword,
  routes.resetPassword,
]);

/**
 * Registers a navigation callback so the API layer can redirect to
 * /login on 401 responses.
 */
export function setNavigate(fn: (path: string) => void) {
  navigateFn = fn;
}

/**
 * Typed error thrown by the API client on non-2xx responses or network failure.
 *
 * INVARIANT (message contract D0.5/D0.11 Zone A): this class carries machine
 * facts only. `serverMessage` is the raw wire compatibility text and is the
 * UNKNOWN-semantics fallback; it is never the presentation authority for
 * known codes — user-facing copy resolves through {@link getApiErrorMessage}
 * (Web i18n), never through `.message`.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly details?: unknown,
    readonly requestId?: string,
    readonly serverMessage?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Shape of the JSON body returned by the server on error responses. */
type ErrorBody = Partial<ErrorResponse> & {
  message?: string;
};

/**
 * Parses a non-2xx response into an {@link ApiError}, preserving the machine
 * facts (status / code / details / requestId) and the raw server
 * compatibility message. Shared by the JSON client and the blob download
 * helper so both surfaces obey the same fallback contract.
 *
 * `.message` keeps the best-effort diagnostic text (wire compat message when
 * present, otherwise a status string) for logs and developer tooling only.
 */
export async function responseToApiError(
  response: Response,
): Promise<ApiError> {
  let serverMessage: string | undefined;
  let code: string | undefined;
  let details: unknown;
  let requestId: string | undefined;
  try {
    const body = (await response.json()) as ErrorBody;
    serverMessage = body.error?.message ?? body.message;
    code = body.error?.code;
    details = body.error?.details;
    requestId = body.error?.requestId;
  } catch {
    // body parse failed; fall through to status-string message
  }
  const message = serverMessage || `${response.status} Request failed`;
  return new ApiError(
    response.status,
    message,
    code,
    details,
    requestId,
    serverMessage,
  );
}

/** Executes an HTTP request, handles error parsing, and throws ApiError. */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    const hasBody = init?.body !== undefined;
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      credentials: "include",
      headers: {
        ...(hasBody ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });

    if (!response.ok) {
      if (
        response.status === 401 &&
        !ANONYMOUS_LEGAL_PATHS.has(window.location.pathname)
      ) {
        navigateFn?.("/login");
      }
      throw await responseToApiError(response);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    // An aborted request (AbortSignal) is intentional — the caller is
    // superseding it. It is NOT a network failure: no toast, no ApiError, so
    // the caller's sequence check is the sole arbiter (no error state, no
    // failure-count bump, no backoff).
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    toast.error(i18n.t("errors.network"));
    // Transport-level failures otherwise leave no server trace beyond the
    // transient toast — record one bounded warn per endpoint category
    // (#800). The persisted `pathPattern` is the vocabulary-based category:
    // any non-static segment has already collapsed to `:id`.
    const pathPattern = toPathCategory(path);
    if (networkFailureLimiter.allow(`api.network_failed|${pathPattern}`)) {
      logger.warn("api.network_failed", { pathPattern });
    }
    throw new ApiError(0, "Network request failed");
  }
}

/**
 * Optional request options. `signal` is forwarded to `fetch` so callers (e.g.
 * the Recovery projection hook) can abort a superseded in-flight request; an
 * aborted request throws an `AbortError` (DOMException), which the client
 * re-throws unchanged — never as a toast or a network ApiError.
 */
export interface ApiRequestOptions {
  signal?: AbortSignal;
}

/** HTTP client with get, post, patch, and delete helpers that use cookie-based auth. */
export const api = {
  baseURL: baseUrl,
  get<T>(path: string, opts?: ApiRequestOptions): Promise<T> {
    return request<T>(path, opts?.signal ? { signal: opts.signal } : undefined);
  },
  post<T, TBody = unknown>(path: string, body?: TBody): Promise<T> {
    return request<T>(path, {
      method: "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  },
  patch<T, TBody = unknown>(path: string, body?: TBody): Promise<T> {
    return request<T>(path, {
      method: "PATCH",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  },
  put<T, TBody = unknown>(path: string, body?: TBody): Promise<T> {
    return request<T>(path, {
      method: "PUT",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  },
  delete<T>(path: string): Promise<T> {
    return request<T>(path, { method: "DELETE" });
  },
};
