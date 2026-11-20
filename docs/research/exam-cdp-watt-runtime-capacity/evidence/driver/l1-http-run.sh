#!/usr/bin/env bash
# L1-VERIFY 完整 HTTP login run 编排（RESEARCH ONLY；cwd 任意，路径绝对）。
#
# 每 run 一条链（协议 §11 R0/R1/R3——默认 --reset=1 全链重置，每 run 之间
# 完整重置；研究库 exam_550_e2e name-guard 由 topology.sh/seed 履行）：
#   1. topology.sh reset：loud DROP/CREATE→migrate→canonical seed→fresh API
#      （fresh JWT secret）→ 播种 400 合成考生 → nginx → health；
#   2. 从 fresh seed-manifest 取同场组前 N 名考生 → candidates.json（无凭据）；
#   3. 背景启动 l1-api-sampler.ts（API 进程 /proc + /api/research/capacity）；
#   4. driver 容器内闭环 login driver（C 并发 × N 登录，经真实 nginx，
#      每考生独一源 IP；密码经 docker exec -e 注入不落盘）；
#   5. 停采样器（SIGTERM→api-summary.json）；docker cp 归档；
#   6. DB durable oracle（fresh 库即本 run 全量）：login.success 计数/独立
#      考生/失败分类 + nginx 窗口日志；
#   7. run-meta.json + cmd.sh（cwd=/home/hoo/Source/exam 原样可复跑）。
#
# 用法：
#   l1-http-run.sh --run-id=L1-VERIFY-http-c8-r1 --concurrency=8 --n=200 [--reset=0]
set -euo pipefail

DRIVER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESEARCH="$(cd "$DRIVER_DIR/../.." && pwd)"
HARNESS="$RESEARCH/harness"
EVIDENCE="$RESEARCH/evidence"
MANIFEST="$EVIDENCE/fixtures/seed-manifest.json"
WORKTREE="$(cd "$RESEARCH/../../.." && pwd)"
TOPOLOGY="$HARNESS/topology.sh"
L1_ROOT="$EVIDENCE/L1-VERIFY"
CONTAINER="exam-cap-driver"
RUN_DB="exam_550_e2e"

log() { printf '[l1-http] %s\n' "$*"; }
die() { printf '[l1-http] FATAL: %s\n' "$*" >&2; exit 1; }

RUN_ID="" CONCURRENCY="" N="" RESET=1
while [[ $# -gt 0 ]]; do
  case "$1" in
    --run-id=*) RUN_ID="${1#--run-id=}" ;;
    --concurrency=*) CONCURRENCY="${1#--concurrency=}" ;;
    --n=*) N="${1#--n=}" ;;
    --reset=*) RESET="${1#--reset=}" ;;
    *) die "unknown arg: $1" ;;
  esac
  shift
done
[[ -n "$RUN_ID" && -n "$CONCURRENCY" && -n "$N" ]] || die "--run-id/--concurrency/--n required"
[[ "$RESET" == "0" || "$RESET" == "1" ]] || die "--reset must be 0|1"

OUT_DIR="$L1_ROOT/$RUN_ID"
mkdir -p "$OUT_DIR"

if [[ "$RESET" == "1" ]]; then
  log "1/7 full R1 reset (topology.sh reset: DB rebuild + seed + fresh API/nginx)"
  bash "$TOPOLOGY" reset >>"$OUT_DIR/topology-reset.log" 2>&1 || { tail -20 "$OUT_DIR/topology-reset.log" >&2; die "topology reset failed"; }
  log "   reset ok ($(tail -1 "$OUT_DIR/topology-reset.log"))"
else
  curl -fsS -o /dev/null http://127.0.0.1:8080/api/health || die "nginx ingress unhealthy (use --reset=1)"
  curl -fsS -o /dev/null http://127.0.0.1:3300/api/health || die "API direct unhealthy (use --reset=1)"
fi

# driver 容器与源 IP 池在位检查（reset 不动 driver 容器；缺则补建）
docker inspect "$CONTAINER" >/dev/null 2>&1 || die "driver container missing (sources.sh up)"
IP_CNT="$(docker run --rm --net "container:$CONTAINER" alpine:3 ip -4 addr show dev eth0 2>/dev/null | grep -c 'inet ' || true)"
[[ "$IP_CNT" -ge $((N + 1)) ]] || die "source IP pool too small: $IP_CNT < $((N + 1)) (sources.sh up --sources $N)"

