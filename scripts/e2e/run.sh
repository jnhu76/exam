#!/usr/bin/env bash

# scripts/e2e/run.sh
#
# 通过 docker compose 一键执行 E2E：
#
#   构建镜像 → 启动 db / app（带 RUN_SEED=1 自动 seed）→ 健康检查 →
#   通过 e2e profile 容器跑 Playwright → 收集退出码 → 清理。
#
# 严格按照 docker-compose.test.yml 编排：app 镜像内置 docker-entrypoint.sh，
# 已经在容器启动时执行 migrate + seed.js。本脚本不再在宿主机上尝试 seed。
#
# 用法：
#   bash scripts/e2e/run.sh                       # 跑 e2e/ 下所有 spec（全跑）
#   bash scripts/e2e/run.sh candidate-happy-path  # 关键字匹配 spec 文件
#   bash scripts/e2e/run.sh resume submit-flush   # 多个关键字（OR 关系）
#   bash scripts/e2e/run.sh --grep "happy path"   # Playwright 标题正则过滤
#   bash scripts/e2e/run.sh --no-build            # 跳过构建（复用上次镜像）
#   bash scripts/e2e/run.sh --keep                # 跑完保留容器（不清理）
#   bash scripts/e2e/run.sh --rebuild --headed    # 强制 --no-cache 重建（不支持 headed，仅作示例）
#
# 环境变量：
#   APP_PORT             宿主机暴露给 app 的端口，默认 3000
#   JWT_SECRET           覆盖默认 change-me-in-development
#   E2E_PROXY            E2E 容器内 npm install 时的 HTTP(S) 代理
#   COMPOSE_PROJECT_NAME 隔离多个并发运行，默认 exam-e2e
#   KEEP_STACK=1         等价于 --keep
#
# 退出码：直接透传 e2e 容器（playwright）退出码。

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

# COMPOSE_FILE may be overridden by the caller (colon-separated, compose v2
# syntax) to layer an override file — e.g. to remap host ports when :3000 or
# :5432 are already in use:
#   COMPOSE_FILE=docker-compose.test.yml:docker-compose.test.override.yml \
#     bash scripts/e2e/run.sh
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.test.yml}"
PROJECT_NAME="${COMPOSE_PROJECT_NAME:-exam-e2e}"

DO_BUILD=1
BUILD_NO_CACHE=0
KEEP_STACK="${KEEP_STACK:-0}"
GREP_PATTERN=""
SPEC_KEYS=()
EXTRA_PW_ARGS=()

usage() {
  sed -n '3,30p' "$0"
}

# ----- 参数解析 -----
while (( "$#" )); do
  case "$1" in
    -h|--help)
      usage; exit 0 ;;
    --no-build)
      DO_BUILD=0; shift ;;
    --rebuild)
      DO_BUILD=1; BUILD_NO_CACHE=1; shift ;;
    --keep)
      KEEP_STACK=1; shift ;;
    --grep)
      [[ $# -ge 2 ]] || { echo "ERROR: --grep needs a value" >&2; exit 2; }
      GREP_PATTERN="$2"; shift 2 ;;
    --)
      shift
      while (( "$#" )); do EXTRA_PW_ARGS+=("$1"); shift; done ;;
    -*)
      EXTRA_PW_ARGS+=("$1"); shift ;;
    *)
      SPEC_KEYS+=("$1"); shift ;;
  esac
done

compose() {
  # Support colon-separated COMPOSE_FILE (e.g. base:override) by emitting
  # one -f flag per path, matching `docker compose` multi-file semantics.
  local -a files=()
  local IFS=':'
  read -r -a files <<< "$COMPOSE_FILE"
  local -a fflags=()
  for f in "${files[@]}"; do fflags+=("-f" "$f"); done
  docker compose "${fflags[@]}" -p "$PROJECT_NAME" "$@"
}

log()  { printf '\033[1;36m[e2e]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[e2e]\033[0m %s\n' "$*" >&2; }
err()  { printf '\033[1;31m[e2e]\033[0m %s\n' "$*" >&2; }

# ----- 清理 -----
cleanup() {
  local code=$?
  if [[ "$KEEP_STACK" == "1" ]]; then
    warn "KEEP_STACK=1，保留 stack。手动清理：docker compose -f $COMPOSE_FILE -p $PROJECT_NAME down -v"
    return $code
  fi
  log "清理 stack（含数据卷）..."
  compose down -v --remove-orphans >/dev/null 2>&1 || true
  return $code
}
trap cleanup EXIT
trap 'err "中断"; exit 130' INT TERM

# ----- 0. 预检 -----
if ! command -v docker >/dev/null 2>&1; then
  err "未找到 docker，请先安装 Docker"; exit 127
fi
if ! docker compose version >/dev/null 2>&1; then
  err "未找到 docker compose（v2 plugin）"; exit 127
fi

