/**
 * S2-TIMING browser runner — real Chromium via repo Playwright through the
 * REAL nginx ingress (RESEARCH ONLY; PROTOCOL §10 S2-TIMING, ADDENDUM §2.3
 * 「真实浏览器断连验证」: ①-b 保存仍在途交卷 + ③ 双击/响应丢失恢复 +
 * ④ 重启两窗口).
 *
 * Topology during this run (instrument): nginx (published :8080) → upstream
 * host.docker.internal:3300 → **isolated proxy :3300** → API :3301
 * (topology.sh api-restart with CAPACITY_API_PORT=3301). The proxy is a
 * transparent TCP pass-through unless a `hold-request` / `swallow-response`
 * rule matches; it never relaxes CSRF/limiter/origin policy (browser origin
 * stays the canonical http://127.0.0.1:8080). Restarts use the sanctioned
 * `topology.sh api-restart` (CAPACITY_API_PORT=3301).
 *
 * Assertions encode evidence/S2-TIMING/expected.md §1①-b-browser, §3③-c/d,
 * §4④-A/B (pre-registered). Every case uses its own candidate (maxAttempts=1).
 *
 * Run (cwd=/home/hoo/Source/exam contract):
 *   pnpm -C /home/hoo/Source/exam/.wt-capacity --filter @exam/e2e exec tsx \
 *     /home/hoo/Source/exam/.wt-capacity/docs/research/exam-cdp-watt-runtime-capacity/evidence/S2-TIMING/s2-browser.ts \
 *     --run-id=S2-BROWSER-r1 [--from=0]
 */
import { createRequire } from "node:module";
import { execFile, spawn } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESEARCH_DIR = join(__dirname, "..", "..");
const WORKTREE = join(RESEARCH_DIR, "..", "..", "..");
const req = createRequire(join(WORKTREE, "apps", "e2e", "package.json"));
const { chromium } = req("@playwright/test") as typeof import("@playwright/test");

const argz = Object.fromEntries(
  process.argv.slice(2).map((a) => /^--([^=]+)=(.*)$/.exec(a)?.slice(1, 3) ?? [a.slice(2), "true"]),
);
const RUN_ID = argz["run-id"] ?? `S2-BROWSER-${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 13)}`;
const FROM = Number(argz.from ?? 0);
const OUT_DIR = join(__dirname, RUN_ID);
const SHOT_DIR = join(OUT_DIR, "screenshots");
mkdirSync(SHOT_DIR, { recursive: true });

const ORIGIN = "http://127.0.0.1:8080"; // canonical ingress; proxy sits BEHIND nginx
const CONTROL = "http://127.0.0.1:8092"; // proxy control (3300 instance)
const DB = "exam_550_e2e";
// Synthetic fixture credential — pointer load from campaign config (never logged).
const PASSWORD = process.env.CANDIDATE_PASSWORD ?? (/CANDIDATE_PASSWORD = "([^"]+)"/.exec(
  readFileSync(join(RESEARCH_DIR, "harness", "lib", "config.ts"), "utf8"),
)?.[1] ?? (() => { throw new Error("CANDIDATE_PASSWORD not found"); })());
const TOPOLOGY = join(RESEARCH_DIR, "harness", "topology.sh");
const API_LOG = join(RESEARCH_DIR, "harness", "logs", "api.log");

const t0 = performance.now();
const mono = () => Math.round((performance.now() - t0) * 1000) / 1000;
const wall = () => new Date().toISOString();
const log = (m: string) => console.log(`[${RUN_ID}] ${m}`);
const samples: unknown[] = [];
function record(ev: unknown) { const r = { ...(ev as object), monoAt: mono(), wallAt: wall() }; samples.push(r); log(JSON.stringify(r)); }
const results: Array<{ case: string; assertion: string; expected: unknown; actual: unknown; pass: boolean }> = [];
function assert(caseName: string, name: string, expected: unknown, actual: unknown, pass: boolean) {
  results.push({ case: caseName, assertion: name, expected, actual, pass });
  log(`${pass ? "PASS" : "FAIL"} ${caseName}·${name}: expected=${JSON.stringify(expected)} actual=${JSON.stringify(actual)}`);
}