API_PID="$(cat "$HARNESS/logs/api.pid")"
log "2/7 API pid=$API_PID; env mode probe (pre) — 固定负载 argon2 C=1（机制刻画，非测量）"
ENV_PROBE_PRE="$(pnpm -C "$WORKTREE" --filter @exam/db exec tsx "$HARNESS/l1-verify.ts" \
  --run-id="${RUN_ID}-envprobe-pre" --concurrency=1 --n=60 2>/dev/null | tail -1)"
PROBE_THR_PRE="$(printf '%s' "$ENV_PROBE_PRE" | sed -n 's/.*thr=\([0-9.]*\)\/s.*/\1/p')"
log "   env probe pre: thr=${PROBE_THR_PRE:-parse-fail}/s (fast-mode 基线≈23.5-24.4/s)"

log "2b/7 candidates slice (first $N same-field)"

python3 - "$MANIFEST" "$N" "$OUT_DIR/candidates.json" <<'PYEOF'
import json, sys
manifest, n, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]
m = json.load(open(manifest))
users = m["sameField"]["candidates"][:n]
ids = m["sameField"]["candidateIds"][:n]
assert len(users) == n, f"manifest has only {len(users)} same-field candidates"
json.dump({"examId": m["sameField"]["examId"], "candidates": users, "candidateIds": ids}, open(out, "w"), indent=1)
PYEOF

log "3/7 starting API sampler (background; stop via sentinel file)"
READY_FILE="$OUT_DIR/.sampler-ready"
STOP_FILE="$OUT_DIR/.sampler-stop"
rm -f "$READY_FILE" "$STOP_FILE" "$OUT_DIR/api-sampler.jsonl" "$OUT_DIR/api-summary.json" "$OUT_DIR/api-research-snapshots.jsonl"
nohup pnpm -C "$WORKTREE" --filter @exam/db exec tsx "$HARNESS/l1-api-sampler.ts" \
    --pid="$API_PID" --out-dir="$OUT_DIR" --ready-file="$READY_FILE" --stop-file="$STOP_FILE" \
    --interval-ms=250 --snapshot-every=4 --max-seconds=600 \
    >>"$OUT_DIR/sampler.log" 2>&1 < /dev/null &
SAMPLER_SHELL_PID=$!
disown
for _ in $(seq 1 60); do [[ -f "$READY_FILE" ]] && break; sleep 0.5; done
[[ -f "$READY_FILE" ]] || { die "sampler not ready in 30s (see $OUT_DIR/sampler.log)"; }

