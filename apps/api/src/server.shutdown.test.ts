/**
 * Child-process SIGTERM regression (#351): after `app.close()` settles, the
 * API server process must exit NATURALLY with code 0 — the production code
 * no longer contains an unconditional `process.exit()`.
 *
 * Before #351 the email outbox loop's shutdown race left a cleared-less,
 * ref'ed `setTimeout` that held the event loop open for the whole
 * EMAIL_WORKER_SHUTDOWN_TIMEOUT_MS budget after a clean drain, and the
 * forced `process.exit()` masked the leak. This test spawns the REAL server
 * entrypoint as a child process, drives it to readiness, sends SIGTERM, and
 * proves the exit is natural AND bounded: a leaked shutdown timer would
 * delay the exit by the full budget (6s here), so the <5s bound fails on
 * regression. It cannot be satisfied by a production process.exit() because
 * that call is gone — a green run means the event loop drained by itself.
 *
 * Configuration authority (#688, #733 R1, #741): the child is a test-owned
 * subprocess, so it runs under the MANAGED test profile. The previous
 * development-profile shape admitted the developer root `.env`
 * (loadRootEnv law) and projected `APP_PORT` into the leaf development
 * IGNORES (`DEV_API_PORT ?? 3000` owns the bind) — the child could bind the
 * developer's port instead of the test-owned one while every assertion
 * stayed green. The readiness oracle therefore additionally requires the
 * child's OWN listen record to name exactly the owned port, and a hostile
 * regression below kills the old shape under an occupied default port plus
 * a hostile `.env` physically present in the child's cwd (a temp fixture —
 * #741 W3 decomposed the old `apps/api/.env` real-candidate writer: the
 * developer-file ADMISSION dimension is owned by the loadRootEnv admission
 * tests and the env-surface guard; this test owns the bind oracle and the
 * foreign-:3000 fallback kill).
 *
 * Hung-owner scenario (#1055 / #1047 R-T1-3): BEFORE the fix, the four
 * background-loop plugins other than the email outbox closed with an
 * UNBOUNDED `await` of the in-flight tick promise (deadlineScanner.ts /
 * heartbeat.ts / clientEventRetention.ts / operabilityMonitor.ts onClose
 * hooks), and the email outbox's own bound was independent of them. When a
 * tick's org-discovery SELECT blocks server-side on a table lock — no
 * statement/lock timeout on either side — that await never settled,
 * `app.close()` never settled, the 2s exit assist never armed, and the
 * process outlived the compose stop_grace_period (SIGKILL / exit 137). The
 * bounded-close fix races every loop hook's in-flight tick against ONE
 * shared 8s window (lib/loopShutdown.ts; the email loop's bound is the
 * smaller of EMAIL_WORKER_SHUTDOWN_TIMEOUT_MS and the remaining window),
 * which keeps the serial #351 worst case at 30s. The scenario below
 * reproduces the production-isomorphic hang inside the child's OWN isolated
 * schema: the harness holds an ACCESS EXCLUSIVE lock on `organizations` from
 * before the child spawns. The assertions cover only owners that are pending
 * by construction — the retention startup pass and the email outbox's
 * default-org wait both issue their org SELECT during plugin registration
 * (before `listen`), so the post-readiness SIGTERM cannot race them; a
 * pg_blocking_pids probe proves the lock is really blocking a child query.
 * The exit must stay inside the 30s total budget (loops 8s shared + audit +
 * db + assist < 45s grace). Under the pre-fix unbounded await the child
 * cannot exit at all while the lock is held, so the bound fails.
 */
import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { createPostgresDatabase } from "@exam/db/postgres";
import { getIsolatedTestDb, resolveTestDbUrl } from "@exam/db/testDb";
import {
  addSearchPathToUrl,
  isTestDbIsolationEnabled,
} from "@exam/db/testIsolation";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = resolve(__dirname, "server.ts");
const TSX_IMPORT_SPECIFIER = import.meta.resolve("tsx");

