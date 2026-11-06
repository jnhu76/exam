import {
  ErrorResponseSchema,
  ValidationErrorDetailsSchema,
  type ClientEvent,
  type ClientEventBatchResponse,
} from "@exam/contracts";

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
 * One event the server deterministically rejected via THIS endpoint's
 * standard 400 VALIDATION_ERROR envelope (#874 PR-W). `index` is the event's
 * position in the ORIGINAL batch passed to {@link postClientEvents} (the
 * server's per-POST sub-batch index is mapped back here); `fields` are the
 * failing field paths relative to the event (e.g. `occurredAt`).
 */
export interface ClientEventRejection {
  index: number;
  fields: string[];
}

/**
 * Internal transport result for one {@link postClientEvents} call.
 *
 * This is NOT an HTTP protocol change — the wire stays
 * `200 {accepted: n}` / standard `400 VALIDATION_ERROR`. It is the
 * client-side classification the buffer needs to tell three outcomes apart:
 *
 * - ACKNOWLEDGED: the events covered by `acknowledgedCount` — always a
 *   contiguous prefix of the input batch, because sub-requests are sent in
 *   order and the flush stops at the first sub-batch that is not fully
 *   acknowledged.
 * - REJECTED: `rejected` — events the server determinately named in a
 *   standard 400 with an in-range `events.<index>.*` path. These are poison
 *   events; the buffer removes exactly these, never their peers.
 * - RETRY: everything else. Events not covered by either field are
 *   UNCONFIRMED (network error, 5xx, 401/403/429, malformed body, a 200 that
 *   did not confirm the whole sub-batch, or a 400 without usable per-event
 *   indices) and remain the buffer's responsibility — retried with the
 *   existing bounded backoff, never deleted on a guess.
 *
 * Known deviation from the pre-#874 accounting: an event that cannot fit a
 * single keepalive request is no longer silently lost when its peers were
 * sent — it simply stays unconfirmed (pending) and is retried. With
 * schema-valid events this path is unreachable (metadata is capped well
 * below the keepalive cap server-side); the buffer's max-size bound keeps
 * even that retry bounded.
 */
export interface ClientEventPostResult {
  /** Events confirmed accepted: exactly the first `acknowledgedCount` of the input batch. */
  acknowledgedCount: number;
  /** Events deterministically rejected; indices are into the input batch. */
  rejected: ClientEventRejection[];
}

/** Outcome of a single POST round trip, before original-index mapping. */
type SubBatchResult =
  | { state: "acknowledged" }
  | { state: "rejected"; localRejections: ClientEventRejection[] }
  | { state: "retry" };

/**
 * Event-index segments of THIS endpoint's standard 400 field paths, e.g.
 * `events.1.occurredAt` → event index 1, relative field `occurredAt`.
 * Anything that does not name an event (batch-level paths, `_root`) yields
 * no match — those 400s stay unconfirmed.
 */
const EVENT_FIELD_PATTERN = /^events\.(\d+)(?:\.(.+))?$/;

/**
 * Extracts deterministic per-event rejections from the standard 400 body.
 * Rejections are produced ONLY when the body parses as the standard error
 * envelope with `code === "VALIDATION_ERROR"` AND a field path names an
 * event index inside THIS request's batch. Everything else — non-standard
 * 400, malformed JSON, out-of-range or non-numeric indices, batch-level
 * paths — yields no rejections: the outcome stays uncertain and the batch is
 * retried, never deleted on a guess (#874 PR-W).
 */
async function parseValidationRejections(
  response: Response,
  batchSize: number,
): Promise<ClientEventRejection[]> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return [];
  }
  const envelope = ErrorResponseSchema.safeParse(body);
  if (
    !envelope.success ||
    envelope.data.error.code !== "VALIDATION_ERROR" ||
    envelope.data.error.details === undefined
  ) {
    return [];
  }
  const details = ValidationErrorDetailsSchema.safeParse(
    envelope.data.error.details,
  );
  if (!details.success) return [];

  const byIndex = new Map<number, string[]>();
  for (const issue of details.data.fields) {
    const match = EVENT_FIELD_PATTERN.exec(issue.field);
    if (!match) continue;
    const index = Number(match[1]);
    if (!Number.isInteger(index) || index < 0 || index >= batchSize) continue;
    // A bare `events.<index>` path still identifies the event; only the
    // diagnostic field label falls back to the raw path in that case.
    const field = match[2] ?? issue.field;
    const fields = byIndex.get(index);
    if (fields) fields.push(field);
    else byIndex.set(index, [field]);
  }
  return [...byIndex.entries()]
    .sort(([a], [b]) => a - b)
    .map(([index, fields]) => ({ index, fields }));
}

