#!/usr/bin/env bash
# pgBackRest retention/expire with evidence recording (P7-CLOSE P7-3b).
#
# Runs pgbackrest expire to prune old backups and WAL archives according to
# the configured retention policy, then records evidence of the outcome in
# the Exam ledger. This script is HOST-SIDE automation — it runs outside
# Exam RBAC via cron, systemd timer, or manual operator invocation.
#
# The retention policy is configured in pgbackrest.conf (repo-retention-*
# settings). This script does NOT set retention policy — it applies whatever
# the operator has configured and records the evidence.
#
# FAIL-CLOSED: if pgbackrest expire fails, or if verification fails, or if
# the evidence recording fails, the script exits non-zero. The operator
# MUST investigate. No silent success on failure.
#
# Usage:
#   ./pgbackrest-retain.sh <COMPOSE_PROJECT> [STANZA]
#
# Examples:
#   ./pgbackrest-retain.sh exam
#   ./pgbackrest-retain.sh exam exam-stanza
#
# cron example (daily at 02:00):
#   0 2 * * * /path/to/scripts/backup/pgbackrest-retain.sh exam >> /var/log/exam-retention.log 2>&1
set -euo pipefail

print_usage() {
  cat >&2 <<'EOF'
Usage: pgbackrest-retain.sh <COMPOSE_PROJECT> [STANZA]

  COMPOSE_PROJECT  the Compose project name (addresses <project>-db-1).
  STANZA           pgBackRest stanza name (default: exam).

Runs pgbackrest expire to prune old backups and WAL archives, verifies
repository integrity, and records evidence in the Exam ledger. Host-side
automation — runs outside Exam RBAC.
EOF
}

if [ "$#" -lt 1 ] || [ "$#" -gt 2 ]; then
  print_usage
  exit 2
fi

PROJECT="$1"
STANZA="${2:-exam}"

DB_CONTAINER="${PROJECT}-db-1"
APP_CONTAINER="${PROJECT}-app-1"

if ! docker inspect "${DB_CONTAINER}" >/dev/null 2>&1; then
  echo "FAIL: db container '${DB_CONTAINER}' not found (project '${PROJECT}')." >&2
  exit 2
fi

if ! docker inspect "${APP_CONTAINER}" >/dev/null 2>&1; then
  echo "FAIL: app container '${APP_CONTAINER}' not found (project '${PROJECT}')." >&2
  exit 2
fi

# Stable operation identity for this retention run.
OPERATION_ID="retention:$(date +%Y-%m-%dT%H)"

echo "pgBackRest retention/expire:"
echo "  project: ${PROJECT}"
echo "  stanza: ${STANZA}"
echo "  operation: ${OPERATION_ID}"
echo "  started: $(date -u +%Y-%m-%dT%H:%M:%SZ)"

# ── Step 1: Run pgbackrest expire ──
EXPIRE_OUTPUT=""
EXPIRE_EXIT=0
EXPIRE_OUTPUT="$(docker exec "${DB_CONTAINER}" \
  pgbackrest --stanza="${STANZA}" expire 2>&1)" || EXPIRE_EXIT=$?

if [ "${EXPIRE_EXIT}" -ne 0 ]; then
  echo "FAIL: pgbackrest expire exited with code ${EXPIRE_EXIT}" >&2
  echo "  output: ${EXPIRE_OUTPUT}" >&2

  # Record failure evidence.
  docker exec "${APP_CONTAINER}" \
    node dist/scripts/backup-evidence.js retention \
      --operation-id "${OPERATION_ID}" \
      --tool pgbackrest \
      --result failed \
      --reason "pgbackrest expire exited with code ${EXPIRE_EXIT}" \
      --executor host_script 2>&1 || true

  exit 1
fi

echo "  expire output: ${EXPIRE_OUTPUT:-<no output>}"

# ── Step 2: Verify repository integrity ──
VERIFY_OUTPUT=""
VERIFY_EXIT=0
VERIFY_OUTPUT="$(docker exec "${DB_CONTAINER}" \
  pgbackrest --stanza="${STANZA}" check 2>&1)" || VERIFY_EXIT=$?

VERIFICATION_STATUS="verified"
VERIFICATION_DETAIL="pgbackrest check passed"
if [ "${VERIFY_EXIT}" -ne 0 ]; then
  VERIFICATION_STATUS="failed"
  VERIFICATION_DETAIL="pgbackrest check failed (exit ${VERIFY_EXIT}): ${VERIFY_OUTPUT}"
  echo "WARN: repository verification failed" >&2
  echo "  ${VERIFICATION_DETAIL}" >&2
