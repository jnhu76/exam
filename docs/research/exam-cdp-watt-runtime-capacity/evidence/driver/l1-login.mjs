/**
 * L1-VERIFY 完整 HTTP login 闭环 driver（RESEARCH ONLY，协议 §10 L1-VERIFY）。
 *
 * 与 G1 driver.mjs 的差别：闭环（closed-loop）并发 C——C 个 worker 连续
 * 做 login（前一响应返回才发下一个），总 N 次；这是 L1 验密曲线要求的
 * 并发轴（不是开放式到达）。其余复用 G1 已验证的接线：
 *   - 经真实 nginx（直连容器 172.28.10.2:80，Host/Origin=公共 origin）；
 *   - T-DIRECT 每考生绑定独一源 IP（真实内核 socket 对端，非伪造头）；
 *   - 凭据只经 env 注入，不写任何输出；
 *   - 自监控（process.cpuUsage 单核口径 / elDelay / RSS）→ T6 余量判据。
 *
 * 登录限流预算核算：每考生每 run 恰好 1 次 login（10/60s/IP 限额内），
 * 全局 100/60s/IP 每 IP 1-2 请求（warmup 走容器主 IP）。429 如出现照记
 * （合法测量结果，分类计数，不重跑掩盖）。
 *
 * 输出（容器本地 /tmp/run/<run-id>/，由 l1-http-run.sh docker cp 归档）：
 *   samples.jsonl（每 login 一行四级记录）· driver-metrics.jsonl（500ms）
 *   · driver.json 汇总 · run-meta.json
 */
import http from "node:http";
import { appendFileSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { monitorEventLoopDelay } from "node:perf_hooks";

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    const m = /^--([^=]+)=(.*)$/.exec(a);
    if (m) out[m[1]] = m[2];
  }
  return out;
}
const A = parseArgs(process.argv.slice(2));
const opt = (k, d) => (A[k] === undefined ? d : A[k]);

const RUN_ID = opt("run-id", `L1-HTTP-${Date.now()}`);
const C = Number(opt("concurrency", "8"));
const N = Number(opt("n", "200"));
const ORIGIN = opt("origin", "http://127.0.0.1:8080");
const NGINX_ADDR = opt("nginx-addr", "172.28.10.2:80");
const SOURCE_BASE = opt("source-base", "172.28.10.10");
const CANDIDATES_FILE = opt("candidates", "");
const REQUEST_TIMEOUT_MS = Number(opt("timeout-ms", "30000"));
const WARMUP_MS = Number(opt("warmup-ms", "2500"));

const OUT_DIR = `/tmp/run/${RUN_ID}`;
mkdirSync(OUT_DIR, { recursive: true });

if (!CANDIDATES_FILE) {
  console.error("[l1-login] FATAL: --candidates=<file> required");
  process.exit(2);
}
if (!(C >= 1) || !(N >= 1)) {
  console.error("[l1-login] FATAL: --concurrency/--n must be >=1");
  process.exit(2);
}
const PASSWORD = process.env.CANDIDATE_PASSWORD;
if (!PASSWORD) {
  console.error("[l1-login] FATAL: CANDIDATE_PASSWORD env not set");
  process.exit(2);
}
const manifest = JSON.parse(readFileSync(CANDIDATES_FILE, "utf8"));
if (manifest.candidates.length < N) {
  console.error(`[l1-login] FATAL: candidates ${manifest.candidates.length} < n=${N}`);
  process.exit(2);
}

const sourceIpOf = (k) =>
  `${SOURCE_BASE.split(".").slice(0, 3).join(".")}.${Number(SOURCE_BASE.split(".")[3]) + k}`;

// ── 每考生一个绑定源 IP 的 agent（复用 G1：keepAlive、maxSockets=6） ───────
const agents = new Map();
function agentFor(k) {
  let a = agents.get(k);
  if (!a) {
    a = new http.Agent({ keepAlive: true, maxSockets: 6, keepAliveMsecs: 4000, localAddress: sourceIpOf(k) });
    agents.set(k, a);
  }
  return a;
}

const t0Perf = performance.now();
const T0_EPOCH = Date.now();
const now = () => performance.now() - t0Perf;
const ORIGIN_HOST = new URL(ORIGIN).host;

