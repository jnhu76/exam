#!/usr/bin/env bash

# scripts/e2e/run.sh
#
# 唯一 E2E 入口（pnpm e2e 指向本脚本）：host-native —— 不走 Docker app 镜像，
# 直接在宿主跑 api dev server + Playwright；Compose 只提供 PostgreSQL/Redis
# 依赖（#626）。
#
# 为什么需要这个脚本：手动跑 E2E 需要一长串步骤（dev compose → migrate →
# seed → build web → 同步 api/public → 起 dev server 带 E2E env → playwright），
# 极易漏步。本脚本固化完整链路，让任何开发者（含 AI agent）一键复现。
#
# 关键：dev server 必须带 E2E 专用 env（本 runner 是 E2E env 的唯一权威，
# 与 CI 的 service-container env 表达同一契约）：
#   - APP_MODE=e2e              选择测试数据库路径 + 自动关闭限流（与 CI 一致）
#   - HEARTBEAT_TIMEOUT_MS=15000    disconnect-restore spec 依赖 15s 超时
#   - HEARTBEAT_SCAN_INTERVAL_MS=5000 / DEADLINE_SCAN_INTERVAL_MS=5000
# 缺这些 env，disconnect/restore 类 spec 会因 scanner 时序不符而 timeout。
#   - PUBLIC_WEB_ORIGIN           绑定 http://localhost:<本进程端口>。
#     INVARIANT：身份一次性链接（邀请接受/密码重置）= PUBLIC_WEB_ORIGIN +
#     固定站内路径，浏览器直接 goto 该绝对 URL；本拓扑中 SPA 由 API 进程
#     自己服务，链接必须回到 Playwright 实际访问的同一 origin。绑定跟随
#     各自进程端口，禁止全局固定端口（并行 shard 端口各不相同）。
#
# 用法：
#   bash scripts/e2e/run.sh                       # 跑全部 spec
#   bash scripts/e2e/run.sh candidate-happy-path  # 关键字匹配 spec 文件
#   bash scripts/e2e/run.sh --grep "happy path"   # Playwright 标题正则
#   bash scripts/e2e/run.sh --no-reseed           # 复用现有 seed（不重 seed，仅串行）
#   bash scripts/e2e/run.sh --keep-server         # 跑完保留 dev server（仅串行）
#
# 环境变量：
#   DEV_API_PORT        api/dev server 端口，默认 3000
#   DB_HOST_PORT        dev compose PostgreSQL 宿主端口，默认 5432
#   REDIS_HOST_PORT     dev compose Redis 宿主端口，默认 6379；与 DB_HOST_PORT
#                       配合 REDIS_URL=redis://localhost:<port> 可在其它 worktree
#                       的 dev 栈占用默认端口时并行运行本脚本
#   KEEP_SERVER=1     等价于 --keep-server
#   E2E_WORKERS       并行 shard 数；--keep-server / --no-reseed 仅支持 =1
#
# 数据库生命周期（issue #256-A review；#330 取证/执行分离）：
#   - 并行 worker 库 exam_e2e_w<N> 为 ephemeral：每次运行结束（stop server 后）
#     一律 DROP（失败保留仅限 E2E_KEEP_WORKER_DB_ON_FAILURE=1）。
#   - 启动时若发现已存在的 exam_e2e_w<N>（上次失败保留的取证现场，或崩溃
#     泄漏），先 RENAME 为 exam_e2e_w<N>_prior 再创建全新库 —— 取证 artifact
#     保持可查（每 worker 只保留最近一代），本运行绝不复用其执行状态。
#     归档由 run_cleanup 之外的启动路径独占管理，cleanup 从不触碰 _prior。
#   - 串行 exam_e2e 库持久保留（历史默认；--no-reseed 依赖它跨运行存在），
#     脚本从不主动 DROP 它；RESEED=1（默认）时 seed 入口自带受守卫的
#     mutable-state reset，使重跑收敛到 canonical baseline（见
#     packages/db/src/e2eReset.ts）。DB identity 在可能失败的操作（migrate/
#     seed/health）之前登记，确保任何退出路径 cleanup 都知道要清理/保留什么。
#
# 退出码：Playwright 退出码（任一 shard 失败则取最差非零）；若 cleanup 失败
#   且测试本身通过，则用 sentinel 70 覆盖（见下方 compute_final_exit）。
#   cleanup 永不掩盖 Playwright 失败。INT/TERM 中断为
#   130/143（signal_handler），参数组合非法为 2。

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"
ORIG_CWD=$(pwd)

DEV_COMPOSE="${ROOT_DIR}/docker-compose.dev.yml"
DEV_API_PORT="${DEV_API_PORT:-3000}"
KEEP_SERVER="${KEEP_SERVER:-0}"
RESEED=1
GREP_PATTERN=""
SPEC_KEYS=()
EXTRA_PW_ARGS=()

# ── 并行控制 ──────────────────────────────────────────────────────────
# E2E_WORKERS：并行 shard 数。默认 2（与 CI 对齐）。
#   >1 时：为每个 shard 启动独立 exam_e2e_w{N} 库 + 独立 API server（端口
#          E2E_WORKER_BASE_PORT+i），跑 npx playwright test --shard=i/N。
#          shard 之间完全隔离（DB/server/端口），文件级 serial 仍被尊重。
#   =1 时：走原有单 server 单 exam_e2e 库路径（单 shard 模式）。
# E2E_WORKER_BASE_PORT：并行 shard 的 API server 起始端口，默认 3100。
# E2E_KEEP_WORKER_DB_ON_FAILURE：失败时保留 worker 库便于 debug（1/0）。
E2E_WORKERS="${E2E_WORKERS:-2}"
if [[ "$E2E_WORKERS" -gt 16 ]]; then
  err "E2E_WORKERS=${E2E_WORKERS} 超过上限 16，拒绝启动（防资源耗尽）"
  exit 2
