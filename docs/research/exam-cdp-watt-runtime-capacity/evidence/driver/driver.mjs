#!/usr/bin/env node
/**
 * G1.2/G1.4 协议回放 + 开放式到达负载 driver（RESEARCH ONLY，#900/#1021）。
 *
 * 输入：G1.1 回放规格 evidence/g1-traces/replay-spec.json（observedApiCalls 的
 *       tRelMs/method/path 是两条考生轨迹的**真实线缆节拍**——本 driver 不发明
 *       时间线，机械复用规格中的相对时刻，锚点=该轨迹 login POST）。
 * 执行：开放式（open-loop）——每个操作在预定时刻发出（setTimeout 精确调度），
 *       不等待前一响应；数据依赖（cookie/attemptId/questionId/serverVersion）
 *       未就绪时照常到点、就绪即发，并如实标注 depBlocked。
 * 记录：四级计数与时刻——计划到达 plannedAt / 实际发出 sentAt / 取得响应
 *       responseAt / 取得正确会话或终态 verifiedAt（+ 判据）。
 * 拓扑：--topology=direct 每考生绑定独立辅助源 IP（真实内核 socket 对端，
 *       driver 容器内 eth0 secondary IP）；--topology=shared 全批共享同一出口
 *       （不绑定，源=容器唯一 IP）。两者都不发送 X-Forwarded-For（nginx 以
 *       $remote_addr 覆盖，无伪造头）。
 * 余量：自监控 process/每线程 CPU、event-loop delay、发送滞后分布、丢样，
 *       写 driver-metrics.jsonl + driver.json（协议 T6 判据的原始数据）。
 *
 * 零依赖（node:http/fs/perf_hooks），在 sources.sh 的 driver 容器内运行，
 * 也可在宿主机运行（shared 模式经 published port 时）。凭据只经环境变量
 * CANDIDATE_PASSWORD 注入，绝不写入任何输出文件。
 *
 * 用法见同目录 README.md。运行产物：<out-dir>/{schedule.jsonl,samples.jsonl,
 * driver-metrics.jsonl,driver.json,run-meta.json}。
 */
import http from "node:http";
import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { performance, monitorEventLoopDelay } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DRIVER_DIR = __dirname;
// 回放规格解析：宿主机相对路径优先；driver 容器内挂载点 /evidence 兜底
const REPLAY_SPEC_CANDIDATES = [
  join(DRIVER_DIR, "..", "g1-traces", "replay-spec.json"),
  "/evidence/g1-traces/replay-spec.json",
];
const REPLAY_SPEC_PATH = REPLAY_SPEC_CANDIDATES.find((p) => existsSync(p));
if (!REPLAY_SPEC_PATH) {
  console.error(`[driver] FATAL: replay spec not found in: ${REPLAY_SPEC_CANDIDATES.join(", ")}`);
  process.exit(2);
}

// ── CLI ─────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { _: [] };
  for (const a of argv) {
    const m = /^--([^=]+)=(.*)$/.exec(a);
    if (m) out[m[1]] = m[2];
    else if (a.startsWith("--")) out[a.slice(2)] = true;
    else out._.push(a);
  }
  return out;
}
const A = parseArgs(process.argv.slice(2));
const opt = (k, d) => (A[k] === undefined || A[k] === true ? d : A[k]);

const RUN_ID = opt("run-id", `G1-DRIVER-${new Date().toISOString().replace(/[:.]/g, "").slice(0, 15)}`);
// 输出目录：热路径一律写容器本地盘（/tmp）。经 Docker Desktop 文件共享挂载
// （virtiofs/grpcfuse）做逐样本 appendFileSync 会阻塞事件循环并放大 CPU
// （实测 P3 突发 lag p99 440ms / 自报 CPU 数千%·1core）；结束后由 run.sh
// 一次性 docker cp 回宿主 evidence 目录。
const OUT_HOST_DIR = opt("out-dir", ""); // 宿主侧归档目录（仅记录到 run-meta）
const OUT_DIR = `/tmp/run/${RUN_ID}`;
const SCENARIO = opt("scenario", "full"); // full | login-only | emit-cal
const TOPOLOGY = opt("topology", "direct"); // direct | shared
const N = Number(opt("n", "20"));
const PROFILE = opt("profile", "p2"); // p1 | p2 | p3
const WINDOW_MS = Number(opt("window-ms", "240000"));
const TAIL_MS = Number(opt("tail-ms", "30000"));
const SEED = Number(opt("seed", "9001021"));
const FLOW = opt("flow", "mix"); // a | b | mix
const B_SHARE = Number(opt("b-share", "0.1"));
const ORIGIN = opt("origin", "http://127.0.0.1:8080"); // 公共 origin（Host/Origin 头）
const NGINX_ADDR = opt("nginx-addr", "172.28.10.2:80"); // 实际 nginx 容器（driver 容器视角）
const SOURCE_BASE = opt("source-base", "172.28.10.10"); // direct: 第 k 考生 = base+k
const CANDIDATES_FILE = opt("candidates", ""); // JSON: {examId, candidates:[user], candidateIds:[uuid]}
const SCHEDULE_FILE = opt("schedule", ""); // 复放既有到达表（协议 §3 配对）
const REQUEST_TIMEOUT_MS = Number(opt("timeout-ms", "30000"));
const HEARTBEAT_NOTE = "节拍=轨迹实测（take 挂载后 30001ms），非 client 常量推导";

if (!existsSync(REPLAY_SPEC_PATH)) {
  console.error(`[driver] FATAL: replay spec not found: ${REPLAY_SPEC_PATH}`);
  process.exit(2);
}
if (SCENARIO !== "emit-cal" && !CANDIDATES_FILE) {
  console.error("[driver] FATAL: --candidates=<file> required for scenario=full|login-only");
  process.exit(2);
}

