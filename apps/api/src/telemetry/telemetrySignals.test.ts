import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resetRuntimeConfigForTest } from "../config/runtimeConfig.js";
import {
  flushRetainedSpansForDiagnostics,
  getRetainedSpansForDiagnostics,
  initTelemetry,
  shutdownTelemetry,
  type TelemetryRuntimeHandle,
} from "./runtime.js";
import {
  buildApp,
  CLIENT_TRACEPARENT,
  CLIENT_TRACE_ID,
  MARKER,
  parseLogLines,
  withServer,
  type Harness,
} from "./testHelpers.js";

/**
 * Span-level oracle for the telemetry runtime — ONE real init session per
 * process (test file): the OTel API registers its global provider one-way
 * per process, so every signal-shape assertion runs against a single
 * `TELEMETRY_EXPORTER=memory` session, using before/after deltas of the
 * retained buffer instead of absolute counts.
 */

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let handle: TelemetryRuntimeHandle | null = null;
let dumpDir: string | null = null;
let dumpFile: string | null = null;

beforeAll(async () => {
  vi.stubEnv("APP_MODE", "development");
  vi.stubEnv("TELEMETRY_ENABLED", "true");
  vi.stubEnv("TELEMETRY_EXPORTER", "memory");
  dumpDir = mkdtempSync(join(tmpdir(), "telemetry-dump-"));
  dumpFile = join(dumpDir, "spans.jsonl");
  vi.stubEnv("TELEMETRY_MEMORY_DUMP_FILE", dumpFile);
  resetRuntimeConfigForTest();
  handle = await initTelemetry();
  if (!handle) throw new Error("telemetry session did not start");
  // Explicit no-export decision (see runtime.ts header — the default OTLP
  // exporter would dial localhost:4318 without this).
  expect(process.env.OTEL_TRACES_EXPORTER).toBe("none");
  expect(process.env.OTEL_METRICS_EXPORTER).toBe("none");
  expect(process.env.OTEL_LOGS_EXPORTER).toBe("none");
  // Repeat init in the same session returns the SAME plugin instance.
  const repeat = await initTelemetry();
  expect(repeat?.fastifyOtelPlugin).toBe(handle.fastifyOtelPlugin);
});

afterAll(async () => {
  // The witness dump is written ONLY by graceful shutdown, with every span
  // the session produced.
  expect(existsSync(dumpFile!)).toBe(false);
  await shutdownTelemetry();
  const content = readFileSync(dumpFile!, "utf8");
  expect(content).not.toBe("");
  expect(content).not.toContain(MARKER);
  const parsed = content
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  expect(parsed.length).toBeGreaterThanOrEqual(1);
  expect(parsed[0]!.traceId).toBeDefined();
  // Shutdown idempotency + terminality (one init decision per process).
  await expect(shutdownTelemetry()).resolves.toBeUndefined();
  expect(await initTelemetry()).toBeNull();
  rmSync(dumpDir!, { recursive: true, force: true });
  vi.unstubAllEnvs();
  resetRuntimeConfigForTest();
});

async function runRequest(
  path: string,
  headers?: Record<string, string>,
): Promise<{ status: number; requestId: string; before: number }> {
  if (!handle) throw new Error("session not started");
  const before = getRetainedSpansForDiagnostics().length;
  const harness: Harness = await buildApp(handle.fastifyOtelPlugin);
  let status = 0;
  let requestId = "";
  await withServer(harness, async (base) => {
    const response = await fetch(`${base}${path}`, {
      headers: headers ?? {},
    });
    status = response.status;
    requestId = response.headers.get("x-request-id") ?? "";
  });
  // The batch queue flushes on the 5s schedule; pull it forward so the
  // witness buffer is complete before reading.
  await flushRetainedSpansForDiagnostics();
  return { status, requestId, before };
}

function deltaSpans(before: number) {
  return [...getRetainedSpansForDiagnostics()].slice(before);
}

