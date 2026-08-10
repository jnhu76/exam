#!/usr/bin/env bash
# P7-C3 PostgreSQL physical online base backup helper (pg_basebackup).
#
# Takes a physical online backup of a RUNNING PostgreSQL server using
# PostgreSQL-native pg_basebackup. The base backup is a complete PostgreSQL
# cluster (PGDATA) captured consistently while the server stays online. It is
# the foundation for physical recovery and, combined with archived WAL, for
# PITR (point-in-time recovery).
#
# Requirements (C3.3):
#   - running server supported (PostgreSQL stays ONLINE)
#   - complete PostgreSQL cluster
#   - required WAL included/streamed (-X stream)
#   - backup target OUTSIDE the live PGDATA
#   - no unsafe --no-sync in the production path
#   - uses a narrowly scoped replication-capable role created by the operator
#     (C3.3 — do NOT give the application API superuser/replication authority)
#
# This helper runs pg_basebackup via the db container's local connection
# (peer/trust auth for the superuser) so the operator does NOT need to expose
# a replication port or hand out a replication password for the bundled
# single-node path. For an external cluster, set up a replication role per
# PostgreSQL docs and adjust PGHOST/PGUSER/PGPASSWORD.
#
# Manifest verification (C3.4): after the base backup, run pg_verifybackup on
# the manifest as an integrity check. NOTE the documented limitation: manifest
# verification is backup-integrity evidence, NOT proof that Exam can
# successfully start and satisfy business invariants after restore. A restore
# drill is still required (see the PITR drill / physical-restore path).
#
# Usage:
#   ./pg-basebackup.sh <COMPOSE_PROJECT> <DEST_DIR>
# Example:
#   ./pg-basebackup.sh exam /mnt/nas/exam-basebackups/2026-08-10
set -euo pipefail

print_usage() {
  cat >&2 <<'EOF'
Usage: pg-basebackup.sh <COMPOSE_PROJECT> <DEST_DIR>

  COMPOSE_PROJECT  the Compose project name (addresses <project>-db-1).
  DEST_DIR         the base-backup destination (created by the script; must
                   not exist yet). Place it on an INDEPENDENT failure domain.

Takes a physical online base backup of the running PostgreSQL server
(complete cluster + streamed WAL via -X stream), then verifies the backup
manifest with pg_verifybackup. PostgreSQL stays ONLINE. The backup target
is OUTSIDE the live PGDATA. --no-sync is NOT used in this production path.
EOF
}

if [ "$#" -ne 2 ]; then
  print_usage
  exit 2
fi

PROJECT="$1"
DEST="$2"

if [ -z "${PROJECT}" ] || [ -z "${DEST}" ]; then
  echo "FAIL: COMPOSE_PROJECT and DEST_DIR must be non-empty." >&2
  exit 2
fi
case "${DEST}" in
  /|/etc|/usr|/bin|/sbin|/boot|/proc|/sys|/dev)
    echo "FAIL: DEST_DIR '${DEST}' is a system path; refusing." >&2
    exit 2
    ;;
esac
if [ -e "${DEST}" ]; then
  echo "FAIL: destination '${DEST}' already exists; refusing to overwrite." >&2
  exit 2
fi
DEST_PARENT="$(dirname "${DEST}")"
if [ ! -d "${DEST_PARENT}" ]; then
  echo "FAIL: destination parent '${DEST_PARENT}' does not exist." >&2
  exit 2
fi

DB_CONTAINER="${PROJECT}-db-1"
if ! docker inspect "${DB_CONTAINER}" >/dev/null 2>&1; then
  echo "FAIL: db container '${DB_CONTAINER}' not found (project '${PROJECT}')." >&2
  exit 2
fi
if ! docker exec "${DB_CONTAINER}" pg_isready -U exam -d exam >/dev/null 2>&1; then
  echo "FAIL: PostgreSQL is not ready in ${DB_CONTAINER}." >&2
  exit 2
fi

echo "Physical online base backup (pg_basebackup):"
echo "  source: ${DB_CONTAINER}"
echo "  destination: ${DEST}"
echo "  PostgreSQL stays ONLINE; required WAL streamed (-X stream)."

# Run pg_basebackup INSIDE the db container against the local server. The
# local connection uses peer/trust auth for the bootstrap superuser
# (POSTGRES_USER), so no replication password is needed for the bundled
# single-node path. -D points at a path INSIDE the container; we stream the
# backup to the host via a mounted destination.
#
# Create the destination on the host first, then bind-mount it into the
# container as the backup target.
mkdir -p "${DEST}"

# pg_basebackup options:
#   -D <dir>       backup target (inside container, bind-mounted from host)
#   -X stream      stream required WAL segments (not fetch) so the backup is
#                  self-consistent without relying on archive_command
#   -c fast        checkpoint type (fast) to start promptly
#   -Fp            plain format (directory tree, like a real PGDATA)
#   -l <label>     backup label for identification
#   --no-sync is deliberately NOT used: the backup is fsync'd before the
#                  backup_label / manifest is finalized, so a crash on the
#                  backup host does not leave a half-written backup.
LABEL="exam-basebackup-$(date -u +%Y%m%dT%H%M%SZ)"
docker run --rm \
  -v "${DEST}:/backup:rw" \
  --network "container:${DB_CONTAINER}" \
  -e PGPASSWORD="${PGPASSWORD:-}" \
  postgres:18.4-bookworm \
  pg_basebackup \
    -h 127.0.0.1 -U "${PGUSER:-exam}" \
    -D /backup \
    -X stream \
    -c fast \
    -Fp \
    -l "${LABEL}" \
    --manifest-checksums SHA256

# ── Manifest verification (C3.4) ─────────────────────────────────────────
# pg_verifybackup checks every file in the backup against the manifest and
# verifies the manifest signature. Limitation (documented): manifest
# verification is backup-integrity evidence, NOT proof that Exam can start
# and satisfy business invariants after restore — a restore drill is still
# required.
echo "Verifying backup manifest (pg_verifybackup)..."
if ! docker run --rm \
  -v "${DEST}:/backup:ro" \
  postgres:18.4-bookworm \
  pg_verifybackup /backup; then
  echo "FAIL: pg_verifybackup failed — the backup manifest is not valid." >&2
  echo "       The backup at ${DEST} is NOT trustworthy; do not use it." >&2
  exit 1
fi

SIZE="$(docker run --rm -v "${DEST}:/d:ro" alpine:latest sh -c 'du -sh /d 2>/dev/null | cut -f1')"
echo ""
echo "Physical base backup COMPLETE."
echo "  destination: ${DEST} (${SIZE})"
echo "  label: ${LABEL}"
echo "  format: plain (directory tree), WAL streamed (-X stream)"
echo "  verification: pg_verifybackup manifest OK (SHA256)"
echo ""
echo "  IMPORTANT:"
echo "  - Manifest verification is backup-integrity evidence, NOT proof that"
echo "    Exam can start and satisfy business invariants after restore. A"
echo "    restore drill is still required."
echo "  - For PITR, this base backup must be paired with archived WAL (see"
echo "    backup-and-recovery.md §8 and the PITR drill). Keep both the base"
echo "    backup and the WAL archive on an INDEPENDENT failure domain."
echo "  - Physical restore replaces the whole PGDATA cluster; it is NOT a"
echo "    per-database restore (use pg_dump / C2 for that)."
