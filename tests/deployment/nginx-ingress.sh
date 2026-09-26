#!/usr/bin/env bash
# #585 production Nginx ingress acceptance suite.
#
# Proves, against the REAL production Compose topology (isolated project +
# temp data root + source-built images, same seams as compose-smoke.sh),
# that the public boundary is host :80 (nginx) and the two application
# upstreams are separate internal services:
#
#   ROUTING (through nginx on the published EXAM_PORT):
#     - /              -> web:4173   (200, text/html)
#     - SPA deep link  -> web fallback (200, text/html, /login)
#     - /api/health    -> app:3000   (200 JSON, path preserved)
#     - /api/ready     -> app:3000   (200)
#   SEPARATION:
#     - web and app are DISTINCT containers; the API answers JSON and the
#       web answers HTML through the same edge (not app-bundled SPA, not
#       vite preview).
#   CLIENT IP (#546 spoof-negative through the real edge):
#     - TRUSTED_PROXY_CIDRS = the stack's own bridge subnet; a login sent
#       through nginx with a FORGED X-Forwarded-For is audited under the
#       REAL client address (the bridge gateway), never the forged one.
#   READINESS through nginx (#547):
#     - db loss -> /api/ready 503 THROUGH NGINX; recovery -> 200 again.
#
# Usage: ./nginx-ingress.sh <run-number>
set -euo pipefail

SCRIPT_DIR="$(
  cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1
  pwd
)"
# shellcheck source=lib.sh
source "${SCRIPT_DIR}/lib.sh"

RUN_NUM="${1:-1}"
PROJECT="nginx-ingress-${RUN_NUM}"
# Unique high host port: nginx is the ONLY published service and its host
# port is the EXAM_PORT authority.
export EXAM_PORT=$((3540 + RUN_NUM % 80))
BASE_URL="http://127.0.0.1:${EXAM_PORT}"

if [ ! -f "${COMPOSE_FILE}" ]; then
  echo "FAIL: docker-compose.yml not found at ${COMPOSE_FILE}" >&2
  exit 1
fi

safe_temp_root nginx-ingress EXAM_DATA_ROOT
export EXAM_DATA_ROOT

POSTGRES_PASSWORD="ni-pass-${RUN_NUM}-$(date +%s)"
JWT_SECRET="ni-jwt-${RUN_NUM}-$(openssl rand -hex 16)"
# Pin the origins under test (#585 production default). Without explicit
# exports, Compose would interpolate CORS_ORIGIN from the repo-root dev .env
# (no --env-file is passed in suite mode), and the CSRF origin guard would
# then 403 every suite login.
CORS_ORIGIN="http://localhost"
PUBLIC_WEB_ORIGIN="http://localhost"
export POSTGRES_PASSWORD JWT_SECRET CORS_ORIGIN PUBLIC_WEB_ORIGIN

cleanup() {
  echo "--- cleanup: tearing down isolated project ${PROJECT} ---"
  compose_down_best_effort "${PROJECT}"
  cleanup_temp_root "${EXAM_DATA_ROOT}"
}
trap cleanup EXIT

# ── helpers ───────────────────────────────────────────────────────────────
# HTTP status of a host curl THROUGH NGINX.
status_via_nginx() {
  local path="$1" extra=("${@:2}")
  curl -s -o /dev/null -w '%{http_code}' "${extra[@]}" "${BASE_URL}${path}"
}

# Bounded polling with deadline (same discipline as readiness-gate.sh).
poll_until() {
  local deadline_s="$1" what="$2" condition="$3"
  local waited=0
  while [ "${waited}" -lt "${deadline_s}" ]; do
    if eval "${condition}"; then return 0; fi
    sleep 2
    waited=$((waited + 2))
  done
  echo "FAIL: ${what} not observed within ${deadline_s}s." >&2
  echo "--- diagnostics: compose ps ---" >&2
  run_compose "${PROJECT}" ps >&2 2>&1 || true
  echo "--- diagnostics: nginx log tail ---" >&2
  compose_logs "${PROJECT}" nginx 40 >&2 || true
  echo "--- diagnostics: app log tail ---" >&2
  compose_logs "${PROJECT}" app 40 >&2 || true
  echo "--- diagnostics: web log tail ---" >&2
  compose_logs "${PROJECT}" web 20 >&2 || true
  return 1
}

echo "=== #585 nginx ingress run #${RUN_NUM} (project: ${PROJECT}, port ${EXAM_PORT}) ==="

