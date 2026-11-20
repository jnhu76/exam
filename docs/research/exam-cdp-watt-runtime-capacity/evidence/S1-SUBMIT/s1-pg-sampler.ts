/**
 * S1-SUBMIT PG 执行侧采样器（RESEARCH ONLY，协议 §6 S1 核心读数：
 * 「事务时长、PG lock wait 与阻塞者」的执行侧证据）。
 *
 * 以独立 PG 连接（不经 API 进程、不占其 postgres.js 池）每 --interval-ms
 * 快照一次 pg_stat_activity：活跃会话的 wait_event_type/wait_event、
 * xact_start（→ 事务已运行时长）、query 摘要与 pg_blocking_pids 阻塞者。
 *
 * 已知观测边界（如实随产物记录）：
 *  - 事务时长为采样下界——短于采样间隔的事务可能整段错过；观测到的
 *    xact 年龄分布偏向较长事务；
 *  - 与 API 进程内语句无法逐条对应（capacityResearch 的 measurement
 *    neutrality law 禁止进程内观测），归因靠 query 文本与时间窗。
 *
 * 用法（由 s1-run.sh 背景启动；stop-file 停止并写汇总）：
 *   pnpm -C /home/hoo/Source/exam/.wt-capacity --filter @exam/db exec tsx \
 *     evidence/S1-SUBMIT/s1-pg-sampler.ts --out-dir=<runDir> \
 *     --ready-file=<f> --stop-file=<f> [--interval-ms=250] [--max-seconds=900]
 */
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createDatabase } from "../../../../../packages/db/src/database.js";
import { RUN_DB_URL, args } from "../../harness/lib/config.js";

const OUT_DIR = args()["out-dir"] ?? ".";
const READY_FILE = args()["ready-file"] ?? join(OUT_DIR, ".pg-sampler-ready");
const STOP_FILE = args()["stop-file"] ?? join(OUT_DIR, ".pg-sampler-stop");
const INTERVAL_MS = Number(args()["interval-ms"] ?? 250);
const MAX_SECONDS = Number(args()["max-seconds"] ?? 900);

mkdirSync(OUT_DIR, { recursive: true });

const conn = await createDatabase(RUN_DB_URL);
const dbCheck = (await conn.sql.unsafe(`SELECT current_database() AS db`)) as {
  db: string;
}[];
console.log(`[s1-pg-sampler] connected to ${dbCheck[0]!.db} (name-guarded ${RUN_DB_URL.split("/").pop()})`);

interface ActivityRow {
  pid: number;
  state: string;
  wait_event_type: string | null;
  wait_event: string | null;
  xact_start: string | null;
  query_start: string | null;
  xact_age_ms: number | null;
  query_age_ms: number | null;
  q: string;
  blockers: number[];
}

const POLL_SQL = `
SELECT pid, state,
       wait_event_type::text AS wait_event_type, wait_event::text AS wait_event,
       xact_start, query_start,
       CASE WHEN xact_start IS NOT NULL
            THEN GREATEST(0, EXTRACT(EPOCH FROM (clock_timestamp() - xact_start)) * 1000) END AS xact_age_ms,
       CASE WHEN query_start IS NOT NULL
            THEN GREATEST(0, EXTRACT(EPOCH FROM (clock_timestamp() - query_start)) * 1000) END AS query_age_ms,
       left(query, 200) AS q,
       pg_blocking_pids(pid) AS blockers
FROM pg_stat_activity
WHERE datname = current_database() AND pid <> pg_backend_pid()
  AND (state IS DISTINCT FROM 'idle' OR xact_start IS NOT NULL)
`;

const startedAt = performance.now();
const T0_EPOCH = Date.now();
let running = true;
let polls = 0;
let pollErrors = 0;
const txAgeMaxPerPid = new Map<number, number>();
const lockWaitByPid = new Map<number, { firstTMs: number; lastTMs: number; waitEvent: string; blockers: number[]; q: string; maxAgeMs: number }>();
const waitEventTally = new Map<string, number>();

