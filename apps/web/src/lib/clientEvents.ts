import type { ClientEvent, ClientEventBatchResponse } from "@exam/contracts";

/** Endpoint path for client-event batch uploads. */
const CLIENT_EVENTS_PATH = "/api/client-events";

/** Base URL derived from the VITE_API_BASE_URL env var (matches api.ts). */
const baseUrl = import.meta.env.VITE_API_BASE_URL ?? "";

/**
 * Soft per-request body cap for keepalive requests. Browsers limit a single
 * `fetch(..., { keepalive: true })` body to ~64 KiB; a request that exceeds it
 * is rejected by the browser, silently losing the whole batch. We size batches
 * to stay under this cap. See https://fetch.spec.whatwg.org/#http-network-fetch
 * (keepalive flag) — the spec value is 64 KiB (65536 bytes).
 */
export const KEEPALIVE_MAX_BODY_BYTES = 64 * 1024;

/**
 * Sends a single serialized batch to the server. Returns the server-reported
 * accepted count, or `null` on any failure (network error, non-2xx, malformed
 * body). Never throws.
 */
async function sendOne(events: ClientEvent[]): Promise<number | null> {
  try {
    const response = await fetch(`${baseUrl}${CLIENT_EVENTS_PATH}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events }),
      // `keepalive` lets the request outlive the page during unload flushes.
      keepalive: true,
    });
    if (!response.ok) return null;
    const body = (await response.json()) as Partial<ClientEventBatchResponse>;
    if (typeof body?.accepted !== "number") return null;
    return body.accepted;
  } catch {
    // Network error, parse error, or any other runtime failure: swallow.
    return null;
  }
}

/**
 * Greedy-buckets events into requests whose serialized body stays under the
 * keepalive byte cap. Events that individually exceed the cap are dropped
 * (they can never be sent via a keepalive fetch) rather than blocking the rest.
 * Returns the list of per-request event batches to send, in order.
 */
function planRequests(events: ClientEvent[]): ClientEvent[][] {
  const requests: ClientEvent[][] = [];
  let current: ClientEvent[] = [];
  let currentBytes = 0;
  for (const event of events) {
    // Marginal size of adding this event: `"{}"` overhead is tiny, so we
    // measure the event's own serialized length plus a small separator budget.
    const marginal = JSON.stringify(event).length + 1; // 1 for ',' / '['
    const aloneFits = marginal <= KEEPALIVE_MAX_BODY_BYTES;
    if (!aloneFits) {
      // Drop this event — it can never fit a single keepalive request.
      continue;
    }
    const wouldExceed =
      currentBytes + marginal > KEEPALIVE_MAX_BODY_BYTES && current.length > 0;
    if (wouldExceed) {
      requests.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(event);
    currentBytes += marginal;
  }
  if (current.length > 0) requests.push(current);
  return requests;
}

/**
 * Sends a batch of client events to the server. This is the ONLY module
 * permitted to call the `/api/client-events` endpoint.
 *
 * Contract:
 * - NEVER throws. All failures are swallowed and reported via the boolean
 *   return; the caller (the buffer) drops the batch or backs off — it must not
 *   re-enqueue a log about the failure, which would create an infinite loop.
 * - NEVER logs recursively. On failure it returns `false`; the buffer handles
 *   retry/backoff.
 * - Splits the batch into multiple requests when the combined body would exceed
 *   the keepalive byte cap (H6), so unload flushes are not silently dropped.
 * - Success semantics (H4): returns `true` when every event was accepted by the
 *   server. A non-empty batch whose server reports `accepted: 0` is treated as
 *   failure (a data-loss signal) so the buffer can retry; a genuinely empty
 *   flush is a clean no-op success.
 *
 * @returns `true` if the batch was fully accepted (or was empty), `false` otherwise.
 */
export async function postClientEvents(
  events: ClientEvent[],
): Promise<boolean> {
  if (events.length === 0) {
    // No events to send — confirm the round-trip once so callers can treat an
    // empty flush as success. (The buffer short-circuits before calling for
    // empty queues, but this keeps the transport self-consistent.)
    const accepted = await sendOne([]);
    return accepted !== null && accepted >= 0;
  }

  const requests = planRequests(events);
  if (requests.length === 0) {
    // Every event was too large to send — nothing accepted.
    return false;
  }

  let totalSent = 0;
  let totalAccepted = 0;
  for (const batch of requests) {
    const accepted = await sendOne(batch);
    if (accepted === null) return false; // any failed request fails the flush
    // Server must accept every event in THIS request, else treat as failure.
    if (accepted < batch.length) return false;
    totalSent += batch.length;
    totalAccepted += accepted;
  }
  // Every sent event was accepted. (Dropped over-cap events are intentionally
  // excluded from this accounting.)
  return totalAccepted === totalSent && totalSent > 0;
}
