#!/usr/bin/env bash
# Compose smoke suite: the production Compose parses, starts, and honors
# the required environment contract end to end.
#
# Runs the bundled production docker-compose.yml against an ISOLATED
# Compose project (`-p <unique-name>`) AND an isolated temp data root
# (EXAM_DATA_ROOT), so the smoke run never shares the repo-root ./data/
# or any other stack. The temp directory is removed on exit (path-guarded).
#
# Proves:
#   - POSTGRES_PASSWORD is required (no default) — Compose fails to expand
#     if unset.
#   - Redis stays OPTIONAL at Compose parse time — the default stack parses
#     with REDIS_PASSWORD unset.
#   - When the redis profile IS enabled, REDIS_PASSWORD is mandatory: the
#     redis container refuses to start without it (startup guard) and runs
#     with requirepass — unauthenticated clients are rejected.
#   - Default topology = app + db + email-worker (no redis).
#   - db healthy → app migrates + becomes healthy → email-worker starts
#     after app health (migration serialization).
#   - migrations applied exactly once.
#   - worker heartbeat appears in worker_heartbeats, bootstrap_pending
#     before bootstrap, success after.
#   - bootstrap-admin creates exactly one explicit Admin.
#   - login succeeds; no default Candidate accounts.
#   - baseline seed refuses APP_MODE=production.
#   - worker shuts down cleanly on SIGTERM.
#
# Usage: ./compose-smoke.sh <run-number>
set -euo pipefail

SCRIPT_DIR="$(
  cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1
  pwd
)"
# shellcheck source=lib.sh
source "${SCRIPT_DIR}/lib.sh"

RUN_NUM="${1:-1}"
PROJECT="compose-smoke-${RUN_NUM}"

if [ ! -f "${COMPOSE_FILE}" ]; then
  echo "FAIL: docker-compose.yml not found at ${COMPOSE_FILE}" >&2
  exit 1
fi

safe_temp_root compose-smoke EXAM_DATA_ROOT
export EXAM_DATA_ROOT

# ── Credentials ──────────────────────────────────────────────────────────
# Two authorities, one contract:
#   - default (DEPLOY_ENV_FILE unset): strong per-run credentials generated
#     here (test-only, isolated throwaway stack).
#   - DEPLOY_ENV_FILE set (fresh-install gate): the stack is driven by the
#     GENERATED deployment env file via the --env-file seam in lib.sh, and
#     this script consumes the SAME values so its direct psql/bootstrap
#     calls agree with what Compose interpolates. A missing/blank secret in
#     the file fails fast — generation authority is never bypassed.
if [ -n "${DEPLOY_ENV_FILE:-}" ]; then
  if [ ! -f "${DEPLOY_ENV_FILE}" ]; then
    echo "FAIL: DEPLOY_ENV_FILE=${DEPLOY_ENV_FILE} does not exist." >&2
    exit 1
  fi
  PG_PASSWORD="$(env_file_value POSTGRES_PASSWORD)"
  JWT_SECRET="$(env_file_value JWT_SECRET)"
  if [ -z "${PG_PASSWORD}" ] || [ -z "${JWT_SECRET}" ]; then
    echo "FAIL: deployment env file is missing POSTGRES_PASSWORD/JWT_SECRET." >&2
    exit 1
  fi
  EXAM_PORT_FROM_ENV="$(env_file_value EXAM_PORT)"
  ORIGIN="http://localhost:${EXAM_PORT_FROM_ENV:-3000}"
else
  PG_PASSWORD="smoke-pass-${RUN_NUM}-$(date +%s)"
  JWT_SECRET="smoke-jwt-${RUN_NUM}-$(openssl rand -hex 16)"
  ORIGIN="http://localhost:3000"
fi
ADMIN_USER="smokeadmin${RUN_NUM}"
ADMIN_PASS="Smoke-Admin-${RUN_NUM}-$(openssl rand -hex 8)"
ADMIN_NAME="Smoke Admin ${RUN_NUM}"
ORG_NAME="Smoke Org ${RUN_NUM}"
REDIS_PASSWORD="smoke-redis-${RUN_NUM}-$(openssl rand -hex 8)"

