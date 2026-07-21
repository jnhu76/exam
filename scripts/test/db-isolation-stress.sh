#!/usr/bin/env bash
# db-isolation-stress.sh — Comprehensive stress test for B方案 (isolated PG schema).
#
# Validates that per-worker/per-file isolated PostgreSQL schemas resolve the
# four BUG-FLAKE entries from docs/standards/test-flakes.md:
#
#   BUG-FLAKE-001: scanner timeout under shared schema + coverage
#   BUG-FLAKE-002: cross-package seed/cleanup collision
#   BUG-FLAKE-003: leaked expired attempts across repeated runs
#   BUG-FLAKE-004: intra-suite cross-file state leak
#
# Usage:
#   bash scripts/test/db-isolation-stress.sh           # default 10 rounds
#   bash scripts/test/db-isolation-stress.sh 40        # 40 rounds (deep stress)
#   bash scripts/test/db-isolation-stress.sh 5 --fast  # skip slow stages
#   KEEP_TEST_SCHEMAS=1 bash scripts/test/db-isolation-stress.sh 3
#   bash scripts/test/db-isolation-stress.sh 3 --skip-verify  # skip full pnpm verify
#
# Environment:
#   KEEP_TEST_SCHEMAS=1   Keep test schemas after run (for debugging)
#   TEST_DB_ISOLATION=0   Disable isolation (run against public schema — expect failures)
#   TURBO_FORCE=true      Bypass turbo cache

set -euo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$repo_root"

ITERATIONS="${1:-10}"
FAST_MODE=false
SKIP_VERIFY=false

for arg in "${@:2}"; do
  case "$arg" in
    --fast) FAST_MODE=true ;;
    --skip-verify) SKIP_VERIFY=true ;;
  esac
done

if ! [[ "$ITERATIONS" =~ ^[1-9][0-9]*$ ]]; then
  echo "Usage: $0 [positive-iterations] [--fast] [--skip-verify]"
  echo "  Default iterations: 10"
  echo "  --fast       skip slow stages (pnpm verify)"
  echo "  --skip-verify skip full pnpm verify (alias for --fast)"
  exit 2
fi

KEEP="${KEEP_TEST_SCHEMAS:-0}"
LOG_DIR="$(mktemp -d)"
PASS_COUNT=0
FAIL_COUNT=0

cleanup() {
  if [ "$KEEP" != "1" ] && [ "$KEEP" != "true" ]; then
    echo "=== Schema cleanup ==="
    bash scripts/db/drop-test-schemas.sh 2>&1 | sed -n '1,5p'
  fi
  rm -rf "$LOG_DIR"
}
trap cleanup EXIT
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM

echo "=============================================="
echo " DB Isolation Stress Test"
echo " Iterations: $ITERATIONS"
echo " Fast mode:  $FAST_MODE"
echo " Keep schemas: $KEEP"
echo "=============================================="
echo ""

total_start=$(date +%s)

# ---- record result helper ----
record() {
  local stage="$1"
  local result="$2"
  local run="$3"
  if [ "$result" = "PASS" ]; then
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    FAIL_COUNT=$((FAIL_COUNT + 1))
    echo "FAIL: [$stage] run $run/$ITERATIONS"
    echo "  See log: $LOG_DIR/${stage//\//_}_run_${run}.log"
  fi
}

# ---- stage: preflight ----
echo "=== Stage 0: Preflight (isolation helper self-test) ==="
LOGFILE="$LOG_DIR/preflight.log"
if pnpm --filter @exam/db test -- --run src/testIsolation.test.ts > "$LOGFILE" 2>&1; then
  echo "  testIsolation.test.ts: PASS"
else
  echo "  testIsolation.test.ts: FAIL — aborting (isolation helper must pass)"
  cat "$LOGFILE"
  exit 1
fi

# ---- stage 1: deadline scanner repeated run (BUG-FLAKE-001/003) ----
echo ""
echo "=== Stage 1: Deadline scanner repeated run ==="
for i in $(seq 1 "$ITERATIONS"); do
  LOGFILE="$LOG_DIR/deadline_scanner_run_${i}.log"
  if pnpm --filter @exam/api test -- --run src/routes/attempts.test.ts -t "deadline scanner" > "$LOGFILE" 2>&1; then
    echo "  [$i/$ITERATIONS] deadline scanner: PASS"
    record "deadline_scanner" "PASS" "$i"
  else
    echo "  [$i/$ITERATIONS] deadline scanner: FAIL"
    record "deadline_scanner" "FAIL" "$i"
    if [ "$FAIL_COUNT" -gt 3 ]; then
      echo "ABORT: too many failures in deadline scanner stage"
      cat "$LOGFILE"
      exit 1
    fi
  fi
done

# ---- stage 2: heartbeat/disrupted scanner repeated run (BUG-FLAKE-001) ----
echo ""
echo "=== Stage 2: Heartbeat/disrupted scanner repeated run ==="
for i in $(seq 1 "$ITERATIONS"); do
  LOGFILE="$LOG_DIR/heartbeat_scanner_run_${i}.log"
  if pnpm --filter @exam/api test -- --run src/routes/attempts.test.ts -t "heartbeat scanner|disrupted" > "$LOGFILE" 2>&1; then
    echo "  [$i/$ITERATIONS] heartbeat scanner: PASS"
    record "heartbeat_scanner" "PASS" "$i"
  else
    echo "  [$i/$ITERATIONS] heartbeat scanner: FAIL"
    record "heartbeat_scanner" "FAIL" "$i"
    if [ "$FAIL_COUNT" -gt 3 ]; then
      echo "ABORT: too many failures in heartbeat scanner stage"
      cat "$LOGFILE"
      exit 1
    fi
  fi
