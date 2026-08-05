#!/usr/bin/env bash

# scripts/e2e/run-wsl.sh
#
# WSL/本地一键执行 E2E（不走 Docker app 镜像，直接在宿主跑 api dev server +
# Playwright）。与 scripts/e2e/run.sh（Docker 模式）互补，失败集合应一致。
#
# 为什么需要这个脚本：WSL+Windows 下宿主 :5432 常被占，dev compose 用 15432；
# 手动跑 E2E 需要一长串步骤（dev compose → migrate → seed → build web →
# 同步 api/public → 起 dev server 带 E2E env → playwright），极易漏步。本脚本
# 固化完整链路，让任何开发者（含 AI agent）一键复现。
#
# 关键：dev server 必须带 E2E 专用 env，与 docker-compose.test.yml 对齐：
#   - APP_MODE=e2e              选择测试数据库路径 + 自动关闭限流（与 CI 一致）
#   - RATE_LIMIT_DISABLED=1     E2E 连续登录/请求不能被限流（双保险，同 CI）
#   - HEARTBEAT_TIMEOUT_MS=15000    disconnect-restore spec 依赖 15s 超时
#   - HEARTBEAT_SCAN_INTERVAL_MS=5000 / DEADLINE_SCAN_INTERVAL_MS=5000
# 缺这些 env，disconnect/restore 类 spec 会因 scanner 时序不符而 timeout。
#
# 用法：
#   bash scripts/e2e/run-wsl.sh                       # 跑全部 spec
#   bash scripts/e2e/run-wsl.sh candidate-happy-path  # 关键字匹配 spec 文件
#   bash scripts/e2e/run-wsl.sh --grep "happy path"   # Playwright 标题正则
#   bash scripts/e2e/run-wsl.sh --no-reseed           # 复用现有 seed（不重 seed，仅串行）
#   bash scripts/e2e/run-wsl.sh --keep-server         # 跑完保留 dev server（仅串行）
#
# 环境变量：
#   APP_PORT          api/dev server 端口，默认 3000
#   KEEP_SERVER=1     等价于 --keep-server
#   E2E_WORKERS       并行 shard 数；--keep-server / --no-reseed 仅支持 =1
#
# 数据库生命周期（issue #256-A review）：
#   - 并行 worker 库 exam_e2e_w<N> 为 ephemeral：每次运行结束（stop server 后）
#     一律 DROP（失败保留仅限 E2E_KEEP_WORKER_DB_ON_FAILURE=1）。
#   - 串行 exam_e2e 库持久保留（历史默认；--no-reseed 依赖它跨运行存在），
#     脚本从不主动 DROP 它。DB identity 在可能失败的操作（migrate/seed/
#     health）之前登记，确保任何退出路径 cleanup 都知道要清理/保留什么。
#
# 退出码：Playwright 退出码（任一 shard 失败则取最差非零）；若 cleanup 失败
#   且测试本身通过，则用 sentinel 70 覆盖（见 run-wsl-lib.sh 的
#   compute_final_exit）。cleanup 永不掩盖 Playwright 失败。INT/TERM 中断为
#   130/143（signal_handler），参数组合非法为 2。

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"
ORIG_CWD=$(pwd)

DEV_COMPOSE="${ROOT_DIR}/docker-compose.dev.yml"
APP_PORT="${APP_PORT:-3000}"
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

usage() { sed -n '3,40p' "$0"; }

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

# E2E 专用 env（与 docker-compose.test.yml 对齐）。导出给 dev server + migrate +
# seed 进程。WSL 快速 E2E 走独立的 exam_e2e 库（不是 dev 的 exam，也不是 vitest 的
# exam_test），这样 reseed 只覆盖 e2e 数据，绝不污染 dev/vitest 库（AGENTS.md
# "Local Database Discipline"）。APP_MODE=e2e 使 resolver 强制走
# TEST_DATABASE_URL（test/e2e/ci 分支，绝不停退 DATABASE_URL），并自动关闭限流；
# DATABASE_URL 显式 unset，防止残留的 dev URL 干扰（e2e 模式下 resolver 本来也不会读它）。
E2E_DB_NAME="exam_e2e"
export APP_MODE=e2e
export TEST_DATABASE_URL="postgresql://exam:exam@localhost:${DB_HOST_PORT:-15432}/${E2E_DB_NAME}"
export RATE_LIMIT_DISABLED=1
export HEARTBEAT_TIMEOUT_MS=15000
export HEARTBEAT_SCAN_INTERVAL_MS=5000
export DEADLINE_SCAN_INTERVAL_MS=5000
# 防止 shell 残留的 dev/prod DB 变量让 resolver 误走 dev 分支。
# 不吞 unset 错误：readonly 变量会使 unset 失败，此时应停止而非带污染 env 继续。
unset DATABASE_URL TEST_DB_URL

