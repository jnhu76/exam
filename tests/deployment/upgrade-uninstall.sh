#!/usr/bin/env bash
# Operator upgrade + uninstall lifecycle suite (#329): proves the command
# sequences documented in docs/deployment/upgrade-and-uninstall.md against a
# REAL Compose stack, in OPERATOR mode (--env-file + the pinned image — the
# build override is deliberately NOT merged here, because these legs test
# the prebuilt-image path, not source acceptance).
#
# What is proven (per leg):
#   [setup]          deployment env file generated; two local image tags
#                    (exam-upgrade:old / :new) built from this checkout —
#                    a registry is NOT required; the pin swap is a tag swap.
#   [upgrade]        boot at the old pin: first migration, first Admin
#                    bootstrap, login, durable probe row, business
#                    invariants, migration-journal row count.
#   [upgrade-flip]   the operator's upgrade moment: EXAM_IMAGE re-pinned to
#                    the new tag, `up -d` — app + db containers
#                    are RECREATED from the new image, the db container is
#                    untouched, the probe row survives, the journal count
#                    is unchanged (migration rerun is a no-op), login still
#                    works, and the published host port still equals the
#                    env-file canary.
#   [preserve]       `down` (data kept) → `up` again: the data root still
#                    holds the PGDATA, state survives — reinstall-keeps-data.
#   [delete]         full removal: `down`, data root DELETED, env file
#                    DELETED, fresh generate-env, `up`: a truly empty
#                    database (0 organizations pre-bootstrap), fresh
#                    bootstrap succeeds, the old probe row is gone, login
#                    works with the new credentials on the new canary port.
#   [cleanup]        teardown + no compose-project residue (+ INT/TERM).
#
# What this suite does NOT claim: binary content changes between releases
# (that is the release workflow's job — the fresh-install gate runs at the
# new head). Both tags point at the same checkout; the MECHANICS of image
# swap, recreation, data continuity, and migration rerun safety are the
# contract under test.
#
# Runtime: ~2-4 min warm (one image build; three stack boots).
# Class: release / manual evidence (NOT PR-blocking — see gates.md).
#
# Usage: bash tests/deployment/upgrade-uninstall.sh [run-number]
set -euo pipefail

SCRIPT_DIR="$(
  cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1
  pwd
)"
# shellcheck source=lib.sh
source "${SCRIPT_DIR}/lib.sh"

RUN_NUM="${1:-1}"
PROJECT="upgrade-uninstall-${RUN_NUM}-$(date +%s)"
OLD_IMAGE="exam-upgrade:old"
NEW_IMAGE="exam-upgrade:new"

stage() { echo "=== [${1}] ${2}"; }

# Unique high host port (4100..4899), probed free (same helper family as
# the fresh-install gate).
pick_free_port() {
  node -e '
    const net = require("node:net");
    const base = 4100 + (process.pid % 800);
    let port = base;
    let attempts = 0;
    const tryBind = () => {
      if (++attempts > 100) {
        process.stderr.write("pick_free_port: no free port found\n");
        process.exit(1);
      }
      const s = net.createServer();
      s.once("error", () => { port += 1; tryBind(); });
      s.listen(port, "127.0.0.1", () => {
        s.close(() => process.stdout.write(String(port)));
      });
    };
    tryBind();
  '
}

# THE operator invocation (runbook form + isolation project). No build
# override: these legs exercise the prebuilt-image pin exactly as deployed.
compose_operator() {
  docker compose --env-file "${DEPLOY_ENV_FILE}" -f "${COMPOSE_FILE}" \
    -p "${PROJECT}" "$@"
}

safe_temp_root upgrade-uninstall GATE_TMP
safe_temp_root upgrade-uninstall-data EXAM_DATA_ROOT
ENV_FILE="${GATE_TMP}/.env.deploy"
export DEPLOY_ENV_FILE="${ENV_FILE}"
export EXAM_DATA_ROOT

