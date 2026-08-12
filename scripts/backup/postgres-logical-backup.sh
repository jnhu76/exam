#!/usr/bin/env bash
# PostgreSQL logical online backup helper.
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

# P7-E2B: stable logical-run identity for the evidence ledger. Defaults to
# the HOUR slot (<type>:<YYYY-MM-DD>T<HH>) — the ledger allows at most one
# verified success per operation id, so a default of "one per day" would
# collide for any schedule finer than daily (e.g. hourly backups with a
# desired RPO < 24h). A manual/cron invocation may override with
# EVIDENCE_OPERATION_ID; retries of the same logical run MUST reuse the same
# id so the ledger can reconcile them, and a schedule finer than one hour
# MUST pass a per-slot id (see docs/deployment/backup-and-recovery.md). The
# artifact label is the file NAME only — the ledger never stores host paths.
EVIDENCE_OPERATION_ID="${EVIDENCE_OPERATION_ID:-logical:$(date +%Y-%m-%dT%H)}"
ARTIFACT_LABEL="$(basename "${DEST}")"

# Runs the typed operator evidence command inside the app container.
# Start evidence is best-effort (a missing start record never blocks the
# backup); COMPLETE evidence is a hard gate — a verified artifact that cannot
# be recorded is reported loudly and the script exits non-zero so cron does
# not silently count a run the product ledger cannot see.
#
# Container-name addressing (like DB_CONTAINER below) — deliberately NOT
# `docker compose -p ... exec`, which requires a compose file in the invoking
# cwd (breaks under host cron with a different working directory).
evidence() {
  docker exec "${PROJECT}-app-1" node dist/scripts/backup-evidence.js "$@"
}

evidence_start() {
  if ! evidence start --operation-id "${EVIDENCE_OPERATION_ID}" \
      --type logical --artifact-label "${ARTIFACT_LABEL}" --executor host_script; then
    echo "WARN: evidence start unavailable (app container down?) — this run will not" >&2
    echo "      appear as in-progress in the product ledger. Completion evidence is" >&2
    echo "      still required." >&2
  fi
}

evidence_fail() {
  # Best-effort: the primary failure is already reported by the caller.
  evidence fail --operation-id "${EVIDENCE_OPERATION_ID}" \
    --type logical --executor host_script --reason "$1" >/dev/null 2>&1 || true
}

evidence_complete() {
  local size_bytes
  size_bytes="$(stat -c %s "${DEST}" 2>/dev/null || echo 0)"
  if ! evidence complete --operation-id "${EVIDENCE_OPERATION_ID}" \
      --type logical --artifact-label "${ARTIFACT_LABEL}" \
      --size-bytes "${size_bytes}" --verification-method pg_restore_list \
      --executor host_script; then
    echo "FAIL: backup artifact produced and verified, but EVIDENCE RECORDING failed." >&2
    echo "      artifact: ${DEST} (${size_bytes} bytes)" >&2
    echo "      Re-run the evidence CLI to record it, or the product ledger will not" >&2
    echo "      show a verified backup:" >&2
    echo "        docker exec ${PROJECT}-app-1 node dist/scripts/backup-evidence.js complete \\" >&2
    echo "          --operation-id ${EVIDENCE_OPERATION_ID} --type logical \\" >&2
    echo "          --artifact-label ${ARTIFACT_LABEL} --size-bytes ${size_bytes} \\" >&2
    echo "          --verification-method pg_restore_list --executor host_script" >&2
    exit 1
  fi
}

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

# Derive the actual deployment's PostgreSQL user/db from the RUNNING db
# container (NOT hardcoded). The bundled Compose seeds these from
# POSTGRES_USER / POSTGRES_DB; an operator that customized them is honored.
DEPLOY_PG_USER="$(docker inspect "${DB_CONTAINER}" \
  --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | sed -n 's/^POSTGRES_USER=//p' | head -1)"
DEPLOY_PG_DB="$(docker inspect "${DB_CONTAINER}" \
  --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | sed -n 's/^POSTGRES_DB=//p' | head -1)"