// ── PG helper ───────────────────────────────────────────────────────────────
function psql(sql: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("docker", ["exec", "-i", "exam-dev-db-1", "psql", "-U", "exam", "-d", DB, "-X", "-q", "-t", "-A", "-c", sql], { maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`psql: ${err.message} ${stderr}`)); else resolve(stdout);
    });
  });
}
async function oracle(username: string) {
  const row = (await psql(
    `SELECT a.id::text, a.status::text, coalesce(a.submission_reason,''),
       CASE WHEN a.submitted_at IS NULL THEN '' ELSE (extract(epoch from a.submitted_at)*1000)::bigint::text END,
       (SELECT count(*) FROM attempt_grading_entries g WHERE g.attempt_id=a.id),
       (SELECT count(*) FROM audit_logs al WHERE al.action='attempt.submit' AND al.target_id=a.id::text),
       (SELECT coalesce(string_agg(client_seq::text, ',' ORDER BY client_seq),'') FROM exam_answer_save_receipts r WHERE r.attempt_id=a.id),
       coalesce(a.submitted_answers::text,''),
       coalesce((SELECT e.final_score::text FROM exam_enrollments e WHERE e.id=a.enrollment_id),'')
     FROM exam_attempts a JOIN candidate_profiles cp ON cp.id=a.candidate_id
     JOIN users u ON u.id=cp.user_id WHERE u.username='${username}'`)).trim();
  const c = row.split("|");
  return { attemptId: c[0], status: c[1], reason: c[2], submittedMs: c[3] === "" ? null : Number(c[3]), entries: Number(c[4]), audits: Number(c[5]), saved: c[6], submittedAnswers: c[7], finalScore: c[8] };
}
const frozenAnswer = (json: string, qid?: string) => {
  try {
    const p = JSON.parse(json || "{}");
    const arr = p.answers ?? [];
    const f = qid ? arr.find((x: { questionId: string }) => x.questionId === qid) : arr[0];
    return f ? f.value : null;
  } catch { return "unparseable"; }
};
const submitLogCount = (attemptId: string) => {
  try {
    return readFileSync(API_LOG, "utf8").split("\n").filter((l) => l.includes("attempt.submit.completed") && l.includes(attemptId)).length;
  } catch { return 0; }
};

// ── proxy control ───────────────────────────────────────────────────────────
async function ctl(method: string, path: string, body?: unknown) {
  const res = await fetch(CONTROL + path, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as { events?: Array<Record<string, unknown>> } };
}
async function waitEvent(ruleId: string, ev: string, timeoutMs = 10_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const r = await ctl("GET", "/events");
    const found = (r.json.events ?? []).find((e) => e.rule === ruleId && e.ev === ev);
    if (found) return found;
    await new Promise((r2) => setTimeout(r2, 100));
  }
  return null;
}

// ── restart (sanctioned topology command; API stays on instrument port 3301) ─
function apiRestart(): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", [TOPOLOGY, "api-restart"], { env: { ...process.env, CAPACITY_API_PORT: "3301" }, cwd: join(WORKTREE, "..") });
    let out = "";
    child.stdout.on("data", (c) => (out += c.toString()));
    child.stderr.on("data", (c) => (out += c.toString()));
    child.on("exit", (code) => {
      record({ ev: "api-restart", exitCode: code, tail: out.split("\n").slice(-3).join(" | ") });
      if (code === 0) resolve(); else reject(new Error(`api-restart failed: ${out}`));
    });
  });
}

// ── candidates ──────────────────────────────────────────────────────────────
async function pickCandidates(n: number, from: number) {
  const examId = (await psql(`SELECT id::text FROM exams WHERE title='cap900 same-field S200'`)).trim();
  const q = await psql(
    `SELECT u.username FROM users u
     JOIN candidate_profiles cp ON cp.id = (SELECT id FROM candidate_profiles cp2 WHERE cp2.user_id=u.id LIMIT 1)
     JOIN exam_enrollments e ON e.candidate_id=cp.id AND e.exam_id='${examId}'
     WHERE u.username LIKE 'cap9same-c%' AND NOT EXISTS (
       SELECT 1 FROM exam_attempts a JOIN candidate_profiles cp2 ON cp2.id=a.candidate_id WHERE cp2.user_id=u.id)
     ORDER BY u.username`);
  const all = q.split("\n").map((s) => s.trim()).filter(Boolean);
  return { examId, picked: all.slice(from, from + n) };
}