# ----- 0.5. 宿主机端口占用检测 -----
#
# docker-compose.test.yml 把 app:3000 / db:5432 直接映射到宿主机同名端口。
# 如果宿主机上已经有别的进程在监听这两个端口（常见情况：本地 `pnpm dev`、
# 残留的 `pnpm --filter @exam/api start`、或 docker-compose.dev.yml 的 db），
# `docker compose up` 不会自动迁走它们：
#   - 端口冲突时 compose 会报 bind 失败；
#   - 但若宿主机上的旧进程刚好响应 health 探测，预检/Playwright 可能会无声地
#     打到”假 app”，看到 rate-limit headers / 401 / 500 等无关行为。
# 在 compose up 之前显式失败，能把”环境污染”变成可识别错误，而不是污染 E2E。
#
# 端口覆盖方式（需要配合 docker-compose.test.override.yml）：
#   APP_PORT=3300 DB_HOST_PORT=5433 \
#     COMPOSE_FILE=docker-compose.test.yml:docker-compose.test.override.yml \
#     bash scripts/e2e/run.sh
APP_HOST_PORT="${APP_PORT:-3000}"
DB_HOST_PORT="${DB_HOST_PORT:-5432}"

port_owner() {
  local port="$1"
  # ss 优先，回退到 lsof，最后回退到无信息
  if command -v ss >/dev/null 2>&1; then
    ss -ltnp 2>/dev/null | awk -v p=":${port}\$" '$4 ~ p { print $0 }'
  elif command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"$port" -sTCP:LISTEN -nP 2>/dev/null | tail -n +2
  fi
}

ensure_host_port_free() {
  local port="$1" label="$2"
  local owner
  owner="$(port_owner "$port" || true)"
  if [[ -z "$owner" ]]; then
    return 0
  fi
  # compose 项目里自身的容器占用是 OK 的（重复运行同一个 stack）。
  # 检查是不是已经有同 project_name 的 app 容器在用：如果是，让 compose up 处理。
  local cid
  cid="$(compose ps -q app 2>/dev/null || true)"
  if [[ -n "$cid" ]]; then
    return 0
  fi
  err "宿主机 :${port} (${label}) 已被占用，本脚本不会接管它："
  while IFS= read -r line; do err "  $line"; done <<< "$owner"
  err ""
  err "可能原因："
  err "  - 本地 'pnpm dev' / 'pnpm --filter @exam/api start' 还在跑"
  err "  - docker-compose.dev.yml 的 stack 没停"
  err "  - 其他服务占用了同名端口"
  err "处理建议（任选其一）："
  err "  1) 停掉占用进程：lsof -iTCP:${port} -sTCP:LISTEN | tail -n +2"
  err "  2) 停 dev compose：docker compose -f docker-compose.dev.yml down -v"
  err "  3) 改用其他端口：APP_PORT=3001 bash scripts/e2e/run.sh"
  return 1
}

if ! ensure_host_port_free "$APP_HOST_PORT" "app"; then
  exit 1
fi
if ! ensure_host_port_free "$DB_HOST_PORT" "db"; then
  exit 1
fi

# ----- 1. 构建 app 镜像 -----
if [[ "$DO_BUILD" == "1" ]]; then
  if [[ "$BUILD_NO_CACHE" == "1" ]]; then
    log "构建 app 镜像（--no-cache）..."
    compose build --no-cache app
  else
    log "构建 app 镜像..."
    compose build app
  fi
else
  log "跳过构建（--no-build）"
fi

# ----- 2. 启动 db + app（app 内置 entrypoint：migrate + RUN_SEED=1 → seed） -----
log "启动 db 与 app..."
compose up -d db app

# ----- 3. 等待 app health -----
log "等待 app 健康..."
APP_CID="$(compose ps -q app)"
if [[ -z "$APP_CID" ]]; then
  err "未找到 app 容器"; exit 1
fi

# 健康检查 start_period=30s + 3 retries × 30s ≈ 最长 ~120s。给 180s 余量。
DEADLINE=$((SECONDS + 180))
last_status=""
while (( SECONDS < DEADLINE )); do
  status="$(docker inspect -f '{{.State.Health.Status}}' "$APP_CID" 2>/dev/null || echo "unknown")"
  if [[ "$status" != "$last_status" ]]; then
    log "  app 状态: $status"
    last_status="$status"
  fi
  case "$status" in
    healthy) break ;;
    unhealthy)
      err "app 进入 unhealthy"
      compose logs --tail=200 app || true
      exit 1
      ;;
  esac
  sleep 2
done
if [[ "$last_status" != "healthy" ]]; then
  err "app 在 180s 内未变 healthy（last=$last_status）"
  compose logs --tail=200 app || true
  exit 1
fi
log "app healthy ✓ (entrypoint 已执行 migrate + seed)"

