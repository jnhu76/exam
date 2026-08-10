#!/usr/bin/env bash
# PostgreSQL logical restore helper (CLEAN target).
#
# Restores a pg_dump custom-format backup (produced by
# postgres-logical-backup.sh) into a CLEAN target database, then lets the
# application restart against it. This is logical restore — NOT PITR, NOT a
# cross-major PostgreSQL upgrade, and NOT a raw-PGDATA restore.
#
# Clean-target contract (C2.5 / fixes P2-3):
#   Never restore an old dump over a dirty/newer production database and call
#   it an exact historical restore. Restoring an older dump into an
#   already-newer database may leave objects that do not exist in the dump
#   unless the target is recreated/cleaned under an explicit restore contract.
#   This script enforces that contract: it DROPs the target database and
#   recreates it from template0 (a truly empty database with no local
#   additions) BEFORE pg_restore, so no target-only schema/data from the
#   previous database survives (it is a clean logical reconstruction of the
#   dumped state, NOT a merge). It is NOT a claim of physical byte identity —
#   a logical dump reconstructs the dumped database's logical schema/data under
#   the supported deployment contract.
#
# Safety (C2.6):
#   - Restore is OPERATOR-ONLY. There is no browser restore button and there
#     never will be (Phase 1 rule).
#   - A destructive restore requires an explicit target AND explicit
#     confirmation (type the target DB name).
#   - The restore does NOT depend on the application API being healthy; it
#     runs via the db container against PostgreSQL directly.
#
# Usage:
#   ./postgres-logical-restore.sh <COMPOSE_PROJECT> <DUMP_PATH> <TARGET_DB>
# Example (restore into the production 'exam' DB):
#   docker compose stop app email-worker
#   ./postgres-logical-restore.sh exam /mnt/nas/exam-logical/2026-08-10.dump exam
#   docker compose up -d app email-worker
set -euo pipefail

print_usage() {
  cat >&2 <<'EOF'
Usage: postgres-logical-restore.sh <COMPOSE_PROJECT> <DUMP_PATH> <TARGET_DB>

  COMPOSE_PROJECT  the Compose project name (addresses <project>-db-1).
  DUMP_PATH        the custom-format .dump artifact to restore.
  TARGET_DB        the database name to restore INTO. This database is DROPped
                   and recreated from template0 first (CLEAN target), so no
                   target-only schema/data from the previous database survives
                   (clean logical reconstruction of the dumped state — NOT a
                   merge).

This is a DESTRUCTIVE operation. The target database is dropped first. Stop
the API + worker before restoring (avoid writes during restore). The
application API is NOT required to be healthy — only PostgreSQL.
EOF
}

if [ "$#" -ne 3 ]; then
  print_usage
  exit 2
fi

PROJECT="$1"
DUMP="$2"
TARGET_DB="$3"

if [ -z "${PROJECT}" ] || [ -z "${DUMP}" ] || [ -z "${TARGET_DB}" ]; then
  echo "FAIL: all three arguments must be non-empty." >&2
  exit 2
fi
case "${TARGET_DB}" in
  postgres|template0|template1)
    echo "FAIL: refusing to DROP the system database '${TARGET_DB}'." >&2
    exit 2
    ;;
esac
# Conservative database-name contract: the target name is interpolated into
# SQL and shell commands, so it must be a plain PostgreSQL identifier
# (lowercase letters, digits, underscore; not starting with a digit). This
# prevents arbitrary operator text from reaching DDL or nested sh -c strings.
if ! printf '%s' "${TARGET_DB}" | grep -Eq '^[a-z_][a-z0-9_]*$'; then
  echo "FAIL: TARGET_DB '${TARGET_DB}' is not a conservative database name." >&2
  echo "       Use only lowercase letters, digits, and underscores (not" >&2
  echo "       starting with a digit)." >&2
  exit 2
fi
if [ ! -f "${DUMP}" ]; then
  echo "FAIL: dump artifact not found at ${DUMP}." >&2
  exit 2
fi
if [ ! -s "${DUMP}" ]; then
  echo "FAIL: dump artifact is empty." >&2
  exit 2