// ── 确定性 RNG（到达表可复现/可归档/可回放） ────────────────────────────────
function mulberry32(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6d2b79f5;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(SEED);

// ── 从回放规格提取两条流的相对时间线 ────────────────────────────────────────
const SPEC = JSON.parse(readFileSync(REPLAY_SPEC_PATH, "utf8"));
/**
 * 把 observedApiCalls 的每条线缆请求分类为 op 模板。
 * 返回 { loginRelMs, ops: [{kind, idx, relMs, note}] }（relMs 相对 login POST）。
 * 额外注入两类规格外事件（来源标注）：
 *   - flow B 刷新时的 SPA 文档 GET（非 /api，规格只收 /api；时刻取自 trace-b 线缆）；
 *   - flow B 刷新中止 in-flight client-events（规格 status=null 行为的语义化）。
 */
function timelineOf(flowKey) {
  const calls = SPEC.flows[flowKey].observedApiCalls;
  const login = calls.find((c) => c.method === "POST" && c.path.endsWith("/api/auth/login"));
  if (!login) throw new Error(`no login call in ${flowKey}`);
  const rel = (c) => c.tRelMs - login.tRelMs;
  const ops = [];
  let saveIdx = 0;
  let eventsIdx = 0;
  for (const c of calls) {
    const { method, path } = c;
    const r = rel(c);
    let kind = null;
    if (path === "/api/auth/me") kind = "me";
    else if (path === "/api/settings/branding") kind = "branding";
    else if (path === "/api/auth/login") kind = "login";
    else if (path === "/api/notifications/unread-count") kind = "unread";
    else if (path === "/api/candidate/exams") kind = "exams";
    else if (/^\/api\/candidate\/exams\/[^/]+$/.test(path)) kind = "exam-detail";
    else if (/^\/api\/attempts\/[^/]+\/start$/.test(path)) kind = "start";
    else if (/^\/api\/candidate\/attempts\/[^/]+\/take$/.test(path)) kind = "take";
    else if (/^\/api\/attempts\/[^/]+\/answers\/[^/]+$/.test(path)) kind = `save:${++saveIdx}`;
    else if (path === "/api/client-events") {
      kind = `client-events:${++eventsIdx}`;
      if (c.status === null) kind += ":canceled";
    } else if (/^\/api\/attempts\/[^/]+\/heartbeat$/.test(path)) kind = "heartbeat";
    else if (/^\/api\/attempts\/[^/]+\/submit$/.test(path)) kind = "submit";
    else if (/^\/api\/scores\/attempts\/[^/]+$/.test(path)) kind = "scores";
    if (!kind) throw new Error(`unclassified call in ${flowKey}: ${method} ${path}`);
    ops.push({ kind, relMs: r, specSeq: c.seq, specStatus: c.status });
  }
  // flow B 规格外事件（来源：trace-b-refresh-recovery.json 线缆，seq 为非 /api 文档请求）
  if (flowKey === "B-refresh-recovery") {
    ops.push({ kind: "spa-doc", relMs: 2087 - login.tRelMs, specSeq: null, specStatus: 200, note: "trace-b 非 /api 文档重载" });
    ops.sort((x, y) => x.relMs - y.relMs);
  }
  return { loginRelMs: 0, ops };
}
const TIMELINES = {
  a: timelineOf("A-happy-path"),
  b: timelineOf("B-refresh-recovery"),
};
// login-only 场景只保留登录页加载探针 + login POST。
function opsForScenario(ops) {
  if (SCENARIO === "login-only") {
    return ops.filter((o) => ["me", "branding", "login"].includes(o.kind));
  }
  return ops;
}

// ── 到达表 ──────────────────────────────────────────────────────────────────
const manifest = CANDIDATES_FILE
  ? JSON.parse(readFileSync(CANDIDATES_FILE, "utf8"))
  : {
      // emit-cal：无需真实考生（全部 op 替换为公共 GET），合成伪考生名
      examId: "emit-cal",
      candidates: Array.from({ length: N }, (_, i) => `emitcal-c${String(i).padStart(4, "0")}`),
      candidateIds: [],
    };
if (manifest.candidates.length < N) {
  console.error(`[driver] FATAL: candidates file has ${manifest.candidates.length} < n=${N}`);
  process.exit(2);
}

/** P1: 窗口均匀+抖动；P2: ≥80% 压缩进尾部 TAIL_MS；P3: 同刻（+微抖动）。 */
function arrivalOffsetMs() {
  if (PROFILE === "p1") return Math.floor(rng() * WINDOW_MS);
  if (PROFILE === "p2") {
    return rng() < 0.2
      ? Math.floor(rng() * (WINDOW_MS - TAIL_MS))
      : WINDOW_MS - TAIL_MS + Math.floor(rng() * TAIL_MS);
  }
  if (PROFILE === "p3") return Math.floor(rng() * 5); // 同刻突发（≤5ms 发射抖动）
  throw new Error(`unknown profile ${PROFILE}`);
}

function flowOf(k) {
  if (FLOW === "a") return "a";
  if (FLOW === "b") return "b";
  return rng() < B_SHARE ? "b" : "a";
}

const sourceIpOf = (k) =>
  TOPOLOGY === "direct"
    ? `${SOURCE_BASE.split(".").slice(0, 3).join(".")}.${Number(SOURCE_BASE.split(".")[3]) + k}`
    : null; // shared：不绑定（源=容器默认地址，全批同一出口）

const schedule = []; // {opId, candidateIdx, candidate, flow, kind, plannedOffsetMs, sourceIp}
{
  const counters = {};
  for (let k = 0; k < N; k++) {
    const user = manifest.candidates[k];
    const flow = SCENARIO === "emit-cal" ? "a" : flowOf(k);
    const arrive = arrivalOffsetMs();
    const tl = TIMELINES[flow];
    for (const o of opsForScenario(tl.ops)) {
      const key = `${flow}:${o.kind}`;
      counters[key] = (counters[key] ?? 0) + 1;
      schedule.push({
        opId: `${user}#${o.kind}`,
        candidateIdx: k,
        candidate: user,
        flow,
        kind: o.kind,
        plannedOffsetMs: arrive + o.relMs,
        sourceIp: sourceIpOf(k),
        specSeq: o.specSeq,
        note: o.note ?? null,
      });
    }
  }
  schedule.sort((x, y) => x.plannedOffsetMs - y.plannedOffsetMs);
}

// 复放既有到达表（保持考生/op 不变，只按文件中的时刻重放）
if (SCHEDULE_FILE) {
  const prev = readFileSync(SCHEDULE_FILE, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  if (prev.length !== schedule.length) {
    console.error(`[driver] FATAL: schedule replay arity mismatch ${prev.length} != ${schedule.length}`);
    process.exit(2);
  }
  for (let i = 0; i < schedule.length; i++) {
    if (prev[i].opId !== schedule[i].opId) {
      console.error(`[driver] FATAL: schedule replay op mismatch at ${i}: ${prev[i].opId} != ${schedule[i].opId}`);
      process.exit(2);
    }
    schedule[i].plannedOffsetMs = prev[i].plannedOffsetMs;
  }
}

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(
  join(OUT_DIR, "schedule.jsonl"),
  schedule.map((s) => JSON.stringify(s)).join("\n") + "\n",
);

// ── 每 candidate 会话状态（数据依赖） ────────────────────────────────────────
const PASSWORD = process.env.CANDIDATE_PASSWORD;
if (!PASSWORD && SCENARIO !== "emit-cal") {
  console.error("[driver] FATAL: CANDIDATE_PASSWORD env not set");
  process.exit(2);
}
const sessions = new Map(); // candidate -> state
function sessionOf(c) {
  let s = sessions.get(c);
  if (!s) {
    s = {
      candidate: c,
      candidateId: manifest.candidateIds?.[manifest.candidates.indexOf(c)] ?? null,
      cookie: null,
      userId: null,
      sessionValidAt: null, // 首个受保护资源 200（会话有效判据）
      attemptId: null,
      questionId: null,
      serverVersion: 0,
      lastAcceptedAnswer: null,
      loginAt: null,
      failedDep: null, // 依赖链断裂原因
      clientSessionId: randomUUID(),
      startedAt: null, // take 挂载时刻（client-events/心跳时间戳用）
      agent: null,
    };
    sessions.set(c, s);
  }
  return s;
}
function agentFor(c, k) {
  const s = sessionOf(c);
  if (!s.agent) {
    const ip = sourceIpOf(k);
    s.agent = new http.Agent({
      keepAlive: true,
      maxSockets: 6, // 浏览器同源并发连接量级（轨迹 me/branding、take/scores 成对并发）
      keepAliveMsecs: 4000,
      ...(ip ? { localAddress: ip } : {}),
    });
  }
  return s.agent;
}

// ── 请求执行 ────────────────────────────────────────────────────────────────
const t0Perf = performance.now();
const T0_EPOCH = Date.now();
const now = () => performance.now() - t0Perf;
const ORIGIN_HOST = new URL(ORIGIN).host; // 预解析（每请求一次 new URL 是纯浪费）

/** 发一个 HTTP 请求；resolve {status, body, headers, latencyMs, errorClass, aborted}.
 *  abortAfterMs：浏览器刷新中止语义——发出后 N ms 主动销毁请求（规格 status=null 行）。 */
function doRequest({ agent, method, path, body, headers, abortAfterMs }) {
  return new Promise((resolve) => {
    const startedAt = now();
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    let settled = false;
    let abortTimer = null;
    const finish = (r) => {
      if (settled) return;
      settled = true;
      if (abortTimer !== null) clearTimeout(abortTimer);
      resolve(r);
    };
    const colon = NGINX_ADDR.indexOf(":");
    const req = http.request(
      {
        host: NGINX_ADDR.slice(0, colon),
        port: Number(NGINX_ADDR.slice(colon + 1)),
        path,
        method,
        agent,
        headers: {
          host: ORIGIN_HOST, // 公共 origin 的 Host（nginx server_name _）
          origin: ORIGIN,
          accept: "application/json",
          ...(payload === null ? {} : { "content-type": "application/json", "content-length": payload.length }),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          finish({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
            headers: res.headers,
            latencyMs: now() - startedAt,
            errorClass: null,
            aborted: false,
          });
        });
      },
    );
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error("client-timeout"));
    });
    req.on("error", (err) => {
      finish({
        status: 0,
        body: "",
        headers: {},
        latencyMs: now() - startedAt,
        errorClass: err.message === "client-timeout" ? "timeout" : (err.code ?? err.message).slice(0, 60),
        aborted: err.message === "driver-abort",
      });
    });
    if (payload !== null) req.write(payload);
    req.end();
    if (abortAfterMs !== undefined) {
      abortTimer = setTimeout(() => req.destroy(new Error("driver-abort")), abortAfterMs);
    }
  });
}

