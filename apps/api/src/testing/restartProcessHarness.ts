import { spawn, type ChildProcess } from "node:child_process";
import { openSync, closeSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

/**
 * Process-boundary restart harness (#326).
 *
 * Spawns the REAL API server (`src/server.ts` through tsx) as an operating-
 * system child process against a caller-supplied PostgreSQL URL, so tests can
 * prove durability across genuine process death (SIGKILL) and identity change
 * — not `app.close()` against shared in-memory state.
 *
 * Everything here is plain Node; no vitest imports, so the file cannot be
 * flagged as test-only production surface.
 */

/** Directory of this file — used to derive apps/api cwd for `src/server.ts`. */
const API_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

export interface SpawnedApiServer {
  /** OS pid of the node process running the API server. */
  pid: number;
  /** Bound port (may differ from the requested one after EADDRINUSE retry). */
  port: number;
  baseUrl: string;
  /** Resolves with the exit code / signal info when the process dies. */
  exitPromise: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

export class HarnessError extends Error {}

/**
 * Asks the kernel for a currently-free TCP port and releases it immediately.
 * Small TOCTOU window remains; spawnApiServer falls back to a fresh port once
 * if the bind loses the race (see `spawnApiServer`).
 */
export async function grabFreePort(): Promise<number> {
  return new Promise((resolvePromise, rejectPromise) => {
    const probe = createServer();
    probe.unref();
    probe.once("error", rejectPromise);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (address === null || typeof address === "string") {
        probe.close(() => rejectPromise(new HarnessError("bad probe address")));
        return;
      }
      probe.close(() => resolvePromise(address.port));
    });
  });
}

/**
 * True iff the OS reports a live process with this pid. Note pid reuse is
 * theoretically possible but irrelevant here: we assert on the NEGATIVE
 * ("old server gone") immediately after observing that pid's own exit.
 */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

type HealthState = "ok" | "refused" | "error";

/**
 * Probes `/api/health` and classifies the result. `"refused"` machine-proves
 * that nothing is listening (ECONNREFUSED family), which is the DOWN-state
 * evidence required between a hard kill and the next boot.
 */
export async function healthState(baseUrl: string): Promise<HealthState> {
  return probeHealth(baseUrl);
}

async function probeHealth(baseUrl: string): Promise<HealthState> {
  try {
    const res = await fetch(`${baseUrl}/api/health`, {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return "error";
    const body = (await res.json()) as { status?: string };
    return body.status === "ok" ? "ok" : "error";
  } catch (err) {
    const cause = (err as { cause?: { code?: string } }).cause;
    const code = cause?.code ?? (err as { code?: string }).code ?? "UNKNOWN";
    // ECONNREFUSED (and its undici wrappers) prove nothing is listening.
    if (code.includes("ECONNREFUSED") || code === "UND_ERR_SOCKET")
      return "refused";
    return "error";
  }
}

/**
 * Polls `probe()` until it returns a truthy value or the timeout elapses.
 * Condition-polling everywhere — no arbitrary sleeps-until-green.
 */
export async function waitUntil<T>(
  probe: () => Promise<T | null | undefined> | T | null | undefined,
  opts: { timeoutMs: number; intervalMs?: number; label: string },
): Promise<T> {
  const start = Date.now();
  for (;;) {
    const result = await probe();
    if (result !== null && result !== undefined && result !== false) {
      return result as T;
    }
    if (Date.now() - start >= opts.timeoutMs) {
      throw new HarnessError(
        `waitUntil('${opts.label}') timed out after ${opts.timeoutMs}ms`,
      );
    }
    await delay(opts.intervalMs ?? 250);
  }
}

export interface SpawnApiServerOptions {
  databaseUrl: string;
  /** Requested bind port; the server retries once on a fresh port if taken. */
  port?: number;
  deadlineScanIntervalMs?: number;
  heartbeatScanIntervalMs?: number;
  heartbeatTimeoutMs?: number;
}

function buildChildEnv(
  opts: SpawnApiServerOptions,
  port: number,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "test",
    APP_MODE: "test",
    HOST: "127.0.0.1",
    APP_PORT: String(port),
    TEST_DATABASE_URL: opts.databaseUrl,
    RATE_LIMIT_DISABLED: "1",
    DEADLINE_SCAN_INTERVAL_MS: String(opts.deadlineScanIntervalMs ?? 1000),
    HEARTBEAT_SCAN_INTERVAL_MS: String(opts.heartbeatScanIntervalMs ?? 1000),
    HEARTBEAT_TIMEOUT_MS: String(opts.heartbeatTimeoutMs ?? 15000),
  };
  // Hermeticity: the resolver must take the explicit TEST_DATABASE_URL above,
  // and no ambient Redis/email dependency may leak into the spawned instance.
  delete env.DATABASE_URL;
  delete env.REDIS_URL;
  env.REDIS_MODE = "off";
  delete env.EMAIL_ENABLED;
  return env;
}

let logFileCounter = 0;

function openServerLogStream(role: string): number {
  const file = path.join(
    tmpdir(),
    `exam-restart-${role}-${process.pid}-${logFileCounter++}.log`,
  );
  return openSync(file, "w");
}

interface ChildLaunch {
  child: ChildProcess;
  port: number;
  exitPromise: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

function launchChild(opts: SpawnApiServerOptions, port: number): ChildLaunch {
  // `node --import tsx src/server.ts` is the documented programmatic tsx
  // invocation (Node >= 20.6). cwd=apps/api so both the bare specifier `tsx`
  // and `src/server.ts` resolve against @exam/api's node_modules. This runs
  // the REAL production entry — every plugin, including the deadline scanner
  // interval and the audit lifecycle, boots identically to `pnpm dev`.
  const fd = openServerLogStream(`p${port}`);
  const child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
    cwd: API_DIR,
    env: buildChildEnv(opts, port),
    stdio: ["ignore", fd, fd],
  });
  closeSync(fd); // inherited by the child; parent copy may be released
  const exitPromise = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolvePromise) => {
    // A failed spawn (e.g. ENOENT) emits 'error' WITHOUT a later 'exit';
    // settle here too so waitHealthy fails fast instead of spinning.
    let settled = false;
    const settle = (): void => {
      if (!settled) {
        settled = true;
        resolvePromise({ code: -1, signal: null });
      }
    };
    child.once("exit", (code, signal) => {
      settled = true;
      resolvePromise({ code, signal });
    });
    child.once("error", settle);
  });
  return { child, port, exitPromise };
}

