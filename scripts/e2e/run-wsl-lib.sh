#!/usr/bin/env bash
# scripts/e2e/run-wsl-lib.sh
#
# Pure, side-effect-free Bash helpers for scripts/e2e/run-wsl.sh, extracted so
# they can be unit-tested (scripts/e2e/run-wsl-lib.test.sh, driven by
# run-wsl-lib.test.mjs via `bash`).
#
# This file MUST NOT execute any work at the top level — it only defines
# functions. It is intended to be `source`d.
#
# Why a separate library:
#   The historical run-wsl.sh dropped worker DBs *before* stopping the shard
#   API servers (issue #256-A). PostgreSQL refuses DROP DATABASE while
#   connections are open, and the failure was swallowed by
#   `>/dev/null 2>&1 || true`, so `exam_e2e_w*` leaked permanently. The fix
#   centralizes ALL cleanup (stop servers → wait → drop DBs → artifacts) into
#   one idempotent `run_cleanup` wired to EXIT/INT/TERM traps, and makes DROP
#   failures loud.
#
# Contracts enforced here (see run-wsl-lib.test.sh):
#   1. Cleanup ordering: stop process groups → bounded wait → drop DBs →
#      artifact cleanup. DROP never runs while an API server may hold a
#      connection.
#   2. DROP failure is loud: stderr shows the DB name + raw PostgreSQL error,
#      sets a cleanup-failure flag, never `|| true`s the drop away.
#   3. Exit-code priority: Playwright's exit code is frozen first; a cleanup
#      failure can never turn a failing run into exit 0, and never overrides a
#      test failure (FAIL/FAIL → Playwright exit, cleanup error printed).
#      The real trap chain (exit_handler / signal_handler) lives here so the
#      actual handler code is unit-tested, not just compute_final_exit.
#   4. DB-name prefix guard: only `exam_e2e` and `exam_e2e_w<N>` are accepted.
#      `exam`, `postgres`, `exam_test`, production, and injection attempts are
#      rejected.
#   5. Idempotent cleanup: INT/TERM/EXIT/re-entrant calls run cleanup at most
#      once.
#   6. Serial persistence: the serial DB (`exam_e2e`) is NEVER dropped — it is
#      the persistent dev-e2e DB that `--no-reseed` reuses across runs
#      (historical default; the old script only ever dropped `exam_e2e_w<N>`).
#      Only parallel worker DBs are ephemeral. The serial identity is still
#      registered up-front so every exit path (migrate/seed/health) can name
#      it.
#   7. Whole-group shutdown: stop_process_group waits for the entire process
#      group, not just the leader — a TERM-ignoring child must not outlive
#      the leader and keep a port/connection.
#   8. Loud compose teardown: `docker compose ps`/`down` failures set
#      CLEANUP_FAILURE instead of being swallowed (a missing DB container with
#      pending drops is a cleanup failure, not a silent skip).
#   9. Flag validation: validate_run_flags rejects `--keep-server` and
#      `--no-reseed` in parallel mode (undefined lifecycle semantics).

# ── DB-name safety ────────────────────────────────────────────────────────
# Matches ONLY:
#   exam_e2e         (serial path worker DB)
#   exam_e2e_w0..w99 (parallel shard worker DBs)
# Anchored — rejects `exam`, `postgres`, `exam_test`, `exam_e2e_w0;DROP...`,
# `exam_e2e_evil`, etc. Kept in sync with packages/db name-safety intent
# (test/e2e/ci only) but stricter, because this guards a DROP.
WORKER_DB_NAME_RE='^exam_e2e(_w[0-9]+)?$'

# is_safe_worker_db_name <db_name> → 0 if safe, 1 otherwise.
# Pure string check; no external commands.
is_safe_worker_db_name() {
  local db="$1"
  [[ "$db" =~ $WORKER_DB_NAME_RE ]]
}