done

# ---- stage 3: tenant isolation pollution run (BUG-FLAKE-004) ----
if [ "$FAST_MODE" = false ]; then
  echo ""
  echo "=== Stage 3: Tenant isolation pollution run ==="
  for i in $(seq 1 "$ITERATIONS"); do
    LOGFILE="$LOG_DIR/tenant_pollution_run_${i}.log"
    if pnpm --filter @exam/api test -- --run \
      apps/api/tests/security/tenant-isolation.test.ts \
      src/routes/exam.test.ts \
      src/routes/permissionBoundary.test.ts > "$LOGFILE" 2>&1; then
      echo "  [$i/$ITERATIONS] tenant pollution: PASS"
      record "tenant_pollution" "PASS" "$i"
    else
      echo "  [$i/$ITERATIONS] tenant pollution: FAIL"
      record "tenant_pollution" "FAIL" "$i"
      if [ "$FAIL_COUNT" -gt 3 ]; then
        echo "ABORT: too many failures in tenant pollution stage"
        cat "$LOGFILE"
        exit 1
      fi
    fi
  done
else
  echo "=== Stage 3: Skipped (--fast) ==="
fi

# ---- stage 4: Cross-package concurrent DB task run (BUG-FLAKE-002) ----
if [ "$FAST_MODE" = false ]; then
  echo ""
  echo "=== Stage 4: Cross-package concurrent DB tasks ==="
  for i in $(seq 1 "$ITERATIONS"); do
    LOGFILE="$LOG_DIR/cross_package_run_${i}.log"
    # NOTE: verify:db-tests is serial (test:db && test:api && coverage:db && coverage:api).
    # To test actual turbo-level concurrency we bypass the serial chain:
    if env TURBO_FORCE=true pnpm turbo run test coverage --filter=@exam/db --filter=@exam/api > "$LOGFILE" 2>&1; then
      echo "  [$i/$ITERATIONS] cross-package: PASS"
      record "cross_package" "PASS" "$i"
    else
      echo "  [$i/$ITERATIONS] cross-package: FAIL"
      record "cross_package" "FAIL" "$i"
      if [ "$FAIL_COUNT" -gt 3 ]; then
        echo "ABORT: too many failures in cross-package stage"
        cat "$LOGFILE"
        exit 1
      fi
    fi
  done
else
  echo "=== Stage 4: Skipped (--fast) ==="
fi

# ---- stage 5: @exam/db isolated test run ----
echo ""
echo "=== Stage 5: @exam/db tests ==="
LOGFILE="$LOG_DIR/db_tests.log"
if pnpm --filter @exam/db test > "$LOGFILE" 2>&1; then
  echo "  @exam/db tests: PASS"
  record "db_tests" "PASS" 1
else
  echo "  @exam/db tests: FAIL"
  record "db_tests" "FAIL" 1
  tail -50 "$LOGFILE"
fi

# ---- stage 6: @exam/api tests ----
echo ""
echo "=== Stage 6: @exam/api tests ==="
LOGFILE="$LOG_DIR/api_tests.log"
if pnpm --filter @exam/api test > "$LOGFILE" 2>&1; then
  echo "  @exam/api tests: PASS"
  record "api_tests" "PASS" 1
else
  echo "  @exam/api tests: FAIL"
  record "api_tests" "FAIL" 1
  tail -50 "$LOGFILE"
fi

# ---- stage 7: pnpm verify ----
if [ "$SKIP_VERIFY" = false ] && [ "$FAST_MODE" = false ]; then
  echo ""
  echo "=== Stage 7: pnpm verify (no-cache) ==="
  for i in $(seq 1 "$ITERATIONS"); do
    LOGFILE="$LOG_DIR/verify_run_${i}.log"
    if env TURBO_FORCE=true pnpm verify > "$LOGFILE" 2>&1; then
      echo "  [$i/$ITERATIONS] pnpm verify: PASS"
      record "verify" "PASS" "$i"
    else
      echo "  [$i/$ITERATIONS] pnpm verify: FAIL"
      record "verify" "FAIL" "$i"
      if [ "$FAIL_COUNT" -gt 1 ]; then
        echo "ABORT: pnpm verify failure"
        tail -100 "$LOGFILE"
        exit 1
      fi
    fi
  done
else
  echo "=== Stage 7: Skipped (--skip-verify or --fast) ==="
fi

# ---- schema leak check ----
echo ""
echo "=== Schema leak check ==="
SCHEMA_COUNT=$(psql "${DATABASE_URL:-postgresql://exam:exam@localhost:5432/exam_test}" -t -A \
  -c "SELECT count(*) FROM information_schema.schemata WHERE schema_name LIKE 'test_%';" 2>/dev/null || echo "UNKNOWN")
echo "  Remaining test_* schemas: $SCHEMA_COUNT"

if [ "$KEEP" = "1" ] || [ "$KEEP" = "true" ]; then
  echo "  (KEEP_TEST_SCHEMAS=1, not cleaning)"
  bash scripts/db/list-test-schemas.sh
fi

# ---- report ----
total_end=$(date +%s)
duration=$((total_end - total_start))

echo ""
echo "=============================================="
echo " Stress Test Results"
echo " Duration: ${duration}s"
echo " Total checkpoints: $((PASS_COUNT + FAIL_COUNT))"
echo " Passed:  $PASS_COUNT"
echo " Failed:  $FAIL_COUNT"
echo "=============================================="

if [ "$FAIL_COUNT" -gt 0 ]; then
  echo ""
  echo "FAILURES DETECTED — review logs in: $LOG_DIR"
  exit 1
fi

echo ""
echo "ALL STRESS TESTS PASSED"
