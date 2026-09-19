/**
 * #550 connection-lifetime rotation analysis (RESEARCH ONLY).
 *
 * Consumes a soak run's pool.jsonl (`connections` records appended by
 * run-soak.ts's pg_stat_activity watcher at 10 s cadence) + samples.jsonl,
 * and derives the rotation evidence used by 05-long-lived-data.md:
 *   - distinct backend PIDs observed over the soak window and their
 *     (pid, backend_start) lifetime spans;
 *   - rotation events: a pid disappearing and the pool count being restored
 *     by a new pid with a fresh backend_start;
 *   - whether any save/heartbeat request failed (>=500, timeout, network
 *     error) inside a ±60 s window around each rotation.
 *
 * Run from anywhere in the repo (paths derive from this file's location):
 *   HARNESS=$(git rev-parse --show-toplevel)/docs/research/exam-550-final-capacity-reproof-1/harness
 *   pnpm --filter @exam/db exec tsx "$HARNESS/analyze-rotation.ts" results/<run_id>
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface ConnRec {
  ts: string;
  source: "connections";
  connections: { pid: number; backendStart: string; state: string }[];
}

interface Sample {
  phase: string;
  endpoint: string;
  status: number;
  latency_ms: number;
  timeout: boolean;
  error_class: string | null;
  ts: string;
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
  const conns = readJsonl<ConnRec>(join(dir, "pool.jsonl")).filter(
    (r) => r.source === "connections",
  );
  const samples = readJsonl<Sample>(join(dir, "samples.jsonl"));
  if (conns.length === 0)
    throw new Error("no connections records in pool.jsonl");

  // Per-pid lifecycle: first-seen / last-seen timestamps + backend_start.
  const pids = new Map<
    number,
    {
      backendStart: string;
      firstSeen: string;
      lastSeen: string;
      samples: number;
    }
  >();
  for (const rec of conns) {
    for (const c of rec.connections) {
      const cur = pids.get(c.pid);
      if (!cur) {
        pids.set(c.pid, {
          backendStart: c.backendStart,
          firstSeen: rec.ts,
          lastSeen: rec.ts,
          samples: 1,
        });
      } else {
        cur.lastSeen = rec.ts;
        cur.samples += 1;
        if (cur.backendStart !== c.backendStart)
          throw new Error(
            `pid ${c.pid} backend_start changed without pid change`,
          );
      }
    }
  }

  // Pool size timeline: the API pool is max=10, but pg_stat_activity also
  // contains other clients (harness connection, admin psql). Count only
  // connections that look like the API pool: we report the full histogram.
  const sizeHist = new Map<number, number>();
  for (const rec of conns) {
    const n = rec.connections.length;
    sizeHist.set(n, (sizeHist.get(n) ?? 0) + 1);
  }

  // Rotation events: a pid's lastSeen passes and it never returns, while a
  // pid not seen before appears afterwards.
  const lastTs = conns.at(-1)!.ts;
  const retired = [...pids.entries()]
    .filter(([, v]) => v.lastSeen < lastTs)
    .map(([pid, v]) => ({ pid, ...v }));
  const bornLate = [...pids.entries()]
    .filter(
      ([pid, v]) =>
        !retired.some((r) => r.pid === pid) && v.firstSeen > conns[0].ts,
    )
    .map(([pid, v]) => ({ pid, ...v }));

  // Errors inside ±60 s of each retirement (rotation window).
  const SOAK_ERR = (s: Sample) =>
    s.status >= 500 || s.timeout || s.error_class !== null;
  const rotationWindows = retired.map((r) => {
    const t = Date.parse(r.lastSeen);
    const inWindow = samples.filter(
      (s) => Math.abs(Date.parse(s.ts) - t) <= 60_000,
    );
    return {
      retiredPid: r.pid,
      backendStart: r.backendStart,
      lastSeen: r.lastSeen,
      windowRequests: inWindow.length,
      windowErrors: inWindow.filter(SOAK_ERR).length,
    };
  });

  const totalReq = samples.filter((s) => s.phase === "SOAK");
  const out = {
    run_dir: dir,
    soakWindow: { first: conns[0].ts, last: lastTs },
    connectionRecords: conns.length,
    distinctPids: pids.size,
    poolSizeHistogram: Object.fromEntries([...sizeHist.entries()].sort()),
    pids: [...pids.entries()]
      .map(([pid, v]) => ({ pid, ...v }))
      .sort((a, b) => Date.parse(a.backendStart) - Date.parse(b.backendStart)),
    retiredPids: retired.sort((a, b) => a.pid - b.pid),
    bornLatePids: bornLate.sort((a, b) => a.pid - b.pid),
    rotationWindows,
    soakTotals: {
      requests: totalReq.length,
      errors5xx: totalReq.filter((s) => s.status >= 500).length,
      timeouts: totalReq.filter((s) => s.timeout).length,
      networkErrors: totalReq.filter((s) => s.error_class !== null).length,
      p50: percentile(
        totalReq.map((s) => s.latency_ms),
        50,
      ),
      p99: percentile(
        totalReq.map((s) => s.latency_ms),
        99,
      ),
      max: Math.max(...totalReq.map((s) => s.latency_ms), 0),
    },
    errorsNearRotation: rotationWindows.reduce((a, r) => a + r.windowErrors, 0),
  };

  writeFileSync(
    join(dir, "rotation-analysis.json"),
    JSON.stringify(out, null, 2) + "\n",
  );
  console.log(`✓ ${dir}/rotation-analysis.json`);
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const s = [...sortedAsc].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1);
  return Math.round(s[idx] * 10) / 10;
}

const dir = process.argv[2];
if (!dir) {
  console.error("usage: tsx analyze-rotation.ts results/<run_id>");
  process.exit(1);
}
analyze(dir);
