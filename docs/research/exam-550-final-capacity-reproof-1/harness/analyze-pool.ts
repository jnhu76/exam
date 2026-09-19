/**
 * #550 pool decomposition analysis (RESEARCH ONLY).
 *
 * Consumes results/<run_id>/pool.jsonl + samples.jsonl and produces the
 * per-phase bottleneck decomposition used by 09-bottleneck-analysis.md:
 *   - in-process statement funnel: total queries, duration, max in-flight
 *   - pool saturation: fraction of research snapshots with in-flight >= 10
 *   - pool wait proxy: in-flight − server-side active (pgstat)
 *   - host: load1 / MemAvailable / PG container CPU peaks per phase
 *   - client latency p95 per phase (from samples.jsonl)
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
  phase?: string;
  snapshot?: {
    sql: {
      total: number;
      inFlight: number;
      maxInFlight: number;
      durationMsTotal: number;
    };
    pool: { max?: number | null };
    process: {
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
  let prevSql = { total: 0, durationMsTotal: 0 };
  const phaseStats: Record<string, unknown> = {};
  for (const [phase, recs] of segments) {
    const research = recs.filter((r) => r.source === "research" && r.snapshot);
    const pgstat = recs.filter((r) => r.source === "pgstat");
    const host = recs.filter((r) => r.source === "host");
    let sqlTotal = 0;
    let sqlMs = 0;
    let maxInFlight = 0;
    let saturated = 0;
    let waitProxySum = 0;
    let waitProxyN = 0;
    let cpuPct = 0;
    for (const r of research) {
      const s = r.snapshot!;
      sqlTotal = s.sql.total - prevSql.total;
      sqlMs = s.sql.durationMsTotal - prevSql.durationMsTotal;
      prevSql = { total: s.sql.total, durationMsTotal: s.sql.durationMsTotal };
      maxInFlight = Math.max(maxInFlight, s.sql.inFlight);
      const max = s.pool.max ?? 10;
      if (s.sql.inFlight >= max) saturated += 1;
      // Snapshot cpu values are per-poll-interval deltas — use directly.
      // 100% == one core; the process is multi-threaded (libuv threadpool),
      // so burst phases legitimately exceed 100%.
      const c = s.process.cpu;
      if (c.wallMs > 0) {
        const pct = ((c.userMs + c.systemMs) / c.wallMs) * 100;
        cpuPct = Math.max(cpuPct, pct);
      }
    }
    for (const r of research) {
      const s = r.snapshot!;
      // pool wait proxy: match in-flight with the nearest pgstat sample
      void s;
    }
    const activeByTs = new Map<string, number>();
    for (const r of pgstat) {
      activeByTs.set(
        r.ts,
        (r.byState?.["active"] ?? 0) +
          (r.byState?.["idle in transaction"] ?? 0),
      );
    }
    for (const r of research) {
      const s = r.snapshot!;
      const nearest = pgstat.reduce(
        (best, p) => {
          const d = Math.abs(Date.parse(p.ts) - Date.parse(r.ts));
          const bd = best
            ? Math.abs(Date.parse(best.ts) - Date.parse(r.ts))
            : Infinity;
          return d < bd ? p : best;
        },
        null as PoolRec | null,
      );
      if (nearest) {
        const active =
          (nearest.byState?.["active"] ?? 0) +
          (nearest.byState?.["idle in transaction"] ?? 0);
        const wait = Math.max(0, s.sql.inFlight - active);
        waitProxySum += wait;
        waitProxyN += 1;
      }
      void activeByTs;
    }
    phaseStats[phase] = {
      observations: recs.length,
      researchSamples: research.length,
      sqlQueriesInPhase: sqlTotal,
      sqlDurationMsInPhase: Math.round(sqlMs),
      maxInFlight,
      saturatedFraction: research.length
        ? Math.round((saturated / research.length) * 1000) / 1000
        : 0,
      apiCpuPctMax: Math.round(cpuPct * 10) / 10,
      pgActiveMax: pgstat.length
        ? Math.max(...pgstat.map((r) => r.byState?.["active"] ?? 0))
        : null,
      lockWaitsMax: pgstat.length
        ? Math.max(...pgstat.map((r) => r.lockWaits ?? 0))
        : null,
      poolWaitProxyMean: waitProxyN
        ? Math.round((waitProxySum / waitProxyN) * 100) / 100
        : null,
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

const mdFile = join(RESULTS_DIR, "pool-decomposition.md");

/**
 * Cross-run markdown table (docs embed this; numbers are never hand-copied).
 * Reads the pool-analysis.json files written by the analyze() pass above.
 */
function crossRunTable(dirs: string[]): void {
  const rows: string[] = [
    "# Generated by harness/analyze-pool.ts — do not edit by hand",
    "",
    "Pool decomposition per run × phase. `satFrac` = fraction of research",
    "snapshots with funnel in-flight ≥ pool max (10); `poolWaitMean` = mean",
    "(funnel in-flight − pg_active) in statements — pool-queue depth proxy;",
    "`apiCpu%` = API process CPU peak over poll intervals (100% = 1 core;",
    "multi-thread argon2 bursts legitimately reach ~900%); `pgActive` includes",
    "the harness's own pg_stat sampler connection (so N_pool+1 is possible).",
    "",
    "| run | phase | satFrac | maxInFlight | poolWaitMean | apiCpu% | pgActiveMax | lockWaits | dbCpu% |",
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
        `| ${label} | ${phase} | ${v.saturatedFraction} | ${v.maxInFlight} | ${v.poolWaitProxyMean} | ${v.apiCpuPctMax} | ${v.pgActiveMax} | ${v.lockWaitsMax} | ${v.dbCpuPctMax ?? "—"} |`,
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
