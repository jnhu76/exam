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
#   - Default topology = app + db (no redis). The email outbox loop runs
#     in-process inside the app container (#320 CONVERGE) — no dedicated
#     email-worker service exists anymore.
#   - db healthy → app migrates + becomes healthy.
#   - migrations applied exactly once.
#   - the in-process outbox loop's heartbeat appears in worker_heartbeats,
#     bootstrap_pending before bootstrap, success after.
#   - bootstrap-admin creates exactly one explicit Admin.
#   - login succeeds; no default Candidate accounts.
#   - baseline seed refuses APP_MODE=production.
#   - SIGTERM stops the app (and the in-process loop) cleanly.
#   - #351 budget contract: with a send stuck in flight (fake transport,
#     60s delay ≫ the 8s loop shutdown budget), `docker stop` still exits
#     0 BEFORE stop_grace_period (never 137), the abandoned row stays
#     `processing` with its ORIGINAL ownership evidence (current lease
#     representation), and a restart recovers + re-claims it under a new
#     owner — the current at-least-once redelivery path.
#   - #482 synchronization: `docker stop` is gated on BOTH a real
#     happens-before pair — queue ownership (processing + lock) AND the
#     fake-sender send-entered witness (written on entry to send(), before
#     the simulated delay: sender-adapter execution begun, no provider I/O
#     implied) — so the bounded-abandon warning is observed by
#     bounded polling of the stop window, not a one-shot log grep.
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
# Under DEPLOY_ENV_FILE (gate mode) the env file carries a real password, so
# the property proven here is: a BLANK process-env override defeats the env
# file and still fires the :? guard. Without the file, the property is the
# classic unset-key failure. Both protect the same security boundary.
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

# ── Test 1c: acceptance runs the SOURCE build, never a registry image ────
echo "--- TEST 1c: merged acceptance model has no registry image ---"
# The build override must replace the operator EXAM_IMAGE pin on app. If a
# registry image reference survived the merge into the merged model,
# acceptance could pass on a pulled image instead of this checkout (#321
# two-path split).
if run_compose "${PROJECT}" config 2>/dev/null | grep -q "image: ghcr.io/jnhu76/exam"; then
  echo "  FAIL: a registry image reference survived the build override merge."
  exit 1
fi
T1C_SOURCE_IMAGES="$(run_compose "${PROJECT}" config 2>/dev/null | grep -c "image: exam-local:dev" || true)"
if [ "${T1C_SOURCE_IMAGES}" -eq 1 ]; then
  echo "  PASS: app resolves to exam-local:dev (source authority)."
else
  echo "  FAIL: expected 1 exam-local:dev image pin, found ${T1C_SOURCE_IMAGES}."
  exit 1
fi

# ── Test 2: build + start the default stack (no redis profile) ───────────
echo "--- TEST 2: start default stack (no redis profile) ---"
run_compose "${PROJECT}" up -d --build --quiet-pull 2>&1 | tail -5
echo "  stack started."

# ── Test 3: verify only 3 services started (no redis) ────────────────────
echo "--- TEST 3: default topology = app + db (no redis, no email-worker) ---"
SERVICES=$(run_compose "${PROJECT}" ps --services 2>/dev/null | sort | tr '\n' ' ')
echo "  services: ${SERVICES}"
if echo "${SERVICES}" | grep -qw "redis"; then
  echo "  FAIL: redis was started without the profile (regression)."
  exit 1
fi
for s in app db; do
  echo "${SERVICES}" | grep -qw "${s}" || {
    echo "  FAIL: required service '${s}' missing."
    exit 1
  }
done
if echo "${SERVICES}" | grep -qw "email-worker"; then
  echo "  FAIL: email-worker service started (#320 CONVERGE removed it)."
  exit 1
fi
echo "  PASS: default topology excludes redis and email-worker; required services present."

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

