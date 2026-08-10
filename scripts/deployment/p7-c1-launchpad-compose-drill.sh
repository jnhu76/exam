#!/usr/bin/env bash
# P7-C1 Launchpad production-Compose first-install drill (§32).
#
# Exercises the bundled production docker-compose.yml with a baked-in
# LAUNCHPAD_SETUP_TOKEN and proves the first-install contract end to end:
#
#   A1 fresh stack status        → uninitialized (GET /api/launchpad/status)
#   A2 wrong token               → 403 LAUNCHPAD_INVALID_SETUP_TOKEN
#   A3 correct token             → 200, first Admin + default org created
#   A4 status after bootstrap    → initialized; correct token AGAIN → 409
#        LAUNCHPAD_ALREADY_INITIALIZED (launchpad never reopens; a completed
#        installation is NOT a token-validity oracle)
#   A5 login as the new Admin    → succeeds
#   A6 DB invariants             → exactly 1 Admin, 0 Candidates, default
#        org, admin.bootstrap audit evidence
#   A7 register disabled         → POST /api/register → 403
#        AUTH_REGISTER_DISABLED; the web client has no /register route
#   B1 fresh stack WITHOUT token → bootstrap → 403 (an unset/empty
#        LAUNCHPAD_SETUP_TOKEN DISABLES launchpad; a bare `docker compose
#        up` with no token still starts normally and never exposes the
#        first-Admin form)
#
# The token reaches the app through the SAME ${LAUNCHPAD_SETUP_TOKEN:-}
# interpolation an operator's .env would use — this proves the
# docker-compose.yml wiring itself, not a private second path.
#
# Both stacks run under an isolated Compose project name and a per-run temp
# EXAM_DATA_ROOT (P7-C1 C1.3 isolation rule: drills never share the
# repo-root ./data/ nor any other stack). The temp directory is removed on
# exit after guarding against an empty/unsafe path.
#
# Usage: ./p7-c1-launchpad-compose-drill.sh
set -euo pipefail

TS="$(date +%s)"
PROJECT_A="p7c1-launchpad-a-${TS}"
PROJECT_B="p7c1-launchpad-b-${TS}"
PORT_A=$((32000 + (TS % 1000)))
PORT_B=$((34000 + (TS % 1000)))

SCRIPT_DIR="$(
  cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1
  pwd
)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"
COMPOSE_FILE="${REPO_ROOT}/docker-compose.yml"

if [ ! -f "${COMPOSE_FILE}" ]; then
  echo "FAIL: docker-compose.yml not found at ${COMPOSE_FILE}" >&2
  exit 1
fi

WORK="$(mktemp -d -t p7c1-launchpad-XXXXXX)"

# Strong per-run credentials (test-only, isolated throwaway stacks).
PG_PASSWORD="p7c1-lp-pass-${TS}-$(openssl rand -hex 8)"
JWT_SECRET="p7c1-lp-jwt-${TS}-$(openssl rand -hex 16)"
TOKEN="lp-$(openssl rand -hex 32)"
ADMIN_USER="lpadmin${TS}"
ADMIN_PASS="P7C1-Lp-Admin-${TS}-$(openssl rand -hex 8)"
ADMIN_NAME="Launchpad Drill Admin ${TS}"
ORG_NAME="Launchpad Drill Org ${TS}"

export POSTGRES_PASSWORD="${PG_PASSWORD}"
export JWT_SECRET="${JWT_SECRET}"
# The token must reach stack A through the SAME ${LAUNCHPAD_SETUP_TOKEN:-}
# compose interpolation an operator's .env would use. Shell env wins over
# .env, so this export is what the compose file actually interpolates.
export LAUNCHPAD_SETUP_TOKEN="${TOKEN}"

PASS_COUNT=0
FAIL_COUNT=0
ok() { PASS_COUNT=$((PASS_COUNT + 1)); echo "  PASS: $1"; }
fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  echo "  FAIL: $1" >&2
  if [ -n "${2:-}" ]; then echo "  detail: $2" >&2; fi
  echo "=== P7-C1 LAUNCHPAD DRILL: FAILED (${FAIL_COUNT} failure(s)) ===" >&2
  exit 1
}

