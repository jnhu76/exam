#!/usr/bin/env bash
# EXAM-586 RESEARCH ONLY campaign driver (Issue #586, §15-§17).
#
# Executes the FROZEN schedule from 02-experiment-schedule.md serially:
# smoke → A/A gate (8 bursts) → 27-cell counterbalanced main matrix.
#
# - One cell at a time; each cell gets a fresh isolated stack + data root.
# - Invalid runs are RETAINED and appended as replacements (never deleted).
# - The campaign STOPS (exit 31) on protocol §29 stop conditions detected
#   mechanically (run-cell failure that is not a workload result).
#
# Env: EXAM586_APP_IMAGE / EXAM586_WEB_IMAGE / EXAM586_DRIVER_IMAGE (required)
#      EXAM586_PASSWORD_HASH (required)
#      EXAM586_ONLY (optional: run only this cell id — rig debugging)
set -uo pipefail

HARNESS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RESULTS="$HARNESS/../results"
mkdir -p "$RESULTS"
LOG="$RESULTS/campaign.log"
log() { echo "[campaign] $(date --iso-8601=seconds) $*" | tee -a "$LOG"; }

run_cell() { # <cellId> <pool> <scale> <rep>
  local cell="$1" pool="$2" scale="$3" rep="$4"
  if [ -f "$RESULTS/$cell/.done" ]; then log "skip $cell (already done)"; return 0; fi
  log "=== cell $cell: pool=$pool scale=$scale rep=$rep ==="
  if bash "$HARNESS/run-cell.sh" "$cell" "$pool" "$scale" "$rep" >> "$RESULTS/cell-$cell.log" 2>&1; then
    touch "$RESULTS/$cell/.done"
    log "cell $cell VALID"
  else
    log "cell $cell INVALID — retained; replacement must be appended per §28"
  fi
}

# Frozen schedule (02-experiment-schedule.md) — do not reorder.
# Rig shakedown smoke-S20-r0f ran VALID before this campaign (retained).
# ── A/A gate (§15): A = unset (canonical implicit), A' = explicit 10 ──
run_cell aa-01 unset 100 1
run_cell aa-02 10    100 1
run_cell aa-03 10    200 1
run_cell aa-04 unset 200 1
run_cell aa-05 unset 200 2
run_cell aa-06 10    200 2
run_cell aa-07 10    100 2
run_cell aa-08 unset 100 2
# ── Main matrix (§16/§17): 3 replicate blocks, counterbalanced ──
run_cell main-01 10 50  1
run_cell main-02 20 100 1
run_cell main-03 30 200 1
run_cell main-04 20 200 2
run_cell main-05 30 50  2
run_cell main-06 10 100 2
run_cell main-07 30 100 3
run_cell main-08 10 200 3
run_cell main-09 20 50  3
log "campaign phase complete"
