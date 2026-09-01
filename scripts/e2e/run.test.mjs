// scripts/e2e/run.test.mjs
//
// node:test suite for scripts/e2e/run.sh — the Docker E2E runner's EXIT /
// cleanup semantics, exercised end-to-end WITHOUT real Docker.
//
// How it works:
//   Each scenario spawns `bash run.sh` with a fake bin dir prepended to PATH
//   holding stub `docker` (+ `ss`/`lsof`) commands. The fake `docker` logs
//   every invocation to $FAKE_DOCKER_LOG and behaves per FAKE_* env:
//     FAKE_TEST_EXIT — exit code of `compose run` (the Playwright container)
//     FAKE_DOWN_EXIT — exit code of `compose down -v --remove-orphans`
//     FAKE_EXEC_EXIT — exit code of `compose exec` (in-container preflight)
//   The health probe always reports "healthy" and host ports always look
//   free, so every scenario reaches the Playwright step in well under 1s.
//
// Contract under test (same priority matrix as run-wsl-lib.sh
// compute_final_exit — issue #375):
//   tests | cleanup | final
//   pass  | pass    | 0
//   fail  | pass    | test/preflight exit code
//   pass  | fail    | 70 (cleanup-failure sentinel)
//   fail  | fail    | test/preflight exit code; cleanup error as diagnostics
//   KEEP_STACK=1     | no `compose down` at all, exit code preserved
//
// Run:  node --test scripts/e2e/run.test.mjs   (wired into pnpm
//       test:e2e-runner alongside the run-wsl-lib suite)

import assert from "node:assert/strict";
import test from "node:test";
import child_process from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUN_SH = join(__dirname, "run.sh");

// The fake `docker` dispatches on the compose/docker subcommand token. Every
// invocation is logged so scenarios can assert teardown did (not) run.
const FAKE_DOCKER = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "\${FAKE_DOCKER_LOG:-/dev/null}"
_tok=""
for _a in "$@"; do
  case "$_a" in
    version|inspect|build|up|ps|exec|run|down|logs) _tok="$_a"; break ;;
  esac
done
case "$_tok" in
  version) exit 0 ;;
  inspect) echo "healthy" ;;
  ps) echo "fake-app-cid" ;;
  build|up|logs) exit 0 ;;
  exec) exit "\${FAKE_EXEC_EXIT:-0}" ;;
  run) exit "\${FAKE_TEST_EXIT:-0}" ;;
  down) exit "\${FAKE_DOWN_EXIT:-0}" ;;
esac
exit 0
`;

// run.sh only rejects host ports when `ss`/`lsof` report a listener; empty
// output means "port free", so the preflight passes on any host.
const FAKE_PORT_PROBE = `#!/usr/bin/env bash
exit 0
`;

/** Spawn `bash run.sh` with the fake bin dir on PATH; knobs become env. */
function runRunSh(knobs = {}) {
  const tmp = mkdtempSync(join(tmpdir(), "e2e-run-fakebin-"));
  const logPath = join(tmp, "docker.log");
  const stubs = {
    docker: FAKE_DOCKER,
    ss: FAKE_PORT_PROBE,
    lsof: FAKE_PORT_PROBE,
  };
  for (const [name, body] of Object.entries(stubs)) {
    const p = join(tmp, name);
    writeFileSync(p, body);
    chmodSync(p, 0o755);
  }
  const res = child_process.spawnSync("bash", [RUN_SH], {
    env: {
      ...process.env,
      ...knobs,
      FAKE_DOCKER_LOG: logPath,
      PATH: `${tmp}:${process.env.PATH ?? ""}`,
    },
    encoding: "utf8",
  });
  const log = existsSync(logPath) ? readFileSync(logPath, "utf8") : "";
  rmSync(tmp, { recursive: true, force: true });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr, log };
}

test("pass + pass → exit 0, stack torn down with volumes", () => {
  const r = runRunSh({ FAKE_TEST_EXIT: "0", FAKE_DOWN_EXIT: "0" });
  assert.equal(r.code, 0);
  assert.match(r.log, /down -v --remove-orphans/);
});

test("test failure + clean cleanup → test exit code preserved", () => {
  const r = runRunSh({ FAKE_TEST_EXIT: "5", FAKE_DOWN_EXIT: "0" });
  assert.equal(r.code, 5);
  assert.match(r.log, /down -v --remove-orphans/);
  assert.doesNotMatch(r.stderr, /70/);
});

test("pass + cleanup failure → sentinel 70 with loud diagnostics", () => {
  const r = runRunSh({ FAKE_TEST_EXIT: "0", FAKE_DOWN_EXIT: "1" });
  assert.equal(r.code, 70);
  assert.match(r.stderr, /compose down -v 失败/);
  assert.match(r.stderr, /手动清理/);
  assert.match(r.log, /down -v --remove-orphans/);
});

test("test failure + cleanup failure → test exit code wins, cleanup as diagnostics", () => {
  const r = runRunSh({ FAKE_TEST_EXIT: "5", FAKE_DOWN_EXIT: "1" });
  assert.equal(r.code, 5);
  assert.match(r.stderr, /compose down -v 失败/);
  assert.doesNotMatch(r.stderr, /sentinel 70/);
  assert.match(r.log, /down -v --remove-orphans/);
});

test("preflight failure + cleanup failure → preflight exit code wins", () => {
  const r = runRunSh({ FAKE_EXEC_EXIT: "1", FAKE_DOWN_EXIT: "1" });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /compose down -v 失败/);
  assert.match(r.log, /down -v --remove-orphans/);
});

test("KEEP_STACK=1 keeps the stack and preserves the exit code", () => {
  const kept = runRunSh({
    KEEP_STACK: "1",
    FAKE_TEST_EXIT: "0",
    FAKE_DOWN_EXIT: "1",
  });
  assert.equal(kept.code, 0);
  assert.doesNotMatch(kept.log, /down -v/);
  const failed = runRunSh({
    KEEP_STACK: "1",
    FAKE_TEST_EXIT: "5",
    FAKE_DOWN_EXIT: "0",
  });
  assert.equal(failed.code, 5);
  assert.doesNotMatch(failed.log, /down -v/);
});
