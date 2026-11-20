#!/usr/bin/env node
/**
 * S1-SUBMIT 集中交卷负载 driver（RESEARCH ONLY，#900/#1021；协议 §10 S1-SUBMIT，
 * 降采样矩阵见 PROTOCOL-ADDENDUM §2.1）。
 *
 * 与 G1/L2 回放 driver 的区别：S1 的被测窗口是**交卷风暴**，登录/开考/改答全部
 * 是窗口外的准备相位（协议 G2 S1 行「预先认证并准备等量独立 attempts」）。
 *
 * 相位（单 run 内顺序执行）：
 *   PREP   闭式有界并发（--prep-concurrency，默认 10）：每考生
 *          login → start(201) → take(questionId) → save:1(answer=true)
 *          → save:2(answer=false)；overlay 模式另准备 2 名监考 login。
 *          PREP 是 fixture 准备，不是测量流量；任一 submitter 准备失败 →
 *          run 标 FAILED（等量 attempts 不成立），exit 3。
 *   STEADY 仅 overlay（协议 §2.3 节拍）：背景考生 save ~5s±2 / hb ~15s±5
 *          （开放式定时：按计划时刻发射，不等上一响应）；2 名监考每 3s 轮询
 *          GET /api/admin/exams/:examId/proctor/attempts。持续至最后权威确认+15s。
 *   HB     全部 submitter 在 [T0-25s, T0-8s] 均匀打一次心跳：
 *          真实考生交卷前一直开着页面（心跳继续）；同时保证 lastActivityAt
 *          距 T0 < 25s < 60s heartbeat 超时（HEARTBEAT_TIMEOUT_MS 默认 60000，
 *          否则 scanner 会把 idle attempt 标 disrupted，改变被测路径）。
 *          该心跳在测量窗口（首提交请求→最后确认+10s）之外。
 *   BURST  P3 同刻交卷：submitter k 在 T0+arrival[k] 发射 POST submit
 *          （到达表文件预生成、跨臂跨 run 复放，协议 §3/§9.3）。
 *   SETTLE 全部 submit 取得样本后 +15s（bg/proctor 继续跑满尾窗）。
 *
 * 记录：每 op 一行 samples.jsonl（phase/kind/planned/sent/latency/status/
 * verified/...）；driver 自监控（cpuUsage/elDelay/rss，500ms）→ driver-metrics。
 * 四级计数只对 BURST submit（offered=200 恒定）。
 *
 * 拓扑：沿 G1 修正后的 T-DIRECT —— driver 容器内每身份绑定独一辅助源 IP，
 * 直连 nginx 容器（172.28.10.2:80），无伪造头；IP 分配（本目录 s1-run.sh）：
 *   submitter k=0..199 → 172.28.10.(10+k)；bg j=0..19 → 172.28.10.(210+j)；
 *   proctor A/B → 172.28.10.230/.231。
 *
 * 凭据只经环境变量注入（CANDIDATE_PASSWORD / S1_PROCTOR_PASSWORD），
 * 绝不写入任何输出文件。零依赖（node:http/fs/perf_hooks）。
 */
import http from "node:http";
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { performance, monitorEventLoopDelay } from "node:perf_hooks";

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

const RUN_ID = opt("run-id", `S1-DRIVER-${Date.now()}`);
const OUT_HOST_DIR = opt("out-dir", "");
const OUT_DIR = `/tmp/run/${RUN_ID}`;
const ARM = opt("arm", "same"); // same | cross
const MODE = opt("mode", "pure"); // pure | overlay
const N = Number(opt("n", "200"));
const BG_N = Number(opt("bg-n", "20"));
const MANIFEST_FILE = opt("manifest", "/evidence/fixtures/seed-manifest.json");
const ARRIVAL_FILE = opt("arrival", "/evidence/S1-SUBMIT/arrival-p3-200.json");
const CANDIDATES_FILE = opt("candidates", ""); // s1-run.sh 生成（含 examId 归属）
const PROCTOR_A = opt("proctor-a", "");
const PROCTOR_B = opt("proctor-b", "");
const ORIGIN = opt("origin", "http://127.0.0.1:8080");
const NGINX_ADDR = opt("nginx-addr", "172.28.10.2:80");
const SOURCE_BASE = Number(opt("source-base", "10")); // 172.28.10.SOURCE_BASE+k
const BG_SOURCE_BASE = Number(opt("bg-source-base", "210"));
const PROCTOR_SOURCE_BASE = Number(opt("proctor-source-base", "230"));
const PREP_CONCURRENCY = Number(opt("prep-concurrency", "10"));
const STEADY_LEAD_MS = Number(opt("steady-lead-ms", "75000")); // overlay: prep→T0
const QUIET_MS = Number(opt("quiet-ms", "40000")); // pure: prep→T0
const REQUEST_TIMEOUT_MS = Number(opt("timeout-ms", "60000"));
const POST_BURST_MS = Number(opt("post-burst-ms", "15000"));
const SEED = Number(opt("seed", "9001021"));

