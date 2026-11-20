#!/usr/bin/env bash
# L1 isolated-verify formal series (RESEARCH ONLY): C ∈ {1,4,8,16,32} × 5 runs.
# 前 2 轮兼作 A/A（协议 §9.4）。每 run 独立进程（fresh JIT/池/内存）。
set -uo pipefail
H=/home/hoo/Source/exam/.wt-capacity/docs/research/exam-cdp-watt-runtime-capacity/harness
N="${L1_ISOLATED_N:-600}"
for C in 1 4 8 16 32; do
  for r in 1 2 3 4 5; do
    echo "=== L1-VERIFY-iso-c${C}-r${r} (n=$N) $(date -u +%H:%M:%S) ==="
    pnpm -C /home/hoo/Source/exam/.wt-capacity --filter @exam/db exec tsx \
      "$H/l1-verify.ts" --run-id=L1-VERIFY-iso-c${C}-r${r} --concurrency=$C --n=$N \
      || echo "!!! FAILED rc=$? c=$C r=$r"
  done
done
echo "ALL-DONE $(date -u +%H:%M:%S)"
