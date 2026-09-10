#!/usr/bin/env bash
# Cold-filesystem backup regression: the backup flow must work for a
# non-root operator when the artifact tree is container-postgres-owned
# (uid 999, mode 0700) — the condition of every real PGDATA (#456).
#
# Historical defect (BB-007): cold-filesystem-backup.sh measured the
# artifact size with a HOST-side `du -sb` under `set -euo pipefail`. The
# host operator cannot traverse the container-owned 0700 tree, `du` exits 1,
# the failed command substitution killed the script silently after the copy,
# and the persistence suite died between the copy and the evidence spool.
#
# This suite builds a PGDATA-shaped fixture THROUGH the container (same
# uid/mode as the real stack — never a world-readable fixture), proves the
# fixture is genuinely host-restricted, and requires the backup + evidence
# spool + restore round-trip to succeed. When the operator is root-like and
# the restriction cannot exist, the regression cannot witness anything and
# the suite reports SKIP instead of a false pass.
#
# Usage: ./cold-backup-restricted-tree.sh
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
safe_temp_root cold456 DATA_ROOT
safe_temp_root cold456bp BACKUP_PARENT
safe_temp_root cold456rs RESTORE_ROOT
BACKUP_DIR="${BACKUP_PARENT}/backup-${RUN_TS}"

CREATED_DIRS=("${DATA_ROOT}" "${BACKUP_PARENT}" "${RESTORE_ROOT}")
cleanup() {
  for d in "${CREATED_DIRS[@]}"; do
    cleanup_temp_root "${d}"
  done
}
trap cleanup EXIT

echo "=== Cold-backup restricted-tree regression (ts ${RUN_TS}) ==="

# ── Fixture: PGDATA-shaped tree created THROUGH the container, owned by
# uid 999 with mode 0700 directories / 0600 files — the real condition of a
# container-stack PGDATA, deliberately NOT host-readable.
echo "--- 1. build uid-999 / 0700 PGDATA fixture via container ---"
docker run --rm -v "${DATA_ROOT}:/d" alpine:latest sh -c '
  set -eu
  mkdir -p /d/postgres/'"${PG_MAJOR}"'/docker/base
  echo '"${PG_MAJOR}"' > /d/postgres/'"${PG_MAJOR}"'/docker/PG_VERSION
  echo "max_connections = 100" > /d/postgres/'"${PG_MAJOR}"'/docker/postgresql.conf
  head -c 4096 /dev/urandom > /d/postgres/'"${PG_MAJOR}"'/docker/base/payload
  chown -R 999:999 /d/postgres
  chmod 700 /d/postgres /d/postgres/'"${PG_MAJOR}"' /d/postgres/'"${PG_MAJOR}"'/docker
  chmod 600 /d/postgres/'"${PG_MAJOR}"'/docker/PG_VERSION /d/postgres/'"${PG_MAJOR}"'/docker/postgresql.conf
'

echo "--- 2. guard: the fixture must be genuinely host-restricted ---"
if du -sb "${DATA_ROOT}/postgres" >/dev/null 2>&1; then
  echo "SKIP: the uid-999 fixture is host-traversable for this operator" >&2
  echo "      (root-like operator or rootless-uid remapping). The #456" >&2
  echo "      regression requires a non-root host operator and cannot" >&2
  echo "      witness anything here — not a pass of the behavior under test." >&2
  exit 0
fi
echo "  confirmed: host du cannot traverse the fixture (non-root operator)."

echo "--- 3. cold-filesystem-backup.sh must COMPLETE (historically died at the host du) ---"
bash "${BACKUP_SH}" "${DATA_ROOT}" "${BACKUP_DIR}" 2>&1 | sed 's/^/    /'

echo "--- 4. evidence spool must carry the true container-measured size ---"
SPOOL="${BACKUP_DIR}/evidence.json"
if [ ! -f "${SPOOL}" ]; then
  echo "  FAIL: evidence spool missing at ${SPOOL}." >&2
  exit 1
fi
RECORDED_SIZE="$(sed -n 's/.*"artifactSizeBytes": \([0-9][0-9]*\).*/\1/p' "${SPOOL}")"
# The script measures du -sb over BACKUP_DIR BEFORE writing the spool; that
# historical value is not exactly reconstructible afterwards (creating the
# spool entry grows the tmpfs dir inode), so assert the sound bracket:
# the recorded size must cover the whole postgres subtree but cannot exceed
# the artifact dir as it exists now (spool included).
SUBTREE_DU="$(docker run --rm -v "${BACKUP_DIR}/postgres:/to:ro" alpine:latest \
  du -sb /to | cut -f1)"
TOTAL_NOW="$(docker run --rm -v "${BACKUP_DIR}:/to:ro" alpine:latest \
  du -sb /to | cut -f1)"
if [ -z "${RECORDED_SIZE}" ] || [ "${RECORDED_SIZE}" -eq 0 ]; then
  echo "  FAIL: artifactSizeBytes missing or zero in ${SPOOL}: ${RECORDED_SIZE}" >&2
  exit 1
fi
if [ "${RECORDED_SIZE}" -lt "${SUBTREE_DU}" ] || [ "${RECORDED_SIZE}" -gt "${TOTAL_NOW}" ]; then
  echo "  FAIL: recorded size ${RECORDED_SIZE} outside the sound bracket" >&2
  echo "        [postgres subtree ${SUBTREE_DU}, artifact dir now ${TOTAL_NOW}]." >&2
  exit 1
fi
echo "  PASS: artifactSizeBytes=${RECORDED_SIZE} within [${SUBTREE_DU}, ${TOTAL_NOW}]."

echo "--- 5. restore round-trip still validates the restricted backup ---"
echo "RESTORE" | bash "${RESTORE_SH}" "${BACKUP_DIR}" "${RESTORE_ROOT}" 2>&1 | sed 's/^/    /'
RESTORED_PG_VERSION="$(docker run --rm -v "${RESTORE_ROOT}/postgres:/pg:ro" alpine:latest \
  cat "/pg/${PG_MAJOR}/docker/PG_VERSION")"
if [ "${RESTORED_PG_VERSION}" != "${PG_MAJOR}" ]; then
  echo "  FAIL: restored PG_VERSION '${RESTORED_PG_VERSION}' != ${PG_MAJOR}." >&2
  exit 1
fi

echo ""
echo "=== COLD-BACKUP RESTRICTED-TREE REGRESSION: ALL CHECKS PASSED ==="
