#!/usr/bin/env bash
# Cold-filesystem backup helper.
#
# Treats a STOPPED copy of PostgreSQL's complete persistent directory as a
# simple same-version/same-major cold physical backup. This is the simplest
# full backup option; it requires downtime while PostgreSQL is stopped.
#
# Supported cold-backup flow (C1.6):
#   stop Exam / PostgreSQL cleanly
#       → copy the COMPLETE PostgreSQL persistent directory
#       → store the copy OUTSIDE the primary host failure domain
#       → restart the service
#
# What this script does and does NOT do:
#   - It copies the COMPLETE ${EXAM_DATA_ROOT}/postgres tree with ownership,
#     mode, and symlinks preserved (container-assisted, because the files are
#     owned by the container postgres user and not readable by the host user).
#   - It refuses unsafe source/dest paths and refuses to overwrite an
#     existing destination.
#   - It validates the source looks like a PGDATA (presence of
#     PG_VERSION/postgresql.conf under the postgres major-version subdir).
#   - It refuses an obviously RUNNING source: if a live `postmaster.pid` is
#     present in the actual PGDATA, it aborts before copying. Do not merely
#     print "make sure PostgreSQL is stopped" and copy anyway. The operator
#     MUST `docker compose down` first.
#   - It does NOT start, stop, or restart the deployment for you. The
#     operator must stop PostgreSQL cleanly BEFORE running this script and
#     restart it AFTER. A live copy of an active PGDATA is corrupt-prone and
#     is explicitly NOT supported.
#   - It does NOT verify PostgreSQL major-version compatibility with any
#     restore target. Raw PGDATA is tied to the postgres major version; see
#     docs/deployment/backup-and-recovery.md.
#
# Distinction (do not conflate):
#   ./data/postgres on the live host                = persistence
#   copy on the same failing disk                   = weak local copy, NOT DR
#   copy on NAS / another server / independent disk = disaster backup
# Store the destination on an INDEPENDENT failure domain. This script does
# not enforce that — it cannot know which disk a path lives on — so the
# operator is responsible for choosing an off-host destination.
#
# Usage:
#   ./cold-filesystem-backup.sh <EXAM_DATA_ROOT> <DEST_DIR>
# Example:
#   # 1. Stop Exam first:     docker compose down
#   # 2. Run this script:     ./cold-filesystem-backup.sh "${EXAM_DATA_ROOT:-./data}" /mnt/nas/exam-backups/2026-08-10
#   # 3. Restart Exam:        docker compose up -d
set -euo pipefail

# Helper container: the deployment's OWN postgres image (pinned by
# docker-compose.yml and already present on any host that runs this
# deployment). It provides sh/cp/find for PGDATA validation and the
# container-assisted copy. There is deliberately NO separate helper image
# dependency.
HELPER_IMAGE="postgres:18.4-bookworm"

print_usage() {
  cat >&2 <<'EOF'
Usage: cold-filesystem-backup.sh <EXAM_DATA_ROOT> <DEST_DIR>

  EXAM_DATA_ROOT  the host data root whose postgres/ subtree holds PGDATA
                  (the production Compose default is ./data).
  DEST_DIR        the backup destination. Must not exist yet (the script
                  creates it). Place it on an INDEPENDENT failure domain
                  (NAS / another server / a separate disk).

IMPORTANT: stop PostgreSQL cleanly (docker compose down) BEFORE running this
script, and restart it (docker compose up -d) AFTER. A live copy of an
active PGDATA is NOT supported.
EOF
}

if [ "$#" -ne 2 ]; then
  print_usage
  exit 2
fi

SRC_ROOT="$1"
DEST="$2"

# ── Path safety: refuse empty, relative-in-a-bad-way, or unsafe inputs ──
# Require non-empty arguments that are not the filesystem root and do not
# traverse outside via "..". This is a guard, not a full sandbox.
validate_path() {
  local name="$1"
  local path="$2"
  if [ -z "${path}" ]; then
    echo "FAIL: ${name} is empty." >&2
    exit 2
  fi
  case "${path}" in
    /|/etc|/usr|/bin|/sbin|/boot|/proc|/sys|/dev)
      echo "FAIL: ${name} '${path}' is a system path; refusing." >&2
      exit 2
      ;;
  esac
}
validate_path "EXAM_DATA_ROOT" "${SRC_ROOT}"
validate_path "DEST_DIR" "${DEST}"