fi
E2E_WORKER_BASE_PORT="${E2E_WORKER_BASE_PORT:-3100}"
E2E_KEEP_WORKER_DB_ON_FAILURE="${E2E_KEEP_WORKER_DB_ON_FAILURE:-0}"

log()  { printf '\033[1;36m[e2e-wsl]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[e2e-wsl]\033[0m %s\n' "$*" >&2; }
err()  { printf '\033[1;31m[e2e-wsl]\033[0m %s\n' "$*" >&2; }

usage() { sed -n '3,45p' "$0"; }

while (( "$#" )); do
  case "$1" in
    -h|--help) usage; exit 0 ;;
    --no-reseed) RESEED=0; shift ;;
    --keep-server) KEEP_SERVER=1; shift ;;
    --grep)
      [[ $# -ge 2 ]] || { err "--grep 需要参数"; exit 2; }
      GREP_PATTERN="$2"; shift 2 ;;
    --)
      shift; while (( "$#" )); do EXTRA_PW_ARGS+=("$1"); shift; done ;;
    -*) EXTRA_PW_ARGS+=("$1"); shift ;;
    *) SPEC_KEYS+=("$1"); shift ;;
  esac
done

# ── 冻结拓扑输入（#571）───────────────────────────────────────────────
# MANAGED E2E TOPOLOGY OWNERSHIP:
#   runner/test invocation owns topology; root developer .env is intentionally
#   ignored by Compose. Shell explicit values remain legitimate inputs.
#
# Why: Docker Compose automatically reads the project root `.env` when no
# explicit mechanism disables it. The runner derives TEST_DATABASE_URL from
# shell defaults, while Compose interpolates DB_HOST_PORT/REDIS_HOST_PORT/TZ/
# APP_TIMEZONE from the root `.env` — producing split authority (runner URL
# on port 5432, Compose publishes on a different port from .env).
#
# Fix: COMPOSE_DISABLE_ENV_FILE=1 prevents Compose from reading the root
# `.env`. The runner freezes each topology input once from shell/tester
# input (or the managed default), then every consumer — URL derivation,
# Compose interpolation, cleanup — derives from that frozen fact.
#
# Normal developer behavior is unchanged: `docker compose -f
# docker-compose.dev.yml ...` without the managed runner still reads root
# `.env` as before.

# Explicit shell/tester input → honor it; otherwise use managed defaults.
DB_HOST_PORT="${DB_HOST_PORT:-5432}"
REDIS_HOST_PORT="${REDIS_HOST_PORT:-6379}"
TZ="${TZ:-Asia/Shanghai}"
APP_TIMEZONE="${APP_TIMEZONE:-Asia/Shanghai}"

# Export frozen values so Compose interpolation and all downstream consumers
# see the same managed topology. Export TZ and APP_TIMEZONE so the db/redis
# containers receive the runner-selected timezone, not whatever the root
# `.env` contained (before #571, Compose would read TZ from `.env` and
# the runner had no way to know or control it).
export DB_HOST_PORT REDIS_HOST_PORT TZ APP_TIMEZONE

# Prevent Docker Compose from importing the developer root `.env` file.
# This is runner-owned profile policy, not a tester-selectable topology knob:
# even an inherited COMPOSE_DISABLE_ENV_FILE=0 must be overwritten.
export COMPOSE_DISABLE_ENV_FILE=1

# E2E 专用 env（runner 权威）。导出给 dev server + migrate +
# seed 进程。WSL 快速 E2E 走独立的 exam_e2e 库（不是 dev 的 exam，也不是 vitest 的
# exam_test），这样 reseed 只覆盖 e2e 数据，绝不污染 dev/vitest 库（AGENTS.md
# "Local Database Discipline"）。APP_MODE=e2e 使 resolver 强制走
# TEST_DATABASE_URL（test/e2e/ci 分支，绝不停退 DATABASE_URL），并自动关闭限流；
# DATABASE_URL 显式 unset，防止残留的 dev URL 干扰（e2e 模式下 resolver 本来也不会读它）。
E2E_DB_NAME="exam_e2e"
export APP_MODE=e2e
export TEST_DATABASE_URL="postgresql://exam:exam@localhost:${DB_HOST_PORT}/${E2E_DB_NAME}"
export HEARTBEAT_TIMEOUT_MS=15000
export HEARTBEAT_SCAN_INTERVAL_MS=5000
export DEADLINE_SCAN_INTERVAL_MS=5000
# 防止 shell 残留的 dev/prod DB 变量让 resolver 误走 dev 分支。
# 不吞 unset 错误：readonly 变量会使 unset 失败，此时应停止而非带污染 env 继续。
unset DATABASE_URL TEST_DB_URL

# ── 共享 helper（串行 / 并行 shard 路径复用）──────────────────────────
DB_BASE_URL_NO_NAME="postgresql://exam:exam@localhost:${DB_HOST_PORT}"

# 每个库的唯一名前缀，便于失败时按前缀定位 worker 库。
WORKER_DB_PREFIX="exam_e2e_w"
SHARD_PIDS=()
SHARD_LOGS=()
SHARD_WORKER_DBS=()
WORKER_DBS_SERIAL=()

