import { toast } from "sonner";
import i18n from "@/i18n";
import { routes } from "@/lib/routes";
import type { ErrorResponse } from "@exam/contracts";

/** Base URL for API requests, derived from the VITE_API_BASE_URL env var. */
const baseUrl = import.meta.env.VITE_API_BASE_URL ?? "";

let navigateFn: ((path: string) => void) | null = null;

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
