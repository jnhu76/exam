#!/usr/bin/env bash
# Logical backup / clean-restore verification suite (A present, B absent).
#
# Proves the most important property of the backup program: a backup can
# create a fresh working Exam with the expected state.
#
# Scenario:
#   isolated deployment (temp root, isolated project)
#       → docker compose up + bootstrap first Admin
#       → declare the RTO objective via PUT /system/ops-policy (3600 s)
#         BEFORE the drill — the declared objective is part of State A and
#         must survive the clean restore
#       → assert the pre-drill projection: desired=3600s, status=UNKNOWN
#         (no automated drill evidence exists yet)
#       → write State A marker + record invariants of State A
#       → postgres-logical-backup.sh  (online, pg_dump -Fc)
#       → mutate live source to State B (write marker B)
#       → stop API + worker; postgres-logical-restore.sh (CLEAN target)
#       → restart API
#       → assert marker A present and marker B ABSENT
#       → assert business invariants of State A are restored
#       → record the measured drill duration as automated evidence, then
#         GET /system/ops-policy — the restored projection (objective itself
#         survived restore) evaluates the evidence as SATISFIED
#
# The clean-target restore contract (DROP + recreate from template0, then
# pg_restore) produces an exact logical reconstruction of the dump, not a
# merge. All state lives in throwaway temp directories removed on exit
# (path-guarded). No human/dev database is touched.
#
# Usage: ./logical-backup-restore.sh
set -euo pipefail

SCRIPT_DIR="$(
  cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1
  pwd
)"
# shellcheck source=lib.sh
source "${SCRIPT_DIR}/lib.sh"

BACKUP_SH="${REPO_ROOT}/scripts/backup/postgres-logical-backup.sh"
RESTORE_SH="${REPO_ROOT}/scripts/backup/postgres-logical-restore.sh"
if [ ! -f "${COMPOSE_FILE}" ] || [ ! -x "${BACKUP_SH}" ] || [ ! -x "${RESTORE_SH}" ]; then
  echo "FAIL: required scripts not found." >&2
  exit 1
fi

RUN_TS="$(date +%s)"
PROJECT="logical-${RUN_TS}"
safe_temp_root logical-data ROOT
safe_temp_root logical-bp BACKUP_DIR_PARENT
BACKUP_DUMP="${BACKUP_DIR_PARENT}/stateA-${RUN_TS}.dump"
export EXAM_DATA_ROOT="${ROOT}"
export POSTGRES_PASSWORD="logical-pg-$(openssl rand -hex 6)"
export JWT_SECRET="logical-jwt-$(openssl rand -hex 16)"
ORIGIN="http://localhost:3000"
export CORS_ORIGIN="${ORIGIN}"
export PUBLIC_WEB_ORIGIN="${ORIGIN}"
ADMIN_USER="logicaldrill"
ADMIN_PASS="Logical-Drill-Admin-$(openssl rand -hex 4)"

CREATED_DIRS=("${ROOT}" "${BACKUP_DIR_PARENT}")

cleanup() {
  compose_down_best_effort "${PROJECT}"
  # Remove ONLY the temp roots this script created (safe_temp_root
  # registry-checked; container-assisted because PGDATA files are owned by
  # the container postgres user).
  for d in "${CREATED_DIRS[@]}"; do
    cleanup_temp_root "${d}"
  done
}
trap cleanup EXIT

probe() {
  probe_label "${PROJECT}" logical_probe markers "$1"
}
capture_state() {
  local biz
  biz="$(capture_business_invariants "${PROJECT}")"
  printf '%s|A=%s|B=%s\n' "${biz}" "$(probe A)" "$(probe B)"
}

echo "=== Logical backup / clean-restore suite (ts ${RUN_TS}) ==="

echo "--- start deployment; bootstrap first Admin ---"
run_compose "${PROJECT}" up -d --quiet-pull >/dev/null
wait_for_postgres "${PROJECT}"
wait_for_app "${PROJECT}"
bootstrap_admin "${PROJECT}" "${ADMIN_USER}" "${ADMIN_PASS}" "Logical Drill Admin" "Logical Drill Org"

