#!/usr/bin/env bash
# Persistence and cold-filesystem restore verification suite.
#
# Sections:
#   1. Container-recreation persistence — start → bootstrap first Admin +
#      probe row → record invariants → down → up (fresh containers, same
#      data root) → identical invariants.
#   2. Stopped-directory relocation — stop → copy the COMPLETE data root to
#      a second root (plain filesystem copy, no PostgreSQL tooling) → start
#      a NEW Compose project from the copy → identical invariants.
#   3. Cold-filesystem backup/restore round-trip — stopped deployment →
#      cold-filesystem-backup.sh → cold-filesystem-restore.sh into a fresh
#      root → start from the restored root → identical invariants.
#
# A backup/restore is not claimed successful until a fresh working
# deployment with the expected state is produced from it. All state lives
# in throwaway temp directories removed on exit (path-guarded). No
# human/dev database is touched.
#
# Usage: ./persistence-and-cold-restore.sh
set -euo pipefail

SCRIPT_DIR="$(
  cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1
  pwd
)"
# shellcheck source=lib.sh
source "${SCRIPT_DIR}/lib.sh"

BACKUP_SH="${REPO_ROOT}/scripts/backup/cold-filesystem-backup.sh"
RESTORE_SH="${REPO_ROOT}/scripts/backup/cold-filesystem-restore.sh"
if [ ! -f "${COMPOSE_FILE}" ] || [ ! -x "${BACKUP_SH}" ] || [ ! -x "${RESTORE_SH}" ]; then
  echo "FAIL: required scripts not found." >&2
  exit 1
fi

RUN_TS="$(date +%s)"
PROJECT_A="persist-a-${RUN_TS}"
PROJECT_B="persist-b-${RUN_TS}"
PROJECT_C="persist-c-${RUN_TS}"

ROOT_A="$(safe_temp_root persist-a)"
ROOT_B="$(safe_temp_root persist-b)"
ROOT_C="$(safe_temp_root persist-c)"
BACKUP_DIR_PARENT="$(safe_temp_root persist-bp)"
BACKUP_DIR="${BACKUP_DIR_PARENT}/backup-${RUN_TS}"

export POSTGRES_PASSWORD="persist-pg-${RUN_TS}-$(openssl rand -hex 8)"
export JWT_SECRET="persist-jwt-$(openssl rand -hex 16)"
ORIGIN="http://localhost:3000"
export CORS_ORIGIN="${ORIGIN}"
export PUBLIC_WEB_ORIGIN="${ORIGIN}"

ADMIN_USER="persistadmin"
ADMIN_PASS="Persist-Admin-$(openssl rand -hex 8)"
ADMIN_NAME="Persist Admin"
ORG_NAME="Persist Org"
PROBE_LABEL="persist-${RUN_TS}"

CREATED_DIRS=("${ROOT_A}" "${ROOT_B}" "${ROOT_C}" "${BACKUP_DIR_PARENT}")
PROJECTS=("${PROJECT_A}" "${PROJECT_B}" "${PROJECT_C}")

cleanup() {
  for proj in "${PROJECTS[@]}"; do
    compose_down_best_effort "${proj}"
  done
  # Remove ONLY the temp roots this script created (safe_temp_root
  # registry-checked; container-assisted because PGDATA files are owned by
  # the container postgres user).
  for d in "${CREATED_DIRS[@]}"; do
    cleanup_temp_root "${d}"
  done
}
trap cleanup EXIT

# Capture business invariants + probe label as one comparable digest.
capture_invariants() {
  local project="$1"
  local biz probe
  biz="$(capture_business_invariants "${project}")"
  probe="$(probe_label "${project}" persist_probe marker 1)"
  printf '%s|probe=%s\n' "${biz}" "${probe}"
}

start_stack() {
  local project="$1" root="$2"
  EXAM_DATA_ROOT="${root}" run_compose "${project}" up -d --quiet-pull >/dev/null
  wait_for_postgres "${project}"
  wait_for_app "${project}"
}

echo "=== Persistence + cold-filesystem restore suite (ts ${RUN_TS}) ==="