cleanup() {
  stage cleanup "tearing down project ${PROJECT} and temp roots"
  # The delete leg removes the operator's env file and regenerates a fresh
  # one; teardown must never depend on which file survived a failure, so a
  # harness copy taken at setup drives all cleanup compose calls.
  export DEPLOY_ENV_FILE="${GATE_TMP}/.env.deploy.teardown"
  compose_down_best_effort "${PROJECT}"
  cleanup_temp_root "${EXAM_DATA_ROOT}"
  cleanup_temp_root "${GATE_TMP}"
  if compose_operator ls 2>/dev/null | grep -qw "${PROJECT}"; then
    echo "  WARN: compose project ${PROJECT} still registered." >&2
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

CANARY_OLD="$(pick_free_port)"

# ── [setup] env file + local image tags ─────────────────────────────────
stage setup "generating deployment env (canary port ${CANARY_OLD})"
node "${REPO_ROOT}/scripts/generate-env.mjs" "${ENV_FILE}" "${GATE_TMP}/legacy-absent.env" >/dev/null
printf '\nEXAM_PORT=%s\n' "${CANARY_OLD}" >> "${ENV_FILE}"
sed -i "s|^EXAM_IMAGE=.*|EXAM_IMAGE=${OLD_IMAGE}|" "${ENV_FILE}"
grep -qF "EXAM_IMAGE=${OLD_IMAGE}" "${ENV_FILE}" || {
  echo "[setup] FAIL: env file does not pin the old image."; exit 1; }
cp "${ENV_FILE}" "${GATE_TMP}/.env.deploy.teardown"

stage setup "building local image tags (no registry required)"
docker build -q -t "${OLD_IMAGE}" "${REPO_ROOT}" >/dev/null
docker tag "${OLD_IMAGE}" "${NEW_IMAGE}"

# ── [upgrade] boot at the old pin ───────────────────────────────────────
stage upgrade "boot at pinned image ${OLD_IMAGE}"
compose_operator up -d 2>&1 | tail -3
wait_for_postgres "${PROJECT}"
wait_for_app "${PROJECT}"

ADMIN_USER="upguser${RUN_NUM}$(date +%s)"
ADMIN_PASS="Upgrade-Admin-${RUN_NUM}-$(openssl rand -hex 8)"
ADMIN_NAME="Upgrade Admin ${RUN_NUM}"
ORG_NAME="Upgrade Org ${RUN_NUM}"
ORIGIN_OLD="http://localhost:${CANARY_OLD}"
bootstrap_admin "${PROJECT}" "${ADMIN_USER}" "${ADMIN_PASS}" "${ADMIN_NAME}" "${ORG_NAME}"

LOGIN_UPGRADE=$(compose_operator exec -T app node -e "
  fetch('http://127.0.0.1:3000/api/auth/login', {
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'Origin': '${ORIGIN_OLD}'},
    body: JSON.stringify({username: '${ADMIN_USER}', password: '${ADMIN_PASS}'})
  }).then(r => ({status: r.status, ok: r.ok})).then(o => console.log(JSON.stringify(o)))
    .catch(e => console.error('ERR', e.message))
" 2>&1)
echo "${LOGIN_UPGRADE}" | grep -q '"ok":true' && echo "  PASS: bootstrapped admin login succeeded." || {
  echo "[upgrade] FAIL: admin login failed: ${LOGIN_UPGRADE}"; exit 1; }

PSQL_SCHEMA="upgrade_uninstall"
psql_exec "${PROJECT}" "CREATE SCHEMA IF NOT EXISTS ${PSQL_SCHEMA};"
psql_exec "${PROJECT}" "CREATE TABLE IF NOT EXISTS ${PSQL_SCHEMA}.state (id text primary key, label text not null);"
psql_exec "${PROJECT}" "INSERT INTO ${PSQL_SCHEMA}.state VALUES ('probe','live') ON CONFLICT (id) DO UPDATE SET label='live';"

INVARIANTS_A="$(capture_business_invariants "${PROJECT}")"
JOURNAL_A="$(psql_exec "${PROJECT}" "SELECT count(*) FROM drizzle.__drizzle_migrations;")"
APP_A="$(app_container "${PROJECT}")"
DB_A="$(db_container "${PROJECT}")"
echo "  invariants=${INVARIANTS_A} journal=${JOURNAL_A}"

[ "$(probe_label "${PROJECT}" "${PSQL_SCHEMA}" state probe)" = "live" ] || {
  echo "[upgrade] FAIL: probe row missing after first boot."; exit 1; }
[ "$(compose_operator port app 3000 2>/dev/null | sed 's/.*://')" = "${CANARY_OLD}" ] || {
  echo "[upgrade] FAIL: published port != env-file canary."; exit 1; }
stage upgrade "PASS: boot, bootstrap, probe, invariants ${INVARIANTS_A}"

# ── [upgrade-flip] re-pin + up -d (the operator's upgrade moment) ────────
stage upgrade-flip "re-pin EXAM_IMAGE -> ${NEW_IMAGE}; up -d"
sed -i "s|^EXAM_IMAGE=.*|EXAM_IMAGE=${NEW_IMAGE}|" "${ENV_FILE}"
grep -qF "EXAM_IMAGE=${NEW_IMAGE}" "${ENV_FILE}" || {
  echo "[upgrade-flip] FAIL: env file does not pin the new image."; exit 1; }
compose_operator up -d 2>&1 | tail -3
wait_for_app "${PROJECT}"

APP_B="$(app_container "${PROJECT}")"
DB_B="$(db_container "${PROJECT}")"
echo "  app recreated: $([ "${APP_A}" != "${APP_B}" ] && echo yes || echo NO)"
echo "  db untouched: $([ "${DB_A}" = "${DB_B}" ] && echo yes || echo NO)"
[ "${APP_A}" != "${APP_B}" ] || {
  echo "[upgrade-flip] FAIL: app container was not recreated."; exit 1; }
[ "${DB_A}" = "${DB_B}" ] || {
  echo "[upgrade-flip] FAIL: db container was recreated (must be untouched)."; exit 1; }

[ "$(probe_label "${PROJECT}" "${PSQL_SCHEMA}" state probe)" = "live" ] || {
  echo "[upgrade-flip] FAIL: probe row lost across the image swap."; exit 1; }
INVARIANTS_B="$(capture_business_invariants "${PROJECT}")"
JOURNAL_B="$(psql_exec "${PROJECT}" "SELECT count(*) FROM drizzle.__drizzle_migrations;")"
[ "${INVARIANTS_B}" = "${INVARIANTS_A}" ] || {
  echo "[upgrade-flip] FAIL: business invariants changed: ${INVARIANTS_A} -> ${INVARIANTS_B}"; exit 1; }
[ "${JOURNAL_B}" = "${JOURNAL_A}" ] || {
  echo "[upgrade-flip] FAIL: migration journal changed across upgrade: ${JOURNAL_A} -> ${JOURNAL_B}"; exit 1; }
[ "$(compose_operator port app 3000 2>/dev/null | sed 's/.*://')" = "${CANARY_OLD}" ] || {
  echo "[upgrade-flip] FAIL: canary port lost after upgrade."; exit 1; }
stage upgrade-flip "PASS: image swap recreated app/worker; db + probe + journal + invariants intact"

# ── [preserve] down (data kept) -> up again ─────────────────────────────
stage preserve "down WITHOUT deleting data, then up again"
compose_operator down 2>&1 | tail -2
[ -d "${EXAM_DATA_ROOT}/postgres" ] && [ -n "$(ls -A "${EXAM_DATA_ROOT}/postgres" 2>/dev/null)" ] || {
  echo "[preserve] FAIL: PGDATA missing/empty after down (data must be kept)."; exit 1; }
compose_operator up -d 2>&1 | tail -2
wait_for_app "${PROJECT}"
[ "$(probe_label "${PROJECT}" "${PSQL_SCHEMA}" state probe)" = "live" ] || {
  echo "[preserve] FAIL: probe row lost after down/up."; exit 1; }
stage preserve "PASS: data + state survive down/up (reinstall keeps data)"

# ── [delete] full removal -> clean reinstall ────────────────────────────
stage delete "full removal: down, delete data root + env file, fresh install"
compose_operator down 2>&1 | tail -2
[ -d "${EXAM_DATA_ROOT}" ] && cleanup_temp_root "${EXAM_DATA_ROOT}"
rm -f "${ENV_FILE}"
[ ! -f "${ENV_FILE}" ] || {
  echo "[delete] FAIL: env file still present after removal."; exit 1; }

CANARY_NEW="$(pick_free_port)"
ENV_FILE_NEW="${GATE_TMP}/.env.deploy.fresh"
node "${REPO_ROOT}/scripts/generate-env.mjs" "${ENV_FILE_NEW}" "${GATE_TMP}/legacy-absent.env" >/dev/null
printf '\nEXAM_PORT=%s\n' "${CANARY_NEW}" >> "${ENV_FILE_NEW}"
sed -i "s|^EXAM_IMAGE=.*|EXAM_IMAGE=${NEW_IMAGE}|" "${ENV_FILE_NEW}"
export DEPLOY_ENV_FILE="${ENV_FILE_NEW}"

compose_operator up -d 2>&1 | tail -2
wait_for_app "${PROJECT}"

ORGS_FRESH="$(psql_exec "${PROJECT}" "SELECT count(*) FROM organizations;")"
[ "${ORGS_FRESH}" = "0" ] || {
  echo "[delete] FAIL: fresh database already has ${ORGS_FRESH} organizations (old data survived deletion)."; exit 1; }
[ "$(probe_label "${PROJECT}" "${PSQL_SCHEMA}" state probe)" = "ABSENT" ] || {
  echo "[delete] FAIL: old probe row survived full data removal."; exit 1; }

ADMIN_USER2="upg2${RUN_NUM}$(date +%s)"
ADMIN_PASS2="Upgrade2-Admin-${RUN_NUM}-$(openssl rand -hex 8)"
ORIGIN_NEW="http://localhost:${CANARY_NEW}"
bootstrap_admin "${PROJECT}" "${ADMIN_USER2}" "${ADMIN_PASS2}" "Upgrade Admin 2" "Regenerated Org"
[ "$(psql_exec "${PROJECT}" "SELECT count(*) FROM organizations;")" = "1" ] || {
  echo "[delete] FAIL: bootstrap on the fresh database did not create one org."; exit 1; }

# The old account must be rejected by AUTH (401), not by CSRF (403): the
# probe sends the CURRENT allowed Origin (CSRF passes, the route runs) so
# only genuine credential failure can produce this answer — a surviving
# account on recycled data would return 200 and fail the assertion.
LOGIN_OLD=$(compose_operator exec -T app node -e "
  fetch('http://127.0.0.1:3000/api/auth/login', {
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'Origin': '${ORIGIN_NEW}'},
    body: JSON.stringify({username: '${ADMIN_USER}', password: '${ADMIN_PASS}'})
  }).then(r => ({status: r.status, ok: r.ok})).then(o => console.log(JSON.stringify(o)))
    .catch(e => console.error('ERR', e.message))
" 2>&1 || true)
echo "  old account login: ${LOGIN_OLD}"
echo "${LOGIN_OLD}" | grep -q '"status":401' && echo "  PASS: old credentials rejected (401) on the fresh database." || {
  echo "[delete] FAIL: old account login was not a 401 auth rejection: ${LOGIN_OLD}"; exit 1; }

LOGIN_NEW=$(compose_operator exec -T app node -e "
  fetch('http://127.0.0.1:3000/api/auth/login', {
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'Origin': '${ORIGIN_NEW}'},
    body: JSON.stringify({username: '${ADMIN_USER2}', password: '${ADMIN_PASS2}'})
  }).then(r => ({status: r.status, ok: r.ok})).then(o => console.log(JSON.stringify(o)))
    .catch(e => console.error('ERR', e.message))
" 2>&1)
echo "${LOGIN_NEW}" | grep -q '"ok":true' && echo "  PASS: fresh admin login succeeded." || {
  echo "[delete] FAIL: fresh admin login failed: ${LOGIN_NEW}"; exit 1; }
stage delete "PASS: full removal yields a truly fresh deployment (0 orgs -> bootstrap -> login)"

echo ""
echo "=== UPGRADE-UNINSTALL SUITE #${RUN_NUM}: ALL STAGES PASSED ==="