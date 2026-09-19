/**
 * #550 harness summary computation (RESEARCH ONLY).
 * All summaries derive from raw samples — no hand-copied numbers (#23).
 */
import type { HttpResponse, SampleRecord } from "./http.js";
import { errorClassOf } from "./http.js";

export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.max(
    0,
    Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return Math.round(sorted[idx] * 10) / 10;
}

export interface PhaseSummary {
  requests: number;
  success: number;
  semanticErrors: number;
  rateLimited429: number;
  server5xx: number;
  timeouts: number;
  connErrors: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
  max: number;
  wallMs: number;
  errorClasses: Record<string, number>;
}

export function summarizePhase(
  phase: string,
  results: HttpResponse[],
  wallStartMs: number,
): PhaseSummary {
  const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
  const errorClasses: Record<string, number> = {};
  for (const r of results) {
    const c = errorClassOf(r);
    if (c) errorClasses[c] = (errorClasses[c] ?? 0) + 1;
  }
  const ok = results.filter((r) => r.status >= 200 && r.status < 300).length;
  const semantic = results.filter(
    (r) => r.status >= 400 && r.status < 500 && r.status !== 429,
  ).length;
  const wall = results.at(-1)?.latencyMs;
  return {
    requests: results.length,
    success: ok,
    semanticErrors: semantic,
    rateLimited429: results.filter((r) => r.status === 429).length,
    server5xx: results.filter((r) => r.status >= 500).length,
    timeouts: results.filter((r) => r.timedOut).length,
    connErrors: results.filter((r) => r.status === 0 && !r.timedOut).length,
    p50: percentile(latencies, 50),
    p90: percentile(latencies, 90),
    p95: percentile(latencies, 95),
    p99: percentile(latencies, 99),
    max: latencies.at(-1) ?? 0,
    wallMs: wall ?? Date.now() - wallStartMs,
    errorClasses,
  };
}

export function sampleFrom(
  r: HttpResponse,
  base: Omit<
    SampleRecord,
    "ts" | "status" | "latency_ms" | "error_class" | "timeout"
  >,
): SampleRecord {
  return {
    ...base,
    ts: new Date().toISOString(),
    status: r.status,
    latency_ms: Math.round(r.latencyMs * 10) / 10,
    error_class: errorClassOf(r),
    timeout: r.timedOut,
  };
}
