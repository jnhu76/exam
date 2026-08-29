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
 */
import { describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPostgresDatabase } from "@exam/db/src/postgres.js";
import { getIsolatedTestDb, resolveTestDbUrl } from "@exam/db/src/testDb.js";
import { addSearchPathToUrl } from "@exam/db/src/testIsolation.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = resolve(__dirname, "server.ts");
const require = createRequire(import.meta.url);
const TSX_CLI = require.resolve("tsx/cli");

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

async function runServerLifecycle(): Promise<ChildRun> {
  const iso = await getIsolatedTestDb("api-server-shutdown");
  // Shared-DB fallback (isolation disabled) has no schemaName; the base
  // test URL is then correct as-is.
  const baseUrl = iso.databaseUrl ?? resolveTestDbUrl();
  const childDbUrl = iso.schemaName
    ? addSearchPathToUrl(baseUrl, iso.schemaName)
    : baseUrl;

  const child = spawn(process.execPath, [TSX_CLI, SERVER_PATH], {
    env: {
      // The server is env-driven; neutralize inherited test-mode vars so the
      // explicit values below are the only inputs (same contract as the
      // rollback CLI subprocess tests).
      APP_MODE: "",
      TEST_DATABASE_URL: undefined,
      TEST_DB_URL: undefined,
      ALLOW_UNSAFE_TEST_DATABASE_URL: undefined,
      NODE_ENV: "development",
      DATABASE_URL: childDbUrl,
      JWT_SECRET: "shutdown-test-jwt-secret-0123456789abcdef",
      APP_PORT: "0",
      HOST: "127.0.0.1",
      EMAIL_ENABLED: "false",
      EMAIL_WORKER_POLL_INTERVAL_MS: "250",
      EMAIL_WORKER_SHUTDOWN_TIMEOUT_MS: String(CHILD_SHUTDOWN_TIMEOUT_MS),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

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
    // Readiness = "Server listening at http://127.0.0.1:<port>" (APP_PORT=0
    // → the kernel picks the port; parse it from the boot log), then the
    // /api/health probe must answer 200.
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

PG_DESCRIBE("server SIGTERM lifecycle (child process)", () => {
  it("exits naturally with code 0 after SIGTERM, bounded under the shutdown budget", async () => {
    const run = await runServerLifecycle();

    // Diagnostic context on every failure: the child's own logs explain
    // WHERE in boot/shutdown it died (exit 143 = default SIGTERM
    // disposition — a mid-close listener window or pre-listener death).
    const diag = `\ncode=${run.code} signal=${run.signal} exitAfterSigtermMs=${run.exitAfterSigtermMs}\n--- child stdout tail ---\n${run.stdout.split("\n").slice(-15).join("\n")}\n--- child stderr tail ---\n${run.stderr.split("\n").slice(-15).join("\n")}`;
    expect(run.code, diag).toBe(0);
    expect(run.signal, diag).toBeNull();
    // The bound is the regression signal: a leaked, ref'ed shutdown race
    // timer would delay natural exit by the full CHILD_SHUTDOWN_TIMEOUT_MS.
    expect(run.exitAfterSigtermMs, diag).toBeLessThan(
      MAX_EXIT_AFTER_SIGTERM_MS,
    );
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
  }, 120_000);
});