# ── Teardown / lifecycle helpers（串行 / 并行 shard 路径复用）─────────
# 本节集中拥有全部 teardown 顺序与 loud-DROP 契约（issue #256-A）：历史版本
# 在停掉 shard API server 之前就 DROP worker 库，且
# `>/dev/null 2>&1 || true` 吞掉了随之产生的
# "database is being accessed by other users" 错误，使 exam_e2e_w* 永久泄漏。
# 修复把全部 cleanup（停 server → 等待 → DROP 库 → artifacts）收进一个幂等
# 的 run_cleanup，接在下方 EXIT/INT/TERM trap 上；DROP 失败必须可见。
# 并行路径不再内联 DROP——由 run_cleanup 在 server 停止之后统一执行。
#
# 强制契约：
#   1. Cleanup 顺序：停进程组 → 有界等待 → DROP 库 → artifact 清理。
#      DROP 绝不在 API server 可能仍持有连接时执行。
#   2. DROP 失败必须可见：stderr 打印库名 + 原始 PostgreSQL 错误，置
#      cleanup-failure 标志，绝不用 `|| true` 掩盖。
#   3. 退出码优先级：先冻结 Playwright 退出码；cleanup 失败既不能把失败运行
#      变成 exit 0，也不能覆盖测试失败（FAIL/FAIL → Playwright 码，cleanup
#      错误已打印到 stderr）。
#   4. 库名前缀守卫：只接受 `exam_e2e` 与 `exam_e2e_w<N>`；`exam`、
#      `postgres`、`exam_test`、生产库名与注入尝试一律拒绝。
#   5. 幂等 cleanup：INT/TERM/EXIT/重入最多执行一次。
#   6. 串行库持久：serial 库（`exam_e2e`）永不 DROP——它是 `--no-reseed`
#      跨运行复用的持久 dev-e2e 库（历史默认；旧脚本只 DROP
#      `exam_e2e_w<N>`）。只有并行 worker 库是 ephemeral。串行身份仍在
#      启动时登记，让每条退出路径（migrate/seed/health）都能点名它。
#   7. 整组关停：stop_process_group 等待整个进程组而非仅 leader——一个忽略
#      TERM 的子进程不得存活并占住端口/连接。
#   8. compose teardown 必须可见：`docker compose ps`/`down` 失败置
#      CLEANUP_FAILURE，绝不吞掉（有 pending DROP 却少了 db 容器是 cleanup
#      失败，不是静默跳过）。
#   9. Flag 校验：validate_run_flags 拒绝并行模式下的 `--keep-server` 与
#      `--no-reseed`（生命周期语义未定义）。
#  10. 遗留库归档：启动时已存在的 exam_e2e_w<N> 是取证现场
#      （E2E_KEEP_WORKER_DB_ON_FAILURE 保留，或崩溃泄漏），绝不是本次运行的
#      执行状态。archive_retained_worker_db 把它改名成 exam_e2e_w<N>_prior
#      （驱逐上一代归档——每槽保留一代），本次运行建全新库；run_cleanup
#      从不触碰 _prior 归档。

# ── DB-name safety ────────────────────────────────────────────────────────
# Matches ONLY:
#   exam_e2e                  (serial path worker DB)
#   exam_e2e_w0..w99          (parallel shard worker DBs)
#   exam_e2e_w0..w99_prior    (forensic archives of failed runs)
# Anchored — rejects `exam`, `postgres`, `exam_test`, `exam_e2e_w0;DROP...`,
# `exam_e2e_evil`, etc. Kept in sync with packages/db name-safety intent
# (test/e2e/ci only) but stricter, because this guards a DROP.
WORKER_DB_NAME_RE='^exam_e2e(_w[0-9]+)?(_prior)?$'

# is_safe_worker_db_name <db_name> → 0 if safe, 1 otherwise.
# Pure string check; no external commands.
is_safe_worker_db_name() {
  local db="$1"
  [[ "$db" =~ $WORKER_DB_NAME_RE ]]
}