# ── Test 5: in-process outbox loop is waiting for bootstrap ──────────────
echo "--- TEST 5: app is the only Exam container (outbox loop in-process) ---"
EXAM_CONTAINERS=$(run_compose "${PROJECT}" ps --services 2>/dev/null | grep -cw "app")
if [ "${EXAM_CONTAINERS}" = "1" ]; then
  echo "  PASS: exactly one Exam container (app) is running."
else
  echo "  FAIL: expected exactly 1 Exam container (app), found ${EXAM_CONTAINERS}."
  exit 1
fi

# ── Test 5b: in-process loop writes bootstrap_pending before bootstrap ───
echo "--- TEST 5b: bootstrap_pending heartbeat from the in-process loop ---"
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
  compose_logs "${PROJECT}" app
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

APP_LOGS_PENDING=$(compose_logs "${PROJECT}" app 60)
if ! echo "${APP_LOGS_PENDING}" | grep -q "waiting for initial organization bootstrap"; then
  echo "  FAIL: app logs do not contain the loop bootstrap wait message."
  exit 1
fi
if echo "${APP_LOGS_PENDING}" | grep -q "in-process email outbox loop started"; then
  echo "  FAIL: outbox loop started before organization existed."
  exit 1
fi
echo "  PASS: in-process loop is waiting and has not started polling."

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
echo "--- TEST 7: outbox loop heartbeat row shows bootstrap_pending ---"
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
  compose_logs "${PROJECT}" app
  exit 1
fi
echo "  PASS: heartbeat for instance ${PENDING_INSTANCE_ID} has last_success_at and no last_error."

APP_LOGS_RUNNING=$(compose_logs "${PROJECT}" app 80)
if ! echo "${APP_LOGS_RUNNING}" | grep -q "resolved default organization"; then
  echo "  FAIL: app logs do not show organization resolution."
  exit 1
fi
if ! echo "${APP_LOGS_RUNNING}" | grep -q "in-process email outbox loop started"; then
  echo "  FAIL: app logs do not show the outbox loop start."
  exit 1
fi
echo "  PASS: app logs show resolved organization and outbox loop start."

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

# ── Test 15: SIGTERM stops the app (with the in-process loop) cleanly ────
echo "--- TEST 15: SIGTERM stops app + outbox loop cleanly ---"
APP_ID_BEFORE_STOP="$(run_compose "${PROJECT}" ps -q app 2>/dev/null)"
docker stop "${APP_ID_BEFORE_STOP}" >/dev/null 2>&1 || true

EXIT_CODE=$(docker inspect "${APP_ID_BEFORE_STOP}" --format '{{.State.ExitCode}}' 2>/dev/null || echo "unknown")
if [ "${EXIT_CODE}" != "0" ]; then
  echo "  FAIL: app exit code is ${EXIT_CODE} (expected 0)."
  exit 1
fi
echo "  PASS: app exited with code 0."

if ! run_compose "${PROJECT}" logs --tail=40 app 2>&1 | grep -q '"msg":"email outbox loop stopped cleanly"'; then
  echo "  FAIL: app logs do not contain the outbox loop clean-stop message."
  exit 1
fi
echo "  PASS: app logs contain outbox loop stopped cleanly."

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

