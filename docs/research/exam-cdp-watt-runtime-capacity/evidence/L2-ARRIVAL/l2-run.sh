#!/usr/bin/env bash
# L2-ARRIVAL 单 run 编排（RESEARCH ONLY，#900/#1021；协议 §10 L2-ARRIVAL）。
#
# 每 run 一条链（协议 §11 R1——每 run 之间完整重置）：
#   1. topology.sh reset：loud DROP/CREATE→migrate→canonical seed→fresh API
#      （fresh JWT secret）→ 播种 400 合成考生 → nginx → health；
#   2. driver 容器与源 IP 池在位检查；
#   3. 背景启动 l1-api-sampler（API /proc + /api/research/capacity，仪表不走
#      nginx 测量路径）；
#   4. driver（G1 回放 driver，scenario=full|login-only，profile=p1|p2|p3，
#      window 240s / tail 30s，flow=mix b-share=0.1 seed=9001021 from=0，
#      经实际 nginx，T-DIRECT 每考生独一源 IP）；
#   5. 停采样器 → DB durable oracle（driver oracle.ts + psql 计数）；
#   6. 归档到 evidence/L2-ARRIVAL/<run_id>/ + l2-metrics.py 按 run 指标 +
#      run-meta.json + cmd.sh（cwd=/home/hoo/Source/exam 原样可复跑）。
#
# 用法（cwd 任意）：
#   l2-run.sh --run-id=L2-ARRIVAL-P2-S20-r1 --profile=p2 --n=20 \
#             [--topology=direct] [--scenario=full] [--reset=1] [--pair=1]
set -euo pipefail

DRIVER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../driver" && pwd)"
RESEARCH="$(cd "$DRIVER_DIR/../.." && pwd)"
HARNESS="$RESEARCH/harness"
EVIDENCE="$RESEARCH/evidence"
WORKTREE="$(cd "$RESEARCH/../../.." && pwd)"
TOPOLOGY="$HARNESS/topology.sh"
L2_ROOT="$EVIDENCE/L2-ARRIVAL"
CONTAINER="exam-cap-driver"
RUN_DB="exam_550_e2e"
WINDOW_MS=240000
TAIL_MS=30000
SEED=9001021
B_SHARE=0.1

log() { printf '[l2] %s\n' "$*"; }
die() { printf '[l2] FATAL: %s\n' "$*" >&2; exit 1; }

RUN_ID="" PROFILE="" N="" TOPO=direct SCENARIO=full RESET=1 PAIR=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --run-id=*) RUN_ID="${1#--run-id=}" ;;
    --profile=*) PROFILE="${1#--profile=}" ;;
    --n=*) N="${1#--n=}" ;;
    --topology=*) TOPO="${1#--topology=}" ;;
    --scenario=*) SCENARIO="${1#--scenario=}" ;;
    --reset=*) RESET="${1#--reset=}" ;;
    --pair=*) PAIR="${1#--pair=}" ;;
    *) die "unknown arg: $1" ;;
  esac
  shift
done
[[ -n "$RUN_ID" && -n "$PROFILE" && -n "$N" ]] || die "--run-id/--profile/--n required"
[[ "$PROFILE" == p1 || "$PROFILE" == p2 || "$PROFILE" == p3 ]] || die "profile must be p1|p2|p3"
[[ "$SCENARIO" == full || "$SCENARIO" == login-only ]] || die "scenario must be full|login-only"
[[ "$TOPO" == direct || "$TOPO" == shared ]] || die "topology must be direct|shared"
[[ "$RESET" == 0 || "$RESET" == 1 ]] || die "reset must be 0|1"

OUT_DIR="$L2_ROOT/$RUN_ID"
mkdir -p "$OUT_DIR"
# 同 run_id 重跑保护：已有完整产物的 run 直接跳过（series 可恢复）
if [[ -f "$OUT_DIR/l2-metrics.json" && -f "$OUT_DIR/FAILED.md" ]]; then
  die "run dir exists with FAILED marker + metrics — remove manually to retry"
fi
if [[ -f "$OUT_DIR/l2-metrics.json" ]]; then
  log "skip: $OUT_DIR already complete"
  exit 0
fi

RC=0
mark_failed() {
  printf 'FAILED: %s\nrun dir kept per protocol R2\n' "$1" > "$OUT_DIR/FAILED.md"
}

