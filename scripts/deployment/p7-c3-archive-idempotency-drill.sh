#!/usr/bin/env bash
# P7-C corrective pass §30 — WAL archive_command idempotency drill.
#
# Proves the idempotent archive_command semantics for all three cases
# (verified statically in /tmp; this drill proves it against the ACTUAL
# running PostgreSQL cluster + the canonical enable-PITR script):
#
#   archive source WAL → empty target      => success (exit 0)
#   archive SAME WAL again (identical)     => success (exit 0)
#   archive DIFFERENT bytes under same name => FAILURE (non-zero)
#
# The archive_command used by scripts/backup/postgres-enable-pitr.sh is:
#   test ! -f /wal-archive/%f && cp %p /wal-archive/%f || cmp -s %p /wal-archive/%f
#
# This drill uses the SAME canonical enable-PITR path as operators (§25), then
# drives a real archived segment through all three cases by invoking the
# configured archive_command string directly inside the db container against
# a real WAL file and the real /wal-archive mount.
#
# All state lives in throwaway temp directories removed on exit. No human/dev
# database is touched.
#
# Usage: ./p7-c3-archive-idempotency-drill.sh
set -euo pipefail

SCRIPT_DIR="$(
  cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1
  pwd
)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"
COMPOSE_FILE="${REPO_ROOT}/docker-compose.yml"
ENABLE_PITR_SH="${REPO_ROOT}/scripts/backup/postgres-enable-pitr.sh"

if [ ! -f "${COMPOSE_FILE}" ] || [ ! -x "${ENABLE_PITR_SH}" ]; then
  echo "FAIL: required scripts not found." >&2
  exit 1
fi

RUN_TS="$(date +%s)"
PROJECT="p7c3idem-${RUN_TS}"
SRC_ROOT="$(mktemp -d -t p7c3idem-src-XXXXXX)"
CREATED_DIRS=("${SRC_ROOT}")
PASS_COUNT=0
FAIL_COUNT=0

cleanup() {
  docker compose -p "${PROJECT}" -f "${COMPOSE_FILE}" down --remove-orphans \
    > /dev/null 2>&1 || true
  for d in "${CREATED_DIRS[@]}"; do
    if [ -n "${d}" ] && [ -d "${d}" ] \
      && printf '%s\n' "${d}" | grep -Eq '/tmp/p7c3idem-[A-Za-z0-9_-]+$'; then
      docker run --rm -v "${d}:/d" alpine:latest \
        sh -c 'rm -rf /d/* /d/.[!.]* 2>/dev/null || true' \
        > /dev/null 2>&1 || true
      rmdir "${d}" 2>/dev/null || rm -rf "${d}" 2>/dev/null || true
    fi
  done
}
trap cleanup EXIT

export EXAM_DATA_ROOT="${SRC_ROOT}"
export POSTGRES_PASSWORD="p7c3idem-pg-$(openssl rand -hex 6)"
export JWT_SECRET="p7c3idem-jwt-$(openssl rand -hex 16)"
ORIGIN="http://localhost:3000"
export CORS_ORIGIN="${ORIGIN}"
export PUBLIC_WEB_ORIGIN="${ORIGIN}"
export EXAM_WAL_ARCHIVE_HOST_PATH="${SRC_ROOT}/wal-archive"
mkdir -p "${SRC_ROOT}/wal-archive"