async function waitHealthy(
  exitPromise: ChildLaunch["exitPromise"],
  port: number,
  timeoutMs: number,
): Promise<void> {
  const baseUrl = `http://127.0.0.1:${port}`;
  const start = Date.now();
  for (;;) {
    if ((await probeHealth(baseUrl)) === "ok") return;
    const raced = await Promise.race([
      exitPromise.then((exit) => ({ dead: exit })),
      delay(0).then(() => null),
    ]);
    if (raced !== null) {
      throw new HarnessError(
        `api server(:${port}) exited before becoming healthy: ${JSON.stringify(raced.dead)}; logs: ${tmpdir()}/exam-restart-p${port}-*.log`,
      );
    }
    if (Date.now() - start >= timeoutMs) {
      throw new HarnessError(
        `api server(:${port}) not healthy within ${timeoutMs}ms`,
      );
    }
    await delay(250);
  }
}

/**
 * Spawns a real API server child process and waits for `/api/health`.
 *
 * Port contract: prefers the requested port (restart parity — instance B
 * replaces instance A's listener). If the kernel hands that port away in the
 * launch race, ONE fallback attempt on a fresh port keeps the run livable;
 * the resolved port/baseUrl are always returned and must be used downstream.
 */
export async function spawnApiServer(
  opts: SpawnApiServerOptions,
): Promise<SpawnedApiServer> {
  const wantedPort = opts.port ?? (await grabFreePort());
  let launch = launchChild(opts, wantedPort);
  try {
    await waitHealthy(launch.exitPromise, launch.port, 45_000);
  } catch (err) {
    // One fallback attempt ONLY for the explicit-port bind-loss race (child
    // already dead AND not signal-killed). A still-running child means a slow
    // boot or a config failure — kill it and rethrow the original error fast.
    const childGoneUnsignaled =
      launch.child.exitCode !== null || launch.child.signalCode !== null;
    if (opts.port === undefined || !childGoneUnsignaled) {
      launch.child.kill("SIGKILL");
      await launch.exitPromise;
      throw err;
    }
    await launch.exitPromise;
    const fallbackPort = await grabFreePort();
    launch = launchChild(opts, fallbackPort);
    try {
      await waitHealthy(launch.exitPromise, launch.port, 45_000);
    } catch {
      // Never leak the fallback child: kill it and surface the ORIGINAL
      // error so the root cause (not the fallback timeout) is reported.
      launch.child.kill("SIGKILL");
      await launch.exitPromise;
      throw err;
    }
  }
  return {
    pid: launch.child.pid!,
    port: launch.port,
    baseUrl: `http://127.0.0.1:${launch.port}`,
    exitPromise: launch.exitPromise,
  };
}

/**
 * Hard-kills the server process (SIGKILL — no graceful hooks, no drain, no
 * onClose flushes) and machine-proves death:
 *   1. the child's own exit event resolves,
 *   2. the OS reports the pid gone,
 *   3. the former health endpoint refuses connections.
 */
export async function killHard(server: SpawnedApiServer): Promise<void> {
  try {
    process.kill(server.pid, "SIGKILL");
  } catch {
    // already gone — fall through to the proof phase
  }
  await Promise.race([server.exitPromise, delay(5000)]);
  if (isProcessAlive(server.pid)) {
    throw new HarnessError(
      `old api server pid ${server.pid} still alive after SIGKILL`,
    );
  }
  await waitUntil(
    async () => {
      const state = await probeHealth(server.baseUrl);
      return state === "refused" ? state : null;
    },
    {
      timeoutMs: 10_000,
      intervalMs: 150,
      label: `old server :${server.port} refuses connections`,
    },
  );
}