# Declare the RTO objective BEFORE the drill (typed operational-policy
# intent). The backup below therefore carries the declared policy as part of
# State A; after restore the objective must have survived with it. Before
# any drill evidence exists, the product's own projection must truthfully
# say UNKNOWN — the suite proves the full UNKNOWN → SATISFIED arc.
echo "--- declare RTO objective before the drill (PUT /system/ops-policy) ---"
APP_C="$(app_container "${PROJECT}")"
docker exec -e ADMIN_USER="${ADMIN_USER}" -e ADMIN_PASS="${ADMIN_PASS}" "${APP_C}" node -e '
  const base = "http://127.0.0.1:3000/api";
  const fail = (m) => { console.error("  FAIL: " + m); process.exit(1); };
  (async () => {
    const login = await fetch(base + "/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({ username: process.env.ADMIN_USER, password: process.env.ADMIN_PASS }),
    });
    if (!login.ok) return fail("admin login HTTP " + login.status);
    const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
    if (!cookie.startsWith("auth-token=")) return fail("no auth-token cookie on login response");
    const put = await fetch(base + "/system/ops-policy", {
      method: "PUT",
      headers: { "content-type": "application/json", origin: "http://localhost:3000", cookie },
      body: JSON.stringify({
        desiredRpoSeconds: 3600,
        desiredRtoSeconds: 3600,
        desiredRetentionDays: 30,
        desiredDrillCadenceDays: 30,
        version: 0,
        reason: "P7-3 RTO acceptance drill (deterministic deployment suite)",
      }),
    });
    if (!put.ok) return fail("ops-policy PUT HTTP " + put.status + ": " + (await put.text()));
    const get = await fetch(base + "/system/ops-policy", { headers: { cookie } });
    if (!get.ok) return fail("ops-policy GET HTTP " + get.status);
    const rto = (await get.json()).compliance.rto;
    console.log("    compliance.rto: desired=" + rto.desired + " observed=" + rto.observed + " status=" + rto.status);
    if (rto.desired !== "3600s") return fail("rto.desired != 3600s (got " + rto.desired + ")");
    if (rto.status !== "UNKNOWN") return fail("rto.status != UNKNOWN before drill evidence (got " + rto.status + ")");
    console.log("  PASS: objective declared before the drill; projection truthfully UNKNOWN (no evidence yet)");
  })().catch((e) => fail(String((e && e.stack) || e)));
'

psql_exec "${PROJECT}" "CREATE SCHEMA IF NOT EXISTS logical_probe; CREATE TABLE IF NOT EXISTS logical_probe.markers (id text primary key, label text not null, written_at text not null);"
write_probe "${PROJECT}" logical_probe markers A "state-A-${RUN_TS}"
STATE_A="$(capture_state)"
echo "  State A: ${STATE_A}"

# The restore drill is timed from the start of the backup through restore,
# restart, and invariant verification — the measured span is recorded as
# automated drill evidence so the product's own RTO projection can evaluate it.
DRILL_START_MS="$(( $(date +%s) * 1000 ))"

echo "--- logical backup of State A (online; API stays up) ---"
bash "${BACKUP_SH}" "${PROJECT}" "${BACKUP_DUMP}" 2>&1 | sed 's/^/    /'
if [ ! -s "${BACKUP_DUMP}" ]; then
  echo "  FAIL: backup artifact empty." >&2
  exit 1
fi

echo "--- mutate live source to State B (write marker B) ---"
write_probe "${PROJECT}" logical_probe markers B "state-B-${RUN_TS}"
echo "  State B (live): $(capture_state)"

echo "--- stop API + worker; restore State A into CLEAN target 'exam' ---"
run_compose "${PROJECT}" stop app >/dev/null 2>&1 || true
echo "exam" | bash "${RESTORE_SH}" "${PROJECT}" "${BACKUP_DUMP}" exam 2>&1 | sed 's/^/    /'

echo "--- restart API; verify State A restored (A present, B ABSENT) ---"
run_compose "${PROJECT}" up -d --quiet-pull >/dev/null
wait_for_postgres "${PROJECT}"
wait_for_app "${PROJECT}"
STATE_RESTORED="$(capture_state)"
echo "  State restored: ${STATE_RESTORED}"

