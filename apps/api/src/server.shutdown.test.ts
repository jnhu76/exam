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
 * Configuration authority (#688, #733 R1): the child is a test-owned
 * subprocess, so it runs under the MANAGED test profile. The previous
 * development-profile shape admitted the developer root `.env`
 * (loadRootEnv law) and projected `APP_PORT` into the leaf development
 * IGNORES (`DEV_API_PORT ?? 3000` owns the bind) — the child could bind the
 * developer's port instead of the test-owned one while every assertion
 * stayed green. The readiness oracle therefore additionally requires the
 * child's OWN listen record to name exactly the owned port, and a hostile
 * regression below kills the old shape under an admitted hostile `.env`
 * plus an occupied default port.
 */
import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPostgresDatabase } from "@exam/db/src/postgres.js";
import { getIsolatedTestDb, resolveTestDbUrl } from "@exam/db/src/testDb.js";
import { addSearchPathToUrl } from "@exam/db/src/testIsolation.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = resolve(__dirname, "server.ts");
const TSX_IMPORT_SPECIFIER = import.meta.resolve("tsx");

/** A leaked shutdown timer would hold the exit for the FULL budget. */
const CHILD_SHUTDOWN_TIMEOUT_MS = 6_000;
/** Natural exit must beat the leaked-timer counterfactual comfortably. */
const MAX_EXIT_AFTER_SIGTERM_MS = 5_000;
const BOOT_TIMEOUT_MS = 45_000;

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

interface ChildRun {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  exitAfterSigtermMs: number;
  port: number;
}

async function runServerLifecycle(
  namespace = "api-server-shutdown",
): Promise<ChildRun> {
  const iso = await getIsolatedTestDb(namespace);
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
      },
      stdio: ["ignore", "pipe", "pipe"],
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

    const sigtermAt = Date.now();
    child.kill("SIGTERM");

    const result = await new Promise<
      Omit<ChildRun, "exitAfterSigtermMs" | "port">
    >((resolveClose, reject) => {
      const killTimer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(
          new Error(
            `server did not exit within ${MAX_EXIT_AFTER_SIGTERM_MS * 4}ms of SIGTERM (leaked lifecycle owner?)\nstdout: ${stdout}\nstderr: ${stderr}`,
          ),
        );
      }, MAX_EXIT_AFTER_SIGTERM_MS * 4);
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
    await iso.cleanup();
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

// ── #688 hostile regression owner ───────────────────────────────────────
// The old development-profile shape must fail under exactly the conditions
// that made #688 silent: a developer `.env` carrying its own port keys and
// the default 3000 occupied. C=46001/D=46002 sit outside the child's
// [20000, 40000) selection range and away from 3000, so the scenario
// contract "P != C, P != D, P != 3000" holds by construction (asserted in
// the test for explicitness).

const HOSTILE_DOTENV_PORT = 46_001; // hostile APP_PORT (C)
const HOSTILE_DOTENV_DEV_PORT = 46_002; // hostile DEV_API_PORT (D)

/**
 * The loader's FIRST candidate path (`resolveRootEnvPaths`): an
 * `apps/api/.env` shadows the same keys in a developer's root `.env`, so
 * the fixture never needs to touch the developer's real root file. The
 * fixture exists only for the duration of `run`; if a file was already
 * present it is restored byte-for-byte and the restore is proven.
 */
async function withHostileRootEnv<T>(run: () => Promise<T>): Promise<T> {
  const fixturePath = resolve(__dirname, "../.env");
  const body = `APP_PORT=${HOSTILE_DOTENV_PORT}\nDEV_API_PORT=${HOSTILE_DOTENV_DEV_PORT}\n`;
  const preExisting = existsSync(fixturePath);
  const backup = preExisting ? readFileSync(fixturePath) : null;
  writeFileSync(fixturePath, body);
  try {
    return await run();
  } finally {
    if (backup === null) {
      rmSync(fixturePath);
      if (existsSync(fixturePath)) {
        throw new Error(
          "hostile .env fixture cleanup failed — file still present",
        );
      }
    } else {
      writeFileSync(fixturePath, backup);
      if (!readFileSync(fixturePath).equals(backup)) {
        throw new Error(
          "hostile .env fixture restore failed — restored file differs from backup",
        );
      }
    }
  }
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

  it("binds exactly the owned port under a hostile developer .env with :3000 occupied, then passes the full shutdown oracle", async () => {
    await withHostileRootEnv(async () => {
      const releasePort3000 = await occupyForeignListener(3000);
      try {
        const run = await runServerLifecycle("api-server-shutdown-hostile");
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
    });
  }, 120_000);
});