if [[ -z "${CANDIDATE_PASSWORD:-}" ]]; then
  CANDIDATE_PASSWORD="$(sed -n 's/.*CANDIDATE_PASSWORD = "\([^"]*\)".*/\1/p' "$HARNESS/lib/config.ts" | head -1)"
fi
[[ -n "$CANDIDATE_PASSWORD" ]] || die "CANDIDATE_PASSWORD not resolvable"

LOG_T0="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
log "4/7 closed-loop login driver: C=$CONCURRENCY N=$N (via nginx, per-candidate source IPs)"
DRIVER_RC=0
docker exec -e CANDIDATE_PASSWORD="$CANDIDATE_PASSWORD" "$CONTAINER" \
  node /evidence/driver/l1-login.mjs \
    --run-id="$RUN_ID" --concurrency="$CONCURRENCY" --n="$N" \
    --candidates="/evidence/L1-VERIFY/$RUN_ID/candidates.json" \
    2>&1 | tee "$OUT_DIR/driver-stdout.log" || DRIVER_RC=$?
LOG_T1="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

log "5/7 stop sampler + archive driver artifacts"
touch "$STOP_FILE"
for _ in $(seq 1 40); do [[ -f "$OUT_DIR/api-summary.json" ]] && break; sleep 0.5; done
[[ -f "$OUT_DIR/api-summary.json" ]] || log "WARN: api-summary.json missing (sampler.log)"

ENV_PROBE_POST="$(pnpm -C "$WORKTREE" --filter @exam/db exec tsx "$HARNESS/l1-verify.ts" \
  --run-id="${RUN_ID}-envprobe-post" --concurrency=1 --n=60 2>/dev/null | tail -1)"
PROBE_THR_POST="$(printf '%s' "$ENV_PROBE_POST" | sed -n 's/.*thr=\([0-9.]*\)\/s.*/\1/p')"
log "   env probe post: thr=${PROBE_THR_POST:-parse-fail}/s"

docker cp "$CONTAINER:/tmp/run/$RUN_ID/." "$OUT_DIR/" >/dev/null
docker exec "$CONTAINER" rm -rf "/tmp/run/$RUN_ID"
[[ -f "$OUT_DIR/driver.json" ]] || die "driver artifacts not found after docker cp"

log "6/7 DB durable oracle (fresh DB ⇒ counts are this run's)"
docker exec exam-dev-db-1 psql -U exam -d "$RUN_DB" -tAc "
  SELECT json_build_object(
    'loginSuccessAll', (SELECT count(*) FROM audit_logs WHERE action='login.success'),
    'loginSuccessCandidates', (SELECT count(*) FROM audit_logs a JOIN users u ON u.id=a.actor_id WHERE a.action='login.success' AND u.username LIKE 'cap9same-%'),
    'loginSuccessDistinctCandidates', (SELECT count(DISTINCT a.actor_id) FROM audit_logs a JOIN users u ON u.id=a.actor_id WHERE a.action='login.success' AND u.username LIKE 'cap9same-%'),
    'loginSuccessDistinctCandidateIps', (SELECT count(DISTINCT a.ip_address) FROM audit_logs a JOIN users u ON u.id=a.actor_id WHERE a.action='login.success' AND u.username LIKE 'cap9same-%'),
    'loginFailure', (SELECT count(*) FROM audit_logs WHERE action='login.failure'),
    'loginFailureReasons', (SELECT json_object_agg(reason, n) FROM (SELECT metadata->>'reason' AS reason, count(*) n FROM audit_logs WHERE action='login.failure' GROUP BY 1) x),
    'auditTotal', (SELECT count(*) FROM audit_logs),
    'users', (SELECT count(*) FROM users),
    'candidateIpRange', (SELECT json_build_object('min', min(a.ip_address::text), 'max', max(a.ip_address::text)) FROM audit_logs a JOIN users u ON u.id=a.actor_id WHERE a.action='login.success' AND u.username LIKE 'cap9same-%')
  );" | python3 -c "import sys,json; print(json.dumps(json.loads(sys.stdin.read().strip()), indent=2))" > "$OUT_DIR/oracle.json"
cat "$OUT_DIR/oracle.json"

timeout 30 docker logs --since "$LOG_T0" --until "$LOG_T1" exam-cap-nginx > "$OUT_DIR/nginx-access.log" 2>&1 || true

log "7/7 run-meta + cmd.sh"
GIT_SHA="$(git -C "$WORKTREE" rev-parse HEAD)"
python3 - "$OUT_DIR/run-meta.json" "$RUN_ID" "$CONCURRENCY" "$N" "$RESET" "$GIT_SHA" "$API_PID" "$LOG_T0" "$LOG_T1" "$HARNESS/logs/api.env" "$PROBE_THR_PRE" "$PROBE_THR_POST" <<'PYEOF'
import json, sys
(out, run_id, c, n, reset, sha, pid, t0, t1, envfile, p_pre, p_post) = sys.argv[1:15]
env = {}
try:
    for line in open(envfile):
        line = line.strip()
        if line and "=" in line and not line.startswith("JWT_SECRET"):
            k, v = line.split("=", 1)
            env[k] = v
except FileNotFoundError:
    env = {"note": "api.env not found"}
json.dump({
    "runId": run_id, "experiment": "L1-VERIFY", "group": "http-login",
    "concurrency": int(c), "n": int(n), "reset": int(reset),
    "headSha": sha, "db": "exam_550_e2e", "apiPid": int(pid),
    "startedAt": t0, "endedAt": t1,
    "envProbe": {"preThrPerSec": p_pre or None, "postThrPerSec": p_post or None,
                 "note": "固定负载 argon2 C=1×60 环境模式探针（快模式基线≈23.5-24.4/s；首轮 r1-r5 无探针=unprobed）"},
    "topology": "driver-container --(unique src IPs)--> nginx 172.28.10.2:80 --> host API :3300 --> PG",
    "instrumentation": "l1-api-sampler 250ms /proc + ~1/s /api/research/capacity (admin, API-direct, not via nginx)",
    "apiEnv": env,
}, open(out, "w"), indent=2)
PYEOF
cat > "$OUT_DIR/cmd.sh" <<EOF
#!/usr/bin/env bash
# cwd=/home/hoo/Source/exam
bash /home/hoo/Source/exam/.wt-capacity/docs/research/exam-cdp-watt-runtime-capacity/evidence/driver/l1-http-run.sh --run-id=$RUN_ID --concurrency=$CONCURRENCY --n=$N --reset=$RESET
EOF

log "run complete: $OUT_DIR (driver rc=$DRIVER_RC)"
exit "$DRIVER_RC"
