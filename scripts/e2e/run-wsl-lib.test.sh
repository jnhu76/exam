#!/usr/bin/env bash
# scripts/e2e/run-wsl-lib.test.sh
#
# Scenario tests for scripts/e2e/run-wsl-lib.sh, driven by
# run-wsl-lib.test.mjs. Each scenario is self-contained and exits 0 on PASS or
# nonzero on FAIL, printing "PASS" / "FAIL: reason" to stdout/stderr.
#
# The mjs runner isolates each scenario in a fresh `bash` invocation and may
# prepend a faked-bin dir to PATH (for the docker-dependent scenarios).
#
# Usage:
#   bash run-wsl-lib.test.sh <scenario_name>
#
# Scenarios (one per tested contract from the issue spec):
#   prefix-guard            — reject unsafe DB names, accept safe ones
#   ordering                — DROP happens strictly after server stop+wait
#   drop-failure-loud       — docker error → nonzero + stderr names the db
#   drop-success            — happy path returns 0
#   exit-matrix-pass-pass   — PW 0 + clean cleanup → exit 0
#   exit-matrix-fail-pass   — PW 7 + clean cleanup → exit 7
#   exit-matrix-pass-fail   — PW 0 + dirty cleanup → 70
#   exit-matrix-fail-fail   — PW 7 + dirty cleanup → 7
#   cleanup-idempotent      — run_cleanup is idempotent under re-entry
#   wait-for-exit-bounded   — wait_for_process_exit returns 1 on timeout,
#                              0 once the pid is gone
#   keep-on-failure         — KEEP flag retains DB on test failure (no drop)
#   keep-clears-on-success  — KEEP flag does NOT retain on success (drop runs)

set -Eeuo pipefail

LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/run-wsl-lib.sh"
# shellcheck source=/dev/null
source "$LIB"

# Minimal log/warn/err the library expects (run-wsl.sh defines the real ones).
log()  { :; }   # quiet in tests
warn() { :; }
err()  { :; }

scenario="${1:-}"
[[ -n "$scenario" ]] || { echo "FAIL: no scenario given" >&2; exit 2; }