function doRequest({ agent, method, path, body }) {
  return new Promise((resolve) => {
    const startedAt = now();
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const colon = NGINX_ADDR.indexOf(":");
    const req = http.request(
      {
        host: NGINX_ADDR.slice(0, colon),
        port: Number(NGINX_ADDR.slice(colon + 1)),
        path,
        method,
        agent,
        headers: {
          host: ORIGIN_HOST,
          origin: ORIGIN,
          accept: "application/json",
          ...(payload === null ? {} : { "content-type": "application/json", "content-length": payload.length }),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
            headers: res.headers,
            latencyMs: now() - startedAt,
            errorClass: null,
          });
        });
      },
    );
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error("client-timeout")));
    req.on("error", (err) => {
      resolve({
        status: 0,
        body: "",
        headers: {},
        latencyMs: now() - startedAt,
        errorClass: err.message === "client-timeout" ? "timeout" : (err.code ?? err.message).slice(0, 60),
      });
    });
    if (payload !== null) req.write(payload);
    req.end();
  });
}

// ── 自监控（T6；口径同 G1 driver：cpuUsage 单核=100%） ──────────────────────
const elDelay = monitorEventLoopDelay({ resolution: 10 });
elDelay.enable();
const metricsBuf = [];
let lastUsage = process.cpuUsage();
let lastSampleAt = now();
let cpuMaxPct = 0;
let elMaxSeen = 0;
function sampleMetrics() {
  const cur = process.cpuUsage();
  const dt = Math.max(50, now() - lastSampleAt);
  const usagePct = ((cur.user - lastUsage.user + cur.system - lastUsage.system) / 1000 / dt) * 100;
  cpuMaxPct = Math.max(cpuMaxPct, usagePct);
  const max = elDelay.max / 1e6;
  elMaxSeen = Math.max(elMaxSeen, max);
  metricsBuf.push(
    JSON.stringify({
      tMs: Math.round(now()),
      cpuUsagePct: Math.round(usagePct * 10) / 10,
      elDelayMeanMs: Math.round((elDelay.mean / 1e6) * 100) / 100,
      elDelayP99Ms: Math.round((elDelay.percentile(99) / 1e6) * 100) / 100,
      elDelayMaxMs: Math.round(max * 100) / 100,
      rssMb: Math.round(process.memoryUsage().rss / 1048576),
    }),
  );
  elDelay.reset();
  lastUsage = cur;
  lastSampleAt = now();
}
const metricsTimer = setInterval(() => {
  appendMetrics();
}, 500);
function appendMetrics() {
  if (metricsBuf.length === 0) return;
  try {
    appendFileSync(join(OUT_DIR, "driver-metrics.jsonl"), metricsBuf.splice(0).join("\n") + "\n");
  } catch {
    /* 容器本地盘不应失败；失败则丢 metrics 保数据路径 */
  }
}

// ── warmup（G1 结论：JIT/冷路径预热，不改变测量语义） ──────────────────────
{
  const warmAgent = new http.Agent({ keepAlive: false });
  await doRequest({ agent: warmAgent, method: "GET", path: "/api/settings/branding" }).catch(() => null);
  await doRequest({ agent: warmAgent, method: "POST", path: "/api/client-events", body: { events: [] } }).catch(() => null);
  warmAgent.destroy();
  // 预建全部 agent（对象本身，非连接——登录请求仍冷连接，wire 保真）
  for (let k = 0; k < N; k++) agentFor(k);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  if (WARMUP_MS > 0) await sleep(WARMUP_MS);
}

// ── 闭环主循环：C workers · N logins · 每考生一次 ───────────────────────────
const samples = [];
let nextIdx = 0;
let sent = 0;
let driverDropped = 0;
const offered = N;

function loginOnce(k) {
  sent += 1;
  const user = manifest.candidates[k];
  const record = {
    runId: RUN_ID,
    opId: `${user}#login`,
    candidateIdx: k,
    candidate: user,
    kind: "login",
    topology: "direct",
    sourceIp: sourceIpOf(k),
    sentAtMs: Math.round(now()),
    status: null,
    latencyMs: null,
    errorClass: null,
    requestId: null,
    responseAtMs: null,
    verified: null,
    verifyKind: "login-200+cookie+role",
    detail: null,
  };
  return doRequest({
    agent: agentFor(k),
    method: "POST",
    path: "/api/auth/login",
    body: { username: user, password: PASSWORD },
  }).then((res) => {
    record.status = res.status;
    record.latencyMs = Math.round(res.latencyMs);
    record.errorClass = res.errorClass;
    record.requestId = res.headers["x-request-id"] ?? null;
    record.responseAtMs = Math.round(now());
    let ok = res.status === 200;
    if (ok) {
      const tok = (res.headers["set-cookie"] ?? []).find((c) => /^auth-token=/.test(c));
      ok = !!tok;
      if (ok) {
        try {
          ok = JSON.parse(res.body).role === "Candidate";
        } catch {
          ok = false;
        }
      }
    }
    record.verified = ok;
    samples.push(record);
  }).catch((err) => {
    driverDropped += 1;
    record.verified = false;
    record.detail = `driver-error:${String(err.message ?? err).slice(0, 120)}`;
    samples.push(record);
  });
}