export POSTGRES_PASSWORD="${PG_PASSWORD}"
export JWT_SECRET="${JWT_SECRET}"
export CORS_ORIGIN="${ORIGIN}"
export PUBLIC_WEB_ORIGIN="${ORIGIN}"
export REDIS_PASSWORD="${REDIS_PASSWORD}"

echo "=== Compose smoke run #${RUN_NUM} (project: ${PROJECT}) ==="

PSQL_QUERY_OUTPUT=""
PSQL_QUERY_ERROR=""
LAST_PENDING_QUERY_ERROR=""
LAST_SUCCESS_INFO_VALUE=""
LAST_SUCCESS_INFO_ERROR=""
LAST_SUCCESS_COUNT_VALUE=""
LAST_SUCCESS_COUNT_ERROR=""

run_psql_query() {
  local query="$1"
  local output
  local status
  local c

  c="$(db_container "${PROJECT}")"
  set +e
  output=$(docker exec "${c}" psql -v ON_ERROR_STOP=1 -U exam -d exam -tAc "${query}" 2>&1)
  status=$?
  set -e

  if [ "${status}" -ne 0 ]; then
    PSQL_QUERY_OUTPUT=""
    PSQL_QUERY_ERROR="${output}"
    return 1
  fi

  PSQL_QUERY_OUTPUT="${output}"
  PSQL_QUERY_ERROR=""
  return 0
}

cleanup() {
  echo "--- cleanup: tearing down isolated project ${PROJECT} ---"
  compose_down_best_effort "${PROJECT}"
  # The redis projects are profile-gated: down needs --profile redis or the
  # redis containers are not part of the model and survive.
  compose_down_best_effort "compose-smoke-redis-noauth-${RUN_NUM}" --profile redis
  compose_down_best_effort "compose-smoke-redis-${RUN_NUM}" --profile redis
  # Remove ONLY the temp data root this script created via safe_temp_root
  # (registry-checked; container-assisted because PGDATA files are owned by
  # the container postgres user).
  cleanup_temp_root "${EXAM_DATA_ROOT}"
}
trap cleanup EXIT

# ── Test 1: empty POSTGRES_PASSWORD must fail Compose expansion ──────────
echo "--- TEST 1: empty POSTGRES_PASSWORD fails Compose expansion ---"
# Unset the inherited values in a subshell (env -u cannot apply to shell
# functions). Compose `${VAR:?...}` treats an unset OR empty value as a
# failure. Capture output to a variable so `set -o pipefail` does not turn
# the (expected) non-zero Compose exit into a script abort.
T1_OUT="$(
  unset POSTGRES_PASSWORD REDIS_PASSWORD
  export JWT_SECRET="${JWT_SECRET}" CORS_ORIGIN="${ORIGIN}" PUBLIC_WEB_ORIGIN="${ORIGIN}"
  POSTGRES_PASSWORD="" REDIS_PASSWORD="" \
  run_compose "${PROJECT}" up --no-start 2>&1 || true
)"
if echo "${T1_OUT}" | grep -q "POSTGRES_PASSWORD is required"; then
  echo "  PASS: empty/unset POSTGRES_PASSWORD fails expansion."
else
  echo "  FAIL: empty POSTGRES_PASSWORD did not fail expansion."
  echo "  output: ${T1_OUT}"
  exit 1
fi

# ── Test 1b: default stack parses with REDIS_PASSWORD unset ──────────────
echo "--- TEST 1b: default stack parses without REDIS_PASSWORD ---"
# `config --quiet` validates the full model (interpolation + structure)
# without pulling images or creating containers.
T1B_OUT="$(
  unset REDIS_PASSWORD
  export POSTGRES_PASSWORD="${PG_PASSWORD}" JWT_SECRET="${JWT_SECRET}" \
    CORS_ORIGIN="${ORIGIN}" PUBLIC_WEB_ORIGIN="${ORIGIN}"
  run_compose "${PROJECT}" config --quiet 2>&1 || true
)"
if [ -z "${T1B_OUT}" ]; then
  echo "  PASS: default stack parses without REDIS_PASSWORD (redis profile inactive)."
else
  echo "  FAIL: default stack failed to parse without REDIS_PASSWORD."
  echo "  output: ${T1B_OUT}"
  exit 1
fi