# ── Test 17: stuck in-flight email send — bounded docker stop, no 137 ────
# #351 acceptance: with an email send that can NEVER finish inside the loop
# shutdown budget, `docker stop` must still end in the app's OWN graceful
# exit (code 0) BEFORE stop_grace_period — not a Docker SIGKILL (137).
# Also proves the abandoned row stays `processing` and is recovered and
# re-claimed by the next app start — the current implementation's
# at-least-once redelivery path.
#
# Synchronization model (#482; ADR-011 §26 Q1/Q2 + the accepted corrective
# amendment 2026-09-06): the two lifecycle boundaries are asserted
# separately, in order, BEFORE the stop:
#   1. QUEUE OWNERSHIP: status=processing with non-empty locked_by AND
#      locked_at — claim evidence only. It does NOT prove execution began.
#   2. SEND-ENTERED WITNESS: the fake sender writes EMAIL_FAKE_SEND_ENTERED_
#      FILE on entry to send(), BEFORE the 60s simulated delay — witness
#      existence implies sender-adapter execution has begun and the
#      simulated attempt is still unresolved. It implies nothing about
#      provider/network I/O or provider acceptance (this transport is fake).
echo "--- TEST 17: stuck in-flight email send: bounded stop, exit 0, not 137 (#351) ---"
STUCK_PROJECT="compose-smoke-stuck-${RUN_NUM}"
STUCK_DATA_ROOT="${EXAM_DATA_ROOT}/stuck-stack"
STUCK_PORT=3211
STUCK_ORIGIN="http://localhost:${STUCK_PORT}"
# 60s fake send latency ≫ the 8s loop shutdown budget: the send is still
# in flight when SIGTERM arrives. 6s lock timeout makes the post-restart
# recoverAbandoned check fast (fake transport skips the SMTP lease guard).
# EMAIL_FAKE_SEND_ENTERED_FILE arms the #482 witness seam (test-only; a real
# deployment never sets it).
STUCK_WITNESS="/tmp/exam-test17-send-entered"
(
  export EXAM_DATA_ROOT="${STUCK_DATA_ROOT}" EXAM_PORT="${STUCK_PORT}" \
    EMAIL_ENABLED=true EMAIL_TRANSPORT=fake EMAIL_FAKE_MODE=success \
    EMAIL_FAKE_DELAY_MS=60000 EMAIL_FAKE_SEND_ENTERED_FILE="${STUCK_WITNESS}" \
    EMAIL_WORKER_POLL_INTERVAL_MS=1000 \
    EMAIL_WORKER_SHUTDOWN_TIMEOUT_MS=8000 EMAIL_WORKER_LOCK_TIMEOUT_MS=6000 \
    CORS_ORIGIN="${STUCK_ORIGIN}" PUBLIC_WEB_ORIGIN="${STUCK_ORIGIN}"
  run_compose "${STUCK_PROJECT}" up -d --quiet-pull >/dev/null
)
STUCK_APP="$(app_container "${STUCK_PROJECT}")"
STUCK_DB="$(db_container "${STUCK_PROJECT}")"
STUCK_HEALTH=""
for i in $(seq 1 90); do
  STUCK_HEALTH=$(docker inspect "${STUCK_APP}" --format '{{.State.Health.Status}}' 2>/dev/null || echo "missing")
  if [ "${STUCK_HEALTH}" = "healthy" ]; then break; fi
  sleep 2
done
if [ "${STUCK_HEALTH}" != "healthy" ]; then
  echo "  FAIL: stuck-send app never became healthy (health=${STUCK_HEALTH})."
  run_compose "${STUCK_PROJECT}" logs --tail=40 app || true
  compose_down_best_effort "${STUCK_PROJECT}"
  exit 1
fi
echo "  stack up (fresh data root, email fake transport, 60s send delay)."

docker exec -e JWT_SECRET="${JWT_SECRET}" -e APP_MODE=production \
  -e DATABASE_URL="postgresql://exam:${PG_PASSWORD}@db:5432/exam" \
  -e PUBLIC_WEB_ORIGIN="${STUCK_ORIGIN}" -e CORS_ORIGIN="${STUCK_ORIGIN}" \
  "${STUCK_APP}" node dist/scripts/bootstrap-admin.js \
  --username "stuckadmin${RUN_NUM}" --password "${ADMIN_PASS}" \
  --name "Stuck Admin ${RUN_NUM}" --organization-name "Stuck Org ${RUN_NUM}" >/dev/null

