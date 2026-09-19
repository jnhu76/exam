/**
 * #550 rate-limit / deployment-topology runner (#546 contract, RESEARCH ONLY).
 *
 * States (see 01-topology.md):
 *   direct    — per-candidate DISTINCT loopback source IPs; production limiter
 *               defaults; per-IP independence expected (zero 429) + a labelled
 *               NON_CANONICAL per-IP budget-isolation probe.
 *   nat       — ALL candidates share 127.0.0.1; login 429 onset against the
 *               login route's 10/min budget + steady onset vs 100/min.
 *   proxy     — in-harness reverse proxy (XFF append) + TRUSTED_PROXY_CIDRS
 *               self-calibrated from live probe requests (the proxy's
 *               observed egress peers); distinct per-client identity
 *               restored; spoof-negative probes.
 *   degraded  — reverse proxy WITHOUT TRUSTED_PROXY_CIDRS on the API:
 *               identity collapses to the proxy socket IP
 *               (DEGRADED_BY_CONFIG).
 *
 * Reverse-proxy note: Docker Desktop (WSL2) erases host→container client
 * source IPs (published-port userland proxy NAT, measured) and its host
 * networking is not effective in this rig, so nginx-in-container cannot see
 * real client addresses. The topology under test is the API's trusted-proxy
 * handling (#546), so the harness ships a minimal Node reverse proxy on the
 * host that faithfully reproduces nginx's `$proxy_add_x_forwarded_for` while
 * seeing the drivers' real source addresses.
 *
 * Run from anywhere in the repo (paths derive from this file's location):
 *   HARNESS=$(git rev-parse --show-toplevel)/docs/research/exam-550-final-capacity-reproof-1/harness
 *   pnpm --filter @exam/db exec tsx "$HARNESS/run-topology.ts" \
 *     [--states=direct:20,direct:50,direct:100,nat:20,nat:50,degraded:20,proxy:20]
 */
import * as http from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import {
  API_ORIGIN,
  API_PORT,
  BASE_SHA,
  LOGS_DIR,
  RESULTS_DIR,
  RUN_DB_URL,
  args,
} from "./lib/config.js";
import { auditIps, freshRunDatabase, seedCandidates } from "./lib/db.js";
import { Client, JsonlWriter, sleep } from "./lib/http.js";
import {
  loginAdmin,
  startApi,
  startObservers,
  stopActiveApi,
  waitReady,
} from "./lib/runtime.js";
import { sampleFrom, summarizePhase } from "./lib/summary.js";

const PROXY_PORT = 8210;
const API_BASE = `http://127.0.0.1:${API_PORT}`;
const PROXY_BASE = `http://127.0.0.1:${PROXY_PORT}`;

let proxyServer: http.Server | null = null;

/**
 * Minimal host-side reverse proxy: binds 127.0.0.1:PROXY_PORT (so it sees
 * the drivers' real loopback source addresses) and forwards to the API,
 * appending the client peer to X-Forwarded-For — the same semantics as
 * nginx's `$proxy_add_x_forwarded_for`.
 */
function proxyStart(): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = http.createServer((req, res) => {
      const peer = req.socket.remoteAddress ?? "unknown";
      const prev = req.headers["x-forwarded-for"];
      const xff = prev === undefined ? peer : `${prev}, ${peer}`;
      const upstream = http.request(
        {
          host: "127.0.0.1",
          port: API_PORT,
          path: req.url,
          method: req.method,
          headers: { ...req.headers, "x-forwarded-for": xff },
        },
        (ur) => {
          res.writeHead(ur.statusCode ?? 502, ur.headers);
          ur.pipe(res);
        },
      );
      upstream.on("error", () => {
        if (!res.headersSent) res.writeHead(502);
        res.end();
      });
      req.pipe(upstream);
    });
    s.on("error", reject);
    s.listen(PROXY_PORT, "127.0.0.1", () => {
      proxyServer = s;
      resolve();
    });
  });
}