const PASSWORD = process.env.CANDIDATE_PASSWORD;
const PROCTOR_PASSWORD = process.env.S1_PROCTOR_PASSWORD;
if (!PASSWORD) { console.error("[s1] FATAL: CANDIDATE_PASSWORD env not set"); process.exit(2); }
if (MODE === "overlay" && !PROCTOR_PASSWORD) { console.error("[s1] FATAL: S1_PROCTOR_PASSWORD env not set"); process.exit(2); }
if (!CANDIDATES_FILE) { console.error("[s1] FATAL: --candidates=<file> required"); process.exit(2); }

// ── 确定性 RNG（steady 节拍抖动可复现） ─────────────────────────────────────
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

// ── 身份装配（candidates.json 由 s1-run.sh 从本轮 manifest 生成） ───────────
const manifest = JSON.parse(readFileSync(MANIFEST_FILE, "utf8"));
const candFile = JSON.parse(readFileSync(CANDIDATES_FILE, "utf8"));
/**
 * candFile: {
 *   arm, mode, examIdSame, examIdsCross: [10],
 *   submitters: [{idx, username, candidateId, examId}],   // idx=到达表键
 *   background: [{idx, username, candidateId, examId}],
 *   proctorA: {username, pollExamId}, proctorB: {username, pollExamId}
 * }
 */
const submitters = candFile.submitters;
const background = candFile.background;
if (submitters.length !== N) {
  console.error(`[s1] FATAL: submitters ${submitters.length} != n=${N}`);
  process.exit(2);
}
if (MODE === "overlay" && background.length !== BG_N) {
  console.error(`[s1] FATAL: background ${background.length} != bg-n=${BG_N}`);
  process.exit(2);
}

// 到达表：[{idx, offsetMs}]（P3：≤5ms 发射抖动；跨臂跨 run 同一文件）
const arrival = JSON.parse(readFileSync(ARRIVAL_FILE, "utf8"));
if (arrival.length !== N) {
  console.error(`[s1] FATAL: arrival table ${arrival.length} != n=${N}`);
  process.exit(2);
}
const arrivalOf = new Map(arrival.map((a) => [a.idx, a.offsetMs]));

// ── 会话状态 ────────────────────────────────────────────────────────────────
const sessions = new Map(); // username -> state
function sessionOf(entry, role) {
  let s = sessions.get(entry.username);
  if (!s) {
    s = {
      username: entry.username,
      candidateId: entry.candidateId ?? null,
      examId: entry.examId ?? null,
      role, // submitter | bg | proctorA | proctorB
      ip: null,
      cookie: null,
      attemptId: null,
      questionId: null,
      serverVersion: 0,
      lastAcceptedAnswer: null,
      clientSeq: 0,
      agent: null,
      prepOk: false,
    };
    sessions.set(entry.username, s);
  }
  return s;
}
function agentFor(s, ip) {
  if (!s.agent) {
    s.ip = ip;
    s.agent = new http.Agent({
      keepAlive: true,
      maxSockets: 6,
      // 60s：T0-25s 心跳建立的连接保到 T0（nginx 默认 keepalive_timeout 75s）
      keepAliveMsecs: 60000,
      localAddress: ip,
    });
  }
  return s.agent;
}