fi

DB_CONTAINER="${PROJECT}-db-1"
if ! docker inspect "${DB_CONTAINER}" >/dev/null 2>&1; then
  echo "FAIL: db container '${DB_CONTAINER}' not found (project '${PROJECT}')." >&2
  exit 2
fi

# Derive the actual deployment's PostgreSQL user/db from the RUNNING db
# container (NOT hardcoded).
DEPLOY_PG_USER="$(docker inspect "${DB_CONTAINER}" \
  --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | sed -n 's/^POSTGRES_USER=//p' | head -1)"
DEPLOY_PG_DB="$(docker inspect "${DB_CONTAINER}" \
  --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | sed -n 's/^POSTGRES_DB=//p' | head -1)"
DEPLOY_PG_USER="${DEPLOY_PG_USER:-exam}"
DEPLOY_PG_DB="${DEPLOY_PG_DB:-exam}"

if ! docker exec "${DB_CONTAINER}" pg_isready -U "${DEPLOY_PG_USER}" -d "${DEPLOY_PG_DB}" >/dev/null 2>&1; then
  echo "FAIL: PostgreSQL is not ready in ${DB_CONTAINER}." >&2
  exit 2
fi

echo "DESTRUCTIVE logical restore (CLEAN target):"
echo "  source dump: ${DUMP}"
echo "  target:      ${DB_CONTAINER} / database '${TARGET_DB}'"
echo ""
echo "  The target database '${TARGET_DB}' will be DROPped and recreated"
echo "  from template0, then the dump is restored into it. No target-only"
echo "  schema/data from the previous database survives — this is a clean"
echo "  logical reconstruction of the dumped state, NOT a merge. Any data"
echo "  currently in '${TARGET_DB}' is lost."
echo "  STOP the API + worker before continuing (avoid writes during restore)."
echo ""
echo "  Type the target database name to confirm: ${TARGET_DB}"
read -r confirm
if [ "${confirm}" != "${TARGET_DB}" ]; then
  echo "Aborted (confirmation did not match target DB name)."
  exit 1
fi

# ── Clean-target contract: DROP + recreate from template0, then pg_restore. ──
# postgresql.org/docs/18/app-pgdump.html: use template0 to ensure a truly
# empty database without local additions, preventing duplicate-definition
# errors during restore. This is the exact-historical-replacement contract
# that --clean --if-exists alone does NOT provide (it leaves objects absent
# from an older dump). TARGET_DB is passed as a psql variable and referenced
# with :"..." (quoted-identifier interpolation) so it can never inject SQL;
# the conservative name contract above additionally bounds it to a plain
# identifier.
echo "Dropping and recreating '${TARGET_DB}' from template0..."
# -i keeps stdin attached so the heredoc reaches psql inside the container.
docker exec -i -e PGPASSWORD="${PGPASSWORD:-}" "${DB_CONTAINER}" \
  sh -c 'psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 -v target_db="$1"' \
  sh "${TARGET_DB}" <<SQL
DROP DATABASE IF EXISTS :"target_db";
CREATE DATABASE :"target_db" TEMPLATE template0;
SQL

echo "Restoring dump into clean '${TARGET_DB}'..."
# pg_restore into the recreated database. --no-owner (matches the dump) so the
# restore is portable across the role that owns objects. --exit-on-error makes
# any restore error fail the script immediately (no partial silent restore).
# TARGET_DB is a plain identifier (validated above), safe to interpolate into
# the -d argument.
docker exec \
  -e PGPASSWORD="${PGPASSWORD:-}" \
  -i "${DB_CONTAINER}" \
  sh -c 'pg_restore -U "$POSTGRES_USER" -d '"${TARGET_DB}"' --no-owner --exit-on-error' \
  < "${DUMP}"

echo ""
echo "Logical restore COMPLETE into clean target '${TARGET_DB}'."
echo "  Restart the API + worker to use the restored database:"
echo "    docker compose up -d app email-worker"
echo "  Run your Exam business-invariant checks after restart."
