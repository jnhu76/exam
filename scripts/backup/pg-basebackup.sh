#!/usr/bin/env bash
# PostgreSQL physical online base backup helper (pg_basebackup).
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
#
# Authentication truth: pg_basebackup runs in a
# sibling container that shares the db container's NETWORK namespace and
# connects over loopback TCP (-h 127.0.0.1). The official postgres image
# authenticates TCP connections with scram-sha-256 by default (trust applies
# only to Unix-socket local connections), so a password IS required. This
# script derives the actual deployment's POSTGRES_USER and POSTGRES_PASSWORD
# from the RUNNING db container's environment and passes the password via
# PGPASSWORD (never argv). PGUSER/PGPASSWORD defaults therefore follow the
# deployment; an operator does not need to maintain a separate backup
# credential namespace for the bundled single-node path.
#
# Replication privilege: pg_basebackup requires a
# SUPERUSER or REPLICATION-capable role. For the bundled single-node
# deployment, this script uses the bootstrap PostgreSQL superuser
# (POSTGRES_USER), which satisfies that requirement. A narrowly scoped
# replication-only role is NOT provisioned by this script; future hardening
# (a dedicated REPLICATION role with no other authority) belongs in a later
# operations / P7-E pass and is documented separately. The comment and the
# implementation agree: the bundled path uses the superuser over loopback TCP
# with the deployment password.
#
# Manifest verification (C3.4): after the base backup, run pg_verifybackup on
# the manifest as an integrity check. NOTE the documented limitation: manifest
# verification is backup-integrity evidence (backup contents match the
# manifest's per-file checksums and the manifest's own checksum verifies), NOT
# proof that Exam can successfully start and satisfy business invariants after
# restore. A restore drill is still required (see the PITR drill /
# physical-restore path).
#
# PITR base-backup rule (§21): WAL archiving MUST be active BEFORE the base
# backup that will anchor PITR. Run scripts/backup/postgres-enable-pitr.sh
# FIRST, confirm the archiver is producing evidence, THEN take this base
# backup. A base backup taken before WAL archiving was established is NOT a
# valid anchor for later continuous PITR.
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

The connection uses the deployment's POSTGRES_USER over loopback TCP with
the deployment password (read from the db container's environment, passed
via PGPASSWORD). For PITR, WAL archiving must already be active (run
postgres-enable-pitr.sh first).
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

# Derive the actual deployment's POSTGRES_USER / POSTGRES_PASSWORD from the
# RUNNING db container (NOT hardcoded). The bundled Compose seeds these; an
# operator that customized POSTGRES_USER=appdb is honored automatically.
DEPLOY_PG_USER="$(docker inspect "${DB_CONTAINER}" \
  --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | sed -n 's/^POSTGRES_USER=//p' | head -1)"
DEPLOY_PG_DB="$(docker inspect "${DB_CONTAINER}" \
  --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | sed -n 's/^POSTGRES_DB=//p' | head -1)"
DEPLOY_PG_PASSWORD="$(docker inspect "${DB_CONTAINER}" \
  --format '{{range .Config.Env}}{{println .}}{{end}}' \
  | sed -n 's/^POSTGRES_PASSWORD=//p' | head -1)"
DEPLOY_PG_USER="${DEPLOY_PG_USER:-exam}"
DEPLOY_PG_DB="${DEPLOY_PG_DB:-exam}"

if ! docker exec "${DB_CONTAINER}" pg_isready -U "${DEPLOY_PG_USER}" -d "${DEPLOY_PG_DB}" >/dev/null 2>&1; then
  echo "FAIL: PostgreSQL is not ready in ${DB_CONTAINER}." >&2
  exit 2
fi

# PGUSER/PGPASSWORD precedence (§18): an explicit host export wins (operators
# with a separate backup credential), otherwise fall back to the deployment's
# POSTGRES_USER / POSTGRES_PASSWORD read from the container. Never hardcode
# PGUSER=exam when POSTGRES_USER may vary.
EFFECTIVE_PGUSER="${PGUSER:-${DEPLOY_PG_USER}}"
EFFECTIVE_PGPASSWORD="${PGPASSWORD:-${DEPLOY_PG_PASSWORD}}"
if [ -z "${EFFECTIVE_PGPASSWORD}" ]; then
  echo "FAIL: no PostgreSQL password available." >&2
  echo "       The connection is over loopback TCP (scram-sha-256), which" >&2
  echo "       requires a password. Export PGPASSWORD=<POSTGRES_PASSWORD> or" >&2
  echo "       ensure the db container exposes POSTGRES_PASSWORD." >&2
  exit 2