# is_safe_archive_db_name <db_name> → 0 iff the name is a forensic archive
# slot (exam_e2e_w<N>_prior). Archives are rename TARGETS of
# archive_retained_worker_db and may be DROPped by it when evicting the
# previous generation; they must never be mistaken for active worker DBs.
is_safe_archive_db_name() {
  [[ "$1" =~ ^exam_e2e_w[0-9]+_prior$ ]]
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
# `setsid` in launch_api puts each API server in its own process group
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

# ── Archive a retained worker DB out of the active namespace ──────────────
# archive_retained_worker_db <cid> <db_name>
#
# Issue #330 root cause: a worker DB that survived a previous run (failure
# retention via E2E_KEEP_WORKER_DB_ON_FAILURE=1, or a crash that bypassed
# cleanup) contains that run's mutable state (evidence ledgers, attempts,
# audit rows). Reusing it as this run's worker DB — even after migrate +
# reseed — leaks that state into the new run's preconditions ("preserve for
# forensics" was silently conflated with "reuse as execution baseline").
#
# This function separates the two concerns: the retained DB is RENAMED to
# <db>_prior (a forensic artifact, inspectable, outside the active worker
# namespace), and the caller then creates a FRESH <db> for this run. The
# previous archive generation is evicted first (keep-1 per worker slot, so
# disk stays bounded at ≤ E2E_WORKERS archives).
#
# Loud contract (mirrors drop_worker_db_loud):
#   - rejects unsafe active/archive names (stderr, rc=2);
#   - a docker/psql failure prints the raw error and returns 1 — never
#     swallowed, never `|| true`d;
#   - a missing <db> is a clean no-op (rc=0) — nothing to archive;
#   - success returns 0.
archive_retained_worker_db() {
  local cid="$1" db="$2" archive exists_out
  if ! is_safe_worker_db_name "$db" || [[ "$db" == *_prior ]]; then
    printf '[e2e-wsl] 拒绝归档不安全的 worker 库名: "%s"\n' "$db" >&2
    return 2
  fi
  archive="${db}_prior"
  if ! is_safe_archive_db_name "$archive"; then
    printf '[e2e-wsl] 拒绝不安全的归档库名: "%s"\n' "$archive" >&2
    return 2
  fi
  if [[ -z "$cid" ]]; then
    printf '[e2e-wsl] archive_retained_worker_db("%s"): 缺少 db 容器 id\n' "$db" >&2
    return 3
  fi
  # Exists? A FAILED existence query is an error (never silently treated as
  # "missing" — that would let a retained DB slide into this run); a
  # successful empty result is a clean no-op.
  if ! exists_out="$(docker exec "$cid" psql -U exam -d postgres -tAc \
      "SELECT 1 FROM pg_database WHERE datname='${db}'" 2>&1)"; then
    printf '[e2e-wsl] 检查 worker 库 %s 是否存在失败（docker/psql 错误）。输出:\n%s\n' \
      "$db" "$exists_out" >&2
    return 1
  fi
  if ! grep -q 1 <<<"$exists_out"; then
    return 0
  fi
  log "发现遗留 worker 库 ${db}（上次失败保留/泄漏）→ 归档为 ${archive}（本次运行使用全新库）"
  # Evict the previous forensic generation first (keep-1). A failure here is
  # fatal for the archive step: proceeding would overwrite the only copy.
  if ! exists_out="$(docker exec "$cid" psql -U exam -d postgres -tAc \
      "SELECT 1 FROM pg_database WHERE datname='${archive}'" 2>&1)"; then
    printf '[e2e-wsl] 检查旧归档 %s 是否存在失败（docker/psql 错误）。输出:\n%s\n' \
      "$archive" "$exists_out" >&2
    return 1
  fi
  if grep -q 1 <<<"$exists_out"; then
    warn "淘汰旧取证归档 ${archive}（每 worker 仅保留最近一次失败的现场）"
    # drop_worker_db_loud reads DROP_DB_CID from the environment; point it at
    # this container. run_cleanup re-resolves/overwrites it for its own drops.
    DROP_DB_CID="$cid"
    if ! drop_worker_db_loud "$archive"; then
      return 1
    fi
  fi
  # Names are regex-validated bare identifiers; quote them anyway (defense in
  # depth, same as drop_worker_db_loud).
  local rename_out
  if ! rename_out="$(docker exec "$cid" psql -U exam -d postgres -c \
      "ALTER DATABASE \"${db}\" RENAME TO \"${archive}\"" 2>&1 >/dev/null)"; then
    printf '[e2e-wsl] 归档 %s → %s 失败。PostgreSQL 输出:\n%s\n' \
      "$db" "$archive" "$rename_out" >&2
    return 1
  fi
  return 0
}