// ── HTTP ────────────────────────────────────────────────────────────────────
const t0Perf = performance.now();
const now = () => performance.now() - t0Perf;
const ORIGIN_HOST = new URL(ORIGIN).host;
function doRequest({ agent, method, path, body, headers }) {
  return new Promise((resolve) => {
    const startedAt = now();
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    let settled = false;
    const finish = (r) => { if (!settled) { settled = true; resolve(r); } };
    const colon = NGINX_ADDR.indexOf(":");
    const req = http.request(
      {
        host: NGINX_ADDR.slice(0, colon),
        port: Number(NGINX_ADDR.slice(colon + 1)),
        path, method, agent,
        headers: {
          host: ORIGIN_HOST,
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
          });
        });
      },
    );
    req.setTimeout(REQUEST_TIMEOUT_MS, () => req.destroy(new Error("client-timeout")));
    req.on("error", (err) => {
      finish({
        status: 0, body: "", headers: {},
        latencyMs: now() - startedAt,
        errorClass: err.message === "client-timeout" ? "timeout" : (err.code ?? err.message).slice(0, 60),
      });
    });
    if (payload !== null) req.write(payload);
    req.end();
  });
}

// ── 样本记录（容器本地盘热路径，结束由 s1-run.sh docker cp 归档） ───────────
const sampleBuf = [];
let flushTimer = null;
function emitSample(rec) {
  sampleBuf.push(JSON.stringify(rec));
  if (!flushTimer) flushTimer = setTimeout(flushSamples, 250);
}
function flushSamples() {
  flushTimer = null;
  if (sampleBuf.length === 0) return;
  appendFileSync(join(OUT_DIR, "samples.jsonl"), sampleBuf.join("\n") + "\n");
  sampleBuf.length = 0;
}
function baseRecord(phase, s, kind) {
  return {
    runId: RUN_ID, phase, actor: s.username, role: s.role, kind,
    plannedEpoch: null, sentEpoch: null, lagMs: null,
    method: null, path: null, status: null, latencyMs: null,
    errorClass: null, verified: null, verifyKind: null,
    serverVersion: null, clientSeq: null, detail: null,
  };
}
async function fire(record, s, { method, path, body }) {
  record.sentEpoch = Date.now();
  record.method = method;
  record.path = path;
  const res = await doRequest({
    agent: s.agent, method, path, body,
    headers: s.cookie ? { cookie: `auth-token=${s.cookie}` } : {},
  });
  record.status = res.status;
  record.latencyMs = Math.round(res.latencyMs);
  record.errorClass = res.errorClass;
  record.responseEpoch = Date.now();
  return res;
}