RESTORED_A="$(probe A)"
RESTORED_B="$(probe B)"
if [ "${RESTORED_A}" != "state-A-${RUN_TS}" ]; then
  echo "  FAIL: marker A not restored (got '${RESTORED_A}')." >&2
  exit 1
fi
if [ "${RESTORED_B}" != "ABSENT" ]; then
  echo "  FAIL: marker B (State-B-only) is present after restoring State A." >&2
  echo "         Clean-target restore did NOT remove dump-absent objects." >&2
  exit 1
fi
echo "  PASS: marker A present, marker B absent — exact logical replacement."

# Business invariants of State A are restored (org / admin / audit).
biz="$(capture_business_invariants "${PROJECT}")"
echo "  restored business invariants: ${biz}"
if [ "${biz}" != "orgs=1|admins=1|audit=1" ]; then
  echo "  FAIL: restored business invariants differ from State A." >&2
  exit 1
fi
echo "  PASS: business invariants restored (org/admin/audit match State A)."

# The restored Admin's password hash is authoritative credential evidence.
RESTORED_HASH="$(psql_exec "${PROJECT}" "SELECT password_hash FROM users WHERE username='${ADMIN_USER}' AND is_active=true AND role='Admin';" 2>/dev/null | head -1)"
if [ -z "${RESTORED_HASH}" ]; then
  echo "  FAIL: restored Admin row not found or inactive." >&2
  exit 1
fi
echo "  PASS: restored Admin row present with password hash."

DRILL_END_MS="$(( $(date +%s) * 1000 ))"
DRILL_DURATION_MS=$((DRILL_END_MS - DRILL_START_MS))
echo "  measured restore-drill duration: ${DRILL_DURATION_MS} ms"

echo "--- RTO acceptance: record automated drill evidence; product evaluates it ---"
APP_C="$(app_container "${PROJECT}")"
docker exec "${APP_C}" node dist/scripts/backup-evidence.js drill \
  --operation-id "logical-restore:${RUN_TS}" --backup-type logical \
  --result succeeded --source automated --duration-ms "${DRILL_DURATION_MS}" \
  2>&1 | sed 's/^/    /'

# The RTO objective (3600 s) was declared BEFORE the backup and restored with
# State A; this GET therefore asserts the objective survived the clean
# restore (desired=3600s) AND that the product's own compliance projection
# evaluates the automated drill evidence just recorded as SATISFIED.
docker exec -e ADMIN_USER="${ADMIN_USER}" -e ADMIN_PASS="${ADMIN_PASS}" \
  -e DRILL_DURATION_MS="${DRILL_DURATION_MS}" "${APP_C}" node -e '
  const base = "http://127.0.0.1:3000/api";
  const fail = (m) => { console.error("  FAIL: " + m); process.exit(1); };
  (async () => {
    const login = await fetch(base + "/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({ username: process.env.ADMIN_USER, password: process.env.ADMIN_PASS }),
    });
    if (!login.ok) return fail("admin login HTTP " + login.status);
    const cookie = (login.headers.get("set-cookie") || "").split(";")[0];
    if (!cookie.startsWith("auth-token=")) return fail("no auth-token cookie on login response");
    const get = await fetch(base + "/system/ops-policy", { headers: { cookie } });
    if (!get.ok) return fail("ops-policy GET HTTP " + get.status);
    const body = await get.json();
    const rto = body.compliance.rto;
    console.log("    compliance.rto: desired=" + rto.desired + " observed=" + rto.observed + " status=" + rto.status);
    console.log("    detail: " + rto.observedDetail);
    if (rto.desired !== "3600s") return fail("rto.desired != 3600s — declared objective did NOT survive restore (got " + rto.desired + ")");
    if (rto.observed !== process.env.DRILL_DURATION_MS + "ms") {
      return fail("rto.observed != recorded drill duration " + process.env.DRILL_DURATION_MS + "ms (got " + rto.observed + ")");
    }
    if (rto.status !== "SATISFIED") return fail("rto.status != SATISFIED");
    console.log("  PASS: objective survived restore; product-evaluated RTO compliance SATISFIED against declared RTO 3600s");
  })().catch((e) => fail(String((e && e.stack) || e)));
'

echo ""
echo "=== LOGICAL BACKUP / CLEAN-RESTORE SUITE: ALL CHECKS PASSED ==="