# ----- 3.5. 预检：confirm canonical E2E seed + no rate-limit drift -----
#
# 预检走 docker 内网 (http://127.0.0.1:3000 inside the app container) —
# 与 Playwright 容器的 http://app:3000 走同一条 Fastify 入口、同一份 server，
# 不依赖宿主机端口映射，避免“主机网络 500 / 内网 200”这种歧义。
preflight() {
  log "预检 1/3: GET /api/health (in-network via app container)"
  if ! compose exec -T app node -e '
    fetch("http://127.0.0.1:3000/api/health")
      .then(r => { if (!r.ok) { console.error("status="+r.status); process.exit(1); } })
      .catch(e => { console.error(e.message); process.exit(1); });
  ' >/dev/null 2>&1; then
    err "预检失败: /api/health unreachable inside app container"
    return 1
  fi

  log "预检 2/3: 候选账号登录 (admin + candidate1..4，无 429)"
  if ! compose exec -T \
      -e PREFLIGHT_USERS='admin:admin123,candidate1:candidate123,candidate2:candidate123,candidate3:candidate123,candidate4:candidate123' \
      app node -e '
    const users = process.env.PREFLIGHT_USERS.split(",").map(p => p.split(":"));
    (async () => {
      for (const [username, password] of users) {
        const r = await fetch("http://127.0.0.1:3000/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, password }),
        });
        if (r.status === 200) continue;
        const body = await r.text();
        if (r.status === 401) {
          console.error("[e2e] demo seed missing: " + username + " returned 401");
        } else if (r.status === 429) {
          console.error("[e2e] rate limit active in APP_MODE=e2e: " + username + " returned 429");
        } else {
          console.error("[e2e] preflight: " + username + " returned unexpected status=" + r.status);
        }
        console.error(body);
        process.exit(1);
      }
    })().catch(e => { console.error(e.stack || e.message); process.exit(1); });
  '; then
    return 1
  fi

  log "预检 3/3: 重复 admin 登录 5 次 (确保 rate-limit 已禁用)"
  if ! compose exec -T app node -e '
    (async () => {
      for (let i = 1; i <= 5; i++) {
        const r = await fetch("http://127.0.0.1:3000/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: "admin", password: "admin123" }),
        });
        if (r.status === 429) {
          console.error("[e2e] rate limit active in APP_MODE=e2e: admin returned 429 on attempt " + i);
          process.exit(1);
        }
        if (r.status !== 200) {
          console.error("[e2e] preflight: repeated admin login returned " + r.status + " on attempt " + i);
          process.exit(1);
        }
      }
    })().catch(e => { console.error(e.stack || e.message); process.exit(1); });
  '; then
    return 1
  fi

  log "预检通过 ✓ (canonical E2E seed + 无速率限制)"
  return 0
}

if ! preflight; then
  err "E2E preflight 失败 — 不会启动 Playwright"
  warn "app 最近日志："
  compose logs --tail=200 app || true
  exit 1
fi

# ----- 4. 组装 playwright 参数 -----
PW_ARGS=(npx playwright test --reporter=list)

# spec 关键字 → 解析为 e2e/<file>
if (( ${#SPEC_KEYS[@]} > 0 )); then
  log "spec 选择: ${SPEC_KEYS[*]}"
  shopt -s nullglob
  matched=()
  for key in "${SPEC_KEYS[@]}"; do
    found=0
    for f in apps/e2e/e2e/*.spec.ts; do
      base="$(basename "$f")"
      if [[ "$base" == "$key" || "$base" == "$key.spec.ts" || "$base" == *"$key"* ]]; then
        matched+=("e2e/$base"); found=1
      fi
    done
    if (( found == 0 )); then
      err "spec 关键字未匹配: $key"
      err "可选 spec："
      for f in apps/e2e/e2e/*.spec.ts; do err "  - $(basename "$f")"; done
      exit 2
    fi
  done
  # 去重
  IFS=$'\n' matched=($(printf '%s\n' "${matched[@]}" | awk '!seen[$0]++'))
  unset IFS
  PW_ARGS+=("${matched[@]}")
else
  log "spec 选择: 全跑（apps/e2e/e2e/*.spec.ts）"
fi

if [[ -n "$GREP_PATTERN" ]]; then
  PW_ARGS+=(--grep "$GREP_PATTERN")
fi

if (( ${#EXTRA_PW_ARGS[@]} > 0 )); then
  PW_ARGS+=("${EXTRA_PW_ARGS[@]}")
fi

# ----- 5. 跑 e2e 容器 -----
log "执行 Playwright: ${PW_ARGS[*]}"
set +e
compose run --rm \
  -e E2E_BASE_URL="http://app:3000" \
  -e CI="${CI:-1}" \
  e2e sh -lc '
    set -e
    npm install --no-save --no-package-lock @playwright/test@1.57.0 >/dev/null 2>&1
    "$@"
  ' _ "${PW_ARGS[@]}"
EXIT_CODE=$?
set -e

if [[ $EXIT_CODE -eq 0 ]]; then
  log "E2E 通过 ✓"
else
  err "E2E 失败 (exit=$EXIT_CODE)"
  warn "app 最近日志："
  compose logs --tail=200 app || true
fi

exit $EXIT_CODE