function proxyStop(): void {
  proxyServer?.close();
  proxyServer = null;
}

interface StateSpec {
  state: string;
  n: number;
}

interface RunRecord {
  runId: string;
  state: string;
  n: number;
  loginSuccess: number;
  login429: number;
  loginP: { p50: number; p95: number; p99: number; max: number };
  steady: Record<string, number> | null;
  distinctAuditIps: number;
  auditIpsSample: string[];
  probe?: Record<string, unknown>;
}

async function runState(
  spec: StateSpec,
  trustedCidrs: string | null,
  onLive?: () => Promise<Record<string, unknown> | void>,
): Promise<RunRecord> {
  const { state, n } = spec;
  const RUN_ID = `topo-${state}-S${n}-${new Date()
    .toISOString()
    .replace(/[:.]/g, "-")}`;
  const RESULTS_SUB = join(RESULTS_DIR, RUN_ID);
  mkdirSync(RESULTS_SUB, { recursive: true });
  const samples = new JsonlWriter(join(RESULTS_SUB, "samples.jsonl"));

  const conn = await freshRunDatabase();
  const orgRow = await conn.sql.unsafe(
    `SELECT id::text AS id FROM organizations ORDER BY created_at LIMIT 1`,
  );
  const orgId = orgRow[0].id as string;

  const api = startApi({
    mode: "production",
    dbUrl: RUN_DB_URL,
    runId: RUN_ID,
    extraEnv: trustedCidrs ? { TRUSTED_PROXY_CIDRS: trustedCidrs } : {},
  });
  await waitReady(api.baseUrl);
  let admin: Client | null = null;
  try {
    admin = await loginAdmin(api);
  } catch {
    admin = null;
  }

  const observer = await startObservers({
    runId: RUN_ID,
    resultsDir: RESULTS_SUB,
    runDbName: "exam_550_e2e",
    samplerDbUrl: RUN_DB_URL,
    api: {
      child: undefined as never,
      baseUrl: API_BASE,
      port: API_PORT,
      stop: async () => {},
    },
    adminClient: admin ?? undefined,
    hostSampling: false,
  });

  const base = {
    scenario_id: `topo-${state}`,
    run_id: RUN_ID,
    topology: state,
    n,
  };
  let phase = "setup";
  const record = (
    r: Awaited<ReturnType<Client["json"]>>,
    candidate: string,
    endpoint: string,
    errorClassOverride?: string,
  ): void => {
    const rec = sampleFrom(r, {
      ...base,
      candidate,
      endpoint,
      phase,
      retry_count: 0,
    });
    if (errorClassOverride) rec.error_class = errorClassOverride;
    samples.write(rec);
  };

  // Exam setup via canonical admin API (admin identity, budgets drain below).
  const course = await admin!.json("POST", "/api/courses", {
    name: `550-topo-${state}-${n}`,
    code: `550T-${Date.now()}`,
    description: "",
  });
  const courseId = (course.parsed as { id: string }).id;
  const q = await admin!.json("POST", "/api/questions", {
    courseId,
    type: "true_false",
    content: "Q0",
    standardAnswer: true,
    score: 10,
  });
  const questionId = (q.parsed as { id: string }).id;
  const exam = await admin!.json("POST", "/api/exams", {
    title: `550 topo ${state} S${n}`,
    description: "",
    courseId,
    timingMode: "timed_window",
    durationMinutes: 90,
    openAt: new Date(Date.now() - 3600_000).toISOString(),
    closeAt: new Date(Date.now() + 86_400_000).toISOString(),
    passingScore: 6,
    totalScore: 10,
    questionSelectionMode: "manual",
    questionIds: [questionId],
    resultPublicationMode: "immediate",
    controlFlags: { requireQueue: false },
    retakePolicy: "unlimited",
    scoreStrategy: "highest",
    maxAttempts: 1,
    interruptionTimePolicy: "strict",
  });
  const examId = (exam.parsed as { id: string }).id;
  await admin!.json("POST", `/api/exams/${examId}/publish`, {});
  const seeded = await seedCandidates(conn, {
    orgId,
    examId,
    count: n,
    prefix: `t${state}${n}`,
  });

  // Candidate clients. Direct + proxy states bind DISTINCT loopback source
  // IPs (real distinct socket peers); nat shares one. Proxy states route via
  // nginx; the collapse in `degraded` happens inside the API (request.ip),
  // not at nginx.
  const viaProxy = state === "proxy" || state === "degraded";
  const clients = seeded.usernames.map((u, i) => {
    const useAlias = state !== "nat";
    return new Client({
      baseUrl: viaProxy ? PROXY_BASE : API_BASE,
      id: `c${i}`,
      localAddress: useAlias ? `127.0.0.${(i % 250) + 2}` : undefined,
      timeoutMs: 15_000,
      origin: API_ORIGIN,
    });
  });

  // Drain setup limiter windows before the measured login burst.
  await sleep(60_000);

  phase = "LOGIN_BURST";
  observer.markPhase("LOGIN_BURST");
  const logins = await Promise.all(
    clients.map((c, i) => c.login(seeded.usernames[i], "pass-550-cap")),
  );
  logins.forEach((r, i) => record(r, clients[i].id, "POST /api/auth/login"));
  const loginOk = logins.filter((r) => r.status === 200).length;
  const login429 = logins.filter((r) => r.status === 429).length;
  const loginSummary = summarizePhase("LOGIN_BURST", logins, performance.now());

  // STEADY: starts (paced, setup-ish) then ~60s of save+heartbeat at a
  // realistic ~10-13 req/min/candidate pace; 429s are recorded, not retried.
  phase = "STEADY_STARTS";
  observer.markPhase("STEADY_STARTS");
  const attemptIds: (string | null)[] = [];
  for (let i = 0; i < clients.length; i++) {
    if (!clients[i].hasSession) {
      attemptIds.push(null);
      continue;
    }
    const r = await clients[i].json("POST", `/api/attempts/${examId}/start`);
    record(r, clients[i].id, "POST /api/attempts/:examId/start");
    attemptIds.push(
      r.status === 201 || r.status === 200
        ? (r.parsed as { id: string }).id
        : null,
    );
  }

  phase = "STEADY";
  observer.markPhase("STEADY");
  const deadline = performance.now() + 60_000;
  let stop = false;
  const loops = clients.map(async (c, i) => {
    if (!attemptIds[i]) return;
    await sleep((i % 10) * 130);
    // Per-question version bookkeeping (the save protocol's version scope).
    const versions = new Map<string, number>();
    let seq = 0;
    let nextSave = 0;
    let nextBeat = 0;
    while (!stop && performance.now() < deadline) {
      const now = performance.now();
      if (now >= nextSave) {
        seq += 1;
        const qid = questionId;
        const r = await c.json(
          "POST",
          `/api/attempts/${attemptIds[i]}/answers/${qid}`,
          {
            attemptId: attemptIds[i],
            questionId: qid,
            answer: seq % 2 === 0,
            clientSeq: seq,
            clientSavedAt: new Date().toISOString(),
            baseVersion: versions.get(qid) ?? 0,
          },
        );
        const body = (r.parsed ?? {}) as {
          accepted?: boolean;
          reason?: string;
          serverVersion?: number;
        };
        if (r.status === 200 && body.accepted === true) {
          versions.set(qid, body.serverVersion ?? 0);
          record(r, c.id, "POST /api/attempts/:id/answers/:qid");
        } else if (r.status === 200 && body.accepted === false) {
          versions.set(qid, body.serverVersion ?? 0);
          record(
            r,
            c.id,
            "POST /api/attempts/:id/answers/:qid",
            `save_rejected:${body.reason ?? "unknown"}`,
          );
        } else {
          record(
            r,
            c.id,
            "POST /api/attempts/:id/answers/:qid",
            `http_${r.status}`,
          );
        }
        nextSave = now + 6000 + Math.random() * 2000;
      }
      if (now >= nextBeat) {
        const r = await c.json(
          "POST",
          `/api/attempts/${attemptIds[i]}/heartbeat`,
        );
        record(r, c.id, "POST /api/attempts/:id/heartbeat");
        nextBeat = now + 20_000 + Math.random() * 5000;
      }
      await sleep(80);
    }
  });
  await sleep(60_000);
  stop = true;
  await Promise.allSettled(loops);

  // Audit-trail identity evidence (request.ip authority).
  const ips = await auditIps(conn, orgId);

  // NON_CANONICAL probes run while THIS state's API is still live (they need
  // real limiter verdicts); results land in the record's `probe` field.
  let probe: Record<string, unknown> | undefined;
  if (onLive) probe = (await onLive()) ?? undefined;

  const record_: RunRecord = {
    runId: RUN_ID,
    state,
    n,
    loginSuccess: loginOk,
    login429,
    loginP: {
      p50: loginSummary.p50,
      p95: loginSummary.p95,
      p99: loginSummary.p99,
      max: loginSummary.max,
    },
    steady: null,
    distinctAuditIps: ips.length,
    auditIpsSample: ips.slice(0, 12).map((x) => `${x.ip} x${x.n}`),
    probe,
  };
  writeFileSync(
    join(RESULTS_SUB, "summary.json"),
    JSON.stringify(
      { ...record_, note: "per-request raw in samples.jsonl" },
      null,
      2,
    ) + "\n",
  );
  await samples.flush();
  console.log(JSON.stringify(record_));

  await Promise.all(clients.map((c) => c.close()));
  if (admin) await admin.close();
  await observer.stop();
  await api.stop();
  await conn.sql.end();
  return record_;
}