# ── Test 2: build + start the default stack (no redis profile) ───────────
echo "--- TEST 2: start default stack (no redis profile) ---"
run_compose "${PROJECT}" up -d --build --quiet-pull 2>&1 | tail -5
echo "  stack started."

# ── Test 3: verify only 3 services started (no redis) ────────────────────
echo "--- TEST 3: default topology = app + db + email-worker (no redis) ---"
SERVICES=$(run_compose "${PROJECT}" ps --services 2>/dev/null | sort | tr '\n' ' ')
echo "  services: ${SERVICES}"
if echo "${SERVICES}" | grep -qw "redis"; then
  echo "  FAIL: redis was started without the profile (regression)."
  exit 1
fi
for s in app db email-worker; do
  echo "${SERVICES}" | grep -qw "${s}" || {
    echo "  FAIL: required service '${s}' missing."
    exit 1
  }
done
echo "  PASS: default topology excludes redis; required services present."

# ── Test 4: wait for app + db healthy ────────────────────────────────────
echo "--- TEST 4: wait for app + db healthy (migrate runs first) ---"
for i in $(seq 1 60); do
  APP_STATUS=$(docker inspect "$(app_container "${PROJECT}")" --format '{{.State.Health.Status}}' 2>/dev/null || echo "missing")
  DB_STATUS=$(docker inspect "$(db_container "${PROJECT}")" --format '{{.State.Health.Status}}' 2>/dev/null || echo "missing")
  if [ "${APP_STATUS}" = "healthy" ] && [ "${DB_STATUS}" = "healthy" ]; then
    echo "  PASS: app=${APP_STATUS}, db=${DB_STATUS} (after ~$((i*2))s)."
    break
  fi
  sleep 2
  if [ "${i}" = "60" ]; then
    echo "  FAIL: app/db did not become healthy in 120s (app=${APP_STATUS}, db=${DB_STATUS})."
    compose_logs "${PROJECT}" app
    exit 1
  fi
done

# ── Test 5: email-worker started AFTER app health ────────────────────────
echo "--- TEST 5: email-worker running (started after app: service_healthy) ---"
WORKER_STATE=$(docker inspect "$(run_compose "${PROJECT}" ps -q email-worker 2>/dev/null)" --format '{{.State.Status}}' 2>/dev/null || echo "missing")
if [ "${WORKER_STATE}" = "running" ]; then
  echo "  PASS: email-worker is running."
else
  echo "  FAIL: email-worker is ${WORKER_STATE} (expected running)."
  compose_logs "${PROJECT}" email-worker
  exit 1
fi

# ── Test 5b: worker stays Up with bootstrap_pending before bootstrap ─────
echo "--- TEST 5b: worker stays Up with bootstrap_pending heartbeat ---"
WORKER_CONTAINER="$(run_compose "${PROJECT}" ps -q email-worker 2>/dev/null)"
WORKER_RESTARTS_BEFORE=$(docker inspect "${WORKER_CONTAINER}" --format '{{.RestartCount}}' 2>/dev/null || echo "unknown")
WORKER_CONTAINER_ID_BEFORE=$(docker inspect "${WORKER_CONTAINER}" --format '{{.Id}}' 2>/dev/null || echo "unknown")
if [ "${WORKER_RESTARTS_BEFORE}" != "0" ]; then
  echo "  FAIL: email-worker RestartCount=${WORKER_RESTARTS_BEFORE} before bootstrap (expected 0)."
  exit 1
fi
if [ "${WORKER_CONTAINER_ID_BEFORE}" = "unknown" ]; then
  echo "  FAIL: could not read email-worker container ID."
  exit 1
fi

PENDING_FOUND=0
PENDING_INSTANCE_ID=""
for i in $(seq 1 30); do
  if run_psql_query "SELECT worker_instance_id FROM worker_heartbeats WHERE worker_name = 'email-delivery' AND last_error LIKE 'bootstrap_pending:%' ORDER BY last_poll_at DESC LIMIT 1;"; then
    PENDING_INSTANCE_ID="${PSQL_QUERY_OUTPUT}"
    if [ -n "${PENDING_INSTANCE_ID}" ]; then
      PENDING_FOUND=1
      break
    fi
  else
    LAST_PENDING_QUERY_ERROR="${PSQL_QUERY_ERROR}"
  fi
  sleep 2
