/**
 * L3-ADMISSION 臂状态校验（RESEARCH ONLY，协议 §10 L3-ADMISSION）。
 *
 * 在每 run driver 启动前/结束后判定 API 进程实际运行的臂：
 *   - 进程级：/proc/<pid>/environ 实测 LOGIN_ADMISSION（不凭 .env 猜测）；
 *   - 行为级：GET /api/research/capacity（admin 会话，API 直连，不经 nginx
 *     测量路径）快照中 loginAdmission 字段——A 臂（冻结 SHA 产物）无此字段，
 *     B 臂（dist-l3 + LOGIN_ADMISSION=1）有 config{permits,queueCapacity,waitBudgetMs}。
 *
 * 用法： tsx l3-arm-check.ts --pid=<apiPid> --arm=a|b --out=<file> [--expect-k=4 --expect-q=189 --expect-w=5000]
 * 退出码 0 = 校验通过（结果 JSON 另写 --out）；非 0 = 臂状态与预期不符（run 编排应判失败）。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { Client } from "../../harness/lib/http.js";
import { ADMIN, API_BASE_URL, PUBLIC_ORIGIN, args } from "../../harness/lib/config.js";

const pid = Number(args().pid);
const arm = args().arm;
const out = args().out ?? "arm-check.json";
const expectK = Number(args()["expect-k"] ?? 4);
const expectQ = Number(args()["expect-q"] ?? 189);
const expectW = Number(args()["expect-w"] ?? 5000);

if (!Number.isInteger(pid) || pid <= 1 || (arm !== "a" && arm !== "b")) {
  console.error("[l3-arm-check] FATAL: --pid=<int> --arm=a|b required");
  process.exit(2);
}

// 进程级证据：/proc/<pid>/environ 实测（NUL 分隔）
let procEnvLoginAdmission: string | null = null;
let procEnvPermits: string | null = null;
let procEnvQueue: string | null = null;
let procEnvWaitMs: string | null = null;
try {
  const env = readFileSync(`/proc/${pid}/environ`, "utf8");
  // environ 为 NUL 分隔的 KEY=VALUE 串（无换行，^/m 不可用）——按 \0 切分精确取
  const get = (k: string): string | null => {
    for (const entry of env.split("\x00")) {
      if (entry.startsWith(`${k}=`)) return entry.slice(k.length + 1);
    }
    return null;
  };
  procEnvLoginAdmission = get("LOGIN_ADMISSION");
  procEnvPermits = get("LOGIN_ADMISSION_PERMITS");
  procEnvQueue = get("LOGIN_ADMISSION_QUEUE_CAPACITY");
  procEnvWaitMs = get("LOGIN_ADMISSION_WAIT_BUDGET_MS");
} catch {
  procEnvLoginAdmission = "unreadable";
}

// 行为级证据：研究快照
const admin = new Client({ baseUrl: API_BASE_URL, id: "l3-arm-check", origin: PUBLIC_ORIGIN });
const loginRes = await admin.login(ADMIN.username, ADMIN.password);
let snapshot: Record<string, unknown> | null = null;
let snapErr: string | null = null;
if (loginRes.status === 200) {
  const res = await admin.json("GET", "/api/research/capacity");
  if (res.status === 200) snapshot = res.parsed as Record<string, unknown>;
  else snapErr = `research snapshot HTTP ${res.status}`;
} else {
  snapErr = `admin login HTTP ${loginRes.status}`;
}
await admin.close();

const adm = (snapshot?.loginAdmission ?? null) as Record<string, unknown> | null;
const result = {
  at: new Date().toISOString(),
  pid,
  expectedArm: arm,
  procEnv: {
    LOGIN_ADMISSION: procEnvLoginAdmission,
    LOGIN_ADMISSION_PERMITS: procEnvPermits,
    LOGIN_ADMISSION_QUEUE_CAPACITY: procEnvQueue,
    LOGIN_ADMISSION_WAIT_BUDGET_MS: procEnvWaitMs,
  },
  snapshot: adm
    ? { config: adm.config, counters: adm.counters, peaks: adm.peaks, live: adm.live }
    : null,
  snapshotError: snapErr,
  verdict: null as string | null,
};

let ok = true;
const problems: string[] = [];
if (arm === "b") {
  if (procEnvLoginAdmission !== "1") {
    ok = false;
    problems.push(`proc LOGIN_ADMISSION=${procEnvLoginAdmission} (expected 1)`);
  }
  const cfg = adm?.config as Record<string, number> | undefined;
  if (!cfg) {
    ok = false;
    problems.push("snapshot loginAdmission missing (A build or gate not armed)");
  } else {
    if (cfg.permits !== expectK || cfg.queueCapacity !== expectQ || cfg.waitBudgetMs !== expectW) {
      ok = false;
      problems.push(`snapshot config ${JSON.stringify(cfg)} != K${expectK}/Q${expectQ}/W${expectW}`);
    }
  }
} else {
  if (procEnvLoginAdmission !== null) {
    ok = false;
    problems.push(`proc LOGIN_ADMISSION=${procEnvLoginAdmission} (expected unset)`);
  }
  if (adm !== null) {
    ok = false;
    problems.push("snapshot loginAdmission present on A arm (wrong build or env)");
  }
}
result.verdict = ok ? "OK" : `MISMATCH: ${problems.join("; ")}`;
writeFileSync(out, JSON.stringify(result, null, 2) + "\n");
console.log(`[l3-arm-check] arm=${arm} verdict=${result.verdict}`);
process.exit(ok ? 0 : 1);
