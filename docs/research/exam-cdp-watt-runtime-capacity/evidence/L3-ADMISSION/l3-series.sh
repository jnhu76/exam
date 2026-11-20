#!/usr/bin/env bash
# L3-ADMISSION 正式采样系列（RESEARCH ONLY；协议 §10 L3-ADMISSION + 附录 §2.2）。
#
# 场景（附录锁定）：P2 × S200 × T-DIRECT × scenario=full × seed=9001021（与 L2
# P2×S200 完全同一到达轨迹）；K=4/Q=189/W=5000ms（pilot-lock）。
# 队列（每 run 之间完整 R1 重置，交错臂序）：
#   1. A/A 噪声地板：A aa1 → A aa2（同臂连续，不入配对统计；PROTOCOL §9.2）
#   2. 配对 ≥3：对1 A→B、对2 B→A、对3 A→B（附录 §2.2 指定臂序）
# 可恢复：l3-run.sh 对已完成 run（l2-metrics.json 存在且无 FAILED）自动跳过。
# 用法： bash l3-series.sh [aa|pairs|all]
set -uo pipefail

L3_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERIES_LOG="$L3_ROOT/series.log"
STATE="$L3_ROOT/series-state.jsonl"

log() { printf '[series %s] %s\n' "$(date -u +%H:%M:%S)" "$*" | tee -a "$SERIES_LOG"; }

run_one() { # run-id arm pair
  local rid="$1" arm="$2" pair="${3:-}"
  if [[ -f "$L3_ROOT/$rid/l2-metrics.json" && ! -f "$L3_ROOT/$rid/FAILED.md" ]]; then
    log "SKIP $rid (complete)"
    return 0
  fi
  local t0=$(date +%s)
  log "START $rid (arm=$arm pair=${pair:-—})"
  if bash "$L3_ROOT/l3-run.sh" --run-id="$rid" --arm="$arm" --profile=p2 --n=200 \
      --topology=direct --scenario=full --reset=1 ${pair:+--pair="$pair"} \
      >>"$SERIES_LOG" 2>&1; then
    printf '{"runId":"%s","rc":0,"durS":%d}\n' "$rid" "$(( $(date +%s) - t0 ))" >> "$STATE"
    log "DONE  $rid ($(( $(date +%s) - t0 ))s)"
  else
    printf '{"runId":"%s","rc":%d,"durS":%d}\n' "$rid" "$?" "$(( $(date +%s) - t0 ))" >> "$STATE"
    log "FAILED $rid — 保留产物，继续队列（R2：重置后补跑计入配对）"
  fi
}

stage="${1:-all}"

if [[ "$stage" == "aa" || "$stage" == "all" ]]; then
  log "== stage aa（同臂连续 2 轮 A：噪声地板，不入配对）=="
  run_one L3-ADMISSION-A-P2-S200-aa1 a
  run_one L3-ADMISSION-A-P2-S200-aa2 a
fi

if [[ "$stage" == "pairs" || "$stage" == "all" ]]; then
  log "== stage pairs（交错：对1 A→B、对2 B→A、对3 A→B）=="
  run_one L3-ADMISSION-A-P2-S200-r1a a 1
  run_one L3-ADMISSION-B-P2-S200-r1b b 1
  run_one L3-ADMISSION-B-P2-S200-r2b b 2
  run_one L3-ADMISSION-A-P2-S200-r2a a 2
  run_one L3-ADMISSION-A-P2-S200-r3a a 3
  run_one L3-ADMISSION-B-P2-S200-r3b b 3
fi

log "== series stage '$stage' finished =="
