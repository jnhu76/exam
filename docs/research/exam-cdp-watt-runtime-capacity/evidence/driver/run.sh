#!/usr/bin/env bash
# G1.2/G1.4 driver 一键运行包装（RESEARCH ONLY，宿主机侧，cwd 任意）。
#
# 职责：
#   1. 前置检查：topology 健康、driver 容器在位；
#   2. 从 seed-manifest 选一段“新鲜”考生切片（查 DB 排除已有 attempt 的考生
#      —— maxAttempts=1，已用考生无法再次开考）；
#   3. 生成 run 输入（candidates.json，不含任何凭据）；
#   4. 在 driver 容器内执行 driver.mjs（凭据经 docker exec -e 注入，不落盘）；
#   5. 截取本 run 窗口的 nginx access log 与 API 请求日志供双侧核对。
#
# 用法（示例见 README）：
#   run.sh --run-id=<id> --scenario=full --topology=direct --n=24 \
#          --profile=p2 --window-ms=120000 [--from=2] [--seed=S] [--schedule=<file>]
# 其余参数原样透传 driver.mjs。
set -euo pipefail

DRIVER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESEARCH="$(cd "$DRIVER_DIR/../.." && pwd)"
HARNESS="$RESEARCH/harness"
MANIFEST="$RESEARCH/evidence/fixtures/seed-manifest.json"
RUN_DB="exam_550_e2e"
CONTAINER="exam-cap-driver"

log() { printf '[run] %s\n' "$*"; }
die() { printf '[run] FATAL: %s\n' "$*" >&2; exit 1; }

# 前置 1：nginx 与 API 活着
curl -fsS -o /dev/null http://127.0.0.1:8080/api/health || die "nginx ingress unhealthy (topology.sh up)"
curl -fsS -o /dev/null http://127.0.0.1:3300/api/health || die "API direct unhealthy"

# 前置 2：driver 容器在位
docker inspect "$CONTAINER" >/dev/null 2>&1 || die "driver container missing (sources.sh up)"

# 参数解析（本脚本关心的几个，其余透传）
PASS=()
RUN_ID="" FROM=2 N=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --run-id=*) RUN_ID="${1#--run-id=}" ;;
    --from=*) FROM="${1#--from=}" ;;
    --n=*) N="${1#--n=}" ;;
    *) PASS+=("$1") ;;
  esac
  shift
done
[[ -n "$RUN_ID" ]] || die "--run-id=<id> required"
SCENARIO="$(printf '%s\n' "${PASS[@]}" | grep -o '^--scenario=.*' | head -1 | cut -d= -f2 || true)"
SCENARIO="${SCENARIO:-full}"
[[ -n "$N" ]] || { printf '%s\n' "${PASS[@]}" | grep -q '^--n=' || die "--n=<int> required"; N="$(printf '%s\n' "${PASS[@]}" | grep -o '^--n=.*' | head -1 | cut -d= -f2)"; }

OUT_DIR="$DRIVER_DIR/runs/$RUN_ID"
mkdir -p "$OUT_DIR"

# 前置 3：新鲜考生切片（跳过已消耗考生；emit-cal 无需考生）
if [[ "$SCENARIO" != "emit-cal" ]]; then
  python3 - "$MANIFEST" "$FROM" "$N" "$RUN_DB" "$OUT_DIR" <<'PYEOF'
import json, subprocess, sys
manifest, frm, n, db, out = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4], sys.argv[5]
m = json.load(open(manifest))
users = m["sameField"]["candidates"]
ids = m["sameField"]["candidateIds"]
# DB 查询已有 attempt 的考生（已消耗；AGENTS §6：只读查询，名称守卫库）
q = """
SELECT u.username FROM exam_attempts a
JOIN candidate_profiles cp ON cp.id = a.candidate_id
JOIN users u ON u.id = cp.user_id
WHERE u.username LIKE 'cap9same-%';
"""
r = subprocess.run(["docker", "exec", "exam-dev-db-1", "psql", "-U", "exam", "-d", db, "-tAc", q],
                   capture_output=True, text=True, check=True)
consumed = set(x.strip() for x in r.stdout.splitlines() if x.strip())
picked, skipped = [], []
i = frm
while len(picked) < n and i < len(users):
    u = users[i]
    (skipped if u in consumed else picked).append((u, ids[i]))
    i += 1
if len(picked) < n:
    sys.exit(f"FATAL: only {len(picked)} fresh candidates available (from={frm}); reset topology or lower --n")
payload = {"examId": m["sameField"]["examId"],
           "candidates": [u for u, _ in picked],
           "candidateIds": [cid for _, cid in picked]}
open(f"{out}/candidates.json", "w").write(json.dumps(payload, indent=1) + "\n")
print(f"[run] candidate slice: {len(picked)} fresh (skipped {len(skipped)} consumed, scanned from index {frm}); "
      f"first={payload['candidates'][0]} last={payload['candidates'][-1]}")
PYEOF
fi

# 注入考生文件参数（容器内路径）+ 透传 n（run.sh 仅借读，不吞参数）
if [[ "$SCENARIO" != "emit-cal" ]]; then
  PASS+=("--candidates=/evidence/driver/runs/$RUN_ID/candidates.json")
fi
PASS+=("--n=$N")

# 执行（容器内；密码经 env 注入，不落任何文件）
# CANDIDATE_PASSWORD 未在环境提供时，从研究 harness config 常量提取（合成考生
# 共享密码本就是 config.ts 中的仓库事实；此处仅转传递，不写入任何输出）。
if [[ -z "${CANDIDATE_PASSWORD:-}" ]]; then
  CANDIDATE_PASSWORD="$(sed -n 's/.*CANDIDATE_PASSWORD = "\([^"]*\)".*/\1/p' "$HARNESS/lib/config.ts" | head -1)"
fi
[[ -n "$CANDIDATE_PASSWORD" ]] || die "CANDIDATE_PASSWORD not resolvable"
LOG_T0="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
log "launching driver in container (args: ${PASS[*]:-none})"
docker exec -e CANDIDATE_PASSWORD="$CANDIDATE_PASSWORD" "$CONTAINER" \
  node /evidence/driver/driver.mjs --run-id="$RUN_ID" "${PASS[@]}" \
  2>&1 | tee "$OUT_DIR/driver-stdout.log"
LOG_T1="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# 采样热路径写容器本地盘（Docker Desktop 文件共享挂载上逐条 append 会阻塞
# 事件循环）；结束后一次性取回归档目录（candidates.json 等输入一并保留）。
docker cp "$CONTAINER:/tmp/run/$RUN_ID/." "$OUT_DIR/" >/dev/null
docker exec "$CONTAINER" rm -rf "/tmp/run/$RUN_ID"
[[ -f "$OUT_DIR/driver.json" ]] || die "driver artifacts not found after docker cp"

# nginx 窗口日志（双侧核对之 nginx 侧：$remote_addr）
timeout 30 docker logs --since "$LOG_T0" --until "$LOG_T1" exam-cap-nginx > "$OUT_DIR/nginx-access.log" 2>&1 || true
log "artifacts in $OUT_DIR (schedule/samples/driver-metrics/driver.json + nginx-access.log)"
