import type { SpanAttributeValue } from "@opentelemetry/api";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace";

/** ExportResult shape from @opentelemetry/core, restated structurally. */
interface ExportSuccess {
  code: 0; // ExportResultCode.SUCCESS
  error?: Error;
}

/**
 * Serialized event projection retained alongside a span — name, attribute
 * snapshot, and the span's high-resolution timestamp pair. Bounded per span
 * (see {@link MAX_EVENTS_PER_SPAN}).
 */
export interface RetainedSpanEvent {
  name: string;
  attributes: Record<string, SpanAttributeValue>;
  /** The SDK event timestamp as the raw `[seconds, nanoseconds]` pair. */
  time: [number, number];
}

/**
 * Span projection retained by the exporter — exactly the fields the
 * in-memory witness surface reads. Attributes arrive already scrubbed by the
 * {@link UrlScrubSpanProcessor} that runs first in the processor chain; the
 * status message and event set make the EXCEPTION surface observable too
 * (#973 P1: a witness that drops status.message / events cannot prove the
 * exported form carries no exception-derived text).
 */
export interface RetainedSpan {
  name: string;
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  status: "unset" | "ok" | "error";
  /** Raw status message (post-scrub) as exported; null when unset. */
  statusMessage: string | null;
  attributes: Record<string, SpanAttributeValue>;
  /** Serialized events, bounded to the last {@link MAX_EVENTS_PER_SPAN}. */
  events: readonly RetainedSpanEvent[];
}

/** Hard cap on retained spans (ring buffer); oldest spans fall off first. */
const MAX_RETAINED_SPANS = 1000;

/**
 * Hard cap on retained events PER span (oldest fall off first). Events are
 * exception-shaped data — the same unbounded-resource class as spans — so
 * the witness keeps a bounded serialized slice, never a growth surface.
 */
const MAX_EVENTS_PER_SPAN = 16;

/**
 * Bounded in-process span exporter — the local-observation export target
 * (`TELEMETRY_EXPORTER=memory`, ADR-028 On/observability state).
 *
 * BOUNDS (ADR-028 D1: telemetry must never become an unbounded resource):
 * - at most {@link MAX_RETAINED_SPANS} finished spans are retained; the
 *   buffer is a FIFO ring, never a growth surface;
 * - at most {@link MAX_EVENTS_PER_SPAN} events per retained span;
 * - `export` settles synchronously — the export task never blocks, never
 *   retries, and cannot fail (nothing here can throw into the SDK).
 *
 * This is an observation WITNESS, not a delivery path: it sends nothing
 * anywhere. Graceful shutdown may persist the retained spans to the
 * `TELEMETRY_MEMORY_DUMP_FILE` witness path (see runtime.ts); without that
 * path the buffer dies with the process.
 */
export class BoundedMemorySpanExporter implements SpanExporter {
  #buffer: RetainedSpan[] = [];
  #stopped = false;

  export(
    spans: ReadableSpan[],
    resultCallback: (result: ExportSuccess) => void,
  ): void {
    if (this.#stopped) {
      resultCallback({ code: 0 });
      return;
    }
    for (const span of spans) {
      this.#buffer.push(this.project(span));
    }
    if (this.#buffer.length > MAX_RETAINED_SPANS) {
      this.#buffer = this.#buffer.slice(-MAX_RETAINED_SPANS);
    }
    resultCallback({ code: 0 });
  }

  async forceFlush(): Promise<void> {}

  async shutdown(): Promise<void> {
    this.#stopped = true;
    this.#buffer = [];
  }

  /** The retained (scrubbed) spans, oldest first. Test/witness accessor. */
  getRetainedSpans(): readonly RetainedSpan[] {
    return this.#buffer;
  }

  private project(span: ReadableSpan): RetainedSpan {
    return {
      name: span.name,
      traceId: span.spanContext().traceId,
      spanId: span.spanContext().spanId,
      parentSpanId: span.parentSpanContext?.spanId ?? null,
      status:
        span.status.code === 2
          ? "error"
          : span.status.code === 1
            ? "ok"
            : "unset",
      statusMessage: span.status.message ?? null,
      attributes: { ...span.attributes },
      events: span.events.slice(-MAX_EVENTS_PER_SPAN).map((event) => ({
        name: event.name,
        attributes: { ...event.attributes },
        time: event.time,
      })),
    };
  }
}