cleanup() {
  echo "--- cleanup: tearing down isolated projects ---"
  docker compose -p "${PROJECT_A}" -f "${COMPOSE_FILE}" down --remove-orphans \
    > /dev/null 2>&1 || true
  docker compose -p "${PROJECT_B}" -f "${COMPOSE_FILE}" down --remove-orphans \
    > /dev/null 2>&1 || true
  if [ -n "${WORK:-}" ] && [ -d "${WORK}" ] \
    && printf '%s\n' "${WORK}" | grep -q '^/tmp/p7c1-launchpad-'; then
    rm -rf "${WORK}" > /dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

EXAM_DATA_ROOT_A="${WORK}/data-a"
EXAM_DATA_ROOT_B="${WORK}/data-b"

wait_app_healthy() {
  local project="$1"
  for i in $(seq 1 90); do
    local app_status db_status
    app_status=$(docker inspect "${project}-app-1" \
      --format '{{.State.Health.Status}}' 2>/dev/null || echo "missing")
    db_status=$(docker inspect "${project}-db-1" \
      --format '{{.State.Health.Status}}' 2>/dev/null || echo "missing")
    if [ "${app_status}" = "healthy" ] && [ "${db_status}" = "healthy" ]; then
      echo "  stack healthy (app=${app_status}, db=${db_status})."
      return 0
    fi
    sleep 2
  done
  echo "  FAIL: stack did not become healthy in 180s (app=${app_status}, db=${db_status})."
  docker compose -p "${project}" -f "${COMPOSE_FILE}" logs --tail=40 app
  exit 1
}

start_stack() {
  local project="$1" data_root="$2" port="$3"
  mkdir -p "${data_root}"
  # The API's CSRF origin guard fail-closes on any Origin outside the
  # configured allowlist (security.ts). The drill overrides CORS_ORIGIN /
  # PUBLIC_WEB_ORIGIN for its own port so the host-side curl requests pass
  # (shell env wins over .env during compose interpolation).
  local origin="http://localhost:${port}"
  EXAM_DATA_ROOT="${data_root}" APP_PORT="${port}" \
    CORS_ORIGIN="${origin}" PUBLIC_WEB_ORIGIN="${origin}" \
    docker compose -p "${project}" -f "${COMPOSE_FILE}" up -d --build \
    --quiet-pull 2>&1 | tail -6
  wait_app_healthy "${project}"
}

db_query() {
  local project="$1" query="$2"
  docker exec "${project}-db-1" \
    psql -v ON_ERROR_STOP=1 -U exam -d exam -tAc "${query}" 2>&1
}

# The app container is the API + SPA server. The host port is APP_PORT.
status_get() { curl -s --max-time 10 "http://localhost:$1/api/launchpad/status"; }
post_json() {
  local port="$1" path="$2" body="$3" out="$4"
  curl -s --max-time 15 -o "${out}" -w '%{http_code}' \
    -H "Content-Type: application/json" -H "Origin: http://localhost:${port}" \
    -X POST "http://localhost:${port}${path}" -d "${body}"
}

bootstrap_body() {
  local token="$1"
  jq -nc --arg t "${token}" --arg o "${ORG_NAME}" \
    --arg n "${ADMIN_NAME}" --arg u "${ADMIN_USER}" --arg p "${ADMIN_PASS}" \
    '{setupToken: $t, organizationName: $o, adminName: $n,
      adminUsername: $u, adminPassword: $p}'
}

echo "=== P7-C1 LAUNCHPAD PRODUCTION-COMPOSE DRILL (ts ${TS}) ==="

# ── Stack A: LAUNCHPAD_SETUP_TOKEN baked in (operator .env equivalent) ─────
echo "--- start stack A (token baked via compose interpolation) ---"
start_stack "${PROJECT_A}" "${EXAM_DATA_ROOT_A}" "${PORT_A}"

echo "--- A1: fresh installation status is uninitialized ---"
A1_STATUS="$(status_get "${PORT_A}")"
echo "  status: ${A1_STATUS}"
echo "${A1_STATUS}" | jq -e '.initialized == false' > /dev/null 2>&1 \
  && ok "A1 fresh stack reports initialized=false" \
  || fail "A1 fresh stack did not report initialized=false" "${A1_STATUS}"

echo "--- A2: wrong setup token is refused (403) ---"
A2_CODE="$(post_json "${PORT_A}" /api/launchpad/bootstrap \
  "$(bootstrap_body "wrong-token-$(openssl rand -hex 4)")" "${WORK}/a2.json")"
