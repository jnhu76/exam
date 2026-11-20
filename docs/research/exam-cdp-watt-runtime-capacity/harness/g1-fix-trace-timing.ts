/**
 * G1-FIDELITY trace timing 修正器（RESEARCH ONLY，一次性见证工具）。
 *
 * 背景：Playwright 1.61 的 request.timing() 返回 startTime=epoch-毫秒（float），
 * 而 requestStart/responseStart/responseEnd=相对 startTime 的毫秒。首版采集脚本
 * 按官方文档的"全部为 epoch-秒"处理，乘了 1000，导致：
 *   stored.startTime        = E*1000            （E=epoch ms）
 *   stored.requestStart     = (rel-E)*1000      （rel=相对 ms）
 *   stored.responseStart    = (rel2-E)*1000
 *   stored.responseEnd      = (relEnd-E)*1000
 *   rec.tsRequest（被覆盖）= E*1000
 *   save 观测的 tSentMs     = E*1000 - t0
 * 每个 stored 字段都可精确逆变换（无信息损失），本脚本就地修正两个 trace 与
 * replay-spec 的 observedApiCalls，并重算 phase 相对时间轴。
 *
 * 运行：
 *   pnpm -C /home/hoo/Source/exam/.wt-capacity --filter @exam/db exec tsx \
 *     <本文件>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "evidence", "g1-traces");

function isCorrupted(v: number): boolean {
  return v > 1e14; // 正确 epoch-ms ≈ 1.79e12；被 ×1000 后 ≈ 1.79e15
}

function fixRequest(r: Record<string, unknown>): void {
  const t = r.timing as
    | { startTime: number; requestStart: number; responseStart: number; responseEnd: number }
    | undefined;
  if (!t) return;
  if (!isCorrupted(t.startTime)) return; // 已正确（幂等）
  const E = t.startTime / 1000; // epoch ms
  const rel = (stored: number) => stored / 1000 + E; // 相对 ms
  t.startTime = Math.round(E);
  t.requestStart = Math.round(rel(t.requestStart));
  t.responseStart = Math.round(rel(t.responseStart));
  t.responseEnd = Math.round(rel(t.responseEnd));
  if (typeof r.tsRequest === "number" && isCorrupted(r.tsRequest)) {
    r.tsRequest = Math.round(r.tsRequest / 1000);
  }
}

function fixTrace(path: string): { t0: number; apiCalls: unknown[]; label: string } {
  const d = JSON.parse(readFileSync(path, "utf8"));
  let t0 = Infinity;
  for (const r of d.requests) {
    fixRequest(r);
    if (typeof r.tsRequest === "number") t0 = Math.min(t0, r.tsRequest);
  }
  // save 观测 uiEvents 里的 tSentMs = E*1000 - t0Recorder（t0Recorder 未存档；
  // 用首个请求时刻近似轨迹起点，误差 < 采集启动延迟，仅影响显示用的相对时间）。
  for (const e of d.uiEvents) {
    const m = /"tSentMs":(\d+(?:\.\d+)?)/.exec(e.detail ?? "");
    if (m) {
      const stored = Number(m[1]);
      if (stored > 1e9) {
        const correctRel = stored / 1000 - t0 * 0.999; // (1000E - t0)/1000 - t0*(1-1/1000) 修正
        e.detail = e.detail!.replace(m[0], `"tSentMs":${Math.round(correctRel)}`);
      }
    }
  }
  const apiCalls = d.requests
    .filter((r: { url: string }) => r.url.includes("/api/"))
    .map((r: Record<string, unknown>) => ({
      seq: r.seq,
      phase: r.phase,
      tRelMs: Math.round((r.tsRequest as number) - t0),
      method: r.method,
      path: new URL(r.url as string).pathname,
      status: r.status ?? null,
      serverMs: r.timing ? (r.timing as { responseStart: number }).responseStart - (r.timing as { requestStart: number }).requestStart : null,
    }));
  writeFileSync(path, JSON.stringify(d, null, 2));
  return { t0, apiCalls, label: d.trajectory };
}

const a = fixTrace(join(OUT_DIR, "trace-a-happy-path.json"));
const b = fixTrace(join(OUT_DIR, "trace-b-refresh-recovery.json"));

const specPath = join(OUT_DIR, "replay-spec.json");
const spec = JSON.parse(readFileSync(specPath, "utf8"));
spec.flows["A-happy-path"].observedApiCalls = a.apiCalls;
spec.flows["B-refresh-recovery"].observedApiCalls = b.apiCalls;
spec.timingNote =
  "observedApiCalls.tRelMs 相对轨迹首个请求；serverMs=Playwright timing requestStart→responseStart（经实际 nginx，含网络往返）";
writeFileSync(specPath, JSON.stringify(spec, null, 2));

console.log(`[fix] trace A: ${a.apiCalls.length} api calls, t0=${new Date(a.t0).toISOString()}`);
console.log(`[fix] trace B: ${b.apiCalls.length} api calls, t0=${new Date(b.t0).toISOString()}`);
for (const c of [...a.apiCalls, ...b.apiCalls] as Array<{
  label?: string;
  phase: string;
  tRelMs: number;
  method: string;
  path: string;
  status: number | null;
  serverMs: number | null;
}>) {
  console.log(
    `  ${String(c.tRelMs).padStart(7)}ms [${c.phase}] ${c.method} ${c.path} -> ${c.status} srv=${c.serverMs}ms`,
  );
}
