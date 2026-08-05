// scripts/e2e/run-wsl-lib.test.mjs
//
// Node test runner that drives scripts/e2e/run-wsl-lib.test.sh scenarios,
// isolating each scenario in a fresh `bash` and (for docker-dependent ones)
// prepending a fake-bin dir to PATH so no real database or process is touched.
//
// Why a node:test wrapper around a bash scenario file:
//   The library under test (run-wsl-lib.sh) is Bash. The repo's standard test
//   runner is `node --test` (see scripts/formal/run-operator-grant-tlc.test.mjs
//   for the precedent). We keep that convention: this file is what `verify`
//   invokes, and it shells out to bash for the bash-level assertions.
//
// Run:  node --test scripts/e2e/run-wsl-lib.test.mjs

import assert from "node:assert/strict";
import test from "node:test";
import child_process from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_SH = join(__dirname, "run-wsl-lib.test.sh");

// Scenarios that depend on `docker exec ... psql`: we provide a fake `docker`
// on PATH. Its behavior is controlled by env vars read here.
const DOCKER_SCENARIOS = new Set(["drop-failure-loud", "drop-success"]);

/**
 * Run one scenario in a fresh bash, returning {code, stdout, stderr}.
 * For docker-dependent scenarios, install a fake `docker` on PATH.
 */
function runScenario(scenario, { dockerFail = false } = {}) {
  const env = {
    ...process.env,
    // Keep the test quiet/fast; the lib sleeps in wait_for_process_exit.
    E2E_TEST_MODE: "1",
  };

  let fakeBin = "";
  if (DOCKER_SCENARIOS.has(scenario)) {
    const tmp = mkdtempSync(join(tmpdir(), "e2e-fakebin-"));
    fakeBin = tmp;
    // Fake docker: only responds to `exec <cid> psql ...`. Fails or succeeds
    // based on dockerFail. Captures the SQL it was asked to run (not asserted
    // here; the bash scenario handles the loud-failure assertions).
    const dockerScript = join(fakeBin, "docker");
    writeFileSync(
      dockerScript,
      dockerFail
        ? `#!/usr/bin/env bash
# fake docker (failure mode) — echo a realistic PG error to stderr, exit 1.
echo 'ERROR: database "exam_e2e_w7" is being accessed by other users' >&2
echo 'DETAIL: There is 1 other session using the database.' >&2
exit 1
`
        : `#!/usr/bin/env bash
# fake docker (success mode) — DROP DATABASE IF EXISTS ... WITH (FORCE) ok.
exit 0
`,
      { mode: 0o755 },
    );
    env.PATH = `${fakeBin}:${process.env.PATH}`;
  }

  try {
    const res = child_process.spawnSync("bash", [TEST_SH, scenario], {
      env,
      encoding: "utf8",
      timeout: 60000,
    });
    return {
      code: res.status ?? -1,
      stdout: res.stdout ?? "",
      stderr: res.stderr ?? "",
    };
  } finally {
    if (fakeBin) rmSync(fakeBin, { recursive: true, force: true });
  }
}

/** Assert the scenario passed (exit 0) and stdout contains "PASS". */
function assertPass(scenario, res) {
  assert.equal(
    res.code,
    0,
    `${scenario}: expected exit 0, got ${res.code}\nstdout:\n${res.stdout}\nstderr:\n${res.stderr}`,
  );
  assert.match(
    res.stdout,
    /PASS/,
    `${scenario}: stdout missing PASS marker\n${res.stdout}\n${res.stderr}`,
  );
}

// ── Contract 4: prefix guard ─────────────────────────────────────────────
test("prefix-guard: rejects unsafe DB names, accepts safe ones", () => {
  const res = runScenario("prefix-guard");
  assertPass("prefix-guard", res);
});

// ── Contract 1: cleanup ordering (DROP after stop+wait) ──────────────────
test("ordering: DROP runs strictly after server stop + bounded wait", () => {
  const res = runScenario("ordering");
  assertPass("ordering", res);
});

// ── Contract 2: DROP failure is loud ─────────────────────────────────────
test("drop-failure-loud: nonzero rc + stderr names the db (no swallow)", () => {
  const res = runScenario("drop-failure-loud", { dockerFail: true });
  assertPass("drop-failure-loud", res);
});

// ── Happy path DROP ──────────────────────────────────────────────────────
test("drop-success: returns 0 when docker drop succeeds", () => {
  const res = runScenario("drop-success");
  assertPass("drop-success", res);
});

// ── Contract 3: exit-code matrix ─────────────────────────────────────────
test("exit-matrix-pass-pass: PW 0 + clean cleanup → 0", () => {
  const res = runScenario("exit-matrix-pass-pass");
  assert.equal(res.code, 0, res.stderr);
  assert.match(res.stdout, /PASS:0/);
});

test("exit-matrix-fail-pass: PW 7 + clean cleanup → 7 (not masked)", () => {
  const res = runScenario("exit-matrix-fail-pass");
  assert.equal(res.code, 0, res.stderr); // scenario itself exits 0
  assert.match(res.stdout, /PASS:7/);
});

test("exit-matrix-pass-fail: PW 0 + dirty cleanup → nonzero (70 sentinel)", () => {
  const res = runScenario("exit-matrix-pass-fail");
  assert.equal(res.code, 0, res.stderr);
  assert.match(res.stdout, /PASS:70/);
});

test("exit-matrix-fail-fail: PW 7 + dirty cleanup → 7 (cleanup can't add)", () => {
  const res = runScenario("exit-matrix-fail-fail");
  assert.equal(res.code, 0, res.stderr);
  assert.match(res.stdout, /PASS:7/);
});

// ── Contract 5: idempotent cleanup ───────────────────────────────────────
test("cleanup-idempotent: run_cleanup twice → exactly one DROP per db", () => {
  const res = runScenario("cleanup-idempotent");
  assertPass("cleanup-idempotent", res);
});

// ── Bounded wait ─────────────────────────────────────────────────────────
test("wait-for-exit-bounded: returns 1 on timeout, 0 when pid gone", () => {
  const res = runScenario("wait-for-exit-bounded");
  assertPass("wait-for-exit-bounded", res);
});

// ── Retention semantics (spec §8) ────────────────────────────────────────
test("keep-on-failure: KEEP flag retains worker DB on test failure", () => {
  const res = runScenario("keep-on-failure");
  assertPass("keep-on-failure", res);
});

test("keep-clears-on-success: KEEP flag does NOT retain on success", () => {
  const res = runScenario("keep-clears-on-success");
  assertPass("keep-clears-on-success", res);
});

// ── Signal cleanup (spec §9.4) ───────────────────────────────────────────
test("signal-cleanup-once: TERM fires cleanup exactly once", () => {
  const res = runScenario("signal-cleanup-once");
  assertPass("signal-cleanup-once", res);
});