// ── PREP 语义 ───────────────────────────────────────────────────────────────
const iso = () => new Date().toISOString();
async function prepCandidate(entry, role) {
  const s = sessionOf(entry, role);
  const ip = role === "submitter"
    ? `172.28.10.${SOURCE_BASE + entry.idx}`
    : `172.28.10.${BG_SOURCE_BASE + entry.idx}`;
  agentFor(s, ip);
  // login
  {
    const r = baseRecord("prep", s, "login");
    const res = await fire(r, s, { method: "POST", path: "/api/auth/login", body: { username: s.username, password: PASSWORD } });
    let ok = res.status === 200;
    if (ok) {
      const tok = (res.headers["set-cookie"] ?? []).find((c) => /^auth-token=/.test(c));
      if (tok) {
        s.cookie = /auth-token=([^;]+)/.exec(tok)[1];
        try { ok = JSON.parse(res.body).role === "Candidate"; } catch { ok = false; }
      } else ok = false;
    }
    r.verified = ok;
    r.verifyKind = "login-200+cookie+role";
    emitSample(r);
    if (!ok) throw new Error(`prep login failed (${res.status})`);
  }
  // start
  {
    const r = baseRecord("prep", s, "start");
    const res = await fire(r, s, { method: "POST", path: `/api/attempts/${s.examId}/start`, body: undefined });
    let ok = res.status === 201;
    if (ok) {
      try {
        const b = JSON.parse(res.body);
        s.attemptId = b.id;
        ok = !s.candidateId || b.candidateId === s.candidateId;
      } catch { ok = false; }
    }
    r.verified = ok;
    r.verifyKind = "start-201+ownership";
    emitSample(r);
    if (!ok) throw new Error(`prep start failed (${res.status}) ${res.body.slice(0, 120)}`);
  }
  // take
  {
    const r = baseRecord("prep", s, "take");
    const res = await fire(r, s, { method: "GET", path: `/api/candidate/attempts/${s.attemptId}/take` });
    let ok = res.status === 200;
    if (ok) {
      try {
        const b = JSON.parse(res.body);
        s.questionId = b.questions?.[0]?.id ?? null;
        ok = !!s.questionId;
      } catch { ok = false; }
    }
    r.verified = ok;
    r.verifyKind = "take-200+questionId";
    emitSample(r);
    if (!ok) throw new Error(`prep take failed (${res.status})`);
  }
  // save:1 / save:2（改答量=1，与 G1 轨迹一致：true→false）
  for (const [seq, answer] of [[1, true], [2, false]]) {
    const r = baseRecord("prep", s, `save:${seq}`);
    r.clientSeq = seq;
    const res = await fire(r, s, {
      method: "POST",
      path: `/api/attempts/${s.attemptId}/answers/${s.questionId}`,
      body: {
        attemptId: s.attemptId, questionId: s.questionId, answer,
        clientSeq: seq, clientSavedAt: iso(), baseVersion: seq === 1 ? 0 : s.serverVersion,
      },
    });
    let ok = false;
    try {
      const b = JSON.parse(res.body);
      if (typeof b.serverVersion === "number") s.serverVersion = b.serverVersion;
      ok = res.status === 200 && b.accepted === true;
      if (ok) s.lastAcceptedAnswer = answer;
    } catch { ok = false; }
    r.verified = ok;
    r.serverVersion = s.serverVersion;
    r.verifyKind = "save-accepted+serverVersion";
    emitSample(r);
    if (!ok) throw new Error(`prep save:${seq} failed (${res.status})`);
  }
  s.clientSeq = 2;
  s.prepOk = true;
}
async function prepProctor(entry, role) {
  const s = sessionOf(entry, role);
  s.examId = entry.pollExamId; // 监考轮询目标考试（s1-run.sh 从 manifest 解析）
  agentFor(s, `172.28.10.${PROCTOR_SOURCE_BASE + (role === "proctorA" ? 0 : 1)}`);
  const r = baseRecord("prep", s, "login");
  const res = await fire(r, s, { method: "POST", path: "/api/auth/login", body: { username: s.username, password: PROCTOR_PASSWORD } });
  let ok = res.status === 200;
  if (ok) {
    const tok = (res.headers["set-cookie"] ?? []).find((c) => /^auth-token=/.test(c));
    if (tok) {
      s.cookie = /auth-token=([^;]+)/.exec(tok)[1];
      try { ok = JSON.parse(res.body).role === "Proctor"; } catch { ok = false; }
    } else ok = false;
  }
  r.verified = ok;
  r.verifyKind = "login-200+cookie+role-proctor";
  emitSample(r);
  if (!ok) throw new Error(`proctor login failed (${res.status})`);
  s.prepOk = true;
}

// ── STEADY 语义（overlay；开放式定时） ─────────────────────────────────────
function scheduleBgSave(s, delayMs) {
  const plannedEpoch = Date.now() + Math.max(0, delayMs);
  setTimeout(async () => {
    const r = baseRecord("steady", s, "save");
    const seq = ++s.clientSeq;
    const answer = seq % 2 === 1; // true/false 交替改答
    r.clientSeq = seq;
    r.plannedEpoch = plannedEpoch;
    const res = await fire(r, s, {
      method: "POST",
      path: `/api/attempts/${s.attemptId}/answers/${s.questionId}`,
      body: {
        attemptId: s.attemptId, questionId: s.questionId, answer,
        clientSeq: seq, clientSavedAt: iso(), baseVersion: s.serverVersion,
      },
    });
    let ok = false;
    try {
      const b = JSON.parse(res.body);
      if (typeof b.serverVersion === "number") s.serverVersion = b.serverVersion;
      ok = res.status === 200 && b.accepted === true;
      if (ok) s.lastAcceptedAnswer = answer;
      if (!ok) r.detail = `save-rejected:${b.reason ?? res.status}`;
    } catch { ok = false; r.detail = "save-unparseable"; }
    r.verified = ok;
    r.serverVersion = s.serverVersion;
    r.verifyKind = "save-accepted+serverVersion";
    emitSample(r);
    if (steadyRunning) scheduleBgSave(s, 5000 + Math.floor((rng() * 2 - 1) * 2000));
  }, Math.max(0, delayMs)).unref?.();
}
function scheduleBgHeartbeat(s, delayMs) {
  const plannedEpoch = Date.now() + Math.max(0, delayMs);
  setTimeout(async () => {
    const r = baseRecord("steady", s, "heartbeat");
    r.plannedEpoch = plannedEpoch;
    const res = await fire(r, s, { method: "POST", path: `/api/attempts/${s.attemptId}/heartbeat`, body: undefined });
    r.verified = res.status === 200;
    r.verifyKind = "heartbeat-200";
    emitSample(r);
    if (steadyRunning) scheduleBgHeartbeat(s, 15000 + Math.floor((rng() * 2 - 1) * 5000));
  }, Math.max(0, delayMs)).unref?.();
}
function scheduleProctorPoll(s, delayMs) {
  const plannedEpoch = Date.now() + Math.max(0, delayMs);
  setTimeout(async () => {
    const r = baseRecord("steady", s, "proctor-read");
    r.plannedEpoch = plannedEpoch;
    const res = await fire(r, s, { method: "GET", path: `/api/admin/exams/${s.examId}/proctor/attempts` });
    r.verified = res.status === 200;
    r.verifyKind = "proctor-read-200";
    emitSample(r);
    if (steadyRunning) scheduleProctorPoll(s, 3000);
  }, Math.max(0, delayMs)).unref?.();
}
let steadyRunning = false;