async function worker() {
  for (;;) {
    const k = nextIdx;
    if (k >= N) return;
    nextIdx = k + 1;
    await loginOnce(k);
  }
}

const measureStart = now();
await Promise.all(Array.from({ length: C }, () => worker()));
const measureEnd = now();
const settleExtra = await new Promise((r) => setTimeout(r, 2000)); // 排空（审计异步）
clearInterval(metricsTimer);
sampleMetrics();
appendMetrics();
elDelay.disable();
for (const a of agents.values()) a.destroy();

// ── 汇总 ────────────────────────────────────────────────────────────────────
function pct(arr, p) {
  if (arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}
const okSamples = samples.filter((x) => x.verified === true);
const okLat = okSamples.map((x) => x.latencyMs);
const allLat = samples.filter((x) => x.latencyMs !== null).map((x) => x.latencyMs);
const statusTally = {};
for (const x of samples) {
  const k = String(x.status ?? "none");
  statusTally[k] = (statusTally[k] ?? 0) + 1;
}
const wallMs = measureEnd - measureStart;
const driverJson = {
  runId: RUN_ID,
  group: "http-login-closed-loop",
  concurrency: C,
  n: N,
  offered,
  sent,
  responsesObtained: samples.filter((x) => x.responseAtMs !== null).length,
  verifiedLogins: okSamples.length,
  driverDropped,
  statusTally,
  wallMs: Math.round(wallMs),
  driverVerifiedThroughputPerSec: Math.round((okSamples.length / (wallMs / 1000)) * 100) / 100,
  latencyOk: {
    p50: pct(okLat, 50),
    p95: pct(okLat, 95),
    p99: pct(okLat, 99),
    max: okLat.length ? Math.max(...okLat) : null,
    n: okLat.length,
  },
  latencyAll: {
    p50: pct(allLat, 50),
    p95: pct(allLat, 95),
    p99: pct(allLat, 99),
    max: allLat.length ? Math.max(...allLat) : null,
    n: allLat.length,
  },
  driverSelf: {
    cpuMaxPctSingleCore: Math.round(cpuMaxPct * 10) / 10,
    elDelayMaxMs: Math.round(elMaxSeen * 100) / 100,
    rssMbMax: rssMaxFromMetrics(),
    note: "本 Docker Desktop VM /proc 计账损坏（G1 实证），CPU 用 process.cpuUsage；elDelay 有 ~11ms 粒度地板",
  },
  startedAt: new Date(T0_EPOCH).toISOString(),
  endedAt: new Date().toISOString(),
  measureWindow: { startMs: Math.round(measureStart), endMs: Math.round(measureEnd) },
};
driverJson.driverSelf.rssMbMax = rssMaxFromMetrics();
function rssMaxFromMetrics() {
  try {
    const vals = readFileSync(join(OUT_DIR, "driver-metrics.jsonl"), "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l).rssMb ?? 0);
    return vals.length ? Math.max(...vals) : null;
  } catch {
    return null;
  }
}

writeFileSync(join(OUT_DIR, "samples.jsonl"), samples.map((s) => JSON.stringify(s)).join("\n") + "\n");
writeFileSync(join(OUT_DIR, "driver.json"), JSON.stringify(driverJson, null, 2) + "\n");
writeFileSync(
  join(OUT_DIR, "run-meta.json"),
  JSON.stringify(
    {
      runId: RUN_ID,
      experiment: "L1-VERIFY",
      group: "http-login",
      concurrency: C,
      n: N,
      origin: ORIGIN,
      nginxAddr: NGINX_ADDR,
      sourceBase: SOURCE_BASE,
      candidatesFile: CANDIDATES_FILE,
      candidatesFrom: manifest.candidates[0],
      candidatesTo: manifest.candidates[N - 1],
      requestTimeoutMs: REQUEST_TIMEOUT_MS,
      driverNode: process.version,
      passwordHandling: "CANDIDATE_PASSWORD via env only; never written to outputs",
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `[l1-login] ${RUN_ID}: C=${C} N=${N} wall=${Math.round(wallMs)}ms ` +
    `verified=${okSamples.length}/${N} thr=${driverJson.driverVerifiedThroughputPerSec}/s ` +
    `p50/p95/p99/max=${driverJson.latencyOk.p50}/${driverJson.latencyOk.p95}/${driverJson.latencyOk.p99}/${driverJson.latencyOk.max}ms ` +
    `driverCPUmax=${driverJson.driverSelf.cpuMaxPctSingleCore}%`,
);
if (driverDropped > 0) process.exit(3);