describe("telemetry runtime signals (one live session)", () => {
  it("produces exactly one server root span per request plus a handler child", async () => {
    const { status, before } = await runRequest("/w12/ordinary");
    expect(status).toBe(200);
    const spans = deltaSpans(before);
    const roots = spans.filter((span) => span.parentSpanId === null);
    expect(roots).toHaveLength(1);
    // A 2xx request span stays UNSET per semantic convention — only errors
    // are marked ERROR by the span owner.
    expect(roots[0]!.status).toBe("unset");
    const children = spans.filter((span) => span.parentSpanId !== null);
    expect(children.length).toBeGreaterThanOrEqual(1);
    expect(children[0]!.parentSpanId).toBe(roots[0]!.spanId);
  });

  it("server-root policy: an inbound traceparent never parents the server span", async () => {
    const { status, before } = await runRequest("/w12/ordinary", {
      traceparent: CLIENT_TRACEPARENT,
    });
    expect(status).toBe(200);
    const spans = deltaSpans(before);
    // No span at all may sit on the client's trace.
    expect(spans.filter((span) => span.traceId === CLIENT_TRACE_ID)).toEqual(
      [],
    );
    const roots = spans.filter((span) => span.parentSpanId === null);
    expect(roots).toHaveLength(1);
    expect(roots[0]!.traceId).not.toBe(CLIENT_TRACE_ID);
  });

  it("scrubs raw URL material: no marker, route template as url.path", async () => {
    const { status, before } = await runRequest(
      `/w12/ordinary?secret=${MARKER}`,
    );
    expect(status).toBe(200);
    const unrouted = await runRequest(`/w12/nowhere?secret=${MARKER}`);
    expect(unrouted.status).toBe(404);
    const spans = [...deltaSpans(before), ...deltaSpans(unrouted.before)];
    expect(spans.length).toBeGreaterThanOrEqual(2);
    for (const span of spans) {
      for (const [key, value] of Object.entries(span.attributes)) {
        expect(
          `${key}=${String(value)}`,
          `span ${span.name} attribute ${key} leaked raw query material`,
        ).not.toContain(MARKER);
      }
    }
    const routed = spans.filter(
      (span) => span.attributes["http.route"] === "/w12/ordinary",
    );
    expect(routed.length).toBeGreaterThanOrEqual(1);
    expect(routed[0]!.attributes["url.path"]).toBe("/w12/ordinary");
    expect("url.query" in routed[0]!.attributes).toBe(false);
    expect("url.full" in routed[0]!.attributes).toBe(false);
    // Unrouted path: no client-controlled bytes survive.
    const unroutedSpans = deltaSpans(unrouted.before).filter(
      (span) => span.attributes["url.path"] !== undefined,
    );
    for (const span of unroutedSpans) {
      expect(span.attributes["url.path"]).toBe("(unrouted)");
    }
  });

  it("error path: a throwing handler produces an error-status server span", async () => {
    const { status, before } = await runRequest("/w12/boom");
    expect(status).toBe(500);
    const roots = deltaSpans(before).filter(
      (span) => span.parentSpanId === null,
    );
    expect(roots).toHaveLength(1);
    expect(roots[0]!.status).toBe("error");
  });

  it("pino correlation and ADR-025 response id: stdout lines carry the server span ids under the request id", async () => {
    if (!handle) throw new Error("session not started");
    const harness = await buildApp(handle.fastifyOtelPlugin);
    let headerRequestId = "";
    let before = 0;
    await withServer(harness, async (base) => {
      before = getRetainedSpansForDiagnostics().length;
      const response = await fetch(`${base}/w12/ordinary`);
      headerRequestId = response.headers.get("x-request-id") ?? "";
      expect(headerRequestId).toMatch(UUID_V4);
    });
    await flushRetainedSpansForDiagnostics();
    const spans = deltaSpans(before);
    const logs = parseLogLines(harness);
    const completed = logs.filter((line) => line.msg === "request completed");
    expect(completed.length).toBeGreaterThanOrEqual(1);
    expect(completed[0]!.reqId).toBe(headerRequestId);
    const traceId = completed[0]!.trace_id;
    expect(typeof traceId).toBe("string");
    expect(traceId).not.toBe("0".repeat(32));
    expect(
      spans.some(
        (span) =>
          span.traceId === traceId && span.spanId === completed[0]!.span_id,
      ),
    ).toBe(true);
  });
});