// ── BURST 语义 ──────────────────────────────────────────────────────────────
const submitSamples = [];
let submitSent = 0;
function scheduleSubmit(s, offsetMs) {
  const plannedEpoch = T0_EPOCH + offsetMs;
  // T0 的 perf 时标 = prepDonePerf + T0_REL（两者均在 now() 相对域：
  // now()=performance.now()-t0Perf，勿与绝对 performance.now() 混算——实测混算
  // 会把发射整体提前 t0Perf（进程启动 ~39ms），pilot B lag=-39ms 即此）
  const delay = Math.max(0, (prepDonePerf + T0_REL + offsetMs) - now());
  setTimeout(async () => {
    const r = baseRecord("burst", s, "submit");
    r.plannedEpoch = plannedEpoch;
    const emitAt = now();
    r.sentEpoch = Date.now();
    r.lagMs = Math.round(emitAt - (prepDonePerf + T0_REL + offsetMs));
    submitSent += 1;
    const res = await doRequest({
      agent: s.agent, method: "POST",
      path: `/api/attempts/${s.attemptId}/submit`, body: undefined,
      headers: { cookie: `auth-token=${s.cookie}` },
    });
    r.status = res.status;
    r.latencyMs = Math.round(res.latencyMs);
    r.errorClass = res.errorClass;
    r.responseEpoch = Date.now();
    let ok = false;
    try {
      const b = JSON.parse(res.body);
      ok = res.status === 200 && (b.status === "submitted" || b.status === "graded");
      if (ok) r.detail = `terminal:${b.status}`;
    } catch { ok = false; }
    r.verified = ok;
    r.verifyKind = "submit-terminal-status";
    submitSamples.push(r);
    emitSample(r);
  }, delay);
}

// ── 自监控（T6） ────────────────────────────────────────────────────────────
const elDelay = monitorEventLoopDelay({ resolution: 10 });
elDelay.enable();
const metricsBuf = [];
let lastUsage = process.cpuUsage();
let lastSampleAt = now();
function sampleMetrics() {
  const curUsage = process.cpuUsage();
  const dt = Math.max(50, now() - lastSampleAt);
  const usagePct = ((curUsage.user - lastUsage.user + curUsage.system - lastUsage.system) / 1000 / dt) * 100;
  metricsBuf.push(JSON.stringify({
    tMs: Math.round(now()),
    cpuUsagePct: Math.round(usagePct * 10) / 10,
    elDelayMeanMs: Math.round((elDelay.mean / 1e6) * 100) / 100,
    elDelayP99Ms: Math.round((elDelay.percentile(99) / 1e6) * 100) / 100,
    elDelayMaxMs: Math.round((elDelay.max / 1e6) * 100) / 100,
    rssMb: Math.round(process.memoryUsage().rss / 1048576),
  }));
  elDelay.reset();
  appendFileSync(join(OUT_DIR, "driver-metrics.jsonl"), metricsBuf.splice(0).join("\n") + "\n");
  lastUsage = curUsage;
  lastSampleAt = now();
}

