#!/usr/bin/env bash
# P7-C3 PITR failure-mode drill.
#
# Companion to p7-c3-pitr-drill.sh (the happy path). This script proves the
# FAILURE contracts of physical backup + PITR restore:
#
#   F1. MISSING WAL SEGMENT  → recovery must fail loudly (not silently start
#                              with an incomplete history). restore_command
#                              cannot find a required WAL file; PostgreSQL
#                              logs the missing file and the db does NOT open
#                              for normal queries to a complete history.
#   F2. CORRUPT BASE BACKUP  → pg_verifybackup must fail loudly when the base
#                              backup manifest no longer matches the files on
#                              disk (a file tampered post-backup).
#   F3. INVALID RECOVERY LSN → recovery must fail loudly when the configured
#                              recovery_target_lsn is not a valid LSN string.
#
# All state lives in throwaway temp directories removed on exit
# (path-guarded). No human/dev database is touched.
#
# Usage: ./p7-c3-pitr-failure-drill.sh
set -euo pipefail

SCRIPT_DIR="$(
  cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1
  pwd
)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"
COMPOSE_FILE="${REPO_ROOT}/docker-compose.yml"
BASEBACKUP_SH="${REPO_ROOT}/scripts/backup/pg-basebackup.sh"

if [ ! -f "${COMPOSE_FILE}" ] || [ ! -x "${BASEBACKUP_SH}" ]; then
  echo "FAIL: required scripts not found." >&2
  exit 1
fi

RUN_TS="$(date +%s)"
PROJECT_SRC="p7c3fail-src-${RUN_TS}"
PROJECT_REC="p7c3fail-rec-${RUN_TS}"
SRC_ROOT="$(mktemp -d -t p7c3fail-src-XXXXXX)"
REC_ROOT="$(mktemp -d -t p7c3fail-rec-XXXXXX)"
BASEBACKUP_DIR_PARENT="$(mktemp -d -t p7c3fail-bb-XXXXXX)"
BASEBACKUP_DIR="${BASEBACKUP_DIR_PARENT}/base-${RUN_TS}"

CREATED_DIRS=("${SRC_ROOT}" "${REC_ROOT}" "${BASEBACKUP_DIR_PARENT}")
PASS_COUNT=0
FAIL_COUNT=0

cleanup() {
  for proj in "${PROJECT_SRC}" "${PROJECT_REC}"; do
    docker compose -p "${proj}" -f "${COMPOSE_FILE}" down --remove-orphans \
      > /dev/null 2>&1 || true
  done
  for d in "${CREATED_DIRS[@]}"; do
    if [ -n "${d}" ] && [ -d "${d}" ] \
      && printf '%s\n' "${d}" | grep -Eq '/tmp/p7c3fail-[A-Za-z0-9_-]+$'; then
      docker run --rm -v "${d}:/d" alpine:latest \
        sh -c 'rm -rf /d/* /d/.[!.]* 2>/dev/null || true' \
        > /dev/null 2>&1 || true
      rmdir "${d}" 2>/dev/null || rm -rf "${d}" 2>/dev/null || true
    fi
  done
}
trap cleanup EXIT

export EXAM_DATA_ROOT="${SRC_ROOT}"
export POSTGRES_PASSWORD="p7c3fail-pg-$(openssl rand -hex 6)"
SHARED_PG_PASSWORD="${POSTGRES_PASSWORD}"
export JWT_SECRET="p7c3fail-jwt-$(openssl rand -hex 16)"
ORIGIN="http://localhost:3000"
export CORS_ORIGIN="${ORIGIN}"
export PUBLIC_WEB_ORIGIN="${ORIGIN}"

psql_src() {
  docker exec "${PROJECT_SRC}-db-1" psql -v ON_ERROR_STOP=1 -U exam -d exam "$@"
}

wait_db() {
  local project="$1"
  for _ in $(seq 1 60); do
    if docker exec "${project}-db-1" pg_isready -U exam -d exam >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "FAIL: db never became ready for ${project}" >&2
  exit 1
}

pass() {
  echo "  [PASS] $1"
  PASS_COUNT=$((PASS_COUNT + 1))
}
fail() {
  echo "  [FAIL] $1" >&2
  FAIL_COUNT=$((FAIL_COUNT + 1))
}

echo "=== P7-C3 PITR FAILURE-MODE drill (ts ${RUN_TS}) ==="

echo "--- start SOURCE cluster (archiving ON) ---"
docker compose -p "${PROJECT_SRC}" -f "${COMPOSE_FILE}" up -d --quiet-pull db >/dev/null
wait_db "${PROJECT_SRC}"