// ── UI helpers ──────────────────────────────────────────────────────────────
type Page = import("@playwright/test").Page;
async function uiLogin(page: Page, username: string) {
  await page.context().clearCookies();
  await page.goto(`${ORIGIN}/login`);
  await page.getByTestId("login-layout").waitFor({ state: "visible", timeout: 15_000 });
  await page.getByLabel(/用户名/).fill(username);
  await page.getByLabel(/密码/).fill(PASSWORD);
  await page.getByRole("button", { name: /^登录$/ }).click();
  await page.waitForURL(/\/exam\/list(?:$|[/?#])/, { timeout: 15_000 });
  record({ ev: "ui-login", username });
}
async function uiStart(page: Page, examId: string) {
  const card = page.getByTestId(`exam-card-${examId}`);
  await card.waitFor({ state: "visible", timeout: 15_000 });
  await card.getByTestId("exam-primary-action").click();
  await page.waitForURL((u) => /\/exam\/[^/]+\/start$/.test(u.pathname), { timeout: 15_000 });
  await page.getByTestId("exam-start-btn").click();
  await page.waitForURL((u) => /\/exam\/[^/]+\/take$/.test(u.pathname), { timeout: 15_000 });
  await page.getByTestId("take-question-section").waitFor({ state: "visible", timeout: 15_000 });
  record({ ev: "ui-start", url: page.url() });
}
const saveResponse = (page: Page) =>
  page.waitForResponse((r) => r.request().method() === "POST" && /\/answers\//.test(r.url()) && r.status() === 200, { timeout: 30_000 });
async function clickConfirmSynchronouslyTwice(page: Page) {
  // Same-tick double click (the product's submittingRef is a synchronous guard;
  // two real click events dispatched in ONE JS task is the strongest client-side
  // double-click the UI can receive).
  await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="confirm-submit-btn"]') as HTMLElement | null;
    if (!btn) throw new Error("confirm-submit-btn not found");
    btn.click();
    btn.click();
  });
}

async function main() {
  const health = await fetch(`${ORIGIN}/api/health`);
  if (health.status !== 200) throw new Error(`ingress health ${health.status}`);
  const proxyHealth = await ctl("GET", "/events");
  if (proxyHealth.status !== 200) throw new Error("proxy control not reachable on :8092");
  const { examId, picked } = await pickCandidates(5, FROM);
  record({ ev: "pool", examId, candidates: picked });

  const browser = await chromium.launch({ headless: true });

  // ═══ ③-c browser double-click (same-tick two clicks → exactly ONE POST) ═══
  {
    const C = "③-c browser double-click";
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const username = picked[0]!;
    await uiLogin(page, username);
    await uiStart(page, examId);
    await page.getByTestId("true-false-true").check();
    await saveResponse(page);
    await page.getByTestId("take-submit-btn").click();
    await page.getByRole("dialog").waitFor({ state: "visible" });
    await clickConfirmSynchronouslyTwice(page);
    await page.waitForURL("**/result", { timeout: 30_000 });
    await page.waitForTimeout(800);
    const o = await oracle(username);
    const posts = submitLogCount(o.attemptId);
    await page.screenshot({ path: join(SHOT_DIR, "3c-result.png") });
    record({ ev: "case3c-done", url: page.url(), oracle: o, posts });
    assert(C, "lands on result page", true, page.url().includes("/result"), page.url().includes("/result"));
    assert(C, "exactly ONE submit POST despite two same-tick clicks (submittingRef)", 1, posts, posts === 1);
    assert(C, "graded once, audit 1, entries 12", "graded|1|12", `${o.status}|${o.audits}|${o.entries}`, o.status === "graded" && o.audits === 1 && o.entries === 12);
    await ctx.close();
  }

  // ═══ ①-b browser: save in flight → open submit dialog (flush waits) → release → submit ═══
  {
    const C = "①-b-browser save-in-flight-submit";
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const username = picked[1]!;
    await uiLogin(page, username);
    await uiStart(page, examId);
    const attemptId = (await oracle(username)).attemptId;
    // hold the in-flight save at the proxy (between nginx and API)
    const ruleId = `hold-save-${attemptId.slice(0, 8)}`;
    await ctl("POST", "/rule", { id: ruleId, match: `/attempts/${attemptId}/answers/`, action: "hold-request" });
    const saveP = saveResponse(page); // will settle only after release
    await page.getByTestId("true-false-true").check();
    const held = await waitEvent(ruleId, "held-request");
    record({ ev: "case1bb-save-held", held });
    await page.getByTestId("take-submit-btn").click();
    await page.getByRole("dialog").waitFor({ state: "visible" });
    // while the save is in flight the dialog must show flushing and hold confirm disabled
    const flushingVisible = await page.getByText("保存中...").first().isVisible().catch(() => false);
    const confirmDisabled = await page.getByTestId("confirm-submit-btn").isDisabled();
    await page.screenshot({ path: join(SHOT_DIR, "1bb-flushing.png") });
    record({ ev: "case1bb-flushing", flushingVisible, confirmDisabled });
    await ctl("POST", "/release", { id: ruleId });
    await ctl("POST", "/rule/delete", { id: ruleId });
    const saveResp = await saveP;
    const saveBody = (await saveResp.json()) as { accepted: boolean; serverVersion?: number };
    const questionId = /\/answers\/([0-9a-f-]{36})/.exec(saveResp.url())?.[1] ?? null;
    await page.getByTestId("confirm-submit-btn").waitFor({ state: "visible" });
    const enabled = await page.getByTestId("confirm-submit-btn").isEnabled();
    await page.getByTestId("confirm-submit-btn").click();
    await page.waitForURL("**/result", { timeout: 30_000 });
    const o = await oracle(username);
    const frozen = frozenAnswer(o.submittedAnswers, questionId ?? undefined);
    await page.screenshot({ path: join(SHOT_DIR, "1bb-result.png") });
    record({ ev: "case1bb-done", saveBody, oracle: o, frozen });
    assert(C, "save was held in flight at the proxy", true, Boolean(held), Boolean(held));
    assert(C, "dialog shows flushing while save pending (确认交卷 dialog + 保存中...)", true, flushingVisible, flushingVisible);
    assert(C, "confirm button disabled while flushing", true, confirmDisabled, confirmDisabled);
    assert(C, "released save accepted", true, saveBody.accepted === true, saveBody.accepted === true);
    assert(C, "confirm enabled after flush, submit reaches result", true, enabled, enabled);
    assert(C, "frozen submitted answer = the in-flight save (true)", true, frozen === true, frozen === true);
    assert(C, "graded / reason manual / audit 1", "graded|manual|1", `${o.status}|${o.reason}|${o.audits}`, o.status === "graded" && o.reason === "manual" && o.audits === 1);
    await ctx.close();
  }

  // ═══ ③-d browser response lost + retry ═══
  {
    const C = "③-d browser response-lost-retry";
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const username = picked[2]!;
    await uiLogin(page, username);
    await uiStart(page, examId);
    const attemptId = (await oracle(username)).attemptId;
    await page.getByTestId("true-false-true").check();
    await saveResponse(page);
    const ruleId = `swallow-${attemptId.slice(0, 8)}`;
    await ctl("POST", "/rule", { id: ruleId, match: `/attempts/${attemptId}/submit`, action: "swallow-response" });
    await page.getByTestId("take-submit-btn").click();
    await page.getByRole("dialog").waitFor({ state: "visible" });
    await page.getByTestId("confirm-submit-btn").click();
    const captured = await waitEvent(ruleId, "response-captured", 15_000);
    record({ ev: "case3d-captured", captured });
    await ctl("POST", "/release", { id: ruleId, deliver: false });
    await ctl("POST", "/rule/delete", { id: ruleId });
    // browser must surface the failure and stay on the take page
    const toast = page.getByText("提交失败，请重试").first();
    await toast.waitFor({ state: "visible", timeout: 15_000 });
    const stillOnTake = page.url().includes("/take");
    await page.screenshot({ path: join(SHOT_DIR, "3d-failed-toast.png") });
    const oAfterLoss = await oracle(username);
    record({ ev: "case3d-after-loss", stillOnTake, oracle: oAfterLoss });
    // retry: SUBMIT_FAILED keeps the confirm dialog open and re-enables the
    // confirm button (TakeExamPage.tsx:2270-2278) — click it again.
    const dialogStillOpen = await page.getByRole("dialog").isVisible().catch(() => false);
    if (!dialogStillOpen) {
      await page.getByTestId("take-submit-btn").click();
      await page.getByRole("dialog").waitFor({ state: "visible" });
    }
    await page.getByTestId("confirm-submit-btn").click();
    await page.waitForURL("**/result", { timeout: 30_000 });
    const score = (await page.getByTestId("result-total-score").textContent().catch(() => "")) ?? "";
    const o = await oracle(username);
    await page.screenshot({ path: join(SHOT_DIR, "3d-retry-result.png") });
    record({ ev: "case3d-done", score, oracle: o });
    assert(C, "submit response captured at proxy (server committed)", true, Boolean(captured), Boolean(captured));
    assert(C, "browser shows 提交失败，请重试 and stays on take page", true, stillOnTake, stillOnTake);
    assert(C, "DB already committed before retry (graded/manual/audit 1)", "graded|manual|1", `${oAfterLoss.status}|${oAfterLoss.reason}|${oAfterLoss.audits}`, oAfterLoss.status === "graded" && oAfterLoss.reason === "manual" && oAfterLoss.audits === 1);
    assert(C, "retry reaches result page with graded score", true, page.url().includes("/result") && score !== "", page.url().includes("/result") && score !== "");
    assert(C, "retry is idempotent: audit still 1, entries 12, submittedAt unchanged", "1|12|same",
      `${o.audits}|${o.entries}|${o.submittedMs === oAfterLoss.submittedMs}`,
      o.audits === 1 && o.entries === 12 && o.submittedMs === oAfterLoss.submittedMs);
    await ctx.close();
  }

  // ═══ ④-A restart BEFORE the transaction (request parked at proxy) ═══
  {
    const C = "④-A restart-before-tx";
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const username = picked[3]!;
    await uiLogin(page, username);
    await uiStart(page, examId);
    const attemptId = (await oracle(username)).attemptId;
    await page.getByTestId("true-false-true").check();
    await saveResponse(page);
    const ruleId = `hold-submit-${attemptId.slice(0, 8)}`;
    await ctl("POST", "/rule", { id: ruleId, match: `/attempts/${attemptId}/submit`, action: "hold-request" });
    await page.getByTestId("take-submit-btn").click();
    await page.getByRole("dialog").waitFor({ state: "visible" });
    await page.getByTestId("confirm-submit-btn").click();
    const held = await waitEvent(ruleId, "held-request", 15_000);
    record({ ev: "case4a-held", held });
    // restart the API while the submit request is parked BEFORE nginx forwards it
    await apiRestart();
    const oBefore = await oracle(username); // PG re-read after restart, before forwarding
    record({ ev: "case4a-pg-after-restart", oracle: oBefore });
    await ctl("POST", "/release", { id: ruleId });
    await ctl("POST", "/rule/delete", { id: ruleId });
    // the forwarded request now hits the fresh process; the session cookie was
    // signed with the pre-restart secret (research R3 rotation) → 401; the
    // durable fact must still be "in_progress" and a re-login + fresh submit
    // must produce exactly one graded outcome.
    await page.waitForTimeout(2500);
    const urlAfterForward = page.url();
    const oAfterForward = await oracle(username);
    record({ ev: "case4a-after-forward", url: urlAfterForward, oracle: oAfterForward });
    let reLoginNeeded = false;
    if (oAfterForward.status === "in_progress") {
      reLoginNeeded = true;
      await uiLogin(page, username);
      await page.goto(`${ORIGIN}/exam/${attemptId}/take`);
      await page.getByTestId("take-question-section").waitFor({ state: "visible", timeout: 20_000 });
      record({ ev: "case4a-relogin", takeVisible: true, url: page.url() });
      await page.getByTestId("take-submit-btn").click();
      await page.getByRole("dialog").waitFor({ state: "visible", timeout: 15_000 });
      await page.getByTestId("confirm-submit-btn").click();
      await page.waitForURL("**/result", { timeout: 30_000 });
    }
    const o = await oracle(username);
    await page.screenshot({ path: join(SHOT_DIR, "4a-result.png") });
    record({ ev: "case4a-done", reLoginNeeded, oracle: o });
    assert(C, "submit parked pre-transaction (proxy held)", true, Boolean(held), Boolean(held));
    assert(C, "PG after restart & before forwarding: still in_progress (nothing persisted)", "in_progress", oBefore.status, oBefore.status === "in_progress");
    assert(C, "no audit/grading side effect from the restart window", "0|0", `${oBefore.audits}|${oBefore.entries}`, oBefore.audits === 0 && oBefore.entries === 0);
    assert(C, "fresh submit after restart: graded exactly once, audit 1", "graded|manual|1", `${o.status}|${o.reason}|${o.audits}`, o.status === "graded" && o.reason === "manual" && o.audits === 1);
    await ctx.close();
  }

  // ═══ ④-B committed but response undelivered, then restart ═══
  {
    const C = "④-B restart-after-commit-response-lost";
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const username = picked[4]!;
    await uiLogin(page, username);
    await uiStart(page, examId);
    const attemptId = (await oracle(username)).attemptId;
    await page.getByTestId("true-false-true").check();
    await saveResponse(page);
    const ruleId = `swallow4b-${attemptId.slice(0, 8)}`;
    await ctl("POST", "/rule", { id: ruleId, match: `/attempts/${attemptId}/submit`, action: "swallow-response" });
    await page.getByTestId("take-submit-btn").click();
    await page.getByRole("dialog").waitFor({ state: "visible" });
    await page.getByTestId("confirm-submit-btn").click();
    const captured = await waitEvent(ruleId, "response-captured", 15_000);
    record({ ev: "case4b-captured", captured });
    // committed → restart the API while the response sits undelivered at the proxy
    await apiRestart();
    const oCommitted = await oracle(username);
    record({ ev: "case4b-pg-after-restart", oracle: oCommitted });
    // now destroy the client connection: response never delivered
    await ctl("POST", "/release", { id: ruleId, deliver: false });
    await ctl("POST", "/rule/delete", { id: ruleId });
    const toast = page.getByText("提交失败，请重试").first();
    await toast.waitFor({ state: "visible", timeout: 15_000 });
    await page.screenshot({ path: join(SHOT_DIR, "4b-failed-toast.png") });
    // recovery: session was invalidated by the research JWT rotation → re-login,
    // then read the authoritative result page for the SAME attempt.
    await uiLogin(page, username);
    await page.goto(`${ORIGIN}/exam/${attemptId}/result`);
    await page.getByTestId("result-total-score").waitFor({ state: "visible", timeout: 20_000 });
    const score = (await page.getByTestId("result-total-score").textContent().catch(() => "")) ?? "";
    await page.screenshot({ path: join(SHOT_DIR, "4b-recovered-result.png") });
    const o = await oracle(username);
    record({ ev: "case4b-done", score, oracle: o });
    assert(C, "commit happened before restart (proxy captured response)", true, Boolean(captured), Boolean(captured));
    assert(C, "PG after restart: graded / manual / submittedAt set", "graded|manual|set", `${oCommitted.status}|${oCommitted.reason}|${oCommitted.submittedMs !== null ? "set" : "null"}`, oCommitted.status === "graded" && oCommitted.reason === "manual" && oCommitted.submittedMs !== null);
    assert(C, "audit 1 / grading 12 / finalScore written (已提交已评分独立核对)", "1|12|non-empty", `${oCommitted.audits}|${oCommitted.entries}|${oCommitted.finalScore !== "" ? "non-empty" : ""}`, oCommitted.audits === 1 && oCommitted.entries === 12 && oCommitted.finalScore !== "");
    assert(C, "browser saw lost response (提交失败，请重试)", true, true, true);
    assert(C, "recovered result page shows the graded attempt", true, score !== "", score !== "");
    assert(C, "no duplicate effects after recovery", "1|12", `${o.audits}|${o.entries}`, o.audits === 1 && o.entries === 12);
    await ctx.close();
  }

  await browser.close();
  const failed = results.filter((r) => !r.pass);
  writeFileSync(join(OUT_DIR, "assertions.json"), JSON.stringify({ runId: RUN_ID, total: results.length, failed: failed.length, results }, null, 2) + "\n");
  writeFileSync(join(OUT_DIR, "samples.jsonl"), samples.map((s) => JSON.stringify(s)).join("\n") + "\n");
  log(`SUMMARY total=${results.length} failed=${failed.length}`);
  process.exitCode = failed.length === 0 ? 0 : 1;
}

main().catch((e) => {
  log(`FATAL ${String((e as Error)?.stack ?? e)}`);
  writeFileSync(join(OUT_DIR, "fatal.txt"), String((e as Error)?.stack ?? e) + "\n");
  process.exit(2);
});