done
if [ "${PENDING_FOUND}" = "0" ]; then
  echo "  FAIL: no bootstrap_pending heartbeat found before bootstrap."
  if [ -n "${LAST_PENDING_QUERY_ERROR}" ]; then
    echo "  last query error: ${LAST_PENDING_QUERY_ERROR}"
  fi
  compose_logs "${PROJECT}" email-worker
  exit 1
fi
echo "  PASS: bootstrap_pending heartbeat from instance ${PENDING_INSTANCE_ID}."

if run_psql_query "SELECT COALESCE(last_success_at::text, '') FROM worker_heartbeats WHERE worker_instance_id = '${PENDING_INSTANCE_ID}';"; then
  PENDING_SUCCESS_AT="${PSQL_QUERY_OUTPUT}"
else
  echo "  FAIL: could not read last_success_at for bootstrap_pending heartbeat."
  echo "  query error: ${PSQL_QUERY_ERROR}"
  exit 1
fi
if [ -n "${PENDING_SUCCESS_AT}" ]; then
  echo "  FAIL: bootstrap_pending heartbeat already has last_success_at set."
  exit 1
fi
echo "  PASS: bootstrap_pending heartbeat has no last_success_at."

WORKER_LOGS_PENDING=$(compose_logs "${PROJECT}" email-worker 60)
if ! echo "${WORKER_LOGS_PENDING}" | grep -q "waiting for initial organization bootstrap"; then
  echo "  FAIL: worker logs do not contain bootstrap wait message."
  exit 1
fi
if echo "${WORKER_LOGS_PENDING}" | grep -q "creating email sender"; then
  echo "  FAIL: worker created sender before organization existed."
  exit 1
fi
if echo "${WORKER_LOGS_PENDING}" | grep -q "starting poll loop"; then
  echo "  FAIL: worker started poll loop before organization existed."
  exit 1
fi
echo "  PASS: worker is waiting and has not started sender/poll loop."

# ── Test 6: all repo migrations applied exactly once ─────────────────────
echo "--- TEST 6: migrations applied exactly once ---"
EXPECTED_MIG_COUNT=$(find "${REPO_ROOT}/packages/db/migrations/postgres" \
  -name "*.sql" -type f | wc -l | tr -d " ")
if run_psql_query "SELECT count(*) FROM drizzle.__drizzle_migrations;"; then
  MIG_COUNT="${PSQL_QUERY_OUTPUT}"
else
  echo "  FAIL: could not read migration count."
  echo "  query error: ${PSQL_QUERY_ERROR}"
  exit 1
fi
echo "  drizzle journal entries: ${MIG_COUNT} (repo migration files: ${EXPECTED_MIG_COUNT})"
if [ "${MIG_COUNT}" = "${EXPECTED_MIG_COUNT}" ]; then
  echo "  PASS: ${MIG_COUNT} migrations applied exactly once."
else
  echo "  FAIL: expected ${EXPECTED_MIG_COUNT} migrations, got ${MIG_COUNT}."
  exit 1
fi

# ── Test 7: bootstrap_pending heartbeat present before bootstrap ─────────
echo "--- TEST 7: worker heartbeat row shows bootstrap_pending ---"
if run_psql_query "SELECT count(*) FROM worker_heartbeats WHERE worker_name = 'email-delivery' AND last_error LIKE 'bootstrap_pending:%';"; then
  HB="${PSQL_QUERY_OUTPUT}"
else
  echo "  FAIL: could not query bootstrap_pending heartbeat count."
  echo "  query error: ${PSQL_QUERY_ERROR}"
  exit 1
fi
if [ "${HB}" -ge "1" ] 2>/dev/null; then
  echo "  PASS: bootstrap_pending heartbeat present."
else
  echo "  FAIL: no bootstrap_pending heartbeat found."
  exit 1
fi

# ── Test 8: API health endpoint ───────────────────────────────────────────
echo "--- TEST 8: API /api/health responds ---"
HEALTH=$(docker exec "$(app_container "${PROJECT}")" node -e \
  "fetch('http://127.0.0.1:3000/api/health').then(r=>r.json()).then(j=>console.log(JSON.stringify(j))).catch(e=>console.error('ERR',e.message))" 2>&1)