/** A leaked shutdown timer would hold the exit for the FULL budget. */
const CHILD_SHUTDOWN_TIMEOUT_MS = 6_000;
/** Natural exit must beat the leaked-timer counterfactual comfortably. */
const MAX_EXIT_AFTER_SIGTERM_MS = 5_000;
const BOOT_TIMEOUT_MS = 45_000;
/**
 * #1055 hung-owner terms. The exit bound is the #351 TOTAL shutdown budget
 * (all loop hooks share 8s + audit 10s + db 10s + assist 2s = 30s < 45s
 * compose grace). In THIS scenario the exit path is bounded by the shared
 * window, the DB pool close and the assist (≈20s); the 30s total is the
 * contract ceiling the fix must never exceed, however many loop owners it
 * abandons. The kill bound sits 10s above it so a marginal overrun is
 * reported by the assertion (with the child's own logs) instead of a harness
 * kill.
 */
const HUNG_OWNER_EXIT_BUDGET_MS = 30_000;
const HUNG_OWNER_KILL_MS = 40_000;
/** How long to wait for the harness lock to demonstrably block a child query. */
const BLOCKED_BACKEND_WAIT_MS = 15_000;

async function pgReachable(url: string): Promise<boolean> {
  const conn = await createPostgresDatabase(url);
  try {
    await conn.sql`SELECT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await conn.sql.end();
  }
}

const PG_UP = await pgReachable(resolveTestDbUrl());
const PG_DESCRIBE = PG_UP ? describe : describe.skip;
// The hung-owner scenario locks a table EXCLUSIVE — only safe when the child
// owns an isolated schema (the default). It must skip, never run degraded,
// when isolation is explicitly disabled.
const HUNG_OWNER_DESCRIBE =
  PG_UP && isTestDbIsolationEnabled() ? describe : describe.skip;

interface ChildRun {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  exitAfterSigtermMs: number;
  port: number;
}

/**
 * Lifecycle-run options. `iso` hands the runner a PRE-CREATED isolated DB
 * (caller owns `cleanup()`) so a harness can hold connections into the
 * child's schema — e.g. the #1055 table lock — before the child spawns.
 * `env` adds child env keys (fast loop intervals); `beforeSigterm` runs
 * between readiness and SIGTERM; `exitKillMs` re-arms the harness kill
 * bound (default: the clean-path 4×5s window).
 */
interface LifecycleOptions {
  cwd?: string;
  env?: Record<string, string>;
  beforeSigterm?: () => Promise<void>;
  exitKillMs?: number;
  iso?: Awaited<ReturnType<typeof getIsolatedTestDb>>;
}

async function runServerLifecycle(
  namespace = "api-server-shutdown",
  options: LifecycleOptions = {},
): Promise<ChildRun> {
  // OWNERSHIP: with `options.iso` the CALLER owns the isolated DB lifecycle
  // (its harness connections must close before the schema can be dropped),
  // so the runner only cleans up a database it created itself.
  const iso = options.iso ?? (await getIsolatedTestDb(namespace));
  // Shared-DB fallback (isolation disabled) has no schemaName; the base
  // test URL is then correct as-is.
  const baseUrl = iso.databaseUrl ?? resolveTestDbUrl();
  const childDbUrl = iso.schemaName
    ? addSearchPathToUrl(baseUrl, iso.schemaName)
    : baseUrl;

  // INVARIANT: spawn via `node --import tsx` — NOT `node tsx/cli`. The tsx
  // CLI runs the script in a GRANDCHILD process and its signal relay
  // SIGKILLs that grandchild ~60ms after forwarding SIGTERM when no IPC
  // signal comes back (verified against tsx@4.22.3 dist): a server whose
  // graceful close takes longer than that window dies 143 with no shutdown
  // logs — exactly the CI failure this test first hit. `--import tsx` runs
  // the script in the direct child, so the signal reaches OUR handler.
  const childPort = 20_000 + Math.floor(Math.random() * 20_000);
  const child = spawn(
    process.execPath,
    ["--import", TSX_IMPORT_SPECIFIER, SERVER_PATH],
    {
      env: {
        // MANAGED TEST profile — the test owns the child's profile, port,
        // and DB target, so no ambient source may co-own any of them:
        //   APP_MODE/NODE_ENV: managed profile; `loadRootEnv()` then blocks
        //     the developer root `.env` at the admission layer (#565 law) —
        //     the development profile previously admitted it (#688).
        //   APP_PORT: the test/e2e/ci bind-port owner. Under development
        //     this key is deliberately masked (`DEV_API_PORT ?? 3000`
        //     owns), which is exactly how the old shape lost the port.
        //   TEST_DATABASE_URL: the canonical managed test DB target. The
        //     test-branch resolver NEVER falls back to `DATABASE_URL`, and
        //     none is projected — the dev-DB authority stays unreachable.
        //   EMAIL_*: the shutdown-budget terms this oracle asserts on.
        // The env is a closed whitelist (no `...process.env`); anything not
        // listed is absent from the child.
        APP_MODE: "test",
        NODE_ENV: "test",
        HOST: "127.0.0.1",
        APP_PORT: String(childPort),
        TEST_DATABASE_URL: childDbUrl,
        JWT_SECRET: "shutdown-test-jwt-secret-0123456789abcdef",
        EMAIL_ENABLED: "false",
        EMAIL_WORKER_POLL_INTERVAL_MS: "250",
        EMAIL_WORKER_SHUTDOWN_TIMEOUT_MS: String(CHILD_SHUTDOWN_TIMEOUT_MS),
        ...(options.env ?? {}),
      },
      stdio: ["ignore", "pipe", "pipe"],
      ...(options.cwd ? { cwd: options.cwd } : {}),
    },
  );

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (d: string) => {
    stdout += d;
  });
  child.stderr.on("data", (d: string) => {
    stderr += d;
  });

  try {
    // Readiness = OWNERSHIP, then responsiveness: the child's OWN
    // `Server listening at http://127.0.0.1:<port>` record must name
    // exactly the test-owned port (a masked/hijacked projection fails here,
    // not just an EADDRINUSE symptom), then the /api/health probe must
    // answer 200 on THAT port.
    const port = await new Promise<number>((resolvePort, reject) => {
      const bootTimer = setTimeout(
        () =>
          reject(
            new Error(
              `server did not boot within ${BOOT_TIMEOUT_MS}ms\nstdout: ${stdout}\nstderr: ${stderr}`,
            ),
          ),
        BOOT_TIMEOUT_MS,
      );
      const poll = setInterval(() => {
        const match = stdout.match(
          /Server listening at http:\/\/127\.0\.0\.1:(\d+)/,
        );
        if (match) {
          clearInterval(poll);
          clearTimeout(bootTimer);
          resolvePort(Number(match[1]));
        }
      }, 50);
      child.on("close", () => {
        clearInterval(poll);
        clearTimeout(bootTimer);
        reject(
          new Error(
            `server exited before listening\nstdout: ${stdout}\nstderr: ${stderr}`,
          ),
        );
      });
    });
    if (port !== childPort) {
      throw new Error(
        `server bound :${port} instead of the test-owned :${childPort} — a non-APP_PORT authority owns the bind (profile/port projection defect)\nstdout: ${stdout}\nstderr: ${stderr}`,
      );
    }

    const deadline = Date.now() + BOOT_TIMEOUT_MS;
    for (;;) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/health`);
        if (res.ok) break;
      } catch {
        // not accepting yet — retry until deadline
      }
      if (Date.now() > deadline) {
        throw new Error(
          `/api/health never answered 200\nstdout: ${stdout}\nstderr: ${stderr}`,
        );
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    // Establish the scenario state (e.g. the #1055 hung owner) AFTER
    // readiness but BEFORE the clock starts, so exitAfterSigtermMs measures
    // only the shutdown window the assertions bound. A precondition failure
    // carries the child's own logs — it usually means the child never issued
    // the expected query, and its log says why.
    try {
      await options.beforeSigterm?.();
    } catch (err: unknown) {
      throw new Error(
        `${err instanceof Error ? err.message : String(err)}\n--- child stdout ---\n${stdout}\n--- child stderr ---\n${stderr}`,
      );
    }

    const sigtermAt = Date.now();
    child.kill("SIGTERM");

    const exitKillMs = options.exitKillMs ?? MAX_EXIT_AFTER_SIGTERM_MS * 4;
    const result = await new Promise<
      Omit<ChildRun, "exitAfterSigtermMs" | "port">
    >((resolveClose, reject) => {
      const killTimer = setTimeout(() => {
        // Cut the stuck child loose, then reject only once the OS confirms
        // death — cleanup after the rejection never races a live backend.
        child.kill("SIGKILL");
        child.once("close", () => {
          reject(
            new Error(
              `server did not exit within ${exitKillMs}ms of SIGTERM (leaked lifecycle owner?)\nstdout: ${stdout}\nstderr: ${stderr}`,
            ),
          );
        });
      }, exitKillMs);
      child.on("close", (code, signal) => {
        clearTimeout(killTimer);
        resolveClose({ code, signal, stdout, stderr });
      });
    });

    return {
      ...result,
      port,
      exitAfterSigtermMs: Date.now() - sigtermAt,
    };
  } finally {
    if (child.exitCode === null && !child.killed) child.kill("SIGKILL");
    if (!options.iso) await iso.cleanup();
  }
}

/** The #351 oracle every lifecycle run must satisfy (unchanged contracts). */
function assertShutdownOracle(run: ChildRun): void {
  // Diagnostic context on every failure: the child's own logs explain
  // WHERE in boot/shutdown it died (exit 143 = default SIGTERM
  // disposition — a mid-close listener window or pre-listener death).
  const diag = `\ncode=${run.code} signal=${run.signal} exitAfterSigtermMs=${run.exitAfterSigtermMs}\n--- child stdout tail ---\n${run.stdout.split("\n").slice(-15).join("\n")}\n--- child stderr tail ---\n${run.stderr.split("\n").slice(-15).join("\n")}`;
  expect(run.code, diag).toBe(0);
  expect(run.signal, diag).toBeNull();
  // The bound is the regression signal: a leaked, ref'ed shutdown race
  // timer would delay natural exit by the full CHILD_SHUTDOWN_TIMEOUT_MS.
  expect(run.exitAfterSigtermMs, diag).toBeLessThan(MAX_EXIT_AFTER_SIGTERM_MS);
  // NATURAL exit: the bounded exit assist must NOT have fired — on the
  // clean-drain path the event loop drains by itself. If the assist warn
  // appears here, a lifecycle leak is being cut off instead of fixed
  // (with the leaked race timer restored, the assist fires at 2s).
  expect(run.stdout, diag).not.toContain("event loop still busy");
  // The email loop drained (supervised won the shutdown race) — proves
  // the loop's onClose path ran to completion, not that the process was
  // cut short.
  expect(run.stdout, diag).toContain("email outbox loop stopped cleanly");
  expect(run.stderr, diag).not.toContain("Graceful shutdown failed");
}

// ── #688 hostile regression owner (#741 W3 shape) ────────────────────────
// The old development-profile shape must fail under exactly the conditions
// that made #688 silent: hostile port keys physically present in the boot
// environment and the default 3000 occupied. The hostile `.env` now lives in
// a throwaway temp cwd (#741 removed `apps/api/.env` from the loader's
// source set, and permanent tests must never write a repository env-file
// authority): it proves no cwd-relative env read can re-enter the boot
// chain, while the loadRootEnv admission tests + env-surface guard own the
// developer-file admission dimension.
// C=46001/D=46002 sit outside the child's [20000, 40000) selection range
// and away from 3000, so the scenario contract "P != C, P != D, P != 3000"
// holds by construction (asserted in the test for explicitness).

const HOSTILE_DOTENV_PORT = 46_001; // hostile APP_PORT (C)
const HOSTILE_DOTENV_DEV_PORT = 46_002; // hostile DEV_API_PORT (D)

/**
 * Temp cwd holding a hostile `.env` with its own port keys. Removed
 * recursively in `finally` — a hard kill can only leave an unread temp-dir
 * file, never a repository runtime authority.
 */
function makeHostileCwdFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "exam-shutdown-hostile-env-"));
  writeFileSync(
    join(dir, ".env"),
    `APP_PORT=${HOSTILE_DOTENV_PORT}\nDEV_API_PORT=${HOSTILE_DOTENV_DEV_PORT}\n`,
  );
  return dir;
}

/**
 * Holds `127.0.0.1:3000` for the caller. Kills the old shape's fallback leg
 * (development with nothing admitted binds the DEV_API_PORT default 3000):
 * that variant must die loudly on EADDRINUSE, not pass by coincidence. If
 * :3000 is ALREADY occupied — the live #688 scenario — the foreign occupier
 * serves the same hostile role and nothing is bound.
 */
async function occupyForeignListener(port: number): Promise<() => void> {
  const server = createServer();
  return await new Promise((resolveRelease, reject) => {
    server.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        resolveRelease(() => {});
        return;
      }
      reject(err);
    });
    server.listen(port, "127.0.0.1", () => {
      resolveRelease(() => server.close());
    });
  });
}

PG_DESCRIBE("server SIGTERM lifecycle (child process)", () => {
  it("exits naturally with code 0 after SIGTERM, bounded under the shutdown budget", async () => {
    const run = await runServerLifecycle();
    assertShutdownOracle(run);
  }, 120_000);

  it("binds exactly the owned port with a hostile .env in cwd and :3000 occupied, then passes the full shutdown oracle", async () => {
    const hostileCwd = makeHostileCwdFixture();
    try {
      const releasePort3000 = await occupyForeignListener(3000);
      try {
        const run = await runServerLifecycle("api-server-shutdown-hostile", {
          cwd: hostileCwd,
        });
        // Scenario-contract guard: the selected port is distinct from every
        // hostile input, so the oracle below genuinely separates
        // "test-owned APP_PORT won" from "any hostile authority won".
        expect(run.port).not.toBe(3000);
        expect(run.port).not.toBe(HOSTILE_DOTENV_PORT);
        expect(run.port).not.toBe(HOSTILE_DOTENV_DEV_PORT);
        // The bind-equality oracle inside runServerLifecycle already failed
        // any shape where the admitted DEV_API_PORT/APP_PORT or the 3000
        // default owns the socket; reaching here means the real server.ts
        // child bound the test-owned port and the original SIGTERM oracle
        // completed on it.
        assertShutdownOracle(run);
      } finally {
        releasePort3000();
      }
    } finally {
      rmSync(hostileCwd, { recursive: true, force: true });
    }
  }, 120_000);
});

// ── #1055 / R-T1-3 hung-owner regression ─────────────────────────────────
// Production-isomorphic blocked tick: an ACCESS EXCLUSIVE lock on the
// child-schema `organizations` table makes every loop's org-discovery SELECT
// block server-side (TCP healthy, no statement/lock timeout on either side),
// so the in-flight tick promise never settles. The harness lock is taken
// BEFORE the child spawns, so the clientEventRetention startup pass and the
// email outbox's default-org wait — both issued during plugin registration —
// are provably pending when SIGTERM fires; pg_blocking_pids is the oracle
// that the lock really blocks a child query (the scenario cannot silently
// degrade into "no owner was hung"). The 250ms heartbeat/deadline ticks also
// hang on the same table, but postgres.js pipelining can share backends and
// their firing is boot-speed dependent, so they are not asserted here.

/** An open transaction holding ACCESS EXCLUSIVE on `<schema>.organizations`. */
interface OrganizationsTableLock {
  /** # of OTHER backends currently waiting on a lock this transaction holds. */
  blockedCount: () => Promise<number>;
  /** Diagnostic snapshot of those backends (pid + query prefix). */
  blockedDetails: () => Promise<string[]>;
  /** ROLLBACK + close — MUST run before the schema may be dropped. */
  release: () => Promise<void>;
}

async function acquireOrganizationsTableLock(
  childDbUrl: string,
): Promise<OrganizationsTableLock> {
  // max:1 pins every statement below (and the polling) to ONE backend, so
  // the explicit BEGIN..LOCK..ROLLBACK transaction stays coherent.
  const sql = postgres(childDbUrl, { max: 1 });
  await sql`BEGIN`;
  const pidRows = await sql`SELECT pg_backend_pid() AS pid`;
  const pid = pidRows[0]?.pid;
  if (pid === undefined) {
    await sql`ROLLBACK`;
    await sql.end({ timeout: 5 });
    throw new Error("pg_backend_pid() returned no row");
  }
  await sql`LOCK TABLE organizations IN ACCESS EXCLUSIVE MODE`;
  let released = false;
  return {
    blockedCount: async () => {
      const rows = await sql`
        SELECT count(*)::int AS n
        FROM pg_stat_activity
        WHERE pid <> ${pid}
          AND pg_blocking_pids(pid) @> ARRAY[${pid}]::int[]
      `;
      return rows[0]?.n ?? 0;
    },
    blockedDetails: async () => {
      const rows = await sql`
        SELECT pid, left(query, 80) AS q
        FROM pg_stat_activity
        WHERE pid <> ${pid}
          AND pg_blocking_pids(pid) @> ARRAY[${pid}]::int[]
        ORDER BY pid
      `;
      return rows.map((r) => `pid=${r.pid} q=${r.q}`);
    },
    release: async () => {
      if (released) return;
      released = true;
      await sql`ROLLBACK`;
      await sql.end({ timeout: 5 });
    },
  };
}

/**
 * Bounded poll for the causal precondition: the harness lock DEMONSTRABLY
 * blocks at least one child query (pg_blocking_pids names our transaction).
 *
 * WHY only ">= 1" and not one backend per loop owner: postgres.js pipelines
 * concurrent queries onto BUSY connections (postgres@3.4.9
 * src/index.js `handler()`: `busy.length ? go(busy.shift(), query)`), so the
 * four owners' org-discovery SELECTs can share one or two backends — a
 * backend COUNT is timing-dependent and cannot prove per-owner in-flight
 * state. The per-owner barrier for the assertions below is instead the
 * registration-order boundary: the clientEventRetention startup pass and the
 * email outbox's default-org wait issue their org SELECT synchronously
 * during plugin registration, which completes BEFORE `listen`. The readiness
 * oracle only fires after listen + a 200 on /api/health, so at SIGTERM those
 * two owners are provably pending (nothing can settle them while the table
 * is locked) — no 250ms tick race involved. The heartbeat/deadline ticks are
 * intentionally NOT asserted below for the same reason.
 */
async function waitForBlockedBackend(
  lock: OrganizationsTableLock,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const observed = await lock.blockedCount();
    if (observed >= 1) return;
    if (Date.now() > deadline) {
      const details = (await lock.blockedDetails()).join("; ");
      throw new Error(
        `no child backend blocked on the organizations lock within ${timeoutMs}ms — hung-owner precondition not established, scenario invalid. Blocked: ${details || "(none)"}`,
      );
    }
    await new Promise((r) => setTimeout(r, 200));
  }
}

HUNG_OWNER_DESCRIBE(
  "server SIGTERM lifecycle with a hung loop owner (child process)",
  () => {
    it("exits within the #351 total budget when an in-flight loop tick is blocked on a DB table lock", async () => {
      // Caller-owned isolated DB: the lock harness needs a connection into the
      // child's schema BEFORE spawn, and must release before the schema drop.
      const iso = await getIsolatedTestDb("api-server-shutdown-hung-owner");
      let lock: OrganizationsTableLock | undefined;
      let run: ChildRun | undefined;
      try {
        if (!iso.databaseUrl || !iso.schemaName) {
          throw new Error(
            "hung-owner scenario requires schema isolation (TEST_DB_ISOLATION must not be disabled)",
          );
        }
        const childDbUrl = addSearchPathToUrl(iso.databaseUrl, iso.schemaName);
        lock = await acquireOrganizationsTableLock(childDbUrl);
        const held = lock;
        run = await runServerLifecycle(undefined, {
          iso,
          env: {
            // Fast ticks: a loop owner is in-flight on the locked table within
            // a few hundred ms of readiness (HEARTBEAT_TIMEOUT_MS must stay a
            // multiple of 1000 — runtimeConfig contract).
            HEARTBEAT_SCAN_INTERVAL_MS: "250",
            HEARTBEAT_TIMEOUT_MS: "1000",
          },
          beforeSigterm: () =>
            waitForBlockedBackend(held, BLOCKED_BACKEND_WAIT_MS),
          exitKillMs: HUNG_OWNER_KILL_MS,
        });
      } finally {
        // OWNERSHIP: lock first, schema second — DROP SCHEMA cannot proceed
        // past an open transaction holding a table lock inside it.
        await lock?.release();
        await iso.cleanup();
      }
      if (!run) throw new Error("unreachable: runner must return or throw");

      // Diagnostics carry the child's own logs: under the unbounded onClose
      // await they end after the email-outbox drain line with NO exit, no
      // assist warn, and the harness kill (signal SIGKILL) at HUNG_OWNER_KILL_MS.
      const diag = `\ncode=${run.code} signal=${run.signal} exitAfterSigtermMs=${run.exitAfterSigtermMs}\n--- child stdout tail ---\n${run.stdout.split("\n").slice(-15).join("\n")}\n--- child stderr tail ---\n${run.stderr.split("\n").slice(-15).join("\n")}`;
      // The #351 total-budget bound is THE regression signal: an unbounded
      // onClose await cannot exit while the lock is held, so master fails here
      // (killed by the harness past the bound); a bounded-close fix abandons
      // the tick, lets db sql.end + the exit assist cut the leash, and exits
      // naturally well inside it. A leaked ref'ed race timer would likewise
      // hold the exit past its full budget — covered by the same bound.
      expect(run.exitAfterSigtermMs, diag).toBeLessThan(
        HUNG_OWNER_EXIT_BUDGET_MS,
      );
      expect(run.code, diag).toBe(0);
      expect(run.signal, diag).toBeNull();
      expect(run.stderr, diag).not.toContain("Graceful shutdown failed");
      // The assertions below cover ONLY owners proven pending at SIGTERM by
      // the registration-order barrier (see waitForBlockedBackend): the
      // email outbox's default-org wait and the retention startup pass.
      // Their bounded races must fire inside the shared window — the
      // email's pre-existing at-least-once redelivery path and #1055's new
      // abandonment diagnostics.
      expect(run.stdout, diag).toContain(
        "email outbox loop shutdown timeout; in-flight rows stay processing",
      );
      expect(run.stdout, diag).toContain(
        "Client-event retention shutdown timeout; in-flight pass abandoned",
      );
      // The heartbeat/deadline ticks are 250ms timer-driven: whether they are
      // in flight at SIGTERM depends on boot speed, so asserting their warns
      // here would be timing-dependent. Their bounded-close path is covered
      // deterministically by the raceLoopShutdown unit tests instead.
    }, 180_000);
  },
);
