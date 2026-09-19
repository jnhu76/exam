/**
 * #550 harness runtime: API process lifecycle + observers (RESEARCH ONLY).
 *
 * Observers write one continuous `pool.jsonl` per run containing:
 *   - {source:"pgstat"} server-side pg_stat_activity state counts
 *   - {source:"research"} in-process research snapshot (default-OFF wrapper)
 *   - {source:"host"} host load/memory + PG container CPU
 *   - {source:"phase"} phase boundary markers
 */
import { spawn, type ChildProcess } from "node:child_process";
import {
  appendFileSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { createDatabase } from "../../../../../packages/db/src/database.js";
import { Client, sleep } from "./http.js";
import { API_PORT, ADMIN, LOGS_DIR, REPO_ROOT, jwtSecret } from "./config.js";

export interface ApiHandle {
  child: ChildProcess;
  baseUrl: string;
  port: number;
  stop: () => Promise<void>;
}

let activeApi: ApiHandle | null = null;

/** Crash-path cleanup: the most recently started API process, if any. */
export async function stopActiveApi(): Promise<void> {
  const h = activeApi;
  activeApi = null;
  if (h) await h.stop().catch(() => undefined);
}

export interface StartApiOptions {
  port?: number;
  mode: string;
  dbUrl: string;
  extraEnv?: Record<string, string>;
  /** e.g. "lifecycle-S100-r1" — names the log file. */
  runId: string;
}

/** Spawn one native API process (production shape: 1 instance, pool max=10). */
export function startApi(opts: StartApiOptions): ApiHandle {
  const port = opts.port ?? API_PORT;
  mkdirSync(LOGS_DIR, { recursive: true });
  const logPath = join(LOGS_DIR, `${opts.runId}.api.log`);
  const out = openSync(logPath, "a");
  const child = spawn(
    join(REPO_ROOT, "apps", "api", "node_modules", ".bin", "tsx"),
    ["src/server.ts"],
    {
      cwd: join(REPO_ROOT, "apps", "api"),
      stdio: ["ignore", out, out],
      env: {
        ...process.env,
        APP_MODE: opts.mode,
        APP_PORT: String(port),
        HOST: "0.0.0.0",
        // e2e/test modes resolve the DB via TEST_DATABASE_URL (the repo's own
        // test-branch contract, name-guarded); production uses DATABASE_URL.
        DATABASE_URL: opts.dbUrl,
        TEST_DATABASE_URL: opts.dbUrl,
        JWT_SECRET: jwtSecret(),
        CORS_ORIGIN: `http://localhost:${port}`,
        PUBLIC_WEB_ORIGIN: `http://localhost:${port}`,
        REDIS_URL: process.env.CAPACITY_REDIS_URL ?? "redis://127.0.0.1:6379",
        REDIS_MODE: process.env.CAPACITY_REDIS_MODE ?? "optional",
        CAPACITY_RESEARCH: "1",
        ...opts.extraEnv,
      },
    },
  );
  const baseUrl = `http://127.0.0.1:${port}`;
  let stopped = false;
  const handle: ApiHandle = {
    child,
    baseUrl,
    port,
    stop: async () => {
      if (stopped) return;
      stopped = true;
      child.kill("SIGINT");
      const exit = new Promise<void>((resolve) =>
        child.once("exit", () => resolve()),
      );
      const timeout = new Promise<void>((resolve) =>
        setTimeout(() => {
          if (!child.killed) child.kill("SIGKILL");
          resolve();
        }, 12_000),
      );
      await Promise.race([exit, timeout]);
    },
  };
  activeApi = handle;
  return handle;
}

export async function waitReady(
  baseUrl: string,
  timeoutMs = 45_000,
): Promise<void> {
  const probe = new Client({ baseUrl, id: "readiness-probe", timeoutMs: 3000 });
  const deadline = Date.now() + timeoutMs;
  let last = 0;
  while (Date.now() < deadline) {
    const res = await probe.request("GET", "/api/health");
    last = res.status;
    if (res.status === 200) {
      await probe.close();
      return;
    }
    await sleep(400);
  }
  await probe.close();
  throw new Error(`API not ready (last /api/health=${last})`);
}

// ── Observers ──────────────────────────────────────────────────────────────

export interface ObserverHandle {
  markPhase: (phase: string) => void;
  stop: () => Promise<void>;
  poolJsonlPath: string;
}

export async function startObservers(opts: {
  runId: string;
  resultsDir: string;
  runDbName: string;
  samplerDbUrl: string;
  api: ApiHandle;
  adminClient?: Client;
  hostSampling?: boolean;
}): Promise<ObserverHandle> {
  const poolPath = join(opts.resultsDir, "pool.jsonl");
  writeFileSync(poolPath, "");
  let stopped = false;

  const emit = (record: Record<string, unknown>): void => {
    if (stopped) return;
    appendFileSync(
      poolPath,
      JSON.stringify({ ts: new Date().toISOString(), ...record }) + "\n",
    );
  };

  // 1. pg_stat_activity sampler (own connection, excluded from its own count)
  const sampler = await createDatabase(opts.samplerDbUrl);
  void (async () => {
    while (!stopped) {
      try {
        const rows = await sampler.sql.unsafe(
          `SELECT state, count(*)::int AS n FROM pg_stat_activity
           WHERE datname = $1 AND pid <> pg_backend_pid()
           GROUP BY state`,
          [opts.runDbName],
        );
        const byState: Record<string, number> = {};
        for (const r of rows) byState[r.state as string] = r.n as number;
        const wait = await sampler.sql.unsafe(
          `SELECT count(*)::int AS n FROM pg_stat_activity
           WHERE datname = $1 AND wait_event_type = 'Lock'`,
          [opts.runDbName],
        );
        emit({ source: "pgstat", byState, lockWaits: wait[0]?.n ?? 0 });
      } catch {
        // sampler failure never affects measurement
      }
      await sleep(200);
    }
  })();

  // 2. research snapshot poller (in-process counters/pool internals)
  void (async () => {
    const probe = opts.adminClient;
    while (!stopped) {
      if (probe?.hasSession) {
        const res = await probe.json("GET", "/api/research/capacity");
        if (res.status === 200 && res.parsed) {
          emit({ source: "research", snapshot: res.parsed });
        }
      }
      await sleep(500);
    }
  })();

  // 3. host sampler (loadavg / MemAvailable / PG container CPU)
  if (opts.hostSampling !== false) {
    void (async () => {
      while (!stopped) {
        try {
          const load = readFirstField("/proc/loadavg");
          const mem = readProcMemAvailableKb();
          const dbCpu = await dockerContainerCpuPercent("exam-db-1");
          emit({
            source: "host",
            load1: load,
            memAvailableKb: mem,
            dbCpuPercent: dbCpu,
          });
        } catch {
          // ignore
        }
        await sleep(1000);
      }
    })();
  }

  return {
    poolJsonlPath: poolPath,
    markPhase: (phase: string) => emit({ source: "phase", phase }),
    stop: async () => {
      stopped = true;
      await sampler.sql.end();
    },
  };
}

function readFirstField(path: string): string {
  return readFileSync(path, "utf8").trim().split(/\s+/)[0] ?? "0";
}

function readProcMemAvailableKb(): number {
  const m = /MemAvailable:\s+(\d+) kB/.exec(
    readFileSync("/proc/meminfo", "utf8"),
  );
  return m ? Number(m[1]) : 0;
}

const dockerCpuCache = new Map<string, { at: number; value: number | null }>();

async function dockerContainerCpuPercent(name: string): Promise<number | null> {
  const cached = dockerCpuCache.get(name);
  if (cached && Date.now() - cached.at < 2000) return cached.value;
  const value = await new Promise<number | null>((resolve) => {
    const child = spawn(
      "docker",
      ["stats", "--no-stream", "--format", "{{.CPUPerc}}", name],
      { timeout: 4000 },
    );
    let out = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.on("close", () => {
      const m = /([\d.]+)%/.exec(out);
      resolve(m ? Number(m[1]) : null);
    });
    child.on("error", () => resolve(null));
  });
  dockerCpuCache.set(name, { at: Date.now(), value });
  return value;
}

/** Seeded admin session used for research polls + proctor reads. */
export async function loginAdmin(api: ApiHandle): Promise<Client> {
  const admin = new Client({
    baseUrl: api.baseUrl,
    id: "admin",
    // startApi derives the CSRF allowlist from the spawned port, so the
    // origin must follow api.port, not the API_PORT default.
    origin: `http://localhost:${api.port}`,
  });
  const res = await admin.login(ADMIN.username, ADMIN.password);
  if (res.status !== 200) {
    throw new Error(
      `admin login failed: ${res.status} ${res.body.slice(0, 200)}`,
    );
  }
  return admin;
}