# ── Start: db first (creates the exam-net bridge so the trusted-proxy CIDR
# can be derived from the ACTUAL stack subnet), then the full stack. ───────
ensure_source_images
run_compose "${PROJECT}" up -d --quiet-pull db >/dev/null
EXAM_NET="${PROJECT}_exam-net"
STACK_SUBNET="$(docker network inspect "${EXAM_NET}" \
  --format '{{(index .IPAM.Config 0).Subnet}}' 2>/dev/null || true)"
[ -n "${STACK_SUBNET}" ] || {
  echo "FAIL: could not read exam-net subnet from ${EXAM_NET}."; exit 1; }
export TRUSTED_PROXY_CIDRS="${STACK_SUBNET}"
echo "--- stack subnet: ${STACK_SUBNET} (trusted proxy scope = the edge hop) ---"

run_compose "${PROJECT}" up -d --quiet-pull >/dev/null

for i in $(seq 1 60); do
  APP_STATUS=$(docker inspect "$(app_container "${PROJECT}")" --format '{{.State.Health.Status}}' 2>/dev/null || echo "missing")
  WEB_STATUS=$(docker inspect "$(web_container "${PROJECT}")" --format '{{.State.Health.Status}}' 2>/dev/null || echo "missing")
  NGINX_STATE=$(docker inspect "$(nginx_container "${PROJECT}")" --format '{{.State.Status}}' 2>/dev/null || echo "missing")
  if [ "${APP_STATUS}" = "healthy" ] && [ "${WEB_STATUS}" = "healthy" ] \
    && [ "${NGINX_STATE}" = "running" ]; then
    break
  fi
  sleep 2
  if [ "${i}" = "60" ]; then
    echo "  FAIL: stack did not become ready in 120s (app=${APP_STATUS}, web=${WEB_STATUS}, nginx=${NGINX_STATE})."
    compose_logs "${PROJECT}" nginx 30
    compose_logs "${PROJECT}" web 30
    exit 1
  fi
done
echo "  PASS: app+web healthy, nginx running (edge gated on upstream health)."

# ── R1: separation proof — distinct containers, distinct runtimes ─────────
echo "--- R1: web:4173 and app:3000 are distinct upstreams ---"
WEB_ID="$(web_container "${PROJECT}")"
APP_ID="$(app_container "${PROJECT}")"
[ -n "${WEB_ID}" ] && [ -n "${APP_ID}" ] && [ "${WEB_ID}" != "${APP_ID}" ] || {
  echo "  FAIL: web/app containers missing or identical."; exit 1; }
WEB_DIRECT=$(docker exec "${WEB_ID}" wget -q -O /dev/null -S http://127.0.0.1:4173/ 2>&1 | grep -c "HTTP/1.1 200" || true)
[ "${WEB_DIRECT}" -ge 1 ] || {
  echo "  FAIL: web container does not serve HTML on 4173."; exit 1; }
echo "  PASS: distinct containers; web serves directly on 4173."

# ── R2: routing through nginx on host :<EXAM_PORT> ────────────────────────
echo "--- R2: / -> web:4173 ---"
ROOT_STATUS="$(status_via_nginx /)"
ROOT_CT="$(curl -s -o /dev/null -w '%{content_type}' "${BASE_URL}/")"
[ "${ROOT_STATUS}" = "200" ] && echo "${ROOT_CT}" | grep -q "text/html" || {
  echo "  FAIL: / via nginx -> ${ROOT_STATUS} (${ROOT_CT:-no type})."; exit 1; }
echo "  PASS: / answered 200 text/html."

echo "--- R2b: SPA deep link /login -> web fallback ---"
DEEP_STATUS="$(status_via_nginx /login)"
DEEP_CT="$(curl -s -o /dev/null -w '%{content_type}' "${BASE_URL}/login")"
DEEP_IS_INDEX=$(curl -s "${BASE_URL}/login" | grep -c '<div id="root">' || true)
[ "${DEEP_STATUS}" = "200" ] && echo "${DEEP_CT}" | grep -q "text/html" \
  && [ "${DEEP_IS_INDEX}" -ge 1 ] || {
    echo "  FAIL: deep link /login -> ${DEEP_STATUS} (${DEEP_CT:-no type}, root-div=${DEEP_IS_INDEX})."; exit 1; }
echo "  PASS: /login deep link served the SPA index."

echo "--- R2c: /api/health -> app:3000 (path preserved) ---"
HEALTH_BODY="$(curl -s "${BASE_URL}/api/health")"
HEALTH_STATUS="$(status_via_nginx /api/health)"
echo "${HEALTH_BODY}" | grep -q '"status":"ok"' && [ "${HEALTH_STATUS}" = "200" ] || {
  echo "  FAIL: /api/health via nginx -> ${HEALTH_STATUS} body=${HEALTH_BODY}"; exit 1; }
echo "  PASS: /api/health answered the real API JSON (no /api rewrite)."

echo "--- R2d: /api/ready -> app:3000 ---"
READY_STATUS="$(status_via_nginx /api/ready)"
[ "${READY_STATUS}" = "200" ] || {
  echo "  FAIL: /api/ready via nginx -> ${READY_STATUS} (expected 200)."; exit 1; }
echo "  PASS: /api/ready answered 200 through the edge."

# ── R3: client-IP authority (#546) — forged XFF cannot choose identity ────
echo "--- R3: forged X-Forwarded-For cannot set rate-limit/audit identity ---"
ADMIN_USER="niadmin${RUN_NUM}"
ADMIN_PASS="Nginx-Admin-${RUN_NUM}-$(openssl rand -hex 8)"
docker exec -e JWT_SECRET="${JWT_SECRET}" -e APP_MODE=production \
  -e DATABASE_URL="postgresql://exam:${POSTGRES_PASSWORD}@db:5432/exam" \
  -e CORS_ORIGIN="http://localhost" -e PUBLIC_WEB_ORIGIN="http://localhost" \
  "${APP_ID}" node dist/scripts/bootstrap-admin.js \
  --username "${ADMIN_USER}" --password "${ADMIN_PASS}" \
  --name "Nginx Admin ${RUN_NUM}" --organization-name "Nginx Org ${RUN_NUM}" >/dev/null

FORGED_IP="6.6.6.6"
LOGIN_STATUS=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "Origin: http://localhost" \
  -H "X-Forwarded-For: ${FORGED_IP}" \
  -H "X-Real-IP: ${FORGED_IP}" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"${ADMIN_USER}\",\"password\":\"${ADMIN_PASS}\"}" \
  "${BASE_URL}/api/auth/login")
