import { monitorEventLoopDelay } from "node:perf_hooks";
import { heartbeatMetrics } from "../plugins/heartbeat.js";
import { deadlineScannerMetrics } from "../plugins/deadlineScanner.js";
import type postgres from "postgres";

/**
 * RESEARCH-ONLY capacity instrumentation for the #550 evidence campaign.
 *
 * INVARIANT: everything here is inert unless CAPACITY_RESEARCH=1 is set in the
 * process environment. When unset: no wrapper is installed, no state exists,
 * and the research route is not registered — production behavior is byte-for-
 * byte unchanged. When set: the wrapper only OBSERVES the single
 * drizzle→postgres.js statement funnel (`sql.unsafe`) — it forwards arguments
 * and results untouched and never alters error flow, so measured query
 * behavior is the production path's.
 */
export function isCapacityResearchEnabled(): boolean {
  return process.env.CAPACITY_RESEARCH === "1";
}

const state = {
  enabledAt: null as Date | null,
  sqlTotal: 0,
  sqlErrors: 0,
  sqlInFlight: 0,
  sqlMaxInFlight: 0,
  sqlDurationMsTotal: 0,
  sql: null as postgres.Sql | null,
  eventLoop: null as ReturnType<typeof monitorEventLoopDelay> | null,
  lastCpu: process.cpuUsage(),
  lastCpuAt: Date.now(),
};

/** Installs the observation-only wrapper. Called once from the db plugin. */
export function installCapacityResearchInstrumentation(
  sql: postgres.Sql,
): void {
  state.enabledAt = new Date();
  state.sql = sql;
  state.eventLoop = monitorEventLoopDelay({ resolution: 1 });
  state.eventLoop.enable();

  const orig = sql.unsafe.bind(sql);
  const instrumented = (...args: Parameters<typeof orig>) => {
    state.sqlTotal += 1;
    state.sqlInFlight += 1;
    state.sqlMaxInFlight = Math.max(state.sqlMaxInFlight, state.sqlInFlight);
    const started = performance.now();
    const result = orig(...args);
    void Promise.resolve(result)
      .catch(() => {
        state.sqlErrors += 1;
      })
      .finally(() => {
        state.sqlInFlight -= 1;
        state.sqlDurationMsTotal += performance.now() - started;
      });
    return result;
  };
  sql.unsafe = instrumented as typeof sql.unsafe;
}

function percentileFromHistogram(
  h: NonNullable<typeof state.eventLoop>,
  p: number,
): number {
  // monitorEventLoopDelay percentiles are computed over the samples since the
  // last reset; the caller resets per snapshot window.
  const ns = h.percentile(p) / 1_000_000;
  return Math.round(ns * 100) / 100;
}

/**
 * Counters are cumulative since process start; pool internals are read
 * defensively because postgres.js does not commit to a public introspection
 * API. CPU deltas cover the interval since the previous snapshot call.
 */
export function getCapacityResearchSnapshot(): Record<string, unknown> {
  const sql = state.sql;
  const pool: Record<string, unknown> = { observedFields: [] };
  if (sql) {
    const options = sql.options as {
      max?: number;
      idle_timeout?: number | null;
      max_lifetime?: number | string | null;
    };
    pool.max = options.max ?? null;
    // Connection-lifetime rotation observation (#550 §19): postgres.js
    // max_lifetime accepts seconds (number) or a randomization spec string;
    // record exactly what this process is running with.
    pool.idleTimeoutMs = options.idle_timeout ?? null;
    pool.maxLifetime = options.max_lifetime ?? null;
    const seen: string[] = [];
    for (const key of ["reserved", "available", "pending"] as const) {
      const value = (
        sql as unknown as Record<string, unknown | { count?: number }>
      )[key];
      if (value !== undefined) {
        seen.push(key);
        pool[key] =
          typeof value === "number"
            ? value
            : typeof (value as { count?: number })?.count === "number"
              ? (value as { count: number }).count
              : Array.isArray(value)
                ? value.length
                : null;
      }
    }
    pool.observedFields = seen;
  }

  const nowCpu = process.cpuUsage();
  const nowAt = Date.now();
  const cpuDelta = {
    userMs: (nowCpu.user - state.lastCpu.user) / 1000,
    systemMs: (nowCpu.system - state.lastCpu.system) / 1000,
    wallMs: nowAt - state.lastCpuAt,
  };
  state.lastCpu = nowCpu;
  state.lastCpuAt = nowAt;

  const eventLoopWindow = (() => {
    const h = state.eventLoop;
    if (!h) return null;
    const out = {
      sampleCount: h.count,
      p50Ms: percentileFromHistogram(h, 50),
      p90Ms: percentileFromHistogram(h, 90),
      maxMs: percentileFromHistogram(h, 100),
    };
    h.reset();
    return out;
  })();

  return {
    enabledAt: state.enabledAt?.toISOString() ?? null,
    uptimeSec: state.enabledAt
      ? Math.round((Date.now() - state.enabledAt.getTime()) / 1000)
      : 0,
    sql: {
      total: state.sqlTotal,
      errors: state.sqlErrors,
      inFlight: state.sqlInFlight,
      maxInFlight: state.sqlMaxInFlight,
      durationMsTotal: Math.round(state.sqlDurationMsTotal * 10) / 10,
    },
    pool,
    process: {
      pid: process.pid,
      rssBytes: process.memoryUsage().rss,
      heapUsedBytes: process.memoryUsage().heapUsed,
      cpu: cpuDelta,
      eventLoop: eventLoopWindow,
    },
    heartbeat: serializeMetrics(heartbeatMetrics),
    deadlineScanner: serializeMetrics(deadlineScannerMetrics),
  };
}

function serializeMetrics(
  metrics: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(metrics).map(([k, v]) => [
      k,
      v instanceof Date ? v.toISOString() : v,
    ]),
  );
}