if [[ "$RESET" == "1" ]]; then
  log "1/8 full R1 reset (topology.sh reset)"
  if ! bash "$TOPOLOGY" reset >>"$OUT_DIR/topology-reset.log" 2>&1; then
    tail -20 "$OUT_DIR/topology-reset.log" >&2 || true
    mark_failed "topology reset failed"
    die "topology reset failed"
  fi
else
  curl -fsS -o /dev/null http://127.0.0.1:8080/api/health || { mark_failed "nginx unhealthy"; die "nginx ingress unhealthy"; }
  curl -fsS -o /dev/null http://127.0.0.1:3300/api/health || { mark_failed "api unhealthy"; die "API direct unhealthy"; }
fi

# 源 IP 池在位检查（direct 需 ≥ N+1 个地址）
docker inspect "$CONTAINER" >/dev/null 2>&1 || { mark_failed "driver container missing"; die "driver container missing (sources.sh up)"; }
if [[ "$TOPO" == "direct" ]]; then
  IP_CNT="$(docker run --rm --net "container:$CONTAINER" alpine:3 ip -4 addr show dev eth0 2>/dev/null | grep -c 'inet ' || true)"
  [[ "$IP_CNT" -ge $((N + 1)) ]] || { mark_failed "source IP pool $IP_CNT < $((N+1))"; die "source IP pool too small"; }
fi

API_PID="$(cat "$HARNESS/logs/api.pid")"
log "2/8 API pid=$API_PID (fresh JWT secret per reset, R3)"

log "3/8 starting API sampler (background)"
READY_FILE="$OUT_DIR/.sampler-ready"
STOP_FILE="$OUT_DIR/.sampler-stop"
rm -f "$READY_FILE" "$STOP_FILE" "$OUT_DIR/api-sampler.jsonl" "$OUT_DIR/api-summary.json" "$OUT_DIR/api-research-snapshots.jsonl"
MAX_SECONDS=$((WINDOW_MS / 1000 + 240))
nohup pnpm -C "$WORKTREE" --filter @exam/db exec tsx "$HARNESS/l1-api-sampler.ts" \
    --pid="$API_PID" --out-dir="$OUT_DIR" --ready-file="$READY_FILE" --stop-file="$STOP_FILE" \
    --interval-ms=250 --snapshot-every=4 --max-seconds="$MAX_SECONDS" \
    >>"$OUT_DIR/sampler.log" 2>&1 < /dev/null &
disown
for _ in $(seq 1 90); do [[ -f "$READY_FILE" ]] && break; sleep 0.5; done
[[ -f "$READY_FILE" ]] || { mark_failed "sampler not ready"; die "sampler not ready in 45s"; }

log "4/8 driver: scenario=$SCENARIO profile=$PROFILE n=$N topo=$TOPO window=240s tail=30s (via nginx)"
if ! bash "$DRIVER_DIR/run.sh" --run-id="$RUN_ID" --scenario="$SCENARIO" --topology="$TOPO" \
    --n="$N" --profile="$PROFILE" --window-ms=$WINDOW_MS --tail-ms=$TAIL_MS \
    --flow=mix --b-share=$B_SHARE --seed=$SEED --from=0 \
    >>"$OUT_DIR/run-sh.log" 2>&1; then
  RC=1
  tail -20 "$OUT_DIR/run-sh.log" >&2 || true
  mark_failed "run.sh/driver failed (see run-sh.log)"
fi

log "5/8 stop sampler"
touch "$STOP_FILE"
for _ in $(seq 1 80); do [[ -f "$OUT_DIR/api-summary.json" ]] && break; sleep 0.5; done
[[ -f "$OUT_DIR/api-summary.json" ]] || log "WARN: api-summary.json missing"

