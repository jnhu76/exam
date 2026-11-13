import type { SpanAttributeValue } from "@opentelemetry/api";
import type { ReadableSpan, SpanExporter } from "@opentelemetry/sdk-trace";

/** ExportResult shape from @opentelemetry/core, restated structurally. */
interface ExportSuccess {
  code: 0; // ExportResultCode.SUCCESS
  error?: Error;
}

/**
 * Span projection retained by the exporter — exactly the fields the
 * in-memory witness surface reads. Attributes arrive already scrubbed by the
 * {@link UrlScrubSpanProcessor} that runs first in the processor chain.
 */
export interface RetainedSpan {
  name: string;
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  status: "unset" | "ok" | "error";
  attributes: Record<string, SpanAttributeValue>;
}

/** Hard cap on retained spans (ring buffer); oldest spans fall off first. */
const MAX_RETAINED_SPANS = 1000;

/**
 * Bounded in-process span exporter — the local-observation export target
 * (`TELEMETRY_EXPORTER=memory`, ADR-028 On/observability state).
 *
 * BOUNDS (ADR-028 D1: telemetry must never become an unbounded resource):
 * - at most {@link MAX_RETAINED_SPANS} finished spans are retained; the
 *   buffer is a FIFO ring, never a growth surface;
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
      attributes: { ...span.attributes },
    };
  }
}
