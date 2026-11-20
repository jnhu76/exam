/**
 * G1-FIDELITY ①（总纲 G1.1）— 真实浏览器轨迹采集（RESEARCH ONLY）。
 *
 * 用仓库 Playwright（@exam/e2e 的 chromium）经实际 Nginx 入口
 * http://127.0.0.1:8080 跑两条考生轨迹并全量记录 HTTP 线缆行为：
 *
 *   轨迹 A（happy path）：
 *     密码登录 → 等候（列表驻留）→ 开考 → 作答 → 改答 →（每次）保存确认
 *     → 交卷 → 查看结果
 *   轨迹 B（refresh/recovery）：
 *     登录 → 开考 → 作答 → 保存确认 → 刷新（重连）→ 恢复 → 提交 → 结果
 *
 * 仅使用 fixture 已播种的 timed_window 考试（exam-cdp-watt-runtime-capacity
 * seed；协议 §0.3：timed_sync 未激活，本脚本不触碰任何未启用模式）。
 *
 * 脱敏契约（协议 §13）：不归档密码明文、cookie/token 值、完整密码哈希；
 * 请求/响应头中的凭据类头只保留名字 + "<redacted>"；登录 body 的
 * password 字段掩码。auth-token 仅在内存中解码 JWT payload 记录 claims
 * （actorId/role/organizationId/authEpoch/iat/exp），token 本体绝不落盘。
 *
 * 运行（协议 §13 cmd.sh 契约，cwd 无关）：
 *   pnpm -C /home/hoo/Source/exam/.wt-capacity --filter @exam/db exec tsx \
 *     /home/hoo/Source/exam/.wt-capacity/docs/research/exam-cdp-watt-runtime-capacity/harness/g1-fidelity-trace.ts
 *
 * 前置：topology.sh up（nginx :8080 + API :3300 + 研究库 exam_550_e2e 已播种）。
 * 产物：evidence/g1-traces/trace-{a,b}-*.json + replay-spec.json + screenshots/。
 */
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
/** docs/research/exam-cdp-watt-runtime-capacity */
const RESEARCH_DIR = join(__dirname, "..");
const EVIDENCE_DIR = join(RESEARCH_DIR, "evidence");
const OUT_DIR = join(EVIDENCE_DIR, "g1-traces");
const SHOT_DIR = join(OUT_DIR, "screenshots");

// 从 @exam/e2e 的依赖闭包解析仓库 Playwright（pnpm 严格 node_modules）。
const req = createRequire(join(RESEARCH_DIR, "..", "..", "..", "apps", "e2e", "package.json"));
const { chromium } = req("@playwright/test") as typeof import("@playwright/test");
const { CANDIDATE_PASSWORD: PASSWORD } = await import("./lib/config.js");

const ORIGIN = "http://127.0.0.1:8080"; // 实际 Nginx 入口（唯一公共入口）
const RUN_ID = `G1-FIDELITY-browser-r1-${new Date().toISOString().replace(/[:.]/g, "").slice(0, 15)}`;

const manifest = JSON.parse(
  readFileSync(join(EVIDENCE_DIR, "fixtures", "seed-manifest.json"), "utf8"),
) as {
  sameField: { examId: string; candidates: string[] };
};
const EXAM_ID = manifest.sameField.examId;
const USER_A = manifest.sameField.candidates[0]!; // 轨迹 A（maxAttempts=1 → 每轨迹独立考生）
const USER_B = manifest.sameField.candidates[1]!; // 轨迹 B

