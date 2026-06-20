#!/usr/bin/env bash
# Deadline scanner stress test — runs the deadline scanner tests repeatedly
# to verify BUG-FLAKE-003 cleanup containment.
#
# Usage:
#   bash scripts/test/deadline-scanner-stress.sh [iterations]
#
# Default: 40 iterations (matches the original reproduction count).

set -euo pipefail

ITERATIONS="${1:-40}"

if ! [[ "$ITERATIONS" =~ ^[1-9][0-9]*$ ]]; then
  echo "Usage: $0 [positive-iterations]" >&2
  exit 2
fi

FAIL=0
LOG_DIR="$(mktemp -d)"
cleanup() { rm -rf "$LOG_DIR"; }
trap cleanup EXIT
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM

echo "Running deadline scanner stress test: ${ITERATIONS} iterations"

for ((i = 1; i <= ITERATIONS; i++)); do
  LOG_FILE="$LOG_DIR/run-$i.log"
  if pnpm --filter @exam/api test -- --run src/routes/attempts.test.ts -t "deadline scanner" > "$LOG_FILE" 2>&1; then
    echo "Run $i: PASS"
  else
    echo "Run $i: FAIL"
    cat "$LOG_FILE" >&2
    FAIL=$((FAIL + 1))
  fi
done

echo ""
echo "Results: $((ITERATIONS - FAIL))/${ITERATIONS} passed"

if [ "$FAIL" -gt 0 ]; then
  echo "FAIL: $FAIL iterations failed"
  exit 1
fi

echo "All iterations passed"