/** NON_CANONICAL diagnostic: prove per-IP limiter budgets are independent.
 *
 * Uses POST /api/auth/login (route budget 10/min/IP, deterministic): a
 * 130-request burst from one loopback alias must 429 while a single request
 * from a different alias, sent at the same moment, must pass (401 — the
 * account does not exist). Caller must run this while the API is LIVE. */
async function limiterIsolationProbe(): Promise<Record<string, unknown>> {
  const mk = (id: string, ip: string): Client =>
    new Client({
      baseUrl: API_BASE,
      id,
      localAddress: ip,
      timeoutMs: 30_000,
      origin: API_ORIGIN,
    });
  const a = mk("probe-a", "127.0.0.230");
  const b = mk("probe-b", "127.0.0.231");
  const burst = await Promise.all(
    Array.from({ length: 130 }, () =>
      a.login("no-such-probe-user", "wrong-password"),
    ),
  );
  const other = await b.login("no-such-probe-user", "wrong-password");
  const tally = (rs: { status: number }[]): Record<string, number> => {
    const m: Record<string, number> = {};
    for (const r of rs) m[String(r.status)] = (m[String(r.status)] ?? 0) + 1;
    return m;
  };
  const a429 = burst.filter((r) => r.status === 429).length;
  const out = {
    label:
      "NON_CANONICAL diagnostic — per-IP budget isolation (POST /api/auth/login, 10/min/IP)",
    ipA_requests: burst.length,
    ipA_statusTally: tally(burst),
    ipB_status_same_moment: other.status,
    independent: a429 >= 100 && other.status === 401,
  };
  await a.close();
  await b.close();
  return out;
}

