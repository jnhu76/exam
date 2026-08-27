#!/usr/bin/env bash
# Fresh-install acceptance gate (#327): one disposable, repeatable gate that
# drives the CANONICAL operator path from nothing:
#
#   clean env (no pre-existing deployment file)
#     → node scripts/generate-env.mjs into an isolated path
#     → the authoritative compose smoke suite (topology, first migration,
#       first Admin bootstrap, worker lifecycle, redis guards, SPA) via the
#       --env-file seam
#     → down (data preserved) → up again: container recreation, durable
#       state, migration rerun safety
#     → teardown + residue assertions
#
# The gate COMPOSES existing authoritative suites; it does not reimplement
# their checks. compose-smoke.sh owns topology/bootstrap/migration/worker
# assertions; this script owns the fresh-ENV authority and the down/up
# persistence leg.
#
# Isolation contract:
#   - the deployment env file is generated under a mktemp directory and
#     NEVER at the repo root — a developer's real .env.deploy is neither
#     read nor overwritten (a poisoned legacy file is ignored);
#   - EXAM_DATA_ROOT is an isolated mktemp root;
#   - the Compose project name is unique per run;
#   - the host port comes from a canary EXAM_PORT written into the
#     generated file, and the gate proves Compose consumed THE FILE by
#     asserting the published host port equals the canary;
#   - Docker build cache is reused as a performance cache only — every
#     stage runs `up --build` (source-build authority; no registry image
#     can satisfy acceptance).
#
# Every failure is prefixed with its stage: [env] [smoke] [persist] [cleanup].
#
# Usage: bash tests/deployment/fresh-install.sh [run-number]
set -euo pipefail

SCRIPT_DIR="$(
  cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1
  pwd
)"
# shellcheck source=lib.sh
source "${SCRIPT_DIR}/lib.sh"

RUN_NUM="${1:-1}"
PROJECT="fresh-install-${RUN_NUM}-$(date +%s)"

stage() { echo "=== [${1}] ${2}"; }

# Unique high host port (4100..4899), probed free so parallel gates/dev
# stacks never collide. Node is guaranteed (the repo requires it).
pick_free_port() {
  node -e '
    const net = require("node:net");
    const base = 4100 + (process.pid % 800);
    let port = base;
    const tryBind = () => {
      const s = net.createServer();
      s.once("error", () => { port += 1; tryBind(); });
      s.listen(port, "127.0.0.1", () => {
        s.close(() => process.stdout.write(String(port)));
      });
    };
    tryBind();
  '
}

safe_temp_root fresh-install GATE_TMP
safe_temp_root fresh-install-data EXAM_DATA_ROOT
ENV_FILE="${GATE_TMP}/.env.deploy"
export DEPLOY_ENV_FILE="${ENV_FILE}"
export EXAM_DATA_ROOT
CANARY_PORT="$(pick_free_port)"

cleanup() {
  stage cleanup "tearing down project ${PROJECT} and temp roots"
  compose_down_best_effort "${PROJECT}"
  cleanup_temp_root "${EXAM_DATA_ROOT}"
  cleanup_temp_root "${GATE_TMP}"
  if run_compose "${PROJECT}" ls 2>/dev/null | grep -qw "${PROJECT}"; then
    echo "  WARN: compose project ${PROJECT} still registered." >&2
  fi
}
trap cleanup EXIT

# ── [env] Generation authority from nothing ─────────────────────────────
stage env "generating deployment env into isolated path (never repo root)"
# Guard the contract this gate is allowed to assume: a developer's real
# .env.deploy must survive untouched.
REAL_ENV="${REPO_ROOT}/.env.deploy"
REAL_ENV_BEFORE=""
if [ -f "${REAL_ENV}" ]; then
  REAL_ENV_BEFORE="$(md5sum "${REAL_ENV}" | cut -d' ' -f1)"
fi
# Legacy argument points at an ABSENT file: the consult-legacy-on-empty
# path must treat this install as truly first-run.
node "${REPO_ROOT}/scripts/generate-env.mjs" "${ENV_FILE}" "${GATE_TMP}/legacy-absent.env" >/dev/null
[ -f "${ENV_FILE}" ] || { echo "[env] FAIL: env file was not created."; exit 1; }
# Append the operator port key as the canary: if any later stage stops
# consuming THE FILE, the published host port reverts to 3000 and fails.
printf '\nEXAM_PORT=%s\n' "${CANARY_PORT}" >> "${ENV_FILE}"
GEN_JWT="$(env_file_value JWT_SECRET)"
GEN_PG="$(env_file_value POSTGRES_PASSWORD)"
[ -n "${GEN_JWT}" ] && [ -n "${GEN_PG}" ] || {
  echo "[env] FAIL: generated file lacks JWT_SECRET/POSTGRES_PASSWORD."; exit 1; }
if [ -n "${REAL_ENV_BEFORE}" ]; then
  [ "$(md5sum "${REAL_ENV}" | cut -d' ' -f1)" = "${REAL_ENV_BEFORE}" ] || {
    echo "[env] FAIL: developer .env.deploy was modified."; exit 1; }
fi
# Prove the file (not ambient env) resolves the interpolation contract.
if run_compose "${PROJECT}" config 2>/dev/null | grep -q "JWT_SECRET: ${GEN_JWT}"; then
  stage env "PASS: compose interpolation resolves the generated file"
else
  echo "[env] FAIL: compose does not interpolate the generated env file."
  exit 1
fi

