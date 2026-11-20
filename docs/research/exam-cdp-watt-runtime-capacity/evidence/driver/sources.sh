#!/usr/bin/env bash
# G1.3 来源拓扑建立（RESEARCH ONLY）：driver 容器 + 每考生独立辅助源 IP。
#
# 为什么需要 driver 容器：本环境是 Docker Desktop（host.docker.internal=
# 192.168.65.254，vpnkit）。经 published port 127.0.0.1:8080 进来的连接在 nginx
# 侧 $remote_addr 一律坍缩为 172.28.10.1（vpnkit SNAT，实测 nginx access log），
# 127/8 的 localAddress 绑定无法穿透 —— #550 的 DIRECT_LAN loopback 手法在
# “必须经实际 nginx 容器”的拓扑里不可用。解法：把 driver 放进 exam-cap-net
# 的受控网络命名空间（容器），eth0 加 N 个辅助 IP，每考生 socket 绑定独一源
# —— 真实内核 socket 对端，非伪造头（nginx 以 $remote_addr 覆盖 XFF）。
#
# 子命令：
#   up [--sources N]   建 exam-cap-driver 容器（--cap-add NET_ADMIN）+ N 个辅助 IP
#   down               删容器（辅助 IP 随之消失，无宿主残留）
#   status             容器与 IP 状态
#
# IP 规划（exam-cap-net 172.28.10.0/24）：.1 网关(VM)、.2 nginx、.3 driver 主 IP、
# .10.. 辅助源 IP（每考生一个；N≤200 时不超过 .209）。
set -euo pipefail

DRIVER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EVIDENCE_DIR="$(cd "$DRIVER_DIR/.." && pwd)"   # 挂载 evidence 整体（driver 需读 ../g1-traces）
NET_NAME="exam-cap-net"
CONTAINER="exam-cap-driver"
IMAGE="node:24.22.3-bookworm-slim"   # 本地已缓存（与冻结构建同系）
HELPER_IMAGE="alpine:3"              # busybox ip 辅助（共享 netns 加 IP，无需进 node 镜像）
MAIN_IP="172.28.10.3"
SOURCE_BASE_NUM=10

log() { printf '[sources] %s\n' "$*"; }
die() { printf '[sources] FATAL: %s\n' "$*" >&2; exit 1; }

cmd_up() {
  local n=200
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --sources) n="$2"; shift 2 ;;
      *) die "unknown arg: $1" ;;
    esac
  done
  [[ "$n" -ge 1 && "$n" -le 200 ]] || die "--sources must be 1..200 (IP 预算 172.28.10.10+.${n} ≤ .209 内)"
  if docker inspect "$CONTAINER" >/dev/null 2>&1; then
    log "container $CONTAINER already exists (down first to rebuild)"
  else
    docker network inspect "$NET_NAME" >/dev/null 2>&1 \
      || die "network $NET_NAME missing — run topology.sh up first"
    log "starting $CONTAINER ($IMAGE, net=$NET_NAME ip=$MAIN_IP, NET_ADMIN)"
    docker run -d --name "$CONTAINER" \
      --network "$NET_NAME" --ip "$MAIN_IP" \
      --cap-add NET_ADMIN \
      --user "$(id -u):$(id -g)" \
      -v "$EVIDENCE_DIR:/evidence" \
      "$IMAGE" sleep infinity >/dev/null
  fi
  local i ip added=0
  for i in $(seq 0 $((n - 1))); do
    ip="172.28.10.$((SOURCE_BASE_NUM + i))"
    # 幂等：已存在则 ip addr add 会失败，忽略之
    if docker run --rm --net "container:$CONTAINER" --cap-add NET_ADMIN "$HELPER_IMAGE" \
      ip addr add "$ip/24" dev eth0 2>/dev/null; then
      added=$((added + 1))
    fi
  done
  log "secondary source IPs added this call: $added (total target $n)"
  cmd_status
}

cmd_down() {
  if docker inspect "$CONTAINER" >/dev/null 2>&1; then
    docker rm -f "$CONTAINER" >/dev/null
    log "removed $CONTAINER (secondary IPs vanish with the netns — no host residue)"
  else
    log "$CONTAINER not present"
  fi
}

cmd_status() {
  if docker inspect "$CONTAINER" >/dev/null 2>&1; then
    echo "== $CONTAINER =="
    docker ps -a --filter "name=$CONTAINER" --format '  {{.Status}}  {{.Image}}'
    local cnt
    cnt="$(docker run --rm --net "container:$CONTAINER" "$HELPER_IMAGE" ip -4 addr show dev eth0 2>/dev/null | grep -c 'inet ' || true)"
    echo "  ipv4 addresses on eth0: $cnt (1 primary + $((cnt - 1)) secondary sources)"
  else
    echo "== $CONTAINER: not present =="
  fi
}

case "${1:-}" in
  up) shift; cmd_up "$@" ;;
  down) cmd_down ;;
  status) cmd_status ;;
  *) echo "usage: $0 up [--sources N]|down|status" >&2; exit 2 ;;
esac
