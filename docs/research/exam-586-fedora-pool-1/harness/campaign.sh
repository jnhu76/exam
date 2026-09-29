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
run_cell smoke-S20-r0  unset 20 0   # rig shakedown, never treatment
# ...remaining schedule appended by the operator after smoke validation.
if [ -n "${EXAM586_ONLY:-}" ]; then
  case "$EXAM586_ONLY" in
    aa-*) run_cell "$EXAM586_ONLY" "${EXAM586_ONLY_POOL:-unset}" "${EXAM586_ONLY_SCALE:-100}" "${EXAM586_ONLY_REP:-1}" ;;
    *) log "unknown EXAM586_ONLY cell"; exit 2 ;;
  esac
fi
log "campaign phase complete"