echo "  health: ${HEALTH}"
echo "${HEALTH}" | grep -q '"status":"ok"' && echo "  PASS: API liveness OK." || {
  echo "  FAIL: API health did not return status:ok."
  exit 1
}

# ── Test 8b: SPA reachability (explicit, not only via the healthcheck) ───
echo "--- TEST 8b: SPA index reachable (text/html) ---"
SPA_PROBE=$(docker exec "$(app_container "${PROJECT}")" node -e \
  "fetch('http://127.0.0.1:3000/').then(r=>console.log(JSON.stringify({status:r.status,ct:r.headers.get('content-type')||''}))).catch(e=>console.error('ERR',e.message))" 2>&1)
echo "  spa: ${SPA_PROBE}"
echo "${SPA_PROBE}" | grep -q '"status":200' \
  && echo "${SPA_PROBE}" | grep -q 'text/html' \
  && echo "  PASS: SPA index served as text/html." || {
    echo "  FAIL: SPA index not reachable as text/html."; exit 1;
  }

# ── Test 9: production bootstrap creates exactly one Admin ──────────────
echo "--- TEST 9: bootstrap-admin creates one explicit Admin ---"
docker exec -e JWT_SECRET="${JWT_SECRET}" -e APP_MODE=production \
  -e DATABASE_URL="postgresql://exam:${PG_PASSWORD}@db:5432/exam" \
  -e PUBLIC_WEB_ORIGIN="${ORIGIN}" -e CORS_ORIGIN="${ORIGIN}" \
  "$(app_container "${PROJECT}")" node dist/scripts/bootstrap-admin.js \
  --username "${ADMIN_USER}" --password "${ADMIN_PASS}" \
  --name "${ADMIN_NAME}" --organization-name "${ORG_NAME}" 2>&1 | head -15

# ── Test 9b: same worker transitions to success AFTER bootstrap ─────────
echo "--- TEST 9b: same worker transitions heartbeat to success after bootstrap ---"
SUCCESS_OK=0
for i in $(seq 1 40); do
  if run_psql_query "SELECT COALESCE(last_success_at::text, ''), COALESCE(last_error, '') FROM worker_heartbeats WHERE worker_instance_id = '${PENDING_INSTANCE_ID}' ORDER BY last_poll_at DESC LIMIT 1;"; then
    SUCCESS_INFO="${PSQL_QUERY_OUTPUT}"
    LAST_SUCCESS_INFO_VALUE="${SUCCESS_INFO}"
    LAST_SUCCESS_INFO_ERROR=""
  else
    LAST_SUCCESS_INFO_VALUE="${SUCCESS_INFO:-}"
    LAST_SUCCESS_INFO_ERROR="${PSQL_QUERY_ERROR}"
  fi

  if run_psql_query "SELECT count(*) FROM worker_heartbeats WHERE worker_instance_id = '${PENDING_INSTANCE_ID}' AND last_success_at IS NOT NULL AND last_error IS NULL;"; then
    SUCCESS_COUNT="${PSQL_QUERY_OUTPUT}"
    LAST_SUCCESS_COUNT_VALUE="${SUCCESS_COUNT}"
    LAST_SUCCESS_COUNT_ERROR=""
  else
    LAST_SUCCESS_COUNT_VALUE="${SUCCESS_COUNT:-}"
    LAST_SUCCESS_COUNT_ERROR="${PSQL_QUERY_ERROR}"
  fi

  if [ "${SUCCESS_COUNT}" = "1" ]; then
    SUCCESS_OK=1
    break
  fi
  sleep 2
done
if [ "${SUCCESS_OK}" = "0" ]; then
  echo "  FAIL: worker did not transition heartbeat to success after bootstrap."
  echo "  last heartbeat state: ${LAST_SUCCESS_INFO_VALUE:-<empty>}"
  echo "  last SUCCESS_INFO query error: ${LAST_SUCCESS_INFO_ERROR:-<none>}"
  echo "  last SUCCESS_COUNT value: ${LAST_SUCCESS_COUNT_VALUE:-<empty>}"
  echo "  last SUCCESS_COUNT query error: ${LAST_SUCCESS_COUNT_ERROR:-<none>}"
  compose_logs "${PROJECT}" email-worker
  exit 1
fi
echo "  PASS: heartbeat for instance ${PENDING_INSTANCE_ID} has last_success_at and no last_error."

