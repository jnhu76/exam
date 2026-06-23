import {
  getMessageForLocale,
  isErrorCode,
  type ErrorResponse,
} from "@exam/contracts";
import { ApiError, api } from "./api";

/** Shape of the JSON body returned by the server on error responses. */
type ErrorBody = Partial<ErrorResponse> & { message?: string };

/**
 * Downloads a file from an API path via a browser blob, using the same
 * cookie-based auth as {@link api} (`credentials: "include"`). Unlike the JSON
 * `api` client, this is intended for non-JSON responses (e.g. `text/csv`): it
 * reads the body as a Blob and triggers a browser download with `download`
 * set, so a cross-origin `VITE_API_BASE_URL` still sends the auth cookie and
 * the filename is honored.
 *
 * Reuses {@link ApiError} + locale error messages so download failures surface
 * the same way as JSON request failures (and still redirect to /login on 401).
 */
export async function downloadFile(
  path: string,
  filename: string,
): Promise<void> {
  const response = await fetch(`${api.baseURL}${path}`, {
    credentials: "include",
  });

  if (!response.ok) {
    let message: string | undefined;
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
      // body parse failed; fall through to code/status fallback
    }
    if (code && isErrorCode(code)) {
      message = getMessageForLocale(code);
    } else if (serverMessage) {
      message = serverMessage;
    }
    if (!message) {
      message = `${response.status} Request failed`;
    }
    throw new ApiError(response.status, message, code, details, requestId);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