# ── Unified cleanup orchestrator ──────────────────────────────────────────
# run_cleanup
# Single owner of all teardown. Reads module-level state set before trapping
# (all are `${VAR:-default}` so unset is safe):
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
#                                       resolve; otherwise resolved from
#                                       DEV_COMPOSE here.
#
# Idempotency: guarded by CLEANUP_DONE / CLEANUP_RUNNING so INT/TERM/EXIT and
# re-entrancy cannot fire it twice or recurse.
#
# Returns nonzero if any teardown step failed (caller may use this); does NOT
# exit — exit-code computation is split out into compute_final_exit.
run_cleanup() {
  if [[ "${CLEANUP_RUNNING:-0}" == "1" || "${CLEANUP_DONE:-0}" == "1" ]]; then
    return 0
  fi
  CLEANUP_RUNNING=1

  local code="${FROZEN_EXIT:-0}"
  CLEANUP_FAILURE="${CLEANUP_FAILURE:-0}"

  # ---- 1. Stop servers FIRST, so they release DB connections. ----
  # The stop guard looks at the WHOLE process group, not just the leader:
  # the setsid leader may have exited (and been reaped) while a child still
  # holds the port/connection — a leader-only `kill -0` would skip the stop
  # and leak the child (round-2 review P2).
  if [[ "${E2E_WORKERS:-1}" -gt 1 ]]; then
    local sp idx=0
    for sp in "${SHARD_PIDS[@]:-}"; do
      [[ -z "$sp" ]] && { idx=$((idx+1)); continue; }
      if kill -0 "$sp" 2>/dev/null || process_group_alive "$sp"; then
        log "停 shard $((idx+1)) API server (pid $sp, 进程组)..."
        if ! stop_process_group "$sp"; then
          err "shard $((idx+1)) server (pid $sp) 未能干净退出"
          CLEANUP_FAILURE=1
        fi
      fi
      idx=$((idx+1))
    done
  fi

  if [[ -n "${API_PID:-}" ]]; then
    if kill -0 "${API_PID}" 2>/dev/null || process_group_alive "${API_PID}"; then
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
  fi

  # ---- 2. Drop worker DBs (only after servers are stopped). ----
  # Parallel: exam_e2e_w<N> are ephemeral — dropped every run (retention only
  # with E2E_KEEP_WORKER_DB_ON_FAILURE=1 on failure). Serial: exam_e2e is the
  # persistent dev-e2e DB (--no-reseed depends on it surviving between runs;
  # matches the historical script, which only ever dropped exam_e2e_w<N>), so
  # it is never a drop candidate. run.sh registers both identities BEFORE
  # any failing operation (migrate/seed/health), so every exit path is
  # covered.
  local -a dbs_to_drop=()
  local keep_dbs=0 preserve_worker_dbs=0
  # Freeze the retention intent up-front (round-2 review P1): failure +
  # E2E_KEEP_WORKER_DB_ON_FAILURE=1 must preserve the WHOLE DB environment —
  # worker DBs AND the compose that hosts them (a script-started compose would
  # otherwise be `down -v`'d, deleting the retained DBs with the container).
  if [[ "$code" -ne 0 && "${E2E_KEEP_WORKER_DB_ON_FAILURE:-0}" == "1" ]]; then
    preserve_worker_dbs=1
  fi
  if [[ "${E2E_WORKERS:-1}" -gt 1 ]]; then
    # Filter empty entries: `"${arr[@]:-}"` on an unset/empty array yields one
    # empty placeholder (bash >= 4.4), which would make the length check below
    # treat "zero DBs" as "1 pending DB" and false-positive a cleanup failure.
    local db
    for db in "${SHARD_WORKER_DBS[@]:-}"; do
      [[ -z "$db" ]] && continue
      dbs_to_drop+=("$db")
    done
    if [[ "$preserve_worker_dbs" == "1" ]]; then
      keep_dbs=1
      warn "测试失败 + E2E_KEEP_WORKER_DB_ON_FAILURE=1：保留 worker 库便于诊断。"
      for db in "${dbs_to_drop[@]:-}"; do
        [[ -z "$db" ]] && continue
        warn "  保留 ${db}（手动删: docker exec <db-ct> psql -U exam -d postgres -c 'DROP DATABASE \"${db}\" WITH (FORCE)')"
      done
      if [[ "${DEV_COMPOSE_WAS_UP:-0}" == "0" && -n "${DEV_COMPOSE:-}" ]]; then
        warn "  本次由脚本启动的 dev compose 保持运行（保留 worker 库的数据）；手动清理: docker compose -f ${DEV_COMPOSE} down -v"
      fi
    fi
  elif [[ "$code" -ne 0 && -v WORKER_DBS_SERIAL && "${#WORKER_DBS_SERIAL[@]}" -gt 0 ]]; then
    warn "serial 库 ${WORKER_DBS_SERIAL[*]} 失败保留（持久化策略；--no-reseed 依赖此库跨运行存在，下次运行 migrate 幂等自愈）"
  fi

  if [[ "${#dbs_to_drop[@]}" -gt 0 && "$keep_dbs" == "0" ]]; then
    # Resolve the dev-compose db container id ONLY if the caller did not
    # pre-set DROP_DB_CID. Distinguish a REAL command failure from "no
    # container": a failed `compose ps` or a missing container with pending
    # drops is a cleanup failure (loud), not a silent skip.
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
  #         under KEEP_SERVER or worker-DB retention — a kept server / kept
  #         DB needs its compose). ----
  # DEV_COMPOSE_WAS_UP defaults to "1" (prevent teardown): an UNKNOWN startup
  # state must never `down -v` dev volumes; teardown requires an explicit
  # "0". Subshell scopes the `cd`; no `local` inside it. `compose ps` /
  # `down` failures are loud: they set CLEANUP_FAILURE via the subshell rc.
  if [[ "${KEEP_SERVER:-0}" != "1" && "$preserve_worker_dbs" != "1" && \
        -n "${ROOT_DIR:-}" && -n "${DEV_COMPOSE:-}" && -f "$DEV_COMPOSE" && \
        "${DEV_COMPOSE_WAS_UP:-1}" == "0" ]]; then
    (
      cd "$ROOT_DIR" || exit 0
      if ! _sc_still="$(docker compose -f "$DEV_COMPOSE" ps -q db 2>&1)"; then
        err "run_cleanup: compose ps 失败，跳过 dev compose teardown："
        printf '%s\n' "$_sc_still" >&2
        exit 3
      fi
      if [[ -n "$_sc_still" ]]; then
        log "关 dev compose（由 run.sh 启动）..."
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

# ── Exit-code finalization ────────────────────────────────────────────────
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

# ── Trap handlers ─────────────────────────────────────────────────────────
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

# ── 参数组合校验（fail fast，任何副作用之前）────────────────────────────
# --keep-server / --no-reseed 的保留/复用语义只在单 server 串行路径有定义。
validate_run_flags "$RESEED" "$E2E_WORKERS" "$KEEP_SERVER" || exit 2

# ensure_db_exists <db_name>：幂等创建库（连 exam 库执行 CREATE DATABASE）。
ensure_db_exists() {
  local db="$1" cid
  cid="$(docker compose -f "$DEV_COMPOSE" ps -q db)"
  if ! docker exec "$cid" psql -U exam -tAc \
    "SELECT 1 FROM pg_database WHERE datname='${db}'" | grep -q 1; then
    docker exec "$cid" psql -U exam -c "CREATE DATABASE ${db}" >/dev/null
  fi
}

# migrate_db <db_url>：对指定库跑 migrate（stderr 保留）。
# APP_MODE=e2e 下 resolver 走 TEST_DATABASE_URL（test/e2e/ci 分支）。
migrate_db() { TEST_DATABASE_URL="$1" pnpm --filter @exam/api exec tsx src/scripts/migrate.ts 1>/dev/null; }

# seed_db <db_url>：对指定库跑 e2e seed（idempotent）。
seed_db()   { TEST_DATABASE_URL="$1" pnpm --filter @exam/api exec tsx src/e2e-seed.ts >/dev/null; }

# launch_api <db_url> <port> <log_file>：后台起一个 dev server，pid 写入全局
# launch_api <db_url> <port> <log_file> <mode>：后台起一个 API server，pid 写入
# 全局 LAUNCHED_PID（不通过 stdout，避免 $(...) 命令替换把后台进程跑在立即退出
# 的子 shell 里）。mode=dev 用 tsx watch（本地单 server 串行路径，保留热重载）；
# mode=start 用构建产物 node dist/server.js（并行 shard 路径——避免 tsx watch 在
# 多 server 共享源码树时互相触发重启，打断 disconnect-restore 等 15s 心跳 spec）。
# 使用 setsid 建独立进程组，便于 cleanup 时 kill -- -PID 整组。
LAUNCHED_PID=""
launch_api() {
  local db_url="$1" port="$2" logfile="$3" mode="${4:-dev}"
  local cmd
  if [[ "$mode" == "start" ]]; then
    cmd=(pnpm --filter @exam/api start)
  else
    cmd=(pnpm --filter @exam/api dev)
  fi
  # 身份一次性链接由本 API 进程按 PUBLIC_WEB_ORIGIN 生成绝对 URL，浏览器
  # 随后直接 goto 该 URL；origin 必须是本进程端口（SPA 由 API 进程自己服务），
  # 缺省时 runtime config 会回退到 Vite dev origin(:5173)，那里无进程监听。
  # APP_PORT 必须显式跟随 shard 端口：e2e 模式的 bind-port owner 是
  # APP_PORT ?? DEV_API_PORT（runtimeConfig.resolveApiBindPort），而 dotenv
  # 加载的根 .env 不覆盖已存在的 process.env——deploy 风格 .env 遗留的
  # APP_PORT=3000 会让所有 shard 绑同一端口（EADDRINUSE / 健康检查错位）。
  DEV_API_PORT="$port" APP_PORT="$port" TEST_DATABASE_URL="$db_url" \
    PUBLIC_WEB_ORIGIN="http://localhost:${port}" \
    APP_MODE=e2e \
    HEARTBEAT_TIMEOUT_MS=15000 HEARTBEAT_SCAN_INTERVAL_MS=5000 DEADLINE_SCAN_INTERVAL_MS=5000 \
    setsid "${cmd[@]}" >"$logfile" 2>&1 &
  LAUNCHED_PID=$!
}

# wait_health <port> <pid> <log_file>：轮询 health，失败打印日志并返回非零。
wait_health() {
  local port="$1" pid="$2" logfile="$3" i
  for i in $(seq 1 60); do
    if curl -sf "http://localhost:${port}/api/health" >/dev/null 2>&1; then return 0; fi
    if ! kill -0 "$pid" 2>/dev/null; then
      err "api server(:${port}) 进程退出。日志："; tail -30 "$logfile" >&2; return 1
    fi
    sleep 1
  done
  err "api(:${port}) 60s 内未健康。日志："; tail -30 "$logfile" >&2; return 1
}

build_assets() {
  log "构建前端 + API + 同步 apps/api/public..."
  pnpm --filter @exam/web build >/dev/null
  pnpm --filter @exam/api build >/dev/null
  rm -rf apps/api/public
  cp -r apps/web/dist apps/api/public
}

# ────────────────────────────────────────────────────────────────────

# 预检
command -v pnpm >/dev/null 2>&1 || { err "未找到 pnpm"; exit 127; }
command -v docker >/dev/null 2>&1 || { err "未找到 docker"; exit 127; }

# 记录 dev compose 在 run.sh 启动前的状态，cleanup 时恢复原状：
# 跑前已运行的，不关；由本脚本启动的，跑完关掉（含数据卷）。
# 注意：不能用 `docker compose ps -q db` 的退出码判断——它在「无容器运行」时
# 仍返回 exit 0（stdout 为空），会导致本变量恒为 1，cleanup 永不关 compose。
# 必须以 stdout 非空作为「确实有容器在跑」的判据。
DEV_COMPOSE_WAS_UP=0
if [[ -n "$(docker compose -f "$DEV_COMPOSE" ps -q db 2>/dev/null || true)" ]]; then
  DEV_COMPOSE_WAS_UP=1
fi
API_PID=""
# FROZEN_EXIT is set by the run phases before any trap can fire; run_cleanup +
# compute_final_exit read it. Defaults to 0 if the script exits early (e.g.
# migrate failure → `exit 1` below sets it first).
FROZEN_EXIT=0
CLEANUP_FAILURE=0
CLEANUP_DONE=0
CLEANUP_RUNNING=0

# ── Unified cleanup (issue #256-A) ────────────────────────────────────────
# All teardown is owned by run_cleanup (above). The EXIT trap
# freezes the real exit code (FROZEN_EXIT) BEFORE running cleanup, runs
# cleanup once, then calls compute_final_exit to pick the priority-matrix
# code (Playwright code wins; cleanup failure can only escalate 0 → 70).
# INT/TERM freeze 130/143 and run the SAME cleanup via the EXIT trap
# (`exit` from a signal handler triggers EXIT), so signals never bypass DB
# teardown and the trap chain is single.
trap exit_handler EXIT
trap 'signal_handler INT'  INT
trap 'signal_handler TERM' TERM

# 1. dev compose（db + redis）——串行/并行共用。
log "启动 dev compose (db + redis)..."
docker compose -f "$DEV_COMPOSE" up -d --wait >/dev/null

# 1b. 清理 test-results/playwright-report（可能含 Docker run 残留的 root 拥有文件）。
docker run --rm -v "$ROOT_DIR/apps/e2e:/data" alpine \
  sh -c "rm -rf /data/test-results /data/playwright-report" 2>/dev/null || true

build_assets

# ── 公共 Playwright 参数组装（spec 选择 / grep / 额外参数）────────────
assemble_pw_args() {
  PW_ARGS=()
  if [[ -n "$GREP_PATTERN" ]]; then PW_ARGS+=(--grep "$GREP_PATTERN"); fi
  for k in "${SPEC_KEYS[@]:-}"; do [[ -n "$k" ]] && PW_ARGS+=("$k"); done
  PW_ARGS+=("${EXTRA_PW_ARGS[@]}")
}

# ════════════════════════════════════════════════════════════════════
# 分支：E2E_WORKERS
# ════════════════════════════════════════════════════════════════════
if [[ "$E2E_WORKERS" -le 1 ]]; then
  # ── 串行路径（原行为）──────────────────────────────────────────────
  E2E_DB_NAME="exam_e2e"

  # Register the DB identity BEFORE any failing operation (ensure/migrate/
  # seed/health): the EXIT-trap cleanup must know exam_e2e on every exit path
  # (issue #256-A review P1-1). Serial exam_e2e persists across runs by
  # default (--no-reseed depends on it), so cleanup never drops it — the
  # registration drives the failure-retention diagnostics.
  WORKER_DBS_SERIAL=("$E2E_DB_NAME")

  # 确保 exam_e2e 库存在
  ensure_db_exists "$E2E_DB_NAME"

  log "迁移 ${E2E_DB_NAME} 库..."
  migrate_db "${DB_BASE_URL_NO_NAME}/${E2E_DB_NAME}"

  if [[ "$RESEED" == "1" ]]; then
    log "E2E seed (baseline + demo)..."
    seed_db "${DB_BASE_URL_NO_NAME}/${E2E_DB_NAME}"
  else
    warn "跳过 seed（--no-reseed），复用现有数据"
  fi

  log "启动 api dev server (:$DEV_API_PORT, APP_MODE=e2e, fast scanners)..."
  launch_api "${DB_BASE_URL_NO_NAME}/${E2E_DB_NAME}" "$DEV_API_PORT" /tmp/e2e-wsl-api.log
  API_PID="$LAUNCHED_PID"

  log "等待 api 健康..."
  wait_health "$DEV_API_PORT" "$API_PID" /tmp/e2e-wsl-api.log || exit 1

  log "运行 Playwright（WSL 本地，workers=1）..."
  cd apps/e2e
  assemble_pw_args
  set +e
  E2E_BASE_URL="http://localhost:${DEV_API_PORT}" npx playwright test "${PW_ARGS[@]}" --reporter=list
  # Freeze Playwright's real exit code; the EXIT trap (exit_handler) will
  # run_cleanup (stop server → keep persistent exam_e2e → artifacts) and
  # compute the final priority-matrix code. We must NOT `exit $?` directly —
  # that would skip freezing and the trap would see the wrong FROZEN_EXIT.
  FROZEN_EXIT=$?
  set -e
  exit "$FROZEN_EXIT"
fi

# ── 并行 shard 路径（E2E_WORKERS>1）────────────────────────────────────
# 每个 shard = 独立 exam_e2e_w{N} 库 + 独立 API server（端口 BASE+i）。
# Playwright 以 file-level granularity 切分 shard（fullyParallel:false），保证
# 同一文件内的 serial 顺序不被打断；不同 shard 的 candidate/attempt/audit 完全
# 隔离（不同库）。汇总所有 shard 退出码：任一非零则整体失败。
log "并行模式：E2E_WORKERS=${E2E_WORKERS}，每 shard 独立 DB + server。"

# 1. 为每个 shard 建库（幂等）。顺序固定为「先归档 → 后 claim → 再创建」：
#    - 启动前若同名库已存在（失败保留/崩溃泄漏的取证现场），先归档为
#      *_prior 再建全新库 —— 保留取证 ≠ 复用执行状态（issue #330）。
#    - DB identity 只在归档成功之后登记（#330 review P1-2）：归档失败 →
#      exit 1 时，同名库是上一轮遗留的取证现场、尚未被本轮 claim，EXIT
#      cleanup 无权 DROP 它。若先登记再归档，归档失败的退出路径会把这个
#      取证现场当作本轮 ephemeral 库清掉，毁灭取证证据。
#    - 登记仍在 ensure/migrate/seed/health 等可能失败的操作之前（issue
#      #256-A review P1-1），任何退出路径 cleanup 都知道要清理哪些库。
ARCHIVE_CID="$(docker compose -f "$DEV_COMPOSE" ps -q db)"
for (( i=0; i<E2E_WORKERS; i++ )); do
  if ! archive_retained_worker_db "$ARCHIVE_CID" "${WORKER_DB_PREFIX}${i}"; then
    err "归档遗留 worker 库 ${WORKER_DB_PREFIX}${i} 失败，拒绝在不干净的基线上继续"
    exit 1
  fi
  SHARD_WORKER_DBS+=("${WORKER_DB_PREFIX}${i}")
  ensure_db_exists "${WORKER_DB_PREFIX}${i}"
done

# 2. 并行 migrate + seed 每个 shard 库（后台）。RESEED=0 时跳过 seed。
log "并行 migrate + seed ${E2E_WORKERS} 个 worker 库..."
MIG_PIDS=()
for (( i=0; i<E2E_WORKERS; i++ )); do
  (
    set -e
    local_url="${DB_BASE_URL_NO_NAME}/${WORKER_DB_PREFIX}${i}"
    migrate_db "$local_url"
    if [[ "$RESEED" == "1" ]]; then seed_db "$local_url"; fi
  ) >/tmp/e2e-wsl-w${i}-migrate.log 2>&1 &
  MIG_PIDS+=($!)
done
MIG_FAIL=0
for (( i=0; i<E2E_WORKERS; i++ )); do
  if ! wait "${MIG_PIDS[$i]}"; then
    err "shard $((i+1)) migrate/seed 失败（db=${WORKER_DB_PREFIX}${i}）。日志："
    tail -30 /tmp/e2e-wsl-w${i}-migrate.log >&2
    MIG_FAIL=1
  fi
done
[[ "$MIG_FAIL" -eq 1 ]] && exit 1

# 3. 启动每个 shard 的 API server。
log "启动 ${E2E_WORKERS} 个 api dev server（端口 ${E2E_WORKER_BASE_PORT}..$((E2E_WORKER_BASE_PORT+E2E_WORKERS-1))）..."
for (( i=0; i<E2E_WORKERS; i++ )); do
  local_url="${DB_BASE_URL_NO_NAME}/${WORKER_DB_PREFIX}${i}"
  local_port=$((E2E_WORKER_BASE_PORT+i))
  logfile="/tmp/e2e-wsl-w${i}-api.log"
  SHARD_LOGS+=("$logfile")
  # start 模式：用构建产物 node dist/server.js（无 tsx watch 文件监听），
  # 避免多 server 共享源码树时互相触发重启。
  launch_api "$local_url" "$local_port" "$logfile" start
  SHARD_PIDS+=("$LAUNCHED_PID")
done

# 4. 等所有 shard server 健康。
for (( i=0; i<E2E_WORKERS; i++ )); do
  local_port=$((E2E_WORKER_BASE_PORT+i))
  log "等待 shard $((i+1)) api 健康 (:${local_port}, db=${WORKER_DB_PREFIX}${i})..."
  wait_health "$local_port" "${SHARD_PIDS[$i]}" "${SHARD_LOGS[$i]}" || exit 1
done

# 5. 并行跑 N 个 shard。每个 shard 一个 Playwright 进程，--shard=i/N，独立 baseURL。
log "并行运行 ${E2E_WORKERS} 个 Playwright shard..."
cd apps/e2e
assemble_pw_args
# 给 shard 进程建独立进程组（setsid），便于 cleanup。
# 每个 shard 输出到独立目录，避免并发写冲突。
run_pids=()
# `set +e`: a shard failure returns nonzero from `wait` below; we must NOT let
# `set -e` abort before we freeze the worst Playwright exit code. set -e is
# restored right after the wait loop.
set +e
for (( i=0; i<E2E_WORKERS; i++ )); do
  local_port=$((E2E_WORKER_BASE_PORT+i))
  local_url="${DB_BASE_URL_NO_NAME}/${WORKER_DB_PREFIX}${i}"
  shard_out_dir="test-results/shard-${i}"
  mkdir -p "$shard_out_dir"
  (
    E2E_BASE_URL="http://localhost:${local_port}" \
      E2E_SHARD_TOTAL="$E2E_WORKERS" \
      PLAYWRIGHT_BLOB_OUTPUT_DIR="blob-report/shard-${i}" \
      E2E_TEST_DATABASE_URL="$local_url" \
      setsid npx playwright test "${PW_ARGS[@]}" \
      --shard="$((i+1))/${E2E_WORKERS}" \
      --output="$shard_out_dir" \
      >/tmp/e2e-wsl-w${i}-pw.log 2>&1
  ) &
  # 捕获 setsid 子进程 pid
  run_pids+=($!)
done

# 6. 汇总退出码（任一 shard 非零则整体失败）。
WORST=0
for (( i=0; i<E2E_WORKERS; i++ )); do
  if wait "${run_pids[$i]}"; then
    log "shard $((i+1))/${E2E_WORKERS} 通过 ✓"
  else
    ec=$?
    err "shard $((i+1))/${E2E_WORKERS} 失败 (exit=$ec)。Playwright 日志："
    tail -40 /tmp/e2e-wsl-w${i}-pw.log >&2 || true
    WORST=$ec
  fi
done
set -e

# 7. 合并 blob report（各 shard 的 blob 合为一份 HTML report）。
if ls blob-report/shard-*/report-*.zip >/dev/null 2>&1; then
  log "合并 ${E2E_WORKERS} 个 blob report..."
  BLOB_MERGE_DIR="blob-report/merged"
  rm -rf "$BLOB_MERGE_DIR"
  mkdir -p "$BLOB_MERGE_DIR"
  cp blob-report/shard-*/report-*.zip "$BLOB_MERGE_DIR/"
  npx playwright merge-reports --reporter html "$BLOB_MERGE_DIR" >/dev/null 2>&1 || \
    warn "merge-reports 失败（单个 shard 空结果时可忽略）"
  log "HTML report: apps/e2e/playwright-report/index.html"
fi

# 8. 切回 root dir（cleanup 中 docker compose down 需要正确 project context）。
cd "$ORIG_CWD"

# 9. Freeze the worst Playwright exit code and exit. The EXIT trap
# (exit_handler → run_cleanup) now owns ALL teardown in the correct order:
#   stop shard servers (process groups, bounded wait)
#   → drop worker DBs (loud; no `|| true`)
#   → remove temp logs (success path only)
#   → compose down (if this script started it)
# This replaces the OLD inline `drop_db_if_allowed` loop that ran BEFORE the
# servers were stopped (issue #256-A root cause). Cleanup failure is folded
# into the final code by compute_final_exit per the priority matrix.
FROZEN_EXIT="$WORST"
exit "$WORST"