WORKER_CONTAINER_ID_AFTER=$(docker inspect "$(run_compose "${PROJECT}" ps -q email-worker 2>/dev/null)" --format '{{.Id}}' 2>/dev/null || echo "unknown")
if [ "${WORKER_CONTAINER_ID_BEFORE}" != "${WORKER_CONTAINER_ID_AFTER}" ]; then
  echo "  FAIL: email-worker container changed across bootstrap (was ${WORKER_CONTAINER_ID_BEFORE}, now ${WORKER_CONTAINER_ID_AFTER})."
  exit 1
fi
echo "  PASS: same email-worker container across bootstrap."

WORKER_RESTARTS_AFTER=$(docker inspect "$(run_compose "${PROJECT}" ps -q email-worker 2>/dev/null)" --format '{{.RestartCount}}' 2>/dev/null || echo "unknown")
if [ "${WORKER_RESTARTS_AFTER}" != "0" ]; then
  echo "  FAIL: email-worker RestartCount=${WORKER_RESTARTS_AFTER} after bootstrap (expected 0)."
  exit 1
fi
echo "  PASS: email-worker RestartCount remains 0 after bootstrap."

WORKER_LOGS_RUNNING=$(compose_logs "${PROJECT}" email-worker 80)
if ! echo "${WORKER_LOGS_RUNNING}" | grep -q "resolved default organization"; then
  echo "  FAIL: worker logs do not show organization resolution."
  exit 1
fi
if ! echo "${WORKER_LOGS_RUNNING}" | grep -q "creating email sender"; then
  echo "  FAIL: worker logs do not show sender creation."
  exit 1
fi
if ! echo "${WORKER_LOGS_RUNNING}" | grep -q "starting poll loop"; then
  echo "  FAIL: worker logs do not show poll loop start."
  exit 1
fi
echo "  PASS: worker logs show resolved organization, sender creation, and poll loop."

# ── Test 10: no default Candidate accounts; exactly one Admin ───────────
echo "--- TEST 10: no default Candidate accounts; exactly one Admin ---"
if run_psql_query "SELECT count(*) FROM users WHERE role = 'Candidate';"; then
  CAND_COUNT="${PSQL_QUERY_OUTPUT}"
else
  echo "  FAIL: could not query Candidate count."
  echo "  query error: ${PSQL_QUERY_ERROR}"
  exit 1
fi
if run_psql_query "SELECT count(*) FROM users WHERE role = 'Admin';"; then
  ADMIN_COUNT="${PSQL_QUERY_OUTPUT}"
else
  echo "  FAIL: could not query Admin count."
  echo "  query error: ${PSQL_QUERY_ERROR}"
  exit 1
fi
if run_psql_query "SELECT count(*) FROM users;"; then
  TOTAL_COUNT="${PSQL_QUERY_OUTPUT}"
else
  echo "  FAIL: could not query total user count."
  echo "  query error: ${PSQL_QUERY_ERROR}"
  exit 1
fi
echo "  users: total=${TOTAL_COUNT}, admin=${ADMIN_COUNT}, candidate=${CAND_COUNT}"
[ "${CAND_COUNT}" = "0" ] && echo "  PASS: zero Candidate accounts." || {
  echo "  FAIL: ${CAND_COUNT} Candidate accounts exist (expected 0)."; exit 1; }
[ "${ADMIN_COUNT}" = "1" ] && echo "  PASS: exactly one Admin account." || {
  echo "  FAIL: ${ADMIN_COUNT} Admin accounts (expected 1)."; exit 1; }

# ── Test 11: admin.bootstrap audit row exists ───────────────────────────
echo "--- TEST 11: admin.bootstrap audit evidence ---"
if run_psql_query "SELECT count(*) FROM audit_logs WHERE action = 'admin.bootstrap';"; then
  AUDIT_COUNT="${PSQL_QUERY_OUTPUT}"
else
  echo "  FAIL: could not query admin.bootstrap audit count."
  echo "  query error: ${PSQL_QUERY_ERROR}"
  exit 1
fi
[ "${AUDIT_COUNT}" -ge "1" ] 2>/dev/null && echo "  PASS: ${AUDIT_COUNT} admin.bootstrap audit row(s)." || {
  echo "  FAIL: no admin.bootstrap audit row."; exit 1; }