// ── 脱敏 ─────────────────────────────────────────────────────────────────────
const REDACT_HEADERS = new Set([
  "cookie",
  "set-cookie",
  "authorization",
  "proxy-authorization",
]);
function sanitizeHeaders(h: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(h)) {
    out[k] = REDACT_HEADERS.has(k.toLowerCase()) ? "<redacted>" : v;
  }
  return out;
}
function sanitizeBody(s: string): string {
  return s
    .replace(/"password"\s*:\s*"[^"]*"/g, '"password":"<redacted>"')
    .replace(/auth-token=[^;\s"']+/g, "auth-token=<redacted>");
}
const BODY_CAPTURE_LIMIT = 4000;

// ── 轨迹记录器 ───────────────────────────────────────────────────────────────
interface ReqRecord {
  seq: number;
  phase: string;
  tsRequest: number; // Date.now() at request event
  method: string;
  url: string;
  resourceType: string;
  headers: Record<string, string>;
  postData?: string;
  status?: number;
  tsResponse?: number;
  tsFinished?: number;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
  failure?: string;
  timing?: {
    startTime: number;
    requestStart: number;
    responseStart: number;
    responseEnd: number;
  };
}
interface TraceFile {
  runId: string;
  trajectory: string;
  description: string;
  origin: string;
  startedAt: string;
  candidate: { username: string; source: string; password: "CANDIDATE_PASSWORD (redacted)" };
  examId: string;
  phases: { phase: string; tStart: number; tEnd?: number; note: string }[];
  uiEvents: { t: number; phase: string; event: string; detail?: string }[];
  requests: ReqRecord[];
  sessionClaims?: Record<string, unknown>;
  assertions: { name: string; pass: boolean; detail: string }[];
  consoleErrors: string[];
}

function makeRecorder(id: string) {
  const startedAt = new Date();
  const trace: TraceFile = {
    runId: RUN_ID,
    trajectory: id,
    description: "",
    origin: ORIGIN,
    startedAt: startedAt.toISOString(),
    candidate: { username: "", source: "seed-manifest.json sameField", password: "CANDIDATE_PASSWORD (redacted)" },
    examId: EXAM_ID,
    phases: [],
    uiEvents: [],
    requests: [],
    assertions: [],
    consoleErrors: [],
  };
  let phase = "init";
  let seq = 0;
  const t0 = Date.now();
  const byReq = new Map<object, ReqRecord>();

  function setPhase(p: string, note = "") {
    const now = Date.now();
    const open = trace.phases.find((x) => x.tEnd === undefined);
    if (open) open.tEnd = now;
    trace.phases.push({ phase: p, tStart: now, note });
    phase = p;
  }
  function ui(event: string, detail?: string) {
    trace.uiEvents.push({ t: Date.now() - t0, phase, event, detail });
  }
  function assert(name: string, pass: boolean, detail: string) {
    trace.assertions.push({ name, pass, detail });
  }

  function attach(page: import("@playwright/test").Page) {
    page.on("console", (m) => {
      if (m.type() === "error") trace.consoleErrors.push(`[${phase}] ${m.text().slice(0, 300)}`);
    });
    page.on("request", (r) => {
      const rec: ReqRecord = {
        seq: ++seq,
        phase,
        tsRequest: Date.now(),
        method: r.method(),
        url: r.url(),
        resourceType: r.resourceType(),
        headers: {},
      };
      byReq.set(r, rec);
      trace.requests.push(rec);
      const pd = r.postData();
      if (pd) rec.postData = sanitizeBody(pd).slice(0, BODY_CAPTURE_LIMIT);
      void r
        .allHeaders()
        .then((h) => {
          rec.headers = sanitizeHeaders(h);
        })
        .catch(() => {});
    });
    page.on("response", (res) => {
      const rec = byReq.get(res.request());
      if (rec) {
        rec.status = res.status();
        rec.tsResponse = Date.now();
        void res
          .allHeaders()
          .then((h) => {
            rec.responseHeaders = sanitizeHeaders(h);
          })
          .catch(() => {});
        if (rec.url.includes("/api/")) {
          void res
            .text()
            .then((b) => {
              rec.responseBody = sanitizeBody(b).slice(0, BODY_CAPTURE_LIMIT);
            })
            .catch(() => {});
        }
      }
    });
    page.on("requestfinished", (r) => {
      const rec = byReq.get(r);
      if (!rec) return;
      rec.tsFinished = Date.now();
      const t = r.timing();
      if (t && t.startTime > 0) {
        // Playwright 1.61 实测：startTime=epoch-毫秒(float)；requestStart/
        // responseStart/responseEnd=相对 startTime 的毫秒（与文档的"秒"不符，
        // 见 g1-fix-trace-timing.ts 的推导）。防御性归一：>1e12 视作 epoch-ms。
        const startMs = t.startTime > 1e12 ? t.startTime : t.startTime * 1000;
        const rel = (v: number) => (v > startMs * 0.5 ? v - startMs : v);
        rec.timing = {
          startTime: Math.round(startMs),
          requestStart: Math.round(rel(t.requestStart)),
          responseStart: Math.round(rel(t.responseStart)),
          responseEnd: Math.round(rel(t.responseEnd)),
        };
        rec.tsRequest = Math.round(startMs);
      }
    });
    page.on("requestfailed", (r) => {
      const rec = byReq.get(r);
      if (rec) rec.failure = r.failure()?.errorText ?? "failed";
    });
  }

  async function sessionClaims(
    ctx: import("@playwright/test").BrowserContext,
  ): Promise<Record<string, unknown> | undefined> {
    const cookies = await ctx.cookies();
    const auth = cookies.find((c) => c.name === "auth-token");
    if (!auth) return undefined;
    // 仅解码 payload claims；token 本体（含签名）不落盘。
    const payload = auth.value.split(".")[1];
    if (!payload) return undefined;
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
  }

  return { trace, setPhase, ui, assert, attach, sessionClaims, t0 };
}

// ── 等待保存确认：wire（权威）+ UI chip ────────────────────────────────────
interface SaveObservation {
  clientSeq: number;
  baseVersion: number;
  serverVersion: number;
  accepted: boolean;
  url: string;
  tSentMs: number; // 相对轨迹开始的发送时刻
  latencyMs: number;
}
async function waitForAnswerSave(
  page: import("@playwright/test").Page,
  t0: number,
): Promise<SaveObservation> {
  const res = await page.waitForResponse(
    (r) => r.request().method() === "POST" && /\/api\/attempts\/[^/]+\/answers\//.test(r.url()),
    { timeout: 20_000 },
  );
  await res.finished();
  const body = (await res.json()) as { accepted: boolean; serverVersion: number };
  const payload = JSON.parse(res.request().postData() ?? "{}") as {
    clientSeq: number;
    baseVersion: number;
  };
  const rec = {
    clientSeq: payload.clientSeq,
    baseVersion: payload.baseVersion,
    serverVersion: body.serverVersion,
    accepted: body.accepted,
    url: res.url(),
    tSentMs: (() => {
      const t = res.request().timing();
      const startMs = t.startTime > 1e12 ? t.startTime : t.startTime * 1000;
      return Math.round(startMs - t0);
    })(),
    latencyMs: (() => {
      const t = res.request().timing();
      const startMs = t.startTime > 1e12 ? t.startTime : t.startTime * 1000;
      const rel = (v: number) => (v > startMs * 0.5 ? v - startMs : v);
      return Math.round(rel(t.responseStart) - rel(t.requestStart));
    })(),
  };
  return rec;
}
async function readSaveChip(
  page: import("@playwright/test").Page,
): Promise<string> {
  return (await page.getByRole("status").first().textContent()) ?? "";
}

// ── 轨迹公共段：UI 登录 → 列表 ─────────────────────────────────────────────
async function uiLogin(
  page: import("@playwright/test").Page,
  username: string,
): Promise<void> {
  await page.context().clearCookies();
  await page.goto(`${ORIGIN}/login`);
  await page
    .getByTestId("login-layout")
    .waitFor({ state: "visible", timeout: 15_000 });
  await page.getByLabel(/用户名/).fill(username);
  await page.getByLabel(/密码/).fill(PASSWORD);
  await page.getByRole("button", { name: /^登录$/ }).click();
  await page.waitForURL(/\/exam\/list(?:$|[/?#])/, { timeout: 15_000 });
}

async function uiStartExam(page: import("@playwright/test").Page): Promise<void> {
  const card = page.getByTestId(`exam-card-${EXAM_ID}`);
  await card.waitFor({ state: "visible", timeout: 15_000 });
  const action = card.getByTestId("exam-primary-action");
  await action.waitFor({ state: "visible" });
  if ((await action.getAttribute("data-action")) !== "start") {
    throw new Error(`primary action != start: ${await action.getAttribute("data-action")}`);
  }
  await action.click();
  await page.waitForURL((u) => /\/exam\/[^/]+\/start$/.test(u.pathname), { timeout: 15_000 });
  await page.getByTestId("exam-start-btn").click();
  await page.waitForURL((u) => /\/exam\/[^/]+\/take$/.test(u.pathname), { timeout: 15_000 });
  await page.getByTestId("take-question-section").waitFor({ state: "visible", timeout: 15_000 });
}

async function uiSubmit(page: import("@playwright/test").Page): Promise<void> {
  await page.getByTestId("take-submit-btn").click();
  await page.getByRole("dialog").waitFor({ state: "visible" });
  await page.getByTestId("confirm-submit-btn").click();
  await page.waitForURL("**/result", { timeout: 30_000 });
}

// ── 主流程 ─────────────────────────────────────────────────────────────────
async function main() {
  mkdirSync(SHOT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });

  // ══ 轨迹 A ══════════════════════════════════════════════════════════════
  {
    const rec = makeRecorder("A");
    rec.trace.description =
      "密码登录 → 等候（列表驻留 8s）→ 开考 → 作答 true → 保存确认 → 改答 false → 保存确认 → 心跳窗口 32s → 交卷 → 查看结果";
    rec.trace.candidate.username = USER_A;
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    rec.attach(page);

    rec.setPhase("login", "UI 密码登录（POST /api/auth/login）");
    await uiLogin(page, USER_A);
    rec.ui("登录成功，落地 /exam/list");
    rec.assert("A-login-lands-on-list", /\/exam\/list/.test(new URL(page.url()).pathname), page.url());

    rec.setPhase("wait", "等候：列表页驻留（入场窗口内自然驻留，无脚本驱动请求）");
    await page.screenshot({ path: join(SHOT_DIR, "a-1-exam-list.png") });
    await page.waitForTimeout(8_000);
    rec.ui("等候结束（8s）");

    rec.setPhase("start", "开考：列表卡片 start → /exam/:id/start → exam-start-btn → /take");
    await uiStartExam(page);
    rec.ui("开考完成，take 页挂载");
    await page.screenshot({ path: join(SHOT_DIR, "a-2-take.png") });
    const attemptUrl = page.url();
    const attemptIdA = /\/exam\/([^/]+)\/take/.exec(new URL(attemptUrl).pathname)?.[1];
    // take URL 的 path 段是 examId 还是 attemptId？以 GET 恢复请求为准，向后断言。
    rec.assert("A-take-mounted", true, `take url=${attemptUrl}`);

    rec.setPhase("answer1", "作答 true → 1500ms debounce → POST answers");
    const save1 = waitForAnswerSave(page, rec.t0);
    await page.getByTestId("true-false-true").check();
    const s1 = await save1;
    const chip1 = await readSaveChip(page);
    rec.ui("第一次保存确认", JSON.stringify(s1));
    rec.assert("A-save1-accepted", s1.accepted && s1.serverVersion === 1, JSON.stringify(s1));
    rec.assert("A-save1-chip-saved", chip1.includes("已保存"), `chip=${chip1}`);

    rec.setPhase("revise", "改答 false → 保存确认（clientSeq=2, baseVersion=1）");
    const save2 = waitForAnswerSave(page, rec.t0);
    await page.getByTestId("true-false-false").check();
    const s2 = await save2;
    const chip2 = await readSaveChip(page);
    rec.ui("改答保存确认", JSON.stringify(s2));
    rec.assert(
      "A-save2-accepted",
      s2.accepted && s2.serverVersion === 2 && s2.clientSeq === 2 && s2.baseVersion === 1,
      JSON.stringify(s2),
    );
    rec.assert("A-save2-chip-saved", chip2.includes("已保存"), `chip=${chip2}`);

    rec.setPhase("heartbeat-window", "驻留 32s 捕获 30s 心跳节拍");
    await page.waitForTimeout(32_000);
    rec.ui("心跳窗口结束");

    rec.setPhase("submit", "交卷：确认对话框 → POST submit → /result");
    await uiSubmit(page);
    rec.ui("交卷完成，落地 /result");
    const scoreA = (await page.getByTestId("result-total-score").textContent()) ?? "";
    const passText = (await page.getByText(/已通过|未通过/).first().textContent()) ?? "";
    rec.assert("A-result-visible", true, `score=${scoreA} pass=${passText}`);
    await page.screenshot({ path: join(SHOT_DIR, "a-3-result.png") });
    await page.waitForTimeout(3_000); // 捕获结果页自然请求

    rec.trace.sessionClaims = await rec.sessionClaims(ctx);
    rec.setPhase("done");
    writeFileSync(join(OUT_DIR, "trace-a-happy-path.json"), JSON.stringify(rec.trace, null, 2));
    console.log(`[A] attempt url segment: ${attemptIdA}`);
    console.log(
      `[A] saves: v1=${s1.serverVersion} v2=${s2.serverVersion} score=${scoreA} pass=${passText}`,
    );
    await ctx.close();
  }

  // ══ 轨迹 B ══════════════════════════════════════════════════════════════
  {
    const rec = makeRecorder("B");
    rec.trace.description =
      "密码登录 → 开考 → 作答 true → 保存确认 → 刷新（重连/恢复）→ 恢复校验 → 提交 → 结果";
    rec.trace.candidate.username = USER_B;
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    rec.attach(page);

    rec.setPhase("login", "UI 密码登录");
    await uiLogin(page, USER_B);
    rec.ui("登录成功，落地 /exam/list");

    rec.setPhase("start", "开考 → /take");
    await uiStartExam(page);
    rec.ui("开考完成，take 页挂载");

    rec.setPhase("answer1", "作答 true → 保存确认");
    const save1 = waitForAnswerSave(page, rec.t0);
    await page.getByTestId("true-false-true").check();
    const s1 = await save1;
    const chip1 = await readSaveChip(page);
    rec.ui("保存确认", JSON.stringify(s1));
    rec.assert("B-save1-accepted", s1.accepted && s1.serverVersion === 1, JSON.stringify(s1));
    rec.assert("B-save1-chip-saved", chip1.includes("已保存"), `chip=${chip1}`);

    rec.setPhase("refresh", "刷新（模拟断线重连）：page.reload() → 服务端恢复");
    await page.reload();
    await page.getByTestId("take-question-section").waitFor({ state: "visible", timeout: 15_000 });
    const restoredChecked = await page.getByTestId("true-false-true").isChecked();
    rec.ui("刷新后恢复完成", `true-false-true checked=${restoredChecked}`);
    rec.assert("B-restore-radio-checked", restoredChecked, "恢复后已保存答案回显选中");
    await page.screenshot({ path: join(SHOT_DIR, "b-1-restore.png") });
    // 刷新后 clientSeqsRef 从持久化版本恢复；若改答会得 clientSeq≥2 —— 本轨迹不改答，
    // 只验证恢复 + 提交（G1.1 轨迹 B 的范围）。

    rec.setPhase("submit", "恢复后提交 → /result");
    await uiSubmit(page);
    rec.ui("提交完成，落地 /result");
    const scoreB = (await page.getByTestId("result-total-score").textContent()) ?? "";
    rec.assert("B-result-visible", true, `score=${scoreB}`);
    await page.screenshot({ path: join(SHOT_DIR, "b-2-result.png") });
    await page.waitForTimeout(3_000);

    rec.trace.sessionClaims = await rec.sessionClaims(ctx);
    rec.setPhase("done");
    writeFileSync(join(OUT_DIR, "trace-b-refresh-recovery.json"), JSON.stringify(rec.trace, null, 2));
    console.log(`[B] saves: v1=${s1.serverVersion} score=${scoreB}`);
    await ctx.close();
  }

  await browser.close();

  // ══ 回放规格（供回放驱动构建员复用）════════════════════════════════════
  const traceA = JSON.parse(readFileSync(join(OUT_DIR, "trace-a-happy-path.json"), "utf8"));
  const traceB = JSON.parse(readFileSync(join(OUT_DIR, "trace-b-refresh-recovery.json"), "utf8"));
  const apiReqs = (t: TraceFile) =>
    t.requests
      .filter((r) => r.url.includes("/api/"))
      .map((r) => ({
        seq: r.seq,
        phase: r.phase,
        tRelMs: r.tsRequest - (t.requests[0]!.tsRequest ?? r.tsRequest),
        method: r.method,
        path: new URL(r.url).pathname,
        status: r.status ?? null,
        serverMs: r.timing ? r.timing.responseStart - r.timing.requestStart : null,
      }));
  const replaySpec = {
    specVersion: 1,
    runId: RUN_ID,
    campaign: "exam-cdp-watt-runtime-capacity (#900/#1021) — G1.1",
    generatedFrom: ["trace-a-happy-path.json", "trace-b-refresh-recovery.json"],
    entry: { origin: ORIGIN, ingress: "real nginx (deploy/nginx/web.conf derivative)" },
    globalParams: {
      origin: { value: ORIGIN, note: "实际 Nginx 入口；回放必须经该入口而非直连 API" },
      username: {
        type: "string",
        examples: [USER_A, USER_B],
        source: "evidence/fixtures/seed-manifest.json sameField.candidates[k]（maxAttempts=1 → 每轨迹独立考生）",
      },
      password: {
        type: "secret",
        constant: "CANDIDATE_PASSWORD",
        source: "harness/lib/config.ts（合成考生共享密码；不归档明文）",
      },
      examId: { value: EXAM_ID, source: "seed-manifest.json sameField.examId" },
      authCookie: {
        name: "auth-token",
        source: "login 响应 Set-Cookie（HttpOnly; SameSite=Strict; Path=/; Max-Age=86400）",
        note: "后续所有 /api 请求以 Cookie: auth-token=<login> 携带；值不入库",
      },
      timingConstants: {
        saveDebounceMs: 1500,
        source: "apps/web/src/hooks/useSubmitFlush.ts:10 DEBOUNCE_MS=1500（最后一次作答变更后 1500ms 才发 POST）",
        heartbeatIntervalMs: 30000,
        heartbeatSource: "apps/web/src/pages/exam/TakeExamPage.tsx:1651（take 页挂载起每 30s）",
        deadlineCheckLocalMs: 1000,
      },
    },
    flows: {
      "A-happy-path": {
        description: traceA.description,
        observedApiCalls: apiReqs(traceA),
        steps: FLOW_A_STEPS,
      },
      "B-refresh-recovery": {
        description: traceB.description,
        observedApiCalls: apiReqs(traceB),
        steps: FLOW_B_STEPS,
      },
    },
    invariantsForReplayDriver: [
      "clientSeq 每题从 1 起单调递增；改答（同一题）必须 +1，且 baseVersion=上一接受的 serverVersion",
      "刷新/重连后客户端 clientSeq 计数从服务端持久化版本恢复（refresh-during-exam.spec.ts 回归锁：恢复后改答 clientSeq≥2）",
      "保存 POST 的 200 必要非充分：必须断言 body.accepted===true 且 serverVersion 递增（STALE_VERSION 等业务拒绝也是 200）",
      "交卷成功判据用 DB oracle（唯一终态 submitted/graded + submissionReason），不得凭一个 200 推断最后改答已保存",
      "登录来源限流 10 次/60s/IP（生产 limiter ON）：回放到达表必须按源 IP 预算",
      "heartbeat 与保存共享同一 auth-token cookie 与 attempt 作用域",
    ],
  };
  writeFileSync(join(OUT_DIR, "replay-spec.json"), JSON.stringify(replaySpec, null, 2));

  console.log(`[g1] traces written to ${OUT_DIR}`);
  console.log(`[g1] runId=${RUN_ID}`);
}

// 步骤模板：参数用 ${param} 占位；when 描述时序节拍；dependsOn 给依赖顺序。
const FLOW_A_STEPS = [
  {
    id: "A1-login",
    when: "用户点击登录（瞬时）",
    method: "POST",
    url: "${origin}/api/auth/login",
    headersRole: {
      "content-type": "application/json",
      origin: "${origin}",
      referer: "${origin}/login",
      cookie: "（无需；未认证）",
    },
    bodyTemplate: { username: "${username}", password: "${password}" },
    responseContract: {
      status: 200,
      extract: {
        authCookie: "set-cookie: auth-token=<jwt>（后续所有请求携带；不落盘）",
        userId: "body.id",
        role: "body.role（Candidate）",
      },
    },
    dependsOn: [],
  },
  {
    id: "A2-list",
    when: "登录跳转后页面加载（瞬时）",
    method: "GET",
    url: "${origin}/api/candidate/exams",
    headersRole: { accept: "application/json", cookie: "auth-token=${authCookie}", referer: "${origin}/exam/list" },
    bodyTemplate: null,
    responseContract: { status: 200, extract: { examId: "body[].id（card = exam-card-${examId}）" } },
    dependsOn: ["A1-login"],
  },
  {
    id: "A3-exam-detail",
    when: "点击列表卡片 start（瞬时）",
    method: "GET",
    url: "${origin}/api/candidate/exams/${examId}",
    headersRole: { accept: "application/json", cookie: "auth-token=${authCookie}", referer: "${origin}/exam/list" },
    bodyTemplate: null,
    responseContract: { status: 200, note: "start 页考试详情（enrollment/attempt 状态）" },
    dependsOn: ["A2-list"],
  },
  {
    id: "A4-start-attempt",
    when: "点击 exam-start-btn（瞬时）",
    method: "POST",
    url: "${origin}/api/attempts/${examId}/start",
    headersRole: { "content-type": "application/json", cookie: "auth-token=${authCookie}", origin: "${origin}", referer: "${origin}/exam/${examId}/start" },
    bodyTemplate: {},
    responseContract: {
      status: 200,
      extract: { attemptId: "body.id（或活跃 attempt 恢复语义 startOrRestoreAttempt）" },
    },
    dependsOn: ["A3-exam-detail"],
  },
  {
    id: "A5-restore-attempt",
    when: "take 页挂载（紧跟 A4）",
    method: "GET",
    url: "${origin}/api/attempts/${attemptId}",
    headersRole: { accept: "application/json", cookie: "auth-token=${authCookie}", referer: "${origin}/exam/${attemptId}/take" },
    bodyTemplate: null,
    responseContract: { status: 200, extract: { questionId: "body.questions[0].id（首题；shuffleQuestions=false → 蓝图顺序）" } },
    dependsOn: ["A4-start-attempt"],
  },
  {
    id: "A6-save-answer-v1",
    when: "作答变更后 1500ms debounce（DEBOUNCE_MS）",
    method: "POST",
    url: "${origin}/api/attempts/${attemptId}/answers/${questionId}",
    headersRole: { "content-type": "application/json", cookie: "auth-token=${authCookie}", origin: "${origin}", referer: "${origin}/exam/${attemptId}/take" },
    bodyTemplate: {
      attemptId: "${attemptId}",
      questionId: "${questionId}",
      answer: "${answerV1}",
      clientSeq: "${clientSeq}",
      clientSavedAt: "${iso8601-now}",
      baseVersion: "${baseVersion}",
    },
    responseContract: {
      status: 200,
      extract: { accepted: "body.accepted===true", serverVersion: "body.serverVersion（→ 下一次 baseVersion）" },
    },
    dependsOn: ["A5-restore-attempt"],
  },
  {
    id: "A7-save-answer-v2-revise",
    when: "改答变更后 1500ms debounce；clientSeq+1、baseVersion=A6.serverVersion",
    method: "POST",
    url: "${origin}/api/attempts/${attemptId}/answers/${questionId}",
    headersRole: "同 A6",
    bodyTemplate: { "...same as A6": "", answer: "${answerV2}", clientSeq: "${clientSeq+1}", baseVersion: "${serverVersionV1}" },
    responseContract: { status: 200, extract: { serverVersion: "body.serverVersion=2" } },
    dependsOn: ["A6-save-answer-v1"],
  },
  {
    id: "A8-heartbeat",
    when: "take 页挂载起每 30000ms（HEARTBEAT）",
    method: "POST",
    url: "${origin}/api/attempts/${attemptId}/heartbeat",
    headersRole: "同 A6（无 body）",
    bodyTemplate: null,
    responseContract: { status: 200, note: "连续失败进入断连态；恢复后重基准时钟" },
    dependsOn: ["A5-restore-attempt"],
  },
  {
    id: "A9-submit",
    when: "用户点击交卷并确认（瞬时；flush 未落盘保存）",
    method: "POST",
    url: "${origin}/api/attempts/${attemptId}/submit",
    headersRole: "同 A6",
    bodyTemplate: {},
    responseContract: {
      status: 200,
      extract: { status: "body.status（submitted/graded）", note: "结果含评分（immediate 发布）" },
    },
    dependsOn: ["A7-save-answer-v2-revise"],
  },
  {
    id: "A10-result",
    when: "跳转 /result 后页面加载（瞬时）",
    method: "GET",
    url: "${origin}/api/attempts/${attemptId}",
    headersRole: "同 A6（referer=${origin}/exam/${attemptId}/result）",
    bodyTemplate: null,
    responseContract: { status: 200, extract: { totalScore: "body.gradingResult.totalScore / UI result-total-score" } },
    dependsOn: ["A9-submit"],
  },
];

const FLOW_B_STEPS = [
  { "...": "B1–B5 同 A1–A5（换 ${username} 为第二名考生；maxAttempts=1）" },
  {
    id: "B6-save-answer-v1",
    when: "作答后 1500ms debounce",
    method: "POST",
    url: "${origin}/api/attempts/${attemptId}/answers/${questionId}",
    headersRole: "同 A6",
    bodyTemplate: { "...same as A6": "" },
    responseContract: { status: 200, extract: { serverVersion: "body.serverVersion=1" } },
    dependsOn: ["B5-restore-attempt"],
  },
  {
    id: "B7-refresh-reload",
    when: "保存确认后用户刷新（page.reload / 断线重连）",
    method: "GET",
    url: "${origin}/exam/${attemptId}/take（SPA 文档）+ GET ${origin}/api/attempts/${attemptId}",
    headersRole: "同 A5（cookie 保持 → 会话跨刷新续存）",
    bodyTemplate: null,
    responseContract: {
      status: 200,
      extract: { restoredAnswer: "body.answers[questionId] —— UI 回显为 radio checked" },
    },
    dependsOn: ["B6-save-answer-v1"],
  },
  {
    id: "B8-submit-after-recovery",
    when: "恢复确认后用户交卷（瞬时）",
    method: "POST",
    url: "${origin}/api/attempts/${attemptId}/submit",
    headersRole: "同 A9",
    bodyTemplate: {},
    responseContract: { status: 200, note: "提交的服务端答案集合=最后接受版本（B6 的 v1）" },
    dependsOn: ["B7-refresh-reload"],
  },
];

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
