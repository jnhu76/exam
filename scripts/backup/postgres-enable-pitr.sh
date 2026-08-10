#!/usr/bin/env bash
# P7-C corrective pass — canonical operator command to enable PostgreSQL
# continuous WAL archiving (PITR capability).
#
# ONE-COMPOSE MODEL: this is the ONLY way to enable PITR. There is no
# docker-compose.pitr.yml, no separate PostgreSQL image, no rebuild. PITR
# is an optional PostgreSQL CLUSTER capability, not an alternate Docker
# topology. The mechanism is PostgreSQL-native `ALTER SYSTEM`, which
# persists into `postgresql.auto.conf` inside PGDATA — so the configuration
# survives `docker compose down` / `docker compose up` / host relocation of
# the same PGDATA. No separate configuration topology is needed.
#
# Contract (P7-C corrective pass §12-§16):
#   1. locate the canonical db container
#   2. require PostgreSQL healthy
#   3. make /wal-archive writable by the postgres user with RESTRICTIVE
#      permissions (NEVER chmod 777 — WAL contains database contents)
#   4. SHOW wal_level; require wal_level != minimal (replica is sufficient)
#   5. ALTER SYSTEM SET archive_mode = 'on'
#   6. ALTER SYSTEM SET archive_command = '<idempotent non-overwriting cmd>'
#   7. ALTER SYSTEM SET archive_timeout = '60s'
#   8. restart ONLY the db service
#   9. wait deterministically for PostgreSQL readiness
#  10. verify: SHOW archive_mode / archive_command / archive_timeout
#  11. force a WAL switch
#  12. wait for REAL archiver evidence (pg_stat_archiver archived_count
#      increases), NOT a fixed sleep
#  13. report PITR enabled only after archive proof succeeds
#
# archive_command idempotency (§15): PostgreSQL may retry archiving the
# same WAL segment. The command below is correct for all three cases
# (verified):
#   target absent                    → cp succeeds → exit 0
#   target exists + identical bytes  → cmp -s succeeds → exit 0
#   target exists + different bytes  → cmp -s fails → exit non-zero (FAILURE)
# This replaces the old `test ! -f target && cp source target` form, which
# would fail forever on an identical retry (target exists → non-zero).
#
# Usage:
#   ./postgres-enable-pitr.sh [COMPOSE_PROJECT] [COMPOSE_FILE]
# Example:
#   ./postgres-enable-pitr.sh                              # default project
#   ./postgres-enable-pitr.sh exam /path/to/docker-compose.yml
set -euo pipefail

SCRIPT_DIR="$(
  cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1
  pwd
)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"

# The idempotent, non-overwriting archive_command. %p = source WAL path,
# %f = WAL filename. Single-quoted because PostgreSQL interpolates %p/%f,
# not the shell. The `||` chain: copy when absent; otherwise compare;
# identical retry succeeds, byte-collision fails visibly.
ARCHIVE_COMMAND='test ! -f /wal-archive/%f && cp %p /wal-archive/%f || cmp -s %p /wal-archive/%f'
ARCHIVE_TIMEOUT='60s'

# Resolve project + compose file. Default project is the directory name of
# the repo root (the documented default for the bundled stack started with
# no -p flag). The compose file is the canonical docker-compose.yml.
PROJECT="${1:-$(basename "${REPO_ROOT}")}"
COMPOSE_FILE="${2:-${REPO_ROOT}/docker-compose.yml}"

if [ ! -f "${COMPOSE_FILE}" ]; then
  echo "FAIL: compose file not found at ${COMPOSE_FILE}." >&2
  exit 2
fi

DB_CONTAINER="${PROJECT}-db-1"
if ! docker inspect "${DB_CONTAINER}" >/dev/null 2>&1; then
  echo "FAIL: db container '${DB_CONTAINER}' not found." >&2
  echo "       Start the stack first: docker compose up -d" >&2
  exit 2
fi