# ── Test 12: login as the bootstrapped Admin succeeds ────────────────────
echo "--- TEST 12: login as bootstrapped Admin ---"
LOGIN=$(docker exec "$(app_container "${PROJECT}")" node -e "
  fetch('http://127.0.0.1:3000/api/auth/login', {
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'Origin': '${ORIGIN}'},
    body: JSON.stringify({username: '${ADMIN_USER}', password: '${ADMIN_PASS}'})
  }).then(r => ({status: r.status, ok: r.ok})).then(o => console.log(JSON.stringify(o)))
    .catch(e => console.error('ERR', e.message))
" 2>&1)
echo "  login: ${LOGIN}"
echo "${LOGIN}" | grep -q '"ok":true' && echo "  PASS: admin login succeeded." || {
  echo "  FAIL: admin login failed."; exit 1; }

# ── Test 13: baseline seed refuses APP_MODE=production ───────────────────
echo "--- TEST 13: baseline seed refuses APP_MODE=production ---"
SEED_ERR=$(docker exec -e JWT_SECRET="${JWT_SECRET}" -e APP_MODE=production \
  -e DATABASE_URL="postgresql://exam:${PG_PASSWORD}@db:5432/exam" \
  "$(app_container "${PROJECT}")" node dist/seed.js 2>&1 || true)
echo "${SEED_ERR}" | grep -q "Refusing to run the baseline seed in production" \
  && echo "  PASS: baseline seed refused in production." || {
    echo "  FAIL: baseline seed did not refuse in production.";
    echo "  output: ${SEED_ERR}"; exit 1; }

# ── Test 14: second Admin refused without --force ────────────────────────
echo "--- TEST 14: second Admin refused without --force ---"
DUP_ERR=$(docker exec -e JWT_SECRET="${JWT_SECRET}" -e APP_MODE=production \
  -e DATABASE_URL="postgresql://exam:${PG_PASSWORD}@db:5432/exam" \
  -e PUBLIC_WEB_ORIGIN="${ORIGIN}" -e CORS_ORIGIN="${ORIGIN}" \
  "$(app_container "${PROJECT}")" node dist/scripts/bootstrap-admin.js \
  --username "dup${RUN_NUM}" --password "${ADMIN_PASS}" \
  --name "Dup Admin" 2>&1 || true)
echo "${DUP_ERR}" | grep -q "active.*Admin.*exists" \
  && echo "  PASS: second Admin refused without --force." || {
    echo "  FAIL: second Admin was not refused.";
    echo "  output: ${DUP_ERR}"; exit 1; }

# ── Test 15: SIGTERM shuts worker down cleanly ───────────────────────────
echo "--- TEST 15: SIGTERM shuts down email-worker cleanly ---"
# Capture the container ID BEFORE stopping it (compose ps -q lists running
# containers; the stopped container must be inspected by ID).
WORKER_ID_BEFORE_STOP="$(run_compose "${PROJECT}" ps -q email-worker 2>/dev/null)"
docker stop "${WORKER_ID_BEFORE_STOP}" >/dev/null 2>&1 || true

EXIT_CODE=$(docker inspect "${WORKER_ID_BEFORE_STOP}" --format '{{.State.ExitCode}}' 2>/dev/null || echo "unknown")
if [ "${EXIT_CODE}" != "0" ]; then
  echo "  FAIL: email-worker exit code is ${EXIT_CODE} (expected 0)."
  exit 1
fi
echo "  PASS: email-worker exited with code 0."

if ! run_compose "${PROJECT}" logs --tail=20 email-worker 2>&1 | grep -q '"msg":"shutdown complete"'; then
  echo "  FAIL: worker logs do not contain shutdown complete."
  exit 1
fi
echo "  PASS: worker logs contain shutdown complete."