/** Spoof-negative evidence for the trusted-proxy state. Caller must run this
 *  while the proxy state's API (trusted CIDRs active) and nginx are LIVE.
 *  If XFF were wrongly honored, the spoofed key would be shared and the
 *  second socket's request would 429; the honest walk keys on the socket
 *  peer (direct) / genuine appended entry (proxied), so it must not. */
async function spoofProbes(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  const tally = (rs: { status: number }[]): Record<string, number> => {
    const m: Record<string, number> = {};
    for (const r of rs) m[String(r.status)] = (m[String(r.status)] ?? 0) + 1;
    return m;
  };
  const loginBody = {
    username: "no-such-probe-user",
    password: "wrong-password",
  };
  // (a) Direct-to-API spoofed XFF from two untrusted loopback aliases.
  const s1 = new Client({
    baseUrl: API_BASE,
    id: "spoof-a",
    localAddress: "127.0.0.240",
    timeoutMs: 30_000,
    origin: API_ORIGIN,
  });
  const burst = await Promise.all(
    Array.from({ length: 130 }, () =>
      s1.json("POST", "/api/auth/login", loginBody, {
        "x-forwarded-for": "9.9.9.9",
      }),
    ),
  );
  const s1_429 = burst.filter((r) => r.status === 429).length;
  const s2 = new Client({
    baseUrl: API_BASE,
    id: "spoof-b",
    localAddress: "127.0.0.241",
    timeoutMs: 30_000,
    origin: API_ORIGIN,
  });
  const other = await s2.json("POST", "/api/auth/login", loginBody, {
    "x-forwarded-for": "9.9.9.9",
  });
  out.directXff = {
    spoofedHeader: "9.9.9.9 from two distinct untrusted sockets",
    socketA_130req_statusTally: tally(burst),
    socketB_same_spoofed_header_status: other.status,
    keyIsSocketPeerNotXff: s1_429 >= 100 && other.status === 401,
  };
  await s1.close();
  await s2.close();

  // (b) Through the trusted proxy: candidate-injected XFF left of the genuine
  // entry; proxy appends the real socket → walk must select the genuine entry.
  const p1 = new Client({
    baseUrl: PROXY_BASE,
    id: "pspoof-a",
    localAddress: "127.0.0.242",
    timeoutMs: 30_000,
    origin: API_ORIGIN,
  });
  const pburst = await Promise.all(
    Array.from({ length: 130 }, () =>
      p1.json("POST", "/api/auth/login", loginBody, {
        "x-forwarded-for": "6.6.6.6",
      }),
    ),
  );
  const p1_429 = pburst.filter((r) => r.status === 429).length;
  const p2 = new Client({
    baseUrl: PROXY_BASE,
    id: "pspoof-b",
    localAddress: "127.0.0.243",
    timeoutMs: 30_000,
    origin: API_ORIGIN,
  });
  const pother = await p2.json("POST", "/api/auth/login", loginBody, {
    "x-forwarded-for": "6.6.6.6",
  });
  out.throughProxyInjectedXff = {
    injectedHeader: "6.6.6.6 (candidate-injected, left of genuine entry)",
    socketA_130req_statusTally: tally(pburst),
    socketB_same_injected_header_status: pother.status,
    genuineEntrySelectedNotInjected: p1_429 >= 100 && pother.status === 401,
  };
  await p1.close();
  await p2.close();
  return out;
}