# Derive the actual deployment's PostgreSQL user/db from the running
# container's environment (NOT hardcoded). The bundled Compose seeds these
# from POSTGRES_USER / POSTGRES_DB; mirror that truth.
PG_USER="$(docker inspect "${DB_CONTAINER}" \
  --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | sed -n 's/^POSTGRES_USER=//p' | head -1)"
PG_DB="$(docker inspect "${DB_CONTAINER}" \
  --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | sed -n 's/^POSTGRES_DB=//p' | head -1)"
PG_USER="${PG_USER:-exam}"
PG_DB="${PG_DB:-exam}"

psql_db() {
  # Run SQL inside the db container. $1 = SQL.
  docker exec "${DB_CONTAINER}" psql -v ON_ERROR_STOP=1 -U "${PG_USER}" -d "${PG_DB}" "$@"
}

wait_db() {
  for _ in $(seq 1 60); do
    if docker exec "${DB_CONTAINER}" pg_isready -U "${PG_USER}" -d "${PG_DB}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "FAIL: db never became ready in ${DB_CONTAINER}." >&2
  exit 1
}

echo "=== Enable PostgreSQL WAL archiving (PITR capability) ==="
echo "  project:       ${PROJECT}"
echo "  db container:  ${DB_CONTAINER}"
echo "  PG user/db:    ${PG_USER} / ${PG_DB}"
echo "  compose file:  ${COMPOSE_FILE}"
echo ""

# 2. require PostgreSQL healthy
wait_db

# 3. Make /wal-archive writable by the postgres user with RESTRICTIVE
#    permissions. WAL contains database contents and is sensitive. The
#    postgres container user is uid 70 (postgres:18-bookworm) inside the
#    image; chown the archive dir to that user and mode 0700. We run this
#    inside the db container so the chown targets the same uid the postgres
#    process runs as. NEVER chmod 777.
echo "--- prepare /wal-archive (restrictive permissions, postgres-owned) ---"
docker exec "${DB_CONTAINER}" sh -c '
  set -e
  mkdir -p /wal-archive
  chown postgres:postgres /wal-archive
  chmod 700 /wal-archive
  ls -ld /wal-archive
'

# 4. wal_level check: replica is already sufficient for PITR; minimal is
#    the only level that blocks it.
WAL_LEVEL="$(psql_db -tAc "SHOW wal_level;" | tr -d '[:space:]')"
if [ "${WAL_LEVEL}" = "minimal" ]; then
  echo "FAIL: wal_level is 'minimal' — PITR requires replica or higher." >&2
  echo "       Raise wal_level (e.g. ALTER SYSTEM SET wal_level = replica;" >&2
  echo "       then restart) before enabling WAL archiving." >&2
  exit 1
fi
echo "  PASS: wal_level='${WAL_LEVEL}' (sufficient for PITR)."

# Capture BEFORE archived_count so we can prove the archiver actually ran
# after the restart (not just that ALTER SYSTEM returned).
BEFORE_COUNT="$(psql_db -tAc "SELECT archived_count FROM pg_stat_archiver;" | tr -d '[:space:]')"
echo "  pg_stat_archiver.archived_count (before): ${BEFORE_COUNT}"

# 5-7. ALTER SYSTEM: archive_mode, archive_command, archive_timeout.
echo "--- ALTER SYSTEM SET archive_* ---"
psql_db -c "ALTER SYSTEM SET archive_mode = 'on';"
# archive_command must be single-quoted for PostgreSQL; embed it literally.
psql_db -c "ALTER SYSTEM SET archive_command = '${ARCHIVE_COMMAND}';"
psql_db -c "ALTER SYSTEM SET archive_timeout = '${ARCHIVE_TIMEOUT}';"

# 8. archive_mode is postmaster-level → restart ONLY the db service.
echo "--- restart db service (archive_mode is postmaster-level) ---"
docker compose -p "${PROJECT}" -f "${COMPOSE_FILE}" restart db >/dev/null

