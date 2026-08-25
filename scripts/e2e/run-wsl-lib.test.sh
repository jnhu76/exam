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
# Scenarios (one per tested contract from the issue spec + review):
#   prefix-guard                 — reject unsafe DB names, accept safe ones
#   ordering                     — DROP happens strictly after server stop+wait
#   drop-failure-loud            — docker error → nonzero + stderr names the db
#   drop-success                 — happy path returns 0
#   archive-prefix-guard         — (#330) unsafe archive sources refused
#   archive-missing-noop         — (#330) no retained DB → clean no-op
#   archive-renames-retained     — (#330) retained DB renamed to *_prior
#   archive-evicts-old-generation — (#330) old archive DROPped before RENAME
#   archive-existence-error-loud — (#330) docker error → rc=1, never silent
#   exit-matrix-pass-pass        — PW 0 + clean cleanup → exit 0
#   exit-matrix-fail-pass        — PW 7 + clean cleanup → exit 7
#   exit-matrix-pass-fail        — PW 0 + dirty cleanup → 70
#   exit-matrix-fail-fail        — PW 7 + dirty cleanup → 7
#   exit-trap-matrix             — real EXIT trap chain, 4-cell matrix (P2-2)
#   cleanup-idempotent           — run_cleanup is idempotent under re-entry
#   wait-for-exit-bounded        — wait_for_process_exit returns 1 on timeout
#   keep-on-failure              — KEEP flag retains worker DBs on failure
#   keep-clears-on-success       — KEEP flag does NOT retain on success
#   flag-validation              — --keep-server/--no-reseed parallel rejected
#   serial-persists-on-success   — serial exam_e2e never dropped (--no-reseed)
#   serial-migrate-failure-keeps — migrate-failure path names + keeps exam_e2e
#   serial-wait-health-failure-keeps — health-failure path keeps exam_e2e
#   keep-server-preserves-all    — KEEP_SERVER keeps server+DB+compose (P1-2)
#   compose-ps-failure           — compose ps error → cleanup failure (P1-4)
#   compose-ps-missing           — no container + pending drops → failure
#   compose-down-failure         — compose down error → cleanup failure (P1-4)
#   parallel-failure-cleans-all  — migrate failure drops every registered DB
#   parallel-failure-retains-all — keep-flag retains every registered DB
#   keep-on-failure-preserves-compose — keep-flag preserves script-started
#                                       compose (round-2 P1)
#   cleanup-stops-orphaned-group — run_cleanup stops group after leader died
#                                  (round-2 P2)
#   process-group-child-survives — TERM-ignoring child is KILLed (P2-1)
#   signal-exit-codes            — TERM → 143, INT → 130, cleanup exactly once

set -Eeuo pipefail

LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/run-wsl-lib.sh"
# shellcheck source=/dev/null
source "$LIB"

# Minimal log/warn/err the library expects (run-wsl.sh defines the real ones).
log()  { :; }   # quiet in tests
warn() { :; }
err()  { :; }

