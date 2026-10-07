import { spawn, type ChildProcess } from "node:child_process";
import { openSync, closeSync, readFileSync } from "node:fs";
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
 * OWNED READINESS (#724): startup is proven by the spawned child itself —
 * its private stdout listen record (`Server listening at
 * http://127.0.0.1:{port}`) plus its answering `/api/health`. A healthy
 * foreign server on the port can never establish readiness for a child that
 * did not bind, and a child exit before readiness fails startup loudly.
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
  /**
   * Bound port — always exactly the requested (or freshly selected
   * candidate) port: readiness is owned by the spawned child, and a lost
   * bind fails startup loudly instead of migrating ports (#724).
   */
  port: number;
  baseUrl: string;
  /** Resolves with the exit code / signal info when the process dies. */
  exitPromise: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

export class HarnessError extends Error {}

/**
 * Asks the kernel for a currently-free TCP port and releases it immediately.
 * CANDIDATE PORT SELECTION ONLY (#724): the returned number is NOT a
 * reservation — any other process may claim it before our child binds.
 * Ownership is never inferred from this value; a lost bind fails loud at
 * child startup (see {@link spawnApiServer}).
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
  /**
   * Requested bind port (restart parity: instance B replaces instance A's
   * listener). The child binds exactly this port; if the bind is lost the
   * startup fails loud — the port is never silently swapped (#724).
   */
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

function openServerLogStream(role: string): { fd: number; file: string } {
  // Per-launch private file: only THIS child's stdout/stderr ever land here,
  // which is what makes it usable as a child-ownership channel (#724).
  const file = path.join(
    tmpdir(),
    `exam-restart-${role}-${process.pid}-${logFileCounter++}.log`,
  );
  return { fd: openSync(file, "w"), file };
}

interface ChildLaunch {
  child: ChildProcess;
  port: number;
  logFile: string;
  exitPromise: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

function launchChild(opts: SpawnApiServerOptions, port: number): ChildLaunch {
  // `node --import tsx src/server.ts` is the documented programmatic tsx
  // invocation (Node >= 20.6). cwd=apps/api so both the bare specifier `tsx`
  // and `src/server.ts` resolve against @exam/api's node_modules. This runs
  // the REAL production entry — every plugin, including the deadline scanner
  // interval and the audit lifecycle, boots identically to `pnpm dev`.
  const { fd, file } = openServerLogStream(`p${port}`);
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
    // settle here too so readiness fails fast instead of spinning.
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
  return { child, port, logFile: file, exitPromise };
}

type ChildExit = { code: number | null; signal: NodeJS.Signals | null };

/**
 * Settles with the child's exit info if it has already died, else with null.
 * Microtask (already-resolved promise) beats the timer tick, so an exit that
 * has happened is always observed before the next probe cycle.
 */
async function childExitIfAny(
  exitPromise: Promise<ChildExit>,
): Promise<ChildExit | null> {
  const raced = await Promise.race([
    exitPromise.then((exit) => ({ dead: exit })),
    delay(0).then(() => null),
  ]);
  return raced === null ? null : raced.dead;
}

/**
 * The spawned child's OWN listen record: Fastify logs
 * `Server listening at http://127.0.0.1:{port}` to its stdout once the
 * kernel bind resolves (fastify's default listenTextResolver; HOST is pinned
 * to 127.0.0.1 by buildChildEnv). Only this child writes to launch.logFile,
 * so the record naming our port there proves THIS ChildProcess owns the
 * port — no foreign server can inject it. This record is the chosen
 * child-identity protocol (#724); matching it is correctness, not log
 * convenience. Format drift fails loud (readiness timeout carrying the log
 * path), never as a false accept.
 */
function childReportedListening(logFile: string, port: number): boolean {
  try {
    return readFileSync(logFile, "utf8").includes(
      `Server listening at http://127.0.0.1:${port}`,
    );
  } catch {
    return false; // no output yet
  }
}

/** Surfaces the canonical bind-loss cause from the child's own output. */
function bindFailureHint(logFile: string): string {
  try {
    if (readFileSync(logFile, "utf8").includes("EADDRINUSE")) {
      return "; bind lost: EADDRINUSE (another listener owns the port)";
    }
  } catch {
    /* log unreadable — attribution stays at exit-info level */
  }
  return "";
}

function childDiedDuringStartupError(
  launch: ChildLaunch,
  exit: ChildExit,
  phase: string,
): HarnessError {
  return new HarnessError(
    `api server child (pid ${launch.child.pid}) on :${launch.port} exited ${phase}: ${JSON.stringify(exit)}${bindFailureHint(launch.logFile)}; log: ${launch.logFile}`,
  );
}

/**
 * Startup readiness = OWNERSHIP, then RESPONSIVENESS (#724):
 *   1. the exact spawned child reports listening in its private stdout file
 *      (a foreign server can never produce this record), then
 *   2. that endpoint answers `/api/health`.
 * Child exit/error is checked BEFORE every readiness probe, so a child that
 * dies (e.g. bind loss) fails startup immediately with full attribution —
 * it can never be masked by another process's healthy answer on the port.
 */
async function awaitChildReady(
  launch: ChildLaunch,
  timeoutMs: number,
): Promise<void> {
  const baseUrl = `http://127.0.0.1:${launch.port}`;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const exit = await childExitIfAny(launch.exitPromise);
    if (exit !== null) {
      throw childDiedDuringStartupError(launch, exit, "before readiness");
    }
    if (childReportedListening(launch.logFile, launch.port)) break;
    if (Date.now() >= deadline) {
      throw new HarnessError(
        `api server child (pid ${launch.child.pid}) never reported listening on :${launch.port} within ${timeoutMs}ms; log: ${launch.logFile}`,
      );
    }
    await delay(100);
  }
  for (;;) {
    const exit = await childExitIfAny(launch.exitPromise);
    if (exit !== null) {
      throw childDiedDuringStartupError(
        launch,
        exit,
        "after listening but before answering /api/health",
      );
    }
    if ((await probeHealth(baseUrl)) === "ok") return;
    if (Date.now() >= deadline) {
      throw new HarnessError(
        `api server child (pid ${launch.child.pid}) owns :${launch.port} but /api/health never answered within ${timeoutMs}ms; log: ${launch.logFile}`,
      );
    }
    await delay(150);
  }
}

/** Operational ceiling for one child to prove owned readiness (unchanged). */
const STARTUP_BUDGET_MS = 45_000;

/**
 * Spawns a real API server child process and waits for OWNED readiness
 * (#724): the spawned child itself must prove it bound the port (its
 * private stdout listen record) and answer `/api/health` — a healthy
 * foreign server on the port never satisfies startup. Port contract: the
 * child binds exactly the requested (or freshly selected candidate) port;
 * a lost bind (EADDRINUSE) fails startup loudly with the child's exit
 * attribution — there is no silent port migration.
 */
export async function spawnApiServer(
  opts: SpawnApiServerOptions,
): Promise<SpawnedApiServer> {
  const port = opts.port ?? (await grabFreePort());
  const launch = launchChild(opts, port);
  try {
    await awaitChildReady(launch, STARTUP_BUDGET_MS);
  } catch (err) {
    // Never leak a launch whose readiness failed; surface the precise
    // startup error (child exit / bind attribution), not cleanup noise.
    try {
      const { pid } = launch.child;
      if (pid !== undefined && isProcessAlive(pid))
        launch.child.kill("SIGKILL");
    } finally {
      await launch.exitPromise;
    }
    throw err;
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