async function poll(): Promise<void> {
  const tMs = Math.round(performance.now() - startedAt);
  let rows: Record<string, unknown>[];
  try {
    rows = (await conn.sql.unsafe(POLL_SQL)) as unknown as Record<string, unknown>[];
  } catch (err) {
    pollErrors += 1;
    if (pollErrors <= 3) console.error(`[s1-pg-sampler] poll error: ${String(err).slice(0, 120)}`);
    return;
  }
  polls += 1;
  const interesting: ActivityRow[] = [];
  for (const r of rows) {
    const pid = Number(r.pid);
    const age = r.xact_age_ms === null || r.xact_age_ms === undefined ? null : Math.round(Number(r.xact_age_ms));
    const row: ActivityRow = {
      pid,
      state: String(r.state ?? ""),
      wait_event_type: (r.wait_event_type as string) ?? null,
      wait_event: (r.wait_event as string) ?? null,
      xact_start: (r.xact_start as string) ?? null,
      query_start: (r.query_start as string) ?? null,
      xact_age_ms: age,
      query_age_ms: r.query_age_ms === null || r.query_age_ms === undefined ? null : Math.round(Number(r.query_age_ms)),
      q: String(r.q ?? "").trim(),
      blockers: Array.isArray(r.blockers) ? (r.blockers as number[]).map(Number) : [],
    };
    if (age !== null) txAgeMaxPerPid.set(pid, Math.max(txAgeMaxPerPid.get(pid) ?? 0, age));
    if (row.wait_event_type !== null) {
      waitEventTally.set(`${row.wait_event_type}:${row.wait_event}`, (waitEventTally.get(`${row.wait_event_type}:${row.wait_event}`) ?? 0) + 1);
    }
    if (row.wait_event_type === "Lock") {
      const prev = lockWaitByPid.get(pid);
      if (prev) {
        prev.lastTMs = tMs;
        prev.maxAgeMs = Math.max(prev.maxAgeMs, age ?? 0);
      } else {
        lockWaitByPid.set(pid, {
          firstTMs: tMs, lastTMs: tMs,
          waitEvent: `${row.wait_event_type}:${row.wait_event}`,
          blockers: row.blockers, q: row.q, maxAgeMs: age ?? 0,
        });
      }
    }
    if (row.state === "active" || row.wait_event_type === "Lock" || (age !== null && age > 0)) interesting.push(row);
  }
  appendFileSync(
    join(OUT_DIR, "pg-activity.jsonl"),
    JSON.stringify({ tMs, rows: interesting }) + "\n",
  );
}

writeFileSync(READY_FILE, `${Date.now()}\n`);
const timer = setTimeout(() => {
  console.error("[s1-pg-sampler] max-seconds reached — self stopping");
  running = false;
}, MAX_SECONDS * 1000);
if (typeof timer === "object" && timer && "unref" in timer) timer.unref();
process.on("SIGTERM", () => { running = false; });

while (running) {
  if (existsSync(STOP_FILE)) {
    console.log("[s1-pg-sampler] stop file observed");
    break;
  }
  const t0 = performance.now();
  await poll();
  const elapsed = performance.now() - t0;
  const sleepFor = Math.max(20, INTERVAL_MS - elapsed);
  await new Promise((r) => setTimeout(r, sleepFor));
}

// 汇总（事务时长分布 + lock wait 事件表）
const txAges = [...txAgeMaxPerPid.values()].sort((a, b) => a - b);
function pct(arr: number[], p: number): number | null {
  if (arr.length === 0) return null;
  return arr[Math.min(arr.length - 1, Math.floor((p / 100) * arr.length))];
}
const summary = {
  intervalMs: INTERVAL_MS,
  startedAtEpochMs: T0_EPOCH, // 宿主墙钟（pg-activity.jsonl 的 tMs 相对此刻）
  polls,
  pollErrors,
  windowSec: Math.round((performance.now() - startedAt) / 1000),
  txDuration: {
    note: "per-pid 观测到的最大 xact 年龄（ms）；250ms 采样的下界估计，短事务可能整段错过",
    distinctPids: txAges.length,
    p50Ms: pct(txAges, 50),
    p95Ms: pct(txAges, 95),
    p99Ms: pct(txAges, 99),
    maxMs: txAges.length ? txAges[txAges.length - 1] : null,
    sortedMaxAgeMs: txAges,
  },
  lockWaits: {
    distinctPids: lockWaitByPid.size,
    events: [...lockWaitByPid.entries()].map(([pid, e]) => ({ pid, ...e })),
  },
  waitEventTally: Object.fromEntries([...waitEventTally.entries()].sort()),
};
writeFileSync(join(OUT_DIR, "pg-sampler-summary.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(
  `[s1-pg-sampler] stopped: polls=${polls}(err ${pollErrors}) txPids=${txAges.length} txMax=${summary.txDuration.maxMs}ms lockWaitPids=${lockWaitByPid.size}`,
);
await conn.sql.end();
process.exit(0);