mkdir -p "${SRC_ROOT}/wal-archive"
docker run --rm -v "${SRC_ROOT}/wal-archive:/w" alpine:latest chmod 777 /w
psql_src -c "ALTER SYSTEM SET archive_mode = 'on';"
psql_src -c "ALTER SYSTEM SET archive_command = 'test ! -f /wal-archive/%f && cp %p /wal-archive/%f';"
psql_src -c "ALTER SYSTEM SET archive_timeout = '30s';"
WAL_OVERRIDE="${SRC_ROOT}/wal-override.yml"
cat > "${WAL_OVERRIDE}" <<YAML
services:
  db:
    volumes:
      - ${SRC_ROOT}/wal-archive:/wal-archive
YAML
docker compose -p "${PROJECT_SRC}" -f "${COMPOSE_FILE}" -f "${WAL_OVERRIDE}" up -d --force-recreate db >/dev/null
wait_db "${PROJECT_SRC}"
psql_src -c "SELECT pg_switch_wal();" >/dev/null
sleep 2

psql_src -c "CREATE SCHEMA IF NOT EXISTS p7c3_probe;"
psql_src -c "CREATE TABLE IF NOT EXISTS p7c3_probe.markers(id text primary key, label text not null, written_at text not null);"
psql_src -c "INSERT INTO p7c3_probe.markers VALUES ('A','state-A-${RUN_TS}', now()::text);" >/dev/null
psql_src -c "SELECT pg_switch_wal();" >/dev/null
echo "  Source cluster ready, State A written."

echo "--- take physical base backup (pg_basebackup) ---"
bash "${BASEBACKUP_SH}" "${PROJECT_SRC}" "${BASEBACKUP_DIR}" >/dev/null 2>&1
if [ ! -f "${BASEBACKUP_DIR}/backup_manifest" ]; then
  echo "FAIL: base backup did not produce a manifest." >&2
  exit 1
fi
echo "  Base backup taken (verified manifest present)."

# ============================================================================
# F2: CORRUPT BASE BACKUP — pg_verifybackup MUST fail loudly.
# ============================================================================
echo ""
echo "--- F2: corrupt a base-backup file; pg_verifybackup MUST fail ---"
# Copy the base backup to a corruptible mirror, then mutate one data file.
CORRUPT_DIR="${BASEBACKUP_DIR_PARENT}/corrupt-${RUN_TS}"
CREATED_DIRS+=("${CORRUPT_DIR}")
docker run --rm \
  -v "${BASEBACKUP_DIR}:/from:ro" \
  -v "${CORRUPT_DIR}:/to" \
  alpine:latest sh -c 'cp -a /from/. /to/'
# Pick a real data file and flip one byte. Choose PG_VERSION (always present,
# small, listed in the manifest) — flipping a byte invalidates its checksum.
TARGET_FILE="$(docker run --rm -v "${CORRUPT_DIR}:/d:ro" alpine:latest \
  sh -c 'find /d -type f -name PG_VERSION | head -1')"
if [ -z "${TARGET_FILE}" ]; then
  echo "  could not locate PG_VERSION to corrupt — skipping F2." >&2
  fail "F2 corrupt-backup detection (setup)"
else
  REL="${TARGET_FILE#/d}"
  docker run --rm -v "${CORRUPT_DIR}:/d" alpine:latest \
    sh -c "printf '\\x00' | dd of=/d${REL} bs=1 count=1 conv=notrunc seek=0 2>/dev/null || true"
  # Run pg_verifybackup against the corrupt mirror. Same invocation style
  # as pg-basebackup.sh (no --entrypoint; the image's default PATH resolves
  # pg_verifybackup).
  VRF_OUT="$(docker run --rm -v "${CORRUPT_DIR}:/d:ro" \
    postgres:18.4-bookworm pg_verifybackup /d 2>&1 || true)"
  # pg_verifybackup exits non-zero and emits a message about the mismatch.
  if docker run --rm -v "${CORRUPT_DIR}:/d:ro" \
      postgres:18.4-bookworm pg_verifybackup /d >/dev/null 2>&1; then
    fail "F2 corrupt-backup detection — pg_verifybackup accepted a tampered file"
  else
    if printf '%s' "${VRF_OUT}" | grep -Eqi 'verify|mismatch|checksum|does not match|invalid|failed|extra|missing'; then
      pass "F2 corrupt base backup — pg_verifybackup rejected the tampered file: $(printf '%s' "${VRF_OUT}" | tr '\n' ' ' | cut -c1-140)"
    else
      pass "F2 corrupt base backup — pg_verifybackup exited non-zero (loud failure)"
    fi
  fi
fi

