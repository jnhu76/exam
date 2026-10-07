import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { projectTestDatabaseUrl } from "./testDatabaseUrlCli.js";

/**
 * #733 R6 (F-07) — contract of the canonical TEST_DATABASE_TARGET executable
 * projection.
 *
 * Shell test-schema tooling must not resolve the test target itself, so it
 * shells out to `pnpm --filter @exam/db exec tsx src/testDatabaseUrlCli.ts`.
 * These tests pin the projection's own contract — that it DELEGATES to
 * `resolveTestBranchUrl` and honors the stdout/exit discipline — not the
 * precedence grammar itself: the canonical matrix lives in
 * `databaseUrl.test.ts`, and the consumers observing the projection end to end
 * live in `testDatabaseTargetShellConsumers.test.ts`.
 *
 * STDOUT discipline is load-bearing: the caller captures with
 * `DB_URL="$(…)"`, so stdout must carry the URL and nothing else; diagnostics
 * belong on stderr and must come with a non-zero exit so `set -e` callers
 * stop before any psql command runs.
 */

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

/** In-memory sink pair capturing what the projection writes. */
function captureSinks() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out: { write: (chunk: string) => out.push(chunk) },
    err: { write: (chunk: string) => err.push(chunk) },
    stdout: () => out.join(""),
    stderr: () => err.join(""),
  };
}

describe("projectTestDatabaseUrl delegates to the canonical resolver", () => {
  it("TEST_DATABASE_URL wins over a hostile DATABASE_URL", () => {
    const sinks = captureSinks();
    const code = projectTestDatabaseUrl(
      {
        DATABASE_URL: "postgresql://decoy:a@localhost:9991/decoy_a",
        TEST_DATABASE_URL: "postgresql://exam:exam@localhost:9992/exam_test",
      },
      sinks.out,
      sinks.err,
    );
    expect(code).toBe(0);
    expect(sinks.stdout()).toBe(
      "postgresql://exam:exam@localhost:9992/exam_test\n",
    );
    expect(sinks.stderr()).toBe("");
  });

  it("falls back to the legacy TEST_DB_URL alias", () => {
    const sinks = captureSinks();
    const code = projectTestDatabaseUrl(
      {
        DATABASE_URL: "postgresql://decoy:a@localhost:9991/decoy_a",
        TEST_DB_URL: "postgresql://exam:exam@localhost:9993/exam_test",
      },
      sinks.out,
      sinks.err,
    );
    expect(code).toBe(0);
    expect(sinks.stdout()).toBe(
      "postgresql://exam:exam@localhost:9993/exam_test\n",
    );
  });

  it("treats set-but-empty inputs as unset (canonical empty semantics)", () => {
    const sinks = captureSinks();
    const code = projectTestDatabaseUrl(
      {
        TEST_DATABASE_URL: "",
        TEST_DB_URL: "postgresql://exam:exam@localhost:9993/exam_test",
      },
      sinks.out,
      sinks.err,
    );
    expect(code).toBe(0);
    expect(sinks.stdout()).toBe(
      "postgresql://exam:exam@localhost:9993/exam_test\n",
    );

    const constructed = captureSinks();
    const constructedCode = projectTestDatabaseUrl(
      {
        TEST_DATABASE_URL: "",
        TEST_DB_URL: "",
        DB_HOST_PORT: "55432",
        DATABASE_URL: "postgresql://decoy:a@localhost:9991/decoy_a",
      },
      constructed.out,
      constructed.err,
    );
    expect(constructedCode).toBe(0);
    expect(constructed.stdout()).toBe(
      "postgresql://exam:exam@localhost:55432/exam_test\n",
    );
  });

  it("constructs the implicit local target from DB_HOST_PORT and ignores DATABASE_URL", () => {
    const sinks = captureSinks();
    const code = projectTestDatabaseUrl(
      {
        DB_HOST_PORT: "55432",
        DATABASE_URL: "postgresql://decoy:a@localhost:9991/decoy_a",
      },
      sinks.out,
      sinks.err,
    );
    expect(code).toBe(0);
    expect(sinks.stdout()).toBe(
      "postgresql://exam:exam@localhost:55432/exam_test\n",
    );
  });

  it("rejects an unsafe test database name on stderr with exit 1 and clean stdout", () => {
    const sinks = captureSinks();
    const code = projectTestDatabaseUrl(
      { TEST_DATABASE_URL: "postgresql://exam:exam@localhost:5432/exam" },
      sinks.out,
      sinks.err,
    );
    expect(code).toBe(1);
    expect(sinks.stdout()).toBe("");
    expect(sinks.stderr()).toContain('does not contain "test"');
  });

  it("preserves the canonical ALLOW_UNSAFE_TEST_DATABASE_URL escape hatch", () => {
    const sinks = captureSinks();
    const code = projectTestDatabaseUrl(
      {
        TEST_DATABASE_URL: "postgresql://exam:exam@localhost:5432/exam",
        ALLOW_UNSAFE_TEST_DATABASE_URL: "1",
      },
      sinks.out,
      sinks.err,
    );
    expect(code).toBe(0);
    expect(sinks.stdout()).toBe("postgresql://exam:exam@localhost:5432/exam\n");
  });
});

describe("executable contract (spawned process)", () => {
  // Spawned via the raw tsx loader so the assertions cover exactly what the
  // CLI process writes. The pnpm wrapper path (`pnpm --filter @exam/db exec
  // tsx src/testDatabaseUrlCli.ts`) is exercised end to end by the consumer
  // proofs in testDatabaseTargetShellConsumers.test.ts; the wrapper adds its
  // own diagnostics on failure, which `set -e` callers discard with the
  // aborted capture.
  const cliPath = fileURLToPath(
    new URL("./testDatabaseUrlCli.ts", import.meta.url),
  );
  const tsxLoaderUrl = String(import.meta.resolve("tsx"));

  // Allowlist env so hostile inputs come only from the fixture — the vitest
  // worker may carry TEST_DATABASE_URL (CI) or DB_HOST_PORT of its own.
  function baseEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const key of ["PATH", "HOME", "LANG", "TERM", "TZ", "TMPDIR"]) {
      if (process.env[key] !== undefined) env[key] = process.env[key];
    }
    return env;
  }

  function runCli(env: NodeJS.ProcessEnv) {
    return spawnSync(process.execPath, ["--import", tsxLoaderUrl, cliPath], {
      cwd: REPO_ROOT,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
    });
  }

  it("writes exactly the URL + newline to stdout and exits 0", () => {
    const run = runCli({
      ...baseEnv(),
      DATABASE_URL: "postgresql://decoy:a@localhost:9991/decoy_a",
      TEST_DATABASE_URL: "postgresql://exam:exam@localhost:9992/exam_test",
    });
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toBe(
      "postgresql://exam:exam@localhost:9992/exam_test\n",
    );
  });

  it("fails with a clean stdout and a stderr reason the caller can surface", () => {
    const run = runCli({
      ...baseEnv(),
      TEST_DATABASE_URL: "postgresql://exam:exam@localhost:5432/exam",
    });
    expect(run.status).not.toBe(0);
    expect(run.stdout).toBe("");
    expect(run.stderr).toContain("testDatabaseUrlCli");
    expect(run.stderr).toContain('does not contain "test"');
  });
});