# The mjs runner exports FAKE_DOCKER_LOG for docker-dependent scenarios; keep
# a standalone-safe default so direct `bash run-wsl-lib.test.sh <scenario>`
# invocations do not fail under `set -u` (round-3 review).
FAKE_DOCKER_LOG="${FAKE_DOCKER_LOG:-/tmp/e2e-fake-docker.log}"

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

  # ── Contract 10 (issue #330): retained-DB archiving ────────────────────
  # A pre-existing exam_e2e_w<N> is a forensic artifact, never execution
  # state; archive_retained_worker_db renames it to *_prior (evicting the
  # previous generation first) so the run starts from a fresh DB.
  archive-prefix-guard)
    fail=0
    for bad in exam postgres exam_test production \
               "exam_e2e_w0;DROP TABLE users" \
               "exam_e2e_w0 --" exam_e2e_evil exam_e2ew0 \
               exam_e2e_w0_prior "exam_e2e_w100; rm -rf"; do
      if archive_retained_worker_db "fakecid" "$bad" >/dev/null 2>&1; then
        echo "FAIL: unsafe archive source accepted: [${bad}]" >&2
        fail=1
      fi
    done
    if archive_retained_worker_db "" "exam_e2e_w0" >/dev/null 2>&1; then
      echo "FAIL: empty container id accepted" >&2
      fail=1
    fi
    if [[ "$fail" -eq 0 ]]; then echo "PASS"; else echo "FAIL"; fi
    exit "$fail"
    ;;

  # Fake docker on PATH: pg_database queries find no matching DB.
  archive-missing-noop)
    rc=0
    archive_retained_worker_db "fakecid" "exam_e2e_w0" >/dev/null 2>&1 || rc=$?
    if [[ "$rc" -ne 0 ]]; then
      echo "FAIL: missing DB must be a clean no-op, got rc=$rc" >&2
      exit 1
    fi
    if grep -q "ALTER DATABASE" "$FAKE_DOCKER_LOG"; then
      echo "FAIL: ALTER issued for a missing DB" >&2
      exit 1
    fi
    echo "PASS"; exit 0
    ;;

  # Fake docker on PATH: pg_database reports exam_e2e_w0 exists.
  archive-renames-retained)
    rc=0
    archive_retained_worker_db "fakecid" "exam_e2e_w0" >/dev/null 2>&1 || rc=$?
    if [[ "$rc" -ne 0 ]]; then
      echo "FAIL: archive returned rc=$rc" >&2
      exit 1
    fi
    if ! grep -q 'ALTER DATABASE "exam_e2e_w0" RENAME TO "exam_e2e_w0_prior"' "$FAKE_DOCKER_LOG"; then
      echo "FAIL: rename to the _prior archive slot not issued" >&2
      exit 1
    fi
    echo "PASS"; exit 0
    ;;

  # Fake docker on PATH: both exam_e2e_w0 and exam_e2e_w0_prior exist.
  archive-evicts-old-generation)
    rc=0
    archive_retained_worker_db "fakecid" "exam_e2e_w0" >/dev/null 2>&1 || rc=$?
    if [[ "$rc" -ne 0 ]]; then
      echo "FAIL: archive returned rc=$rc" >&2
      exit 1
    fi
    drop_line="$(grep -n 'DROP DATABASE IF EXISTS "exam_e2e_w0_prior"' "$FAKE_DOCKER_LOG" | head -1 | cut -d: -f1)"
    rename_line="$(grep -n 'ALTER DATABASE "exam_e2e_w0" RENAME' "$FAKE_DOCKER_LOG" | head -1 | cut -d: -f1)"
    if [[ -z "$drop_line" || -z "$rename_line" || "$drop_line" -ge "$rename_line" ]]; then
      echo "FAIL: old archive must be DROPped (line ${drop_line:-none}) BEFORE the rename (line ${rename_line:-none})" >&2
      exit 1
    fi
    echo "PASS"; exit 0
    ;;

  # Fake docker on PATH: docker exec fails on the existence query itself.
  archive-existence-error-loud)
    rc=0
    archive_retained_worker_db "fakecid" "exam_e2e_w0" >/dev/null 2>&1 || rc=$?
    if [[ "$rc" -ne 1 ]]; then
      echo "FAIL: docker error on existence query must return 1 (loud), got rc=$rc" >&2
      exit 1
    fi
    if grep -q "ALTER DATABASE" "$FAKE_DOCKER_LOG"; then
      echo "FAIL: ALTER issued despite failed existence query" >&2
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

  # ── 9. Real EXIT trap chain, 4-cell matrix (P2-2) ──────────────────────
  # Subprocesses install the REAL exit_handler from the lib and `exit` with
  # the frozen code, exactly like run-wsl.sh. This tests the actual trap
  # chain (not just compute_final_exit in isolation): the old handler aborted
  # under `set -e` when compute_final_exit returned 7/70, so the sentinel
  # message was never printed — the pass-fail cell pins that.
  exit-trap-matrix)
    pass=1
    run_cell() {
      local cell_code="$1" drop_rc="$2" want_rc="$3" want_msg="$4"
      local out rc
      out="$(CELL_CODE="$cell_code" DROP_RC="$drop_rc" LIB="$LIB" bash -c '
        set -Eeuo pipefail
        # shellcheck source=/dev/null
        source "$LIB"
        log(){ :;}; warn(){ :;}; err(){ echo "ERR: $*" >&2; }
        drop_worker_db_loud(){ return "$DROP_RC"; }
        SHARD_PIDS=(); SHARD_WORKER_DBS=("exam_e2e_w0")
        E2E_WORKERS=2; FROZEN_EXIT=0; CLEANUP_FAILURE=0; KEEP_SERVER=0
        E2E_KEEP_WORKER_DB_ON_FAILURE=0; DEV_COMPOSE=""; ROOT_DIR=""
        DROP_DB_CID="fakecid"
        trap exit_handler EXIT
        exit "$CELL_CODE"
      ' 2>&1)" || rc=$?
      rc="${rc:-0}"
      if [[ "$rc" -ne "$want_rc" ]]; then
        echo "FAIL: cell(code=$cell_code,drop=$drop_rc): want exit $want_rc got $rc" >&2
        echo "$out" >&2
        pass=0
      fi
      if [[ -n "$want_msg" ]] && [[ "$out" != *"$want_msg"* ]]; then
        echo "FAIL: cell(code=$cell_code,drop=$drop_rc): stderr missing [$want_msg]" >&2
        echo "$out" >&2
        pass=0
      fi
    }
    run_cell 0 0 0 ""             # PASS + clean cleanup → 0
    run_cell 7 0 7 ""             # FAIL + clean cleanup → Playwright code
    run_cell 0 1 70 "sentinel 70" # PASS + dirty cleanup → 70 + sentinel msg
    run_cell 7 1 7 ""             # FAIL + dirty cleanup → Playwright code
    if [[ "$pass" -eq 1 ]]; then echo "PASS"; exit 0; fi
    exit 1
    ;;

  # ── 10. Idempotent cleanup ─────────────────────────────────────────────
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

  # ── 11. wait_for_process_exit bounded ──────────────────────────────────
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

  # ── 12. KEEP retains on failure ────────────────────────────────────────
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

  # ── 13. KEEP does NOT retain on success ────────────────────────────────
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

  # ── 14. CLI flag validation (P1-2 / P1-3) ──────────────────────────────
  # --keep-server and --no-reseed have defined semantics only for the single
  # server serial path; parallel combinations must be rejected fail-fast.
  flag-validation)
    rc=0; validate_run_flags 1 2 0 || rc=$?
    [[ "$rc" -eq 0 ]] || { echo "FAIL: default parallel combo rejected (rc=$rc)" >&2; exit 1; }
    rc=0; validate_run_flags 0 2 0 || rc=$?
    [[ "$rc" -eq 2 ]] || { echo "FAIL: --no-reseed parallel not rejected (rc=$rc)" >&2; exit 1; }
    rc=0; validate_run_flags 1 2 1 || rc=$?
    [[ "$rc" -eq 2 ]] || { echo "FAIL: --keep-server parallel not rejected (rc=$rc)" >&2; exit 1; }
    rc=0; validate_run_flags 0 2 1 || rc=$?
    [[ "$rc" -eq 2 ]] || { echo "FAIL: both flags parallel not rejected (rc=$rc)" >&2; exit 1; }
    rc=0; validate_run_flags 0 1 0 || rc=$?
    [[ "$rc" -eq 0 ]] || { echo "FAIL: --no-reseed serial rejected (rc=$rc)" >&2; exit 1; }
    rc=0; validate_run_flags 1 1 1 || rc=$?
    [[ "$rc" -eq 0 ]] || { echo "FAIL: --keep-server serial rejected (rc=$rc)" >&2; exit 1; }
    rc=0; validate_run_flags 0 1 1 || rc=$?
    [[ "$rc" -eq 0 ]] || { echo "FAIL: both flags serial rejected (rc=$rc)" >&2; exit 1; }
    echo "PASS"; exit 0
    ;;

  # ── 15. Serial persistence on success (P1-3 / --no-reseed reuse) ───────
  # The serial exam_e2e DB must survive a clean run: --no-reseed depends on
  # existing seed data across runs. Only parallel exam_e2e_w<N> are ephemeral.
  serial-persists-on-success)
    drop_log="$(mktemp)"
    drop_worker_db_loud() { echo "drop:$1" >> "$drop_log"; return 0; }
    WORKER_DBS_SERIAL=("exam_e2e")
    E2E_WORKERS=1; FROZEN_EXIT=0; CLEANUP_FAILURE=0; KEEP_SERVER=0
    E2E_KEEP_WORKER_DB_ON_FAILURE=0; DEV_COMPOSE=""; ROOT_DIR=""
    DROP_DB_CID="fakecid"
    run_cleanup
    if [[ -s "$drop_log" ]]; then
      echo "FAIL: serial exam_e2e dropped on success (--no-reseed would break)" >&2
      cat "$drop_log" >&2; rm -f "$drop_log"; exit 1
    fi
    echo "PASS"; rm -f "$drop_log"; exit 0
    ;;

  # ── 16. Serial migrate-failure path knows + keeps the identity (P1-1) ──
  # migrate fails → exit 1 → cleanup must name exam_e2e (registered BEFORE the
  # failing op) and keep it (persist policy) without erroring.
  serial-migrate-failure-keeps)
    drop_log="$(mktemp)"; warn_log="$(mktemp)"
    drop_worker_db_loud() { echo "drop:$1" >> "$drop_log"; return 0; }
    warn() { echo "WARN: $*" >> "$warn_log"; }
    WORKER_DBS_SERIAL=("exam_e2e")
    E2E_WORKERS=1; FROZEN_EXIT=1; CLEANUP_FAILURE=0; KEEP_SERVER=0
    E2E_KEEP_WORKER_DB_ON_FAILURE=0; DEV_COMPOSE=""; ROOT_DIR=""
    DROP_DB_CID="fakecid"
    run_cleanup
    if [[ -s "$drop_log" ]]; then
      echo "FAIL: serial exam_e2e dropped on migrate failure" >&2
      cat "$drop_log" >&2; rm -f "$drop_log" "$warn_log"; exit 1
    fi
    if ! grep -q "exam_e2e" "$warn_log"; then
      echo "FAIL: cleanup did not identify the serial DB on failure" >&2
      cat "$warn_log" >&2; rm -f "$drop_log" "$warn_log"; exit 1
    fi
    echo "PASS"; rm -f "$drop_log" "$warn_log"; exit 0
    ;;

  # ── 17. Serial wait_health-failure path knows + keeps the identity (P1-1)
  # The server died before becoming healthy; API_PID is a reaped pid.
  serial-wait-health-failure-keeps)
    : & dead_pid=$!
    wait "$dead_pid" 2>/dev/null || true
    drop_log="$(mktemp)"; warn_log="$(mktemp)"
    drop_worker_db_loud() { echo "drop:$1" >> "$drop_log"; return 0; }
    warn() { echo "WARN: $*" >> "$warn_log"; }
    API_PID="$dead_pid"
    WORKER_DBS_SERIAL=("exam_e2e")
    E2E_WORKERS=1; FROZEN_EXIT=1; CLEANUP_FAILURE=0; KEEP_SERVER=0
    E2E_KEEP_WORKER_DB_ON_FAILURE=0; DEV_COMPOSE=""; ROOT_DIR=""
    DROP_DB_CID="fakecid"
    run_cleanup
    if [[ -s "$drop_log" ]]; then
      echo "FAIL: serial exam_e2e dropped on health-check failure" >&2
      cat "$drop_log" >&2; rm -f "$drop_log" "$warn_log"; exit 1
    fi
    if ! grep -q "exam_e2e" "$warn_log"; then
      echo "FAIL: cleanup did not identify the serial DB on failure" >&2
      cat "$warn_log" >&2; rm -f "$drop_log" "$warn_log"; exit 1
    fi
    echo "PASS"; rm -f "$drop_log" "$warn_log"; exit 0
    ;;

  # ── 18. KEEP_SERVER preserves the whole runtime (P1-2) ─────────────────
  # --keep-server must leave a WORKING combination: API server alive + serial
  # DB intact + dev compose up (+ logs kept). Two cells: tests passed and
  # tests failed. Fake docker (PATH, via mjs) logs its invocations to
  # $FAKE_DOCKER_LOG so we can prove `compose down` was never attempted.
  keep-server-preserves-all)
    : > "$FAKE_DOCKER_LOG"
    drop_log="$(mktemp)"
    drop_worker_db_loud() { echo "drop:$1" >> "$drop_log"; return 0; }
    compose_file="$(mktemp)"
    root_dir="$(mktemp -d)"
    run_cell() {
      local code="$1"
      setsid sleep 30 &
      API_PID=$!
      WORKER_DBS_SERIAL=("exam_e2e")
      E2E_WORKERS=1; FROZEN_EXIT="$code"; CLEANUP_FAILURE=0; KEEP_SERVER=1
      E2E_KEEP_WORKER_DB_ON_FAILURE=0; DEV_COMPOSE="$compose_file"
      DEV_COMPOSE_WAS_UP=0; ROOT_DIR="$root_dir"; DROP_DB_CID=""
      CLEANUP_DONE=0; CLEANUP_RUNNING=0
      rc=0; run_cleanup || rc=$?
      if [[ "$rc" -ne 0 ]]; then
        echo "FAIL: KEEP_SERVER cell(code=$code): cleanup failed (rc=$rc)" >&2; return 1
      fi
      if ! kill -0 "$API_PID" 2>/dev/null; then
        echo "FAIL: KEEP_SERVER cell(code=$code): API server was stopped" >&2; return 1
      fi
      if [[ -s "$drop_log" ]]; then
        echo "FAIL: KEEP_SERVER cell(code=$code): DB was dropped" >&2
        cat "$drop_log" >&2; return 1
      fi
      if grep -q "down" "$FAKE_DOCKER_LOG"; then
        echo "FAIL: KEEP_SERVER cell(code=$code): dev compose was torn down" >&2
        cat "$FAKE_DOCKER_LOG" >&2; return 1
      fi
      kill -KILL "$API_PID" 2>/dev/null || true
      wait "$API_PID" 2>/dev/null || true
      return 0
    }
    fail=0
    run_cell 0 || fail=1
    run_cell 7 || fail=1
    rm -f "$drop_log" "$compose_file"; rm -rf "$root_dir"
    if [[ "$fail" -eq 0 ]]; then echo "PASS"; exit 0; fi
    exit 1
    ;;

  # ── 19. compose ps command failure → cleanup failure (P1-4) ────────────
  # A failed `docker compose ps` (daemon/compose problem) must set
  # CLEANUP_FAILURE — not be swallowed by `2>/dev/null || true`.
  compose-ps-failure)
    drop_log="$(mktemp)"
    drop_worker_db_loud() { echo "drop:$1" >> "$drop_log"; return 0; }
    SHARD_PIDS=(); SHARD_WORKER_DBS=("exam_e2e_w0")
    E2E_WORKERS=2; FROZEN_EXIT=0; CLEANUP_FAILURE=0; KEEP_SERVER=0
    E2E_KEEP_WORKER_DB_ON_FAILURE=0
    DEV_COMPOSE="$(mktemp)"; DEV_COMPOSE_WAS_UP=0; ROOT_DIR=""; DROP_DB_CID=""
    rc=0; run_cleanup || rc=$?
    if [[ "$rc" -eq 0 ]]; then
      echo "FAIL: compose ps failure did not fail cleanup" >&2; exit 1
    fi
    if [[ "${CLEANUP_FAILURE:-0}" != "1" ]]; then
      echo "FAIL: CLEANUP_FAILURE not set on compose ps failure" >&2; exit 1
    fi
    echo "PASS"; exit 0
    ;;

  # ── 20. No DB container with pending drops → cleanup failure (P1-4) ────
  # `compose ps` succeeds but reports no container while worker DBs are
  # pending: the DBs cannot be dropped, so cleanup must fail loudly.
  compose-ps-missing)
    drop_log="$(mktemp)"
    drop_worker_db_loud() { echo "drop:$1" >> "$drop_log"; return 0; }
    SHARD_PIDS=(); SHARD_WORKER_DBS=("exam_e2e_w0" "exam_e2e_w1")
    E2E_WORKERS=2; FROZEN_EXIT=0; CLEANUP_FAILURE=0; KEEP_SERVER=0
    E2E_KEEP_WORKER_DB_ON_FAILURE=0
    DEV_COMPOSE="$(mktemp)"; DEV_COMPOSE_WAS_UP=0; ROOT_DIR=""; DROP_DB_CID=""
    rc=0; run_cleanup || rc=$?
    if [[ "$rc" -eq 0 ]]; then
      echo "FAIL: missing DB container with pending drops did not fail cleanup" >&2; exit 1
    fi
    if [[ "${CLEANUP_FAILURE:-0}" != "1" ]]; then
      echo "FAIL: CLEANUP_FAILURE not set when DB container is missing" >&2; exit 1
    fi
    echo "PASS"; exit 0
    ;;

  # ── 21. compose down failure → cleanup failure (P1-4) ──────────────────
  # `docker compose down -v` failure must set CLEANUP_FAILURE (old code used
  # `|| true`). Also pins the ordering: worker DBs are dropped BEFORE compose
  # teardown, and `down` really is attempted without KEEP_SERVER (contrast
  # with keep-server-preserves-all).
  compose-down-failure)
    drop_log="$(mktemp)"
    drop_worker_db_loud() { echo "drop:$1" >> "$drop_log"; return 0; }
    SHARD_PIDS=(); SHARD_WORKER_DBS=("exam_e2e_w0")
    E2E_WORKERS=2; FROZEN_EXIT=0; CLEANUP_FAILURE=0; KEEP_SERVER=0
    E2E_KEEP_WORKER_DB_ON_FAILURE=0
    DEV_COMPOSE="$(mktemp)"; DEV_COMPOSE_WAS_UP=0
    ROOT_DIR="$(mktemp -d)"; DROP_DB_CID=""
    rc=0; run_cleanup || rc=$?
    if [[ "$rc" -eq 0 ]]; then
      echo "FAIL: compose down failure did not fail cleanup" >&2; exit 1
    fi
    if [[ "${CLEANUP_FAILURE:-0}" != "1" ]]; then
      echo "FAIL: CLEANUP_FAILURE not set on compose down failure" >&2; exit 1
    fi
    if ! grep -q '^drop:exam_e2e_w0$' "$drop_log"; then
      echo "FAIL: worker DB was not dropped before compose teardown" >&2
      cat "$drop_log" >&2; exit 1
    fi
    if ! grep -q "down" "$FAKE_DOCKER_LOG"; then
      echo "FAIL: compose down was not attempted" >&2
      cat "$FAKE_DOCKER_LOG" >&2; exit 1
    fi
    echo "PASS"; exit 0
    ;;

  # ── 22. Parallel migrate failure cleans every registered DB (P1-1) ─────
  # migrate/seed fails before any server launches; cleanup must still drop
  # ALL already-registered worker DBs (registered BEFORE ensure, so the
  # failure exit path is covered), exactly once each.
  parallel-failure-cleans-all)
    drop_log="$(mktemp)"
    drop_worker_db_loud() { echo "drop:$1" >> "$drop_log"; return 0; }
    SHARD_PIDS=()   # migrate failed before any server launched
    SHARD_WORKER_DBS=("exam_e2e_w0" "exam_e2e_w1" "exam_e2e_w2")
    E2E_WORKERS=3; FROZEN_EXIT=1; CLEANUP_FAILURE=0; KEEP_SERVER=0
    E2E_KEEP_WORKER_DB_ON_FAILURE=0; DEV_COMPOSE=""; ROOT_DIR=""
    DROP_DB_CID="fakecid"
    run_cleanup
    for db in exam_e2e_w0 exam_e2e_w1 exam_e2e_w2; do
      if ! grep -q "^drop:${db}$" "$drop_log"; then
        echo "FAIL: ${db} not cleaned on migrate failure" >&2
        cat "$drop_log" >&2; rm -f "$drop_log"; exit 1
      fi
    done
    if [[ "$(grep -c '^drop:' "$drop_log")" -ne 3 ]]; then
      echo "FAIL: expected exactly 3 drops, got $(grep -c '^drop:' "$drop_log")" >&2
      cat "$drop_log" >&2; rm -f "$drop_log"; exit 1
    fi
    echo "PASS"; rm -f "$drop_log"; exit 0
    ;;

  # ── 23. Parallel migrate failure + keep flag retains every DB (P1-1) ───
  parallel-failure-retains-all)
    drop_log="$(mktemp)"
    drop_worker_db_loud() { echo "drop:$1" >> "$drop_log"; return 0; }
    SHARD_PIDS=(); SHARD_WORKER_DBS=("exam_e2e_w0" "exam_e2e_w1" "exam_e2e_w2")
    E2E_WORKERS=3; FROZEN_EXIT=1; CLEANUP_FAILURE=0; KEEP_SERVER=0
    E2E_KEEP_WORKER_DB_ON_FAILURE=1; DEV_COMPOSE=""; ROOT_DIR=""
    DROP_DB_CID="fakecid"
    run_cleanup
    if [[ -s "$drop_log" ]]; then
      echo "FAIL: worker DBs dropped despite keep-on-failure flag" >&2
      cat "$drop_log" >&2; rm -f "$drop_log"; exit 1
    fi
    echo "PASS"; rm -f "$drop_log"; exit 0
    ;;

  # ── 23b. KEEP-on-failure preserves a script-started compose (P1 r2) ─────
  # Failure + E2E_KEEP_WORKER_DB_ON_FAILURE=1 must preserve the WHOLE DB
  # environment: worker DBs AND the compose hosting them. When
  # DEV_COMPOSE_WAS_UP=0 (this run started compose), the old code skipped
  # DROP DATABASE but still ran `docker compose down -v`, deleting the
  # retained DBs with the container.
  keep-on-failure-preserves-compose)
    : > "$FAKE_DOCKER_LOG"
    drop_log="$(mktemp)"
    drop_worker_db_loud() { echo "drop:$1" >> "$drop_log"; return 0; }
    SHARD_PIDS=()
    SHARD_WORKER_DBS=("exam_e2e_w0" "exam_e2e_w1")
    E2E_WORKERS=2; FROZEN_EXIT=1; CLEANUP_FAILURE=0; KEEP_SERVER=0
    E2E_KEEP_WORKER_DB_ON_FAILURE=1
    DEV_COMPOSE="$(mktemp)"; DEV_COMPOSE_WAS_UP=0
    ROOT_DIR="$(mktemp -d)"; DROP_DB_CID=""
    rc=0; run_cleanup || rc=$?
    if [[ "$rc" -ne 0 ]]; then
      echo "FAIL: cleanup failed (rc=$rc)" >&2; exit 1
    fi
    if [[ -s "$drop_log" ]]; then
      echo "FAIL: worker DB dropped despite keep-on-failure" >&2
      cat "$drop_log" >&2; exit 1
    fi
    if grep -q "down" "$FAKE_DOCKER_LOG"; then
      echo "FAIL: compose torn down although worker DBs are retained" >&2
      cat "$FAKE_DOCKER_LOG" >&2; exit 1
    fi
    echo "PASS"; exit 0
    ;;

  # ── 23c. run_cleanup stops an orphaned process group (P2 r2) ────────────
  # The setsid leader exits (reaped) while a TERM-ignoring child survives in
  # the PGID. run_cleanup's stop guard must look at the WHOLE group — a
  # leader-only `kill -0` guard would skip the stop and leak the child.
  cleanup-stops-orphaned-group)
    marker="$(mktemp)"
    setsid bash -c '
      ( trap "" TERM; echo "READY" > "'"$marker"'"; exec sleep 30 ) &
      trap "exit 0" TERM
      wait
    ' &
    leader=$!
    for _ in $(seq 1 50); do [[ -s "$marker" ]] && break; sleep 0.1; done
    if [[ ! -s "$marker" ]]; then
      echo "FAIL: child never signaled readiness" >&2
      kill -KILL -- "-$leader" 2>/dev/null || true
      wait "$leader" 2>/dev/null || true
      rm -f "$marker"; exit 1
    fi
    # Kill ONLY the leader (its TERM trap exits 0) and reap it.
    kill -TERM "$leader" 2>/dev/null || true
    wait "$leader" 2>/dev/null || true
    if kill -0 "$leader" 2>/dev/null; then
      echo "FAIL: leader still alive after TERM" >&2
      rm -f "$marker"; exit 1
    fi
    if ! process_group_alive "$leader"; then
      echo "FAIL: child did not survive the leader exit (setup broken)" >&2
      rm -f "$marker"; exit 1
    fi
    drop_log="$(mktemp)"
    drop_worker_db_loud() { echo "drop:$1" >> "$drop_log"; return 0; }
    SHARD_PIDS=("$leader")
    SHARD_WORKER_DBS=("exam_e2e_w0")
    E2E_WORKERS=2; FROZEN_EXIT=0; CLEANUP_FAILURE=0; KEEP_SERVER=0
    E2E_KEEP_WORKER_DB_ON_FAILURE=0; DEV_COMPOSE=""; ROOT_DIR=""
    DROP_DB_CID="fakecid"
    run_cleanup
    if process_group_alive "$leader"; then
      echo "FAIL: orphaned child leaked after run_cleanup" >&2
      kill -KILL -- "-$leader" 2>/dev/null || true
      rm -f "$marker" "$drop_log"; exit 1
    fi
    if ! grep -q '^drop:exam_e2e_w0$' "$drop_log"; then
      echo "FAIL: worker DB not dropped after orphan cleanup" >&2
      rm -f "$marker" "$drop_log"; exit 1
    fi
    echo "PASS"; rm -f "$marker" "$drop_log"; exit 0
    ;;

  # ── 24. TERM-ignoring child must not outlive the leader (P2-1) ─────────
  # The leader exits on TERM while a child ignores TERM and keeps running.
  # stop_process_group must wait for the WHOLE process group and escalate to
  # KILL; polling only the leader would return success and leak the child.
  process-group-child-survives)
    marker="$(mktemp)"
    setsid bash -c '
      ( trap "" TERM; echo "READY" > "'"$marker"'"; exec sleep 30 ) &
      trap "exit 0" TERM
      wait
    ' &
    leader=$!
    for _ in $(seq 1 50); do [[ -f "$marker" ]] && break; sleep 0.1; done
    if [[ ! -f "$marker" ]]; then
      echo "FAIL: child never signaled readiness" >&2
      kill -KILL -- "-$leader" 2>/dev/null || true
      wait "$leader" 2>/dev/null || true
      rm -f "$marker"; exit 1
    fi
    rc=0
    stop_process_group "$leader" 20 0.1 || rc=$?
    # The child ignored TERM; after stop_process_group the WHOLE group must be
    # empty — a leader-only wait would have returned early and leaked it.
    if kill -0 -- "-$leader" 2>/dev/null; then
      echo "FAIL: process group still alive after stop_process_group" >&2
      kill -KILL -- "-$leader" 2>/dev/null || true
      rm -f "$marker"; exit 1
    fi
    if kill -0 "$leader" 2>/dev/null; then
      echo "FAIL: leader still alive" >&2
      rm -f "$marker"; exit 1
    fi
    if [[ "$rc" -ne 0 ]]; then
      echo "FAIL: stop_process_group returned $rc although the group is empty" >&2
      rm -f "$marker"; exit 1
    fi
    echo "PASS"; rm -f "$marker"; exit 0
    ;;

  # ── 25. Signal exit codes + single cleanup (P2-2) ──────────────────────
  # The REAL lib handlers are trapped in a child; the runner sends TERM/INT.
  # Assert the conventional exit codes (143/130), exactly one cleanup, and
  # that the EXIT trap computed the final code. `set -m` around the INT cell
  # gives the async child its own process group so INT is not auto-ignored.
  signal-exit-codes)
    fail=0
    run_cell() {
      local sig="$1" want="$2"
      local marker rc count inner_pid
      marker="$(mktemp)"
      set -m
      bash -c '
        set -Eeuo pipefail
        LIB="'"$LIB"'"
        # shellcheck source=/dev/null
        source "$LIB"
        log(){ :;}; warn(){ :;}; err(){ :;}
        MARKER="'"$marker"'"
        drop_worker_db_loud(){ echo "drop:$1" >> "$MARKER"; return 0; }
        SHARD_PIDS=(); SHARD_WORKER_DBS=("exam_e2e_w0")
        E2E_WORKERS=2; FROZEN_EXIT=0; CLEANUP_FAILURE=0; KEEP_SERVER=0
        E2E_KEEP_WORKER_DB_ON_FAILURE=0; DEV_COMPOSE=""; ROOT_DIR=""
        DROP_DB_CID="fakecid"
        trap exit_handler EXIT
        trap "signal_handler INT" INT
        trap "signal_handler TERM" TERM
        echo "READY $$" > "'"$marker"'.pid"
        for _ in $(seq 1 300); do sleep 0.1; done
      ' &
      local child=$!
      set +m
      # Poll until the pid file is NON-EMPTY: `echo "READY $$" > file` creates
      # the file before writing, so an existence-only check can race with an
      # empty file and feed awk an empty pid (round-3 review).
      for _ in $(seq 1 50); do [[ -s "$marker.pid" ]] && break; sleep 0.1; done
      inner_pid="$(awk '{print $2}' "$marker.pid" 2>/dev/null)"
      if [[ -z "$inner_pid" ]]; then
        echo "FAIL: ${sig} cell never signaled readiness" >&2
        kill -KILL "$child" 2>/dev/null || true
        wait "$child" 2>/dev/null || true
        rm -f "$marker" "$marker.pid"; return 1
      fi
      kill -"$sig" "$inner_pid" 2>/dev/null || true
      for _ in $(seq 1 100); do kill -0 "$child" 2>/dev/null || break; sleep 0.1; done
      rc=0
      wait "$child" 2>/dev/null || rc=$?
      if kill -0 "$child" 2>/dev/null; then
        kill -KILL "$child" 2>/dev/null || true
        wait "$child" 2>/dev/null || true
        rc=137
      fi
      # `grep -c` prints "0" and exits 1 when there are no matches; `|| echo 0`
      # would append a second "0" line and break the numeric check below —
      # `|| true` keeps the single "0" output (round-3 review).
      count="$(grep -c '^drop:exam_e2e_w0$' "$marker" 2>/dev/null || true)"
      rm -f "$marker" "$marker.pid"
      if [[ "$rc" -ne "$want" ]]; then
        echo "FAIL: ${sig} → want exit $want, got $rc" >&2; return 1
      fi
      if [[ "$count" -ne 1 ]]; then
        echo "FAIL: ${sig} → cleanup ran $count times (want 1)" >&2; return 1
      fi
      return 0
    }
    run_cell TERM 143 || fail=1
    run_cell INT 130 || fail=1
    if [[ "$fail" -eq 0 ]]; then echo "PASS"; exit 0; fi
    exit 1
    ;;

  *)
    echo "FAIL: unknown scenario: $scenario" >&2
    exit 99
    ;;
esac