# ── 共享 helper（串行 / 并行 shard 路径复用）──────────────────────────
DB_HOST_PORT_VAL="${DB_HOST_PORT:-15432}"
DB_BASE_URL_NO_NAME="postgresql://exam:exam@localhost:${DB_HOST_PORT_VAL}"

# 每个库的唯一名前缀，便于失败时按前缀定位 worker 库。
WORKER_DB_PREFIX="exam_e2e_w"
SHARD_PIDS=()
SHARD_LOGS=()
SHARD_WORKER_DBS=()
WORKER_DBS_SERIAL=()

# Source the testable cleanup/cleanup-helper library. The lib defines:
#   is_safe_worker_db_name, wait_for_process_exit, process_group_alive,
#   stop_process_group, drop_worker_db_loud, run_cleanup,
#   compute_final_exit, exit_handler, signal_handler, validate_run_flags
# It owns ALL teardown ordering and the loud-DROP contract (issue #256-A):
# the historical script dropped worker DBs before stopping the shard API
# servers, and `>/dev/null 2>&1 || true` swallowed the resulting
# "database is being accessed by other users" error, leaking exam_e2e_w*.
# run_cleanup is wired to EXIT/INT/TERM below; the parallel path NO LONGER
# drops DBs inline — run_cleanup does it after the servers are stopped.
# shellcheck source=./run-wsl-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/run-wsl-lib.sh"

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
  APP_PORT="$port" TEST_DATABASE_URL="$db_url" \
    APP_MODE=e2e RATE_LIMIT_DISABLED=1 \
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

# 记录 dev compose 在 run-wsl 启动前的状态，cleanup 时恢复原状：
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
# All teardown is owned by run_cleanup (from run-wsl-lib.sh). The EXIT trap
# freezes the real exit code (FROZEN_EXIT) BEFORE running cleanup, runs
# cleanup once, then calls compute_final_exit to pick the priority-matrix
# code (Playwright code wins; cleanup failure can only escalate 0 → 70).
# INT/TERM freeze 130/143 and run the SAME cleanup via the EXIT trap
# (`exit` from a signal handler triggers EXIT), so signals never bypass DB
# teardown and the trap chain is single. exit_handler/signal_handler live in
# the lib so the real handler chain is unit-tested.
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

  log "启动 api dev server (:$APP_PORT, APP_MODE=e2e, fast scanners)..."
  launch_api "${DB_BASE_URL_NO_NAME}/${E2E_DB_NAME}" "$APP_PORT" /tmp/e2e-wsl-api.log
  API_PID="$LAUNCHED_PID"

  log "等待 api 健康..."
  wait_health "$APP_PORT" "$API_PID" /tmp/e2e-wsl-api.log || exit 1

  log "运行 Playwright（WSL 本地，workers=1）..."
  cd apps/e2e
  assemble_pw_args
  set +e
  E2E_BASE_URL="http://localhost:${APP_PORT}" npx playwright test "${PW_ARGS[@]}" --reporter=list
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

# 1. 为每个 shard 建库（幂等）。先登记 DB identity（EXIT trap cleanup 在
#    migrate/seed/health 失败时也要知道要清理哪些库，issue #256-A review
#    P1-1），再创建。
for (( i=0; i<E2E_WORKERS; i++ )); do
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
  shard_out_dir="test-results/shard-${i}"
  mkdir -p "$shard_out_dir"
  (
    E2E_BASE_URL="http://localhost:${local_port}" \
      E2E_SHARD_TOTAL="$E2E_WORKERS" \
      PLAYWRIGHT_BLOB_OUTPUT_DIR="blob-report/shard-${i}" \
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
