import { monitorEventLoopDelay } from "node:perf_hooks";
import { heartbeatMetrics } from "../plugins/heartbeat.js";
import { deadlineScannerMetrics } from "../plugins/deadlineScanner.js";
import type postgres from "postgres";
import type { RedisRuntime } from "../redis/redisRuntime.js";
import { getRuntimeConfig } from "../config/runtimeConfig.js";

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
 *
 * MEASUREMENT NEUTRALITY (#550 corrective 1): postgres.js v3 Query objects are
 * LAZY thenables — calling then/catch/finally (including the implicit `.then`
 * that `Promise.resolve(thenable)` attaches) submits the query for execution.
 * The wrapper therefore MUST NOT touch the returned Query in any way: it only
 * counts statement arrivals synchronously and forwards the original Query.
 * Per-statement in-flight/duration/error observation is
 * NOT_DIRECTLY_OBSERVABLE without triggering execution and is reported as
 * such; execution-side evidence comes from the external pg_stat_activity
 * sampler and pool-config facts instead.
 */
export function isCapacityResearchEnabled(): boolean {
  return process.env.CAPACITY_RESEARCH === "1";
}

const state = {
  enabledAt: null as Date | null,
  sqlTotal: 0,
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
    // Return the ORIGINAL Query untouched. Attaching then/catch/finally —
    // directly or via Promise.resolve/await of the returned value here —
    // would eagerly submit the lazy Query for execution and change statement
    // ordering and pool-acquisition timing.
    return orig(...args);
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
 * `sql.total` counts statement arrivals at the drizzle→postgres.js funnel
 * since process start. Pool internals are read defensively because postgres.js
 * does not commit to a public introspection API. CPU deltas cover the interval
 * since the previous snapshot call. Redis/runtime facts make every research
 * snapshot self-describing about the topology it measured.
 */
export function getCapacityResearchSnapshot(
  redisRuntime?: RedisRuntime,
): Record<string, unknown> {
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

  const config = getRuntimeConfig();
  return {
    enabledAt: state.enabledAt?.toISOString() ?? null,
    uptimeSec: state.enabledAt
      ? Math.round((Date.now() - state.enabledAt.getTime()) / 1000)
      : 0,
    appMode: config.app.mode,
    rateLimit: { enabled: config.rateLimit.enabled },
    redis: {
      configMode: config.redis.mode,
      runtimeState: redisRuntime ? redisRuntime.state : null,
    },
    sql: {
      total: state.sqlTotal,
      // Measurement-neutrality law (#550 corrective 1): observing a lazy
      // Query's completion requires attaching handlers, which submits it for
      // execution. These facets are therefore not observed in-process; the
      // server-side pg_stat_activity sampler is the execution-side evidence.
      inFlight: "NOT_DIRECTLY_OBSERVABLE",
      maxInFlight: "NOT_DIRECTLY_OBSERVABLE",
      errors: "NOT_DIRECTLY_OBSERVABLE",
      durationMsTotal: "NOT_DIRECTLY_OBSERVABLE",
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