# ── 1. Container-recreation persistence ──────────────────────────────────
echo "--- 1. start deployment A; bootstrap; record invariants ---"
start_stack "${PROJECT_A}" "${ROOT_A}"
bootstrap_admin "${PROJECT_A}" "${ADMIN_USER}" "${ADMIN_PASS}" "${ADMIN_NAME}" "${ORG_NAME}"
write_probe "${PROJECT_A}" persist_probe marker 1 "${PROBE_LABEL}"
INV_A_FRESH="$(capture_invariants "${PROJECT_A}")"
echo "  invariants A (fresh): ${INV_A_FRESH}"

echo "--- 1. down then up (containers removed, data root retained) ---"
compose_down_best_effort "${PROJECT_A}"
start_stack "${PROJECT_A}" "${ROOT_A}"
INV_A_RESTART="$(capture_invariants "${PROJECT_A}")"
echo "  invariants A (restart): ${INV_A_RESTART}"
if [ "${INV_A_FRESH}" != "${INV_A_RESTART}" ]; then
  echo "  FAIL: container recreation changed invariants." >&2
  exit 1
fi
echo "  PASS: container-recreation persistence."

# ── 2. Stopped-directory relocation ──────────────────────────────────────
echo "--- 2. stop deployment A; copy COMPLETE data root to B (PostgreSQL stopped) ---"
compose_down_best_effort "${PROJECT_A}"
# The PGDATA files are owned by the container's postgres user and not
# readable by the host user, so the copy is container-assisted and preserves
# ownership/mode/symlinks — equivalent to `rsync -aHAX` or `tar` as root.
# ROOT_B is a temp dir this script created and owns; the helper container
# is removed (--rm).
docker run --rm \
  -v "${ROOT_A}:/from:ro" \
  -v "${ROOT_B}:/to" \
  alpine:latest \
  sh -c 'cp -a /from/. /to/'

echo "--- 2. start deployment B from the copied root (new project) ---"
start_stack "${PROJECT_B}" "${ROOT_B}"
INV_B="$(capture_invariants "${PROJECT_B}")"
echo "  invariants B (relocated): ${INV_B}"
if [ "${INV_A_FRESH}" != "${INV_B}" ]; then
  echo "  FAIL: cold relocation changed invariants." >&2
  exit 1
fi
echo "  PASS: stopped-directory relocation."

# ── 3. Cold-filesystem backup/restore round-trip ─────────────────────────
echo "--- 3. stop deployment B; cold-filesystem-backup.sh from ROOT_A ---"
compose_down_best_effort "${PROJECT_B}"
bash "${BACKUP_SH}" "${ROOT_A}" "${BACKUP_DIR}" 2>&1 | sed 's/^/    /'

echo "--- 3. cold-filesystem-restore.sh into a fresh root ---"
echo "RESTORE" | bash "${RESTORE_SH}" "${BACKUP_DIR}" "${ROOT_C}" 2>&1 | sed 's/^/    /'

echo "--- 3. start deployment C from the restored root ---"
start_stack "${PROJECT_C}" "${ROOT_C}"
INV_C="$(capture_invariants "${PROJECT_C}")"
echo "  invariants C (cold-restored): ${INV_C}"
if [ "${INV_A_FRESH}" != "${INV_C}" ]; then
  echo "  FAIL: cold backup/restore round-trip changed invariants." >&2
  exit 1
fi
echo "  PASS: cold-filesystem backup/restore round-trip."

# ── Bonus: PGDATA is operator-visible at ${EXAM_DATA_ROOT}/postgres ──────
echo "--- bonus: PGDATA operator-visibility via helper container ---"
if ! docker run --rm -v "${ROOT_C}/postgres:/pg:ro" alpine:latest \
  sh -c "test -f /pg/${PG_MAJOR}/docker/PG_VERSION && cat /pg/${PG_MAJOR}/docker/PG_VERSION"; then
  echo "  FAIL: PG_VERSION not visible at \${EXAM_DATA_ROOT}/postgres/${PG_MAJOR}/docker/PG_VERSION." >&2
  exit 1
fi
echo "  PASS: PGDATA is operator-visible at \${EXAM_DATA_ROOT}/postgres."

echo ""
echo "=== PERSISTENCE + COLD-FILESYSTEM SUITE: ALL CHECKS PASSED ==="
