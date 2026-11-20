#!/usr/bin/env bash
# L3-ADMISSION 单 run 编排（RESEARCH ONLY，#900/#1021；协议 §10 L3-ADMISSION +
# PROTOCOL-ADDENDUM §2.2：代表性场景 P2 × S200 × T-DIRECT，交错 A/B 配对）。
#
# 与 L2-ARRIVAL/l2-run.sh 同链（R1 每 run 完整重置 + fresh JWT + driver 回放
# 同一到达表 seed=9001021），差异仅在臂切换：
#   A 臂 = 冻结 SHA 产物 apps/api/dist，无 LOGIN_ADMISSION（原始实现）；
#   B 臂 = L3 分支产物 apps/api/dist-l3 + LOGIN_ADMISSION=1
#          （K=LOGIN_ADMISSION_PERMITS、Q=LOGIN_ADMISSION_QUEUE_CAPACITY、
#           W=LOGIN_ADMISSION_WAIT_BUDGET_MS；默认 4/189/5000 = pilot-lock 值）。
# 臂状态双重校验（l3-arm-check.ts）：/proc/<pid>/environ 实测 + 研究快照
# loginAdmission 字段（A 无字段 / B 有 config）；run 前后各一次。
#
# 用法（cwd 任意）：
#   l3-run.sh --run-id=L3-ADMISSION-B-P2-S200-r1 --arm=b --profile=p2 --n=200 [--pair=1]
set -euo pipefail

DRIVER_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../driver" && pwd)"
L3_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESEARCH="$(cd "$L3_ROOT/../.." && pwd)"
HARNESS="$RESEARCH/harness"
EVIDENCE="$RESEARCH/evidence"
WORKTREE="$(cd "$RESEARCH/../../.." && pwd)"
TOPOLOGY="$HARNESS/topology.sh"
CONTAINER="exam-cap-driver"
RUN_DB="exam_550_e2e"
WINDOW_MS=240000
TAIL_MS=30000
SEED=9001021
B_SHARE=0.1

# L3 pilot-lock 锁定值（K/Q/W；协议 §4 候选空间内，见本目录 pilot-lock.md）
ADMIT_K=4
ADMIT_Q=189
ADMIT_W_MS=5000

log() { printf '[l3] %s\n' "$*"; }
die() { printf '[l3] FATAL: %s\n' "$*" >&2; exit 1; }

RUN_ID="" ARM="" PROFILE="" N="" TOPO=direct SCENARIO=full RESET=1 PAIR=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --run-id=*) RUN_ID="${1#--run-id=}" ;;
    --arm=*) ARM="${1#--arm=}" ;;
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
[[ -n "$RUN_ID" && -n "$ARM" && -n "$PROFILE" && -n "$N" ]] || die "--run-id/--arm/--profile/--n required"
[[ "$ARM" == a || "$ARM" == b ]] || die "arm must be a|b"
[[ "$PROFILE" == "p2" ]] || die "L3-ADMISSION converged scenario is p2 only (addendum §2.2)"
[[ "$SCENARIO" == full ]] || die "L3-ADMISSION scenario is full only"
[[ "$TOPO" == direct ]] || die "L3-ADMISSION topology is direct only"
[[ "$RESET" == 1 ]] || die "L3-ADMISSION runs always full-reset (R1)"

OUT_DIR="$L3_ROOT/$RUN_ID"
mkdir -p "$OUT_DIR"
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

# ── 1/9 R1 reset（臂感知） ─────────────────────────────────────────────────
if [[ "$ARM" == b ]]; then
  export CAPACITY_API_DIST=dist-l3
  export CAPACITY_API_EXTRA_ENV="LOGIN_ADMISSION=1,LOGIN_ADMISSION_PERMITS=$ADMIT_K,LOGIN_ADMISSION_QUEUE_CAPACITY=$ADMIT_Q,LOGIN_ADMISSION_WAIT_BUDGET_MS=$ADMIT_W_MS"
  log "1/9 full R1 reset (arm B: dist=$CAPACITY_API_DIST env=$CAPACITY_API_EXTRA_ENV)"
else
  unset CAPACITY_API_DIST CAPACITY_API_EXTRA_ENV
  log "1/9 full R1 reset (arm A: frozen dist, no admission env)"
