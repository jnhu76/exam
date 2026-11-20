/**
 * G1.2 UI 探针（RESEARCH ONLY，宿主机侧，少量真实浏览器轨迹）。
 *
 * 目的：证明协议回放 driver 复用的 endpoint mix/payload/节拍与真实浏览器一致
 * （总纲 G1.2「对比 endpoint mix、payload、响应和业务终态」），并保留浏览器级
 * UI 证据（保存 chip、恢复回显、结果分）——driver 本体是协议级，UI 透明性由
 * 本探针补足。经实际 nginx published 入口（真实浏览器路径）。
 *
 * 探针规模刻意小（默认 2 名考生：A 简化 happy-path + B 刷新恢复），不构成
 * 容量采样；登录走 172.28.10.1 共享预算（≤10/60s），勿与其他同源登录并发。
 *
 * 运行（cwd=/home/hoo/Source/exam 契约）：
 *   pnpm -C /home/hoo/Source/exam/.wt-capacity --filter @exam/db exec tsx \
 *     /home/hoo/Source/exam/.wt-capacity/docs/research/exam-cdp-watt-runtime-capacity/evidence/driver/ui-probe.ts \
 *     --candidates=<idxA,idxB>   # seed-manifest sameField 下标，须为未消耗考生
 */
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESEARCH_DIR = join(__dirname, "..", "..");
const req = createRequire(join(RESEARCH_DIR, "..", "apps", "e2e", "package.json"));
const { chromium } = req("@playwright/test") as typeof import("@playwright/test");
const { CANDIDATE_PASSWORD: PASSWORD } = await import(
  join(__dirname, "..", "..", "harness", "lib", "config.js")
);

const ORIGIN = "http://127.0.0.1:8080"; // 实际 nginx published 入口（浏览器路径）
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => /^--([^=]+)=(.*)$/.exec(a)?.slice(1, 3) ?? [a.slice(2), "true"]),
);
const idx = (args.candidates ?? "2,3").split(",").map((x: string) => Number(x.trim()));
const RUN_ID = args["run-id"] ?? `G1-UIPROBE-${new Date().toISOString().replace(/[:.]/g, "").slice(0, 15)}`;

const manifest = JSON.parse(
  readFileSync(join(__dirname, "..", "fixtures", "seed-manifest.json"), "utf8"),
) as { sameField: { examId: string; candidates: string[] } };
const EXAM_ID = manifest.sameField.examId;
const USER_A = manifest.sameField.candidates[idx[0]!]!;
const USER_B = manifest.sameField.candidates[idx[1]!]!;

interface ApiCall {
  tRelMs: number;
  method: string;
  path: string;
  status?: number;
  bodyKeys?: string[];
}
interface ProbeResult {
  flow: string;
  username: string;
  apiCalls: ApiCall[];
  uiAssertions: { name: string; pass: boolean; detail: string }[];
}

function tpl(pathname: string): string {
  // 与 driver op 路径模板同构化
  return pathname
    .replace(/\/api\/attempts\/[^/]+\/answers\/[^/]+$/, "/api/attempts/:aid/answers/:qid")
    .replace(/\/api\/attempts\/[^/]+\/(start|heartbeat|submit)$/, "/api/attempts/:aid/$1")
    .replace(/\/api\/candidate\/attempts\/[^/]+\/take$/, "/api/candidate/attempts/:aid/take")
    .replace(/\/api\/scores\/attempts\/[^/]+$/, "/api/scores/attempts/:aid")
    .replace(/\/api\/candidate\/exams\/[^/]+$/, "/api/candidate/exams/:examId")
    .replace(/\/exam\/[^/]+\/take$/, "/exam/:aid/take");
}

