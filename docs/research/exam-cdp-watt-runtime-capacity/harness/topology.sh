#!/usr/bin/env bash
# #900/#1021 容量战役研究拓扑编排（RESEARCH ONLY）。
#
# 拓扑（evidence/topology.md 为文档权威）：
#   [client] → nginx:1.30.5-trixie 容器（真 Nginx 入口，deploy/nginx/web.conf
#              派生 conf，仅 upstream 改 host.docker.internal:3300）
#            → host-native API（worktree 冻结 SHA 构建产物 node dist/server.js，
#              APP_MODE=production，canonical run law）
#            → exam-dev compose PG（pnpm db:up 拥有）上的研究库 exam_550_e2e
#              （name-guard：exam_550 前缀；唯一 HTTP 采样库）
#   SPA 静态：nginx 直接服务 worktree apps/web/dist（生产同构）。
#
# 所有路径绝对化：可在任意 cwd 执行（协议 §13 cmd.sh 契约要求
# cwd=/home/hoo/Source/exam 下原样可执行）。
set -euo pipefail

WORKTREE="/home/hoo/Source/exam/.wt-capacity"
RESEARCH="$WORKTREE/docs/research/exam-cdp-watt-runtime-capacity"
HARNESS="$RESEARCH/harness"
LOGS="$HARNESS/logs"
API_DIR="$WORKTREE/apps/api"
# L3-ADMISSION A/B 臂切换（研究专用）：API 构建产物目录与追加 env。默认 dist、
# 无追加 env = 原始 A 臂（冻结 SHA 产物）不变；B 臂由 l3-run.sh 传入
# CAPACITY_API_DIST=dist-l3 + LOGIN_ADMISSION* env（无凭据，仅实验开关）。
API_DIST="${CAPACITY_API_DIST:-dist}"
API_EXTRA_ENV_RAW="${CAPACITY_API_EXTRA_ENV:-}"
API_PORT="${CAPACITY_API_PORT:-3300}"
NGINX_PORT="${CAPACITY_NGINX_PORT:-8080}"
RUN_DB="${CAPACITY_DB:-exam_550_e2e}"
RUN_DB_URL="postgres://exam:exam@127.0.0.1:5432/$RUN_DB"
NET_NAME="exam-cap-net"
NET_SUBNET="172.28.10.0/24"
NGINX_CONTAINER="exam-cap-nginx"
NGINX_IMAGE="nginx:1.30.5-trixie"   # = Dockerfile web-runner stage
API_PID_FILE="$LOGS/api.pid"
API_ENV_FILE="/tmp/exam-capacity-api.env"   # 一次性见证（JWT secret），不入库
API_PUBLIC_ORIGIN="http://127.0.0.1:$NGINX_PORT"

mkdir -p "$LOGS"

log() { printf '[topology] %s\n' "$*"; }
die() { printf '[topology] FATAL: %s\n' "$*" >&2; exit 1; }

require_build() {
  test -f "$API_DIR/$API_DIST/server.js" \
    || die "missing $API_DIR/$API_DIST/server.js — run: pnpm -C $WORKTREE build (A) or the dist-l3 tsc build (B)"
  test -f "$WORKTREE/apps/web/dist/index.html" \
    || die "missing apps/web/dist — run: pnpm -C $WORKTREE build"
}

seed_ts() { # $1 = --phase=...
  pnpm -C "$WORKTREE" --filter @exam/db exec tsx \
    "$RESEARCH/evidence/fixtures/seed-capacity.ts" "$1"
}

api_running() {
  [ -f "$API_PID_FILE" ] && kill -0 "$(cat "$API_PID_FILE")" 2>/dev/null
}

stop_api() {
  if api_running; then
    local pid; pid="$(cat "$API_PID_FILE")"
    log "stopping API (pid $pid)"
    kill -INT "$pid" 2>/dev/null || true
    for _ in $(seq 1 60); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 0.5
    done
    kill -0 "$pid" 2>/dev/null && { log "SIGKILL after 30s grace"; kill -KILL "$pid"; }
    wait "$pid" 2>/dev/null || true
  fi
  rm -f "$API_PID_FILE"
}

stop_nginx() {
  if docker inspect "$NGINX_CONTAINER" >/dev/null 2>&1; then
    log "removing nginx container $NGINX_CONTAINER"
    docker rm -f "$NGINX_CONTAINER" >/dev/null
  fi
}

# Docker Desktop（本环境）里 host.docker.internal=192.168.65.254 走 vpnkit，
# nginx→API 这一跳在 API 侧的对端是 127.0.0.1（api.log remoteAddress 实测）。
# 只信任 $NET_SUBNET 时该跳不受信 → request.ip 回落到 socket 对端 127.0.0.1，
# 所有经 nginx 的客户端 IP 坍缩为同一身份（G1.3 as-built 核对发现；topology.md
# 原先“客户端源 IP 穿透两层”的记载与实测不符）。修正：把 vpnkit 回环跳一并列入
# 受信代理，Fastify 才会采信 nginx 以 $remote_addr 覆盖写入的 XFF。研究拓扑
# override（compose 注释认可的外部代理语义）；产品 bundled 默认不动。
TRUSTED_PROXY_CIDRS_VALUE="$NET_SUBNET,127.0.0.1"

