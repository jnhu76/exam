#!/usr/bin/env node
/**
 * S2-TIMING core-assertion gate — independent, re-runnable with plain `node`
 * from cwd=/home/hoo/Source/exam (RESEARCH ONLY).
 *
 *   node .wt-capacity/docs/research/exam-cdp-watt-runtime-capacity/evidence/S2-TIMING/s2-gate.mjs \
 *        [--run-id=S2-GATE]
 *
 * Covers the protocol-/transaction-level CORE of S2 (四类交错的可复跑断言):
 *   ①-a 保存成功后提交 / ①-b 保存在途·save 先锁 / ①-b' 保存在途·submit 先锁
 *   ③-a 双击两 POST 唯一业务效果 / ③-b 提交已落地·响应丢失 + 幂等重试
 *     → s2-live.mjs（node，真实 nginx:8080 + 外部 PG enrollment 锁 barrier）；
 *   ②-a 截止前取时·手动先锁跨截止 / ②-b scanner 先锁 / ②-c now==T 边界 /
 *   ②-d now==T-1ms / ②-e 保存侧边界 → s2-inprocess.ts（真实路由
 *     app.inject + setNowOverride 受控服务端时钟 + 真实 PG exam_test_s2）。
 *
 * The BROWSER cases (①-b-browser / ③-c / ③-d / ④-A / ④-B, Playwright +
 * fault-injection proxy + api-restart) are archived under
 * evidence/S2-TIMING/S2-BROWSER-r3 and are NOT re-run by this gate (they need
 * the instrument topology: proxy inserted between nginx and API on :3300/3301
 * and two sanctioned api-restarts).
 *
 * Preconditions: canonical topology up (topology.sh up; API :3300, nginx :8080,
 * research DB exam_550_e2e). The gate starts its own protocol proxy on
 * :8090/:8091 and stops it on exit; every case uses fresh unused candidates;
 * the in-process runner creates+drops its own exam_test_s2 database.
 */
import { spawn, execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => /^--([^=]+)=(.*)$/.exec(a)?.slice(1, 3) ?? [a.slice(2), "true"]),
);
const TAG = args["run-id"] ?? `S2-GATE-${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 13)}`;
const LIVE_ID = `${TAG}-live`;
const INPROC_ID = `${TAG}-inproc`;
const log = (m) => console.log(`[s2-gate] ${m}`);

function run(cmd, argv, opts = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, argv, { stdio: ["ignore", "pipe", "pipe"], ...opts });
    let out = "";
    child.stdout.on("data", (c) => { out += c; process.stdout.write(c); });
    child.stderr.on("data", (c) => { out += c; process.stderr.write(c); });
    child.on("exit", (code) => resolve({ code, out }));
  });
}

async function main() {
  // 1) canonical ingress health
  const health = await fetch("http://127.0.0.1:8080/api/health");
  if (health.status !== 200) throw new Error(`ingress /api/health = ${health.status} (topology.sh up?)`);
  log("ingress health 200");

  // 2) protocol proxy for case ③-b (spawned and stopped by the gate)
  const proxy = spawn("node", [join(__dirname, "s2-proxy.mjs")], {
    stdio: ["ignore", "ignore", "ignore"],
    env: { ...process.env, S2_PROXY_PORT: "8090", S2_CONTROL_PORT: "8091" },
  });
  try {
    let up = false;
    for (let i = 0; i < 50; i++) {
      try { const r = await fetch("http://127.0.0.1:8091/events"); if (r.status === 200) { up = true; break; } } catch { /* retry */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!up) throw new Error("protocol proxy control :8091 did not come up");

    // 3) live protocol cases ①③ (real nginx + PG lock barriers)
    log(`live cases → run-id ${LIVE_ID}`);
    const live = await run("node", [join(__dirname, "s2-live.mjs"), `--run-id=${LIVE_ID}`, "--from=0"]);
    const liveRaw = JSON.parse(readFileSync(join(__dirname, LIVE_ID, "assertions.json"), "utf8"));
    const liveAssert = liveRaw.summary ?? liveRaw; // s2-live wraps {summary, results}

    // 4) in-process class ② (real routes + controlled clock + real PG exam_test_s2)
    log(`in-process cases → run-id ${INPROC_ID}`);
    const inproc = await run("pnpm", ["-C", join(__dirname, "..", "..", "..", ".."), "--filter", "@exam/api", "exec", "tsx", join(__dirname, "s2-inprocess.ts"), `--run-id=${INPROC_ID}`]);
    const inprocFile = join(__dirname, INPROC_ID, "assertions.json");
    if (!existsSync(inprocFile)) throw new Error("in-process assertions.json missing");
    const inprocAssert = JSON.parse(readFileSync(inprocFile, "utf8"));

    const liveOk = live.code === 0 && liveAssert.failed === 0;
    const inprocOk = inproc.code === 0 && inprocAssert.failed === 0;
    log(`live: ${liveAssert.total - liveAssert.failed}/${liveAssert.total} pass (exit ${live.code})`);
    log(`in-process: ${inprocAssert.total - inprocAssert.failed}/${inprocAssert.total} pass (exit ${inproc.code})`);
    log(`VERDICT: ${liveOk && inprocOk ? "PASS" : "FAIL"} (live=${liveOk ? "PASS" : "FAIL"}, in-process=${inprocOk ? "PASS" : "FAIL"})`);
    log(`evidence: ${join(__dirname, LIVE_ID)} , ${join(__dirname, INPROC_ID)}`);
    process.exitCode = liveOk && inprocOk ? 0 : 1;
  } finally {
    proxy.kill("SIGINT");
  }
}

main().catch((e) => { log(`FATAL ${String(e?.stack ?? e)}`); process.exit(2); });