echo "  http ${A2_CODE}: $(cat "${WORK}/a2.json")"
[ "${A2_CODE}" = "403" ] \
  && grep -q "LAUNCHPAD_INVALID_SETUP_TOKEN" "${WORK}/a2.json" \
  && ok "A2 wrong token refused with LAUNCHPAD_INVALID_SETUP_TOKEN" \
  || fail "A2 wrong token was not refused with 403/INVALID_SETUP_TOKEN" \
      "http=${A2_CODE} body=$(cat "${WORK}/a2.json")"

echo "--- A3: correct setup token creates the first Admin (200) ---"
A3_CODE="$(post_json "${PORT_A}" /api/launchpad/bootstrap \
  "$(bootstrap_body "${TOKEN}")" "${WORK}/a3.json")"
echo "  http ${A3_CODE}: $(cat "${WORK}/a3.json")"
[ "${A3_CODE}" = "200" ] \
  && jq -e '.ok == true and .adminUsername == "'"${ADMIN_USER}"'"' \
    "${WORK}/a3.json" > /dev/null 2>&1 \
  && ok "A3 first Admin created via launchpad (${ADMIN_USER})" \
  || fail "A3 bootstrap did not return 200 with the Admin username" \
      "http=${A3_CODE} body=$(cat "${WORK}/a3.json")"

echo "--- A4: initialized status; correct token again → 409 (never reopens) ---"
A4_STATUS="$(status_get "${PORT_A}")"
echo "  status after bootstrap: ${A4_STATUS}"
echo "${A4_STATUS}" | jq -e '.initialized == true' > /dev/null 2>&1 \
  && ok "A4 status now reports initialized=true" \
  || fail "A4 status did not flip to initialized=true" "${A4_STATUS}"
A4_CODE="$(post_json "${PORT_A}" /api/launchpad/bootstrap \
  "$(bootstrap_body "${TOKEN}")" "${WORK}/a4.json")"
echo "  http ${A4_CODE}: $(cat "${WORK}/a4.json")"
[ "${A4_CODE}" = "409" ] \
  && grep -q "LAUNCHPAD_ALREADY_INITIALIZED" "${WORK}/a4.json" \
  && ok "A4 correct token after init refused with 409 (not a token oracle)" \
  || fail "A4 re-bootstrap was not refused with 409" \
      "http=${A4_CODE} body=$(cat "${WORK}/a4.json")"

echo "--- A5: login as the bootstrapped Admin succeeds ---"
A5_CODE="$(post_json "${PORT_A}" /api/auth/login \
  "$(jq -nc --arg u "${ADMIN_USER}" --arg p "${ADMIN_PASS}" \
    '{username: $u, password: $p}')" "${WORK}/a5.json")"
echo "  http ${A5_CODE}: $(jq -c '{username, role}' "${WORK}/a5.json" 2>/dev/null || cat "${WORK}/a5.json")"
# The login response IS the user session object (no `ok` field); a 200 with
# the bootstrapped username and role Admin proves authentication.
[ "${A5_CODE}" = "200" ] \
  && jq -e --arg u "${ADMIN_USER}" '.username == $u and .role == "Admin"' \
    "${WORK}/a5.json" > /dev/null 2>&1 \
  && ok "A5 Admin login succeeded" \
  || fail "A5 Admin login failed" \
      "http=${A5_CODE} body=$(cat "${WORK}/a5.json")"

echo "--- A6: DB invariants (1 Admin, 0 Candidates, default org, audit) ---"
A6_ADMINS="$(db_query "${PROJECT_A}" \
  "SELECT count(*) FROM users WHERE role = 'Admin';")"
A6_CANDS="$(db_query "${PROJECT_A}" \
  "SELECT count(*) FROM users WHERE role = 'Candidate';")"
A6_ORGS="$(db_query "${PROJECT_A}" \
  "SELECT count(*) FROM organizations WHERE slug = 'default';")"
A6_AUDITS="$(db_query "${PROJECT_A}" \
  "SELECT count(*) FROM audit_logs WHERE action = 'admin.bootstrap';")"
