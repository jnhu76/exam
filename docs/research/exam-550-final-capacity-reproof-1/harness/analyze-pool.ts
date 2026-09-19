/**
 * #550 pool decomposition analysis (RESEARCH ONLY) — corrective-1 shape.
 *
 * Consumes results/<run_id>/pool.jsonl + samples.jsonl and produces the
 * per-phase bottleneck decomposition used by 09-bottleneck-analysis.md.
 *
 * MEASUREMENT NEUTRALITY (EXAM-550-CORRECTIVE-1): the in-process research
 * instrumentation is arrival-count-only — per-statement in-flight/duration
 * are NOT_DIRECTLY_OBSERVABLE without triggering the lazy postgres.js Query.
 * Pool/queue evidence therefore comes from the SERVER side:
 *   - pg_stat_activity state counts (active + idle-in-transaction) at 200 ms
 *     — the DB execution-side truth; active ≥ pool max marks saturation;
 *   - lock-wait counts;
 *   - statement ARRIVAL counts from the funnel (sql.total deltas);
 *   - API process CPU/RSS/event-loop, host load/mem, PG container CPU.
 * Client request latency per phase comes from samples.jsonl (raw truth).
 *
 * Run from anywhere in the repo (paths derive from this file's location):
 *   pnpm --filter @exam/db exec tsx \
 *     "$HARNESS/analyze-pool.ts" results/<run_id> [...]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RESULTS_DIR } from "./lib/config.js";
import { percentile } from "./lib/summary.js";

interface PoolRec {
  ts: string;
  source: string;
  byState?: Record<string, number>;
  lockWaits?: number;
  phase?: string;
  snapshot?: {
    appMode?: string;
    rateLimit?: { enabled?: boolean };
    redis?: { configMode?: string | null; runtimeState?: string | null };
    sql: { total: number };
    pool: { max?: number | null };
    process: {
      rssBytes?: number;
      cpu: { userMs: number; systemMs: number; wallMs: number };
      eventLoop: { p50Ms: number; p90Ms: number } | null;
    };
  };
  dbCpuPercent?: number;
  load1?: string;
  memAvailableKb?: number;
}

function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  const out: T[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      /* skip */
    }
  }
  return out;
}

function analyze(dir: string): void {
  const pool = readJsonl<PoolRec>(join(dir, "pool.jsonl"));
  const phases: string[] = [];
  for (const r of pool) if (r.source === "phase") phases.push(r.phase ?? "");

  // Segment observations by phase markers.
  const segments = new Map<string, PoolRec[]>();
  let current = "pre";
  for (const r of pool) {
    if (r.source === "phase") {
      current = r.phase ?? "unknown";
      continue;
    }
    const arr = segments.get(current) ?? [];
    arr.push(r);
    segments.set(current, arr);
  }

  const out: Record<string, unknown> = { run_dir: dir, phases };

  // Run-level topology facts as measured (first research snapshot): these make
  // every pool-analysis.json self-describing about mode/limiter/Redis.
  const firstSnap = pool.find(
    (r) => r.source === "research" && r.snapshot,
  )?.snapshot;
  if (firstSnap) {
    out.measured_topology = {
      appMode: firstSnap.appMode ?? null,
      rateLimitEnabled: firstSnap.rateLimit?.enabled ?? null,
      redisConfigMode: firstSnap.redis?.configMode ?? null,
      redisRuntimeState: firstSnap.redis?.runtimeState ?? null,
      poolMax: firstSnap.pool?.max ?? null,
    };
  }

  const phaseStats: Record<string, unknown> = {};
  let prevSqlTotal: number | null = null;
  for (const [phase, recs] of segments) {
    const research = recs.filter((r) => r.source === "research" && r.snapshot);
    const pgstat = recs.filter((r) => r.source === "pgstat");
    const host = recs.filter((r) => r.source === "host");

    // Statement ARRIVALS in phase (neutral funnel counter deltas).
    let arrivals = 0;
    let cpuPct = 0;
    let eventLoopP90Max = 0;
    for (const r of research) {
      const s = r.snapshot!;
      const total = s.sql.total;
      if (prevSqlTotal !== null && total >= prevSqlTotal) {
        arrivals += total - prevSqlTotal;
      }
      prevSqlTotal = total;
      const c = s.process.cpu;
      if (c.wallMs > 0) {
        const pct = ((c.userMs + c.systemMs) / c.wallMs) * 100;
        cpuPct = Math.max(cpuPct, pct);
      }
      if (s.process.eventLoop) {
        eventLoopP90Max = Math.max(eventLoopP90Max, s.process.eventLoop.p90Ms);
      }
    }

    // Server-side DB execution evidence (pool max from the process config).
    const poolMax = firstSnap?.pool?.max ?? 10;
    const activeOf = (r: PoolRec): number =>
      (r.byState?.["active"] ?? 0) + (r.byState?.["idle in transaction"] ?? 0);
    const activeSamples = pgstat.map(activeOf);
    const pgActiveMax = activeSamples.length
      ? Math.max(...activeSamples)
      : null;
    // NOTE: the harness's own pg_stat sampler connection can add +1.
    const saturated = pgstat.filter((r) => activeOf(r) >= poolMax).length;

    phaseStats[phase] = {
      observations: recs.length,
      researchSamples: research.length,
      sqlArrivalsInPhase: arrivals,
      perStatementInFlight:
        "NOT_DIRECTLY_OBSERVABLE (neutral instrumentation; see pgActive*)",
      pgActiveMax,
      pgActiveSatFrac: pgstat.length
        ? Math.round((saturated / pgstat.length) * 1000) / 1000
        : 0,
      lockWaitsMax: pgstat.length
        ? Math.max(...pgstat.map((r) => r.lockWaits ?? 0))
        : null,
      apiCpuPctMax: Math.round(cpuPct * 10) / 10,
      eventLoopP90MaxMs: Math.round(eventLoopP90Max * 100) / 100,
      hostLoad1Max: host.length
        ? Math.max(...host.map((r) => Number(r.load1 ?? 0)))
        : null,
      memAvailableMinKb: host.length
        ? Math.min(...host.map((r) => r.memAvailableKb ?? Infinity))
        : null,
      dbCpuPctMax: host.length
        ? Math.max(...host.map((r) => r.dbCpuPercent ?? 0))
        : null,
    };
  }
  out.phases_detail = phaseStats;

  // Client latency per phase from samples (raw request truth).
  const samples = readJsonl<{
    phase: string;
    latency_ms: number;
    status: number;
    timeout: boolean;
    error_class: string | null;
    endpoint: string;
  }>(join(dir, "samples.jsonl"));
  if (samples.length) {
    const byPhase: Record<string, unknown> = {};
    for (const phase of new Set(samples.map((s) => s.phase))) {
      const arr = samples.filter((s) => s.phase === phase);
      const lat = arr.map((s) => s.latency_ms).sort((a, b) => a - b);
      byPhase[phase] = {
        requests: arr.length,
        p50: percentile(lat, 50),
        p95: percentile(lat, 95),
        p99: percentile(lat, 99),
        max: lat.at(-1) ?? 0,
        err429: arr.filter((s) => s.status === 429).length,
        err5xx: arr.filter((s) => s.status >= 500).length,
        timeouts: arr.filter((s) => s.timeout).length,
      };
    }
    out.client_latency = byPhase;
  }

  writeFileSync(
    join(dir, "pool-analysis.json"),
    JSON.stringify(out, null, 2) + "\n",
  );
  console.log(`✓ ${dir}/pool-analysis.json`);
}

