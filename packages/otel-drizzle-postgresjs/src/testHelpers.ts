/**
 * Shared harness for the plugin's real-PG suites (excluded from the build).
 *
 * Pattern notes:
 * - Spans are scoped per SCENARIO: each scenario runs inside a unique
   active root span, and assertions read only the descendants of that trace.
   This keeps the process-global patch's noise (the vitest harness's own
   queries run through the same prototype) out of every assertion, and it
   simultaneously exercises the async-context parenting contract.
 * - Counters are asserted as DELTAS around a scenario for the same reason.
 * - Concurrency fixtures reuse the proven schedules of
 *   packages/db/src/transactionRetry.test.ts (deferred gates + bounded
 *   pg_locks polling — no fixed sleeps).
 */
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
  TracerProvider,
  type ReadableSpan,
} from "@opentelemetry/sdk-trace";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { context, trace, type Span } from "@opentelemetry/api";
import postgres from "postgres";
import { createDatabase, type DatabaseConnection } from "@exam/db/database";
import { schema } from "@exam/db/schema/pg";
import type { Database } from "@exam/db/types";
import type { OtelDbTelemetryDiagnostics } from "./index.js";
import { installOtelDbTelemetry } from "./index.js";

/** Synthetic strings that must never appear in span names or attributes. */
export const SQL_TEXT_MARKER = "W22-SQLTEXT-MARKER";
export const PARAM_VALUE_MARKER = "w22-param-value-marker";

/** Span capture bound to one global provider (fresh per test-file process). */
export interface SpanCapture {
  exporter: InMemorySpanExporter;
  provider: TracerProvider;
  /** All spans finished so far, across every scenario in the file. */
  all(): readonly ReadableSpan[];
}

export function startSpanCapture(): SpanCapture {
  const exporter = new InMemorySpanExporter();
  // sdk-trace 3.x: processors go through the constructor; global
  // registration is the raw API pair (provider + async context manager) —
  // without the context manager the ambient parenting assertions would
  // have nothing to propagate.
  const provider = new TracerProvider({
    spanProcessors: [new SimpleSpanProcessor({ exporter })],
  });
  trace.setGlobalTracerProvider(provider);
  context.setGlobalContextManager(new AsyncLocalStorageContextManager());
  return { exporter, provider, all: () => exporter.getFinishedSpans() };
}

export interface ScenarioSpans {
  root: Span;
  spans(): readonly ReadableSpan[];
}

/**
 * Runs `body` inside a uniquely-named active root span and returns a reader
 * over the finished spans of that scenario's trace only.
 */
export async function inScenario<T>(
  capture: SpanCapture,
  name: string,
  body: () => Promise<T>,
): Promise<{ result: T; spans: () => readonly ReadableSpan[] }> {
  const tracer = trace.getTracer("otel-db-plugin-test");
  return tracer.startActiveSpan(name, async (root: Span) => {
    const traceId = root.spanContext().traceId;
    try {
      const result = await body();
      return {
        result,
        spans: () =>
          capture.all().filter((s) => s.spanContext().traceId === traceId),
      };
    } finally {
      root.end();
    }
  });
}

export function spansByName(
  spans: readonly ReadableSpan[],
): Map<string, ReadableSpan[]> {
  const map = new Map<string, ReadableSpan[]>();
  for (const span of spans) {
    const list = map.get(span.name) ?? [];
    list.push(span);
    map.set(span.name, list);
  }
  return map;
}

/** Attribute keys the plugin is allowed to emit at all (vocabulary closure). */
export const ALLOWED_ATTRIBUTE_KEYS = new Set([
  "db.system",
  "db.response.status_code",
  "exam.db.connection.role",
  "exam.db.outcome",
  "exam.db.tx.attempt",
  "exam.db.tx.isolation_level",
  "exam.db.tx.retry.failed_attempt",
]);

/**
 * Installs the plugin against the global tracer (registered by the suite's
 * span capture) and tags the given pool as a root connection.
 */
export function installWithRootPool(
  sql: postgres.Sql,
): ReturnType<typeof installOtelDbTelemetry> {
  const handle = installOtelDbTelemetry();
  handle.registerRootConnection(sql);
  return handle;
}

export function snapshotDiagnostics(
  handle: ReturnType<typeof installOtelDbTelemetry>,
): OtelDbTelemetryDiagnostics {
  return handle.diagnostics();
}

export function deltaDiagnostics(
  before: OtelDbTelemetryDiagnostics,
  after: OtelDbTelemetryDiagnostics,
): OtelDbTelemetryDiagnostics {
  const byRole: Record<string, number> = {};
  for (const key of new Set([
    ...Object.keys(before.byRole),
    ...Object.keys(after.byRole),
  ])) {
    const delta = (after.byRole[key] ?? 0) - (before.byRole[key] ?? 0);
    if (delta !== 0) byRole[key] = delta;
  }
  return {
    submissions: after.submissions - before.submissions,
    settles: after.settles - before.settles,
    errors: after.errors - before.errors,
    byRole,
    scopedClosures: after.scopedClosures - before.scopedClosures,
  };
}

/** The 3.x ReadableSpan carries the parent as a span context, not an id. */
export function parentSpanIdOf(span: ReadableSpan): string | undefined {
  return span.parentSpanContext?.spanId;
}

/** Instrumented pool: max-3 connections + per-connection search_path. */
export interface InstrumentedPool {
  sql: postgres.Sql;
  db: Database;
}

export type { DatabaseConnection };
