#!/usr/bin/env bash
# PITR verification suite: WAL archiving, physical base backup, and
# point-in-time recovery — happy path plus the three failure contracts.
#
# Sections:
#   1. archive_command idempotency  — absent target → success; identical
#      retry → success; byte collision under the same name → failure.
#   2. happy PITR                   — base backup → State A → State B →
#      capture target LSN → State C → recover to the LSN → A present,
#      B present, C absent, promoted.
#   3. F1 missing REQUIRED WAL      — untouched base backup + complete
#      archive MINUS the one segment that must be replayed to reach an
#      explicit recovery_target_lsn → the target is NOT reached: the
#      cluster stays in archive recovery (pg_controldata state) with
#      visible restore_command failures for the missing segment and no
#      promotion within a bounded window. This proves "required archived
#      WAL missing", NOT the normal end-of-archive file-not-found that
#      routine recovery produces.
#   4. F2 corrupt base backup       — tamper one backed-up file →
#      pg_verifybackup rejects it.
#   5. F3 invalid recovery target   — malformed recovery_target_lsn →
#      PostgreSQL refuses recovery loudly.
#
# The source cluster enables WAL archiving through the SAME canonical
# operator command operators use (scripts/backup/postgres-enable-pitr.sh).
# Recovery clusters are started with the SAME canonical docker-compose.yml
# — no temporary Compose overrides: an isolated data root
# (EXAM_DATA_ROOT), an isolated WAL archive
# (EXAM_WAL_ARCHIVE_HOST_PATH), the deployment password, and an isolated
# COMPOSE_PROJECT_NAME are all the topology needs. Recovery-specific
# PostgreSQL configuration (recovery.signal, postgresql.auto.conf entries)
# is prepared in the recovery PGDATA, which is PostgreSQL recovery
# configuration, not Docker topology.
#
# All state lives in throwaway temp directories removed on exit
# (path-guarded). No human/dev database is touched.
#
# Usage: ./pitr.sh
set -euo pipefail

SCRIPT_DIR="$(
  cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1
  pwd
)"
# shellcheck source=lib.sh
source "${SCRIPT_DIR}/lib.sh"

BASEBACKUP_SH="${REPO_ROOT}/scripts/backup/pg-basebackup.sh"
ENABLE_PITR_SH="${REPO_ROOT}/scripts/backup/postgres-enable-pitr.sh"
if [ ! -f "${COMPOSE_FILE}" ] || [ ! -x "${BASEBACKUP_SH}" ] || [ ! -x "${ENABLE_PITR_SH}" ]; then
  echo "FAIL: required scripts not found." >&2
  exit 1
fi

RUN_TS="$(date +%s)"
PROJECT_SRC="pitr-src-${RUN_TS}"
PROJECT_REC="pitr-rec-${RUN_TS}"
SRC_ROOT="$(safe_temp_root pitr-src)"
REC_ROOT="$(safe_temp_root pitr-rec)"
BASEBACKUP_DIR_PARENT="$(safe_temp_root pitr-bb)"
BASEBACKUP_DIR="${BASEBACKUP_DIR_PARENT}/base-${RUN_TS}"

CREATED_DIRS=("${SRC_ROOT}" "${REC_ROOT}" "${BASEBACKUP_DIR_PARENT}")
PROJECTS=("${PROJECT_SRC}" "${PROJECT_REC}")
PASS_COUNT=0
FAIL_COUNT=0

cleanup() {
  for proj in "${PROJECTS[@]}"; do
    compose_down_best_effort "${proj}"
  done
  # Remove ONLY the temp roots this script created (safe_temp_root
  # registry-checked; container-assisted because PGDATA files are owned by
  # the container postgres user).
  for d in "${CREATED_DIRS[@]}"; do
    cleanup_temp_root "${d}"
  done
}
trap cleanup EXIT

export EXAM_DATA_ROOT="${SRC_ROOT}"
export POSTGRES_PASSWORD="pitr-pg-$(openssl rand -hex 6)"
export JWT_SECRET="pitr-jwt-$(openssl rand -hex 16)"
ORIGIN="http://localhost:3000"
export CORS_ORIGIN="${ORIGIN}"
export PUBLIC_WEB_ORIGIN="${ORIGIN}"
# Canonical WAL archive mount: an isolated subdir of the source root that
# survives container recreation and is portable to the recovery cluster.
export EXAM_WAL_ARCHIVE_HOST_PATH="${SRC_ROOT}/wal-archive"
mkdir -p "${SRC_ROOT}/wal-archive"
ADMIN_USER="pitradmin"
ADMIN_PASS="PITR-Admin-$(openssl rand -hex 4)"

