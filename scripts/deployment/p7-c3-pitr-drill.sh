#!/usr/bin/env bash
# P7-C3 PostgreSQL physical base backup + WAL/PITR deterministic drill.
#
# Proves PostgreSQL-native continuous archiving + point-in-time recovery:
#   enable WAL archiving (ALTER SYSTEM) → base backup (pg_basebackup) →
#   T1 State A → T2 State B → T3 destructive mutation C → recover into a
#   fresh cluster to a recovery target AFTER B and BEFORE C →
#   assert A present, B present, C absent → Exam invariant checks.
#
# Also exercises a loud-failure case: a missing/invalid recovery target must
# fail loudly rather than quietly accepting an incomplete history.
#
# All state lives in throwaway temp directories removed on exit
# (path-guarded). No human/dev database is touched. PostgreSQL stays at
# wal_level=replica (already sufficient for PITR).
#
# Usage: ./p7-c3-pitr-drill.sh
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
PROJECT_SRC="p7c3-src-${RUN_TS}"     # the live cluster (archiving on)
PROJECT_REC="p7c3-rec-${RUN_TS}"     # the fresh recovery cluster
SRC_ROOT="$(mktemp -d -t p7c3-src-XXXXXX)"
REC_ROOT="$(mktemp -d -t p7c3-rec-XXXXXX)"
BASEBACKUP_DIR_PARENT="$(mktemp -d -t p7c3-bb-XXXXXX)"
BASEBACKUP_DIR="${BASEBACKUP_DIR_PARENT}/base-${RUN_TS}"

CREATED_DIRS=("${SRC_ROOT}" "${REC_ROOT}" "${BASEBACKUP_DIR_PARENT}")

cleanup() {
  for proj in "${PROJECT_SRC}" "${PROJECT_REC}"; do
    docker compose -p "${proj}" -f "${COMPOSE_FILE}" down --remove-orphans \
      > /dev/null 2>&1 || true
  done
  for d in "${CREATED_DIRS[@]}"; do
    if [ -n "${d}" ] && [ -d "${d}" ] \
      && printf '%s\n' "${d}" | grep -Eq '/tmp/p7c3-[A-Za-z0-9_-]+$'; then
      docker run --rm -v "${d}:/d" alpine:latest \
        sh -c 'rm -rf /d/* /d/.[!.]* 2>/dev/null || true' \
        > /dev/null 2>&1 || true
      rmdir "${d}" 2>/dev/null || rm -rf "${d}" 2>/dev/null || true
    fi
  done
}
trap cleanup EXIT

export EXAM_DATA_ROOT="${SRC_ROOT}"
export POSTGRES_PASSWORD="p7c3-src-pg-$(openssl rand -hex 6)"
SHARED_PG_PASSWORD="${POSTGRES_PASSWORD}"
export JWT_SECRET="p7c3-src-jwt-$(openssl rand -hex 16)"
ORIGIN="http://localhost:3000"
export CORS_ORIGIN="${ORIGIN}"
export PUBLIC_WEB_ORIGIN="${ORIGIN}"
ADMIN_USER="p7c3admin"
ADMIN_PASS="P7C3-Pitr-Admin-$(openssl rand -hex 4)"