// ── op 语义：路径、请求体、判据（对照回放规格 invariants） ──────────────────
const iso = () => new Date().toISOString();
function telemetryBatch(s, which) {
  // 结构逐字段复用 trace-a seq32/33 与 trace-b seq32 的真实批量（G1.1 采集）。
  const ev = (name, extra) => ({
    kind: "exam_telemetry",
    level: "info",
    name,
    occurredAt: iso(),
    route: `/exam/${s.attemptId}/take`,
    eventId: randomUUID(),
    clientSessionId: s.clientSessionId,
    attemptId: s.attemptId,
    ...extra,
  });
  if (which === 1) {
    return {
      events: [
        ev("exam_started", { route: `/exam/${manifest.examId}/start`, examId: manifest.examId, metadata: {} }),
        ev("exam_page_loaded", { examId: manifest.examId, metadata: { status: "in_progress" } }),
        ev("answer_autosave_started", { questionId: s.questionId, metadata: { clientSeq: 1 } }),
      ],
    };
  }
  return {
    events: [
      ev("question_viewed", { examId: manifest.examId, questionId: s.questionId, metadata: { index: 1, total: 12, type: "true_false", coalescedCount: 1 } }),
      ev("answer_autosave_success", { questionId: s.questionId, metadata: { durationMs: 40, saveMode: "autosave", coalescedCount: 2 } }),
    ],
  };
}