[ "${LOGIN_STATUS}" = "200" ] || {
  echo "  FAIL: login through nginx failed (${LOGIN_STATUS})."; exit 1; }

GATEWAY_IP="$(docker network inspect "${EXAM_NET}" \
  --format '{{(index .IPAM.Config 0).Gateway}}')"
AUDIT_IP="$(docker exec "$(db_container "${PROJECT}")" psql -U exam -d exam -tAc \
  "SELECT COALESCE(ip_address,'') FROM audit_logs WHERE action='login.success' ORDER BY created_at DESC LIMIT 1;")"
echo "  audited ip_address=${AUDIT_IP} (real client = bridge gateway ${GATEWAY_IP}; forged = ${FORGED_IP})"
[ "${AUDIT_IP}" != "${FORGED_IP}" ] || {
  echo "  FAIL: the FORGED XFF reached the audit identity (spoof accepted)."; exit 1; }
[ "${AUDIT_IP}" = "${GATEWAY_IP}" ] || {
  echo "  FAIL: audited ip '${AUDIT_IP}' != real client '${GATEWAY_IP}' — trusted-proxy walk wrong."; exit 1; }
echo "  PASS: request.ip = real client (gateway); forged XFF ignored."

# ── R4: readiness through nginx (#547) — db loss -> 503 -> recovery ───────
echo "--- R4: DB loss flips /api/ready to 503 THROUGH NGINX ---"
run_compose "${PROJECT}" stop db >/dev/null 2>&1
if ! poll_until 150 "/api/ready 503 via nginx (R4)" \
  '[ "$(status_via_nginx /api/ready)" = "503" ]'; then
  echo "  FAIL: readiness never flipped to 503 through nginx."
  exit 1
fi
LIVENESS_STATUS="$(status_via_nginx /api/health)"
[ "${LIVENESS_STATUS}" = "200" ] || {
  echo "  FAIL: liveness dropped during DB loss (${LIVENESS_STATUS})."; exit 1; }
echo "  PASS: /api/ready = 503 via nginx while /api/health stayed 200."

echo "--- R4b: DB recovery restores /api/ready 200 through nginx ---"
run_compose "${PROJECT}" start db >/dev/null 2>&1
if ! poll_until 150 "/api/ready 200 via nginx (R4b)" \
  '[ "$(status_via_nginx /api/ready)" = "200" ]'; then
  echo "  FAIL: readiness did not recover through nginx."
  exit 1
fi
echo "  PASS: /api/ready returned to 200 through nginx."

echo ""
echo "=== #585 NGINX INGRESS RUN #${RUN_NUM}: ALL CHECKS PASSED ==="