// ── 主流程 ──────────────────────────────────────────────────────────────────
mkdirSync(OUT_DIR, { recursive: true });
console.log(`[s1] ${RUN_ID}: arm=${ARM} mode=${MODE} n=${N} bg=${MODE === "overlay" ? BG_N : 0} → ${OUT_DIR}`);

// JIT/agent 预热（一次 branding GET + 一次 POST 401，无副作用）
{
  const warmAgent = new http.Agent({ keepAlive: false });
  await doRequest({ agent: warmAgent, method: "GET", path: "/api/settings/branding" }).catch(() => null);
  await doRequest({ agent: warmAgent, method: "POST", path: "/api/client-events", body: { events: [] } }).catch(() => null);
  warmAgent.destroy();
}

// PREP（闭式有界并发；任一 submitter 失败 → FAILED）
const prepStart = Date.now();
const prepTargets = [
  ...submitters.map((e) => ({ entry: e, role: "submitter" })),
  ...(MODE === "overlay" ? background.map((e) => ({ entry: e, role: "bg" })) : []),
];
const prepFailures = [];
{
  let cursor = 0;
  async function worker() {
    while (cursor < prepTargets.length) {
      const t = prepTargets[cursor++];
      try {
        await prepCandidate(t.entry, t.role);
      } catch (err) {
        prepFailures.push({ actor: t.entry.username, error: String(err.message ?? err).slice(0, 200) });
      }
    }
  }
  await Promise.all(Array.from({ length: PREP_CONCURRENCY }, () => worker()));
  if (MODE === "overlay") {
    try { await prepProctor(candFile.proctorA, "proctorA"); }
    catch (err) { prepFailures.push({ actor: "proctorA", error: String(err.message ?? err).slice(0, 200) }); }
    try { await prepProctor(candFile.proctorB, "proctorB"); }
    catch (err) { prepFailures.push({ actor: "proctorB", error: String(err.message ?? err).slice(0, 200) }); }
  }
}
const prepDoneAt = Date.now();
const prepDonePerf = now();
const prepOkCount = [...sessions.values()].filter((s) => s.prepOk).length;
console.log(`[s1] prep done in ${prepDoneAt - prepStart}ms: ok=${prepOkCount}/${prepTargets.length + (MODE === "overlay" ? 2 : 0)} failures=${prepFailures.length}`);

const submitterPrepFailures = prepFailures.filter((f) => !f.actor.startsWith("proctor"));
if (submitterPrepFailures.length > 0 || (MODE === "overlay" && prepFailures.length > 0)) {
  // 等量 attempts 不成立（submitter 或 overlay 必需角色准备失败）→ FAILED（R2）
  flushSamples();
  writeFailure(prepFailures);
  process.exit(3);
}

function writeFailure(failures) {
  writeFileSync(join(OUT_DIR, "driver.json"), JSON.stringify({
    runId: RUN_ID, arm: ARM, mode: MODE, failed: true,
    failure: "prep-incomplete", prepFailures: failures,
    offered: 0, note: "PREP failed — burst never fired (R2: run invalid, keep artifacts)",
  }, null, 2) + "\n");
}

// STEADY（overlay）：bg 节拍 + 监考轮询，先跑 steadyLead 建立基线窗口
if (MODE === "overlay") {
  steadyRunning = true;
  for (const entry of background) {
    const s = sessions.get(entry.username);
    scheduleBgSave(s, 1000 + Math.floor(rng() * 5000));
    scheduleBgHeartbeat(s, 2000 + Math.floor(rng() * 15000));
  }
  scheduleProctorPoll(sessions.get(candFile.proctorA.username), 1500);
  scheduleProctorPoll(sessions.get(candFile.proctorB.username), 3000);
}

// T0：overlay=prepDone+steadyLead（先有 ≥60s 纯背景基线窗）；pure=prepDone+quiet
const T0_REL = MODE === "overlay" ? STEADY_LEAD_MS : QUIET_MS; // 相对 prepDone 的 ms
const T0_EPOCH = prepDoneAt + T0_REL;
console.log(`[s1] T0 in ${T0_REL}ms (epoch ${new Date(T0_EPOCH).toISOString()})`);

