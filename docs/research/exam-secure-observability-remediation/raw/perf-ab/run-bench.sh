#!/usr/bin/env bash
# Interleaved A/B program: 6 reps, starting variant rotated per rep.
set -uo pipefail
cd /tmp/perf-ab
mkdir -p out
date -u +"RUN_START %Y-%m-%dT%H:%M:%SZ"
for rep in 1 2 3 4 5 6; do
  if [ $((rep % 2)) -eq 1 ]; then ORDER="base int"; else ORDER="int base"; fi
  for v in $ORDER; do
    echo "=== rep $rep variant $v ($(date -u +%H:%M:%S)) ==="
    node load.mjs "$v" "$rep" /tmp/perf-ab/out || { echo "PHASE_FAILED rep=$rep v=$v"; exit 1; }
  done
done
date -u +"RUN_END %Y-%m-%dT%H:%M:%SZ"
echo BENCH_PROGRAM_DONE
