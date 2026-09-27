import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

/**
 * Behavior contract of the production image entrypoint
 * (`docker-entrypoint.sh`, repository root) — the script the Dockerfile
 * ENTRYPOINT executes in every production container.
 *
 * Each case runs the REAL script with a fake `node` shim first on PATH, so
 * the migrate/server call sequence, exit codes, and rejection boundaries are
 * observed as actual process behavior, not by grepping the script text. No
 * database, network, or build output is involved: every `node` invocation is
 * intercepted and logged, and the script runs in an isolated cwd.
 *
 * #636: the entrypoint must only check config, run the canonical migration,
 * and exec the server. The removed RUN_SEED / FORCE_APP_MODE automatic-seed
 * interface must fail BEFORE migration or any data write.
 */

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const ENTRYPOINT = path.resolve(scriptDir, "../../../../docker-entrypoint.sh");

const MIGRATE = "dist/scripts/migrate.js";
const SERVER = "dist/server.js";

let workspace: string;
let callLog: string;

beforeEach(() => {
  workspace = mkdtempSync(path.join(tmpdir(), "entrypoint-contract-"));
  callLog = path.join(workspace, "calls.log");
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

/** Fake `node`: logs argv[1] to $CALL_LOG; fails migrate when $MIGRATE_EXIT is set. */
function installFakeNode(): string {
  const bin = path.join(workspace, "bin");
  mkdirSync(bin);
  writeFileSync(
    path.join(bin, "node"),
    [
      "#!/bin/sh",
      'printf \'%s\\n\' "$1" >> "$CALL_LOG"',
      'if [ "$1" = "dist/scripts/migrate.js" ] && [ -n "${MIGRATE_EXIT:-}" ]; then',
      '  exit "$MIGRATE_EXIT"',
      "fi",
      "exit 0",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  return bin;
}

interface RunOutcome {
  status: number;
  output: string;
  calls: string[];
}

function runEntrypoint(extraEnv: Record<string, string> = {}): RunOutcome {
  const bin = installFakeNode();
  const result = spawnSync("sh", [ENTRYPOINT], {
    cwd: workspace,
    env: {
      PATH: `${bin}:${process.env.PATH ?? ""}`,
      HOME: workspace,
      JWT_SECRET: "test-jwt-secret",
      CALL_LOG: callLog,
      ...extraEnv,
    },
  });
  const calls = existsSync(callLog)
    ? readFileSync(callLog, "utf8").split("\n").filter(Boolean)
    : [];
  return {
    status: result.status ?? -1,
    output: `${result.stdout?.toString() ?? ""}${result.stderr?.toString() ?? ""}`,
    calls,
  };
}

describe("docker-entrypoint.sh behavior contract", () => {
  it("normal startup runs the canonical migration then execs the server and never seeds", () => {
    const run = runEntrypoint();
    expect(run.status).toBe(0);
    expect(run.calls).toEqual([MIGRATE, SERVER]);
  });

  it("unset and empty RUN_SEED / FORCE_APP_MODE behave like normal startup", () => {
    const run = runEntrypoint({ RUN_SEED: "", FORCE_APP_MODE: "" });
    expect(run.status).toBe(0);
    expect(run.calls).toEqual([MIGRATE, SERVER]);
  });

  it("still requires JWT_SECRET and fails before any command", () => {
    const run = runEntrypoint({ JWT_SECRET: "" });
    expect(run.status).not.toBe(0);
    expect(run.calls).toEqual([]);
    expect(run.output).toContain("JWT_SECRET");
  });

  it("rejects RUN_SEED=1 before migration and names the supported alternatives", () => {
    const run = runEntrypoint({ RUN_SEED: "1" });
    expect(run.status).not.toBe(0);
    expect(run.calls).toEqual([]);
    expect(run.output).toContain("RUN_SEED");
    expect(run.output).toContain("db:seed:e2e");
    expect(run.output).toContain("bootstrap-admin");
  });

  it("rejects RUN_SEED=e2e before migration", () => {
    const run = runEntrypoint({ RUN_SEED: "e2e" });
    expect(run.status).not.toBe(0);
    expect(run.calls).toEqual([]);
    expect(run.output).toContain("RUN_SEED");
    expect(run.output).toContain("db:seed:e2e");
  });

  it("rejects any other non-empty RUN_SEED value (no warn-and-continue)", () => {
    const run = runEntrypoint({ RUN_SEED: "yes" });
    expect(run.status).not.toBe(0);
    expect(run.calls).toEqual([]);
  });

  it("rejects a non-empty FORCE_APP_MODE (no seed-driven mode switch)", () => {
    const run = runEntrypoint({ FORCE_APP_MODE: "development" });
    expect(run.status).not.toBe(0);
    expect(run.calls).toEqual([]);
    expect(run.output).toContain("FORCE_APP_MODE");
  });

  it("a migration failure aborts startup before the server", () => {
    const run = runEntrypoint({ MIGRATE_EXIT: "1" });
    expect(run.status).not.toBe(0);
    expect(run.calls).toEqual([MIGRATE]);
  });
});