echo "  admins=${A6_ADMINS} candidates=${A6_CANDS} default_orgs=${A6_ORGS} audits=${A6_AUDITS}"
[ "${A6_ADMINS}" = "1" ] && [ "${A6_CANDS}" = "0" ] \
  && [ "${A6_ORGS}" = "1" ] && [ "${A6_AUDITS}" = "1" ] \
  && ok "A6 DB invariants hold (1 admin / 0 candidates / 1 org / 1 audit)" \
  || fail "A6 DB invariants do not hold" \
      "admins=${A6_ADMINS} candidates=${A6_CANDS} default_orgs=${A6_ORGS} audits=${A6_AUDITS}"

echo "--- A7: register surface is disabled (API 403 + no client route) ---"
# The register-disabled stub lives at POST /api/auth/register (authRoutes
# is registered under the /api/auth prefix — see registerApiRoutes.ts).
A7_CODE="$(post_json "${PORT_A}" /api/auth/register \
  "$(jq -nc --arg u "x${TS}" '{username: $u, password: "Xx12345678!", name: "X"}')" \
  "${WORK}/a7.json")"
echo "  http ${A7_CODE}: $(cat "${WORK}/a7.json")"
[ "${A7_CODE}" = "403" ] \
  && grep -q "AUTH_REGISTER_DISABLED" "${WORK}/a7.json" \
  && ok "A7 POST /api/auth/register refused with AUTH_REGISTER_DISABLED" \
  || fail "A7 POST /api/auth/register did not return 403/AUTH_REGISTER_DISABLED" \
      "http=${A7_CODE} body=$(cat "${WORK}/a7.json")"
if grep -q 'path="/register"' "${REPO_ROOT}/apps/web/src/App.tsx"; then
  fail "A7 web client contains a /register route (register must be disabled)"
else
  ok "A7 web client has no /register route (SPA redirects unknown paths to /login)"
fi

echo "--- teardown stack A ---"
docker compose -p "${PROJECT_A}" -f "${COMPOSE_FILE}" down --remove-orphans \
  > /dev/null 2>&1 || true

# ── Stack B: NO LAUNCHPAD_SETUP_TOKEN (disabled launchpad) ─────────────────
echo "--- start stack B (token unset: launchpad disabled) ---"
export -n LAUNCHPAD_SETUP_TOKEN 2>/dev/null || unset LAUNCHPAD_SETUP_TOKEN
start_stack "${PROJECT_B}" "${EXAM_DATA_ROOT_B}" "${PORT_B}"

echo "--- B1: fresh status uninitialized; bootstrap refused (403, disabled) ---"
B1_STATUS="$(status_get "${PORT_B}")"
echo "  status: ${B1_STATUS}"
echo "${B1_STATUS}" | jq -e '.initialized == false' > /dev/null 2>&1 \
  && ok "B1 fresh stack reports initialized=false" \
  || fail "B1 fresh stack did not report initialized=false" "${B1_STATUS}"
B1_CODE="$(post_json "${PORT_B}" /api/launchpad/bootstrap \
  "$(bootstrap_body "${TOKEN}")" "${WORK}/b1.json")"
echo "  http ${B1_CODE}: $(cat "${WORK}/b1.json")"
[ "${B1_CODE}" = "403" ] \
  && grep -q "LAUNCHPAD_INVALID_SETUP_TOKEN" "${WORK}/b1.json" \
  && ok "B1 unset token disables launchpad (bootstrap refused with 403)" \
  || fail "B1 unset token did not disable launchpad" \
      "http=${B1_CODE} body=$(cat "${WORK}/b1.json")"

B1_ADMINS="$(db_query "${PROJECT_B}" \
  "SELECT count(*) FROM users WHERE role = 'Admin';")"
[ "${B1_ADMINS}" = "0" ] \
  && ok "B1 no Admin was created (stack stays uninitialized)" \
  || fail "B1 an Admin was created despite the disabled token" \
      "admins=${B1_ADMINS}"

echo "--- teardown stack B ---"
docker compose -p "${PROJECT_B}" -f "${COMPOSE_FILE}" down --remove-orphans \
  > /dev/null 2>&1 || true

echo ""
echo "=== P7-C1 LAUNCHPAD DRILL SUMMARY ==="
echo "  passed: ${PASS_COUNT}"
echo "  failed: ${FAIL_COUNT}"
[ "${FAIL_COUNT}" = "0" ] || exit 1
echo "=== P7-C1 LAUNCHPAD PRODUCTION-COMPOSE DRILL: ALL CHECKS PASSED ==="
