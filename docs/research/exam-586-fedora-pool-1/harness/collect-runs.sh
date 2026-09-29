#!/usr/bin/env bash
# EXAM-586 RESEARCH ONLY: copy completed runs' bounded evidence from the
# host run root into the repo research results/ directory.
#
# Repository material policy: Git keeps research source + small normalized
# text evidence only. Raw per-request logs (requests.jsonl), database dumps
# (candidates.sql) and container service logs (app/web/db.log) stay
# host-side under EXAM586_RUNS_ROOT; their integrity is recorded per run in
# SHA256SUMS and referenced by 10-evidence-ledger.md. Idempotent per run.
set -euo pipefail
HARNESS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNS_ROOT="${EXAM586_RUNS_ROOT:-/home/jnhu/exam-586/runs}"
DEST="$HARNESS/../results"

for run_dir in "$RUNS_ROOT"/*/; do
  run="$(basename "$run_dir")"
  [ -f "$run_dir/meta.json" ] || continue
  out="$DEST/$run"
  mkdir -p "$out"
  for f in meta.json driver-summary.json correctness.json summary586.json \
           pg-before.json pg-after.json pg-settings.txt pg-version.txt \
           pg-activity.jsonl pg-locks.jsonl pg-qtext.jsonl \
           docker-stats.txt SHA256SUMS INVALID_REASON.txt \
           pool-witness.txt timing-count.txt oracle.log; do
    [ -f "$run_dir/$f" ] && cp -f "$run_dir/$f" "$out/" || true
  done
  echo "collected $run"
done
