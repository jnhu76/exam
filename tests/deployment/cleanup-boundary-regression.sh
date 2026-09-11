#!/usr/bin/env bash
# Cleanup-boundary regression (#462 / BB-008): a MANDATORY temp-root
# cleanup whose success is required for later assertions must fail AT THE
# CLEANUP BOUNDARY when its helper cannot run — never swallow the failure
# and let the suite continue into a "fresh install" against stale,
# container-owned PGDATA (which historically surfaced as a misleading
# downstream app-health failure).
#
# Historical chain (helper image alpine not cached locally → pull →
# credential-helper failure in WSL → `docker run` never runs → guarded by
# `|| true` inside cleanup_temp_root → stale uid-999 PGDATA remained →
# fresh-install phase ran anyway on stale state).
#
# Mechanism of the deterministic unavailable-helper simulation: point
# CLEANUP_HELPER_IMAGE at a nonexistent image. With --pull=never the
# helper run fails instantly and locally — no registry contact, no
# credential lookup, real Docker credentials untouched, fully disposable.
#
# Cases:
#   A (mandatory, helper unavailable)  driver mirroring the upgrade/
#      uninstall [delete] call pattern must exit AT the cleanup boundary
#      and MUST NOT reach its fresh-install marker.
#   B (control, helper available)      the same driver completes: root
#      removed, marker reached.
#   C (best-effort, helper unavailable) cleanup_temp_root stays non-fatal,
#      emits the WARN diagnostic, leaves the root in place — the
#      classification boundary is real, not everything fatal.
#   D (registry guard)                 remove_temp_root refuses a path
#      safe_temp_root never registered (loud, never a silent no-op).
#
# Fixture precondition: ${PG_IMAGE} (the deployment's own postgres image,
# from docker-compose.yml) must be available locally for fixture creation
# — true on any machine that has run a deployment suite or dev stack; the
# suite may pull it once as SETUP (the semantic steps never pull).
#
# Usage: ./cleanup-boundary-regression.sh
set -euo pipefail

SCRIPT_DIR="$(
  cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1
  pwd
)"
# shellcheck source=lib.sh
source "${SCRIPT_DIR}/lib.sh"

RUN_TS="$(date +%s)"
MISSING_HELPER="exam-no-such-helper:missing-${RUN_TS}"

# The driver subshells below can die before their own hygiene (that is
# literally case A), so sweep this regression's tmp prefixes with the real
# helper both before (stale leftovers must not fake-fail the marker
# checks) and after the run. Scoped to the prefixes only.
sweep_leaked_roots() {
  docker run --rm --pull=never -v /tmp:/tmproot "${PG_IMAGE}" \
    sh -c 'rm -rf /tmproot/m462driver-* /tmproot/m462besteffort-* /tmproot/m462unreg-* 2>/dev/null || true' \
    >/dev/null 2>&1 || true
}

# The [delete]-leg call pattern, verbatim semantics: mandatory cleanup,
# refuse-to-continue on failure, fresh-install stage only after success.
# Arg 1: the CLEANUP_HELPER_IMAGE the cleanup must use.
# Exit 0 = fresh-install stage reached (marker written); exit 7 = refused
# at the cleanup boundary.
driver_delete_leg() {
  local helper="$1"
  (
    set -euo pipefail
    safe_temp_root m462driver root
    # uid-999 content: what makes host-side rm impossible and the helper
    # container mandatory.
    docker run --rm -v "${root}:/d" "${PG_IMAGE}" sh -c '
      mkdir -p /d/postgres && echo x > /d/postgres/PG_VERSION
      chown -R 999:999 /d/postgres && chmod 700 /d/postgres
    ' >/dev/null
    export CLEANUP_HELPER_IMAGE="${helper}"
    if [ -d "${root}" ]; then
      remove_temp_root "${root}" || {
        echo "[delete] FAIL: mandatory data-root cleanup failed;"
        echo "        NOT entering the fresh-install stage on stale state."
        exit 7
      }
    fi
    printf 'fresh-install stage would run now' > "${root}.marker"
    exit 0
  )
}