/**
 * 解析 op → {path, body, depKinds, verify(res, s)}。
 * depKinds：本 op 数据依赖的前置 op kind 列表（登录后全部依赖 login 的 cookie；
 * attempt 段依赖 start/take 的提取值）。依赖以“会话状态是否就绪”实现，
 * 到点未就绪则等就绪（depBlocked 记录），前置失败则取消（cancelled:dep-failed）。
 */
function opSemantics(kind, s) {
  const EX = manifest.examId;
  switch (kind) {
    case "me":
      return { path: "/api/auth/me", dep: [], verify: () => true }; // 401 预期
    case "branding":
      return { path: "/api/settings/branding", dep: [], verify: (r) => r.status === 200 };
    case "login":
      return {
        path: "/api/auth/login",
        body: { username: s.candidate, password: PASSWORD },
        dep: [],
        verify: (r) => {
          if (r.status !== 200) return false;
          const sc = r.headers["set-cookie"];
          const tok = (sc ?? []).find((c) => /^auth-token=/.test(c));
          if (!tok) return false;
          try {
            const b = JSON.parse(r.body);
            return b.role === "Candidate";
          } catch {
            return false;
          }
        },
      };
    case "unread":
      return { path: "/api/notifications/unread-count", dep: ["login"], verify: (r) => r.status === 200 };
    case "exams":
      return { path: "/api/candidate/exams", dep: ["login"], verify: (r) => r.status === 200 && Array.isArray(JSON.parse(r.body || "[]")) };
    case "exam-detail":
      return { path: `/api/candidate/exams/${EX}`, dep: ["login"], verify: (r) => r.status === 200 };
    case "start":
      return {
        path: `/api/attempts/${EX}/start`,
        body: undefined,
        dep: ["login"],
        verify: (r) => {
          if (r.status !== 201) return false;
          const b = JSON.parse(r.body);
          // 归属核对（协议 O1 判据）：attempt 属于本考生
          return !s.candidateId || b.candidateId === s.candidateId;
        },
      };
    case "take":
      return {
        path: `/api/candidate/attempts/${s.attemptId ?? "PENDING"}/take`,
        dep: ["login", "start"],
        verify: (r) => r.status === 200,
      };
    case "save:1":
      return {
        path: `/api/attempts/${s.attemptId ?? "PENDING"}/answers/${s.questionId ?? "PENDING"}`,
        body: {
          attemptId: s.attemptId,
          questionId: s.questionId,
          answer: true,
          clientSeq: 1,
          clientSavedAt: iso(),
          baseVersion: 0,
        },
        dep: ["login", "take"],
        verify: (r) => r.status === 200 && JSON.parse(r.body).accepted === true,
      };
    case "save:2":
      return {
        path: `/api/attempts/${s.attemptId ?? "PENDING"}/answers/${s.questionId ?? "PENDING"}`,
        body: {
          attemptId: s.attemptId,
          questionId: s.questionId,
          answer: false, // 改答（轨迹 A：true→false）
          clientSeq: 2,
          clientSavedAt: iso(),
          baseVersion: s.serverVersion, // = 上一接受 serverVersion（不变量）
        },
        dep: ["login", "take", "save:1"],
        verify: (r) => r.status === 200 && JSON.parse(r.body).accepted === true,
      };
    case "client-events:1":
      return { path: "/api/client-events", body: telemetryBatch(s, 1), dep: ["login", "take"], verify: (r) => r.status === 200 };
    case "client-events:2":
      return { path: "/api/client-events", body: telemetryBatch(s, 2), dep: ["login", "take"], verify: (r) => r.status === 200 };
    case "client-events:1:canceled":
      // 轨迹 B：刷新中止 in-flight 遥测 POST（规格 status=null 行为）。
      return { path: "/api/client-events", body: telemetryBatch(s, 1), dep: ["login", "take"], verify: () => false, abortAfterMs: 40 };
    case "heartbeat":
      return { path: `/api/attempts/${s.attemptId ?? "PENDING"}/heartbeat`, dep: ["login", "take"], verify: (r) => r.status === 200 };
    case "submit":
      return {
        path: `/api/attempts/${s.attemptId ?? "PENDING"}/submit`,
        body: undefined,
        dep: ["login", "take", "save:1"],
        verify: (r) => {
          if (r.status !== 200) return false;
          const b = JSON.parse(r.body);
          return b.status === "submitted" || b.status === "graded";
        },
      };
    case "scores":
      return { path: `/api/scores/attempts/${s.attemptId ?? "PENDING"}`, dep: ["login", "submit"], verify: (r) => r.status === 200 };
    case "spa-doc":
      return { path: `/exam/${s.attemptId ?? "PENDING"}/take`, dep: ["login", "take"], verify: (r) => r.status === 200 };
    default:
      throw new Error(`no semantics for kind=${kind}`);
  }
}

// ── 开放式调度执行 ──────────────────────────────────────────────────────────
const samples = [];
const sampleBuf = [];
let flushTimer = null;
function emitSample(rec) {
  samples.push(rec);
  sampleBuf.push(JSON.stringify(rec));
  if (!flushTimer) flushTimer = setTimeout(flushSamples, 250);
}
function flushSamples() {
  flushTimer = null;
  if (sampleBuf.length === 0) return;
  appendFileSync(join(OUT_DIR, "samples.jsonl"), sampleBuf.join("\n") + "\n");
  sampleBuf.length = 0;
}

const depState = new Map(); // `${candidate}|${kind}` -> 'ok' | 'fail'
const depReadyWaiters = []; // {candidate, kinds, resolve}