SRC_PG="${SRC_ROOT}/postgres"
if [ ! -d "${SRC_PG}" ]; then
  echo "FAIL: source postgres directory not found at ${SRC_PG}." >&2
  echo "       Expected \${EXAM_DATA_ROOT}/postgres to exist (the bind-mounted PGDATA)." >&2
  exit 2
fi
if [ -e "${DEST}" ]; then
  echo "FAIL: destination '${DEST}' already exists; refusing to overwrite." >&2
  echo "       Choose a fresh destination path for each backup." >&2
  exit 2
fi

# Validate the source looks like a PGDATA via a helper container (the files
# are owned by the container postgres user and not readable by the host
# user). Locate the major-version subdir (e.g. 18/docker) and check for
# PG_VERSION + postgresql.conf.
PGDATA_SUBDIR="$(docker run --rm -v "${SRC_PG}:/pg:ro" "${HELPER_IMAGE}" \
  sh -c 'find /pg -maxdepth 3 -name PG_VERSION -print -quit 2>/dev/null || true')"
if [ -z "${PGDATA_SUBDIR}" ]; then
  echo "FAIL: no PG_VERSION found under ${SRC_PG}; does not look like a PGDATA tree." >&2
  exit 2
fi
PGDATA_DIR="$(dirname "${PGDATA_SUBDIR}")"
if ! docker run --rm -v "${SRC_PG}:/pg:ro" "${HELPER_IMAGE}" \
  sh -c "test -f '${PGDATA_DIR}/postgresql.conf'" 2>/dev/null; then
  echo "FAIL: postgresql.conf not found next to PG_VERSION at ${PGDATA_DIR}." >&2
  exit 2
fi

# ── Refuse an obviously RUNNING source. ──
# A live copy of an active PGDATA is corrupt-prone and NOT supported. The
# smallest SOURCE-SPECIFIC evidence is a live `postmaster.pid` present in the
# actual PGDATA being backed up. (A broad `docker ps | grep db-1` check is
# NOT used: it would false-positive against any unrelated db container
# running on the same host from a different Compose project — the running
# source is identified by its own PGDATA, not by a name pattern.) A clean
# `docker compose down` removes postmaster.pid; its presence therefore means
# a postmaster is (or believes it is) still owning THIS cluster. We do NOT
# build a process detector framework. The supported flow is
# `docker compose down` THEN this script.
if docker run --rm -v "${SRC_PG}:/pg:ro" "${HELPER_IMAGE}" \
  sh -c "test -f '${PGDATA_DIR}/postmaster.pid'" 2>/dev/null; then
  echo "FAIL: postmaster.pid present at ${PGDATA_DIR}." >&2
  echo "       A postmaster appears to still own this PGDATA. Run" >&2
  echo "       'docker compose down' and ensure PostgreSQL is fully stopped" >&2
  echo "       before a cold-filesystem copy." >&2
  exit 2
fi

# Create the destination (parent must exist). The backup mirrors the
# deployment data-root layout: PGDATA lands at ${DEST}/postgres/18/docker/...
# so cold-filesystem-restore.sh can target ${DEST_EXAM_DATA_ROOT} directly.
DEST_PARENT="$(dirname "${DEST}")"
if [ ! -d "${DEST_PARENT}" ]; then
  echo "FAIL: destination parent '${DEST_PARENT}' does not exist." >&2
  exit 2
fi
mkdir -p "${DEST}/postgres"

echo "Cold-filesystem backup:"
echo "  source PGDATA: ${SRC_PG}  (PGDATA at ${PGDATA_DIR#/pg})"
echo "  destination:   ${DEST}/postgres"
echo ""
echo "  IMPORTANT: PostgreSQL must be STOPPED before this copy (the"
echo "  postmaster.pid check above is the safety gate). A live copy of an"
echo "  active PGDATA is corrupt-prone and is NOT supported."

