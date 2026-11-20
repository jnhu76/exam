#!/usr/bin/env bash
# L1 http-login 补测系列（T4 触发后的复测轮：环境模式探针版 runner）。
# r6..r10 per C；与 r1-r5 同参数（n=200, reset=1），仅新增 pre/post env probe。
set -uo pipefail
D=/home/hoo/Source/exam/.wt-capacity/docs/research/exam-cdp-watt-runtime-capacity/evidence/driver
N="${L1_HTTP_N:-200}"
for C in 1 4 8 16 32; do
  for r in 6 7 8 9 10; do
    echo "=== L1-VERIFY-http-c${C}-r${r} (n=$N) $(date -u +%H:%M:%S) ==="
    bash "$D/l1-http-run.sh" --run-id=L1-VERIFY-http-c${C}-r${r} --concurrency=$C --n=$N --reset=1 \
      || echo "!!! FAILED rc=$? c=$C r=$r"
  done
done
echo "ALL-DONE $(date -u +%H:%M:%S)"