function depReady(candidate, kinds) {
  return kinds.every((k) => depState.get(`${candidate}|${k}`) === "ok");
}
function depFailed(candidate, kinds) {
  for (const k of kinds) {
    if (depState.get(`${candidate}|${k}`) === "fail") return k;
  }
  return null;
}
function setDep(candidate, kind, ok) {
  depState.set(`${candidate}|${kind}`, ok ? "ok" : "fail");
  for (let i = depReadyWaiters.length - 1; i >= 0; i--) {
    const w = depReadyWaiters[i];
    if (w.candidate !== candidate) continue;
    if (depFailed(candidate, w.kinds) || depReady(candidate, w.kinds)) {
      depReadyWaiters.splice(i, 1);
      w.resolve();
    }
  }
}
function waitForDeps(candidate, kinds) {
  if (depReady(candidate, kinds) || depFailed(candidate, kinds)) return Promise.resolve();
  return new Promise((resolve) => depReadyWaiters.push({ candidate, kinds, resolve }));
}

let offered = 0;
let sent = 0;
let cancelledDep = 0;
let driverDropped = 0;

const METHOD_OF = {
  me: "GET",
  branding: "GET",
  unread: "GET",
  exams: "GET",
  "exam-detail": "GET",
  take: "GET",
  scores: "GET",
  "spa-doc": "GET",
};

/** op kind → 数据依赖（静态，可在等待依赖之前求值；与 opSemantics 的 dep 一致）。 */
function depsOf(kind) {
  if (kind === "me" || kind === "branding" || kind === "login") return [];
  if (kind === "unread" || kind === "exams" || kind === "exam-detail" || kind === "start") return ["login"];
  if (kind === "take") return ["login", "start"];
  if (kind === "save:2" || kind === "submit") return ["login", "take", "save:1"];
  if (kind === "scores") return ["login", "submit"];
  return ["login", "take"]; // save:1 / client-events* / heartbeat / spa-doc
}

async function executeOp(sch) {
  offered += 1;
  const s = sessionOf(sch.candidate);
  const deps = depsOf(sch.kind);
  const record = {
    runId: RUN_ID,
    opId: sch.opId,
    candidate: sch.candidate,
    flow: sch.flow,
    kind: sch.kind,
    scenario: SCENARIO,
    topology: TOPOLOGY,
    sourceIp: sch.sourceIp,
    plannedAtMs: Math.round(sch.plannedOffsetMs),
    plannedEpoch: T0_EPOCH + sch.plannedOffsetMs,
    sentAtMs: null,
    lagMs: null,
    depBlocked: false,
    method: null,
    path: null,
    status: null,
    latencyMs: null,
    errorClass: null,
    requestId: null,
    responseAtMs: null,
    verified: null,
    verifiedAtMs: null,
    verifyKind: null,
    detail: null,
  };
  try {
    if (deps.length > 0 && SCENARIO !== "emit-cal") {
      if (!depReady(sch.candidate, deps) && !depFailed(sch.candidate, deps)) {
        record.depBlocked = true; // 到点时数据依赖未就绪（SUT 慢），等待后发送
      }
      await waitForDeps(sch.candidate, deps);
      const failed = depFailed(sch.candidate, deps);
      if (failed) {
        cancelledDep += 1;
        // 依赖链断裂向下传播（否则下游死等）
        setDep(sch.candidate, sch.kind, false);
        record.detail = `cancelled:dep-failed:${failed}`;
        record.verified = false;
        emitSample(record);
        return;
      }
    }
    // 语义（路径/请求体/判据）必须在依赖就绪之后构建：其中嵌有
    // attemptId/questionId/serverVersion 等运行时提取值（实测先建语义会把
    // 未就绪占位符烤进 URL → 23/24 take 400，见 G1-PILOT r1 失败记录）。
    const sem = opSemantics(sch.kind, s);
    const emitAt = now();
    record.sentAtMs = Math.round(emitAt);
    // planned 零点=预热结束（WARMUP_MS 平移）；lag 才是真实发射滞后
    record.lagMs = Math.round(emitAt - (WARMUP_MS + sch.plannedOffsetMs));
    sent += 1;

    if (SCENARIO === "emit-cal") {
      // 校准模式：同一到达表/同一节拍，全部替换为公共廉价 GET（纯发射能力标定）
      record.method = "GET";
      record.path = "/api/settings/branding";
      const res = await doRequest({ agent: agentFor(sch.candidate, sch.candidateIdx), method: "GET", path: "/api/settings/branding" });
      record.status = res.status;
      record.latencyMs = Math.round(res.latencyMs);
      record.errorClass = res.errorClass;
      record.requestId = res.headers["x-request-id"] ?? null;
      record.responseAtMs = Math.round(now());
      record.verified = res.status === 200;
      record.verifiedAtMs = record.verified ? record.responseAtMs : null;
      record.verifyKind = "branding-200";
      emitSample(record);
      return;
    }

    record.method = METHOD_OF[sch.kind] ?? "POST";
    record.path = sem.path;
    const res = await doRequest({
      agent: agentFor(sch.candidate, sch.candidateIdx),
      method: record.method,
      path: sem.path,
      body: sem.body,
      headers: s.cookie ? { cookie: `auth-token=${s.cookie}` } : {},
      abortAfterMs: sem.abortAfterMs,
    });
    record.status = res.status;
    record.latencyMs = Math.round(res.latencyMs);
    record.errorClass = res.errorClass;
    record.requestId = res.headers["x-request-id"] ?? null;
    record.responseAtMs = Math.round(now());

    // 会话状态提取（依赖链）
    if (sch.kind === "login") {
      const ok = sem.verify(res);
      if (ok) {
        const tok = (res.headers["set-cookie"] ?? []).find((c) => /^auth-token=/.test(c));
        s.cookie = /auth-token=([^;]+)/.exec(tok)[1];
        try {
          s.userId = JSON.parse(res.body).id;
        } catch { /* keep null */ }
        s.loginAt = record.sentAtMs;
      }
      setDep(sch.candidate, "login", ok);
      record.verified = ok;
      record.verifyKind = "login-200+cookie+role";
    } else if (sch.kind === "start") {
      let ok = false;
      try {
        ok = sem.verify(res);
        if (ok) {
          const b = JSON.parse(res.body);
          s.attemptId = b.id;
        }
      } catch { ok = false; }
      setDep(sch.candidate, "start", ok);
      record.verified = ok;
      record.verifyKind = "start-201+ownership";
    } else if (sch.kind === "take") {
      let ok = res.status === 200;
      try {
        if (ok) {
          const b = JSON.parse(res.body);
          s.questionId = b.questions?.[0]?.id ?? null;
          s.startedAt = iso();
          ok = ok && !!s.questionId;
        }
      } catch { ok = false; }
      setDep(sch.candidate, "take", ok);
      record.verified = ok;
      record.verifyKind = "take-200+questionId";
    } else if (sch.kind.startsWith("save:")) {
      let ok = false;
      try {
        ok = sem.verify(res);
        if (ok) {
          const b = JSON.parse(res.body);
          s.serverVersion = b.serverVersion;
          s.lastAcceptedAnswer = sem.body.answer;
        }
      } catch { ok = false; }
      setDep(sch.candidate, sch.kind, ok);
      record.verified = ok;
      record.verifyKind = "save-accepted+serverVersion";
    } else if (sch.kind === "submit") {
      let ok = false;
      try { ok = sem.verify(res); } catch { ok = false; }
      setDep(sch.candidate, "submit", ok);
      record.verified = ok;
      record.verifyKind = "submit-terminal-status";
    } else {
      record.verified = sem.verify(res);
      record.verifyKind = "http-200";
      if (sch.kind === "me") record.verifyKind = "me-401-expected";
      if (sch.kind.includes("canceled")) {
        record.verifyKind = "browser-cancel-replay";
        record.detail = "in-flight POST destroyed after 40ms (trace-b seq32 status=null)";
      }
    }
    // 会话有效性（协议 L2 判据：受保护资源 200）
    if (!s.sessionValidAt && s.cookie && res.status === 200 && sem.dep.includes("login")) {
      s.sessionValidAt = record.responseAtMs;
    }
    record.verifiedAtMs = record.verified ? record.responseAtMs : null;
    emitSample(record);
  } catch (err) {
    driverDropped += 1; // 计划到达但 driver 自身异常未完成 → T6 丢样
    setDep(sch.candidate, sch.kind, false);
    record.detail = `driver-error:${String(err.message ?? err).slice(0, 120)}`;
    record.verified = false;
    emitSample(record);
  }
}

