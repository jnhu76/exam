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
#   4. DB-name prefix guard: only `exam_e2e` and `exam_e2e_w<N>` are accepted.
#      `exam`, `postgres`, `exam_test`, production, and injection attempts are
#      rejected.
#   5. Idempotent cleanup: INT/TERM/EXIT/re-entrant calls run cleanup at most
#      once.

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

# ── Stop a process group (TERM → grace → KILL → wait) ─────────────────────
# stop_process_group <pid> [max_iters] [sleep_seconds]
# Sends TERM to the whole process group (-$pid), polls for exit, escalates to
# KILL only if still alive, then reaps. Safe to call when the pid is already
# gone. Idempotent.
#
# `setsid` in run-wsl.sh launched each API server in its own process group
# with pgid == child pid, so `kill -- -PID` reaches the server and any
# descendant (tsx, node children). We ALSO send the signal to the positive
# pid as a belt-and-braces fallback — some environments (notably WSL1 / certain
# cgroup setups) deliver negative-pid kills erratically even when the group
# exists. Returns nonzero if the pid is still alive at the end, so the caller
# can flag cleanup failure and avoid a doomed DROP.
stop_process_group() {
  local pid="$1" max="${2:-100}" sleep_secs="${3:-0.1}"
  [[ -z "$pid" ]] && return 0
  kill -0 "$pid" 2>/dev/null || return 0
  # Signal the whole group first (reaches descendants), then the leader pid
  # directly as a fallback. Both are best-effort; the wait poll is the source
  # of truth for "is it really gone".
  kill -TERM -- "-$pid" 2>/dev/null || true
  kill -TERM "$pid" 2>/dev/null || true
  if ! wait_for_process_exit "$pid" "$max" "$sleep_secs"; then
    kill -KILL -- "-$pid" 2>/dev/null || true
    kill -KILL "$pid" 2>/dev/null || true
    wait_for_process_exit "$pid" "$max" "$sleep_secs" || true
  fi
  wait "$pid" 2>/dev/null || true
  # Final guard: if the pid is somehow still alive, signal failure so the
  # caller does not proceed to DROP a DB the server still holds.
  if kill -0 "$pid" 2>/dev/null; then
    return 1
  fi
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
  local -a dbs_to_drop=()
  local keep_dbs=0
  if [[ "${E2E_WORKERS:-1}" -gt 1 ]]; then
    dbs_to_drop=("${SHARD_WORKER_DBS[@]:-}")
  else
    dbs_to_drop=("${WORKER_DBS_SERIAL[@]:-}")
  fi
  # Retention: only on test failure. On success we always clean (matches the
  # historical default; documented in run-wsl.sh).
  if [[ "$code" -ne 0 && "${E2E_KEEP_WORKER_DB_ON_FAILURE:-0}" == "1" ]]; then
    keep_dbs=1
  fi

  if [[ "$keep_dbs" == "1" ]]; then
    warn "测试失败 + E2E_KEEP_WORKER_DB_ON_FAILURE=1：保留 worker 库便于诊断。"
    local db
    for db in "${dbs_to_drop[@]:-}"; do
      [[ -z "$db" ]] && continue
      warn "  保留 ${db}（手动删: docker exec <db-ct> psql -U exam -d postgres -c 'DROP DATABASE \"${db}\" WITH (FORCE)')"
    done
  else
    # Resolve the dev-compose db container id ONLY if the caller did not
    # pre-set DROP_DB_CID (tests inject a fake cid + stub drop_worker_db_loud;
    # production always supplies DEV_COMPOSE). If we cannot resolve a cid and
    # none was provided, we assume the DB is already gone (e.g. compose down
    # ran first) and skip drop without erroring.
    if [[ -z "${DROP_DB_CID:-}" && -n "${DEV_COMPOSE:-}" && -f "$DEV_COMPOSE" ]]; then
      DROP_DB_CID="$(docker compose -f "$DEV_COMPOSE" ps -q db 2>/dev/null || true)"
    fi
    if [[ -n "${DROP_DB_CID:-}" ]]; then
      local db
      for db in "${dbs_to_drop[@]:-}"; do
        [[ -z "$db" ]] && continue
        if ! drop_worker_db_loud "$db"; then
          CLEANUP_FAILURE=1
        fi
      done
    elif [[ -n "${DEV_COMPOSE:-}" && -f "$DEV_COMPOSE" ]]; then
      err "run_cleanup: dev compose db 容器未运行，跳过 DROP（DB 可能已随 compose down 移除）"
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

  # ---- 4. Artifact cleanup (temp logs) only on a fully-clean success. ----
  if [[ "$code" -eq 0 && "$CLEANUP_FAILURE" == "0" ]]; then
    rm -f /tmp/e2e-wsl-w*-migrate.log /tmp/e2e-wsl-w*-api.log \
          /tmp/e2e-wsl-w*-pw.log /tmp/e2e-wsl-api.log 2>/dev/null || true
  fi

  # ---- 5. Dev compose teardown (only if this script started it). ----
  # Subshell scopes the `cd`; no `local` inside it.
  if [[ -n "${ROOT_DIR:-}" && -n "${DEV_COMPOSE:-}" && -f "$DEV_COMPOSE" && \
        "${DEV_COMPOSE_WAS_UP:-0}" == "0" ]]; then
    (
      cd "$ROOT_DIR" || exit 0
      _sc_still="$(docker compose -f "$DEV_COMPOSE" ps -q db 2>/dev/null || true)"
      if [[ -n "$_sc_still" ]]; then
        log "关 dev compose（由 run-wsl.sh 启动）..."
        docker compose -f "$DEV_COMPOSE" down -v >/dev/null 2>&1 || true
      fi
    ) || true
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
# run-wsl.sh calls `exit "$(compute_final_exit)"` from its EXIT trap.
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