DB_CONTAINER="${PROJECT}-db-1"
wait_db() {
  for _ in $(seq 1 60); do
    if docker exec "${DB_CONTAINER}" pg_isready -U exam -d exam >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "FAIL: db never became ready." >&2
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

echo "=== P7-C3 WAL archive_command idempotency drill (ts ${RUN_TS}) ==="

echo "--- start SOURCE cluster; enable WAL archiving via canonical script ---"
docker compose -p "${PROJECT}" -f "${COMPOSE_FILE}" up -d --quiet-pull db >/dev/null
wait_db
bash "${ENABLE_PITR_SH}" "${PROJECT}" "${COMPOSE_FILE}" >/dev/null 2>&1
wait_db

# Resolve the ACTUAL configured archive_command (the canonical script set it).
# Replace %p/%f with real paths for each case below.
ACMD="$(docker exec "${DB_CONTAINER}" psql -U exam -d exam -tAc "SHOW archive_command;" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
echo "  configured archive_command: ${ACMD}"

# Locate a real archived WAL segment in /wal-archive to use as the source.
WAL_FILE="$(docker exec "${DB_CONTAINER}" sh -c 'ls -1 /wal-archive/0* 2>/dev/null | head -1')"
if [ -z "${WAL_FILE}" ]; then
  echo "FAIL: no archived WAL segment found in /wal-archive." >&2
  exit 1
fi
WAL_NAME="$(basename "${WAL_FILE}")"
echo "  using real archived segment: ${WAL_NAME}"

# Make a private copy of the segment inside the container as the canonical
# "source" for all three cases (so the real archive is never disturbed).
docker exec "${DB_CONTAINER}" sh -c "cp '${WAL_FILE}' /tmp/idem-source"

# ── CASE 1: archive source → empty target => success ──
echo ""
echo "--- CASE 1: archive source → empty target (expect success) ---"
# Use a unique target name so the empty-target condition is guaranteed.
docker exec "${DB_CONTAINER}" sh -c "rm -f /wal-archive/IDEM-CASE1"
CASE1="$(docker exec "${DB_CONTAINER}" sh -c "
  SRC='/tmp/idem-source'; TGT='IDEM-CASE1'
  cmd=\"${ACMD}\"
  cmd=\$(echo \"\$cmd\" | sed \"s|%p|\$SRC|g; s|%f|\$TGT|g\")
  eval \"\$cmd\" >/dev/null 2>&1 && echo OK || echo FAIL
")"
if [ "${CASE1}" = "OK" ]; then
  pass "CASE 1 — archive source → empty target: success (exit 0)"
else
  fail "CASE 1 — archive source → empty target: expected success, got ${CASE1}"
fi

# ── CASE 2: archive SAME WAL again (identical) => success ──
echo "--- CASE 2: archive SAME bytes again (identical retry; expect success) ---"
# Target already exists from CASE 1 with identical bytes.
CASE2="$(docker exec "${DB_CONTAINER}" sh -c "
  SRC='/tmp/idem-source'; TGT='IDEM-CASE1'
  cmd=\"${ACMD}\"
  cmd=\$(echo \"\$cmd\" | sed \"s|%p|\$SRC|g; s|%f|\$TGT|g\")
  eval \"\$cmd\" >/dev/null 2>&1 && echo OK || echo FAIL
")"
if [ "${CASE2}" = "OK" ]; then
  pass "CASE 2 — identical retry: success (exit 0)"
else
  fail "CASE 2 — identical retry: expected success, got ${CASE2}"
fi

# ── CASE 3: archive DIFFERENT bytes under same name => FAILURE ──
echo "--- CASE 3: archive DIFFERENT bytes under same name (expect FAILURE) ---"
# Write different bytes under the same target name; the command must refuse.
docker exec "${DB_CONTAINER}" sh -c "printf 'different-bytes-collision' > /tmp/idem-other"
CASE3="$(docker exec "${DB_CONTAINER}" sh -c "
  SRC='/tmp/idem-other'; TGT='IDEM-CASE1'
  cmd=\"${ACMD}\"
  cmd=\$(echo \"\$cmd\" | sed \"s|%p|\$SRC|g; s|%f|\$TGT|g\")
  eval \"\$cmd\" >/dev/null 2>&1 && echo OK || echo FAIL
")"
if [ "${CASE3}" = "FAIL" ]; then
  pass "CASE 3 — byte collision under same name: FAILURE (non-zero)"
else
  fail "CASE 3 — byte collision: expected FAILURE, got ${CASE3} (silent overwrite is a data-loss bug)"
fi

# Cleanup the private temp files we created inside the container.
docker exec "${DB_CONTAINER}" sh -c "rm -f /tmp/idem-source /tmp/idem-other /wal-archive/IDEM-CASE1" 2>/dev/null || true

echo ""
echo "=== P7-C3 WAL archive_command idempotency SUMMARY ==="
echo "  passed: ${PASS_COUNT}"
echo "  failed: ${FAIL_COUNT}"
if [ "${FAIL_COUNT}" -ne 0 ]; then
  echo "  RESULT: FAIL" >&2
  exit 1
fi
echo "  RESULT: PASS"
echo "=== P7-C3 ARCHIVE IDEMPOTENCY DRILL: ALL CHECKS PASSED ==="