fi

# ── Step 3: Read ACTUAL retention config + remaining backups for evidence ──
# The recorded objective must reflect the configured retention knobs AND the
# observed remaining backups. A fixed "config-driven" string would prove only
# "expire returned 0" — not that backup/WAL growth is actually bounded, which
# is the retention invariant this evidence exists to support. The policy lives
# in pgbackrest.conf (repo-retention-*); the remaining counts after expire are
# the direct observable that retention is in effect.
INFO_OUTPUT="$(docker exec "${DB_CONTAINER}" \
  pgbackrest --stanza="${STANZA}" info --output=json 2>&1)" || true
FULL_COUNT=0
DIFF_COUNT=0
if command -v jq >/dev/null 2>&1; then
  FULL_COUNT=$(echo "${INFO_OUTPUT}" \
    | jq '[.[] | .backup[]? | select(.type=="full")] | length' 2>/dev/null) || FULL_COUNT=0
  DIFF_COUNT=$(echo "${INFO_OUTPUT}" \
    | jq '[.[] | .backup[]? | select(.type=="diff" or .type=="incr")] | length' 2>/dev/null) || DIFF_COUNT=0
fi
BACKUP_COUNT=$((FULL_COUNT + DIFF_COUNT))

# Best-effort: read the configured retention knobs from pgbackrest.conf. The
# conf path defaults to the pgBackRest standard and is overridable via
# PGBACKREST_CONF. Unreadable conf (permission/path) is non-fatal — the
# remaining counts still evidence retention in effect.
PGBACKREST_CONF="${PGBACKREST_CONF:-/etc/pgbackrest/pgbackrest.conf}"
RETENTION_KNOBS=""
CONF_TEXT=""
CONF_TEXT="$(docker exec "${DB_CONTAINER}" cat "${PGBACKREST_CONF}" 2>/dev/null)" \
  || CONF_TEXT=""
if [ -n "${CONF_TEXT}" ]; then
  mapfile -t KNOB_LINES < <(printf '%s\n' "${CONF_TEXT}" \
    | grep -oiE '^[[:space:]]*repo[-_]retention[-_](full|diff|archive(_type)?)[[:space:]]*=.*' \
    | sed -E 's/[[:space:]]+/ /g; s/^[[:space:]]*//')
  if [ "${#KNOB_LINES[@]}" -gt 0 ]; then
    RETENTION_KNOBS="$(printf '%s; ' "${KNOB_LINES[@]}")"
    RETENTION_KNOBS="${RETENTION_KNOBS%; }" # strip trailing "; "
  fi
fi

if [ -n "${RETENTION_KNOBS}" ]; then
  RETENTION_OBJECTIVE="${RETENTION_KNOBS} (pgbackrest.conf); ${FULL_COUNT} full, ${DIFF_COUNT} diff remaining after expire"
else
  RETENTION_OBJECTIVE="pgbackrest expire; ${FULL_COUNT} full, ${DIFF_COUNT} diff remaining after expire (retention knobs in pgbackrest.conf, unreadable here)"
fi

# ── Step 4: Determine result ──
RESULT="succeeded"
REASON=""
if [ "${VERIFICATION_STATUS}" = "failed" ]; then
  RESULT="failed"
  REASON="${VERIFICATION_DETAIL}"
fi

# ── Step 5: Record evidence ──
# Bash array, not a flat "${EXTRA_ARGS}" string: a reason containing spaces
# must reach the CLI as a single --reason value, not be word-split into
# flags/operands. Each element is a separate argv entry under the host shell
# before docker exec forwards them to node.
EVIDENCE_ARGS=(
  retention
  --operation-id "${OPERATION_ID}"
  --tool pgbackrest
  --result "${RESULT}"
  --objective "${RETENTION_OBJECTIVE}"
  --verification-status "${VERIFICATION_STATUS}"
  --verification-detail "${VERIFICATION_DETAIL}"
  --executor host_script
)
if [ -n "${REASON}" ]; then
  EVIDENCE_ARGS+=(--reason "${REASON}")
fi

docker exec "${APP_CONTAINER}" \
  node dist/scripts/backup-evidence.js "${EVIDENCE_ARGS[@]}"

echo "  completed: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "  result: ${RESULT}"
echo "  verification: ${VERIFICATION_STATUS}"
echo "  remaining backups: ${BACKUP_COUNT}"

if [ "${RESULT}" = "failed" ]; then
  echo "FAIL: retention run recorded as FAILED — operator must investigate." >&2
  exit 1
fi

echo "OK: retention run ${OPERATION_ID} succeeded."