DEPLOY_PG_USER="${DEPLOY_PG_USER:-exam}"
DEPLOY_PG_DB="${DEPLOY_PG_DB:-exam}"

# Confirm PostgreSQL is reachable (db up). The API does NOT need to be up.
if ! docker exec "${DB_CONTAINER}" pg_isready -U "${DEPLOY_PG_USER}" -d "${DEPLOY_PG_DB}" >/dev/null 2>&1; then
  echo "FAIL: PostgreSQL is not ready in ${DB_CONTAINER}." >&2
  echo "       This backup requires PostgreSQL to be UP (the API may be down)." >&2
  exit 2
fi

echo "Logical online backup (pg_dump -Fc):"
echo "  source: ${DB_CONTAINER} (db ${DEPLOY_PG_DB})"
echo "  destination: ${DEST}"
echo "  PostgreSQL remains ONLINE; API availability is not required."

# P7-E2B: record the run start BEFORE the dump (crash semantics: a process
# that dies before the artifact exists leaves a running record that the next
# start closes as abandoned — it never claims success).
evidence_start

# Run pg_dump INSIDE the db container (so it uses the container's local auth
# and the bundled POSTGRES_USER/POSTGRES_DB env). -Fc = custom format
# (built-in compression, pg_restore support, better version portability than
# raw PGDATA). --no-owner keeps the dump portable across roles/owners. The
# password is never on the argv: the container's POSTGRES_PASSWORD is already
# in the postgres user's environment via ~/.pgpass-free trust for local
# connections; if PGPASSWORD is exported on the host it is passed through to
# the exec environment explicitly (still not on argv).
if ! docker exec \
  -e PGPASSWORD="${PGPASSWORD:-}" \
  "${DB_CONTAINER}" \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner' \
  > "${DEST}"; then
  echo "FAIL: pg_dump exited non-zero — no backup produced." >&2
  evidence_fail "pg_dump failed"
  exit 1
fi

# ── Verification (C2.4): do not equate "pg_dump exited 0" with "restore proven". ──
# At minimum: artifact exists, non-empty, and pg_restore --list succeeds
# (proves the archive is a readable custom-format dump). The true proof is a
# clean-restore drill (C2.5), run separately.
if [ ! -s "${DEST}" ]; then
  echo "FAIL: backup artifact is empty — pg_dump produced no output." >&2
  rm -f "${DEST}" 2>/dev/null || true
  evidence_fail "artifact empty"
  exit 1
fi

# Custom-format dump magic: the first 5 bytes are "PGDMP". This catches the
# case where stdout captured an error message instead of a real dump.
MAGIC="$(head -c 5 "${DEST}" 2>/dev/null || true)"
if [ "${MAGIC}" != "PGDMP" ]; then
  echo "FAIL: artifact does not start with the 'PGDMP' custom-format magic." >&2
  echo "       The captured stream may be an error message, not a dump." >&2
  rm -f "${DEST}" 2>/dev/null || true
  evidence_fail "artifact missing PGDMP magic"
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
  evidence_fail "verification failed: pg_restore --list rejected the archive"
  exit 1
fi

# P7-E2B: verification passed — record the VERIFIED success. This is the
# ONLY path that makes the run SUCCESS in the ledger (artifact + readable +
# verification + durable evidence, ADR-017 D10).
evidence_complete

SIZE="$(du -h "${DEST}" | cut -f1)"
echo ""
echo "Logical backup COMPLETE."
echo "  artifact: ${DEST} (${SIZE})"
echo "  format:   PostgreSQL custom (-Fc), --no-owner"
echo "  verification: non-empty + PGDMP magic + pg_restore --list OK"
echo ""
echo "  IMPORTANT: backup creation is not restore proof. Run a clean-restore"
echo "  drill (postgres-logical-restore.sh + tests/deployment/"
echo "  logical-backup-restore.sh) before relying on this artifact for recovery."
echo "  Store this artifact on an INDEPENDENT failure domain (NAS / another"
echo "  server / a separate disk)."
