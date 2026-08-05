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
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_SH = join(__dirname, "run-wsl-lib.test.sh");
const RUN_WSL_SH = join(__dirname, "run-wsl.sh");

// Scenarios that depend on `docker`: a fake `docker` is installed on PATH.
//   drop scenarios         — `docker exec <cid> psql ...` (fail/succeed).
//   compose scenarios      — `docker compose ps -q db` / `down -v`, with
//                             behavior per FAKE_COMPOSE_* env; every call is
//                             logged to $FAKE_DOCKER_LOG so scenarios can
//                             assert teardown did (not) run.
const DOCKER_SCENARIOS = new Set(["drop-failure-loud", "drop-success"]);
const COMPOSE_SCENARIOS = new Set([
  "keep-server-preserves-all",
  "keep-on-failure-preserves-compose",
  "compose-ps-failure",
  "compose-ps-missing",
  "compose-down-failure",
]);

/**
 * Run one scenario in a fresh bash, returning {code, stdout, stderr}.
 * For docker-dependent scenarios, install a fake `docker` on PATH.
 */
function runScenario(
  scenario,
  { dockerFail = false, composePs = "cid", composeDown = "ok" } = {},
) {
  const env = {
    ...process.env,
    // Keep the test quiet/fast; the lib sleeps in wait_for_process_exit.
    E2E_TEST_MODE: "1",
  };

  let fakeBin = "";
  const needsDocker =
    DOCKER_SCENARIOS.has(scenario) || COMPOSE_SCENARIOS.has(scenario);
  if (needsDocker) {
    const tmp = mkdtempSync(join(tmpdir(), "e2e-fakebin-"));
    fakeBin = tmp;
    const logPath = join(tmp, "docker.log");
    env.FAKE_DOCKER_LOG = logPath;
    env.FAKE_DOCKER_PSQL_FAIL = dockerFail ? "1" : "0";
    env.FAKE_COMPOSE_PS = composePs;
    env.FAKE_COMPOSE_DOWN = composeDown;
    writeFileSync(
      join(fakeBin, "docker"),
      `#!/usr/bin/env bash
# fake docker (test double): log every invocation, then behave per env.
printf '%s\\n' "$*" >> "\${FAKE_DOCKER_LOG:-/dev/null}"
# worker-DB drop scenarios: docker exec <cid> psql -U exam -d postgres ...
if [[ "$1" == "exec" ]] && [[ "$*" == *"psql"* ]]; then
  if [[ "\${FAKE_DOCKER_PSQL_FAIL:-0}" == "1" ]]; then
    echo 'ERROR: database "exam_e2e_w7" is being accessed by other users' >&2
    echo 'DETAIL: There is 1 other session using the database.' >&2
    exit 1
  fi
  exit 0
fi
# compose scenarios: dispatch on EXACT argument tokens (a \`-f\` file path must
# never match a "ps"/"down" substring check on "$*").
if [[ "$1" == "compose" ]]; then
  _tok=""
  for _a in "\${@:2}"; do
    case "$_a" in
      ps) _tok="ps"; break ;;
      down) _tok="down"; break ;;
    esac
  done
  if [[ "$_tok" == "ps" ]]; then
    case "\${FAKE_COMPOSE_PS:-cid}" in
      fail) echo "fake: compose ps failed" >&2; exit 1 ;;
      empty) exit 0 ;;
      *) echo "fake-db-cid" ;;
    esac
    exit 0
  fi
  if [[ "$_tok" == "down" ]]; then
    if [[ "\${FAKE_COMPOSE_DOWN:-ok}" == "fail" ]]; then
      echo "fake: compose down failed" >&2; exit 1
    fi
  fi
fi
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

// ── P2-2: real EXIT trap chain, not just the pure function ───────────────
test("exit-trap-matrix: real EXIT trap produces the 4-cell priority matrix", () => {
  const res = runScenario("exit-trap-matrix");
  assertPass("exit-trap-matrix", res);
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

// ── P1-2 / P1-3: CLI flag validation ─────────────────────────────────────
test("flag-validation: --keep-server / --no-reseed rejected for parallel", () => {
  const res = runScenario("flag-validation");
  assertPass("flag-validation", res);
});

// ── P1-3: serial DB persistence (--no-reseed reuse validity) ─────────────
test("serial-persists-on-success: serial exam_e2e survives a clean run", () => {
  const res = runScenario("serial-persists-on-success");
  assertPass("serial-persists-on-success", res);
});

// ── P1-1: serial failure paths know + keep the DB identity ───────────────
test("serial-migrate-failure-keeps: cleanup names + keeps exam_e2e on migrate failure", () => {
  const res = runScenario("serial-migrate-failure-keeps");
  assertPass("serial-migrate-failure-keeps", res);
});

test("serial-wait-health-failure-keeps: cleanup names + keeps exam_e2e on health failure", () => {
  const res = runScenario("serial-wait-health-failure-keeps");
  assertPass("serial-wait-health-failure-keeps", res);
});

// ── P1-2: KEEP_SERVER preserves server + DB + compose (PASS & FAIL) ──────
test("keep-server-preserves-all: KEEP_SERVER keeps server + DB + compose", () => {
  const res = runScenario("keep-server-preserves-all", { composePs: "cid" });
  assertPass("keep-server-preserves-all", res);
});

// ── P1-4: loud compose teardown failures ─────────────────────────────────
test("compose-ps-failure: docker compose ps error → cleanup failure", () => {
  const res = runScenario("compose-ps-failure", { composePs: "fail" });
  assertPass("compose-ps-failure", res);
});

test("compose-ps-missing: no DB container with pending drops → cleanup failure", () => {
  const res = runScenario("compose-ps-missing", { composePs: "empty" });
  assertPass("compose-ps-missing", res);
});

test("compose-down-failure: docker compose down error → cleanup failure", () => {
  const res = runScenario("compose-down-failure", {
    composePs: "cid",
    composeDown: "fail",
  });
  assertPass("compose-down-failure", res);
});

// ── P1-1: parallel failure path covers every registered DB ───────────────
test("parallel-failure-cleans-all: migrate failure drops every registered worker DB", () => {
  const res = runScenario("parallel-failure-cleans-all");
  assertPass("parallel-failure-cleans-all", res);
});

test("parallel-failure-retains-all: keep flag retains every registered worker DB", () => {
  const res = runScenario("parallel-failure-retains-all");
  assertPass("parallel-failure-retains-all", res);
});

// ── Round-2 P1: keep-on-failure must preserve a script-started compose ────
test("keep-on-failure-preserves-compose: keep flag skips compose down -v", () => {
  const res = runScenario("keep-on-failure-preserves-compose", {
    composePs: "cid",
  });
  assertPass("keep-on-failure-preserves-compose", res);
});

// ── Round-2 P2: run_cleanup stops a group whose leader already died ──────
test("cleanup-stops-orphaned-group: run_cleanup KILLs the orphaned PGID", () => {
  const res = runScenario("cleanup-stops-orphaned-group");
  assertPass("cleanup-stops-orphaned-group", res);
});

// ── P2-1: whole-group shutdown ───────────────────────────────────────────
test("process-group-child-survives: TERM-ignoring child is KILLed with the group", () => {
  const res = runScenario("process-group-child-survives");
  assertPass("process-group-child-survives", res);
});

// ── Signal handling (spec §9.4 + P2-2) ───────────────────────────────────
test("signal-exit-codes: TERM → 143, INT → 130, cleanup exactly once", () => {
  const res = runScenario("signal-exit-codes");
  assertPass("signal-exit-codes", res);
});

// ── P1-1: registration timing in run-wsl.sh (structural contract) ────────
// The behavioral scenarios cover what cleanup does WITH registered identities;
// these assertions pin WHERE run-wsl.sh registers them — before any operation
// that can fail (migrate/seed/health), so no exit path leaks a DB.
test("run-wsl.sh: DB identities are registered before any failing op", () => {
  const src = readFileSync(RUN_WSL_SH, "utf8");
  // Parallel: the registration sits inside the per-shard setup loop,
  // immediately before ensure_db_exists.
  assert.match(
    src,
    /SHARD_WORKER_DBS\+=\(\"\$\{WORKER_DB_PREFIX\}\$\{i\}\"\)\s*\n\s*ensure_db_exists "\$\{WORKER_DB_PREFIX\}\$\{i\}"/,
    "parallel registration must precede ensure_db_exists",
  );
  // Serial: registration precedes ensure_db_exists (comment lines in between
  // are allowed; the old late registration after wait_health had ensure
  // BEFORE the registration and must not match).
  assert.match(
    src,
    /WORKER_DBS_SERIAL=\(\"\$E2E_DB_NAME\"\)\n(?:[^\n]*\n)*?\s*ensure_db_exists "\$E2E_DB_NAME"/,
    "serial registration must precede ensure_db_exists",
  );
  // The old late serial registration (after wait_health) must be gone.
  const sites = src.match(/WORKER_DBS_SERIAL=\(\"\$E2E_DB_NAME\"\)/g) ?? [];
  assert.equal(sites.length, 1, "exactly one serial registration site");
});

// ── P1-2 / P1-3: fail-fast guards run before any side effect ─────────────
test("run-wsl.sh: flag validation runs before compose up", () => {
  const lines = readFileSync(RUN_WSL_SH, "utf8").split("\n");
  const guardIdx = lines.findIndex((l) =>
    l.includes('validate_run_flags "$RESEED"'),
  );
  const upIdx = lines.findIndex((l) =>
    l.includes('compose -f "$DEV_COMPOSE" up -d'),
  );
  assert.ok(guardIdx >= 0, "validate_run_flags call must exist");
  assert.ok(upIdx > guardIdx, "flag validation must run before compose up");
});