# 9. wait deterministically for readiness.
wait_db

# 10. verify the settings took effect.
echo "--- verify archive_* settings ---"
AMODE="$(psql_db -tAc "SHOW archive_mode;" | tr -d '[:space:]')"
ACMD="$(psql_db -tAc "SHOW archive_command;" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
ATIMEOUT="$(psql_db -tAc "SHOW archive_timeout;" | tr -d '[:space:]')"
echo "  archive_mode:     ${AMODE}"
echo "  archive_command:  ${ACMD}"
echo "  archive_timeout:  ${ATIMEOUT}"
if [ "${AMODE}" != "on" ]; then
  echo "FAIL: archive_mode is '${AMODE}', expected 'on' after restart." >&2
  exit 1
fi

# 11-12. Force a WAL switch and poll pg_stat_archiver for REAL evidence
# (archived_count increases and/or the expected segment exists). No fixed
# sleep; bounded deterministic polling.
echo "--- force WAL switch; wait for real archiver evidence ---"
SWITCHED_FILE="$(psql_db -tAc "SELECT pg_walfile_name(pg_switch_wal());" | tr -d '[:space:]')"
echo "  forced switch to segment: ${SWITCHED_FILE}"

PROVEN="no"
for _ in $(seq 1 30); do
  AFTER_COUNT="$(psql_db -tAc "SELECT archived_count FROM pg_stat_archiver;" | tr -d '[:space:]')"
  if [ "${AFTER_COUNT}" -gt "${BEFORE_COUNT}" ]; then
    PROVEN="yes"
    break
  fi
  # Also accept the specific segment existing in the archive as proof.
  if docker exec "${DB_CONTAINER}" test -f "/wal-archive/${SWITCHED_FILE}" 2>/dev/null; then
    PROVEN="yes"
    break
  fi
  sleep 1
done

if [ "${PROVEN}" != "yes" ]; then
  echo "FAIL: archiver did not produce evidence within the bounded window." >&2
  echo "       pg_stat_archiver before=${BEFORE_COUNT} after=${AFTER_COUNT}." >&2
  echo "       Expected segment ${SWITCHED_FILE} not found in /wal-archive." >&2
  echo "       Inspect: docker exec ${DB_CONTAINER} sh -c" >&2
  echo "         'SELECT * FROM pg_stat_archiver;'  (psql)" >&2
  echo "         'ls -la /wal-archive'" >&2
  exit 1
fi

AFTER_COUNT="$(psql_db -tAc "SELECT archived_count FROM pg_stat_archiver;" | tr -d '[:space:]')"
LAST_ARCHIVED="$(psql_db -tAc "SELECT last_archived_wal FROM pg_stat_archiver;" | tr -d '[:space:]')"
echo "  PASS: archiver produced real evidence."
echo "    archived_count: ${BEFORE_COUNT} → ${AFTER_COUNT}"
echo "    last_archived_wal: ${LAST_ARCHIVED}"

echo ""
echo "=== PITR WAL archiving ENABLED ==="
echo "  archive_mode persists in postgresql.auto.conf (survives down/up"
echo "  and host relocation of the same PGDATA)."
echo ""
echo "  NEXT STEPS for PITR:"
echo "  1. Take a base backup NOW (WAL archiving must be active BEFORE the"
echo "     base backup that anchors PITR):"
echo "       scripts/backup/pg-basebackup.sh ${PROJECT} <independent-path>/base-\$(date +%FT%H%M)"
echo "  2. Keep archiving WAL continuously."
echo "  3. Ensure EXAM_WAL_ARCHIVE_HOST_PATH points at an INDEPENDENT failure"
echo "     domain (NAS / another server / a separate disk). A WAL archive on"
echo "     the same disk as PGDATA dies with the disk."
echo "  4. No automatic retention is shipped — do not manually delete base"
echo "     backups or archived WAL required for the recovery window."