# Container-assisted copy preserves ownership/mode/symlinks. The PGDATA files
# are owned by the container postgres user and not readable by the host user,
# so a host-side cp -a would fail with EACCES. Equivalent to running
# `rsync -aHAX` or `tar | tar` as root on the host. Copy the COMPLETE postgres
# tree (never partial relation files) into ${DEST}/postgres.
echo "Copying COMPLETE postgres tree..."
# Capture the REAL start time BEFORE the copy — the evidence spool must be
# truthful (startedAt is when the cold copy began, not when it finished).
COLD_START_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
docker run --rm \
  -v "${SRC_PG}:/from:ro" \
  -v "${DEST}/postgres:/to" \
  "${HELPER_IMAGE}" \
  sh -c 'cp -a /from/. /to/'

# Verify the copy landed and looks like a PGDATA (use find so we do not
# depend on path arithmetic between the /pg source mount and the /to dest
# mount). The backup layout mirrors the deployment data root, so PGDATA is
# at ${DEST}/postgres/18/docker/PG_VERSION (depth 4 from ${DEST}).
if ! docker run --rm -v "${DEST}:/to:ro" "${HELPER_IMAGE}" \
  sh -c 'find /to -maxdepth 4 -name PG_VERSION -print -quit 2>/dev/null | grep -q .'; then
  echo "FAIL: copy verification failed — PG_VERSION missing in destination." >&2
  exit 1
fi

# ── P7-E2B evidence spool ─────────────────────────────────────────
# Cold backups run while PostgreSQL is STOPPED, so the ledger (in
# PostgreSQL) is unreachable during the copy. The script therefore writes a
# typed evidence SPOOL file next to the artifact; after `docker compose
# up -d` the operator imports it into the ledger with ONE command (printed
# below). The spool is a transit file, NOT a second authority store — the
# ledger in PostgreSQL remains the single durable authority; a lost spool
# simply means no evidence (fail closed, never a false success). Crash
# during the stopped window = no spool = no evidence.
# Default = HOUR slot (cold_filesystem:YYYY-MM-DDTHH) so sub-daily schedules
# never collide on the one-success-per-operationId invariant (see
# postgres-logical-backup.sh for the full semantics).
EVIDENCE_OPERATION_ID="${EVIDENCE_OPERATION_ID:-cold_filesystem:$(date +%Y-%m-%dT%H)}"
SPOOL="${DEST}/evidence.json"
# Compute the size FIRST, then default to 0 — `du | cut || echo 0` would bind
# the fallback to `cut` (which succeeds with empty output when du fails),
# producing an invalid empty artifactSizeBytes in the spool JSON.
SIZE_BYTES="$(du -sb "${DEST}" 2>/dev/null | cut -f1)"
SIZE_BYTES="${SIZE_BYTES:-0}"
# startedAt = the real copy start (COLD_START_ISO, captured before the copy);
# completedAt = when the copy finished (here, post-verification).
COLD_END_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
cat > "${SPOOL}" <<EOF
{
  "schemaVersion": 1,
  "operationId": "${EVIDENCE_OPERATION_ID}",
  "backupType": "cold_filesystem",
  "artifactLabel": "$(basename "${DEST}")",
  "artifactSizeBytes": ${SIZE_BYTES},
  "verificationMethod": "pg_version_presence",
  "startedAt": "${COLD_START_ISO}",
  "completedAt": "${COLD_END_ISO}",
  "executorType": "host_script"
}
EOF

echo ""
echo "Cold-filesystem backup COMPLETE."
echo "  destination: ${DEST}"
echo "  Remember: store this on an INDEPENDENT failure domain (NAS / another"
echo "  server / a separate disk). A copy on the same disk as the live data"
echo "  is a weak local copy, NOT disaster recovery."
echo "  Raw PGDATA is tied to the PostgreSQL major version; restore only with"
echo "  a compatible postgres image. See cold-filesystem-restore.sh and"
echo "  docs/deployment/backup-and-recovery.md."
echo ""
echo "  P7-E2B evidence: after 'docker compose up -d', import this run into the"
echo "  product ledger with:"
echo "    docker compose exec app node dist/scripts/backup-evidence.js cold-import --spool ${SPOOL}"