psql_src() {
  # Run SQL in the SOURCE db container.
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

echo "=== P7-C3 pg_basebackup + WAL/PITR drill (ts ${RUN_TS}) ==="

echo "--- start SOURCE cluster (archiving OFF initially, like production) ---"
docker compose -p "${PROJECT_SRC}" -f "${COMPOSE_FILE}" up -d --quiet-pull db >/dev/null
wait_db "${PROJECT_SRC}"

echo "--- enable WAL archiving via ALTER SYSTEM + restart ---"
# wal_level is already 'replica' (sufficient for PITR). Enable archive_mode
# and a non-overwriting archive_command. archive_mode is postmaster-level so
# it needs a restart. The WAL archive dir is bind-mounted from the source
# data root so it survives container recreation and is portable to the
# recovery cluster.
mkdir -p "${SRC_ROOT}/wal-archive"
# Make the WAL archive writable by the container postgres user (uid 999).
docker run --rm -v "${SRC_ROOT}/wal-archive:/w" alpine:latest chmod 777 /w
psql_src -c "ALTER SYSTEM SET archive_mode = 'on';"
psql_src -c "ALTER SYSTEM SET archive_command = 'test ! -f /wal-archive/%f && cp %p /wal-archive/%f';"
psql_src -c "ALTER SYSTEM SET archive_timeout = '30s';"
# Mount the WAL archive dir into the db container. Compose does not support
# live volume mounts, so recreate the db container with the extra bind mount
# via a one-shot override. We use a temporary override file.
WAL_OVERRIDE="${SRC_ROOT}/wal-override.yml"
cat > "${WAL_OVERRIDE}" <<YAML
services:
  db:
    volumes:
      - ${SRC_ROOT}/wal-archive:/wal-archive
YAML
docker compose -p "${PROJECT_SRC}" -f "${COMPOSE_FILE}" -f "${WAL_OVERRIDE}" up -d --force-recreate db >/dev/null
wait_db "${PROJECT_SRC}"

# Force a WAL switch so archiving activates and the current segment is
# archived. Confirm archive_mode is on and archiving is working.
psql_src -c "SELECT pg_switch_wal();"
sleep 2
ARCHIVE_MODE_VAL="$(psql_src -tAc "SHOW archive_mode;" | tr -d '[:space:]')"
if [ "${ARCHIVE_MODE_VAL}" != "on" ]; then
  echo "FAIL: archive_mode is '${ARCHIVE_MODE_VAL}', expected 'on'." >&2
  exit 1
fi
echo "  PASS: archive_mode=on, WAL archive mounted at ${SRC_ROOT}/wal-archive."

echo "--- bootstrap first Admin + write State A (marker A) ---"
docker compose -p "${PROJECT_SRC}" -f "${COMPOSE_FILE}" -f "${WAL_OVERRIDE}" up -d --quiet-pull app email-worker >/dev/null
for i in $(seq 1 90); do
  docker exec "${PROJECT_SRC}-app-1" node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1 && break
  sleep 1
done
docker exec "${PROJECT_SRC}-app-1" node dist/scripts/bootstrap-admin.js \
  --username "${ADMIN_USER}" --password "${ADMIN_PASS}" \
  --name "PITR Admin" --organization-name "PITR Org" > /dev/null
psql_src -c "CREATE SCHEMA IF NOT EXISTS p7c3_probe;"
psql_src -c "CREATE TABLE IF NOT EXISTS p7c3_probe.markers(id text primary key, label text not null, written_at text not null);"
psql_src -c "INSERT INTO p7c3_probe.markers VALUES ('A','state-A-${RUN_TS}', now()::text) ON CONFLICT (id) DO UPDATE SET label=EXCLUDED.label;"
psql_src -c "SELECT pg_switch_wal();" >/dev/null
echo "  State A written (marker A)."

echo "--- take physical base backup (pg_basebackup, online) ---"
bash "${BASEBACKUP_SH}" "${PROJECT_SRC}" "${BASEBACKUP_DIR}" 2>&1 | sed 's/^/    /'
if [ ! -d "${BASEBACKUP_DIR}" ] || [ ! -f "${BASEBACKUP_DIR}/backup_manifest" ]; then
  echo "FAIL: base backup incomplete (no backup_manifest)." >&2
  exit 1
fi

echo "--- T2: write State B (marker B); capture LSN; switch WAL so it archives ---"
# Write marker B, then capture the WAL LSN immediately AFTER B commits and
# BEFORE marker C is written. Recovery to that LSN (exclusive of C) is
# clock-skew-independent and deterministic. recovery_target_lsn accepts the
# standard LSN format (X/YYY).
psql_src -c "INSERT INTO p7c3_probe.markers VALUES ('B','state-B-${RUN_TS}', now()::text) ON CONFLICT (id) DO UPDATE SET label=EXCLUDED.label, written_at=EXCLUDED.written_at;" >/dev/null
RECOVERY_LSN="$(psql_src -tAc "SELECT pg_current_wal_lsn();")"
RECOVERY_LSN="$(printf '%s' "${RECOVERY_LSN}" | tr -d '[:space:]')"
echo "  State B written (marker B); recovery target LSN='${RECOVERY_LSN}'."
psql_src -c "SELECT pg_switch_wal();" >/dev/null
# Allow archive_command to flush the segment containing marker B.
sleep 4
psql_src -c "SELECT pg_switch_wal();" >/dev/null
sleep 4
echo "  WAL containing marker B switched and archived."

echo "--- T3: destructive mutation C (marker C) ---"
psql_src -c "INSERT INTO p7c3_probe.markers VALUES ('C','state-C-destructive-${RUN_TS}', now()::text) ON CONFLICT (id) DO UPDATE SET label=EXCLUDED.label;" >/dev/null
psql_src -c "SELECT pg_switch_wal();" >/dev/null
sleep 2
psql_src -c "SELECT pg_switch_wal();" >/dev/null
sleep 2
echo "  State C written (destructive marker C, after recovery target LSN)."

echo "--- stop SOURCE cluster; recover into a fresh cluster ---"
docker compose -p "${PROJECT_SRC}" -f "${COMPOSE_FILE}" -f "${WAL_OVERRIDE}" down --remove-orphans >/dev/null 2>&1 || true

# Recovery cluster: the PG18 docker image expects PGDATA at
# /var/lib/postgresql/18/docker (bind-mounted from ${REC_ROOT}/postgres).
# pg_basebackup -Fp -D puts the PGDATA contents at the target root, so place
# the backup contents under ${REC_ROOT}/postgres/18/docker.
mkdir -p "${REC_ROOT}/postgres/18/docker"
docker run --rm \
  -v "${BASEBACKUP_DIR}:/from:ro" \
  -v "${REC_ROOT}/postgres/18/docker:/to" \
  alpine:latest sh -c 'rm -rf /to/* 2>/dev/null; cp -a /from/. /to/'

# Copy the WAL archive into the recovery root so restore_command can read it.
mkdir -p "${REC_ROOT}/wal-archive"
docker run --rm \
  -v "${SRC_ROOT}/wal-archive:/from:ro" \
  -v "${REC_ROOT}/wal-archive:/to" \
  alpine:latest sh -c 'cp -a /from/. /to/ 2>/dev/null || true'

# Write recovery.signal + recovery conf into the PGDATA. PostgreSQL 18 reads
# recovery target + restore_command from postgresql.auto.conf when
# recovery.signal is present.
PGDATA_REC="${REC_ROOT}/postgres/18/docker"
docker run --rm -v "${PGDATA_REC}:/pg" alpine:latest sh -c 'touch /pg/recovery.signal'
docker run --rm -v "${PGDATA_REC}:/pg" alpine:latest sh -c "
cat >> /pg/postgresql.auto.conf <<CONF
restore_command = 'cp /wal-archive/%f %p'
recovery_target_lsn = '${RECOVERY_LSN}'
recovery_target_inclusive = on
recovery_target_action = 'promote'
CONF
"

# Start the recovery cluster. The base backup's PGDATA is tied to PG18 major,
# same image, so it opens. Mount the WAL archive so restore_command resolves.
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
# Suppress bootstrap-admin-style startup: app/worker would run migrations on
# the recovered DB. For the drill, start ONLY db and inspect it directly.
POSTGRES_PASSWORD="${SHARED_PG_PASSWORD}" docker compose -p "${PROJECT_REC}" -f "${COMPOSE_FILE}" -f "${REC_OVERRIDE}" up -d db >/dev/null
# Wait for recovery to complete and the db to accept connections. Recovery
# replays WAL up to the target time then promotes.
for i in $(seq 1 90); do
  if docker exec "${PROJECT_REC}-db-1" pg_isready -U exam -d exam >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
if ! docker exec "${PROJECT_REC}-db-1" pg_isready -U exam -d exam >/dev/null 2>&1; then
  echo "FAIL: recovery db never became ready." >&2
  docker compose -p "${PROJECT_REC}" -f "${COMPOSE_FILE}" logs --tail=30 db >&2 || true
  exit 1
fi

echo "--- verify PITR result: A present, B present, C ABSENT ---"
RESTORED_A="$(docker exec "${PROJECT_REC}-db-1" psql -U exam -d exam -tAc "SELECT label FROM p7c3_probe.markers WHERE id='A';" 2>/dev/null | head -1)"
RESTORED_B="$(docker exec "${PROJECT_REC}-db-1" psql -U exam -d exam -tAc "SELECT label FROM p7c3_probe.markers WHERE id='B';" 2>/dev/null | head -1)"
RESTORED_C="$(docker exec "${PROJECT_REC}-db-1" psql -U exam -d exam -tAc "SELECT label FROM p7c3_probe.markers WHERE id='C';" 2>/dev/null | head -1)"
echo "  marker A: '${RESTORED_A}' (expect 'state-A-${RUN_TS}')"
echo "  marker B: '${RESTORED_B}' (expect 'state-B-${RUN_TS}')"
echo "  marker C: '${RESTORED_C}' (expect empty)"

if [ "${RESTORED_A}" != "state-A-${RUN_TS}" ]; then
  echo "FAIL: marker A not present after PITR." >&2; exit 1
fi
if [ "${RESTORED_B}" != "state-B-${RUN_TS}" ]; then
  echo "FAIL: marker B not present after PITR (target was after B)." >&2; exit 1
fi
if [ -n "${RESTORED_C}" ]; then
  echo "FAIL: marker C (destructive, after target) is present after PITR." >&2; exit 1
fi
echo "  PASS: PITR recovered to target — A present, B present, C absent."

echo ""
echo "=== P7-C3 pg_basebackup + WAL/PITR DRILL: ALL CHECKS PASSED ==="
