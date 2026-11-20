/**
 * L1-VERIFY 隔离验密曲线 runner（RESEARCH ONLY，协议 §10 L1-VERIFY）。
 *
 * 直接调 packages/auth 生产函数 verifyPasswordOrDummy（argon2id 冻结参数
 * m=65536,t=3,p=4），闭环并发 C ∈ {1,4,8,16,32}（拐点补测另加）。固定对照：
 * ① 密码哈希从真实研究库 exam_550_e2e（name-guarded）现取一行 synthetic
 *    考生的 users.password_hash（只在内存使用，绝不写盘——脱敏纪律）；
 * ② CANDIDATE_PASSWORD = harness config 常量（合成考生共享密码）。
 *
 * 量测（协议 §6 L1 行）：
 *   - verify 调用 wall time（每 op samples.jsonl：worker/start/dur）；
 *   - 成功吞吐 = N / 墙钟；CPU/成功 = process.cpuUsage 增量 / N（全线程，
 *     含 argon2 内部 p=4 pthread 与 libuv 线程池）；
 *   - 原生执行并发可观测代理：busyThreads = CPUms/墙钟ms（平均忙线程数）、
 *     Little 口径 in-flight = 吞吐×平均时长、/proc/self/task 每 tick 忙线程
 *     计数（arg 强度按采样粒度受限，标注为代理）；
 *   - 峰值 RSS = /proc/self/status VmHWM；
 *   - 调度/限额：cgroup cpu.max / cpu.stat(nr_throttled)、nproc、
 *     UV_THREADPOOL_SIZE（不设=libuv 默认 4）；
 *   - EL delay：monitorEventLoopDelay（本 VM 有 ~11ms 计时粒度地板，超地板
 *     尖峰为真阻塞——G1 driver 已证）。
 *
 * 排队 vs 原生执行分别标注：C=1 的中位时长即原生执行 solo 参照
 * T_solo（无排队）；C>4 的逐 op 时长含 libuv 线程池排队，队列分量按
 * dur−T_solo（≥0）模型化估计，汇总里明确标注为模型估计而非直接观测。
 *
 * 运行契约（协议 §13 cmd.sh）：cwd=/home/hoo/Source/exam 下
 *   pnpm -C /home/hoo/Source/exam/.wt-capacity --filter @exam/db exec tsx \
 *     /home/hoo/Source/exam/.wt-capacity/docs/research/exam-cdp-watt-runtime-capacity/harness/l1-verify.ts \
 *     --run-id=<id> --concurrency=<C> --n=<N>
 * 输出路径按本文件位置解析（cwd 无关），落
 * evidence/L1-VERIFY/<run-id>/{samples.jsonl,metrics.jsonl,run-summary.json,run-meta.json,cmd.sh}
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { execSync } from "node:child_process";
import { verifyPasswordOrDummy, hashPassword } from "../../../../packages/auth/src/password.js";
import { createDatabase } from "../../../../packages/db/src/database.js";
import { CANDIDATE_PASSWORD, RUN_DB, RUN_DB_URL, args } from "./lib/config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// harness/ 的上一级即研究目录（lib/config.ts 在 lib/ 深一层故用两层——勿混）
const RESEARCH = dirname(__dirname);
const EVIDENCE = join(RESEARCH, "evidence");
const OUT_ROOT = join(EVIDENCE, "L1-VERIFY");

const RUN_ID = args()["run-id"] ?? `L1-VERIFY-c${args().concurrency ?? 1}-r1`;
const C = Number(args().concurrency ?? 1);
const N = Number(args().n ?? 600);
const WARMUP_SEQ = Number(args()["warmup-seq"] ?? 20);
const TICK_MS = Number(args()["tick-ms"] ?? 200);
const OUT_DIR = join(OUT_ROOT, RUN_ID);
mkdirSync(OUT_DIR, { recursive: true });

if (!Number.isInteger(C) || C < 1) throw new Error(`--concurrency must be >=1`);
if (!Number.isInteger(N) || N < 1) throw new Error(`--n must be >=1`);

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return pct(s, 50);
}

/** 读 /proc/<pid>/stat 的 utime+stime（tick，100Hz）。 */
function procTicks(pid: number): { utime: number; stime: number } | null {
  try {
    const s = readFileSync(`/proc/${pid}/stat`, "utf8");
    const f = s.slice(s.lastIndexOf(")") + 2).split(" ");
    return { utime: Number(f[11]), stime: Number(f[12]) };
  } catch {
    return null;
  }
}
/** 每 tick 读 /proc/self/task 下各线程 stat：返回 [tid, utime+stime]。 */
function threadTicks(): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  try {
    for (const tid of readdirSafe("/proc/self/task")) {
      try {
        const s = readFileSync(`/proc/self/task/${tid}/stat`, "utf8");
        const f = s.slice(s.lastIndexOf(")") + 2).split(" ");
        out.push([Number(tid), Number(f[11]) + Number(f[12])]);
      } catch {
        /* 线程已退出（argon2 内部 pthread 生命周期 ~ms 级） */
      }
    }
  } catch {
    /* /proc 不可读 */
  }
  return out;
}
function readdirSafe(p: string): string[] {
  try {
    return readdirSync(p);
  } catch {
    return [];
  }
}
function statusField(field: string): number | null {
  try {
    const m = new RegExp(`${field}:\\s+(\\d+) kB`).exec(
      readFileSync("/proc/self/status", "utf8"),
    );
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}
function hostCpuTicks(): number | null {
  try {
    const l = readFileSync("/proc/stat", "utf8").split("\n")[0]!.split(" ");
    const vals = l.slice(1).map(Number);
    return vals.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
  } catch {
    return null;
  }
}
function cgroupTrimmed(): string {
  try {
    return readFileSync("/sys/fs/cgroup/cpu.stat", "utf8")
      .split("\n")
      .filter((l) => l.startsWith("nr_periods") || l.startsWith("nr_throttled") || l.startsWith("throttled_usec"))
      .join(" ").trim();
  } catch {
    return "unavailable";
  }
}

// ── 1. 固定对照：真实库取哈希（只留内存；落盘仅 PHC 参数段） ───────────────
const conn = await createDatabase(RUN_DB_URL);
const dbId = (await conn.sql.unsafe(`SELECT current_database() AS db`))[0] as {
  db: string;
};
if (dbId.db !== RUN_DB) {
  throw new Error(`connected db ${dbId.db} != guarded ${RUN_DB}`);
}
const rows = (await conn.sql.unsafe(
  `SELECT u.username, u.password_hash FROM users u
   JOIN candidate_profiles cp ON cp.user_id = u.id
   WHERE u.username LIKE 'cap9same-%' AND u.is_active = true
   ORDER BY u.username LIMIT 1`,
)) as Array<{ username: string; password_hash: string }>;
if (rows.length !== 1) {
  throw new Error(`no synthetic candidate row found in ${RUN_DB} (seed first)`);
}
const HASH_USERNAME = rows[0]!.username;
const STORED_HASH = rows[0]!.password_hash; // 仅内存使用，不写任何输出
const PHC_PARAMS = `$${STORED_HASH.split("$").slice(1, 4).join("$")}`;
await conn.sql.end();
const PARAMS_OK = /^\$argon2id\$v=19\$m=65536,t=3,p=4\$/.test(STORED_HASH);
if (!PARAMS_OK) {
  throw new Error(`stored hash params != frozen: ${PHC_PARAMS}`);
}

// ── 2. 正确性门 + 预热（不计入样本） ────────────────────────────────────────
const okTrue = await verifyPasswordOrDummy(CANDIDATE_PASSWORD, STORED_HASH);
if (okTrue !== true) throw new Error("correctness gate failed: real hash verify != true");
const okDummy = await verifyPasswordOrDummy(CANDIDATE_PASSWORD, null);
if (okDummy !== false) throw new Error("correctness gate failed: dummy path != false");
for (let i = 0; i < WARMUP_SEQ; i++) {
  await verifyPasswordOrDummy(CANDIDATE_PASSWORD, STORED_HASH);
}
// 并发路径预热（线程池分派/内部 pthread 创建首次执行）
await Promise.all(
  Array.from({ length: Math.min(C, 8) }, () =>
    verifyPasswordOrDummy(CANDIDATE_PASSWORD, STORED_HASH),
  ),
);

// ── 3. 量测：闭环 C 工作线程共做 N 次 verify ────────────────────────────────
const elDelay = monitorEventLoopDelay({ resolution: 1 });
elDelay.enable();

interface OpSample {
  i: number;
  worker: number;
  startMs: number;
  endMs: number;
  durMs: number;
  ok: boolean;
}
const samples: OpSample[] = [];
let verifyFalse = 0;

let nextIdx = 0;
const t0Perf = performance.now();
const T0_EPOCH = Date.now();
let measuring = false;

const metrics: string[] = [];
let lastUsage = process.cpuUsage();
let lastUsageAt = performance.now();
let lastThreads = new Map(threadTicks());
let tickBusyMax = 0;
let tickBusyNonMainMax = 0;
let threadsSeenMax = 0;
let rssMaxKb = 0;

const metricsTimer = setInterval(() => {
  if (!measuring) return;
  const curUsage = process.cpuUsage();
  const nowP = performance.now();
  const wallMs = nowP - lastUsageAt;
  const cpuMs =
    (curUsage.user - lastUsage.user + curUsage.system - lastUsage.system) / 1000;
  const curThreads = new Map(threadTicks());
  let busy = 0;
  let busyNonMain = 0;
  for (const [tid, v] of curThreads) {
    const prev = lastThreads.get(tid);
    if (prev === undefined) continue;
    if (v > prev) {
      busy += 1;
      if (tid !== process.pid) busyNonMain += 1;
    }
  }
  tickBusyMax = Math.max(tickBusyMax, busy);
  tickBusyNonMainMax = Math.max(tickBusyNonMainMax, busyNonMain);
  threadsSeenMax = Math.max(threadsSeenMax, curThreads.size);
  const rssKb = statusField("VmRSS") ?? 0;
  rssMaxKb = Math.max(rssMaxKb, rssKb);
  metrics.push(
    JSON.stringify({
      tMs: Math.round(nowP - t0Perf),
      cpuMs: Math.round(cpuMs * 100) / 100,
      wallMs: Math.round(wallMs * 100) / 100,
      busyThreads: busy,
      busyThreadsNonMain: busyNonMain,
      threadsTotal: curThreads.size,
      rssKb,
      elMeanMs: Math.round((elDelay.mean / 1e6) * 100) / 100,
      elP99Ms: Math.round((elDelay.percentile(99) / 1e6) * 100) / 100,
      elMaxMs: Math.round((elDelay.max / 1e6) * 100) / 100,
    }),
  );
  elDelay.reset();
  lastUsage = curUsage;
  lastUsageAt = nowP;
  lastThreads = curThreads;
}, TICK_MS);

async function worker(w: number): Promise<void> {
  for (;;) {
    const i = nextIdx;
    if (i >= N) return;
    nextIdx = i + 1;
    const s = performance.now();
    const ok = await verifyPasswordOrDummy(CANDIDATE_PASSWORD, STORED_HASH);
    const e = performance.now();
    if (!ok) verifyFalse += 1;
    samples.push({
      i,
      worker: w,
      startMs: Math.round((s - t0Perf) * 1000) / 1000,
      endMs: Math.round((e - t0Perf) * 1000) / 1000,
      durMs: Math.round((e - s) * 1000) / 1000,
      ok,
    });
  }
}

const procSelfStart = procTicks(process.pid)!;
const hostStart = hostCpuTicks();
measuring = true;
await Promise.all(Array.from({ length: C }, (_, w) => worker(w)));
measuring = false;
const t1Perf = performance.now();
const wallMs = t1Perf - t0Perf;
clearInterval(metricsTimer);
elDelay.disable();
const procSelfEnd = procTicks(process.pid)!;
const hostEnd = hostCpuTicks();
const vmHwmKb = statusField("VmHWM");

// ── 4. 汇总与落盘 ──────────────────────────────────────────────────────────
const durs = samples.map((s) => s.durMs).sort((a, b) => a - b);
const cpuTotalMs =
  ((procSelfEnd.utime + procSelfEnd.stime) -
    (procSelfStart.utime + procSelfStart.stime)) * 10; // 100Hz tick → ms
const cpuUsageTotalMs = metrics.reduce((a, m) => a + JSON.parse(m).cpuMs, 0);
const meanDurMs = durs.reduce((a, b) => a + b, 0) / (durs.length || 1);
// in-flight 重叠（含排队）：sweep 事件求最大并发区间重叠
const events: Array<[number, number]> = samples.flatMap((s) => [
  [s.startMs, 1] as [number, 1],
  [s.endMs, -1] as [number, -1],
]);
events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
let cur = 0;
let maxInFlight = 0;
for (const [, d] of events) {
  cur += d;
  maxInFlight = Math.max(maxInFlight, cur);
}

const gitSha = (() => {
  try {
    return execSync("git -C /home/hoo/Source/exam/.wt-capacity rev-parse HEAD", {
      encoding: "utf8",
    }).trim();
  } catch {
    return "unavailable";
  }
})();

const summary = {
  runId: RUN_ID,
  group: "isolated-verify",
  n: N,
  concurrency: C,
  wallMs: Math.round(wallMs),
  throughputPerSec: Math.round((N / (wallMs / 1000)) * 100) / 100,
  verifyFalse,
  durationMs: {
    p50: pct(durs, 50),
    p95: pct(durs, 95),
    p99: pct(durs, 99),
    max: durs[durs.length - 1] ?? null,
    mean: durs.reduce((a, b) => a + b, 0) / (durs.length || 1),
    n: durs.length,
  },
  cpu: {
    procStatTotalMs: cpuTotalMs,
    cpuUsageSumMs: Math.round(cpuUsageTotalMs * 100) / 100,
    msPerOp: Math.round((cpuTotalMs / N) * 1000) / 1000,
    avgBusyThreads: Math.round((cpuTotalMs / wallMs) * 1000) / 1000,
  },
  nativeConcurrencyProxy: {
    avgBusyThreadsCpuBased: Math.round((cpuTotalMs / wallMs) * 1000) / 1000,
    maxInFlightClosedLoop: maxInFlight,
    meanInFlightLittlesLaw: Math.round(((N * meanDurMs) / wallMs) * 1000) / 1000,
    perTickBusyMax: tickBusyMax,
    perTickBusyNonMainMax: tickBusyNonMainMax,
    note: "busyThreads=CPUms/墙钟ms（跨 argon2 内部 p=4 pthread 与 libuv 池）；in-flight 含线程池排队；per-tick 为 200ms 采样粒度下限",
  },
  memory: {
    vmHwmKb,
    vmRssMaxKb: rssMaxKb,
  },
  eventLoop: {
    meanMsMaxOfTicks: Math.max(...metrics.map((m) => JSON.parse(m).elMeanMs), 0),
    p99MaxOfTicks: Math.max(...metrics.map((m) => JSON.parse(m).elP99Ms), 0),
    maxMsMaxOfTicks: Math.max(...metrics.map((m) => JSON.parse(m).elMaxMs), 0),
    note: "本 VM monitorEventLoopDelay 有 ~11ms 计时粒度地板（G1 实测），超地板尖峰为真阻塞",
  },
  scheduling: {
    uvThreadpoolSize: process.env.UV_THREADPOOL_SIZE ?? "unset(libuv default 4)",
    nproc: execSync("nproc", { encoding: "utf8" }).trim(),
    cgroupCpuMax: (() => {
      try {
        return readFileSync("/sys/fs/cgroup/cpu.max", "utf8").trim();
      } catch {
        return "unavailable";
      }
    })(),
    cgroupCpuStatStart: cgroupTrimmed(), // 采样后再读一次见 summary2
  },
  hostCpuTicksDelta: hostStart !== null && hostEnd !== null ? hostEnd - hostStart : null,
  hashProvenance: {
    database: dbId.db,
    username: HASH_USERNAME,
    phcParams: PHC_PARAMS,
    storedHashArchived: false,
  },
  nodeVersion: process.version,
};

const cgroupEnd = cgroupTrimmed();
const summary2 = { ...summary, schedulingEnd: { cgroupCpuStatEnd: cgroupEnd } };

writeFileSync(join(OUT_DIR, "samples.jsonl"), samples.map((s) => JSON.stringify(s)).join("\n") + "\n");
writeFileSync(join(OUT_DIR, "metrics.jsonl"), metrics.join("\n") + "\n");
writeFileSync(join(OUT_DIR, "run-summary.json"), JSON.stringify(summary2, null, 2) + "\n");

const cmd = [
  `pnpm -C /home/hoo/Source/exam/.wt-capacity --filter @exam/db exec tsx \\`,
  `  /home/hoo/Source/exam/.wt-capacity/docs/research/exam-cdp-watt-runtime-capacity/harness/l1-verify.ts \\`,
  `  --run-id=${RUN_ID} --concurrency=${C} --n=${N}`,
].join("\n");
writeFileSync(join(OUT_DIR, "cmd.sh"), `#!/usr/bin/env bash\n# cwd=/home/hoo/Source/exam\n${cmd}\n`);

writeFileSync(
  join(OUT_DIR, "run-meta.json"),
  JSON.stringify(
    {
      runId: RUN_ID,
      experiment: "L1-VERIFY",
      group: "isolated-verify",
      argv: process.argv.slice(2),
      cmd,
      cwdContract: "/home/hoo/Source/exam",
      headSha: gitSha,
      db: dbId.db,
      hashFrom: { table: "users", username: HASH_USERNAME, phcParams: PHC_PARAMS },
      warmup: { sequential: WARMUP_SEQ, burst: Math.min(C, 8) },
      tickMs: TICK_MS,
      startedAt: new Date(T0_EPOCH).toISOString(),
      endedAt: new Date().toISOString(),
      passwordHandling: "CANDIDATE_PASSWORD 为 harness config 常量（合成）；哈希仅内存使用",
    },
    null,
    2,
  ) + "\n",
);

console.log(
  `[l1-verify] ${RUN_ID}: C=${C} N=${N} wall=${Math.round(wallMs)}ms ` +
    `thr=${summary.throughputPerSec}/s cpu/op=${summary.cpu.msPerOp}ms ` +
    `p50/p95/p99/max=${summary.durationMs.p50}/${summary.durationMs.p95}/${summary.durationMs.p99}/${summary.durationMs.max}ms ` +
    `busyThreadsAvg=${summary.cpu.avgBusyThreads} vmHWM=${vmHwmKb}kB verifyFalse=${verifyFalse}`,
);
if (verifyFalse > 0) {
  console.error(`[l1-verify] FAILED: ${verifyFalse} verify returned false`);
  process.exit(1);
}
if (!existsSync(join(OUT_DIR, "samples.jsonl"))) process.exit(1);
