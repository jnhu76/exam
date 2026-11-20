/**
 * #900/#1021 L3 B 臂 — real-Nginx two-client disconnect barrier runner
 * (RESEARCH ONLY; protocol §10 L3-ADMISSION, mechanism test — §9.6:
 * ≥5 repetitions per case, run separately from performance sampling).
 *
 * Topology (fully ISOLATED from the A-arm measurement path — never touches
 * the campaign's exam-cap-nginx / port 3300/8080 / exam_550_e2e / apps/api
 * `dist`):
 *   [runner raw sockets, distinct 127.0.0.x source IPs]
 *     → nginx:1.30.5-trixie container exam-cap-nginx-l3 (127.0.0.1:8081,
 *       network exam-cap-net-l3 172.28.11.0/24)
 *     → host-native API built from THIS experiment branch (dist-l3,
 *       APP_MODE=production, CAPACITY_RESEARCH=1, LOGIN_ADMISSION=1)
 *     → dedicated name-guarded research DB exam_550_l3_barrier.
 *
 * Determinism: the API runs a CAPACITY_RESEARCH-gated hold failpoint
 * (armed via POST /api/research/capacity/login-admission-hold, capability-
 * gated) that parks an ADMITTED login BEFORE any lookup/hash. Every step
 * below waits for the observed server state (event ring via the research
 * snapshot) before acting — no wall-clock races.
 *
 * Cases (each ×5):
 *   A 两客户端排队断连 — one admitted+held, one queued; the queued client's
 *     socket is destroyed AFTER the server observed it waiting; asserts: 0
 *     verify starts for the closer (label attribution), single settlement
 *     (enqueued→disconnected), the keeper completes the FULL original login
 *     (200 + cookie + login.success audit) after release.
 *   B 队满 — K=1, Q=4: 1 admitted+held, 4 queued, the 6th gets
 *     503 LOGIN_BUSY + integer Retry-After (never 401; no login.failure
 *     audit; no verify for the rejected).
 *   C 等待到期 — W=800ms session: queued waiters expire while the permit is
 *     held → 503 LOGIN_BUSY, Retry-After: 1, single settlement each.
 *
 * Usage (cwd-independent; protocol §13 cmd.sh contract):
 *   pnpm -C /home/hoo/Source/exam/.wt-capacity --filter @exam/db exec tsx \
 *     /home/hoo/Source/exam/.wt-capacity/docs/research/exam-cdp-watt-runtime-capacity/harness/l3-barrier-nginx.ts
 */
import { execSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import net from "node:net";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createDatabase } from "../../../../../packages/db/src/database.js";
import { migratePostgres } from "../../../../../packages/db/src/postgres.js";
import { seed } from "../../../../../packages/db/src/seed.js";
import { hashPassword } from "../../../../../packages/auth/src/password.js";

const WORKTREE = "/home/hoo/Source/exam/.wt-capacity";
const RESEARCH = `${WORKTREE}/docs/research/exam-cdp-watt-runtime-capacity`;
const EVIDENCE = `${RESEARCH}/evidence/L3`;
const API_DIR = `${WORKTREE}/apps/api`;

// Isolated resources (never the A-arm's 3300/8080/exam-cap-nginx/exam_550_e2e).
const API_PORT = 3310;
const NGINX_PORT = 8081;
const NET_NAME = "exam-cap-net-l3";
const NET_SUBNET = "172.28.11.0/24";
const NGINX_CONTAINER = "exam-cap-nginx-l3";
const NGINX_IMAGE = "nginx:1.30.5-trixie";
const RUN_DB = "exam_550_l3_barrier";
const MAINT_URL = "postgres://exam:exam@127.0.0.1:5432/postgres";
const RUN_DB_URL = `postgres://exam:exam@127.0.0.1:5432/${RUN_DB}`;
const PUBLIC_ORIGIN = `http://127.0.0.1:${NGINX_PORT}`;

const REPS = Number(process.env.L3_BARRIER_REPS ?? 5);