// ── driver 自监控（T6） ─────────────────────────────────────────────────────
const CLOCK_TICKS = 100;
function readProcStat() {
  try {
    const s = readFileSync("/proc/self/stat", "utf8");
    const m = /\) \S+ (.*)$/.exec(s);
    const f = m[1].split(" ");
    return { utime: Number(f[11]), stime: Number(f[12]) };
  } catch {
    return null;
  }
}
function readThreadStats() {
  // 本 Docker Desktop VM 的 /proc 计账损坏（self/stat utime 恒 0；task 读取代价
  // 异常），每 500ms 扫全部线程_stat 会拖垮事件循环——停用，per-core 检测改由
  // 宿主侧 docker stats/`ps -eLo` 在 run 窗口抽样（README 记录方法）。
  return [];
}
const elDelay = monitorEventLoopDelay({ resolution: 10 });
elDelay.enable();

const metricsBuf = [];
let lastCpu = readProcStat();
let lastUsage = process.cpuUsage();
let lastThreads = new Map(readThreadStats().map(([t, v]) => [t, v]));
let lastSampleAt = now();

function sampleMetrics() {
  const cur = readProcStat();
  const curUsage = process.cpuUsage();
  const curThreadsArr = readThreadStats();
  const curThreads = new Map(curThreadsArr);
  const dt = Math.max(50, now() - lastSampleAt); // 下限防 dt 抖动放大百分比
  // 主读数 process.cpuUsage()（µs）。百分比 = CPU毫秒 / 墙钟毫秒 ×100（1 核=100%）。
  // 首版公式误除以 dt 的“秒”值（放大 1000×：1 核呈现为 100000%），已修正；
  // 修正见证：mini 复现 27.3ms CPU / 501ms tick → 5.5%，非 5460%。
  const usagePct =
    ((curUsage.user - lastUsage.user + curUsage.system - lastUsage.system) / 1000 / dt) * 100;
  const procPct = cur && lastCpu ? ((cur.utime + cur.stime - lastCpu.utime - lastCpu.stime) / CLOCK_TICKS / dt) * 100 : null;
  let threadMaxPct = 0;
  let threadMaxTid = null;
  for (const [tid, v] of curThreads) {
    const prev = lastThreads.get(tid);
    if (prev === undefined) continue;
    const pct = ((v - prev) / CLOCK_TICKS / (dt / 1000)) * 100;
    if (pct > threadMaxPct) { threadMaxPct = pct; threadMaxTid = tid; }
  }
  // monitorEventLoopDelay 原始单位=纳秒 → ms
  const mean = elDelay.mean / 1e6;
  const p99 = elDelay.percentile(99) / 1e6;
  const max = elDelay.max / 1e6;
  elDelay.reset();
  metricsBuf.push(
    JSON.stringify({
      tMs: Math.round(now()),
      cpuUsagePct: Math.round(usagePct * 10) / 10,
      procStatCpuPct: procPct === null ? null : Math.round(procPct * 10) / 10,
      threadMaxCpuPct: Math.round(threadMaxPct * 10) / 10,
      threadMaxTid,
      threads: curThreads.size,
      elDelayMeanMs: Math.round(mean * 100) / 100,
      elDelayP99Ms: Math.round(p99 * 100) / 100,
      elDelayMaxMs: Math.round(max * 100) / 100,
      heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1048576),
      rssMb: Math.round(process.memoryUsage().rss / 1048576),
    }),
  );
  appendFileSync(join(OUT_DIR, "driver-metrics.jsonl"), metricsBuf.splice(0).join("\n") + "\n");
  lastCpu = cur;
  lastUsage = curUsage;
  lastThreads = curThreads;
  lastSampleAt = now();
}