SRC="$DRIVER_DIR/runs/$RUN_ID"
if [[ -d "$SRC" ]]; then
  if [[ -f "$SRC/driver.json" ]]; then
    log "6/8 DB durable oracle (driver oracle.ts + psql counts)"
    pnpm -C "$WORKTREE" --filter @exam/db exec tsx "$DRIVER_DIR/oracle.ts" --run="$RUN_ID" \
      >>"$OUT_DIR/oracle.log" 2>&1 || { log "WARN: oracle.ts non-zero (kept)"; RC=${RC:-1}; }
    docker exec exam-dev-db-1 psql -U exam -d "$RUN_DB" -tAc "
      SELECT json_build_object(
        'loginSuccessAll', (SELECT count(*) FROM audit_logs WHERE action='login.success'),
        'loginSuccessCandidates', (SELECT count(*) FROM audit_logs a JOIN users u ON u.id=a.actor_id WHERE a.action='login.success' AND u.username LIKE 'cap9same-%'),
        'loginSuccessDistinctCandidates', (SELECT count(DISTINCT a.actor_id) FROM audit_logs a JOIN users u ON u.id=a.actor_id WHERE a.action='login.success' AND u.username LIKE 'cap9same-%'),
        'loginSuccessDistinctCandidateIps', (SELECT count(DISTINCT a.ip_address) FROM audit_logs a JOIN users u ON u.id=a.actor_id WHERE a.action='login.success' AND u.username LIKE 'cap9same-%'),
        'loginFailure', (SELECT count(*) FROM audit_logs WHERE action='login.failure'),
        'loginFailureReasons', (SELECT json_object_agg(reason, n) FROM (SELECT metadata->>'reason' AS reason, count(*) n FROM audit_logs WHERE action='login.failure' GROUP BY 1) x),
        'auditTotal', (SELECT count(*) FROM audit_logs),
        'attemptsByStatus', (SELECT json_object_agg(status, n) FROM (SELECT status::text, count(*) n FROM exam_attempts GROUP BY 1) x),
        'inProgressAttempts', (SELECT count(*) FROM exam_attempts WHERE status='in_progress')
      );" | python3 -c "import sys,json; print(json.dumps(json.loads(sys.stdin.read().strip()), indent=2))" > "$OUT_DIR/db-oracle.json" 2>>"$OUT_DIR/oracle.log" || log "WARN: db-oracle psql failed"
    # 7/8 归档到 L2 目录（driver 原始 runs/ 目录保留空壳由 run.sh 生命周期管理）
    cp -a "$SRC/." "$OUT_DIR/" 2>/dev/null || true
    rm -rf "$SRC"
  else
    mark_failed "driver.json missing after run (docker cp failed?)"
    RC=1
  fi
else
  [[ -f "$OUT_DIR/driver.json" ]] || { mark_failed "no driver artifacts at all"; RC=1; }
fi

log "7/8 l2-metrics.py (per-run indicators + T6 verdict)"
python3 "$L2_ROOT/l2-metrics.py" --run-dir="$OUT_DIR" >>"$OUT_DIR/metrics.log" 2>&1 \
  || { log "WARN: l2-metrics.py failed"; RC=${RC:-1}; }

log "8/8 run-meta + cmd.sh"
GIT_SHA="$(git -C "$WORKTREE" rev-parse HEAD)"
python3 - "$OUT_DIR" "$RUN_ID" "$PROFILE" "$N" "$TOPO" "$SCENARIO" "$RESET" "$PAIR" "$GIT_SHA" "$API_PID" "$WINDOW_MS" "$TAIL_MS" "$SEED" "$B_SHARE" <<'PYEOF'
import json, sys
(out, run_id, profile, n, topo, scen, reset, pair, sha, pid, win, tail, seed, bshare) = sys.argv[1:16]
json.dump({
  "runId": run_id, "experiment": "L2-ARRIVAL", "profile": profile, "n": int(n),
  "topology": topo, "scenario": scen, "reset": int(reset), "pairIndex": int(pair) if pair else None,
  "windowMs": int(win), "tailMs": int(tail), "seed": int(seed), "flow": "mix", "bShare": float(bshare),
  "headSha": sha, "db": "exam_550_e2e", "apiPid": int(pid),
  "fromCandidate": 0,
  "topologyChain": "driver-container --(unique src IPs 172.28.10.10+k | shared egress)--> nginx 172.28.10.2:80 --> host API :3300 --> PG exam_550_e2e",
  "instrumentation": "l1-api-sampler 250ms /proc + ~1/s /api/research/capacity (admin, API-direct, not via nginx)",
}, open(f"{out}/l2-run-meta.json", "w"), indent=2)
PYEOF
cat > "$OUT_DIR/cmd.sh" <<EOF
#!/usr/bin/env bash
# cwd=/home/hoo/Source/exam
bash /home/hoo/Source/exam/.wt-capacity/docs/research/exam-cdp-watt-runtime-capacity/evidence/L2-ARRIVAL/l2-run.sh --run-id=$RUN_ID --profile=$PROFILE --n=$N --topology=$TOPO --scenario=$SCENARIO --reset=$RESET ${PAIR:+--pair=$PAIR}
EOF

if [[ "$RC" != "0" ]]; then
  log "run complete WITH FAILURES (rc=$RC): $OUT_DIR"
else
  log "run complete: $OUT_DIR"
fi
exit "$RC"