markers_present() {
  ls /tmp/m462driver-*.marker >/dev/null 2>&1
}

echo "=== Cleanup-boundary regression (ts ${RUN_TS}) ==="
sweep_leaked_roots

echo "--- A: mandatory cleanup with UNAVAILABLE helper must fail at the boundary ---"
OUT_A="$(driver_delete_leg "${MISSING_HELPER}" 2>&1)" && A_EXIT=0 || A_EXIT=$?
if [ "${A_EXIT}" -eq 0 ] || markers_present; then
  echo "  FAIL: fresh-install stage was reached on failed mandatory cleanup." >&2
  echo "  driver exit=${A_EXIT}; marker present: $(markers_present && echo yes || echo no)" >&2
  echo "  driver output: ${OUT_A}" >&2
  sweep_leaked_roots
  exit 1
fi
echo "${OUT_A}" | command grep -q "mandatory cleanup could not remove" \
  || { echo "  FAIL: missing cleanup-boundary diagnostic."; echo "${OUT_A}"; sweep_leaked_roots; exit 1; }
echo "${OUT_A}" | command grep -q "NOT entering the fresh-install stage" \
  || { echo "  FAIL: missing refusal diagnostic."; echo "${OUT_A}"; sweep_leaked_roots; exit 1; }
sweep_leaked_roots
echo "  PASS: exit=${A_EXIT} at the cleanup boundary; fresh install NOT executed;"
echo "        diagnostics name the operation, authority, and refusal."

echo "--- B (control): mandatory cleanup with AVAILABLE helper completes ---"
OUT_B="$(driver_delete_leg "${CLEANUP_HELPER_IMAGE}" 2>&1)" && B_EXIT=0 || B_EXIT=$?
if [ "${B_EXIT}" -ne 0 ] || ! markers_present; then
  echo "  FAIL: control driver did not complete (exit=${B_EXIT})." >&2
  echo "  driver output: ${OUT_B}" >&2
  sweep_leaked_roots
  exit 1
fi
sweep_leaked_roots
echo "  PASS: root removed container-side; fresh-install stage reached."

echo "--- C: BEST-EFFORT cleanup with unavailable helper stays non-fatal + diagnostic ---"
(
  set -euo pipefail
  safe_temp_root m462besteffort root
  docker run --rm -v "${root}:/d" "${PG_IMAGE}" sh -c '
    mkdir -p /d/postgres && echo x > /d/postgres/PG_VERSION
    chown -R 999:999 /d/postgres && chmod 700 /d/postgres
  ' >/dev/null
  export CLEANUP_HELPER_IMAGE="${MISSING_HELPER}"
  OUT_C="$(cleanup_temp_root "${root}" 2>&1)"
  [ -d "${root}" ] || { echo "  FAIL: expected the root to remain."; exit 1; }
  echo "${OUT_C}" | command grep -q "container-assisted removal failed" \
    || { echo "  FAIL: missing best-effort WARN diagnostic."; exit 1; }
)
echo "  PASS: best-effort classification unchanged (non-fatal, WARN, root left)."

echo "--- D: remove_temp_root refuses unregistered paths loudly ---"
(
  set -euo pipefail
  UNREGISTERED="$(mktemp -d -t m462unreg-XXXXXX)"
  if remove_temp_root "${UNREGISTERED}" >/dev/null 2>&1; then
    rmdir "${UNREGISTERED}"
    echo "  FAIL: unregistered path silently accepted." >&2
    exit 1
  fi
  rmdir "${UNREGISTERED}"
)
echo "  PASS: registry guard refuses unregistered paths."

sweep_leaked_roots
echo ""
echo "=== CLEANUP-BOUNDARY REGRESSION: ALL CHECKS PASSED ==="