pass() {
  echo "  [PASS] $1"
  PASS_COUNT=$((PASS_COUNT + 1))
}
fail() {
  echo "  [FAIL] $1" >&2
  FAIL_COUNT=$((FAIL_COUNT + 1))
}

echo "=== PITR suite: WAL archiving + physical backup + recovery (ts ${RUN_TS}) ==="

# ── 0. Source cluster + canonical WAL archiving ─────────────────────────
echo "--- start SOURCE cluster; enable WAL archiving via the canonical operator script ---"
run_compose "${PROJECT_SRC}" up -d --quiet-pull db >/dev/null
wait_for_postgres "${PROJECT_SRC}"
bash "${ENABLE_PITR_SH}" "${PROJECT_SRC}" "${COMPOSE_FILE}" 2>&1 | sed 's/^/    /'
ARCHIVE_MODE_VAL="$(psql_exec "${PROJECT_SRC}" "SHOW archive_mode;" | tr -d '[:space:]')"
if [ "${ARCHIVE_MODE_VAL}" != "on" ]; then
  echo "FAIL: archive_mode is '${ARCHIVE_MODE_VAL}', expected 'on'." >&2
  exit 1
fi
echo "  PASS: archive_mode=on (via canonical postgres-enable-pitr.sh)."

# ── 1. archive_command idempotency (three cases, real segment) ───────────
echo ""
echo "--- 1. archive_command idempotency: absent / identical retry / byte collision ---"
ACMD="$(psql_exec "${PROJECT_SRC}" "SHOW archive_command;" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
echo "  configured archive_command: ${ACMD}"
WAL_FILE="$(docker exec "$(db_container "${PROJECT_SRC}")" sh -c 'ls -1 /wal-archive/0* 2>/dev/null | head -1')"
if [ -z "${WAL_FILE}" ]; then
  echo "FAIL: no archived WAL segment found in /wal-archive (archiver proof)." >&2
  exit 1
fi
WAL_NAME="$(basename "${WAL_FILE}")"
echo "  using real archived segment: ${WAL_NAME}"
docker exec "$(db_container "${PROJECT_SRC}")" sh -c "cp '${WAL_FILE}' /tmp/idem-source"

