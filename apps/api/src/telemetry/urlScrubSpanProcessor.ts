import type { Context, Span, SpanAttributes } from "@opentelemetry/api";
import type { ReadableSpan, SpanProcessor } from "@opentelemetry/sdk-trace";

/**
 * Attribute keys that can carry raw URL material (path with query string,
 * full URL, or the raw query itself) across span owners.
 *
 * - `url.path` is set by @fastify/otel to `request.url` — the RAW request
 *   target INCLUDING the query string (W1.1 probe F2; upstream has no
 *   built-in query stripping).
 * - `url.query` / `url.full` are set by @opentelemetry/instrumentation-http
 *   on spans it owns.
 * - `http.url` / `url.search` are the legacy/alternate spellings kept in the
 *   set so a future instrumentation version cannot silently re-introduce the
 *   leak through a renamed key.
 */
const RAW_URL_KEYS = [
  "url.full",
  "url.query",
  "url.search",
  "http.url",
] as const;

/** Key that receives the safe (query-free) path substitute. */
const URL_PATH_KEY = "url.path";

/** Route template attribute (low cardinality, e.g. `/api/attempts/:id`). */
const HTTP_ROUTE_KEY = "http.route";

/**
 * Placeholder for spans whose request matched no route — the same
 * client-bytes-never-persisted shape as the pino `req` serializer
 * (`UNROUTED_LOG_PLACEHOLDER`, lib/logRedaction.ts).
 */
const UNROUTED_SPAN_PLACEHOLDER = "(unrouted)";

/**
 * Strips raw URL material from every span at the moment it completes —
 * BEFORE any processor queues it for export (ADR-018 D4 / ADR-028 D4:
 * telemetry fields exclude raw URLs and query strings; the span and the pino
 * log line are separate exits and each is scrubbed at its own boundary).
 *
 * Placement contract: registered FIRST in the SDK's span-processor chain.
 * Every later processor/exporter reads the same live span object, so the
 * exported form is always the scrubbed form — this holds for any exporter
 * configured now or later, not just the current in-memory witness.
 *
 * Rewriting rules:
 * - `url.path` is replaced by the matched route template when one exists,
 *   otherwise by the fixed `(unrouted)` placeholder. The raw path itself is
 *   client-controlled bytes (ids, arbitrary 404 targets) and is never kept.
 * - every key in RAW_URL_KEYS is deleted outright.
 */
export class UrlScrubSpanProcessor implements SpanProcessor {
  onStart(_span: Span, _parentContext: Context): void {
    // Deliberately empty: request hooks keep setting attributes after start;
    // the authoritative scrub point is onEnd (final attribute state).
  }

  onEnd(span: ReadableSpan): void {
    // The SDK hands processors the live recording span whose attribute store
    // is a mutable plain object; the readonly surface is the read-side view,
    // not a freeze. This narrow view is the one sanctioned mutation point —
    // it runs before any export task observes the span.
    const attributes = span.attributes as SpanAttributes;
    for (const key of RAW_URL_KEYS) {
      delete attributes[key];
    }
    const route = attributes[HTTP_ROUTE_KEY];
    attributes[URL_PATH_KEY] =
      typeof route === "string" && route.length > 0
        ? route
        : UNROUTED_SPAN_PLACEHOLDER;
  }

  async forceFlush(): Promise<void> {}

  async shutdown(): Promise<void> {}
}
