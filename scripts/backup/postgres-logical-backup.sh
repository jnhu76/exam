#!/usr/bin/env bash
# P7-C2 PostgreSQL logical online backup helper.
#
# Takes an internally consistent PostgreSQL backup while Exam is running,
# using PostgreSQL-native pg_dump in custom format (-Fc). Custom format is
# the default preference (C2.1) because it gives: an online consistent
# snapshot, a portable logical representation, pg_restore support, and
# better version portability than raw PGDATA. It is NOT a physical backup
# and NOT PITR.
#
# This is the routine backup users are most likely to want: PostgreSQL
# remains online and the dump is internally consistent. Recommend the
# logical path for routine backups unless cold-copy simplicity is preferred.
#
# Requirements (C2.2):
#   - connects to the authoritative PostgreSQL DB via the db container
#   - creates a timestamped custom-format dump (-Fc)
#   - fails non-zero on error
#   - writes to an operator-selected destination (a .dump file path)
#   - does NOT expose the DB password in logs (uses PGPASSWORD env, never argv)
#   - does NOT claim success for an empty/partial artifact (size + magic check)
#   - works when the API is DOWN but PostgreSQL is UP (runs via the db container)
#
# Backup destination should be another failure domain (NAS / another server /
# a separate disk). This script does not enforce that.
#
# Usage:
#   ./postgres-logical-backup.sh <COMPOSE_PROJECT> <DEST_DUMP_PATH>
# Example:
#   ./postgres-logical-backup.sh exam /mnt/nas/exam-logical/2026-08-10.dump
#
# Where <COMPOSE_PROJECT> is the Compose project name (so the script can
# address the <project>-db-1 container). For the default production stack
# started from the repo root with no -p flag, the project name is the
# directory name (usually "exam").
set -euo pipefail

print_usage() {
  cat >&2 <<'EOF'
Usage: postgres-logical-backup.sh <COMPOSE_PROJECT> <DEST_DUMP_PATH>

  COMPOSE_PROJECT  the Compose project name (addresses <project>-db-1).
  DEST_DUMP_PATH   the output .dump file path (operator-selected). Parent
                   directory must exist; the file must not exist yet.

PostgreSQL remains ONLINE during this backup (internally consistent
snapshot). The DB password is read from PGPASSWORD if set, otherwise the
connection relies on the container's trust/local auth (the bundled compose
path). The password is NEVER passed on the argv (avoids process-list / log
leakage). Works when the API is down but PostgreSQL is up.
EOF
}

if [ "$#" -ne 2 ]; then
  print_usage
  exit 2
fi

PROJECT="$1"
DEST="$2"

if [ -z "${PROJECT}" ] || [ -z "${DEST}" ]; then
  echo "FAIL: COMPOSE_PROJECT and DEST_DUMP_PATH must be non-empty." >&2
  exit 2
fi
case "${DEST}" in
  /|/etc|/usr|/bin|/sbin|/boot|/proc|/sys|/dev)
    echo "FAIL: DEST_DUMP_PATH '${DEST}' is a system path; refusing." >&2
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

# Confirm PostgreSQL is reachable (db up). The API does NOT need to be up.
if ! docker exec "${DB_CONTAINER}" pg_isready -U exam -d exam >/dev/null 2>&1; then
  echo "FAIL: PostgreSQL is not ready in ${DB_CONTAINER}." >&2
  echo "       This backup requires PostgreSQL to be UP (the API may be down)." >&2
  exit 2
fi

echo "Logical online backup (pg_dump -Fc):"
echo "  source: ${DB_CONTAINER} (db exam)"
echo "  destination: ${DEST}"
echo "  PostgreSQL remains ONLINE; API availability is not required."

# Run pg_dump INSIDE the db container (so it uses the container's local auth
# and the bundled POSTGRES_USER/POSTGRES_DB env). -Fc = custom format
# (built-in compression, pg_restore support, better version portability than
# raw PGDATA). --no-owner keeps the dump portable across roles/owners. The
# password is never on the argv: the container's POSTGRES_PASSWORD is already
# in the postgres user's environment via ~/.pgpass-free trust for local
# connections; if PGPASSWORD is exported on the host it is passed through to
# the exec environment explicitly (still not on argv).
TS="$(date -u +%Y%m%dT%H%M%SZ)"
docker exec \
  -e PGPASSWORD="${PGPASSWORD:-}" \
  "${DB_CONTAINER}" \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner' \
  > "${DEST}"

# ── Verification (C2.4): do not equate "pg_dump exited 0" with "restore proven". ──
# At minimum: artifact exists, non-empty, and pg_restore --list succeeds
# (proves the archive is a readable custom-format dump). The true proof is a
# clean-restore drill (C2.5), run separately.
if [ ! -s "${DEST}" ]; then
  echo "FAIL: backup artifact is empty — pg_dump produced no output." >&2
  rm -f "${DEST}" 2>/dev/null || true
  exit 1
fi

# Custom-format dump magic: the first 5 bytes are "PGDMP". This catches the
# case where stdout captured an error message instead of a real dump.
MAGIC="$(head -c 5 "${DEST}" 2>/dev/null || true)"
if [ "${MAGIC}" != "PGDMP" ]; then
  echo "FAIL: artifact does not start with the 'PGDMP' custom-format magic." >&2
  echo "       The captured stream may be an error message, not a dump." >&2
  rm -f "${DEST}" 2>/dev/null || true
  exit 1
fi

# pg_restore --list proves the archive is structurally readable. Feed the
# artifact into the container via stdin (-i keeps stdin attached). Capture
# output to a temp file so failure context is preserved (no || true).
LIST_OUT="$(mktemp -t pgdump-list-XXXXXX)"
trap 'rm -f "${LIST_OUT}"' EXIT
if ! docker exec -i -e PGPASSWORD="${PGPASSWORD:-}" "${DB_CONTAINER}" \
  pg_restore --list < "${DEST}" > "${LIST_OUT}" 2>&1; then
  echo "FAIL: pg_restore --list failed — the archive is not readable." >&2
  echo "       --- pg_restore --list output ---" >&2
  cat "${LIST_OUT}" >&2
  rm -f "${DEST}" 2>/dev/null || true
  exit 1
fi

SIZE="$(du -h "${DEST}" | cut -f1)"
echo ""
echo "Logical backup COMPLETE."
echo "  artifact: ${DEST} (${SIZE})"
echo "  format:   PostgreSQL custom (-Fc), --no-owner"
echo "  verification: non-empty + PGDMP magic + pg_restore --list OK"
echo ""
echo "  IMPORTANT: backup creation is not restore proof. Run a clean-restore"
echo "  drill (postgres-logical-restore.sh + p7-c2-logical-restore-drill.sh)"
echo "  before relying on this artifact for recovery."
echo "  Store this artifact on an INDEPENDENT failure domain (NAS / another"
echo "  server / a separate disk)."