/**
 * Cross-run markdown table (docs embed this; numbers are never hand-copied).
 * Reads the pool-analysis.json files written by the analyze() pass above.
 */
function crossRunTable(dirs: string[]): void {
  const rows: string[] = [
    "# Generated by harness/analyze-pool.ts — do not edit by hand",
    "",
    "Pool decomposition per run × phase (corrective-1 neutral mechanism).",
    "`arrivals` = statement arrivals at the drizzle→postgres.js funnel (neutral",
    "counter); `pgActiveMax` = max server-side active + idle-in-transaction",
    "sessions (pg_stat_activity, 200 ms sampling; includes the harness's own",
    "sampler connection, so pool_max+1 is possible); `satFrac` = fraction of",
    "pgstat samples with pgActive ≥ pool max (10) — server-side saturation;",
    "`apiCpu%` = API process CPU peak over poll intervals (100% = 1 core;",
    "multi-thread argon2 bursts legitimately reach ~900%); `elP90` = API",
    "event-loop-delay p90 within the phase. Per-statement in-flight and",
    "client-side duration are NOT_DIRECTLY_OBSERVABLE (EXAM-550-CORRECTIVE-1).",
    "",
    "| run | phase | arrivals | pgActiveMax | satFrac | lockWaits | apiCpu% | elP90 | dbCpu% |",
    "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  ];
  for (const dir of dirs) {
    const path = join(dir, "pool-analysis.json");
    if (!existsSync(path)) continue;
    const a = JSON.parse(readFileSync(path, "utf8")) as {
      phases_detail: Record<string, Record<string, number | null>>;
    };
    const label = dir.split("/").pop() ?? dir;
    for (const [phase, v] of Object.entries(a.phases_detail)) {
      if (
        ![
          "LOGIN_BURST",
          "START_BURST",
          "STEADY",
          "RECONNECT_RESTORE",
          "SUBMIT_BURST",
        ].includes(phase)
      )
        continue;
      rows.push(
        `| ${label} | ${phase} | ${v.sqlArrivalsInPhase} | ${v.pgActiveMax} | ${v.pgActiveSatFrac} | ${v.lockWaitsMax} | ${v.apiCpuPctMax} | ${v.eventLoopP90MaxMs} | ${v.dbCpuPctMax ?? "—"} |`,
      );
    }
  }
  const mdFile = join(RESULTS_DIR, "pool-decomposition.md");
  writeFileSync(mdFile, rows.join("\n") + "\n");
  console.log(`✓ ${mdFile}`);
}

const dirsArg = process.argv.slice(2);
for (const dir of dirsArg) {
  try {
    analyze(dir);
  } catch (err) {
    console.error(`skip ${dir}: ${String(err)}`);
  }
}
if (dirsArg.length > 0) {
  try {
    crossRunTable(dirsArg);
  } catch (err) {
    console.error(`cross-run table failed: ${String(err)}`);
  }
}