start_api() {
  api_running && die "API already running (pid $(cat "$API_PID_FILE"))"
  # canonical run law（协议 §1）：APP_MODE=production、limiter ON、池 10 不动、
  # REDIS_MODE=optional、CAPACITY_RESEARCH=1；JWT secret 每次启动随机（R3）。
  # L3 B 臂经 CAPACITY_API_DIST/CAPACITY_API_EXTRA_ENV 切换（见顶部注释）。
  local jwt; jwt="$(openssl rand -hex 32)"
  local API_EXTRA_ARGS=()
  if [[ -n "$API_EXTRA_ENV_RAW" ]]; then
    local _kv
    IFS=',' read -r -a _pairs <<< "$API_EXTRA_ENV_RAW"
    for _kv in "${_pairs[@]}"; do
      [[ "$_kv" =~ ^[A-Za-z_][A-Za-z0-9_]*=.+$ ]] || die "bad CAPACITY_API_EXTRA_ENV item: $_kv"
      API_EXTRA_ARGS+=("$_kv")
    done
  fi
  {
    echo "APP_MODE=production"
    echo "NODE_ENV=production"
    echo "APP_PORT=$API_PORT"
    echo "HOST=0.0.0.0"
    echo "DATABASE_URL=$RUN_DB_URL"
    echo "JWT_SECRET=<redacted>"
    echo "CORS_ORIGIN=$API_PUBLIC_ORIGIN"
    echo "PUBLIC_WEB_ORIGIN=$API_PUBLIC_ORIGIN"
    echo "REDIS_URL=redis://127.0.0.1:6379"
    echo "REDIS_MODE=optional"
    echo "CAPACITY_RESEARCH=1"
    echo "TRUSTED_PROXY_CIDRS=$TRUSTED_PROXY_CIDRS_VALUE"
    echo "API_DIST=$API_DIST"
    if [[ -n "$API_EXTRA_ENV_RAW" ]]; then echo "API_EXTRA_ENV=$API_EXTRA_ENV_RAW"; fi
  } > "$API_ENV_FILE"
  chmod 600 "$API_ENV_FILE"
  log "starting host-native API (built artifact $API_DIST, port $API_PORT, extra_env=${API_EXTRA_ENV_RAW:-none})"
  # 直接在当前 shell 后台启动（无 subshell 包装）：`env`/`nohup` 均为 exec 型，
  # $! 即最终 node 进程 pid。`</dev/null` 隔离 stdin，`disown` 防止脚本退出
  # 被 API 进程拖住（首次实现用 `( … & echo $! )`，shell 优先级把 `&` 作用于
  # 整个 `cd && nohup …` 复合命令，pidfile 记录了错误 pid——已实证并修正）。
  (
    cd "$API_DIR"
    nohup env \
      APP_MODE=production NODE_ENV=production \
      APP_PORT="$API_PORT" HOST=0.0.0.0 \
      DATABASE_URL="$RUN_DB_URL" \
      JWT_SECRET="$jwt" \
      CORS_ORIGIN="$API_PUBLIC_ORIGIN" PUBLIC_WEB_ORIGIN="$API_PUBLIC_ORIGIN" \
      REDIS_URL="redis://127.0.0.1:6379" REDIS_MODE=optional \
      CAPACITY_RESEARCH=1 \
      TRUSTED_PROXY_CIDRS="$TRUSTED_PROXY_CIDRS_VALUE" \
      ${API_EXTRA_ARGS[@]+"${API_EXTRA_ARGS[@]}"} \
      node "$API_DIST/server.js" >> "$LOGS/api.log" 2>&1 < /dev/null &
    echo $! > "$API_PID_FILE"
    disown
  )
  # 等待 /api/health 200（最长 45s）
  local i
  for i in $(seq 1 90); do
    if curl -fsS -o /dev/null "http://127.0.0.1:$API_PORT/api/health" 2>/dev/null; then
      log "API ready (pid $(cat "$API_PID_FILE")) after ~$((i/2))s"
      return 0
    fi
    api_running || { tail -5 "$LOGS/api.log" >&2; die "API process exited during startup"; }
    sleep 0.5
  done
  tail -5 "$LOGS/api.log" >&2 || true
  die "API not ready within 45s (/api/health)"
}

start_nginx() {
  docker network inspect "$NET_NAME" >/dev/null 2>&1 \
    || { log "creating docker network $NET_NAME ($NET_SUBNET)"; docker network create --subnet "$NET_SUBNET" "$NET_NAME" >/dev/null; }
  stop_nginx
  log "starting nginx container ($NGINX_IMAGE, 127.0.0.1:$NGINX_PORT -> 80)"
  docker run -d --name "$NGINX_CONTAINER" \
    --network "$NET_NAME" --ip 172.28.10.2 \
    --add-host host.docker.internal:host-gateway \
    -p "127.0.0.1:$NGINX_PORT:80" \
    -v "$WORKTREE/apps/web/dist:/usr/share/nginx/html:ro" \
    -v "$HARNESS/nginx/capacity-web.conf:/etc/nginx/conf.d/default.conf:ro" \
    "$NGINX_IMAGE" >/dev/null
}

