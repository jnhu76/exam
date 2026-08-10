#!/usr/bin/env bash
# Cold-filesystem restore helper.
#
# Restores a cold-filesystem backup (produced by cold-filesystem-backup.sh)
# into a fresh/isolated host data root, then lets the compatible PostgreSQL
# image start from it. This is filesystem-level cold restore — it is NOT
# pg_restore, NOT PITR, and NOT a cross-major PostgreSQL upgrade. Keep those
# concepts separate.
#
# Supported cold-restore flow (C1.7):
#   fresh isolated host/root
#       → compatible PostgreSQL runtime (same major version as the backup)
#       → restore the COMPLETE stopped PostgreSQL directory
#       → preserve/fix ownership and permissions
#       → docker compose up
#       → Exam business invariants match the backup state
#
# Safety:
#   - The destination must NOT already exist or must be empty. This script
#     refuses to overwrite an existing populated data root.
#   - It requires explicit confirmation.
#   - It copies the COMPLETE postgres tree (never partial relation files).
#
# Usage:
#   ./cold-filesystem-restore.sh <BACKUP_DIR> <DEST_EXAM_DATA_ROOT>
# Example:
#   # Restore into a fresh data root, then start Exam from it:
#   EXAM_DATA_ROOT=/opt/exam/data-fresh
#   ./cold-filesystem-restore.sh /mnt/nas/exam-backups/2026-08-10 "${EXAM_DATA_ROOT}"
#   EXAM_DATA_ROOT="${EXAM_DATA_ROOT}" docker compose up -d
set -euo pipefail

# Helper container: the deployment's OWN postgres image (pinned by
# docker-compose.yml and already present on any host that runs this
# deployment). It provides sh/cp/find for PGDATA validation and the
# container-assisted copy. There is deliberately NO separate helper image
# dependency.
HELPER_IMAGE="postgres:18.4-bookworm"

print_usage() {
  cat >&2 <<'EOF'
Usage: cold-filesystem-restore.sh <BACKUP_DIR> <DEST_EXAM_DATA_ROOT>

  BACKUP_DIR            the cold backup produced by cold-filesystem-backup.sh
                        (contains the postgres/ tree).
  DEST_EXAM_DATA_ROOT   a FRESH destination data root. Must not exist or be
                        empty; the script creates it. Start Exam afterwards
                        with EXAM_DATA_ROOT pointing here.

This restores the COMPLETE postgres directory; it does NOT perform partial
relation-file restore, pg_restore, PITR, or a cross-major PostgreSQL upgrade.
The restored PGDATA is tied to the PostgreSQL major version of the backup —
start it with a compatible postgres image.
EOF
}

if [ "$#" -ne 2 ]; then
  print_usage
  exit 2
fi

SRC="$1"
DEST_ROOT="$2"

validate_path() {
  local name="$1"
  local path="$2"
  if [ -z "${path}" ]; then
    echo "FAIL: ${name} is empty." >&2
    exit 2
  fi
  case "${path}" in
    /|/etc|/usr|/bin|/sbin|/boot|/proc|/sys|/dev)
      echo "FAIL: ${name} '${path}' is a system path; refusing." >&2
      exit 2
      ;;
  esac
}
validate_path "BACKUP_DIR" "${SRC}"
validate_path "DEST_EXAM_DATA_ROOT" "${DEST_ROOT}"

SRC_PG="${SRC}/postgres"
if [ ! -d "${SRC_PG}" ]; then
  echo "FAIL: backup postgres directory not found at ${SRC_PG}." >&2
  echo "       '${SRC}' does not look like a cold-filesystem backup." >&2
  exit 2
fi
# Validate the backup still looks like a PGDATA (helper container; the files
# are owned by the container postgres user and may not be host-readable).
if ! docker run --rm -v "${SRC_PG}:/from:ro" "${HELPER_IMAGE}" \
  sh -c 'find /from -maxdepth 3 -name PG_VERSION -print -quit 2>/dev/null | grep -q .'; then
  echo "FAIL: no PG_VERSION found under ${SRC_PG}; does not look like a PGDATA backup." >&2
  exit 2
fi

# Refuse to overwrite an existing populated destination.
if [ -e "${DEST_ROOT}" ]; then
  if [ -d "${DEST_ROOT}" ] && [ -z "$(ls -A "${DEST_ROOT}" 2>/dev/null || true)" ]; then
    : # empty existing directory is OK
  else
    echo "FAIL: destination '${DEST_ROOT}' already exists and is non-empty." >&2
    echo "       Refusing to overwrite a populated data root. Choose a fresh path." >&2
    exit 2
  fi
else
  DEST_PARENT="$(dirname "${DEST_ROOT}")"
  if [ ! -d "${DEST_PARENT}" ]; then
    echo "FAIL: destination parent '${DEST_PARENT}' does not exist." >&2
    exit 2
  fi
fi
mkdir -p "${DEST_ROOT}"

echo "Cold-filesystem restore:"
echo "  backup source: ${SRC_PG}"
echo "  destination:   ${DEST_ROOT}/postgres"
echo ""
echo "  This restores the COMPLETE postgres directory. It is NOT pg_restore,"
echo "  NOT PITR, and NOT a cross-major PostgreSQL upgrade. The restored"
echo "  PGDATA must be started with a compatible (same-major) postgres image."
echo "  Continue? [type RESTORE to confirm]"
read -r confirm
if [ "${confirm}" != "RESTORE" ]; then
  echo "Aborted."
  exit 1
fi

DEST_PG="${DEST_ROOT}/postgres"
mkdir -p "${DEST_PG}"

# Container-assisted copy preserves ownership/mode/symlinks (the PGDATA files
# are owned by the container postgres user). Equivalent to `rsync -aHAX` or
# `tar | tar` as root.
echo "Copying COMPLETE postgres tree from backup to destination..."
docker run --rm \
  -v "${SRC_PG}:/from:ro" \
  -v "${DEST_PG}:/to" \
  "${HELPER_IMAGE}" \
  sh -c 'cp -a /from/. /to/'

# Verify the restore landed.
if ! docker run --rm -v "${DEST_PG}:/to:ro" "${HELPER_IMAGE}" \
  sh -c 'find /to -maxdepth 3 -name PG_VERSION -print -quit 2>/dev/null | grep -q .'; then
  echo "FAIL: restore verification failed — PG_VERSION missing in destination." >&2
  exit 1
fi

echo ""
echo "Cold-filesystem restore COMPLETE."
echo "  restored to: ${DEST_PG}"
echo "  Next: start Exam from this data root with the SAME PostgreSQL major"
echo "  version and the SAME DB credentials the volume was initialized with:"
echo "    EXAM_DATA_ROOT='${DEST_ROOT}' \\"
echo "    POSTGRES_PASSWORD=<same-as-when-initialized> \\"
echo "    docker compose up -d"
echo "  The official postgres image fixes ownership/permissions of the PGDATA"
echo "  on container start; no host chmod is required."
echo "  Run your Exam business-invariant checks after start."