fi

echo "Physical online base backup (pg_basebackup):"
echo "  source: ${DB_CONTAINER} (PG user: ${EFFECTIVE_PGUSER})"
echo "  destination: ${DEST}"
echo "  PostgreSQL stays ONLINE; required WAL streamed (-X stream)."
echo "  auth: loopback TCP + scram-sha-256, password via PGPASSWORD (never argv)."

# P7-E2B: stable logical-run identity + evidence hooks (see
# postgres-logical-backup.sh for the semantics; the ledger stores the
# artifact NAME only, never host paths). Default = HOUR slot
# (physical_base:YYYY-MM-DDTHH) so sub-daily schedules never collide on the
# one-success-per-operationId invariant.
EVIDENCE_OPERATION_ID="${EVIDENCE_OPERATION_ID:-physical_base:$(date +%Y-%m-%dT%H)}"
ARTIFACT_LABEL="$(basename "${DEST}")"
# Container-name addressing (cwd-independent — see the same note in
# postgres-logical-backup.sh).
evidence() {
  docker exec "${PROJECT}-app-1" node dist/scripts/backup-evidence.js "$@"
}
evidence_start() {
  if ! evidence start --operation-id "${EVIDENCE_OPERATION_ID}" \
      --type physical_base --artifact-label "${ARTIFACT_LABEL}" --executor host_script; then
    echo "WARN: evidence start unavailable (app container down?) — completion" >&2
    echo "      evidence is still required." >&2
  fi
}
evidence_fail() {
  evidence fail --operation-id "${EVIDENCE_OPERATION_ID}" \
    --type physical_base --executor host_script --reason "$1" >/dev/null 2>&1 || true
}
evidence_complete() {
  local size_bytes
  # Compute the size FIRST, then default to 0 — `du | cut || echo 0` would
  # bind the fallback to `cut` (which succeeds with empty output when du
  # fails), producing an invalid empty --size-bytes that the evidence CLI
  # rejects and fails a REAL, verified backup.
  size_bytes="$(du -sb "${DEST}" 2>/dev/null | cut -f1)"
  size_bytes="${size_bytes:-0}"
  if ! evidence complete --operation-id "${EVIDENCE_OPERATION_ID}" \
      --type physical_base --artifact-label "${ARTIFACT_LABEL}" \
      --size-bytes "${size_bytes}" --verification-method pg_verifybackup \
      --executor host_script; then
    echo "FAIL: base backup produced and verified, but EVIDENCE RECORDING failed." >&2
    echo "      destination: ${DEST}" >&2
    exit 1
  fi
}
evidence_start

# Run pg_basebackup in a sibling container that shares the db container's
# network namespace and connects over loopback TCP. -D points at a path
# INSIDE the container; we bind-mount the host destination as the backup
# target.
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
# NOTE: PGPASSWORD is passed via -e (environment), NEVER on the argv, so it
# does not leak via the process list of the basebackup invocation.
if ! PGPASSWORD="${EFFECTIVE_PGPASSWORD}" docker run --rm \
  -v "${DEST}:/backup:rw" \
  --network "container:${DB_CONTAINER}" \
  -e PGPASSWORD="${EFFECTIVE_PGPASSWORD}" \
  postgres:18.4-bookworm \
  pg_basebackup \
    -h 127.0.0.1 -U "${EFFECTIVE_PGUSER}" \
    -D /backup \
    -X stream \
    -c fast \
    -Fp \
    -l "${LABEL}" \
    --manifest-checksums SHA256; then
  echo "FAIL: pg_basebackup exited non-zero — no base backup produced." >&2
  evidence_fail "pg_basebackup failed"
  exit 1
fi

# ── Manifest verification (C3.4) ─────────────────────────────────────────
# pg_verifybackup verifies the backup contents against the PostgreSQL
# backup manifest: file presence and size, the configured per-file SHA256
# checksums, and the manifest's own checksum. It is an integrity
# check, not a digital signature. Limitation (documented): manifest
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
  evidence_fail "verification failed: pg_verifybackup rejected the manifest"
  exit 1
fi

# P7-E2B: verification passed — record the VERIFIED success.
evidence_complete

echo ""
echo "Physical base backup COMPLETE."
echo "  destination: ${DEST}"
echo "  label: ${LABEL}"
echo "  format: plain (directory tree), WAL streamed (-X stream)"
echo "  verification: pg_verifybackup manifest OK (SHA256 per-file checksums)"
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
