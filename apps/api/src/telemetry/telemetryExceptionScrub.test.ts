import type { ReadableSpan, SpanProcessor } from "@opentelemetry/sdk-trace";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resetRuntimeConfigForTest } from "../config/runtimeConfig.js";
import {
  flushRetainedSpansForDiagnostics,
  getRetainedSpansForDiagnostics,
  initTelemetry,
  shutdownTelemetry,
  type TelemetryRuntimeHandle,
} from "./runtime.js";
import { ExceptionScrubSpanProcessor } from "./exceptionScrubSpanProcessor.js";
import { buildApp, MARKER, withServer, type Harness } from "./testHelpers.js";

/**
 * Exception-surface oracle (#973 P1): @fastify/otel writes `error.message`
 * verbatim into `span.status.message` and `span.recordException` attaches
 * `exception.type/message/stacktrace` event attributes — client-controlled
 * exception text that must never reach ANY exporter. One real init session
 * per process (test file — see telemetrySignals.test.ts): the unit-level
 * processor contract runs against synthetic spans (no init consumed), the
 * end-to-end section against the live session's retained witness.
 */

const THROW_MESSAGE = `${MARKER} exploded in the handler`;

describe("ExceptionScrubSpanProcessor contract (unit)", () => {
  function syntheticSpan(
    status: { code: number; message?: string } = {
      code: 2,
      message: THROW_MESSAGE,
    },
  ): ReadableSpan {
    return {
      name: "synthetic",
      kind: 1,
      spanContext: () => ({
        traceId: "1".repeat(32),
        spanId: "2".repeat(16),
        traceFlags: 1,
        traceState: undefined,
      }),
      startTime: [1, 0],
      endTime: [2, 0],
      duration: [1, 0],
      ended: true,
      status,
      attributes: {
        "error.type": "Error",
        "url.path": "/api/whatever",
      },
      links: [],
      events: [
        {
          name: "exception",
          time: [1, 1],
          attributes: {
            "exception.type": "Error",
            "exception.message": THROW_MESSAGE,
            "exception.stacktrace": `Error: ${MARKER}\n    at handler (/srv/app.ts:1:1)`,
          },
        },
        {
          name: "custom.note",
          time: [1, 2],
          attributes: { note: "benign", "error.type": "Error" },
        },
        { name: "empty.event", time: [1, 3] },
      ],
      resource: { attributes: {}, asyncAttributesPending: false },
      instrumentationScope: { name: "test", version: undefined },
      droppedAttributesCount: 0,
      droppedEventsCount: 0,
      droppedLinksCount: 0,
    } as unknown as ReadableSpan;
  }

  it("replaces a non-empty status.message with the fixed placeholder", () => {
    const span = syntheticSpan();
    new ExceptionScrubSpanProcessor().onEnd(span);
    expect(span.status.message).toBe("(redacted)");
    expect(span.status.code).toBe(2);
  });

  it("leaves an empty status.message empty", () => {
    const span = syntheticSpan({ code: 0 });
    new ExceptionScrubSpanProcessor().onEnd(span);
    expect(span.status.message).toBeUndefined();
  });

  it("strips exception.* and error.* keys from every event, keeps event names", () => {
    const span = syntheticSpan();
    new ExceptionScrubSpanProcessor().onEnd(span);
    const [exceptionEvent, noteEvent, emptyEvent] = span.events;
    expect(exceptionEvent?.name).toBe("exception");
    expect(exceptionEvent?.attributes).toEqual({});
    expect(noteEvent?.attributes).toEqual({ note: "benign" });
    expect(emptyEvent?.attributes).toBeUndefined();
    expect(span.events).toHaveLength(3);
  });

  it("strips the error.* attribute surface from span attributes", () => {
    const span = syntheticSpan();
    new ExceptionScrubSpanProcessor().onEnd(span);
    expect("error.type" in span.attributes).toBe(false);
    expect(span.attributes["url.path"]).toBe("/api/whatever");
  });

  it("is a chainable no-op on start/flush/shutdown", async () => {
    const processor: SpanProcessor = new ExceptionScrubSpanProcessor();
    const span = syntheticSpan();
    expect(() =>
      processor.onStart(span as never, undefined as never),
    ).not.toThrow();
    await expect(processor.forceFlush()).resolves.toBeUndefined();
    await expect(processor.shutdown()).resolves.toBeUndefined();
  });
});

let handle: TelemetryRuntimeHandle | null = null;

beforeAll(async () => {
  vi.stubEnv("APP_MODE", "development");
  vi.stubEnv("TELEMETRY_ENABLED", "true");
  vi.stubEnv("TELEMETRY_EXPORTER", "memory");
  vi.stubEnv("TELEMETRY_MEMORY_DUMP_FILE", "");
  resetRuntimeConfigForTest();
  handle = await initTelemetry();
  if (!handle) throw new Error("telemetry session did not start");
});

afterAll(async () => {
  await shutdownTelemetry();
  vi.unstubAllEnvs();
  resetRuntimeConfigForTest();
});

describe("telemetry exception surface (live session)", () => {
  it("a marker-carrying exception from a route leaves zero exception text in any exported span", async () => {
    if (!handle) throw new Error("session not started");
    const before = getRetainedSpansForDiagnostics().length;
    const harness: Harness = await buildApp(handle.fastifyOtelPlugin);
    // The Harness["app"] surface only declares lifecycle methods; the route
    // registration goes through the real fastify instance beneath it.
    const app = harness.app as unknown as Harness["app"] & {
      post: (url: string, handler: () => Promise<never>) => void;
    };
    app.post("/w11/boom-marker", async () => {
      throw new Error(THROW_MESSAGE) as never;
    });
    let status = 0;
    let body: Record<string, unknown> = {};
    await withServer(harness, async (base) => {
      const response = await fetch(`${base}/w11/boom-marker`, {
        method: "POST",
      });
      status = response.status;
      body = (await response.json()) as Record<string, unknown>;
    });
    await flushRetainedSpansForDiagnostics();

    // The HTTP response is UNCHANGED by the scrub: the client envelope keeps
    // its pre-existing shape (the harness uses the fastify default handler;
    // the real entry's handler in plugins/errors.ts hides raw messages).
    expect(status).toBe(500);
    expect(body.statusCode).toBe(500);
    expect(body.message).toBe(THROW_MESSAGE);

    const spans = getRetainedSpansForDiagnostics().slice(before);
    expect(spans.length).toBeGreaterThanOrEqual(1);

    // The failure signal itself is preserved: the request root is ERROR.
    const roots = spans.filter((span) => span.parentSpanId === null);
    expect(roots).toHaveLength(1);
    expect(roots[0]!.status).toBe("error");

    // And the failure timing is preserved: an exception event still exists.
    const exceptionEvents = spans.flatMap((span) =>
      span.events.filter((event) => event.name === "exception"),
    );
    expect(exceptionEvents.length).toBeGreaterThanOrEqual(1);

    // ZERO exception-derived text anywhere in the exported form: status
    // messages, span attributes, event attributes.
    const serialized = JSON.stringify(spans);
    expect(serialized).not.toContain(MARKER);
    expect(serialized).not.toContain("exploded in the handler");
    for (const span of spans) {
      expect(
        span.statusMessage ?? (span.status === "error" ? "(redacted)" : null),
      ).not.toContain(MARKER);
      if (span.status === "error") {
        expect(span.statusMessage).toBe("(redacted)");
      }
      for (const event of span.events) {
        for (const key of Object.keys(event.attributes)) {
          expect(key.startsWith("exception.")).toBe(false);
          expect(key.startsWith("error.")).toBe(false);
        }
      }
    }
  });
});