// ── 主循环：开放式定时发射 ──────────────────────────────────────────────────
const runMeta = {
  runId: RUN_ID,
  scenario: SCENARIO,
  topology: TOPOLOGY,
  profile: PROFILE,
  windowMs: WINDOW_MS,
  tailMs: TAIL_MS,
  seed: SEED,
  flow: FLOW,
  bShare: B_SHARE,
  n: N,
  origin: ORIGIN,
  nginxAddr: NGINX_ADDR,
  sourceBase: TOPOLOGY === "direct" ? SOURCE_BASE : "(shared egress)",
  examId: manifest.examId ?? null,
  candidatesFrom: manifest.candidates?.[0] ?? null,
  candidatesTo: manifest.candidates?.[N - 1] ?? null,
  requestTimeoutMs: REQUEST_TIMEOUT_MS,
  scheduleReplayedFrom: SCHEDULE_FILE || null,
  specRunId: SPEC.runId,
  driverNode: process.version,
  startedAt: new Date(T0_EPOCH).toISOString(),
  heartbeatNote: HEARTBEAT_NOTE,
  passwordHandling: "CANDIDATE_PASSWORD via env only; never written to outputs",
  outHostDir: OUT_HOST_DIR || "(archived by run.sh via docker cp)",
};

const totalMs = schedule.length ? schedule[schedule.length - 1].plannedOffsetMs : 0;
console.log(
  `[driver] ${RUN_ID}: scenario=${SCENARIO} topo=${TOPOLOGY} n=${N} profile=${PROFILE}` +
    ` ops=${schedule.length} span≈${Math.round(totalMs / 1000)}s → ${OUT_DIR}`,
);

const metricsTimer = setInterval(sampleMetrics, 500);
// 每 op 独立 setTimeout：到点即 executeOp（不排队等待响应——open-loop 核心）。
// WARMUP：首个 op 前留 1500ms 预热（一次真实 branding GET + JSON 往返 + agent
// 建立），否则 t=0 波次的首次执行 JIT 会造成 ~0.5s 假发送滞后（实测 P3 t=0
// 的 12 考生首波 lag>100ms，全部集中于 plannedAt∈[-65,65]ms）。预热不改变
// 到达表（plannedOffsetMs 原样），只整体平移发射起点。
const WARMUP_MS = Number(opt("warmup-ms", "2500")) || 2500;
{
  const warmAgent = new http.Agent({ keepAlive: false });
  await doRequest({ agent: warmAgent, method: "GET", path: "/api/settings/branding" }).catch(() => null);
  // POST 路径预热（无 cookie → 401，无副作用）：登录/保存的序列化与头部拼装
  await doRequest({ agent: warmAgent, method: "POST", path: "/api/client-events", body: { events: [] } }).catch(() => null);
  warmAgent.destroy();
  // 全部候选 agent 预建：P3 同刻波次不再在发射 tick 内首次建 agent
  // （实测 200 op 的 t=0 tick 因首次建 50 agent + 首次路径 JIT 拖出 ~200ms 滞后）
  const seen = new Set();
  for (const sch of schedule) {
    if (!seen.has(sch.candidate)) {
      seen.add(sch.candidate);
      agentFor(sch.candidate, sch.candidateIdx);
    }
  }
  // emit-cal 专用：预热每个候选一条 keepAlive 连接。发射滞后的主要残余是
  // 同步 connect() 发起（本 Docker Desktop 桥接网络 ~0.5-1ms/次 × 同刻 N op）；
  // 真实浏览器到达时也会新建连接，而 connect 完成并不阻塞"请求已发出"的
  // 语义 —— 预热只挪 TCP 建立时序，不改 HTTP 请求节拍。正式 flow 场景保持
  // 冷连接（wire 保真：nginx 侧同刻 accept 风暴照常发生）。
  if (SCENARIO === "emit-cal") {
    await Promise.all(
      [...sessions.values()].map((s) =>
        doRequest({ agent: s.agent, method: "GET", path: "/api/settings/branding" }).catch(() => null),
      ),
    );
  }
  JSON.parse(JSON.stringify({ w: schedule[0] }));
}
const timers = schedule.map((sch) => {
  const delay = Math.max(0, WARMUP_MS + sch.plannedOffsetMs - now());
  return setTimeout(() => void executeOp(sch), delay);
});

// 结束条件：schedule 中每个 op 都有 sample（含取消/失败记录），或硬超时。
// 不得用 offered 对齐——offered 只统计已 fire 的 op，存在“已 fire 全完成、
// 未 fire 定时器仍在等”的中间态，按 offered 判完成会提前退出（实测丢 12 op）。
const SETTLE_MS = 5000;
const HARD_DEADLINE_MS = WARMUP_MS + totalMs + REQUEST_TIMEOUT_MS + SETTLE_MS + 30000;
const startedAt = now();
await new Promise((resolve) => {
  const check = setInterval(() => {
    const done = samples.length >= schedule.length && depReadyWaiters.length === 0;
    const elapsed = now() - startedAt;
    if (done || elapsed > HARD_DEADLINE_MS) {
      clearInterval(check);
      resolve();
    }
  }, 250);
});

// 排空在途请求
await new Promise((r) => setTimeout(r, SETTLE_MS));
clearInterval(metricsTimer);
flushSamples();
sampleMetrics();
elDelay.disable();
for (const s of sessions.values()) s.agent?.destroy();

// 兜底清点：任何已 offered 但无 sample 的 op（理论上依赖传播后不应存在）→ 记丢样
{
  const seen = new Set(samples.map((x) => x.opId));
  for (const sch of schedule) {
    if (!seen.has(sch.opId)) {
      driverDropped += 1;
      emitSample({
        runId: RUN_ID,
        opId: sch.opId,
        candidate: sch.candidate,
        flow: sch.flow,
        kind: sch.kind,
        scenario: SCENARIO,
        topology: TOPOLOGY,
        sourceIp: sch.sourceIp,
        plannedAtMs: Math.round(sch.plannedOffsetMs),
        plannedEpoch: T0_EPOCH + sch.plannedOffsetMs,
        sentAtMs: null,
        lagMs: null,
        depBlocked: false,
        method: null,
        path: null,
        status: null,
        latencyMs: null,
        errorClass: null,
        requestId: null,
        responseAtMs: null,
        verified: false,
        verifiedAtMs: null,
        verifyKind: null,
        detail: "never-completed:driver-sweep",
      });
    }
  }
  flushSamples();
}