// HB 波：submitter 各一次，[T0-25s, T0-8s] 均匀（保持 lastActivityAt 新鲜 + 连接温热）。
// 与 BURST 定时器并行登记（不 await——hb 拖慢不推迟 T0，到达表保真优先）。
{
  const sArr = submitters.map((e) => sessions.get(e.username));
  sArr.forEach((s, i) => {
    const at = T0_REL - 25000 + Math.floor((i / Math.max(1, sArr.length - 1)) * 17000);
    const delay = Math.max(0, (prepDonePerf + at) - now());
    setTimeout(async () => {
      const r = baseRecord("hbwave", s, "heartbeat");
      r.plannedEpoch = T0_EPOCH - 25000 + Math.floor((i / Math.max(1, sArr.length - 1)) * 17000); // T0-25s..T0-8s
      const res = await fire(r, s, { method: "POST", path: `/api/attempts/${s.attemptId}/heartbeat`, body: undefined });
      r.verified = res.status === 200;
      r.verifyKind = "pre-burst-freshness-heartbeat";
      emitSample(r);
    }, delay).unref?.();
  });
}

// BURST
const metricsTimer = setInterval(sampleMetrics, 500);
const burstScheduledAt = Date.now();
for (const e of submitters) {
  const s = sessions.get(e.username);
  const off = arrivalOf.get(e.idx);
  if (off === undefined) { console.error(`[s1] FATAL: arrival missing idx=${e.idx}`); process.exit(2); }
  scheduleSubmit(s, off);
}

// 完成：全部 submit 样本齐 → 记 lastConfirm；steady 续跑到 lastConfirm+15s
const HARD_DEADLINE_REL = T0_REL + 240000;
let lastConfirmEpoch = null;
await new Promise((resolve) => {
  const check = setInterval(() => {
    const allDone = submitSamples.length >= N;
    if (allDone && lastConfirmEpoch === null) {
      lastConfirmEpoch = Math.max(...submitSamples.map((x) => x.responseEpoch ?? 0));
    }
    const steadyDone = lastConfirmEpoch !== null && Date.now() >= lastConfirmEpoch + POST_BURST_MS;
    if ((allDone && steadyDone) || Date.now() - prepDoneAt > HARD_DEADLINE_REL) {
      clearInterval(check);
      resolve();
    }
  }, 200);
});
if (lastConfirmEpoch === null) {
  lastConfirmEpoch = submitSamples.length ? Math.max(...submitSamples.map((x) => x.responseEpoch ?? 0)) : Date.now();
}
await new Promise((r) => setTimeout(r, 2000)); // 在途 bg op 排空
steadyRunning = false;
clearInterval(metricsTimer);
flushSamples();
sampleMetrics();
elDelay.disable();
for (const s of sessions.values()) s.agent?.destroy();

// 兜底清点 + 汇总
function pct(arr, p) {
  if (arr.length === 0) return null;
  const s2 = [...arr].sort((a, b) => a - b);
  return s2[Math.min(s2.length - 1, Math.floor((p / 100) * s2.length))];
}
const submitOk = submitSamples.filter((x) => x.verified === true);
const submitLat = submitOk.map((x) => x.latencyMs);
const lagAll = submitSamples.filter((x) => x.lagMs !== null).map((x) => x.lagMs);
const statusTally = {};
for (const x of submitSamples) statusTally[String(x.status ?? "none")] = (statusTally[String(x.status ?? "none")] ?? 0) + 1;
const seen = new Set(submitSamples.map((x) => x.actor));

