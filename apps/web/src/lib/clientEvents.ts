import type { ClientEvent, ClientEventBatchResponse } from "@exam/contracts";

/** Endpoint path for client-event batch uploads. */
const CLIENT_EVENTS_PATH = "/api/client-events";

/** Base URL derived from the VITE_API_BASE_URL env var (matches api.ts). */
const baseUrl = import.meta.env.VITE_API_BASE_URL ?? "";

/**
 * Sends a batch of client events to the server. This is the ONLY module
 * permitted to call the `/api/client-events` endpoint.
 *
 * Contract:
 * - NEVER throws. A rejected promise would propagate into the buffer flush
 *   path and risk disturbing the user's exam / page flow. All failures are
 *   swallowed and reported via the boolean return value.
 * - NEVER logs recursively. On failure it simply returns `false`; the caller
 *   (the buffer) drops the batch or backs off — it must not re-enqueue a
 *   log about the failure, which would create an infinite logging loop.
 *
 * `fetch` with `keepalive: true` is the recommended API over
 * `navigator.sendBeacon` here: it supports custom request headers and
 * `credentials: "include"` (both needed for JSON + the auth cookie). The
 * browser caps a single keepalive request body at ~64 KiB; if an unload
 * flush exceeds that the browser rejects the request and this returns
 * `false`, which the buffer treats as a normal failed flush (drop/backoff).
 * Unload flushing is best-effort by design.
 *
 * @returns `true` if the server accepted the batch, `false` otherwise.
 */
export async function postClientEvents(
  events: ClientEvent[],
): Promise<boolean> {
  try {
    const response = await fetch(`${baseUrl}${CLIENT_EVENTS_PATH}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events }),
      // `keepalive` lets the request outlive the page during unload flushes.
      keepalive: true,
    });
    if (!response.ok) return false;
    const body = (await response.json()) as ClientEventBatchResponse;
    return typeof body?.accepted === "number";
  } catch {
    // Network error, parse error, or any other runtime failure: swallow.
    // The buffer treats this as a failed flush and drops the batch to avoid
    // unbounded growth / retry storms.
    return false;
  }
}