async function runFlowA(browser: import("@playwright/test").Browser): Promise<ProbeResult> {
  const out: ProbeResult = { flow: "A-happy-path", username: USER_A, apiCalls: [], uiAssertions: [] };
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const t0 = Date.now();
  page.on("response", async (res) => {
    const u = new URL(res.url());
    if (!u.pathname.startsWith("/api/")) return;
    const rec: ApiCall = { tRelMs: res.request().timing().startTime > 1e12 ? Math.round(res.request().timing().startTime - t0) : Date.now() - t0, method: res.request().method(), path: tpl(u.pathname), status: res.status() };
    const pd = res.request().postData();
    if (pd) {
      try { rec.bodyKeys = Object.keys(JSON.parse(pd)); } catch { rec.bodyKeys = null; }
    }
    out.apiCalls.push(rec);
  });

  await page.goto(`${ORIGIN}/login`);
  await page.getByTestId("login-layout").waitFor({ state: "visible", timeout: 15000 });
  await page.getByLabel(/用户名/).fill(USER_A);
  await page.getByLabel(/密码/).fill(PASSWORD);
  await page.getByRole("button", { name: /^登录$/ }).click();
  await page.waitForURL(/\/exam\/list(?:$|[/?#])/, { timeout: 15000 });
  await page.waitForTimeout(1500); // 简化驻留（探针不做 8s 等候——节拍保真由 driver 负责）

  const card = page.getByTestId(`exam-card-${EXAM_ID}`);
  await card.waitFor({ state: "visible", timeout: 15000 });
  await card.getByTestId("exam-primary-action").click();
  await page.waitForURL((u) => /\/exam\/[^/]+\/start$/.test(u.pathname), { timeout: 15000 });
  await page.getByTestId("exam-start-btn").click();
  await page.waitForURL((u) => /\/exam\/[^/]+\/take$/.test(u.pathname), { timeout: 15000 });
  await page.getByTestId("take-question-section").waitFor({ state: "visible", timeout: 15000 });

  const waitSave = () =>
    page.waitForResponse(
      (r) => r.request().method() === "POST" && /\/api\/attempts\/[^/]+\/answers\//.test(r.url()),
      { timeout: 20000 },
    );
  const s1p = waitSave();
  await page.getByTestId("true-false-true").check();
  const s1 = await s1p;
  const s1body = (await s1.json()) as { accepted: boolean; serverVersion: number };
  const chip1 = (await page.getByRole("status").first().textContent()) ?? "";
  out.uiAssertions.push({ name: "A-save1-accepted", pass: s1body.accepted === true && s1body.serverVersion === 1, detail: JSON.stringify(s1body) });
  out.uiAssertions.push({ name: "A-save1-chip-saved", pass: chip1.includes("已保存"), detail: `chip=${chip1}` });

  const s2p = waitSave();
  await page.getByTestId("true-false-false").check();
  const s2 = await s2p;
  const s2body = (await s2.json()) as { accepted: boolean; serverVersion: number };
  out.uiAssertions.push({ name: "A-save2-accepted", pass: s2body.accepted === true && s2body.serverVersion === 2, detail: JSON.stringify(s2body) });

  await page.getByTestId("take-submit-btn").click();
  await page.getByRole("dialog").waitFor({ state: "visible" });
  await page.getByTestId("confirm-submit-btn").click();
  await page.waitForURL("**/result", { timeout: 30000 });
  const score = (await page.getByTestId("result-total-score").textContent()) ?? "";
  out.uiAssertions.push({ name: "A-result-score-visible", pass: /\d+/.test(score), detail: `score=${score}（A 答 false，Q0 正解 true → 期望 0 分）` });
  await ctx.close();
  return out;
}

async function runFlowB(browser: import("@playwright/test").Browser): Promise<ProbeResult> {
  const out: ProbeResult = { flow: "B-refresh-recovery", username: USER_B, apiCalls: [], uiAssertions: [] };
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const t0 = Date.now();
  page.on("response", async (res) => {
    const u = new URL(res.url());
    if (!u.pathname.startsWith("/api/")) return;
    const rec: ApiCall = { tRelMs: Date.now() - t0, method: res.request().method(), path: tpl(u.pathname), status: res.status() };
    const pd = res.request().postData();
    if (pd) {
      try { rec.bodyKeys = Object.keys(JSON.parse(pd)); } catch { rec.bodyKeys = null; }
    }
    out.apiCalls.push(rec);
  });

  await page.goto(`${ORIGIN}/login`);
  await page.getByTestId("login-layout").waitFor({ state: "visible", timeout: 15000 });
  await page.getByLabel(/用户名/).fill(USER_B);
  await page.getByLabel(/密码/).fill(PASSWORD);
  await page.getByRole("button", { name: /^登录$/ }).click();
  await page.waitForURL(/\/exam\/list(?:$|[/?#])/, { timeout: 15000 });

  const card = page.getByTestId(`exam-card-${EXAM_ID}`);
  await card.waitFor({ state: "visible", timeout: 15000 });
  await card.getByTestId("exam-primary-action").click();
  await page.waitForURL((u) => /\/exam\/[^/]+\/start$/.test(u.pathname), { timeout: 15000 });
  await page.getByTestId("exam-start-btn").click();
  await page.waitForURL((u) => /\/exam\/[^/]+\/take$/.test(u.pathname), { timeout: 15000 });
  await page.getByTestId("take-question-section").waitFor({ state: "visible", timeout: 15000 });

  const s1p = page.waitForResponse(
    (r) => r.request().method() === "POST" && /\/api\/attempts\/[^/]+\/answers\//.test(r.url()),
    { timeout: 20000 },
  );
  await page.getByTestId("true-false-true").check();
  const s1 = await s1p;
  const s1body = (await s1.json()) as { accepted: boolean; serverVersion: number };
  out.uiAssertions.push({ name: "B-save1-accepted", pass: s1body.accepted === true && s1body.serverVersion === 1, detail: JSON.stringify(s1body) });

  await page.reload();
  await page.getByTestId("take-question-section").waitFor({ state: "visible", timeout: 15000 });
  const restored = await page.getByTestId("true-false-true").isChecked();
  out.uiAssertions.push({ name: "B-restore-radio-checked", pass: restored, detail: `恢复回显 checked=${restored}` });

  await page.getByTestId("take-submit-btn").click();
  await page.getByRole("dialog").waitFor({ state: "visible" });
  await page.getByTestId("confirm-submit-btn").click();
  await page.waitForURL("**/result", { timeout: 30000 });
  const score = (await page.getByTestId("result-total-score").textContent()) ?? "";
  out.uiAssertions.push({ name: "B-result-score-visible", pass: /\d+/.test(score), detail: `score=${score}（B 答 true → 期望 10 分）` });
  await ctx.close();
  return out;
}

// ── 与协议回放 driver 的 endpoint mix 对比 ─────────────────────────────────
function compareMix(ui: ProbeResult, flowKey: "a" | "b") {
  // driver 流的 op 序列（kind→路径模板），来源同 driver.mjs 的 timeline 提取
  const spec = JSON.parse(readFileSync(join(__dirname, "..", "g1-traces", "replay-spec.json"), "utf8"));
  const key = flowKey === "a" ? "A-happy-path" : "B-refresh-recovery";
  const uiSeq = ui.apiCalls.filter((c) => c.status !== undefined).map((c) => `${c.method} ${c.path}`);
  const specSeq = spec.flows[key].observedApiCalls.map((c: { method: string; path: string }) => `${c.method} ${tpl(c.path)}`);
  // 顺序对齐（浏览器响应事件顺序≈请求顺序；探针不做 8s 驻留与 30s 心跳 →
  // 驻留期内时序无关请求顺序可比性有限，改为集合+多重集对比）
  const multiset = (arr: string[]) => {
    const m = new Map<string, number>();
    for (const x of arr) m.set(x, (m.get(x) ?? 0) + 1);
    return m;
  };
  const um = multiset(uiSeq);
  const sm = multiset(specSeq);
  const keys = new Set([...um.keys(), ...sm.keys()]);
  const diff = [...keys]
    .filter((k) => (um.get(k) ?? 0) !== (sm.get(k) ?? 0))
    .map((k) => `${k}: ui×${um.get(k) ?? 0} spec×${sm.get(k) ?? 0}`);
  return { uiCallCount: uiSeq.length, specCallCount: specSeq.length, multisetDiff: diff };
}

const browser = await chromium.launch({ headless: true });
const a = await runFlowA(browser);
const b = await runFlowB(browser);
await browser.close();

const result = {
  runId: RUN_ID,
  origin: ORIGIN,
  note: "探针简化驻留（1.5s）与无 30s 心跳窗口：endpoint mix 按多重集对比；完整节拍保真由 driver.mjs 从 replay-spec observedApiCalls 机械复用",
  probes: [a, b],
  mixComparison: {
    a: compareMix(a, "a"),
    b: compareMix(b, "b"),
  },
  allUiAssertionsPass: [...a.uiAssertions, ...b.uiAssertions].every((x) => x.pass),
};
const outDir = join(__dirname, "runs", RUN_ID);
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, "ui-probe.json");
writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n");
console.log(`[ui-probe] A=${a.apiCalls.length} api calls, assertions ${a.uiAssertions.map((x) => x.pass).join(",")}`);
console.log(`[ui-probe] B=${b.apiCalls.length} api calls, assertions ${b.uiAssertions.map((x) => x.pass).join(",")}`);
console.log(`[ui-probe] mix diff A: ${JSON.stringify(result.mixComparison.a.multisetDiff)} B: ${JSON.stringify(result.mixComparison.b.multisetDiff)}`);
console.log(`[ui-probe] written: ${outPath}`);
