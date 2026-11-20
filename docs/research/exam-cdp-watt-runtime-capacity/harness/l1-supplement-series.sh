#!/usr/bin/env bash
# L1 inflection supplement series (RESEARCH ONLY): C ∈ {2,3} both groups × 5 runs.
# 依据：主曲线在 1→4 间弯折（隔离 24.4→41.6/s；HTTP-fast 18.6→38.5/s），
# K 候选 {1,2,4,8} 需要 2/3 点钉住拐点（协议 §4 L1 并发轴"必要时拐点补测"）。
set -uo pipefail
H=/home/hoo/Source/exam/.wt-capacity/docs/research/exam-cdp-watt-runtime-capacity/harness
D=/home/hoo/Source/exam/.wt-capacity/docs/research/exam-cdp-watt-runtime-capacity/evidence/driver

echo "== isolated C=2,3 (n=600) =="
for C in 2 3; do
  for r in 1 2 3 4 5; do
    echo "=== L1-VERIFY-iso-c${C}-r${r} $(date -u +%H:%M:%S) ==="
    pnpm -C /home/hoo/Source/exam/.wt-capacity --filter @exam/db exec tsx \
      "$H/l1-verify.ts" --run-id=L1-VERIFY-iso-c${C}-r${r} --concurrency=$C --n=600 \
      || echo "!!! FAILED rc=$? iso c=$C r=$r"
  done
done

echo "== http C=2,3 (n=200, reset=1, probe-tagged) =="
for C in 2 3; do
  for r in 1 2 3 4 5; do
    echo "=== L1-VERIFY-http-c${C}-r${r} $(date -u +%H:%M:%S) ==="
    bash "$D/l1-http-run.sh" --run-id=L1-VERIFY-http-c${C}-r${r} --concurrency=$C --n=200 --reset=1 \
      || echo "!!! FAILED rc=$? http c=$C r=$r"
  done
done
echo "ALL-DONE $(date -u +%H:%M:%S)"