run_idem_case() {
  local name="$1" src="$2" tgt="$3" expect="$4"
  local out
  out="$(docker exec "$(db_container "${PROJECT_SRC}")" sh -c "
    SRC='${src}'; TGT='${tgt}'
    cmd=\"${ACMD}\"
    cmd=\$(echo \"\$cmd\" | sed \"s|%p|\$SRC|g; s|%f|\$TGT|g\")
    eval \"\$cmd\" >/dev/null 2>&1 && echo OK || echo FAIL
  ")"
  if [ "${out}" = "${expect}" ]; then
    pass "archive idempotency ${name}: expected ${expect}, got ${out}"
  else
    fail "archive idempotency ${name}: expected ${expect}, got ${out}"
  fi
}
docker exec "$(db_container "${PROJECT_SRC}")" sh -c "rm -f /wal-archive/IDEM-CASE1"
run_idem_case "absent-target" "/tmp/idem-source" "IDEM-CASE1" "OK"
run_idem_case "identical-retry" "/tmp/idem-source" "IDEM-CASE1" "OK"
docker exec "$(db_container "${PROJECT_SRC}")" sh -c "printf 'different-bytes-collision' > /tmp/idem-other"
run_idem_case "byte-collision" "/tmp/idem-other" "IDEM-CASE1" "FAIL"
docker exec "$(db_container "${PROJECT_SRC}")" sh -c "rm -f /tmp/idem-source /tmp/idem-other /wal-archive/IDEM-CASE1" 2>/dev/null || true

# ── 2. Bootstrap + base backup + deterministic state markers ─────────────
echo ""
echo "--- 2. bootstrap first Admin; write State A; take physical base backup ---"
run_compose "${PROJECT_SRC}" up -d --quiet-pull app email-worker >/dev/null
wait_for_app "${PROJECT_SRC}"
bootstrap_admin "${PROJECT_SRC}" "${ADMIN_USER}" "${ADMIN_PASS}" "PITR Admin" "PITR Org"
psql_exec "${PROJECT_SRC}" "CREATE SCHEMA IF NOT EXISTS pitr_probe;"
psql_exec "${PROJECT_SRC}" "CREATE TABLE IF NOT EXISTS pitr_probe.markers (id text primary key, label text not null, written_at text not null);"
write_probe "${PROJECT_SRC}" pitr_probe markers A "state-A-${RUN_TS}"
psql_exec "${PROJECT_SRC}" "SELECT pg_switch_wal();" >/dev/null
echo "  State A written (pre-base-backup marker)."

bash "${BASEBACKUP_SH}" "${PROJECT_SRC}" "${BASEBACKUP_DIR}" 2>&1 | sed 's/^/    /'
if [ ! -d "${BASEBACKUP_DIR}" ] || [ ! -f "${BASEBACKUP_DIR}/backup_manifest" ]; then
  echo "FAIL: base backup incomplete (no backup_manifest)." >&2
  exit 1
fi
echo "  PASS: pg_basebackup produced a verified base backup (manifest present)."

echo ""
echo "--- 3. post-base State A, State B + explicit target LSN, State C ---"
# post-base State A: written AFTER the base backup, so recovery must replay
# archived WAL to see it (not just the base backup).
write_probe "${PROJECT_SRC}" pitr_probe markers A1 "state-A1-${RUN_TS}"
SEG_A="$(psql_exec "${PROJECT_SRC}" "SELECT pg_walfile_name(pg_current_wal_lsn());" | tr -d '[:space:]')"
psql_exec "${PROJECT_SRC}" "SELECT pg_switch_wal();" >/dev/null
wait_for_archived_wal "${PROJECT_SRC}" "${SEG_A}"
echo "  post-base State A written; segment ${SEG_A} archived."

# State B + explicit recovery target AFTER B.
write_probe "${PROJECT_SRC}" pitr_probe markers B "state-B-${RUN_TS}"
TARGET_LSN="$(psql_exec "${PROJECT_SRC}" "SELECT pg_current_wal_lsn();" | tr -d '[:space:]')"
SEG_B="$(psql_exec "${PROJECT_SRC}" "SELECT pg_walfile_name('${TARGET_LSN}');" | tr -d '[:space:]')"
psql_exec "${PROJECT_SRC}" "SELECT pg_switch_wal();" >/dev/null
wait_for_archived_wal "${PROJECT_SRC}" "${SEG_B}"
echo "  State B written; recovery target LSN='${TARGET_LSN}' (segment ${SEG_B}) archived."

# Later State C (destructive, strictly after the target).
write_probe "${PROJECT_SRC}" pitr_probe markers C "state-C-destructive-${RUN_TS}"
SEG_C="$(psql_exec "${PROJECT_SRC}" "SELECT pg_walfile_name(pg_current_wal_lsn());" | tr -d '[:space:]')"
psql_exec "${PROJECT_SRC}" "SELECT pg_switch_wal();" >/dev/null
wait_for_archived_wal "${PROJECT_SRC}" "${SEG_C}"
echo "  State C written; segment ${SEG_C} archived."

# ── Recovery-run helpers ────────────────────────────────────────────────
# Prepare a recovery PGDATA at ${rec_root}/postgres/${PG_MAJOR}/docker from the
# UNTOUCHED base backup; optionally copy the WAL archive (minus an optional
# excluded segment); write recovery.signal + recovery conf. $1 = rec root,
# $2 = archive dir to copy from ("" = skip archive), $3 = optional segment
# to exclude from the copy, $4 = recovery_target_lsn value.
prepare_recovery() {
  local rec_root="$1" archive_src="$2" exclude_seg="$3" target="$4"
  mkdir -p "${rec_root}/postgres/${PG_MAJOR}/docker" "${rec_root}/wal-archive"
  docker run --rm \
    -v "${BASEBACKUP_DIR}:/from:ro" \
    -v "${rec_root}/postgres/${PG_MAJOR}/docker:/to" \
    alpine:latest sh -c 'rm -rf /to/* 2>/dev/null; cp -a /from/. /to/'
  if [ -n "${archive_src}" ]; then
    if [ -n "${exclude_seg}" ]; then
      docker run --rm \
        -v "${archive_src}:/from:ro" \
        -v "${rec_root}/wal-archive:/to" \
        alpine:latest sh -c "cp -a /from/. /to/ 2>/dev/null; rm -f /to/${exclude_seg} || true"
    else
      docker run --rm \
        -v "${archive_src}:/from:ro" \
        -v "${rec_root}/wal-archive:/to" \
        alpine:latest sh -c 'cp -a /from/. /to/ 2>/dev/null || true'
    fi
  fi
  docker run --rm -v "${rec_root}/postgres/${PG_MAJOR}/docker:/pg" alpine:latest sh -c 'touch /pg/recovery.signal'
  docker run --rm -v "${rec_root}/postgres/${PG_MAJOR}/docker:/pg" alpine:latest sh -c "
cat >> /pg/postgresql.auto.conf <<CONF
restore_command = 'cp /wal-archive/%f %p'
recovery_target_lsn = '${target}'
recovery_target_inclusive = on
recovery_target_action = 'promote'
CONF
"
}

# Start a recovery cluster from its root via the CANONICAL compose file
# (isolated project, data root, WAL archive, password — no override file).
start_recovery() {
  local rec_root="$1" project="$2"
  mkdir -p "${rec_root}"
  EXAM_DATA_ROOT="${rec_root}" \
    EXAM_WAL_ARCHIVE_HOST_PATH="${rec_root}/wal-archive" \
    POSTGRES_PASSWORD="${POSTGRES_PASSWORD}" \
    run_compose "${project}" up -d --quiet-pull db >/dev/null
}

# ── 4. Happy PITR: recover to the captured LSN ───────────────────────────
echo ""
echo "--- 4. happy PITR: recover to LSN ${TARGET_LSN} (A present, B present, C absent) ---"
REC_HAPPY="$(safe_temp_root pitr-rec)"
CREATED_DIRS+=("${REC_HAPPY}")
PROJECTS+=("${PROJECT_REC}-happy")
prepare_recovery "${REC_HAPPY}" "${SRC_ROOT}/wal-archive" "" "${TARGET_LSN}"
start_recovery "${REC_HAPPY}" "${PROJECT_REC}-happy"
wait_for_postgres "${PROJECT_REC}-happy"
echo "  waiting for recovery to reach the target and promote..."
for _ in $(seq 1 60); do
  PROMOTED="$(psql_exec "${PROJECT_REC}-happy" "SELECT NOT pg_is_in_recovery();" 2>/dev/null | tr -d '[:space:]' || true)"
  if [ "${PROMOTED}" = "t" ]; then
    break
  fi
  sleep 1
done
if [ "${PROMOTED}" != "t" ]; then
  echo "FAIL: happy recovery never promoted." >&2
  compose_logs "${PROJECT_REC}-happy" db >&2
  exit 1
fi
RESTORED_A="$(probe_label "${PROJECT_REC}-happy" pitr_probe markers A)"
RESTORED_A1="$(probe_label "${PROJECT_REC}-happy" pitr_probe markers A1)"
RESTORED_B="$(probe_label "${PROJECT_REC}-happy" pitr_probe markers B)"
RESTORED_C="$(probe_label "${PROJECT_REC}-happy" pitr_probe markers C)"
echo "  marker A: '${RESTORED_A}'  A1: '${RESTORED_A1}'  B: '${RESTORED_B}'  C: '${RESTORED_C}'"
if [ "${RESTORED_A}" != "state-A-${RUN_TS}" ] || [ "${RESTORED_A1}" != "state-A1-${RUN_TS}" ]; then
  fail "happy PITR — pre/post-base State A not present after recovery"
elif [ "${RESTORED_B}" != "state-B-${RUN_TS}" ]; then
  fail "happy PITR — State B not present (target was after B)"
elif [ "${RESTORED_C}" != "ABSENT" ]; then
  fail "happy PITR — destructive State C (after target) is present"
else
  pass "happy PITR — recovered to target: A + A1 + B present, C absent, promoted"
fi
compose_down_best_effort "${PROJECT_REC}-happy"

# ── 5. F1: missing REQUIRED archived WAL → target unreachable ────────────
echo ""
echo "--- 5. F1: remove ONE required archived WAL segment (${SEG_B}); target must be UNREACHABLE ---"
# The base backup is UNTOUCHED; the archive is complete EXCEPT for the one
# segment that must be replayed to reach the explicit recovery target. The
# assertion is about failing to REACH THE TARGET, NOT about restore_command
# returning file-not-found (which is normal at the end of ANY archive):
#   - restore_command failures for the missing segment are visible (loud);
#   - the promotion message ("database system is ready to accept
#     connections") NEVER appears within a bounded window that comfortably
#     exceeds happy-path promotion time — recovery did not complete;
#   - pg_controldata still reports the cluster "in archive recovery" — the
#     definitive proof that the target was not reached and the server is
#     still waiting for the missing WAL.
REC_MISS="$(safe_temp_root pitr-miss)"
CREATED_DIRS+=("${REC_MISS}")
PROJECTS+=("${PROJECT_REC}-miss")
prepare_recovery "${REC_MISS}" "${SRC_ROOT}/wal-archive" "${SEG_B}" "${TARGET_LSN}"
start_recovery "${REC_MISS}" "${PROJECT_REC}-miss"
# The cluster reaches a consistent state, replays every available segment,
# then WAITS for the missing one — it never promotes and never serves the
# target (a PITR recovery cluster does not open for queries until the
# target is reached).
LOG_EVIDENCE="no"
for _ in $(seq 1 60); do
  MISS_LOGS="$(run_compose "${PROJECT_REC}-miss" logs --tail=200 db 2>&1 || true)"
  if printf '%s' "${MISS_LOGS}" | grep -Eq "${SEG_B}|could not restore file|No such file"; then
    LOG_EVIDENCE="yes"
    break
  fi
  sleep 1
done
# Recovery must NOT complete: the ready-to-accept-connections message would
# mean the target WAS reached (or recovery ended) — a hard failure of the
# "required WAL missing" premise. The happy path promotes within seconds of
# the recovery reaching the gap, so a 30s window comfortably exceeds any
# incorrect-promotion time while keeping the passing path fast.
PROMOTED_EARLY="no"
for _ in $(seq 1 30); do
  MISS_LOGS="$(run_compose "${PROJECT_REC}-miss" logs --tail=200 db 2>&1 || true)"
  if printf '%s' "${MISS_LOGS}" | grep -q "database system is ready to accept connections"; then
    PROMOTED_EARLY="yes"
    break
  fi
  sleep 1
done
# pg_controldata on the recovery PGDATA: the authoritative on-disk recovery
# state. "in archive recovery" = still waiting for the target (unreachable);
# "in production" would mean recovery ended (target reached).
CTL_STATE="$(docker run --rm -v "${REC_MISS}/postgres/${PG_MAJOR}/docker:/pg" \
  "${PG_IMAGE}" pg_controldata /pg 2>/dev/null \
  | sed -n 's/^Database cluster state:[[:space:]]*//p' | tr -d '[:space:]' || true)"
echo "  restore-failure evidence=${LOG_EVIDENCE} promoted-early=${PROMOTED_EARLY}"
echo "  pg_controldata state: '${CTL_STATE}' (expected 'inarchiverecovery')"
if [ "${LOG_EVIDENCE}" != "yes" ]; then
  fail "F1 missing REQUIRED WAL — no restore_command failure evidence for '${SEG_B}' in logs"
elif [ "${PROMOTED_EARLY}" = "yes" ]; then
  fail "F1 missing REQUIRED WAL — recovery COMPLETED despite the missing segment (target premise broken)"
elif [ "${CTL_STATE}" != "inarchiverecovery" ]; then
  fail "F1 missing REQUIRED WAL — cluster not in archive recovery at window end (state='${CTL_STATE}')"
else
  pass "F1 missing REQUIRED WAL — target unreachable: recovery still in archive recovery, missing-segment failures visible, no promotion"
fi
compose_down_best_effort "${PROJECT_REC}-miss"

# ── 6. F2: corrupt base backup → pg_verifybackup rejects ─────────────────
echo ""
echo "--- 6. F2: corrupt one base-backup file; pg_verifybackup MUST reject ---"
CORRUPT_DIR="${BASEBACKUP_DIR_PARENT}/corrupt-${RUN_TS}"
docker run --rm \
  -v "${BASEBACKUP_DIR}:/from:ro" \
  -v "${CORRUPT_DIR}:/to" \
  alpine:latest sh -c 'cp -a /from/. /to/'
# Flip one byte of PG_VERSION (always present, small, listed in the
# manifest) — invalidates its SHA256 manifest checksum.
TARGET_FILE="$(docker run --rm -v "${CORRUPT_DIR}:/d:ro" alpine:latest \
  sh -c 'find /d -type f -name PG_VERSION | head -1')"
if [ -z "${TARGET_FILE}" ]; then
  fail "F2 corrupt-backup detection (setup — no PG_VERSION found)"
else
  REL="${TARGET_FILE#/d}"
  docker run --rm -v "${CORRUPT_DIR}:/d" alpine:latest \
    sh -c "printf '\\x00' | dd of=/d${REL} bs=1 count=1 conv=notrunc seek=0 2>/dev/null || true"
  VRF_OUT="$(docker run --rm -v "${CORRUPT_DIR}:/d:ro" \
    "${PG_IMAGE}" pg_verifybackup /d 2>&1 || true)"
  if docker run --rm -v "${CORRUPT_DIR}:/d:ro" \
      "${PG_IMAGE}" pg_verifybackup /d >/dev/null 2>&1; then
    fail "F2 corrupt base backup — pg_verifybackup accepted a tampered file"
  else
    if printf '%s' "${VRF_OUT}" | grep -Eqi 'verify|mismatch|checksum|does not match|invalid|failed|extra|missing'; then
      pass "F2 corrupt base backup — pg_verifybackup rejected the tampered file: $(printf '%s' "${VRF_OUT}" | tr '\n' ' ' | cut -c1-140)"
    else
      pass "F2 corrupt base backup — pg_verifybackup exited non-zero (loud failure)"
    fi
  fi
fi

# ── 7. F3: invalid recovery target → refused loudly ──────────────────────
echo ""
echo "--- 7. F3: malformed recovery_target_lsn; PostgreSQL MUST refuse loudly ---"
REC_INV="$(safe_temp_root pitr-inv)"
CREATED_DIRS+=("${REC_INV}")
PROJECTS+=("${PROJECT_REC}-inv")
prepare_recovery "${REC_INV}" "${SRC_ROOT}/wal-archive" "" "THIS-IS-NOT-A-VALID-LSN"
start_recovery "${REC_INV}" "${PROJECT_REC}-inv"
REFUSED="no"
for _ in $(seq 1 30); do
  INV_LOGS="$(run_compose "${PROJECT_REC}-inv" logs --tail=200 db 2>&1 || true)"
  if printf '%s' "${INV_LOGS}" | grep -Eqi 'invalid value for recovery parameter|invalid recovery_target_lsn|could not parse|invalid LSN|invalid WAL location|unrecognized|FATAL'; then
    REFUSED="yes"
    break
  fi
  if docker exec "$(db_container "${PROJECT_REC}-inv" 2>/dev/null || true)" pg_isready -U exam -d exam >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
if [ "${REFUSED}" = "yes" ]; then
  pass "F3 invalid recovery target — PostgreSQL refused recovery loudly: $(printf '%s' "${INV_LOGS}" | grep -Eim1 'invalid|FATAL|could not parse' | tr '\n' ' ' | cut -c1-140)"
elif docker exec "$(db_container "${PROJECT_REC}-inv" 2>/dev/null || true)" pg_isready -U exam -d exam >/dev/null 2>&1; then
  fail "F3 invalid recovery target — recovery cluster became ready despite the malformed target"
else
  # Never became ready AND no matching log keyword — still a refused start,
  # but classify it accurately (we did not observe the specific error).
  fail "F3 invalid recovery target — cluster refused to start but no specific error keyword observed"
fi
compose_down_best_effort "${PROJECT_REC}-inv"

echo ""
echo "=== PITR SUITE SUMMARY ==="
echo "  passed: ${PASS_COUNT}"
echo "  failed: ${FAIL_COUNT}"
if [ "${FAIL_COUNT}" -ne 0 ]; then
  echo "  RESULT: FAIL" >&2
  exit 1
fi
echo "  RESULT: PASS"
echo "=== PITR SUITE: ALL CHECKS PASSED ==="
