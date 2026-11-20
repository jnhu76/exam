/**
 * #900/#1021 capacity campaign — API process lifecycle (RESEARCH ONLY).
 *
 * Starts the API from the WORKTREE BUILD OUTPUT of the frozen SHA
 * (`apps/api/dist/server.js`, produced by the repo's own `pnpm build`),
 * NOT from tsx/source: the campaign measures the built artifact.
 *
 * Canonical run law (protocol §1): APP_MODE=production, production limiter
 * ON, PG pool max=10 untouched, REDIS_MODE=optional with Redis reachable,
 * CAPACITY_RESEARCH=1, background loops at defaults.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, openSync } from "node:fs";
import { join } from "node:path";
import { Client, sleep } from "./http.js";
import {
  API_PORT,
  CAP_NET_SUBNET,
  jwtSecret,
  LOGS_DIR,
  PUBLIC_ORIGIN,
  REPO_ROOT,
  RUN_DB_URL,
} from "./config.js";

export interface ApiHandle {
  child: ChildProcess;
  baseUrl: string;
  port: number;
  jwtSecret: string;
  stop: () => Promise<void>;
}

/** Spawn the BUILT API (production shape: 1 instance, pool max=10). */
export function startBuiltApi(opts: {
  port?: number;
  runId: string;
  jwtSecret?: string;
  extraEnv?: Record<string, string>;
}): ApiHandle {
  const port = opts.port ?? API_PORT;
  mkdirSync(LOGS_DIR, { recursive: true });
  const logPath = join(LOGS_DIR, `${opts.runId}.api.log`);
  const out = openSync(logPath, "a");
  const secret = opts.jwtSecret ?? jwtSecret();
  const child = spawn(
    process.execPath,
    ["dist/server.js"],
    {
      cwd: join(REPO_ROOT, "apps", "api"),
      stdio: ["ignore", out, out],
      env: {
        ...process.env,
        APP_MODE: "production",
        NODE_ENV: "production",
        APP_PORT: String(port),
        HOST: "0.0.0.0",
        // Production mode resolves the DB via DATABASE_URL; the target is the
        // name-guarded run database (config.ts), never the dev `exam` DB.
        DATABASE_URL: RUN_DB_URL,
        JWT_SECRET: secret,
        CORS_ORIGIN: PUBLIC_ORIGIN,
        PUBLIC_WEB_ORIGIN: PUBLIC_ORIGIN,
        REDIS_URL: process.env.CAPACITY_REDIS_URL ?? "redis://127.0.0.1:6379",
        REDIS_MODE: process.env.CAPACITY_REDIS_MODE ?? "optional",
        CAPACITY_RESEARCH: "1",
        // External-proxy override (docker-compose.yml TRUSTED_PROXY_CIDRS
        // comment): trust ONLY the research nginx container's subnet. The
        // bundled default stays 172.28.0.0/24 — recorded in topology.md.
        TRUSTED_PROXY_CIDRS: CAP_NET_SUBNET,
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
    jwtSecret: secret,
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