# ── Bounded process-exit poll ─────────────────────────────────────────────
# wait_for_process_exit <pid> <max_iters> <sleep_seconds>
# Returns 0 once the pid is gone, 1 if still alive after max_iters polls.
#
# A bare `kill -0` is NOT sufficient on Linux: a child that has exited but not
# yet been reaped is a zombie, and `kill -0` on a zombie succeeds. For a child
# the calling shell forked, the only reliable "is it reaped yet?" signal is
# that `wait <pid>` (non-blocking once the child is dead) returns. So we
# consider the pid gone when EITHER `kill -0` fails (no such process) OR the
# /proc/<pid>/stat state is 'Z' (zombie = already dead, pending reap). The
# caller (stop_process_group) then reaps with `wait`.
wait_for_process_exit() {
  local pid="$1" max="${2:-50}" sleep_secs="${3:-0.1}" i state
  for (( i=0; i<max; i++ )); do
    if ! kill -0 "$pid" 2>/dev/null; then return 0; fi
    # Linux zombie check: state field 3 of /proc/<pid>/stat. 'Z' = zombie.
    if state="$(ps -o stat= -p "$pid" 2>/dev/null)"; then
      # ps 'stat' starts with the letter; 'Z' (possibly followed by '+',etc.)
      if [[ "$state" == Z* ]]; then return 0; fi
    fi
    sleep "$sleep_secs"
  done
  if ! kill -0 "$pid" 2>/dev/null; then return 0; fi
  if state="$(ps -o stat= -p "$pid" 2>/dev/null)" && [[ "$state" == Z* ]]; then
    return 0
  fi
  return 1
}

# ── Process-group liveness ────────────────────────────────────────────────
# process_group_alive <pid> → 0 if ANY member of the process group exists.
# `kill -0 -- -pgid` succeeds while any member (including a TERM-ignoring
# child) remains, and fails with ESRCH only when the group is empty. This is
# the "whole group" liveness check that a bare `kill -0 $pid` (leader only)
# misses. The caller launches servers with `setsid`, so pid == pgid.
process_group_alive() {
  kill -0 -- "-$1" 2>/dev/null
}

# ── Stop a process group (TERM → grace → KILL → wait) ─────────────────────
# stop_process_group <pid> [max_iters] [sleep_seconds]
# Sends TERM to the whole process group (-$pid), polls for the WHOLE GROUP to
# disappear, escalates to KILL only if still alive, then reaps. Safe to call
# when the pid is already gone. Idempotent.
#
# `setsid` in run-wsl.sh launched each API server in its own process group
# with pgid == child pid, so `kill -- -PID` reaches the server and any
# descendant (tsx, node children). We ALSO send the signal to the positive
# pid as a belt-and-braces fallback — some environments (notably WSL1 / certain
# cgroup setups) deliver negative-pid kills erratically even when the group
# exists.
#
# The liveness source of truth is the GROUP, not the leader: a child may
# ignore TERM and outlive the leader (the leader exits on TERM while the child
# keeps the port). Polling only the leader would declare success too early and
# leak the child. Returns nonzero if the group is still alive at the end, so
# the caller can flag cleanup failure and avoid a doomed DROP.
stop_process_group() {
  local pid="$1" max="${2:-100}" sleep_secs="${3:-0.1}" i
  [[ -z "$pid" ]] && return 0
  # Signal the whole group first (reaches descendants), then the leader pid
  # directly as a fallback. Both are best-effort; the group poll is the source
  # of truth for "is it really gone".
  kill -TERM -- "-$pid" 2>/dev/null || true
  kill -TERM "$pid" 2>/dev/null || true
  for (( i=0; i<max; i++ )); do
    if ! process_group_alive "$pid"; then
      wait "$pid" 2>/dev/null || true
      return 0
    fi
    sleep "$sleep_secs"
  done
  kill -KILL -- "-$pid" 2>/dev/null || true
  kill -KILL "$pid" 2>/dev/null || true
  for (( i=0; i<max; i++ )); do
    if ! process_group_alive "$pid"; then
      wait "$pid" 2>/dev/null || true
      return 0
    fi
    sleep "$sleep_secs"
  done
  # Final guard: if the group is somehow still alive, signal failure so the
  # caller does not proceed to DROP a DB the server may still hold.
  if process_group_alive "$pid"; then
    return 1
  fi
  wait "$pid" 2>/dev/null || true
  return 0
}