fi
if ! bash "$TOPOLOGY" reset >>"$OUT_DIR/topology-reset.log" 2>&1; then
  tail -20 "$OUT_DIR/topology-reset.log" >&2 || true
  mark_failed "topology reset failed"
  die "topology reset failed"
fi
unset CAPACITY_API_DIST CAPACITY_API_EXTRA_ENV

# ── 2/9 前置：driver 容器 + 源 IP 池 ───────────────────────────────────────
docker inspect "$CONTAINER" >/dev/null 2>&1 || { mark_failed "driver container missing"; die "driver container missing (sources.sh up)"; }
IP_CNT="$(docker run --rm --net "container:$CONTAINER" alpine:3 ip -4 addr show dev eth0 2>/dev/null | grep -c 'inet ' || true)"
[[ "$IP_CNT" -ge $((N + 1)) ]] || { mark_failed "source IP pool $IP_CNT < $((N+1))"; die "source IP pool too small"; }

API_PID="$(cat "$HARNESS/logs/api.pid")"
log "2/9 API pid=$API_PID (fresh JWT secret per reset, R3)"

# ── 3/9 臂状态校验（run 前，fail-fast） ────────────────────────────────────
log "3/9 arm check (pre-run)"
if ! pnpm -C "$WORKTREE" --filter @exam/db exec tsx "$L3_ROOT/l3-arm-check.ts" \
    --pid="$API_PID" --arm="$ARM" --out="$OUT_DIR/arm-check-pre.json" \
    --expect-k="$ADMIT_K" --expect-q="$ADMIT_Q" --expect-w="$ADMIT_W_MS" \
    >>"$OUT_DIR/arm-check.log" 2>&1; then
  cat "$OUT_DIR/arm-check-pre.json" >&2 || true
  mark_failed "arm check (pre-run) mismatch"
  die "arm check pre-run failed for arm=$ARM"
fi

# ── 4/9 API 采样器（背景） ─────────────────────────────────────────────────
log "4/9 starting API sampler (background)"
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

# ── 5/9 driver（同到达表回放：seed=9001021 → 与 L2 P2×S200 完全一致轨迹） ──
log "5/9 driver: scenario=$SCENARIO profile=$PROFILE n=$N topo=$TOPO window=240s tail=30s arm=$ARM (via nginx)"
if ! bash "$DRIVER_DIR/run.sh" --run-id="$RUN_ID" --scenario="$SCENARIO" --topology="$TOPO" \
    --n="$N" --profile="$PROFILE" --window-ms=$WINDOW_MS --tail-ms=$TAIL_MS \
    --flow=mix --b-share=$B_SHARE --seed=$SEED --from=0 \
    >>"$OUT_DIR/run-sh.log" 2>&1; then
  RC=1
  tail -20 "$OUT_DIR/run-sh.log" >&2 || true
  mark_failed "run.sh/driver failed (see run-sh.log)"
fi

# ── 6/9 停采样器 + 臂状态复核（run 后；B 臂顺带固化准入 counters/peaks） ────
log "6/9 stop sampler + arm check (post-run)"
touch "$STOP_FILE"
for _ in $(seq 1 80); do [[ -f "$OUT_DIR/api-summary.json" ]] && break; sleep 0.5; done
[[ -f "$OUT_DIR/api-summary.json" ]] || log "WARN: api-summary.json missing"
pnpm -C "$WORKTREE" --filter @exam/db exec tsx "$L3_ROOT/l3-arm-check.ts" \
    --pid="$API_PID" --arm="$ARM" --out="$OUT_DIR/arm-check-post.json" \
    --expect-k="$ADMIT_K" --expect-q="$ADMIT_Q" --expect-w="$ADMIT_W_MS" \
    >>"$OUT_DIR/arm-check.log" 2>&1 || { log "WARN: arm check post-run mismatch"; RC=${RC:-1}; }

# ── 7/9 DB durable oracle + 归档 ───────────────────────────────────────────
SRC="$DRIVER_DIR/runs/$RUN_ID"
if [[ -d "$SRC" ]]; then
  if [[ -f "$SRC/driver.json" ]]; then
    pnpm -C "$WORKTREE" --filter @exam/db exec tsx "$DRIVER_DIR/oracle.ts" --run="$RUN_ID" \
      >>"$OUT_DIR/oracle.log" 2>&1 || { log "WARN: oracle.ts non-zero (kept)"; RC=1; }
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
    cp -a "$SRC/." "$OUT_DIR/" 2>/dev/null || true
    rm -rf "$SRC"
  else
    mark_failed "driver.json missing after run (docker cp failed?)"
    RC=1
  fi
