/**
 * L1-VERIFY API 进程采样器（RESEARCH ONLY，协议 §6 通用观测）。
 *
 * 在 HTTP login run 窗口内对 host-native API 进程做外部观测：
 *   - /proc/<pid>/stat：进程 CPU（utime+stime，全线程，100Hz tick）；
 *   - /proc/<pid>/task/<pid>/stat：主线程（事件循环）CPU → ELU 代理；
 *   - /proc/<pid>/task 下各线程 stat：每 tick 忙线程计数（原生执行并发代理；
 *     argon2 内部 pthread 生命周期 ms 级，250ms 采样是下限估计）；
 *   - /proc/<pid>/status：VmRSS / VmHWM（峰值 RSS 高水位，精确无采样缝）/
 *     Threads；
 *   - GET /api/research/capacity（admin 会话，约每秒 1 次）：进程内
 *     process.cpuUsage 增量、事件循环直方图（每次快照重置 → 每秒窗口的
 *     p50/p90/max）、PG 池 reserved/pending（排队等待可见性）、
 *     sql.total（语句到达计数）。
 *
 * 采样器自身是仪表（如同 pg_stat_activity 采样），其 ~4 req/s 请求走
 * API 直连（127.0.0.1），不进 nginx 测量路径；记入 run-meta 备查。
 *
 * 用法（由 l1-http-run.sh 以背景进程启动，SIGTERM 停止并写汇总）：
 *   pnpm -C /home/hoo/Source/exam/.wt-capacity --filter @exam/db exec tsx \
 *     harness/l1-api-sampler.ts --pid=<apiPid> --out-dir=<runDir> \
 *     --ready-file=<file> [--interval-ms=250] [--snapshot-every=4]
 */
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "./lib/http.js";
import { ADMIN, API_BASE_URL, PUBLIC_ORIGIN, args } from "./lib/config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const PID = Number(args().pid);
const OUT_DIR = args()["out-dir"] ?? ".";
const READY_FILE = args()["ready-file"] ?? join(OUT_DIR, ".sampler-ready");
const STOP_FILE = args()["stop-file"] ?? join(OUT_DIR, ".sampler-stop");
const INTERVAL_MS = Number(args()["interval-ms"] ?? 250);
const SNAPSHOT_EVERY = Number(args()["snapshot-every"] ?? 4); // 4×250ms = 1s
const MAX_SECONDS = Number(args()["max-seconds"] ?? 900);

if (!Number.isInteger(PID) || PID <= 1) {
  console.error("[l1-api-sampler] FATAL: --pid required");
  process.exit(2);
}
mkdirSync(OUT_DIR, { recursive: true });