/**
 * Calibrate the reverse proxy's egress addresses as the API sees them: start
 * a throwaway UNTRUSTED production API, send proxied probe requests through
 * nginx, and parse the API log for the socket peers of exactly those
 * requests. In this rig Docker Desktop NATs container→host traffic through
 * one of two paths (vpnkit loopback 127.0.0.1 or the bridge gateway
 * 172.17.0.1) and the choice has been observed to flip between API restarts,
 * so the trusted set is the union of observed peers and both known paths.
 */
async function calibrateProxyPeers(): Promise<string[]> {
  const RUN_ID = `topo-proxy-calib-${new Date()
    .toISOString()
    .replace(/[:.]/g, "-")}`;
  const api = startApi({
    mode: "production",
    dbUrl: RUN_DB_URL,
    runId: RUN_ID,
  });
  try {
    await waitReady(api.baseUrl);
    const ok: number[] = [];
    for (let i = 0; i < 12; i++) {
      const c = new Client({
        baseUrl: PROXY_BASE,
        id: `calib-${i}`,
        localAddress: `127.0.0.${(i % 250) + 2}`,
        timeoutMs: 10_000,
        origin: API_ORIGIN,
      });
      const r = await c.json("GET", "/api/health");
      ok.push(r.status);
      await c.close();
      await sleep(150);
    }
    // This API instance serves ONLY the calibration probes (no admin, no
    // candidates), so every remoteAddress in its log is a proxy egress path.
    const log = readFileSync(join(LOGS_DIR, `${RUN_ID}.api.log`), "utf8");
    const peers = new Set<string>();
    for (const line of log.split("\n")) {
      const m = /"remoteAddress":"([^"]+)"/.exec(line);
      if (m) peers.add(m[1]);
    }
    console.log(
      `calibration: ${ok.filter((s) => s === 200).length}/12 probes ok; observed peers: ${[...peers].join(", ") || "NONE"}`,
    );
    if (ok.some((s) => s !== 200) || peers.size === 0) {
      throw new Error("proxy calibration probes did not all succeed");
    }
    return [...peers];
  } finally {
    await stopActiveApi();
  }
}