# ── Test 16a: redis profile without REDIS_PASSWORD refuses to start ──────
echo "--- TEST 16a: redis profile without REDIS_PASSWORD refuses to start ---"
REDIS_PROJECT_NOAUTH="compose-smoke-redis-noauth-${RUN_NUM}"
(
  unset REDIS_PASSWORD
  run_compose "${REDIS_PROJECT_NOAUTH}" --profile redis up -d redis --quiet-pull 2>&1 | tail -3 || true
)
GUARD_FIRED=0
for i in $(seq 1 30); do
  REDIS16A_HEALTH=$(docker inspect "$(run_compose "${REDIS_PROJECT_NOAUTH}" ps -q redis 2>/dev/null)" \
    --format '{{.State.Health.Status}}' 2>/dev/null || echo "missing")
  REDIS16A_LOGS=$(run_compose "${REDIS_PROJECT_NOAUTH}" --profile redis logs --tail=5 redis 2>&1 || true)
  if echo "${REDIS16A_LOGS}" | grep -q "REDIS_PASSWORD is required"; then
    GUARD_FIRED=1
    break
  fi
  if [ "${REDIS16A_HEALTH}" = "healthy" ]; then
    echo "  FAIL: redis became healthy without REDIS_PASSWORD (open Redis)."
    exit 1
  fi
  sleep 1
done
if [ "${GUARD_FIRED}" = "1" ]; then
  echo "  PASS: redis container refused to start; startup guard fired."
else
  echo "  FAIL: redis did not hit the password guard within 30s."
  echo "  health=${REDIS16A_HEALTH:-unknown}"
  echo "  logs: ${REDIS16A_LOGS:-<none>}"
  exit 1
fi
compose_down_best_effort "${REDIS_PROJECT_NOAUTH}" --profile redis

# ── Test 16b: redis profile with REDIS_PASSWORD enforces requirepass ─────
echo "--- TEST 16b: redis profile with REDIS_PASSWORD enforces requirepass ---"
REDIS_PROJECT="compose-smoke-redis-${RUN_NUM}"
run_compose "${REDIS_PROJECT}" --profile redis up -d redis --quiet-pull 2>&1 | tail -3
REDIS_AUTH_FAILED=0
for i in $(seq 1 30); do
  NOAUTH=$(docker exec "$(run_compose "${REDIS_PROJECT}" ps -q redis 2>/dev/null)" redis-cli ping 2>&1 || true)
  if echo "${NOAUTH}" | grep -qi "NOAUTH"; then
    REDIS_AUTH_FAILED=0
    break
  fi
  if echo "${NOAUTH}" | grep -q "PONG"; then
    REDIS_AUTH_FAILED=1
    break
  fi
  sleep 1
done
if [ "${REDIS_AUTH_FAILED}" = "1" ]; then
  echo "  FAIL: unauthenticated redis-cli ping was ACCEPTED (open Redis): ${NOAUTH}"
  exit 1
fi
if echo "${NOAUTH}" | grep -qi "NOAUTH"; then
  echo "  PASS: unauthenticated ping rejected with NOAUTH."
else
  echo "  FAIL: redis did not answer NOAUTH within 30s: ${NOAUTH}"
  exit 1
fi

AUTH_PONG=$(docker exec -e REDIS_PASSWORD="${REDIS_PASSWORD}" \
  "$(run_compose "${REDIS_PROJECT}" ps -q redis 2>/dev/null)" sh -lc \
  'redis-cli -a "$REDIS_PASSWORD" ping 2>/dev/null' 2>&1 || true)
if echo "${AUTH_PONG}" | grep -q "PONG"; then
  echo "  PASS: authenticated ping returns PONG."
else
  echo "  FAIL: authenticated ping did not return PONG: ${AUTH_PONG}"
  exit 1
fi

REDIS_HEALTH=""
for i in $(seq 1 30); do
  REDIS_HEALTH=$(docker inspect "$(run_compose "${REDIS_PROJECT}" ps -q redis 2>/dev/null)" \
    --format '{{.State.Health.Status}}' 2>/dev/null || echo "missing")
  if [ "${REDIS_HEALTH}" = "healthy" ]; then
    break
  fi
  sleep 1
done
if [ "${REDIS_HEALTH}" = "healthy" ]; then
  echo "  PASS: redis container healthcheck (authenticated) is healthy."
else
  echo "  FAIL: redis container health is ${REDIS_HEALTH} (expected healthy)."
  exit 1
fi

compose_down_best_effort "${REDIS_PROJECT}" --profile redis
echo "  PASS: authenticated redis profile started, probed, and was torn down."

echo ""
echo "=== RUN #${RUN_NUM}: ALL CHECKS PASSED ==="