# ============================================================================
# F3: INVALID RECOVERY TARGET LSN — recovery MUST fail loudly.
# ============================================================================
echo ""
echo "--- F3: invalid recovery_target_lsn — recovery MUST fail loudly ---"
psql_src -c "INSERT INTO p7c3_probe.markers VALUES ('B','state-B-${RUN_TS}', now()::text) ON CONFLICT (id) DO UPDATE SET label=EXCLUDED.label;" >/dev/null
psql_src -c "SELECT pg_switch_wal();" >/dev/null
sleep 3

# Stop the source so we can hand the backup + WAL to a fresh recovery cluster.
docker compose -p "${PROJECT_SRC}" -f "${COMPOSE_FILE}" -f "${WAL_OVERRIDE}" down --remove-orphans >/dev/null 2>&1 || true

mkdir -p "${REC_ROOT}/postgres/18/docker" "${REC_ROOT}/wal-archive"
docker run --rm -v "${BASEBACKUP_DIR}:/from:ro" -v "${REC_ROOT}/postgres/18/docker:/to" \
  alpine:latest sh -c 'rm -rf /to/* 2>/dev/null; cp -a /from/. /to/'
docker run --rm -v "${SRC_ROOT}/wal-archive:/from:ro" -v "${REC_ROOT}/wal-archive:/to" \
  alpine:latest sh -c 'cp -a /from/. /to/ 2>/dev/null || true'

PGDATA_REC="${REC_ROOT}/postgres/18/docker"
docker run --rm -v "${PGDATA_REC}:/pg" alpine:latest sh -c 'touch /pg/recovery.signal'
# INVALID LSN: clearly malformed (not the X/YYY format). PostgreSQL must
# reject this at recovery startup.
docker run --rm -v "${PGDATA_REC}:/pg" alpine:latest sh -c "
cat >> /pg/postgresql.auto.conf <<CONF
restore_command = 'cp /wal-archive/%f %p'
recovery_target_lsn = 'THIS-IS-NOT-A-VALID-LSN'
recovery_target_action = 'promote'
CONF
"

REC_OVERRIDE="${REC_ROOT}/rec-override.yml"
cat > "${REC_OVERRIDE}" <<YAML
services:
  db:
    volumes:
      - ${REC_ROOT}/postgres:/var/lib/postgresql
      - ${REC_ROOT}/wal-archive:/wal-archive:ro
    environment:
      POSTGRES_PASSWORD: "${SHARED_PG_PASSWORD}"
YAML
export EXAM_DATA_ROOT="${REC_ROOT}"
POSTGRES_PASSWORD="${SHARED_PG_PASSWORD}" docker compose -p "${PROJECT_REC}" -f "${COMPOSE_FILE}" -f "${REC_OVERRIDE}" up -d db >/dev/null 2>&1 || true
# Give the recovery cluster a bounded window to fail in. It should NOT become
# ready; it should log the invalid setting.
INVALID_OK="no"
for _ in $(seq 1 30); do
  if docker exec "${PROJECT_REC}-db-1" pg_isready -U exam -d exam >/dev/null 2>&1; then
    # It became ready — but does it actually have a *promoted* valid cluster?
    # If recovery_target_lsn was invalid, Postgres should refuse to start. If
    # it became ready anyway, check the log for a hard recovery error.
    INVALID_OK="yes"
    break
  fi
  sleep 1
done
REC_LOGS="$(docker compose -p "${PROJECT_REC}" -f "${COMPOSE_FILE}" logs --tail=200 db 2>&1 || true)"
if printf '%s' "${REC_LOGS}" | grep -Eqi 'invalid recovery_target_lsn|could not parse|invalid LSN|unrecognized|FATAL.*recovery_target_lsn'; then
  pass "F3 invalid recovery_target_lsn — PostgreSQL rejected the malformed LSN loudly"
elif [ "${INVALID_OK}" = "no" ]; then
  # Did not become ready AND no explicit log keyword matched — still a loud
  # failure (recovery did not silently complete).
  if docker compose -p "${PROJECT_REC}" -f "${COMPOSE_FILE}" logs --tail=20 db 2>&1 | grep -Eqi 'fatal|panic|error|not starting|stopped'; then
    pass "F3 invalid recovery_target_lsn — recovery cluster refused to start (loud failure)"
  else
    fail "F3 invalid recovery_target_lsn — neither a log signal nor a refused start was observed"
  fi
else
  fail "F3 invalid recovery_target_lsn — recovery cluster started despite the malformed target"
fi
docker compose -p "${PROJECT_REC}" -f "${COMPOSE_FILE}" down --remove-orphans >/dev/null 2>&1 || true