# ── Loud worker-DB drop ───────────────────────────────────────────────────
# drop_worker_db_loud <db_name>
# Requires a docker container id in $DROP_DB_CID (set by run_cleanup from the
# dev compose `db` service). Uses DROP DATABASE IF EXISTS "<db>" WITH (FORCE),
# supported since PostgreSQL 13 (this repo ships postgres:18.4). FORCE
# terminates existing connections server-side as a second line of defense
# behind stop_process_group.
#
# Loud contract:
#   - rejects unsafe DB names (prints to stderr, returns 2);
#   - on a real drop failure, prints the DB name + the raw PostgreSQL error
#     to stderr and returns 1;
#   - NEVER uses `|| true` to mask a failure.
#   - returns 0 on success (including the IF EXISTS no-op case).
drop_worker_db_loud() {
  local db="$1"
  if ! is_safe_worker_db_name "$db"; then
    printf '[e2e-wsl] 拒绝不安全的 worker 库名: "%s"\n' "$db" >&2
    return 2
  fi
  if [[ -z "${DROP_DB_CID:-}" ]]; then
    printf '[e2e-wsl] drop_worker_db_loud("%s"): DROP_DB_CID 未设置\n' "$db" >&2
    return 3
  fi
  # Capture combined stdout/stderr so the caller sees the real PG error. Quote
  # the identifier; the prefix guard above already proved it is a bare ident.
  local pg_out rc
  pg_out="$(docker exec "$DROP_DB_CID" psql -U exam -d postgres -tAc \
      "DROP DATABASE IF EXISTS \"${db}\" WITH (FORCE)" 2>&1 >/dev/null)" || rc=$?
  rc="${rc:-0}"
  if [[ "$rc" -ne 0 ]]; then
    printf '[e2e-wsl] DROP DATABASE "%s" 失败 (rc=%s)。PostgreSQL 输出:\n%s\n' \
      "$db" "$rc" "$pg_out" >&2
    return 1
  fi
  return 0
}

