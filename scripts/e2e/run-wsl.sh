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
#   - RATE_LIMIT_DISABLED=1         E2E 连续登录/请求不能被限流
#   - HEARTBEAT_TIMEOUT_MS=15000    disconnect-restore spec 依赖 15s 超时
#   - HEARTBEAT_SCAN_INTERVAL_MS=5000 / DEADLINE_SCAN_INTERVAL_MS=5000
# 缺这些 env，disconnect/restore 类 spec 会因 scanner 时序不符而 timeout。
#
# 用法：
#   bash scripts/e2e/run-wsl.sh                       # 跑全部 spec
#   bash scripts/e2e/run-wsl.sh candidate-happy-path  # 关键字匹配 spec 文件
#   bash scripts/e2e/run-wsl.sh --grep "happy path"   # Playwright 标题正则
#   bash scripts/e2e/run-wsl.sh --no-reseed           # 复用现有 seed（不重 seed）
#   bash scripts/e2e/run-wsl.sh --keep-server         # 跑完保留 dev server
#
# 环境变量：
#   APP_PORT          api/dev server 端口，默认 3000
#   KEEP_SERVER=1     等价于 --keep-server
#
# 退出码：直接透传 playwright 退出码。

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

DEV_COMPOSE="docker-compose.dev.yml"
APP_PORT="${APP_PORT:-3000}"
KEEP_SERVER="${KEEP_SERVER:-0}"
RESEED=1
GREP_PATTERN=""
SPEC_KEYS=()
EXTRA_PW_ARGS=()

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
# seed 进程。TEST_DATABASE_URL 显式不设，使 resolver 走 dev 分支连 DATABASE_URL
# （exam 库），与 E2E seed 的目标库一致。
export APP_MODE=development
export DATABASE_URL="postgresql://exam:exam@localhost:${DB_HOST_PORT:-15432}/exam"
export RATE_LIMIT_DISABLED=1
export HEARTBEAT_TIMEOUT_MS=15000
export HEARTBEAT_SCAN_INTERVAL_MS=5000
export DEADLINE_SCAN_INTERVAL_MS=5000
# 防止 shell 残留的 TEST_* 变量让 resolver 误走 test 分支。
unset TEST_DATABASE_URL TEST_DB_URL 2>/dev/null || true

# 预检
command -v pnpm >/dev/null 2>&1 || { err "未找到 pnpm"; exit 127; }
command -v docker >/dev/null 2>&1 || { err "未找到 docker"; exit 127; }

API_PID=""
cleanup() {
  local code=$?
  if [[ -n "$API_PID" ]] && kill -0 "$API_PID" 2>/dev/null; then
    if [[ "$KEEP_SERVER" == "1" ]]; then
      warn "KEEP_SERVER=1，保留 dev server (pid $API_PID)。手动停：kill $API_PID"
    else
      log "停 dev server (pid $API_PID)..."
      # The dev server is launched via `setsid` (see launch below), so it is a
      # session + process-group leader and PID == PGID. `pnpm dev` -> tsx watch
      # forks node children that would survive a single kill of $API_PID;
      # signaling the negative PID kills the whole group. (man setpgid(2): the
      # leader's PID equals the PGID; man kill(1): a negative pid signals the
      # process group.)
      kill -TERM "-$API_PID" 2>/dev/null || true
      sleep 1
      kill -KILL "-$API_PID" 2>/dev/null || true
      wait "$API_PID" 2>/dev/null || true
    fi
  fi
  return $code
}
trap cleanup EXIT
trap 'err "中断"; exit 130' INT TERM

# 1. dev compose（db + redis）
log "启动 dev compose (db + redis)..."
docker compose -f "$DEV_COMPOSE" up -d --wait >/dev/null

# 1b. 清理 test-results/playwright-report（可能含 Docker run 残留的 root 拥有文件，
#     宿主用户无权 unlink）。用 alpine 容器以 root 清理，避免 EACCES。
docker run --rm -v "$ROOT_DIR/apps/e2e:/data" alpine \
  sh -c "rm -rf /data/test-results /data/playwright-report" 2>/dev/null || true

# 2. migrate（stdout 安静，stderr 保留以便看到失败原因）
log "迁移 exam 库..."
pnpm --filter @exam/api exec tsx src/scripts/migrate.ts 1>/dev/null

# 3. e2e seed（admin + candidate1..4 demo）
if [[ "$RESEED" == "1" ]]; then
  log "E2E seed (baseline + demo)..."
  pnpm --filter @exam/api exec tsx src/e2e-seed.ts >/dev/null
else
  warn "跳过 seed（--no-reseed），复用现有数据"
fi

# 4. build web + 同步到 api/public（dev server serve 静态前端）
log "构建前端并同步到 apps/api/public..."
pnpm --filter @exam/web build >/dev/null
rm -rf apps/api/public
cp -r apps/web/dist apps/api/public

# 5. 起 api dev server（带 E2E env，后台）。用 setsid 建独立 session/进程组，
#    cleanup 时 kill -PID 杀整组（PID==PGID for a session leader），避免 tsx
#    watch fork 的子进程残留占住 :3000。
log "启动 api dev server (:$APP_PORT, RATE_LIMIT_DISABLED, fast scanners)..."
setsid pnpm --filter @exam/api dev >/tmp/e2e-wsl-api.log 2>&1 &
API_PID=$!

# 6. 等 health
log "等待 api 健康..."
for i in $(seq 1 30); do
  if curl -sf "http://localhost:${APP_PORT}/api/health" >/dev/null 2>&1; then
    log "api 健康"; break
  fi
  if ! kill -0 "$API_PID" 2>/dev/null; then
    err "api dev server 进程已退出。日志："; tail -30 /tmp/e2e-wsl-api.log >&2
    exit 1
  fi
  sleep 1
  [[ $i -eq 30 ]] && { err "api 30s 内未健康。日志："; tail -30 /tmp/e2e-wsl-api.log >&2; exit 1; }
done

# 7. 跑 Playwright
log "运行 Playwright（WSL 本地）..."
cd apps/e2e
PW_ARGS=()
if [[ -n "$GREP_PATTERN" ]]; then PW_ARGS+=(--grep "$GREP_PATTERN"); fi
for k in "${SPEC_KEYS[@]:-}"; do [[ -n "$k" ]] && PW_ARGS+=("$k"); done
PW_ARGS+=("${EXTRA_PW_ARGS[@]}")

E2E_BASE_URL="http://localhost:${APP_PORT}" npx playwright test "${PW_ARGS[@]}" --reporter=list