# ── [smoke] Authoritative compose smoke under the generated env ──────────
stage smoke "running tests/deployment/compose-smoke.sh (env-file authority)"
bash "${SCRIPT_DIR}/compose-smoke.sh" "${RUN_NUM}"

# ── [persist] Down (keep data) → up again: recreation + persistence ──────
stage persist "first up --build against unique data root"
run_compose "${PROJECT}" up -d --build --quiet-pull 2>&1 | tail -3
wait_for_postgres "${PROJECT}"
wait_for_app "${PROJECT}"

PERSIST_USER="freshadmin${RUN_NUM}"
PERSIST_PASS="Fresh-Admin-${RUN_NUM}-$(openssl rand -hex 8)"
PERSIST_PG="$(env_file_value POSTGRES_PASSWORD)"
stage persist "first Admin bootstrap (CLI, production entrypoint)"
docker exec -e JWT_SECRET="$(env_file_value JWT_SECRET)" -e APP_MODE=production \
  -e DATABASE_URL="postgresql://exam:${PERSIST_PG}@db:5432/exam" \
  -e PUBLIC_WEB_ORIGIN="http://localhost:${CANARY_PORT}" \
  -e CORS_ORIGIN="http://localhost:${CANARY_PORT}" \
  "$(app_container "${PROJECT}")" node dist/scripts/bootstrap-admin.js \
  --username "${PERSIST_USER}" --password "${PERSIST_PASS}" \
  --name "Fresh Admin" --organization-name "Fresh Install Org ${RUN_NUM}" >/dev/null

run_psql_count() {
  docker exec "$(db_container "${PROJECT}")" psql -U exam -d exam -tAc "$1"
}
USERS_BEFORE="$(run_psql_count "SELECT count(*) FROM users;")"
MIG_BEFORE="$(run_psql_count "SELECT count(*) FROM drizzle.__drizzle_migrations;")"
APP_ID_BEFORE="$(app_container "${PROJECT}")"
[ "${USERS_BEFORE}" = "1" ] || { echo "[persist] FAIL: expected exactly 1 user, got ${USERS_BEFORE}."; exit 1; }

stage persist "login works on instance 1"
docker exec "$(app_container "${PROJECT}")" node -e "
  fetch('http://127.0.0.1:3000/api/auth/login', {method:'POST', headers:{'Content-Type':'application/json','Origin':'http://localhost:${CANARY_PORT}'}, body: JSON.stringify({username:'${PERSIST_USER}', password:'${PERSIST_PASS}'})}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))
" || { echo "[persist] FAIL: admin login failed on first boot."; exit 1; }

stage persist "down WITHOUT deleting data, then up again (real container recreation)"
run_compose "${PROJECT}" down --remove-orphans >/dev/null 2>&1
[ -d "${EXAM_DATA_ROOT}/postgres" ] || {
  echo "[persist] FAIL: data root lost after down."; exit 1; }
run_compose "${PROJECT}" up -d --build --quiet-pull 2>&1 | tail -3
wait_for_postgres "${PROJECT}"
wait_for_app "${PROJECT}"

# Recreation proof: containers are NEW (different IDs), not restarted originals.
APP_ID_AFTER="$(app_container "${PROJECT}")"
[ -n "${APP_ID_AFTER}" ] && [ "${APP_ID_AFTER}" != "${APP_ID_BEFORE}" ] || {
  echo "[persist] FAIL: app container identity did not change across down/up."; exit 1; }
USERS_AFTER="$(run_psql_count "SELECT count(*) FROM users;")"
MIG_AFTER="$(run_psql_count "SELECT count(*) FROM drizzle.__drizzle_migrations;")"
[ "${USERS_AFTER}" = "${USERS_BEFORE}" ] || {
  echo "[persist] FAIL: users ${USERS_BEFORE}→${USERS_AFTER} across down/up."; exit 1; }
[ "${MIG_AFTER}" = "${MIG_BEFORE}" ] || {
  echo "[persist] FAIL: migration journal changed on rerun (${MIG_BEFORE}→${MIG_AFTER})."; exit 1; }
stage persist "login still works after recreation (durable state)"
docker exec "$(app_container "${PROJECT}")" node -e "
  fetch('http://127.0.0.1:3000/api/auth/login', {method:'POST', headers:{'Content-Type':'application/json','Origin':'http://localhost:${CANARY_PORT}'}, body: JSON.stringify({username:'${PERSIST_USER}', password:'${PERSIST_PASS}'})}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))
" || { echo "[persist] FAIL: admin login failed after recreation."; exit 1; }

# Canary: the published host port must come from THE GENERATED FILE.
PUBLISHED="$(run_compose "${PROJECT}" port app 3000 2>/dev/null | sed 's/.*://')"
[ "${PUBLISHED}" = "${CANARY_PORT}" ] || {
  echo "[persist] FAIL: published host port ${PUBLISHED:-none} != canary ${CANARY_PORT} — the env file authority was bypassed."
  exit 1
}
stage persist "PASS: env-file canary port honored (${CANARY_PORT})"

# Explicit teardown of THIS project before cleanup trap runs.
compose_down_best_effort "${PROJECT}"

# ── [cleanup] No residue ─────────────────────────────────────────────────
stage cleanup "asserting no compose project residue"
if run_compose "${PROJECT}" ls 2>/dev/null | grep -qw "${PROJECT}"; then
  echo "[cleanup] FAIL: compose project ${PROJECT} survived teardown."
  exit 1
fi

echo ""
echo "=== FRESH-INSTALL GATE #${RUN_NUM}: ALL STAGES PASSED ==="