case "$scenario" in

  # ── 1. Prefix guard ────────────────────────────────────────────────────
  prefix-guard)
    fail=0
    for bad in exam postgres exam_test production \
               "exam_e2e_w0;DROP TABLE users" \
               "exam_e2e_w0 --" exam_e2e_evil exam_e2ew0 \
               " exam_e2e_w0" "exam_e2e_w0 " "" "exam_e2e_w100; rm -rf"; do
      if is_safe_worker_db_name "$bad"; then
        echo "FAIL: unsafe name accepted: [${bad}]" >&2
        fail=1
      fi
    done
    for good in exam_e2e exam_e2e_w0 exam_e2e_w1 exam_e2e_w9 exam_e2e_w15; do
      if ! is_safe_worker_db_name "$good"; then
        echo "FAIL: safe name rejected: [${good}]" >&2
        fail=1
      fi
    done
    if [[ "$fail" -eq 0 ]]; then echo "PASS"; else echo "FAIL"; fi
    exit "$fail"
    ;;

  # ── 2. Ordering: DROP after stop+wait ──────────────────────────────────
  ordering)
    order_log="$(mktemp)"
    # Spawn a real child in its OWN process group (setsid), mirroring how
    # run-wsl.sh launches API servers. stop_process_group kills `-$srv` and
    # must actually reach the process; without setsid the negative-pid kill
    # would target a nonexistent group and the sleep would run to completion.
    setsid sleep 30 &
    srv=$!
    # Record events by replacing drop_worker_db_loud AFTER source. The library
    # call chain is: run_cleanup → stop_process_group (real kill/wait) →
    # drop_worker_db_loud (our stub).
    drop_worker_db_loud() {
      local db="$1"
      echo "drop:$db" >> "$order_log"
      # Must be gone at drop time:
      if kill -0 "$srv" 2>/dev/null; then
        echo "drop:ALIVE_AT_DROP" >> "$order_log"
        return 1
      fi
      return 0
    }
    SHARD_PIDS=("$srv")
    SHARD_WORKER_DBS=("exam_e2e_w0")
    E2E_WORKERS=2
    FROZEN_EXIT=0
    CLEANUP_FAILURE=0
    KEEP_SERVER=0
    E2E_KEEP_WORKER_DB_ON_FAILURE=0
    DEV_COMPOSE=""
    ROOT_DIR=""
    DROP_DB_CID="fakecid"   # let run_cleanup reach drop_worker_db_loud
    run_cleanup
    # Assert: a drop event exists AND no ALIVE_AT_DROP marker.
    if ! grep -q '^drop:exam_e2e_w0$' "$order_log"; then
      echo "FAIL: drop never ran" >&2
      cat "$order_log" >&2
      rm -f "$order_log"; exit 1
    fi
    if grep -q '^drop:ALIVE_AT_DROP$' "$order_log"; then
      echo "FAIL: server still alive at drop time" >&2
      rm -f "$order_log"; exit 1
    fi
    echo "PASS"; rm -f "$order_log"; exit 0
    ;;

  # ── 3. DROP failure is loud ────────────────────────────────────────────
  # Fake `docker` is supplied on PATH by the mjs runner and returns nonzero.
  drop-failure-loud)
    DROP_DB_CID="fakecid"
    err_captured="$(drop_worker_db_loud "exam_e2e_w7" 2>&1 1>/dev/null)" || rc=$?
    rc="${rc:-0}"
    if [[ "$rc" -eq 0 ]]; then
      echo "FAIL: expected nonzero rc, got 0" >&2
      exit 1
    fi
    if [[ "$err_captured" != *"exam_e2e_w7"* ]]; then
      echo "FAIL: stderr did not name the db: $err_captured" >&2
      exit 1
    fi
    if [[ "$err_captured" != *"DROP DATABASE"* && "$err_captured" != *"失败"* ]]; then
      echo "FAIL: stderr lacks failure marker: $err_captured" >&2
      exit 1
    fi
    echo "PASS"; exit 0
    ;;

  # ── 4. DROP success ────────────────────────────────────────────────────
  # Fake docker on PATH returns 0.
  drop-success)
    DROP_DB_CID="fakecid"
    if ! drop_worker_db_loud "exam_e2e_w3" >>/tmp/drop-test-out 2>&1; then
      echo "FAIL: drop returned nonzero on success path" >&2
      exit 1
    fi
    echo "PASS"; exit 0
    ;;

  # ── 5–8. Exit-code matrix (pure compute_final_exit) ────────────────────
  # compute_final_exit returns (not exits) the priority-matrix code; under
  # `set -e` a nonzero return would abort, so capture it with `|| true`.
  exit-matrix-pass-pass)
    FROZEN_EXIT=0; CLEANUP_FAILURE=0
    rc=0; compute_final_exit || rc=$?
    if [[ "$rc" -eq 0 ]]; then echo "PASS:0"; else echo "FAIL: expected 0 got $rc" >&2; exit 1; fi
    exit 0 ;;
  exit-matrix-fail-pass)
    FROZEN_EXIT=7; CLEANUP_FAILURE=0
    rc=0; compute_final_exit || rc=$?
    if [[ "$rc" -eq 7 ]]; then echo "PASS:7"; else echo "FAIL: expected 7 got $rc" >&2; exit 1; fi
    exit 0 ;;
  exit-matrix-pass-fail)
    FROZEN_EXIT=0; CLEANUP_FAILURE=1
    rc=0; compute_final_exit || rc=$?
    if [[ "$rc" -ne 0 ]]; then echo "PASS:$rc"; else echo "FAIL: expected nonzero" >&2; exit 1; fi
    exit 0 ;;
  exit-matrix-fail-fail)
    FROZEN_EXIT=7; CLEANUP_FAILURE=1
    rc=0; compute_final_exit || rc=$?
    if [[ "$rc" -eq 7 ]]; then echo "PASS:7"; else echo "FAIL: expected 7 got $rc" >&2; exit 1; fi
    exit 0 ;;

  # ── 9. Idempotent cleanup ──────────────────────────────────────────────
  cleanup-idempotent)
    # Track how many times drop_worker_db_loud is invoked. Setting DROP_DB_CID
    # lets run_cleanup reach the drop loop without a real compose; we stub the
    # drop function itself.
    call_log="$(mktemp)"
    drop_worker_db_loud() { echo "drop:$1" >> "$call_log"; return 0; }
    SHARD_PIDS=()
    SHARD_WORKER_DBS=("exam_e2e_w0")
    E2E_WORKERS=2; FROZEN_EXIT=0; CLEANUP_FAILURE=0; KEEP_SERVER=0
    E2E_KEEP_WORKER_DB_ON_FAILURE=0; DEV_COMPOSE=""; ROOT_DIR=""
    DROP_DB_CID="fakecid"
    run_cleanup || true
    run_cleanup || true   # second call must be a no-op (CLEANUP_DONE)
    count="$(grep -c '^drop:exam_e2e_w0$' "$call_log" || true)"
    rm -f "$call_log"
    if [[ "$count" -ne 1 ]]; then
      echo "FAIL: expected 1 drop, got $count" >&2; exit 1
    fi
    echo "PASS"; exit 0
    ;;

  # ── 10. wait_for_process_exit bounded ──────────────────────────────────
  wait-for-exit-bounded)
    # A pid that never exits (this script itself). Bounded poll must time out
    # and return 1.
    self=$$
    if wait_for_process_exit "$self" 3 0.01; then
      echo "FAIL: timed-out wait returned 0" >&2; exit 1
    fi
    # A pid that is already gone → immediate 0.
    : &
    gone=$!
    wait "$gone" 2>/dev/null || true
    if ! wait_for_process_exit "$gone" 5 0.01; then
      echo "FAIL: dead pid not detected as gone" >&2; exit 1
    fi
    echo "PASS"; exit 0
    ;;

  # ── 11. KEEP retains on failure ────────────────────────────────────────
  keep-on-failure)
    drop_log="$(mktemp)"
    drop_worker_db_loud() { echo "drop:$1" >> "$drop_log"; return 0; }
    SHARD_PIDS=(); SHARD_WORKER_DBS=("exam_e2e_w0")
    E2E_WORKERS=2; FROZEN_EXIT=7; CLEANUP_FAILURE=0; KEEP_SERVER=0
    E2E_KEEP_WORKER_DB_ON_FAILURE=1; DEV_COMPOSE=""; ROOT_DIR=""
    DROP_DB_CID="fakecid"
    run_cleanup || true
    if [[ -s "$drop_log" ]]; then
      echo "FAIL: drop ran despite KEEP on failure" >&2
      cat "$drop_log" >&2; rm -f "$drop_log"; exit 1
    fi
    echo "PASS"; rm -f "$drop_log"; exit 0
    ;;

  # ── 12. KEEP does NOT retain on success ────────────────────────────────
  keep-clears-on-success)
    drop_log="$(mktemp)"
    drop_worker_db_loud() { echo "drop:$1" >> "$drop_log"; return 0; }
    SHARD_PIDS=(); SHARD_WORKER_DBS=("exam_e2e_w0")
    E2E_WORKERS=2; FROZEN_EXIT=0; CLEANUP_FAILURE=0; KEEP_SERVER=0
    E2E_KEEP_WORKER_DB_ON_FAILURE=1   # set, but tests passed → still drop
    DEV_COMPOSE=""; ROOT_DIR=""
    DROP_DB_CID="fakecid"
    run_cleanup || true
    if ! grep -q '^drop:exam_e2e_w0$' "$drop_log"; then
      echo "FAIL: drop skipped on success despite KEEP flag" >&2
      rm -f "$drop_log"; exit 1
    fi
    echo "PASS"; rm -f "$drop_log"; exit 0
    ;;

  # ── 13. Signal cleanup runs once (spec §9.4) ───────────────────────────
  # A child bash sources the lib, installs `trap run_cleanup EXIT TERM`, sets
  # cleanup state, then waits. The runner sends SIGTERM. We assert: cleanup ran
  # (drop count == 1) and the child exited. Idempotency (CLEANUP_DONE) prevents
  # the TERM trap and the EXIT trap from both running cleanup.
  signal-cleanup-once)
    marker="$(mktemp)"
    child_src="$LIB"
    # Child: stub drop to log into marker; trap run_cleanup on TERM+EXIT;
    # freeze exit, then pause to receive the signal.
    bash -c '
      set -Eeuo pipefail
      LIB="'"$child_src"'"
      # shellcheck source=/dev/null
      source "$LIB"
      log(){ :;}; warn(){ :;}; err(){ :;}
      MARKER="'"$marker"'"
      drop_worker_db_loud(){ echo "drop:$1" >> "$MARKER"; return 0; }
      SHARD_PIDS=(); SHARD_WORKER_DBS=("exam_e2e_w0")
      E2E_WORKERS=2; FROZEN_EXIT=0; CLEANUP_FAILURE=0; KEEP_SERVER=0
      E2E_KEEP_WORKER_DB_ON_FAILURE=0; DEV_COMPOSE=""; ROOT_DIR=""
      DROP_DB_CID="fakecid"
      trap run_cleanup EXIT
      # On TERM, just exit 143; the EXIT trap runs run_cleanup once.
      trap "exit 143" TERM
      # Signal readiness, then wait in a SHORT-sleep poll loop so bash gets a
      # chance to service the TERM trap promptly (a single long `sleep 30`
      # would not be interrupted until it returns).
      echo "READY $$" > "'"$marker"'.pid"
      for _ in $(seq 1 300); do sleep 0.1; done
    ' &
    child_wrapper=$!
    # Wait for the inner bash to write its pid file (max ~5s).
    for _ in $(seq 1 50); do
      [[ -f "$marker.pid" ]] && break
      sleep 0.1
    done
    if [[ ! -f "$marker.pid" ]]; then
      echo "FAIL: child never signaled ready" >&2
      rm -f "$marker" "$marker.pid"; exit 1
    fi
    inner_pid="$(cat "$marker.pid" | awk '{print $2}')"
    kill -TERM "$inner_pid" 2>/dev/null || true
    # Wait for the wrapper to exit.
    for _ in $(seq 1 50); do
      kill -0 "$child_wrapper" 2>/dev/null || break
      sleep 0.1
    done
    kill -KILL "$child_wrapper" 2>/dev/null || true
    wait "$child_wrapper" 2>/dev/null || true
    count="$(grep -c '^drop:exam_e2e_w0$' "$marker" 2>/dev/null || echo 0)"
    rm -f "$marker" "$marker.pid"
    if [[ "$count" -ne 1 ]]; then
      echo "FAIL: expected exactly 1 cleanup drop under signal, got $count" >&2
      exit 1
    fi
    echo "PASS"; exit 0
    ;;

  *)
    echo "FAIL: unknown scenario: $scenario" >&2
    exit 99
    ;;
esac