interface AdmissionEvent {
  at: number;
  requestId: string;
  label: string;
  event: string;
}
interface GateSnapshot {
  config: {
    permits: number;
    queueCapacity: number;
    waitBudgetMs: number;
    retryAfterSeconds: number;
  };
  counters: Record<string, number>;
  peaks: { waiting: number; permits: number };
  live: {
    waiting: number;
    permits: number;
    activeTimers: number;
    activeDisconnectWatchers: number;
  };
  events: AdmissionEvent[];
}

function log(msg: string): void {
  process.stdout.write(`[l3-barrier] ${msg}\n`);
}
function fail(msg: string): never {
  throw new Error(`[l3-barrier] FATAL: ${msg}`);
}

function sh(cmd: string): string {
  return execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

// ── R0 four-step DB safety (AGENTS.md §6) ───────────────────────────────
if (!RUN_DB.startsWith("exam_550")) fail(`refusing non-run db ${RUN_DB}`);
async function freshRunDatabase() {
  log(`rebuilding name-guarded research DB ${RUN_DB}`);
  const maint = await createDatabase(MAINT_URL);
  try {
    await maint.sql.unsafe(`DROP DATABASE IF EXISTS ${RUN_DB} WITH (FORCE)`);
    await maint.sql.unsafe(`CREATE DATABASE ${RUN_DB}`);
  } finally {
    await maint.sql.end();
  }
  const conn = await createDatabase(RUN_DB_URL);
  // Step ②/③: prove the actual target by querying it.
  const probe = await conn.sql.unsafe(`SELECT current_database() AS db`);
  const dbName = (probe[0] as { db: string }).db;
  if (dbName !== RUN_DB) fail(`connected to ${dbName}, expected ${RUN_DB}`);
  log(`confirmed target database: ${dbName}`);
  await migratePostgres(conn.db, {});
  await seed(conn.db, hashPassword);
  return conn;
}

type Sql = Awaited<ReturnType<typeof createDatabase>>["sql"];

/** Fixture creation only (never a measured path): Teacher user + primary assignment. */
async function createBarrierUser(
  sql: Sql,
  orgId: string,
  username: string,
  password: string,
): Promise<string> {
  const id = randomUUID();
  const passwordHash = await hashPassword(password);
  await sql`
    INSERT INTO users (id, organization_id, username, password_hash, name, role, is_active, created_at, updated_at)
    VALUES (${id}, ${orgId}, ${username}, ${passwordHash}, ${username + " name"}, 'Teacher', true, now(), now())
  `;
  await sql`
    INSERT INTO user_role_assignments (id, organization_id, user_id, role, is_primary, is_active, created_at, updated_at)
    VALUES (${randomUUID()}, ${orgId}, ${id}, 'Teacher', true, true, now(), now())
  `;
  return id;
}

// ── API process lifecycle ───────────────────────────────────────────────
let apiProc: ReturnType<typeof spawn> | null = null;
const apiLogChunks: string[] = [];
function startApi(waitBudgetMs: number): void {
  if (apiProc) fail("API already running");
  const jwt = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
  apiLogChunks.push(
    `\n===== API session start (W=${waitBudgetMs}ms) ${new Date().toISOString()} =====\n`,
  );
  apiProc = spawn("node", ["dist-l3/server.js"], {
    cwd: API_DIR,
    env: {
      ...process.env,
      APP_MODE: "production",
      NODE_ENV: "production",
      APP_PORT: String(API_PORT),
      HOST: "0.0.0.0",
      DATABASE_URL: RUN_DB_URL,
      JWT_SECRET: jwt,
      CORS_ORIGIN: PUBLIC_ORIGIN,
      PUBLIC_WEB_ORIGIN: PUBLIC_ORIGIN,
      REDIS_URL: "redis://127.0.0.1:6379",
      REDIS_MODE: "optional",
      CAPACITY_RESEARCH: "1",
      TRUSTED_PROXY_CIDRS: `${NET_SUBNET},127.0.0.1`,
      LOGIN_ADMISSION: "1",
      LOGIN_ADMISSION_PERMITS: "1",
      LOGIN_ADMISSION_QUEUE_CAPACITY: "4",
      LOGIN_ADMISSION_WAIT_BUDGET_MS: String(waitBudgetMs),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  apiProc.stdout?.on("data", (c) => apiLogChunks.push(String(c)));
  apiProc.stderr?.on("data", (c) => apiLogChunks.push(String(c)));
}
async function waitApiHealthy(): Promise<void> {
  for (let i = 0; i < 90; i++) {
    if (apiProc?.exitCode !== null) {
      fail(`API exited during startup:\n${apiLogChunks.join("").slice(-2000)}`);
    }
    try {
      const r = await httpGet(
        `http://127.0.0.1:${API_PORT}/api/health`,
        "127.0.0.1",
      );
      if (r.status === 200) return;
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  fail("API not healthy in 45s");
}
async function stopApi(): Promise<void> {
  const proc = apiProc;
  apiProc = null;
  if (!proc || proc.exitCode !== null) return;
  proc.kill("SIGINT");
  for (let i = 0; i < 60; i++) {
    if (proc.exitCode !== null) return;
    await sleep(500);
  }
  proc.kill("SIGKILL");
  await sleep(500);
}

// ── Nginx lifecycle (isolated names/network/ports) ──────────────────────
function startNginx(): void {
  try {
    sh(`docker network inspect ${NET_NAME}`);
  } catch {
    sh(`docker network create --subnet ${NET_SUBNET} ${NET_NAME}`);
  }
  try {
    sh(`docker rm -f ${NGINX_CONTAINER}`);
  } catch {
    // not present
  }
  sh(
    `docker run -d --name ${NGINX_CONTAINER} ` +
      `--network ${NET_NAME} --ip 172.28.11.2 ` +
      `--add-host host.docker.internal:host-gateway ` +
      `-p 127.0.0.1:${NGINX_PORT}:80 ` +
      `-v ${RESEARCH}/harness/nginx/l3-web.conf:/etc/nginx/conf.d/default.conf:ro ` +
      NGINX_IMAGE,
  );
}
function stopNginx(): void {
  try {
    sh(`docker rm -f ${NGINX_CONTAINER}`);
    sh(`docker network rm ${NET_NAME}`);
  } catch {
    // best-effort teardown
  }
}

// ── Raw HTTP over distinct loopback source IPs ──────────────────────────
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface HttpResult {
  status: number;
  headers: Record<string, string>;
  body: string;
}
function httpRequest(
  method: "GET" | "POST",
  url: string,
  localAddr: string,
  body: string | null,
  cookie?: string,
): { done: Promise<HttpResult>; destroy: () => void } {
  const u = new URL(url);
  const sock = net.connect({
    port: Number(u.port),
    host: u.hostname,
    localAddress: localAddr,
  });
  const done = new Promise<HttpResult>((resolve, reject) => {
    const chunks: Buffer[] = [];
    sock.on("data", (c) => chunks.push(c));
    sock.on("error", reject);
    sock.on("close", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const headEnd = raw.indexOf("\r\n\r\n");
      if (headEnd === -1) {
        reject(new Error(`no HTTP head: ${raw.slice(0, 120)}`));
        return;
      }
      const [statusLine, ...headerLines] = raw.slice(0, headEnd).split("\r\n");
      const headers: Record<string, string> = {};
      for (const line of headerLines) {
        const idx = line.indexOf(":");
        if (idx > 0) {
          headers[line.slice(0, idx).trim().toLowerCase()] = line
            .slice(idx + 1)
            .trim();
        }
      }
      resolve({
        status: Number((statusLine ?? "").split(" ")[1]),
        headers,
        body: raw.slice(headEnd + 4),
      });
    });
  });
  done.catch(() => undefined);
  sock.on("connect", () => {
    const lines = [
      `${method} ${u.pathname} HTTP/1.1`,
      `Host: ${u.host}`,
      "Connection: close",
    ];
    if (cookie) lines.push(`Cookie: ${cookie}`);
    if (body !== null) {
      lines.push("Content-Type: application/json");
      // Production CSRF origin enforcement applies to unsafe methods; send
      // the canonical public origin exactly like the SPA does.
      lines.push(`Origin: ${u.origin}`);
      lines.push(`Content-Length: ${Buffer.byteLength(body)}`);
    }
    sock.write(lines.join("\r\n") + "\r\n\r\n" + (body ?? ""));
  });
  return { done, destroy: () => sock.destroy() };
}

async function httpGet(
  url: string,
  localAddr: string,
  cookie?: string,
): Promise<HttpResult> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const attempt = httpRequest("GET", url, localAddr, null, cookie);
    try {
      return await attempt.done;
    } catch (err) {
      if (Date.now() > deadline) throw err;
      await sleep(300);
    }
  }
}

/**
 * AS-BUILT (T-SHARED limitation, protocol §2.2): in this barrier topology
 * the published-port hop collapses every client source IP to the vpnkit
 * bridge gateway (nginx $remote_addr = 172.28.11.1 for all — verified via
 * audit_logs.ip_address), so ALL logins share the production login limiter
 * budget (10/min). The limiter is NEVER disabled (protocol §0.1); instead
 * this pacer waits for rolling-window budget before each login, exactly as
 * a shared-egress cohort must.
 */
const loginTimestamps: number[] = [];
function loginsInWindow(): number {
  const now = Date.now();
  while (
    loginTimestamps.length > 0 &&
    now - (loginTimestamps[0] as number) > 60_000
  ) {
    loginTimestamps.shift();
  }
  return loginTimestamps.length;
}
/** Ensures `need` login slots are free in the rolling window BEFORE a rep. */
async function limiterReserve(need: number): Promise<void> {
  while (loginsInWindow() > 10 - need) {
    await sleep(500);
  }
}
async function limiterPace(): Promise<void> {
  while (loginsInWindow() >= 10) {
    await sleep(500);
  }
}
async function login(localAddr: string, username: string, password: string) {
  await limiterPace();
  loginTimestamps.push(Date.now());
  return httpRequest(
    "POST",
    `${PUBLIC_ORIGIN}/api/auth/login`,
    localAddr,
    JSON.stringify({ username, password }),
  );
}

// ── Research snapshot + hold control (capability-gated) ─────────────────
let adminCookie = "";
async function snapshot(): Promise<{
  loginAdmission: GateSnapshot | null;
  sql: { total: number };
}> {
  const r = await httpGet(
    `${PUBLIC_ORIGIN}/api/research/capacity`,
    "127.0.0.50",
    adminCookie,
  );
  if (r.status !== 200) fail(`research snapshot ${r.status}: ${r.body}`);
  return JSON.parse(r.body) as {
    loginAdmission: GateSnapshot | null;
    sql: { total: number };
  };
}
async function holdControl(
  action: "arm" | "disarm" | "release",
): Promise<void> {
  const r = await httpRequest(
    "POST",
    `${PUBLIC_ORIGIN}/api/research/capacity/login-admission-hold`,
    "127.0.0.50",
    JSON.stringify({ action, count: 1 }),
    adminCookie,
  ).done;
  if (r.status !== 200) fail(`hold control ${action} → ${r.status}: ${r.body}`);
}

/** State-driven wait: polls the observed server event ring (no wall races). */
async function waitGate(
  predicate: (snap: GateSnapshot) => boolean,
  timeoutMs = 10_000,
): Promise<GateSnapshot> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const snap = (await snapshot()).loginAdmission;
    if (!snap) fail("loginAdmission missing from research snapshot");
    if (predicate(snap)) return snap;
    if (Date.now() > deadline) {
      fail(
        `gate condition not met in ${timeoutMs}ms; last live=${JSON.stringify(snap.live)} counters=${JSON.stringify(snap.counters)} events=${JSON.stringify(snap.events.slice(-12))}`,
      );
    }
    await sleep(15);
  }
}

// ── Main ────────────────────────────────────────────────────────────────
interface RepRecord {
  rep: number;
  case: string;
  ok: boolean;
  details: Record<string, unknown>;
}

async function main() {
  const runId = `L3-BARRIER-NGINX-${new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "")}`;
  const runDir = join(EVIDENCE, runId);
  mkdirSync(runDir, { recursive: true });
  const reps: RepRecord[] = [];
  const startedAt = new Date().toISOString();

  // A-isolation witness: the A-arm topology must stay untouched throughout.
  const aWitnessBefore = sh(
    `docker ps --filter name=exam-cap-nginx --format '{{.Names}} {{.Status}}' || true`,
  ).trim();
  let aApiHealthBefore = "down";
  try {
    const r = await httpGet("http://127.0.0.1:3300/api/health", "127.0.0.1");
    aApiHealthBefore = `http ${r.status}`;
  } catch {
    aApiHealthBefore = "unreachable";
  }
  log(
    `A-isolation witness (before): nginx=[${aWitnessBefore}] api3300=${aApiHealthBefore}`,
  );

  // Preflight: our isolated ports must be free.
  for (const port of [API_PORT, NGINX_PORT]) {
    const occupied = sh(`ss -ltnH '( sport = :${port} )' | wc -l`).trim();
    if (Number(occupied) > 0) fail(`port ${port} already in use`);
  }

  type Db = Awaited<ReturnType<typeof createDatabase>>;
  let conn: Db;
  try {
    conn = await freshRunDatabase();
  } catch (err) {
    fail(`DB lifecycle failed: ${String(err)}`);
  }
  const orgRows =
    (await conn.sql`SELECT id FROM organizations LIMIT 1`) as Array<{
      id: string;
    }>;
  const orgId = orgRows[0]?.id as string;
  const uHold = await createBarrierUser(
    conn.sql,
    orgId,
    "l3-barrier-hold",
    "pw-hold-real",
  );
  const uClose = await createBarrierUser(
    conn.sql,
    orgId,
    "l3-barrier-close",
    "pw-close-any",
  );

  startNginx();
  try {
    // ── Session 1 (W=15000): cases A (disconnect) + B (queue full) ──
    startApi(15000);
    await waitApiHealthy();
    for (let i = 0; i < 30; i++) {
      try {
        const r = await httpGet(`${PUBLIC_ORIGIN}/api/health`, "127.0.0.50");
        if (r.status === 200) break;
      } catch {
        /* retry */
      }
      await sleep(1000);
    }
    await limiterReserve(1);
    const adminLogin = await (
      await login("127.0.0.50", "admin", "admin123")
    ).done;
    if (adminLogin.status !== 200) {
      fail(
        `admin login ${adminLogin.status}: ${adminLogin.body.slice(0, 300)}`,
      );
    }
    adminCookie = (adminLogin.headers["set-cookie"] ?? "").split(";")[0];

    // Case A × REPS: two clients, one disconnects while queued.
    for (let rep = 0; rep < REPS; rep++) {
      const details: Record<string, unknown> = {};
      const t0 = Date.now();
      await limiterReserve(2); // keeper + closer this rep
      const base = await snapshot();
      const gateBase = base.loginAdmission as GateSnapshot;
      const baseEventLen = gateBase.events.length;
      const repEvents = (snap: GateSnapshot) => snap.events.slice(baseEventLen);
      const sqlBefore = base.sql.total;
      await holdControl("arm");
      const keeperAddr = `127.0.0.${10 + rep * 2}`;
      const closerAddr = `127.0.0.${11 + rep * 2}`;
      const keeper = await login(keeperAddr, "l3-barrier-hold", "pw-hold-real");
      const admittedSnap = await waitGate(
        (s) => s.counters.admitted === gateBase.counters.admitted + 1,
      );
      // Held admitted login: permit 1, ZERO verify starts, no queue.
      if (
        admittedSnap.counters.verifyStarts !== gateBase.counters.verifyStarts
      ) {
        fail("held login started a verify before release");
      }
      const closer = await login(
        closerAddr,
        "l3-barrier-close",
        "pw-close-any",
      );
      await Promise.race([
        waitGate((s) =>
          s.events.some(
            (e) => e.label === "l3-barrier-close" && e.event === "enqueued",
          ),
        ),
        closer.done.then((r) =>
          fail(
            `closer got HTTP ${r.status} before enqueuing: ${r.body.slice(0, 200)}`,
          ),
        ),
      ]);
      details.queuedAtMs = Date.now() - t0;
      // The queued client occupies no permit and starts no verify.
      const preClose = (await snapshot()).loginAdmission as GateSnapshot;
      if (
        preClose.events.some(
          (e) => e.label === "l3-barrier-close" && e.event === "verify_start",
        )
      ) {
        fail("queued closer started a verify");
      }
      closer.destroy();
      const settled = await waitGate(
        (s) => s.counters.disconnected === gateBase.counters.disconnected + 1,
      );
      const closerEvents = repEvents(settled)
        .filter((e) => e.label === "l3-barrier-close")
        .map((e) => e.event);
      if (
        JSON.stringify(closerEvents) !==
        JSON.stringify(["enqueued", "disconnected"])
      ) {
        fail(
          `closer events ${JSON.stringify(closerEvents)} (settle-once violated)`,
        );
      }
      if (
        settled.events.some(
          (e) => e.label === "l3-barrier-close" && e.event === "verify_start",
        )
      ) {
        fail("closer started a hash after disconnect (must be 0)");
      }
      details.closerSettledAtMs = Date.now() - t0;
      await holdControl("release");
      const keeperResp = await keeper.done;
      details.keeperStatus = keeperResp.status;
      if (keeperResp.status !== 200) {
        fail(
          `keeper login failed: ${keeperResp.status} ${keeperResp.body.slice(0, 200)}`,
        );
      }
      if (!(keeperResp.headers["set-cookie"] ?? "").includes("auth-token=")) {
        fail("keeper login missing session cookie");
      }
      const finished = await waitGate(
        (s) =>
          s.counters.verifyStarts === gateBase.counters.verifyStarts + 1 &&
          s.counters.verifyEnds === gateBase.counters.verifyEnds + 1 &&
          s.counters.released === gateBase.counters.released + 1,
      );
      const holdEvents = repEvents(finished)
        .filter((e) => e.label === "l3-barrier-hold")
        .map((e) => e.event);
      if (
        !holdEvents.includes("admitted") ||
        !holdEvents.includes("verify_start") ||
        !holdEvents.includes("verify_end") ||
        !holdEvents.includes("released")
      ) {
        fail(`keeper lifecycle incomplete: ${JSON.stringify(holdEvents)}`);
      }
      if (
        finished.live.waiting !== 0 ||
        finished.live.permits !== 0 ||
        finished.live.activeTimers !== 0 ||
        finished.live.activeDisconnectWatchers !== 0
      ) {
        fail(`residual live state: ${JSON.stringify(finished.live)}`);
      }
      const sqlAfter = (await snapshot()).sql.total;
      details.sqlDeltaDuringCase = sqlAfter - sqlBefore;
      await holdControl("disarm");
      // Audit oracle (direct DB, not via API).
      const successRows = (await conn.sql`
        SELECT target_id FROM audit_logs WHERE action = 'login.success'
      `) as Array<{ target_id: string }>;
      if (!successRows.some((row) => row.target_id === uHold)) {
        fail("no login.success audit row for keeper (original semantics)");
      }
      const closeRows = (await conn.sql`
        SELECT count(*)::int AS n FROM audit_logs WHERE target_id = ${uClose}
      `) as Array<{ n: number }>;
      if ((closeRows[0] as { n: number }).n > 0) {
        fail(
          `closer produced ${(closeRows[0] as { n: number }).n} audit rows (must be 0)`,
        );
      }
      details.totalMs = Date.now() - t0;
      reps.push({ rep, case: "A-disconnect", ok: true, details });
      log(
        `case A rep ${rep + 1}/${REPS} ok (${details.totalMs}ms, sqlΔ=${details.sqlDeltaDuringCase})`,
      );
    }

    // Case B × REPS: queue full → immediate 503 LOGIN_BUSY.
    for (let rep = 0; rep < REPS; rep++) {
      const details: Record<string, unknown> = {};
      await limiterReserve(6); // keeper + 4 waiters + over this rep
      const t0 = Date.now();
      const base = await snapshot();
      const gateBase = base.loginAdmission as GateSnapshot;
      await holdControl("arm");
      const keeper = await login(
        `127.0.0.${60 + rep * 6}`,
        "l3-barrier-hold",
        "pw-hold-real",
      );
      await waitGate(
        (s) => s.counters.admitted === gateBase.counters.admitted + 1,
      );
      // Q=4: four waiters fill the queue; the 6th concurrent login is rejected.
      const waiters: Array<{ done: Promise<HttpResult>; destroy: () => void }> =
        [];
      for (const i of [1, 2, 3, 4]) {
        waiters.push(
          await login(
            `127.0.0.${60 + rep * 6 + i}`,
            "l3-barrier-close",
            "pw-close-any",
          ),
        );
      }
      await waitGate((s) => s.live.waiting === 4);
      const over = await (
        await login(
          `127.0.0.${60 + rep * 6 + 5}`,
          "l3-barrier-close",
          "pw-close-any",
        )
      ).done;
      details.overStatus = over.status;
      details.retryAfter = over.headers["retry-after"];
      if (over.status !== 503) fail(`queue-full status ${over.status}`);
      if (!/^\d+$/.test(over.headers["retry-after"] ?? "")) {
        fail(`retry-after not integer seconds: ${over.headers["retry-after"]}`);
      }
      const overBody = JSON.parse(over.body) as { error: { code: string } };
      details.overCode = overBody.error.code;
      if (overBody.error.code !== "LOGIN_BUSY") {
        fail(
          `queue-full code ${overBody.error.code} (must be LOGIN_BUSY, never a credentials error)`,
        );
      }
      const rejectedSnap = await waitGate(
        (s) => s.counters.queueFull === gateBase.counters.queueFull + 1,
      );
      if (
        rejectedSnap.events.some(
          (e) => e.label === "l3-barrier-close" && e.event === "verify_start",
        )
      ) {
        fail("a queued/rejected login started a verify");
      }
      // Clean the queue: destroy all waiter sockets (disconnect settlement).
      for (const w of waiters) w.destroy();
      await waitGate(
        (s) => s.counters.disconnected >= gateBase.counters.disconnected + 4,
      );
      await holdControl("release");
      const keeperResp = await keeper.done;
      if (keeperResp.status !== 200)
        fail(`keeper failed: ${keeperResp.status}`);
      await waitGate((s) => s.live.permits === 0 && s.live.waiting === 0);
      await holdControl("disarm");
      details.totalMs = Date.now() - t0;
      reps.push({ rep, case: "B-queue-full", ok: true, details });
      log(
        `case B rep ${rep + 1}/${REPS} ok (${details.totalMs}ms, over=${over.status} ${overBody.error.code} retry-after=${details.retryAfter})`,
      );
    }

    await stopApi();

    // ── Session 2 (W=800): case C — wait expiry under a held permit ──
    startApi(800);
    await waitApiHealthy();
    for (let i = 0; i < 30; i++) {
      try {
        const r = await httpGet(`${PUBLIC_ORIGIN}/api/health`, "127.0.0.50");
        if (r.status === 200) break;
      } catch {
        /* retry */
      }
      await sleep(1000);
    }
    await limiterReserve(1);
    const admin2 = await (await login("127.0.0.50", "admin", "admin123")).done;
    if (admin2.status !== 200) fail(`admin login (session2) ${admin2.status}`);
    adminCookie = (admin2.headers["set-cookie"] ?? "").split(";")[0];

    for (let rep = 0; rep < REPS; rep++) {
      const details: Record<string, unknown> = {};
      await limiterReserve(4); // keeper + 3 waiters this rep
      const t0 = Date.now();
      const base = await snapshot();
      const gateBase = base.loginAdmission as GateSnapshot;
      if (gateBase.config.retryAfterSeconds !== 1) {
        fail(
          `W=800 must yield Retry-After 1, got ${gateBase.config.retryAfterSeconds}`,
        );
      }
      await holdControl("arm");
      const keeper = await login(
        `127.0.0.${120 + rep * 4}`,
        "l3-barrier-hold",
        "pw-hold-real",
      );
      await waitGate(
        (s) => s.counters.admitted === gateBase.counters.admitted + 1,
      );
      const waiters: Array<{ done: Promise<HttpResult>; destroy: () => void }> =
        [];
      for (const i of [1, 2, 3]) {
        waiters.push(
          await login(
            `127.0.0.${120 + rep * 4 + i}`,
            "l3-barrier-close",
            "pw-close-any",
          ),
        );
      }
      await waitGate((s) => s.live.waiting === 3);
      // W=800ms elapses while the permit is held: all three waiters expire.
      const responses = await Promise.all(waiters.map((w) => w.done));
      details.waiterStatuses = responses.map((r) => r.status);
      for (const r of responses) {
        if (r.status !== 503) fail(`waiter expiry status ${r.status}`);
        if (Number(r.headers["retry-after"]) !== 1) {
          fail(`waiter retry-after ${r.headers["retry-after"]}`);
        }
        const b = JSON.parse(r.body) as { error: { code: string } };
        if (b.error.code !== "LOGIN_BUSY") {
          fail(`waiter expiry code ${b.error.code}`);
        }
      }
      const expired = await waitGate(
        (s) => s.counters.timeout >= gateBase.counters.timeout + 3,
      );
      const timeoutEvents = expired.events.filter((e) => e.event === "timeout");
      if (timeoutEvents.length < gateBase.counters.timeout + 3) {
        fail("timeout settlements missing");
      }
      if (
        expired.events.some(
          (e) => e.label === "l3-barrier-close" && e.event === "verify_start",
        )
      ) {
        fail("expired waiter started a verify");
      }
      await holdControl("release");
      const keeperResp = await keeper.done;
      if (keeperResp.status !== 200)
        fail(`keeper failed: ${keeperResp.status}`);
      await waitGate(
        (s) =>
          s.live.permits === 0 &&
          s.live.waiting === 0 &&
          s.live.activeTimers === 0,
      );
      await holdControl("disarm");
      details.totalMs = Date.now() - t0;
      reps.push({ rep, case: "C-wait-expiry", ok: true, details });
      log(
        `case C rep ${rep + 1}/${REPS} ok (${details.totalMs}ms, statuses=${JSON.stringify(details.waiterStatuses)})`,
      );
    }
  } finally {
    await stopApi();
    stopNginx();
    await conn.sql.end().catch(() => undefined);
  }

  // A-isolation witness after the run.
  const aWitnessAfter = sh(
    `docker ps --filter name=exam-cap-nginx --format '{{.Names}} {{.Status}}' || true`,
  ).trim();
  let aApiHealthAfter = "unreachable";
  try {
    const r = await httpGet("http://127.0.0.1:3300/api/health", "127.0.0.1");
    aApiHealthAfter = `http ${r.status}`;
  } catch {
    aApiHealthAfter = "unreachable";
  }
  log(
    `A-isolation witness (after): nginx=[${aWitnessAfter}] api3300=${aApiHealthAfter}`,
  );

  const okCases = reps.filter((r) => r.ok).length;
  const evidence = {
    runId,
    startedAt,
    finishedAt: new Date().toISOString(),
    branch: "research/capacity-900-1021-l3-admission",
    topology: {
      nginxContainer: NGINX_CONTAINER,
      nginxPort: NGINX_PORT,
      network: NET_NAME,
      apiPort: API_PORT,
      apiBuild: "apps/api/dist-l3 (experiment branch)",
      database: RUN_DB,
      sourceIps: "distinct 127.0.0.x per client (T-DIRECT discipline)",
    },
    aIsolation: {
      before: { nginx: aWitnessBefore, api3300: aApiHealthBefore },
      after: { nginx: aWitnessAfter, api3300: aApiHealthAfter },
    },
    reps,
    summary: { total: reps.length, ok: okCases, repsPerCase: REPS },
  };
  writeFileSync(
    join(runDir, "l3-barrier-nginx.json"),
    JSON.stringify(evidence, null, 2),
  );
  writeFileSync(join(runDir, "api.log"), apiLogChunks.join(""));
  log(
    `PASS: ${okCases}/${reps.length} barrier reps green; evidence → ${join(runDir, "l3-barrier-nginx.json")}`,
  );
}

main().catch((err) => {
  process.stderr.write(`${String(err)}\n`);
  process.exit(1);
});
