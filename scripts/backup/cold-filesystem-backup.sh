#!/usr/bin/env bash
# P7-C1 cold-filesystem backup helper.
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
#   - It refuses an obviously RUNNING source (P7-C corrective pass §7): if a
#     Compose db container is running OR a live `postmaster.pid` is present
#     in the actual PGDATA, it aborts before copying. Do not merely print
#     "make sure PostgreSQL is stopped" and copy anyway. The operator MUST
#     `docker compose down` first.
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
#   # 2. Run this script:     ./cold-filesystem-backup.sh ./data /mnt/nas/exam-backups/2026-08-10
#   # 3. Restart Exam:        docker compose up -d
set -euo pipefail

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
# are owned by the container postgres user, uid 999, and not readable by the
# host user). Locate the major-version subdir (e.g. 18/docker) and check for
# PG_VERSION + postgresql.conf.
PGDATA_SUBDIR="$(docker run --rm -v "${SRC_PG}:/pg:ro" alpine:latest \
  sh -c 'find /pg -maxdepth 3 -name PG_VERSION -print -quit 2>/dev/null || true')"
if [ -z "${PGDATA_SUBDIR}" ]; then
  echo "FAIL: no PG_VERSION found under ${SRC_PG}; does not look like a PGDATA tree." >&2
  exit 2
fi
PGDATA_DIR="$(dirname "${PGDATA_SUBDIR}")"
if ! docker run --rm -v "${SRC_PG}:/pg:ro" alpine:latest \
  sh -c "test -f '${PGDATA_DIR}/postgresql.conf'" 2>/dev/null; then
  echo "FAIL: postgresql.conf not found next to PG_VERSION at ${PGDATA_DIR}." >&2
  exit 2
fi

# ── P7-C corrective pass §7: refuse an obviously RUNNING source. ──
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
if docker run --rm -v "${SRC_PG}:/pg:ro" alpine:latest \
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
echo "  IMPORTANT: PostgreSQL must be STOPPED before this copy. A live copy"
echo "  of an active PGDATA is corrupt-prone and is NOT supported."
echo "  Stopped already? Press Enter to continue, or Ctrl-C to abort."
read -r _confirm

# Container-assisted copy preserves ownership/mode/symlinks. The PGDATA files
# are owned by the container postgres user (uid 999) and not readable by the
# host user, so a host-side cp -a would fail with EACCES. Equivalent to
# running `rsync -aHAX` or `tar | tar` as root on the host. Copy the
# COMPLETE postgres tree (never partial relation files) into ${DEST}/postgres.
echo "Copying COMPLETE postgres tree..."
docker run --rm \
  -v "${SRC_PG}:/from:ro" \
  -v "${DEST}/postgres:/to" \
  alpine:latest \
  sh -c 'cp -a /from/. /to/'

# Verify the copy landed and looks like a PGDATA (use find so we do not
# depend on path arithmetic between the /pg source mount and the /to dest
# mount). The backup layout mirrors the deployment data root, so PGDATA is
# at ${DEST}/postgres/18/docker/PG_VERSION (depth 4 from ${DEST}).
if ! docker run --rm -v "${DEST}:/to:ro" alpine:latest \
  sh -c 'find /to -maxdepth 4 -name PG_VERSION -print -quit 2>/dev/null | grep -q .'; then
  echo "FAIL: copy verification failed — PG_VERSION missing in destination." >&2
  exit 1
fi

echo ""
echo "Cold-filesystem backup COMPLETE."
echo "  destination: ${DEST}"
echo "  Remember: store this on an INDEPENDENT failure domain (NAS / another"
echo "  server / a separate disk). A copy on the same disk as the live data"
echo "  is a weak local copy, NOT disaster recovery."
echo "  Raw PGDATA is tied to the PostgreSQL major version; restore only with"
echo "  a compatible postgres image. See cold-filesystem-restore.sh and"
echo "  docs/deployment/backup-and-recovery.md."