const metricsLines = readFileSync(join(OUT_DIR, "driver-metrics.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const driverJson = {
  runId: RUN_ID, arm: ARM, mode: MODE, failed: false,
  offered: N, sent: submitSent,
  gotResponse: submitSamples.filter((x) => x.status !== null).length,
  verified: submitOk.length,
  dropped: N - submitSamples.length, // 计划到达但 driver 未完成 → T6 丢样
  statusTally,
  submit: {
    n: submitSamples.length, ok: submitOk.length,
    p50Ms: pct(submitLat, 50), p95Ms: pct(submitLat, 95), p99Ms: pct(submitLat, 99),
    maxMs: submitLat.length ? Math.max(...submitLat) : null,
    sortedLatencyMs: [...submitLat].sort((a, b) => a - b),
    firstSentEpoch: submitSamples.length ? Math.min(...submitSamples.map((x) => x.sentEpoch)) : null,
    lastResponseEpoch: submitSamples.length ? Math.max(...submitSamples.map((x) => x.responseEpoch ?? 0)) : null,
    lastConfirmEpoch,
    errors: submitSamples.filter((x) => x.verified !== true).map((x) => ({ actor: x.actor, status: x.status, errorClass: x.errorClass, detail: x.detail })),
    missing: submitters.filter((e) => !seen.has(e.username)).map((e) => e.username),
  },
  sendLag: {
    n: lagAll.length,
    p50Ms: pct(lagAll, 50), p95Ms: pct(lagAll, 95), p99Ms: pct(lagAll, 99),
    maxMs: lagAll.length ? Math.max(...lagAll) : null,
    over50ms: lagAll.filter((v) => v > 50).length,
    emitWidthMs: submitSamples.length ? Math.max(...submitSamples.map((x) => x.sentEpoch)) - Math.min(...submitSamples.map((x) => x.sentEpoch)) : null,
  },
  prep: {
    startedAtEpoch: prepStart, doneAtEpoch: prepDoneAt, ok: prepOkCount,
    failures: prepFailures,
    concurrency: PREP_CONCURRENCY,
  },
  timeline: {
    t0Epoch: T0_EPOCH, burstScheduledAtEpoch: burstScheduledAt,
    steadyLeadMs: MODE === "overlay" ? STEADY_LEAD_MS : null,
    quietMs: MODE === "pure" ? QUIET_MS : null,
    postBurstMs: POST_BURST_MS,
  },
  driverCpu: {
    samples: metricsLines.length,
    cpuUsagePctMax1Core: metricsLines.length ? Math.max(...metricsLines.map((m) => m.cpuUsagePct ?? 0)) : null,
    cpuUsagePctAvg1Core: metricsLines.length ? Math.round((metricsLines.reduce((a, m) => a + (m.cpuUsagePct ?? 0), 0) / metricsLines.length) * 10) / 10 : null,
    elDelayP99MaxMs: metricsLines.length ? Math.max(...metricsLines.map((m) => m.elDelayP99Ms ?? 0)) : null,
    rssMbMax: metricsLines.length ? Math.max(...metricsLines.map((m) => m.rssMb ?? 0)) : null,
  },
  expectedLastAcceptedAnswers: Object.fromEntries(
    [...sessions.values()]
      .filter((s) => s.lastAcceptedAnswer !== null)
      .map((s) => [s.username, { attemptId: s.attemptId, questionId: s.questionId, answer: s.lastAcceptedAnswer }]),
  ),
};
writeFileSync(join(OUT_DIR, "driver.json"), JSON.stringify(driverJson, null, 2) + "\n");
writeFileSync(join(OUT_DIR, "schedule.jsonl"),
  arrival.map((a) => JSON.stringify({ idx: a.idx, offsetMs: a.offsetMs, username: submitters[a.idx]?.username ?? null })).join("\n") + "\n");
writeFileSync(join(OUT_DIR, "run-meta.json"), JSON.stringify({
  runId: RUN_ID, arm: ARM, mode: MODE, n: N, bgN: MODE === "overlay" ? BG_N : 0,
  seed: SEED, origin: ORIGIN, nginxAddr: NGINX_ADDR,
  prepConcurrency: PREP_CONCURRENCY,
  sourceIpPlan: `submitters 172.28.10.${SOURCE_BASE}+k (k<${N}); bg 172.28.10.${BG_SOURCE_BASE}+j (j<${BG_N}); proctors .${PROCTOR_SOURCE_BASE}/.${PROCTOR_SOURCE_BASE + 1}`,
  arrivalFile: ARRIVAL_FILE, candidatesFile: CANDIDATES_FILE,
  startedAtEpoch: Date.now() - Math.round(now()),
  finishedAt: new Date().toISOString(),
  driverNode: process.version,
  passwordHandling: "credentials via env only; never written to outputs",
  outHostDir: OUT_HOST_DIR || "(archived by s1-run.sh via docker cp)",
}, null, 2) + "\n");
console.log(`[s1] done: submits ok=${submitOk.length}/${N} dropped=${driverJson.dropped} p99=${driverJson.submit.p99Ms}ms lagP99=${driverJson.sendLag.p99Ms}ms cpuMax=${driverJson.driverCpu.cpuUsagePctMax1Core}%(1core)`);
process.exit(0);