# ── Unified cleanup orchestrator ──────────────────────────────────────────
# run_cleanup
# Single owner of all teardown. Reads module-level state that run-wsl.sh sets
# before trapping (all are `${VAR:-default}` so unset is safe):
#
#   FROZEN_EXIT                       — Playwright exit code, frozen earlier.
#   CLEANUP_FAILURE (read+write)      — set to 1 if any step fails.
#   CLEANUP_DONE / CLEANUP_RUNNING    — idempotency guards (read+write).
#   E2E_WORKERS                       — >1 ⇒ parallel path.
#   KEEP_SERVER                       — 1 ⇒ single-server keeps dev server.
#   E2E_KEEP_WORKER_DB_ON_FAILURE     — 1 ⇒ keep worker DBs when tests failed.
#   API_PID                           — single-server pid (may be empty).
#   SHARD_PIDS[]                      — parallel shard pids.
#   SHARD_WORKER_DBS[]                — parallel worker db names.
#   WORKER_DBS_SERIAL[]               — serial worker db names.
#   SHARD_LOGS[]                      — shard log paths (diagnostics).
#   DEV_COMPOSE / DEV_COMPOSE_WAS_UP / ROOT_DIR — compose teardown.
#   E2E_WORKER_BASE_PORT              — printed in diagnostics.
#   DROP_DB_CID                       — caller may pre-set to skip compose
#                                       resolve (tests); otherwise resolved
#                                       from DEV_COMPOSE here.
#
# Idempotency: guarded by CLEANUP_DONE / CLEANUP_RUNNING so INT/TERM/EXIT and
# re-entrancy cannot fire it twice or recurse.
#
# Returns nonzero if any teardown step failed (caller may use this); does NOT
# exit — exit-code computation is split out into compute_final_exit so it can
# be unit-tested without terminating the test process.
run_cleanup() {
  if [[ "${CLEANUP_RUNNING:-0}" == "1" || "${CLEANUP_DONE:-0}" == "1" ]]; then
    return 0
  fi
  CLEANUP_RUNNING=1

  local code="${FROZEN_EXIT:-0}"
  CLEANUP_FAILURE="${CLEANUP_FAILURE:-0}"

  # ---- 1. Stop servers FIRST, so they release DB connections. ----
  if [[ "${E2E_WORKERS:-1}" -gt 1 ]]; then
    local sp idx=0
    for sp in "${SHARD_PIDS[@]:-}"; do
      [[ -z "$sp" ]] && { idx=$((idx+1)); continue; }
      if kill -0 "$sp" 2>/dev/null; then
        log "停 shard $((idx+1)) API server (pid $sp, 进程组)..."
        if ! stop_process_group "$sp"; then
          err "shard $((idx+1)) server (pid $sp) 未能干净退出"
          CLEANUP_FAILURE=1
        fi
      fi
      idx=$((idx+1))
    done
  fi

  if [[ -n "${API_PID:-}" ]] && kill -0 "${API_PID}" 2>/dev/null; then
    if [[ "${KEEP_SERVER:-0}" == "1" ]]; then
      warn "KEEP_SERVER=1，保留 dev server (pid ${API_PID}). 手动停: kill ${API_PID}"
    else
      log "停 dev server (pid ${API_PID}, 进程组)..."
      if ! stop_process_group "$API_PID"; then
        err "dev server (pid ${API_PID}) 未能干净退出"
        CLEANUP_FAILURE=1
      fi
    fi
  fi

  # ---- 2. Drop worker DBs (only after servers are stopped). ----
  # Parallel: exam_e2e_w<N> are ephemeral — dropped every run (retention only
  # with E2E_KEEP_WORKER_DB_ON_FAILURE=1 on failure). Serial: exam_e2e is the
  # persistent dev-e2e DB (--no-reseed depends on it surviving between runs;
  # matches the historical script, which only ever dropped exam_e2e_w<N>), so
  # it is never a drop candidate. run-wsl.sh registers both identities BEFORE
  # any failing operation (migrate/seed/health), so every exit path is
  # covered.
  local -a dbs_to_drop=()
  local keep_dbs=0
  if [[ "${E2E_WORKERS:-1}" -gt 1 ]]; then
    dbs_to_drop=("${SHARD_WORKER_DBS[@]:-}")
    if [[ "$code" -ne 0 && "${E2E_KEEP_WORKER_DB_ON_FAILURE:-0}" == "1" ]]; then
      keep_dbs=1
      warn "测试失败 + E2E_KEEP_WORKER_DB_ON_FAILURE=1：保留 worker 库便于诊断。"
      local db
      for db in "${dbs_to_drop[@]:-}"; do
        [[ -z "$db" ]] && continue
        warn "  保留 ${db}（手动删: docker exec <db-ct> psql -U exam -d postgres -c 'DROP DATABASE \"${db}\" WITH (FORCE)')"
      done
    fi
  elif [[ "$code" -ne 0 && -v WORKER_DBS_SERIAL && "${#WORKER_DBS_SERIAL[@]}" -gt 0 ]]; then
    warn "serial 库 ${WORKER_DBS_SERIAL[*]} 失败保留（持久化策略；--no-reseed 依赖此库跨运行存在，下次运行 migrate 幂等自愈）"
  fi

  if [[ "${#dbs_to_drop[@]}" -gt 0 && "$keep_dbs" == "0" ]]; then
    # Resolve the dev-compose db container id ONLY if the caller did not
    # pre-set DROP_DB_CID (tests inject a fake cid + stub drop_worker_db_loud;
    # production always supplies DEV_COMPOSE). Distinguish a REAL command
    # failure from "no container": a failed `compose ps` or a missing
    # container with pending drops is a cleanup failure (loud), not a
    # silent skip.
    if [[ -z "${DROP_DB_CID:-}" && -n "${DEV_COMPOSE:-}" && -f "$DEV_COMPOSE" ]]; then
      local ps_out ps_rc=0
      ps_out="$(docker compose -f "$DEV_COMPOSE" ps -q db 2>&1)" || ps_rc=$?
      if [[ "$ps_rc" -ne 0 ]]; then
        err "run_cleanup: 无法解析 dev compose db 容器（rc=${ps_rc}）:"
        printf '%s\n' "$ps_out" >&2
        CLEANUP_FAILURE=1
      elif [[ -z "$ps_out" ]]; then
        err "run_cleanup: 存在待删除 worker 库（${#dbs_to_drop[@]} 个），但 dev compose db 容器未运行"
        CLEANUP_FAILURE=1
      else
        DROP_DB_CID="$ps_out"
      fi
    fi
    if [[ -n "${DROP_DB_CID:-}" ]]; then
      local db
      for db in "${dbs_to_drop[@]:-}"; do
        [[ -z "$db" ]] && continue
        if ! drop_worker_db_loud "$db"; then
          CLEANUP_FAILURE=1
        fi
      done
    fi
  fi

  # ---- 3. Diagnostics on failure (parallel path). ----
  if [[ "${E2E_WORKERS:-1}" -gt 1 && "$code" -ne 0 ]]; then
    err "并行 shard 失败。诊断："
    local i
    for (( i=0; i<${#SHARD_PIDS[@]}; i++ )); do
      err "  shard $((i+1))  port=$((${E2E_WORKER_BASE_PORT:-3100}+i))  db=${SHARD_WORKER_DBS[$i]:-n/a}  log=${SHARD_LOGS[$i]:-n/a}"
    done
  fi

  # ---- 4. Artifact cleanup (temp logs) only on a fully-clean success, and
  #         only when the server is not being kept (it still writes the log). ----
  if [[ "$code" -eq 0 && "$CLEANUP_FAILURE" == "0" && "${KEEP_SERVER:-0}" != "1" ]]; then
    rm -f /tmp/e2e-wsl-w*-migrate.log /tmp/e2e-wsl-w*-api.log \
          /tmp/e2e-wsl-w*-pw.log /tmp/e2e-wsl-api.log 2>/dev/null || true
  fi

  # ---- 5. Dev compose teardown (only if this script started it, and never
  #         under KEEP_SERVER — a kept server needs its DB + compose). ----
  # Subshell scopes the `cd`; no `local` inside it. `compose ps` / `down`
  # failures are loud: they set CLEANUP_FAILURE via the subshell rc.
  if [[ "${KEEP_SERVER:-0}" != "1" && -n "${ROOT_DIR:-}" && -n "${DEV_COMPOSE:-}" && \
        -f "$DEV_COMPOSE" && "${DEV_COMPOSE_WAS_UP:-0}" == "0" ]]; then
    (
      cd "$ROOT_DIR" || exit 0
      if ! _sc_still="$(docker compose -f "$DEV_COMPOSE" ps -q db 2>&1)"; then
        err "run_cleanup: compose ps 失败，跳过 dev compose teardown："
        printf '%s\n' "$_sc_still" >&2
        exit 3
      fi
      if [[ -n "$_sc_still" ]]; then
        log "关 dev compose（由 run-wsl.sh 启动）..."
        if ! docker compose -f "$DEV_COMPOSE" down -v >/dev/null 2>&1; then
          err "run_cleanup: docker compose down -v 失败"
          exit 4
        fi
      fi
    ) || CLEANUP_FAILURE=1
  fi

  CLEANUP_DONE=1
  CLEANUP_RUNNING=0
  [[ "$CLEANUP_FAILURE" == "1" ]] && return 1
  return 0
}

# ── Exit-code finalization (pure, testable) ───────────────────────────────
# compute_final_exit
# Implements the exit-code priority matrix (spec §7). Pure: reads
# FROZEN_EXIT + CLEANUP_FAILURE, returns the int exit code, does not exit.
# exit_handler (below) calls `exit "$(…)"` from the EXIT trap.
#
#   Playwright | Cleanup | Final
#   -----------+---------+------------------------------
#   PASS (0)   | PASS    | 0
#   FAIL (!=0) | PASS    | Playwright code
#   PASS (0)   | FAIL    | 70 (cleanup-failure sentinel)
#   FAIL (!=0) | FAIL    | Playwright code (error already on stderr)
#
# Cleanup never masks a test failure, and never turns a failing cleanup into 0.
# Sentinel 70 keeps cleanup failures distinguishable from Playwright's own
# nonzero codes in CI logs.
compute_final_exit() {
  local code="${FROZEN_EXIT:-0}"
  if [[ "${CLEANUP_FAILURE:-0}" == "1" && "$code" -eq 0 ]]; then
    return 70
  fi
  return "$code"
}

# ── Trap handlers (shared with run-wsl.sh so the real chain is testable) ──
# exit_handler: installed on EXIT. Freezes the code the shell was about to
# exit with, runs cleanup once, then computes the priority-matrix final code.
# `compute_final_exit` may return 7/70; under `set -e` a bare call would abort
# the handler (errexit fires inside the trap), so its return is captured with
# `||`. `trap - EXIT` prevents re-entry when `exit` fires inside the handler.
exit_handler() {
  local code=$?
  # `$?` here is the code the shell was about to exit with. Freeze it so
  # cleanup diagnostics + compute_final_exit see the real Playwright/signal
  # code, not whatever a cleanup sub-step happened to return.
  FROZEN_EXIT="$code"
  run_cleanup || CLEANUP_FAILURE=1
  local final=0
  compute_final_exit || final=$?
  if [[ "$final" -ne "$code" && "$final" -eq 70 ]]; then
    err "cleanup 失败（见上方 stderr）。以 sentinel 70 退出。"
  fi
  trap - EXIT
  exit "$final"
}

# signal_handler <sig>: INT → 130, TERM → 143 (conventional codes). `exit`
# from the handler fires the EXIT trap, so cleanup runs exactly once through
# exit_handler — the trap chain is single.
signal_handler() {
  local sig=$1
  err "中断 (signal ${sig})"
  if [[ "$sig" == "TERM" ]]; then
    FROZEN_EXIT=143
    exit 143
  fi
  FROZEN_EXIT=130
  exit 130
}

# ── CLI flag validation (fail-fast, before any side effect) ───────────────
# validate_run_flags <reseed> <workers> <keep_server>
# Returns 2 for combinations with undefined lifecycle semantics:
#   --keep-server + E2E_WORKERS>1 — preserving N shard servers + N worker
#                                   DBs + compose has no defined product
#                                   contract (issue #256-A review P1-2).
#   --no-reseed   + E2E_WORKERS>1 — parallel worker DBs are ephemeral and
#                                   dropped after every run, so there is no
#                                   existing seed to reuse (P1-3).
# Returns 0 otherwise. Pure (no side effects).
validate_run_flags() {
  local reseed="$1" workers="$2" keep_server="$3"
  if [[ "$keep_server" == "1" && "$workers" -gt 1 ]]; then
    err "--keep-server 仅支持 E2E_WORKERS=1（并行 shard 保留语义未定义）"
    return 2
  fi
  if [[ "$reseed" == "0" && "$workers" -gt 1 ]]; then
    err "--no-reseed 仅支持 E2E_WORKERS=1（并行 worker 库每次运行后清理，无现有 seed 可复用）"
    return 2
  fi
  return 0
}
