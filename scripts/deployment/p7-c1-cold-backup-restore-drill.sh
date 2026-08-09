#!/usr/bin/env bash
# P7-C1 cold-filesystem backup/restore drill.
#
# Proves the cold-filesystem backup and restore scripts
# (scripts/backup/cold-filesystem-backup.sh,
#  scripts/backup/cold-filesystem-restore.sh) actually round-trip a working
# Exam deployment with identical authoritative state.
#
# Scenario (C1.6 + C1.7):
#   isolated temp root
#       → docker compose up + bootstrap first Admin + write a probe row
#       → record business invariants
#       → docker compose down (PostgreSQL stopped cleanly)
#       → cold-filesystem-backup.sh ROOT BACKUP_DIR
#       → cold-filesystem-restore.sh BACKUP_DIR RESTORE_ROOT
#       → docker compose up from RESTORE_ROOT (same major, same creds)
#       → assert identical invariants
#
# This closes P2-2/P2-3 for the cold-filesystem path: a backup/restore is
# not claimed successful until a fresh working deployment with the expected
# state is produced from it. All state lives in throwaway temp directories
# removed on exit (guarded against an empty/unsafe path). No human/dev
# database is touched.
#
# Usage: ./p7-c1-cold-backup-restore-drill.sh
set -euo pipefail

SCRIPT_DIR="$(
  cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1
  pwd
)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"
COMPOSE_FILE="${REPO_ROOT}/docker-compose.yml"
BACKUP_SH="${REPO_ROOT}/scripts/backup/cold-filesystem-backup.sh"
RESTORE_SH="${REPO_ROOT}/scripts/backup/cold-filesystem-restore.sh"

if [ ! -f "${COMPOSE_FILE}" ] || [ ! -x "${BACKUP_SH}" ] || [ ! -x "${RESTORE_SH}" ]; then
  echo "FAIL: required scripts not found." >&2
  exit 1
fi

RUN_TS="$(date +%s)"
PROJECT="p7c1-colddrill-$(date +%s)"
ROOT="$(mktemp -d -t p7c1-colddrill-A-XXXXXX)"
BACKUP_DIR_PARENT="$(mktemp -d -t p7c1-colddrill-bp-XXXXXX)"
BACKUP_DIR="${BACKUP_DIR_PARENT}/backup-${RUN_TS}"
RESTORE_ROOT_PARENT="$(mktemp -d -t p7c1-colddrill-rp-XXXXXX)"
RESTORE_ROOT="${RESTORE_ROOT_PARENT}/restored"
export EXAM_DATA_ROOT="${ROOT}"
export POSTGRES_PASSWORD="p7c1-colddrill-pg-$(openssl rand -hex 6)"
export JWT_SECRET="p7c1-colddrill-jwt-$(openssl rand -hex 16)"
ORIGIN="http://localhost:3000"
export CORS_ORIGIN="${ORIGIN}"
export PUBLIC_WEB_ORIGIN="${ORIGIN}"
ADMIN_USER="p7c1drill"
ADMIN_PASS="P7C1-Drill-Admin-$(openssl rand -hex 4)"

CREATED_DIRS=("${ROOT}" "${BACKUP_DIR_PARENT}" "${RESTORE_ROOT_PARENT}")

cleanup() {
  docker compose -p "${PROJECT}" -f "${COMPOSE_FILE}" down --remove-orphans \
    > /dev/null 2>&1 || true
  for d in "${CREATED_DIRS[@]}"; do
    if [ -n "${d}" ] && [ -d "${d}" ] \
      && printf '%s\n' "${d}" | grep -Eq '/tmp/p7c1-colddrill-[A-Za-z0-9_-]+$'; then
      # Files inside are owned by the container postgres user (uid 999); use
      # a throwaway container to remove them, then rmdir the temp parent.
      docker run --rm -v "${d}:/d" alpine:latest sh -c 'rm -rf /d/* /d/.[!.]* 2>/dev/null || true' \
        > /dev/null 2>&1 || true
      rmdir "${d}" 2>/dev/null || rm -rf "${d}" 2>/dev/null || true
    fi
  done
}
trap cleanup EXIT

wait_for_db() {
  for _ in $(seq 1 60); do
    if docker exec "${PROJECT}-db-1" pg_isready -U exam -d exam > /dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "FAIL: db never became ready" >&2
  exit 1
}
wait_for_app() {
  for _ in $(seq 1 90); do
    if docker exec "${PROJECT}-app-1" \
      node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
      > /dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "FAIL: app never became healthy" >&2
  exit 1
}
capture() {
  # orgs : admin_bootstrap_audit : probe label
  docker exec "${PROJECT}-db-1" psql -U exam -d exam -tAc \
    "SELECT count(*)||':'||(SELECT count(*) FROM audit_logs WHERE action='admin.bootstrap')||':'||(SELECT label FROM p7c1_probe.marker WHERE id=1) FROM organizations;"
}

echo "=== P7-C1 cold-filesystem backup/restore drill (ts ${RUN_TS}) ==="

echo "--- start deployment, bootstrap first Admin, write probe ---"
docker compose -p "${PROJECT}" -f "${COMPOSE_FILE}" up -d --quiet-pull > /dev/null
wait_for_db
wait_for_app
docker exec "${PROJECT}-app-1" node dist/scripts/bootstrap-admin.js \
  --username "${ADMIN_USER}" --password "${ADMIN_PASS}" \
  --name "Drill Admin" --organization-name "Drill Org" > /dev/null
docker exec "${PROJECT}-db-1" psql -U exam -d exam -tAc \
  "CREATE SCHEMA IF NOT EXISTS p7c1_probe; CREATE TABLE IF NOT EXISTS p7c1_probe.marker(id int primary key, label text); INSERT INTO p7c1_probe.marker VALUES (1,'cold-roundtrip') ON CONFLICT (id) DO UPDATE SET label=EXCLUDED.label;" \
  > /dev/null
INV_BEFORE="$(capture)"
echo "  invariants before: ${INV_BEFORE}"

echo "--- stop cleanly (PostgreSQL stopped) ---"
docker compose -p "${PROJECT}" -f "${COMPOSE_FILE}" down --remove-orphans > /dev/null 2>&1 || true

echo "--- cold-filesystem-backup.sh ---"
echo "" | bash "${BACKUP_SH}" "${ROOT}" "${BACKUP_DIR}" 2>&1 | sed 's/^/    /'

echo "--- cold-filesystem-restore.sh ---"
echo "RESTORE" | bash "${RESTORE_SH}" "${BACKUP_DIR}" "${RESTORE_ROOT}" 2>&1 | sed 's/^/    /'

echo "--- start Exam from RESTORE_ROOT (same major, same creds) ---"
export EXAM_DATA_ROOT="${RESTORE_ROOT}"
docker compose -p "${PROJECT}" -f "${COMPOSE_FILE}" up -d --quiet-pull > /dev/null
wait_for_db
INV_AFTER="$(capture)"
echo "  invariants after:  ${INV_AFTER}"

if [ "${INV_BEFORE}" != "${INV_AFTER}" ]; then
  echo "  FAIL: cold backup/restore round-trip changed invariants."
  exit 1
fi
echo "  PASS: cold-filesystem backup/restore round-trip (C1.6 + C1.7)."
echo ""
echo "=== P7-C1 COLD BACKUP/RESTORE DRILL: ALL CHECKS PASSED ==="