async function main(): Promise<void> {
  const cfg = args();
  const states = (
    cfg.states ??
    "direct:20,direct:50,direct:100,nat:20,nat:50,degraded:20,proxy:20"
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const [state, n] = s.split(":");
      return { state, n: Number(n ?? 20) };
    });

  const needProxy = states.some(
    (s) => s.state === "proxy" || s.state === "degraded",
  );
  const results: Record<string, unknown>[] = [];

  try {
    if (needProxy) await proxyStart();
    for (const spec of states) {
      try {
        if (spec.state === "direct") {
          const run = await runState(
            spec,
            null,
            spec.n === 100 ? () => limiterIsolationProbe() : undefined,
          );
          results.push({
            state: spec.state,
            n: spec.n,
            run,
            probe: run.probe,
          });
        } else if (spec.state === "nat") {
          results.push({
            state: spec.state,
            n: spec.n,
            run: await runState(spec, null),
          });
        } else if (spec.state === "degraded") {
          const run = await runState(spec, null);
          results.push({ state: spec.state, n: spec.n, run });
        } else if (spec.state === "proxy") {
          // Self-calibrate the trusted set from live probes: the proxy's
          // egress peers as THIS rig actually delivers them, unioned with
          // both known Docker NAT paths (the choice flips between restarts).
          const observed = await calibrateProxyPeers();
          const allPeers = [
            ...new Set([...observed, "127.0.0.1", "172.17.0.1"]),
          ].sort();
          const cidrs = allPeers.map((p) => `${p}/32`).join(",");
          const run = await runState(spec, cidrs, () => spoofProbes());
          results.push({
            state: spec.state,
            n: spec.n,
            run,
            spoof: run.probe,
            trustedCidrs: cidrs,
            calibrationPeers: observed,
            trustedCidrsBasis:
              "reverse-proxy egress peers observed by live calibration probes, unioned with this rig's known Docker NAT egress paths (vpnkit loopback + bridge gateway); every /32 is a proxy-owned address, candidate aliases stay untrusted",
          });
        } else {
          throw new Error(`unknown state ${spec.state}`);
        }
      } catch (err) {
        console.error(`state ${spec.state}:${spec.n} FAILED`, err);
        await stopActiveApi();
        results.push({ state: spec.state, n: spec.n, error: String(err) });
      }
    }
  } finally {
    if (needProxy) proxyStop();
  }
  mkdirSync(RESULTS_DIR, { recursive: true });
  const outFile = join(
    RESULTS_DIR,
    `topology-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  );
  writeFileSync(outFile, JSON.stringify(results, null, 2) + "\n");
  console.log(`Wrote → ${outFile}`);
}

main().catch(async (err) => {
  console.error(err);
  await stopActiveApi();
  process.exit(1);
});
