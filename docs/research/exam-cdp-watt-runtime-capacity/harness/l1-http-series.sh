#!/usr/bin/env bash
# L1 http-login formal series (RESEARCH ONLY): C ∈ {1,4,8,16,32} × 5 runs,
# 每 run 完整 R1 重置（fresh DB/seed/API/JWT → 每 run RSS 高水位与 oracle 干净）。
# 前 2 轮兼作 A/A（协议 §9.4）。
set -uo pipefail
D=/home/hoo/Source/exam/.wt-capacity/docs/research/exam-cdp-watt-runtime-capacity/evidence/driver
N="${L1_HTTP_N:-200}"
for C in 1 4 8 16 32; do
  for r in 1 2 3 4 5; do
    echo "=== L1-VERIFY-http-c${C}-r${r} (n=$N) $(date -u +%H:%M:%S) ==="
    bash "$D/l1-http-run.sh" --run-id=L1-VERIFY-http-c${C}-r${r} --concurrency=$C --n=$N --reset=1 \
      || echo "!!! FAILED rc=$? c=$C r=$r"
  done
done
echo "ALL-DONE $(date -u +%H:%M:%S)"
