#!/usr/bin/env bash
# EXAM-586 RESEARCH ONLY: copy completed runs' evidence from the host run
# root into the repo research results/ directory (logs gzipped; PG data roots
# and env files with secrets are NOT copied). Idempotent per run.
set -euo pipefail
HARNESS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNS_ROOT="${EXAM586_RUNS_ROOT:-/home/jnhu/exam-586/runs}"
DEST="$HARNESS/../results"

for run_dir in "$RUNS_ROOT"/*/; do
  run="$(basename "$run_dir")"
  [ -f "$run_dir/meta.json" ] || continue
  out="$DEST/$run"
  mkdir -p "$out"
  for f in meta.json requests.jsonl driver-summary.json correctness.json \
           pg-before.json pg-after.json pg-settings.txt pg-version.txt \
           pg-activity.jsonl pg-locks.jsonl docker-stats.txt \
           candidates.sql SHA256SUMS INVALID_REASON.txt summary586.json \
           pool-witness.txt timing-count.txt oracle.log; do
    [ -f "$run_dir/$f" ] && cp -f "$run_dir/$f" "$out/" || true
  done
  for l in app web db; do
    if [ -s "$run_dir/$l.log" ] && [ ! -f "$out/$l.log.gz" ]; then
      gzip -9 -c "$run_dir/$l.log" > "$out/$l.log.gz"
    fi
  done
  echo "collected $run"
done