# One due outbox row. (id has no DB-side default — the app layer generates
# it; supply one.) The witness file is cleared first so "witness exists" can
# only mean THIS run's send (fresh container ⇒ fresh /tmp anyway).
docker exec "${STUCK_APP}" rm -f "${STUCK_WITNESS}" >/dev/null 2>&1 || true
docker exec "${STUCK_DB}" psql -U exam -d exam -qc \
  "INSERT INTO email_outbox (id, organization_id, type, recipient_email, subject, body_text, status, attempt_count, max_attempts) SELECT gen_random_uuid()::text, id, 'test_email', 'stuck@example.com', 's', 't', 'pending', 0, 3 FROM organizations LIMIT 1;"

# ── Tier A step 1: queue ownership sanity (ADR-011 §26 Q1/Q2 — unchanged ─
# by the corrective amendment). status=processing + non-empty locked_by AND
# locked_at proves the row was CLAIMED. It is NOT sender-adapter-execution
# evidence — that is the witness's job.
STUCK_STATE=""
for i in $(seq 1 30); do
  STUCK_STATE=$(docker exec "${STUCK_DB}" psql -U exam -d exam -tAc \
    "SELECT status || '|' || COALESCE(locked_by, '') || '|' || COALESCE(locked_at::text, '') FROM email_outbox ORDER BY created_at DESC LIMIT 1" 2>/dev/null || true)
  case "${STUCK_STATE}" in
    processing\|*\|*) break ;;
  esac
  sleep 1
