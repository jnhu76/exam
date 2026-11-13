import type { Context, Span, SpanAttributes } from "@opentelemetry/api";
import type { ReadableSpan, SpanProcessor } from "@opentelemetry/sdk-trace";

/**
 * Attribute keys derived from exception state that are stripped from span
 * attributes AND from every event's attributes:
 *
 * - `exception.type` / `exception.message` / `exception.stacktrace` — the
 *   `span.recordException` surface (sdk-trace Span.recordException writes
 *   exactly these keys into an "exception" event; @opentelemetry/
 *   instrumentation-http's setSpanWithError additionally writes them via
 *   recordException). Their values are error-controlled text: messages,
 *   stack frames, exception class names.
 * - `error.type` — the semantic-convention span attribute instrumentation
 *   -http writes (setSpanWithError sets it to `error.name`; parseErrorType
 *   paths set it to a status-code string). @fastify/otel writes NO error.*
 *   span attributes (upstream index.js touches only status.message and
 *   recordException). The key is stripped wherever it appears so a future
 *   span owner cannot silently re-introduce exception-derived text.
 */
const EXCEPTION_DERIVED_KEYS = [
  "exception.type",
  "exception.message",
  "exception.stacktrace",
  "error.type",
] as const;

/**
 * Fixed substitute for every non-empty `span.status.message`. Span owners
 * write raw error text here (@fastify/otel recordErrorInSpanHook and its
 * handler-hook wrappers set `message: error.message` UNCONDITIONALLY — there
 * is no config to turn it off; instrumentation-http setSpanWithError does
 * the same). The message content is exception-derived text, so it is
 * replaced wholesale; the status CODE is preserved (the error signal itself
 * is not suppressed).
 */
const REDACTED_STATUS_MESSAGE = "(redacted)";

/**
 * Mutable view of the status record handed to processors. ReadableSpan
 * declares `readonly status`, but the SDK hands processors the live recording
 * span whose fields are mutable plain objects (same sanctioned-mutation
 * rationale as the attribute store in urlScrubSpanProcessor.ts) — the object
 * referenced by `span.status` is exactly what every later processor and every
 * exporter serializes.
 */
interface MutableSpanStatus {
  code: number;
  message?: string;
}

/**
 * Strips exception-derived text from every span at the moment it completes —
 * BEFORE any processor queues it for export (#973 P1 / ADR-028 D4: telemetry
 * fields exclude raw error text; the client error envelope is a separate
 * exit and stays untouched by this class).
 *
 * Placement contract: registered AFTER the URL scrub and BEFORE every
 * queueing/exporting processor in the SDK's span-processor chain. Every
 * later processor and any exporter reads the same live span object, so the
 * exported form is always the scrubbed form — for the current memory witness
 * and for any future exporter (OTLP included), not just the in-process one.
 *
 * Rewriting rules (the exception-scrub contract):
 * - `span.status.message` is replaced by the fixed `(redacted)` placeholder
 *   whenever non-empty; empty stays empty. The status code is never changed.
 * - every key in EXCEPTION_DERIVED_KEYS is deleted from span attributes and
 *   from EVERY event's attributes (defensively: not only from events named
 *   "exception", so a renamed event cannot smuggle the same text).
 * - event NAMES and timestamps are preserved: the failure signal (that an
 *   exception occurred, when, how many) stays observable; only its
 *   exception-derived text is dropped.
 */
export class ExceptionScrubSpanProcessor implements SpanProcessor {
  onStart(_span: Span, _parentContext: Context): void {
    // Deliberately empty: exceptions are recorded during/after the handler
    // runs; the authoritative scrub point is onEnd (final state).
  }

  onEnd(span: ReadableSpan): void {
    const attributes = span.attributes as SpanAttributes;
    for (const key of EXCEPTION_DERIVED_KEYS) {
      delete attributes[key];
    }

    const status = span.status as MutableSpanStatus;
    if (status.message) {
      status.message = REDACTED_STATUS_MESSAGE;
    }

    for (const event of span.events) {
      const eventAttributes = event.attributes as SpanAttributes | undefined;
      if (!eventAttributes) continue;
      for (const key of EXCEPTION_DERIVED_KEYS) {
        delete eventAttributes[key];
      }
    }
  }

  async forceFlush(): Promise<void> {}

  async shutdown(): Promise<void> {}
}