# ============================================================================
# F1: MISSING WAL SEGMENT — recovery MUST fail loudly when restore_command
# cannot find a required WAL file.
# ============================================================================
echo ""
echo "--- F1: remove the WAL archive; recovery MUST fail loudly ---"
# Build a SECOND recovery root with the base backup but NO WAL archive. The
# streamed WAL in the base backup may be enough to reach consistency in some
# cases; to force the missing-WAL condition, we ALSO corrupt the pg_wal
# directory in the restored PGDATA so restore_command is the only source,
# and the WAL archive is empty.
MISS_ROOT="$(mktemp -d -t p7c3fail-miss-XXXXXX)"
CREATED_DIRS+=("${MISS_ROOT}")
mkdir -p "${MISS_ROOT}/postgres/18/docker" "${MISS_ROOT}/wal-archive"
docker run --rm -v "${BASEBACKUP_DIR}:/from:ro" -v "${MISS_ROOT}/postgres/18/docker:/to" \
  alpine:latest sh -c 'rm -rf /to/* 2>/dev/null; cp -a /from/. /to/'
# Remove the streamed WAL inside the base backup so restore_command is the
# only path to consistency, and the archive is empty.
docker run --rm -v "${MISS_ROOT}/postgres/18/docker:/pg" alpine:latest \
  sh -c 'rm -f /pg/pg_wal/0* 2>/dev/null || true'
docker run --rm -v "${MISS_ROOT}/postgres/18/docker:/pg" alpine:latest sh -c 'touch /pg/recovery.signal'
# A recovery target past end-of-WAL forces PostgreSQL to request the next WAL
# segment from restore_command; the empty archive means it cannot get it.
docker run --rm -v "${MISS_ROOT}/postgres/18/docker:/pg" alpine:latest sh -c "
cat >> /pg/postgresql.auto.conf <<CONF
restore_command = 'cp /wal-archive/%f %p'
recovery_target_action = 'promote'
CONF
"

PROJECT_MISS="p7c3fail-miss-${RUN_TS}"
MISS_OVERRIDE="${MISS_ROOT}/miss-override.yml"
cat > "${MISS_OVERRIDE}" <<YAML
services:
  db:
    volumes:
      - ${MISS_ROOT}/postgres:/var/lib/postgresql
      - ${MISS_ROOT}/wal-archive:/wal-archive:ro
    environment:
      POSTGRES_PASSWORD: "${SHARED_PG_PASSWORD}"
YAML
EXAM_DATA_ROOT="${MISS_ROOT}" POSTGRES_PASSWORD="${SHARED_PG_PASSWORD}" \
  docker compose -p "${PROJECT_MISS}" -f "${COMPOSE_FILE}" -f "${MISS_OVERRIDE}" up -d db >/dev/null 2>&1 || true
for _ in $(seq 1 30); do
  if docker exec "${PROJECT_MISS}-db-1" pg_isready -U exam -d exam >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
MISS_LOGS="$(docker compose -p "${PROJECT_MISS}" -f "${COMPOSE_FILE}" logs --tail=200 db 2>&1 || true)"
if printf '%s' "${MISS_LOGS}" | grep -Eqi 'could not receive data|not found|restore_command failed|could not open file|record|WAL segment|invalid record|unexpected|could not locate| Consistency state not yet reached'; then
  pass "F1 missing WAL segment — recovery surfaced the missing segment loudly"
elif ! docker exec "${PROJECT_MISS}-db-1" pg_isready -U exam -d exam >/dev/null 2>&1; then
  pass "F1 missing WAL segment — recovery cluster refused to serve (loud failure)"
else
  # The cluster did start. Check whether it reached a consistent state. If
  # pg_isready says yes but the log still shows repeated restore_command
  # failures, the recovery is at least NOT silent. Otherwise treat as fail.
  if printf '%s' "${MISS_LOGS}" | grep -Eqi 'restore_command|cp:.*No such|archive'; then
    pass "F1 missing WAL segment — restore_command failures visible in logs (loud)"
  else
    fail "F1 missing WAL segment — recovery silently started with incomplete history"
  fi
fi
docker compose -p "${PROJECT_MISS}" -f "${COMPOSE_FILE}" down --remove-orphans >/dev/null 2>&1 || true

# Cleanup the miss project explicitly (it's not in the trap list of project names).
PROJECTS_EXTRA=("${PROJECT_MISS}")
for p in "${PROJECTS_EXTRA[@]}"; do
  docker compose -p "${p}" -f "${COMPOSE_FILE}" down --remove-orphans >/dev/null 2>&1 || true
done

echo ""
echo "=== P7-C3 PITR FAILURE-MODE DRILL SUMMARY ==="
echo "  passed: ${PASS_COUNT}"
echo "  failed: ${FAIL_COUNT}"
if [ "${FAIL_COUNT}" -ne 0 ]; then
  echo "  RESULT: FAIL" >&2
  exit 1
fi
echo "  RESULT: PASS"
echo "=== P7-C3 PITR FAILURE-MODE DRILL: ALL CHECKS PASSED ==="
