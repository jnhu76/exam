#!/usr/bin/env bash
# L2-ARRIVAL 正式采样系列（RESEARCH ONLY，协议 §10 L2-ARRIVAL + §9 配对规程）。
#
# 队列（全部 T-DIRECT 除单列项；window 240s / tail 30s / flow mix b=0.1 / seed 9001021）：
#   0. pilot P2×S20（不入正式统计）
#   1. P1 vs P2 交错配对：S∈{20,50,100,200} × 5 对（奇数对 A=P1 先、偶数对 B=P2 先；
#      每 run 之间完整 R1 重置；同臂连续邻接（run2-3、run4-5）兼作 A/A 见证）
#   2. P3 同刻突发：S∈{20,50,100,200} × 5（前 2 轮连续，兼作 A/A）
#   3. 纯登录补测（login-only，CPU/成功 增量分解用）：P2×S100 ×2、P3×S100 ×2
#   4. T-SHARED 单列（P2×S100 ×2）：共享出口可用性限制见证（不并入容量结论）
#
# 可恢复：l2-run.sh 对已完成 run（l2-metrics.json 存在）自动跳过。
# 用法： bash l2-series.sh [stage]   stage ∈ pilot|pairs|p3|supplement|shared|all（默认 all）
set -uo pipefail

L2_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERIES_LOG="$L2_ROOT/series.log"
STATE="$L2_ROOT/series-state.jsonl"

log() { printf '[series %s] %s\n' "$(date -u +%H:%M:%S)" "$*" | tee -a "$SERIES_LOG"; }

run_one() { # run-id profile n topology scenario pair
  local rid="$1" profile="$2" n="$3" topo="$4" scen="${5:-full}" pair="${6:-}"
  if [[ -f "$L2_ROOT/$rid/l2-metrics.json" && ! -f "$L2_ROOT/$rid/FAILED.md" ]]; then
    log "SKIP $rid (complete)"
    return 0
  fi
  local t0=$(date +%s)
  log "START $rid (profile=$profile n=$n topo=$topo scen=$scen pair=${pair:-—})"
  if bash "$L2_ROOT/l2-run.sh" --run-id="$rid" --profile="$profile" --n="$n" \
      --topology="$topo" --scenario="$scen" ${pair:+--pair="$pair"} \
      >>"$SERIES_LOG" 2>&1; then
    local dt=$(( $(date +%s) - t0 ))
    printf '{"runId":"%s","rc":0,"durS":%d}\n' "$rid" "$dt" >> "$STATE"
    log "DONE  $rid (${dt}s)"
  else
    local rc=$?
    local dt=$(( $(date +%s) - t0 ))
    printf '{"runId":"%s","rc":%d,"durS":%d}\n' "$rid" "$rc" "$dt" >> "$STATE"
    log "FAILED $rid (rc=$rc, ${dt}s) — 保留产物，继续队列"
  fi
}

stage="${1:-all}"

if [[ "$stage" == "pilot" || "$stage" == "all" ]]; then
  log "== stage pilot =="
  run_one L2-PILOT-P2-S20-r1 p2 20 direct
fi

if [[ "$stage" == "pairs" || "$stage" == "all" ]]; then
  for S in 20 50 100 200; do
    log "== stage pairs S$S（交错配对：奇对 P1→P2，偶对 P2→P1）=="
    run_one "L2-ARRIVAL-P1-S$S-r1" p1 "$S" direct full 1
    run_one "L2-ARRIVAL-P2-S$S-r1" p2 "$S" direct full 1
    run_one "L2-ARRIVAL-P2-S$S-r2" p2 "$S" direct full 2
    run_one "L2-ARRIVAL-P1-S$S-r2" p1 "$S" direct full 2
    run_one "L2-ARRIVAL-P1-S$S-r3" p1 "$S" direct full 3
    run_one "L2-ARRIVAL-P2-S$S-r3" p2 "$S" direct full 3
    run_one "L2-ARRIVAL-P2-S$S-r4" p2 "$S" direct full 4
    run_one "L2-ARRIVAL-P1-S$S-r4" p1 "$S" direct full 4
    run_one "L2-ARRIVAL-P1-S$S-r5" p1 "$S" direct full 5
    run_one "L2-ARRIVAL-P2-S$S-r5" p2 "$S" direct full 5
  done
fi

if [[ "$stage" == "p3" || "$stage" == "all" ]]; then
  for S in 20 50 100 200; do
    log "== stage p3 S$S =="
    for r in 1 2 3 4 5; do
      run_one "L2-ARRIVAL-P3-S$S-r$r" p3 "$S" direct
    done
  done
fi

if [[ "$stage" == "supplement" || "$stage" == "all" ]]; then
  log "== stage supplement（纯登录补测：CPU/成功 增量分解）=="
  run_one L2-LOGINONLY-P2-S100-r1 p2 100 direct login-only
  run_one L2-LOGINONLY-P3-S100-r1 p3 100 direct login-only
  run_one L2-LOGINONLY-P2-S100-r2 p2 100 direct login-only
  run_one L2-LOGINONLY-P3-S100-r2 p3 100 direct login-only
fi

if [[ "$stage" == "shared" || "$stage" == "all" ]]; then
  log "== stage shared（T-SHARED 单列：共享出口可用性限制）=="
  run_one L2-SHARED-P2-S100-r1 p2 100 shared full
  run_one L2-SHARED-P2-S100-r2 p2 100 shared full
fi

log "== series stage '$stage' finished =="