done
case "${STUCK_STATE}" in
  processing\|*\|*)
    STUCK_ORIGINAL_LOCKED_BY="$(printf '%s' "${STUCK_STATE#processing|}" | cut -d'|' -f1)"
    STUCK_ORIGINAL_LOCKED_AT="$(printf '%s' "${STUCK_STATE#processing|}" | cut -d'|' -f2-)"
    if [ -z "${STUCK_ORIGINAL_LOCKED_BY}" ] || [ -z "${STUCK_ORIGINAL_LOCKED_AT}" ]; then
      echo "  FAIL: processing row without ownership evidence (state=${STUCK_STATE}) — ADR-011 §26 Q2 violated."
      run_compose "${STUCK_PROJECT}" logs --tail=40 app || true
      compose_down_best_effort "${STUCK_PROJECT}"
      exit 1
    fi
    echo "  PASS: queue ownership established (locked_by=${STUCK_ORIGINAL_LOCKED_BY})."
    ;;
  *)
    echo "  FAIL: outbox row never reached a valid claimed state (state=${STUCK_STATE})."
    run_compose "${STUCK_PROJECT}" logs --tail=40 app || true
    compose_down_best_effort "${STUCK_PROJECT}"
    exit 1
    ;;
esac

# ── Tier A step 2: send-entered witness ──────────────────────────────────
# ADR-011 corrective amendment §2: entry into the sender adapter is the
# delivery-attempt execution boundary, distinct from provider/network I/O
# and provider acceptance. HARD happens-before gate: the fake sender
# touches the witness file on entry to send(), before the 60s delay. Once
# it exists, sender-adapter execution has begun and the simulated attempt
# is unresolved — the state `docker stop` is meant to interrupt.
STUCK_WITNESS_SEEN=0
for i in $(seq 1 30); do
  if docker exec "${STUCK_APP}" test -f "${STUCK_WITNESS}" 2>/dev/null; then
    STUCK_WITNESS_SEEN=1
    break
  fi
  sleep 1
done
if [ "${STUCK_WITNESS_SEEN}" != "1" ]; then
  echo "  FAIL: send-entered witness never appeared — sender-adapter execution not observed before stop."
  run_compose "${STUCK_PROJECT}" logs --tail=40 app || true
  compose_down_best_effort "${STUCK_PROJECT}"
  exit 1
fi
echo "  PASS: send-entered witness observed — sender-adapter execution begun; 60s simulated attempt unresolved."

STUCK_T0=$(date +%s)
STUCK_T0_ISO=$(date -u +%Y-%m-%dT%H:%M:%SZ)
docker stop "${STUCK_APP}" >/dev/null
STUCK_T1=$(date +%s)
STUCK_ELAPSED=$(( STUCK_T1 - STUCK_T0 ))
STUCK_EXIT=$(docker inspect "${STUCK_APP}" --format '{{.State.ExitCode}}')
if [ "${STUCK_EXIT}" != "0" ]; then
  echo "  FAIL: app exit code is ${STUCK_EXIT} (expected 0; 137 = SIGKILL past stop_grace_period — budget regression)."
  compose_down_best_effort "${STUCK_PROJECT}"
  exit 1
fi
if [ "${STUCK_ELAPSED}" -ge 45 ]; then
  echo "  FAIL: docker stop took ${STUCK_ELAPSED}s (>= stop_grace_period 45s): the app did not exit inside the grace window."
  compose_down_best_effort "${STUCK_PROJECT}"
  exit 1
fi
echo "  PASS: docker stop → app exited ${STUCK_EXIT} in ${STUCK_ELAPSED}s (< 45s grace; not 137)."

# ── Tier B: bounded-abandon warning (observability evidence) ─────────────
# #482: the one-shot `--tail=60 | grep` is gone. The stop landed on a
# witnessed in-flight (simulated) send, so the warning is emitted by the
# onClose
# shutdown race before the process exits — deterministically inside this
# stop window. Poll `logs --since` the stop start with a short bound;
# no --tail, no unbounded wait.
STUCK_WARN_SEEN=0
for i in $(seq 1 15); do
  # Capture first, grep second: under pipefail, a live `docker logs |` writer
  # racing a `grep -q` early exit can surface SIGPIPE as a false negative.
  STUCK_STOP_LOGS="$(docker logs --since "${STUCK_T0_ISO}" "${STUCK_APP}" 2>&1 || true)"
  if echo "${STUCK_STOP_LOGS}" | grep -q 'email outbox loop shutdown timeout'; then
    STUCK_WARN_SEEN=1
    break
  fi
  sleep 1
done
if [ "${STUCK_WARN_SEEN}" != "1" ]; then
  echo "  FAIL: app logs since the stop window do not contain the bounded-abandon warning — the stuck-send path was not exercised."
  run_compose "${STUCK_PROJECT}" logs --tail=60 app || true
  compose_down_best_effort "${STUCK_PROJECT}"
  exit 1
fi
echo "  PASS: email loop logged the bounded shutdown-timeout abandonment within the stop window."

# ── Tier A: ownership preserved across abandonment ───────────────────────
# CURRENT-IMPLEMENTATION regression (ADR-011 corrective amendment §3.1):
# the bounded shutdown leaves the row untouched — owner + claim timestamp
# survive byte-for-byte, so an unknown-outcome row keeps fenced ownership
# until the accepted recovery rule permits reclaim. recoverAbandoned →
# pending → new claim is this implementation's recovery route, not a frozen
# architecture requirement (a future accepted lease/ownership design only
# needs equivalent fencing).
STUCK_ROW_STATE=$(docker exec "${STUCK_DB}" psql -U exam -d exam -tAc \
  "SELECT status || '|' || COALESCE(locked_by, '') || '|' || COALESCE(locked_at::text, '') FROM email_outbox ORDER BY created_at DESC LIMIT 1")
if [ "${STUCK_ROW_STATE}" != "processing|${STUCK_ORIGINAL_LOCKED_BY}|${STUCK_ORIGINAL_LOCKED_AT}" ]; then
  echo "  FAIL: abandoned row ownership changed across the stop (state=${STUCK_ROW_STATE}; expected processing|${STUCK_ORIGINAL_LOCKED_BY}|${STUCK_ORIGINAL_LOCKED_AT}) — current-implementation regression: an unknown-outcome row must keep fenced ownership (ADR-011 corrective §3)."
  compose_down_best_effort "${STUCK_PROJECT}"
  exit 1
fi
echo "  PASS: abandoned row keeps status=processing with the ORIGINAL locked_by/locked_at (current lease representation)."

# Restart: lock timeout (6s) elapses, the next poll cycle's recoverAbandoned
# re-queues the row (pending, lock fields cleared) and the NEW instance
# claims it — CURRENT-IMPLEMENTATION recovery regression evidence
# (ADR-011 corrective amendment §4): after accepted expiry, the restarted
# process acquires fresh fenced ownership before retrying the attempt.
# NEW_LOCKED_BY != ORIGINAL proves THIS restart performed the reclaim
# (workerInstanceId is process-start-specific) — it is restart evidence,
# not the definition of at-least-once delivery. The transient `pending`
# state sits inside one poll cycle and is intentionally not raced for.
STUCK_RESTART_T0=$(date +%s)
docker start "${STUCK_APP}" >/dev/null
STUCK_HEALTH=""
for i in $(seq 1 90); do
  STUCK_HEALTH=$(docker inspect "${STUCK_APP}" --format '{{.State.Health.Status}}' 2>/dev/null || echo "missing")
  if [ "${STUCK_HEALTH}" = "healthy" ]; then break; fi
  sleep 2
done
if [ "${STUCK_HEALTH}" != "healthy" ]; then
  echo "  FAIL: stuck-send app never became healthy after restart (health=${STUCK_HEALTH})."
  compose_down_best_effort "${STUCK_PROJECT}"
  exit 1
fi
STUCK_RECLAIMED=""
STUCK_NEW_LOCKED_BY=""
for i in $(seq 1 60); do
  STUCK_STATE=$(docker exec "${STUCK_DB}" psql -U exam -d exam -tAc \
    "SELECT status || '|' || COALESCE(locked_by, '') || '|' || COALESCE(locked_at::text, '') FROM email_outbox ORDER BY created_at DESC LIMIT 1" 2>/dev/null || true)
  case "${STUCK_STATE}" in
    processing\|*\|*)
      STUCK_NEW_LOCKED_BY="$(printf '%s' "${STUCK_STATE#processing|}" | cut -d'|' -f1)"
      if [ -n "${STUCK_NEW_LOCKED_BY}" ] && [ "${STUCK_NEW_LOCKED_BY}" != "${STUCK_ORIGINAL_LOCKED_BY}" ]; then
        STUCK_RECLAIMED="yes"
        break
      fi
      ;;
  esac
  sleep 1
done
if [ "${STUCK_RECLAIMED}" != "yes" ]; then
  echo "  FAIL: abandoned row was not recovered and re-claimed by the restarted process (state=${STUCK_STATE}; original owner=${STUCK_ORIGINAL_LOCKED_BY}) — restart-reclaim regression."
  run_compose "${STUCK_PROJECT}" logs --tail=40 app || true
  compose_down_best_effort "${STUCK_PROJECT}"
  exit 1
fi
echo "  PASS: row recovered and re-claimed by the restarted process (fresh fenced ownership; ${STUCK_ORIGINAL_LOCKED_BY} → ${STUCK_NEW_LOCKED_BY})."
# Evidence of re-execution (not asserted): the new owner re-enters send(), so
# the witness file is rewritten after the restart.
STUCK_WITNESS_MTIME=$(docker exec "${STUCK_APP}" stat -c %Y "${STUCK_WITNESS}" 2>/dev/null || echo "0")
if [ "${STUCK_WITNESS_MTIME}" -ge "${STUCK_RESTART_T0}" ] 2>/dev/null; then
  echo "  PASS: witness rewritten after restart — the new owner re-entered sender-adapter execution."
fi

compose_down_best_effort "${STUCK_PROJECT}"

echo ""
echo "=== RUN #${RUN_NUM}: ALL CHECKS PASSED ==="
