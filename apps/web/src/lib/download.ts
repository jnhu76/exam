import { api, responseToApiError } from "./api";

/**
 * Downloads a file from an API path via a browser blob, using the same
 * cookie-based auth as {@link api} (`credentials: "include"`). Unlike the JSON
 * `api` client, this is intended for non-JSON responses (e.g. `text/csv`): it
 * reads the body as a Blob and triggers a browser download with `download`
 * set, so a cross-origin `VITE_API_BASE_URL` still sends the auth cookie and
 * the filename is honored.
 *
 * Download failures throw the same {@link ApiError} shape as JSON request
 * failures (machine facts + raw server compat message; presentation resolves
 * through the shared Web i18n error resolver), so consumers obey the same
 * known-code/reason/unknown fallback contract.
 */
export async function downloadFile(
  path: string,
  filename: string,
): Promise<void> {
  const response = await fetch(`${api.baseURL}${path}`, {
    credentials: "include",
  });

  if (!response.ok) {
    throw await responseToApiError(response);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