/**
 * Sends a single serialized sub-batch to the server and classifies the
 * outcome. Never throws.
 */
async function sendOne(batch: ClientEvent[]): Promise<SubBatchResult> {
  try {
    const response = await fetch(`${baseUrl}${CLIENT_EVENTS_PATH}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events: batch }),
      // `keepalive` lets the request outlive the page during unload flushes.
      keepalive: true,
    });
    if (response.status === 400) {
      const localRejections = await parseValidationRejections(
        response,
        batch.length,
      );
      return { state: "rejected", localRejections };
    }
    if (!response.ok) return { state: "retry" };
    const body = (await response.json()) as Partial<ClientEventBatchResponse>;
    if (typeof body?.accepted !== "number") return { state: "retry" };
    // The server confirms a sub-batch only by accepting ALL of it: accepted
    // is inserted + deduplicated (#863), so a schema-valid batch always
    // reports exactly n. Anything else is an unconfirmed outcome.
    if (body.accepted !== batch.length) return { state: "retry" };
    return { state: "acknowledged" };
  } catch {
    // Network error, parse error, or any other runtime failure: the outcome
    // is unknown, never an event-content verdict.
    return { state: "retry" };
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
 * - NEVER throws. All failures are swallowed and reported via the classified
 *   result; the caller (the buffer) isolates rejected events or backs off —
 *   it must not re-enqueue a log about the failure, which would create an
 *   infinite loop.
 * - NEVER logs recursively.
 * - Splits the batch into multiple requests when the combined body would exceed
 *   the keepalive byte cap (H6), so unload flushes are not silently dropped.
 * - Success semantics (H4, refined by #874 PR-W): {@link ClientEventPostResult}
 *   tells the buffer which events the server CONFIRMED accepted (a contiguous
 *   prefix), which it determinately rejected, and which stay unconfirmed.
 *
 * @returns the classification for the input batch (never throws).
 */
export async function postClientEvents(
  events: ClientEvent[],
): Promise<ClientEventPostResult> {
  if (events.length === 0) {
    // No events to send — confirm the round-trip once so callers can treat an
    // empty flush as success. (The buffer short-circuits before calling for
    // empty queues, but this keeps the transport self-consistent.)
    await sendOne([]);
    return { acknowledgedCount: 0, rejected: [] };
  }

  const requests = planRequests(events);
  if (requests.length === 0) {
    // Every event was too large to send — nothing accepted, nothing rejected.
    return { acknowledgedCount: 0, rejected: [] };
  }

  let acknowledged = 0;
  for (const batch of requests) {
    const result = await sendOne(batch);
    if (result.state === "acknowledged") {
      acknowledged += batch.length;
      continue;
    }
    if (result.state === "retry") {
      // Stop at the first unconfirmed sub-batch: later events were never
      // sent, earlier ones are already counted in `acknowledged`.
      return { acknowledgedCount: acknowledged, rejected: [] };
    }
    // Deterministic rejection: map sub-batch-local indices to ORIGINAL batch
    // indices (acknowledged is exactly the size of the confirmed prefix).
    // Later sub-batches were never sent and stay unconfirmed.
    return {
      acknowledgedCount: acknowledged,
      rejected: result.localRejections.map((r) => ({
        index: acknowledged + r.index,
        fields: r.fields,
      })),
    };
  }
  return { acknowledgedCount: acknowledged, rejected: [] };
}