health_checks() {
  local fail=0
  # nginx 容器 `docker run -d` 返回不代表 worker 已就绪（首次实测：容器 Up
  # 后立即 curl 收到 connection reset）。给全部入口一个 30s 重试窗口。
  check() { # $1 label, $2 url
    local body i
    for i in $(seq 1 30); do
      body="$(curl -fsS -m 5 "$2" 2>&1)" && { log "OK   $1 ($2)"; return 0; }
      sleep 1
    done
    log "FAIL $1 ($2): $body"; fail=1; return 0
  }
  check "API direct health" "http://127.0.0.1:$API_PORT/api/health"
  check "nginx /healthz"    "http://127.0.0.1:$NGINX_PORT/healthz"
  check "nginx -> /api/health" "http://127.0.0.1:$NGINX_PORT/api/health"
  local spa i
  spa=""
  for i in $(seq 1 30); do
    spa="$(curl -fsS -m 5 "http://127.0.0.1:$NGINX_PORT/" 2>/dev/null || true)"
    case "$spa" in *"<html"*|*"<!doctype"*) break;; esac
    sleep 1
  done
  case "$spa" in *"<html"*|*"<!doctype"*) log "OK   nginx serves SPA index.html";; *) log "FAIL nginx SPA index"; fail=1;; esac
  return "$fail"
}

cmd_up() {
  require_build
  log "1/6 dev compose (pnpm db:up; idempotent)"
  pnpm -C "$WORKTREE" db:up >/dev/null
  if api_running; then
    log "API already running — skipping db rebuild (use '$0 reset' for full rebuild)"
  else
    log "2/6 rebuilding research database (name-guarded $RUN_DB)"
    seed_ts --phase=db
    log "3/6 starting API"
    start_api
    log "4/6 seeding synthetic fixtures"
    seed_ts --phase=data
  fi
  log "5/6 nginx ingress"
  start_nginx
  log "6/6 health checks"
  health_checks || die "health checks failed"
  log "UP: appUrl=$API_PUBLIC_ORIGIN (nginx ingress; API direct http://127.0.0.1:$API_PORT)"
}

cmd_down() {
  stop_nginx
  stop_api
  # dev compose（PG/Redis）与 research 库保留：PG 属 pnpm db:up 生命周期，
  # 库重建归 seed --phase=db（下次 up 时执行）。
  log "DOWN: nginx + API stopped (dev compose PG/Redis and $RUN_DB left in place)"
}

cmd_reset() {
  cmd_down
  cmd_up
}

# 仅重启 API（不重建库）：用于改 API env（如 TRUSTED_PROXY_CIDRS）而保持
# 当前播种世代（manifest/考生池）不变。JWT secret 随机轮换（R3 语义）。
cmd_api_restart() {
  stop_api
  start_api
  curl -fsS -o /dev/null "http://127.0.0.1:$API_PORT/api/health" \
    || die "api-restart: health check failed"
  log "API-RESTART ok (TRUSTED_PROXY_CIDRS=$TRUSTED_PROXY_CIDRS_VALUE)"
}

cmd_status() {
  echo "== dev compose (pnpm db:up owner) =="
  docker ps --filter "name=exam-dev-" --format '{{.Names}}\t{{.Status}}\t{{.Ports}}'
  echo "== research DB =="
  docker exec exam-dev-db-1 psql -U exam -d postgres -tAc \
    "SELECT datname FROM pg_database WHERE datname = '$RUN_DB'" | sed 's/^/  db: /'
  docker exec exam-dev-db-1 psql -U exam -d "$RUN_DB" -tAc \
    "SELECT (SELECT count(*) FROM users)||' users, '||(SELECT count(*) FROM exams)||' exams, '||(SELECT count(*) FROM questions)||' questions'" 2>/dev/null \
    | sed 's/^/  content: /' || echo "  content: (not migrated / empty)"
  echo "== API =="
  if api_running; then
    echo "  running (pid $(cat "$API_PID_FILE")): $(curl -fsS "http://127.0.0.1:$API_PORT/api/health" 2>/dev/null || echo 'health FAILED')"
  else
    echo "  stopped"
  fi
  echo "== nginx =="
  if docker inspect "$NGINX_CONTAINER" >/dev/null 2>&1; then
    echo "  running: $(docker ps --filter "name=$NGINX_CONTAINER" --format '{{.Status}}')"
    echo "  ingress: http://127.0.0.1:$NGINX_PORT"
  else
    echo "  stopped"
  fi
}

case "${1:-}" in
  up) cmd_up ;;
  down) cmd_down ;;
  reset) cmd_reset ;;
  api-restart) cmd_api_restart ;;
  status) cmd_status ;;
  *) echo "usage: $0 up|down|reset|api-restart|status" >&2; exit 2 ;;
esac