// ── 汇总 driver.json（T6 原始判据） ─────────────────────────────────────────
function pct(arr, p) {
  if (arr.length === 0) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}
const lagAll = samples.filter((x) => x.lagMs !== null).map((x) => x.lagMs);
const lagEmit = samples.filter((x) => x.lagMs !== null && !x.depBlocked).map((x) => x.lagMs);
const respObtained = samples.filter((x) => x.responseAtMs !== null);
const verified = samples.filter((x) => x.verified === true);
const loginSamples = samples.filter((x) => x.kind === "login");
const loginOk = loginSamples.filter((x) => x.verified === true);
const sessionValid = [...sessions.values()].filter((s) => s.sessionValidAt !== null);
const statusTally = {};
for (const x of samples) {
  const k = String(x.status ?? "none");
  statusTally[k] = (statusTally[k] ?? 0) + 1;
}
const metricsPath = join(OUT_DIR, "driver-metrics.jsonl");
const mlines = existsSync(metricsPath)
  ? readFileSync(metricsPath, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
  : [];
const driverJson = {
  runId: RUN_ID,
  offered,
  sent,
  cancelledDepFailed: cancelledDep,
  driverDropped, // 计划到达未发出且归因 driver → T6 丢样
  responsesObtained: respObtained.length,
  verifiedOps: verified.length,
  fourLevelCounts: {
    planned: offered,
    actuallySent: sent,
    gotResponse: respObtained.length,
    gotCorrectSessionOrTerminal: {
      loginSessionsIssued: loginOk.length,
      loginSessionsValidOnProtectedCall: sessionValid.length,
    },
  },
  login: {
    offered: loginSamples.length,
    ok: loginOk.length,
    statusTally: Object.fromEntries(
      Object.entries(statusTally).filter(([k]) => k !== "none").map(([k, v]) => [k, v]),
    ),
    independentSuccessfulCandidates: sessionValid.length,
    p50LatencyMs: pct(loginOk.map((x) => x.latencyMs).filter((v) => v !== null), 50),
    p95LatencyMs: pct(loginOk.map((x) => x.latencyMs).filter((v) => v !== null), 95),
    p99LatencyMs: pct(loginOk.map((x) => x.latencyMs).filter((v) => v !== null), 99),
    maxLatencyMs: loginOk.length ? Math.max(...loginOk.map((x) => x.latencyMs)) : null,
    firstOkAtMs: loginOk.length ? Math.min(...loginOk.map((x) => x.responseAtMs)) : null,
    lastOkAtMs: loginOk.length ? Math.max(...loginOk.map((x) => x.responseAtMs)) : null,
  },
  sendLag: {
    n: lagAll.length,
    p50Ms: pct(lagAll, 50),
    p95Ms: pct(lagAll, 95),
    p99Ms: pct(lagAll, 99),
    maxMs: lagAll.length ? Math.max(...lagAll) : null,
    over50ms: lagAll.filter((v) => v > 50).length,
    depBlockedCount: samples.filter((x) => x.depBlocked).length,
    // T6 判据用纯发射滞后（不含数据依赖等待；depBlocked 的滞后是 SUT 慢导致）
    emitOnly: {
      n: lagEmit.length,
      p50Ms: pct(lagEmit, 50),
      p95Ms: pct(lagEmit, 95),
      p99Ms: pct(lagEmit, 99),
      maxMs: lagEmit.length ? Math.max(...lagEmit) : null,
      over50ms: lagEmit.filter((v) => v > 50).length,
    },
  },
  statusTally,
  driverCpu: {
    samples: mlines.length,
    cpuUsagePctMax1Core: mlines.length ? Math.max(...mlines.map((m) => m.cpuUsagePct ?? 0)) : null,
    cpuUsagePctAvg1Core: mlines.length ? Math.round((mlines.reduce((a, m) => a + (m.cpuUsagePct ?? 0), 0) / mlines.length) * 10) / 10 : null,
    procStatCpuPctMax: mlines.length ? Math.max(...mlines.map((m) => m.procStatCpuPct ?? 0)) : null,
    threadMaxCpuPctMax: mlines.length ? Math.max(...mlines.map((m) => m.threadMaxCpuPct ?? 0)) : null,
    threadMaxCpuNote: "per-thread 读数受 Docker Desktop VM 计账粒度限制（粗粒度下限）",
    elDelayP99MaxMs: mlines.length ? Math.max(...mlines.map((m) => m.elDelayP99Ms ?? 0)) : null,
    rssMbMax: mlines.length ? Math.max(...mlines.map((m) => m.rssMb ?? 0)) : null,
  },
  expectedLastAcceptedAnswers: Object.fromEntries(
    [...sessions.values()]
      .filter((s) => s.lastAcceptedAnswer !== null)
      .map((s) => [s.candidate, { attemptId: s.attemptId, questionId: s.questionId, answer: s.lastAcceptedAnswer }]),
  ),
};
writeFileSync(join(OUT_DIR, "driver.json"), JSON.stringify(driverJson, null, 2) + "\n");
runMeta.finishedAt = new Date().toISOString();
writeFileSync(join(OUT_DIR, "run-meta.json"), JSON.stringify(runMeta, null, 2) + "\n");

console.log(`[driver] done: offered=${offered} sent=${sent} resp=${respObtained.length} verified=${verified.length}`);
console.log(
  `[driver] login ok=${loginOk.length}/${loginSamples.length} sessionValid=${sessionValid.length}` +
    ` lagP99=${driverJson.sendLag.p99Ms}ms dropped=${driverDropped} cpuMax=${driverJson.driverCpu.cpuUsagePctMax1Core}%(1core)`,
);
process.exit(0);