function procTicksOf(statPath: string): number | null {
  try {
    const s = readFileSync(statPath, "utf8");
    const f = s.slice(s.lastIndexOf(")") + 2).split(" ");
    return Number(f[11]) + Number(f[12]);
  } catch {
    return null;
  }
}
function taskTids(pid: number): number[] {
  try {
    return readdirSync(`/proc/${pid}/task`)
      .filter(Boolean)
      .map(Number)
      .filter(Number.isInteger);
  } catch {
    return [];
  }
}
function statusKb(pid: number, field: string): number | null {
  try {
    const m = new RegExp(`${field}:\\s+(\\d+) kB`).exec(
      readFileSync(`/proc/${pid}/status`, "utf8"),
    );
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}
function hostCpuTicks(): number | null {
  try {
    const l = readFileSync("/proc/stat", "utf8").split("\n")[0]!.split(" ");
    return l.slice(1).map(Number).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
  } catch {
    return null;
  }
}

// ── admin 会话（研究快照端点：SystemDiagnosticsView 能力门） ────────────────
const admin = new Client({
  baseUrl: API_BASE_URL,
  id: "l1-api-sampler",
  origin: PUBLIC_ORIGIN,
});
let snapshotEnabled = true;
const loginRes = await admin.login(ADMIN.username, ADMIN.password);
if (loginRes.status !== 200) {
  console.error(
    `[l1-api-sampler] WARN: admin login ${loginRes.status} — research snapshots disabled`,
  );
  snapshotEnabled = false;
}

const startedAt = performance.now();
const T0_EPOCH = Date.now();
let running = true;
let tick = 0;

interface Tick {
  tMs: number;
  procTicks: number | null;
  mainTicks: number | null;
  busyThreads: number | null;
  busyThreadsNonMain: number | null;
  threadsTotal: number | null;
  vmRssKb: number | null;
  vmHwmKb: number | null;
  hostTicks: number | null;
}
const ticks: Tick[] = [];
let lastThreadTicks = new Map<number, number>();
let snapshotCount = 0;
let snapshotErrors = 0;
let lastSqlTotal: number | null = null;

async function researchSnapshot(): Promise<void> {
  const res = await admin.json("GET", "/api/research/capacity");
  if (res.status !== 200) {
    snapshotErrors += 1;
    return;
  }
  snapshotCount += 1;
  const snap = res.parsed as Record<string, unknown>;
  const sql = snap.sql as { total?: number } | undefined;
  if (typeof sql?.total === "number" && lastSqlTotal !== null) {
    (snap as Record<string, unknown> & { sqlDelta: number }).sqlDelta =
      sql.total - lastSqlTotal;
  }
  lastSqlTotal = typeof sql?.total === "number" ? sql.total : null;
  appendFileSync(
    join(OUT_DIR, "api-research-snapshots.jsonl"),
    JSON.stringify({ tMs: Math.round(performance.now() - startedAt), ...snap }) + "\n",
  );
}

async function loop(): Promise<void> {
  while (running) {
    if (existsSync(STOP_FILE)) {
      console.log("[l1-api-sampler] stop file observed");
      running = false;
      break;
    }
    const proc = procTicksOf(`/proc/${PID}/stat`);
    const main = procTicksOf(`/proc/${PID}/task/${PID}/stat`);
    let busy: number | null = null;
    let busyNonMain: number | null = null;
    const tids = taskTids(PID);
    if (tids.length > 0) {
      const cur = new Map<number, number>();
      let b = 0;
      let bn = 0;
      for (const tid of tids) {
        const v = procTicksOf(`/proc/${PID}/task/${tid}/stat`);
        if (v === null) continue;
        cur.set(tid, v);
        const prev = lastThreadTicks.get(tid);
        if (prev !== undefined && v > prev) {
          b += 1;
          if (tid !== PID) bn += 1;
        }
      }
      busy = b;
      busyNonMain = bn;
      lastThreadTicks = cur;
    }
    ticks.push({
      tMs: Math.round(performance.now() - startedAt),
      procTicks: proc,
      mainTicks: main,
      busyThreads: busy,
      busyThreadsNonMain: busyNonMain,
      threadsTotal: tids.length,
      vmRssKb: statusKb(PID, "VmRSS"),
      vmHwmKb: statusKb(PID, "VmHWM"),
      hostTicks: hostCpuTicks(),
    });
    tick += 1;
    if (running && snapshotEnabled && tick % SNAPSHOT_EVERY === 0) {
      await researchSnapshot().catch(() => {
        snapshotErrors += 1;
      });
    }
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
}

writeFileSync(READY_FILE, `${Date.now()}\n`);
const timer = setTimeout(() => {
  console.error("[l1-api-sampler] max-seconds reached — self stopping");
  running = false;
}, MAX_SECONDS * 1000);
if (typeof timer === "object" && timer && "unref" in timer) timer.unref();

process.on("SIGTERM", () => {
  running = false;
});

await loop();

// ── 汇总 ───────────────────────────────────────────────────────────────────
const first = ticks[0];
const last = ticks[ticks.length - 1];
const TICK_MS_ = 10; // 100Hz
const summary = {
  pid: PID,
  windowStartIso: new Date(T0_EPOCH).toISOString(),
  windowEndIso: new Date().toISOString(),
  wallMs: last ? last.tMs - first.tMs : 0,
  tickCount: ticks.length,
  intervalMs: INTERVAL_MS,
  apiProcCpuMs:
    first && last && first.procTicks !== null && last.procTicks !== null
      ? (last.procTicks - first.procTicks) * TICK_MS_
      : null,
  apiMainThreadCpuMs:
    first && last && first.mainTicks !== null && last.mainTicks !== null
      ? (last.mainTicks - first.mainTicks) * TICK_MS_
      : null,
  hostCpuTicksDelta:
    first && last && first.hostTicks !== null && last.hostTicks !== null
      ? last.hostTicks - first.hostTicks
      : null,
  vmHwmKb: last?.vmHwmKb ?? null,
  vmRssKbMax: ticks.reduce((a, t) => Math.max(a, t.vmRssKb ?? 0), 0),
  threadsTotalMax: ticks.reduce((a, t) => Math.max(a, t.threadsTotal ?? 0), 0),
  busyThreadsMax: ticks.reduce((a, t) => Math.max(a, t.busyThreads ?? 0), 0),
  busyThreadsNonMainMax: ticks.reduce(
    (a, t) => Math.max(a, t.busyThreadsNonMain ?? 0),
    0,
  ),
  snapshots: { count: snapshotCount, errors: snapshotErrors, enabled: snapshotEnabled },
  note: "ELU 代理=mainThreadCpu/wall；busyThreads 为 250ms tick 内 CPU 有增量的线程数（含瞬态 argon2 pthread，粒度下限）；vmHwm 为进程高水位（精确）",
};
writeFileSync(join(OUT_DIR, "api-sampler.jsonl"), ticks.map((t) => JSON.stringify(t)).join("\n") + "\n");
writeFileSync(join(OUT_DIR, "api-summary.json"), JSON.stringify(summary, null, 2) + "\n");
await admin.close();
console.log(
  `[l1-api-sampler] stopped: ${ticks.length} ticks, apiCpu=${summary.apiProcCpuMs}ms, ` +
    `main=${summary.apiMainThreadCpuMs}ms, snapshots=${snapshotCount}(err ${snapshotErrors})`,
);
process.exit(0);