else
  [[ -f "$OUT_DIR/driver.json" ]] || { mark_failed "no driver artifacts at all"; RC=1; }
fi

# ── 8/9 per-run 指标（复用 L2 指标器；driver run-meta.json 由 driver 产出） ──
log "8/9 l2-metrics.py (per-run indicators + T6 verdict)"
python3 "$EVIDENCE/L2-ARRIVAL/l2-metrics.py" --run-dir="$OUT_DIR" >>"$OUT_DIR/metrics.log" 2>&1 \
  || { log "WARN: l2-metrics.py failed"; RC=${RC:-1}; }

# ── 9/9 run-meta + cmd.sh ──────────────────────────────────────────────────
log "9/9 run-meta + cmd.sh"
GIT_SHA="$(git -C "$WORKTREE" rev-parse HEAD)"
A_SHA="87510894728ee1ca20a530fc20e29fa1f51709b7"
API_DIST_USED="dist"; [[ "$ARM" == b ]] && API_DIST_USED="dist-l3"
A_SRV_SHA="$(sha256sum "$WORKTREE/apps/api/dist/server.js" | cut -d' ' -f1)"
B_SRV_SHA="$(sha256sum "$WORKTREE/apps/api/dist-l3/server.js" | cut -d' ' -f1)"
python3 - "$OUT_DIR" "$RUN_ID" "$ARM" "$PROFILE" "$N" "$TOPO" "$SCENARIO" "$PAIR" "$GIT_SHA" "$API_PID" "$WINDOW_MS" "$TAIL_MS" "$SEED" "$B_SHARE" "$ADMIT_K" "$ADMIT_Q" "$ADMIT_W_MS" "$API_DIST_USED" "$A_SHA" "$A_SRV_SHA" "$B_SRV_SHA" <<'PYEOF'
import json, sys
(out, run_id, arm, profile, n, topo, scen, pair, sha, pid, win, tail, seed, bshare, k, q, w, dist_used, a_sha, a_srv, b_srv) = sys.argv[1:22]
json.dump({
  "runId": run_id, "experiment": "L3-ADMISSION", "arm": arm,
  "armDefinition": ("A = frozen-SHA build apps/api/dist, LOGIN_ADMISSION unset" if arm == "a"
                    else f"B = L3-branch build apps/api/dist-l3, LOGIN_ADMISSION=1 K={k} Q={q} W={w}ms"),
  "admission": {"K": int(k), "Q": int(q), "waitBudgetMs": int(w)} if arm == "b" else None,
  "profile": profile, "n": int(n), "topology": topo, "scenario": scen,
  "pairIndex": int(pair) if pair else None,
  "windowMs": int(win), "tailMs": int(tail), "seed": int(seed), "flow": "mix", "bShare": float(bshare),
  "headSha": sha, "frozenABaselineSha": a_sha, "apiDistUsed": dist_used,
  "artifactSha256": {"aDistServerJs": a_srv, "bDistL3ServerJs": b_srv},
  "db": "exam_550_e2e", "apiPid": int(pid), "fromCandidate": 0,
  "topologyChain": "driver-container --(unique src IPs 172.28.10.10+k | shared egress)--> nginx 172.28.10.2:80 --> host API :3300 --> PG exam_550_e2e",
  "instrumentation": "l1-api-sampler 250ms /proc + ~1/s /api/research/capacity (admin, API-direct, not via nginx); l3-arm-check pre/post",
}, open(f"{out}/l3-run-meta.json", "w"), indent=2)
PYEOF
cat > "$OUT_DIR/cmd.sh" <<EOF
#!/usr/bin/env bash
# cwd=/home/hoo/Source/exam
bash /home/hoo/Source/exam/.wt-capacity/docs/research/exam-cdp-watt-runtime-capacity/evidence/L3-ADMISSION/l3-run.sh --run-id=$RUN_ID --arm=$ARM --profile=$PROFILE --n=$N --topology=$TOPO --scenario=$SCENARIO --reset=1 ${PAIR:+--pair=$PAIR}
EOF

if [[ "$RC" != "0" ]]; then
  log "run complete WITH FAILURES (rc=$RC): $OUT_DIR"
else
  log "run complete: $OUT_DIR"
fi
exit "$RC"
