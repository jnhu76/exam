#!/usr/bin/env bash
# #547 deployment readiness gate + active alert evidence (D1–D4).
#
# Proves, against the REAL production Compose topology (isolated project +
# temp data root + current-checkout build, same seams as compose-smoke.sh):
#
#   D1 healthy baseline:
#     - db gates app startup via depends_on: service_healthy (compose output);
#     - /api/health (liveness) = 200 AND /api/ready (readiness) = 200;
#     - app container reaches docker health `healthy`.
#
#   D2 live DB loss (docker compose stop db, bounded polling — no fixed
#      sleeps as correctness gates):
#     - /api/health STAYS 200 (liveness preserved — the #547 layer split);
#     - /api/ready flips to 503;
#     - the app container flips docker health `unhealthy`;
#     - the app container ID is UNCHANGED and restart count stays 0
#       (no silent auto-restart);
#     - exactly ONE `operability.readiness` unavailable transition event and
#       no duplicate storm while DB-down persists (bounded log observation).
#
#   D3 DB recovery WITHOUT app restart:
#     - /api/ready returns to 200 and docker health returns to healthy;
#     - SAME app container (no restart required);
#     - exactly ONE `operability.readiness` recovered transition event.
#
#   D4 loop stall alert is wired (bounded observation of the monitor's own
#      cadence via the structured log — the deterministic classification
#      itself is unit-tested; this leg only proves the monitor runs and logs
#      in the real topology): a `operability.background_loop` absence is NOT
#      a failure here (no stall is injected at deployment level); instead we
#      assert the operability monitor is alive by the absence of monitor
#      errors and — positively — that D2/D3 produced readiness transitions,
#      which are emitted by the same monitor tick.
#
# Usage: ./readiness-gate.sh <run-number>
set -euo pipefail

SCRIPT_DIR="$(
  cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1
  pwd
)"
# shellcheck source=lib.sh
source "${SCRIPT_DIR}/lib.sh"

RUN_NUM="${1:-1}"
PROJECT="readiness-gate-${RUN_NUM}"
# Uncommon host port (probes run container-internal, so this only avoids a
# host publish collision with any concurrently running stack).
EXAM_PORT=$((3440 + RUN_NUM % 80))
ORIGIN="http://localhost:${EXAM_PORT}"

if [ ! -f "${COMPOSE_FILE}" ]; then
  echo "FAIL: docker-compose.yml not found at ${COMPOSE_FILE}" >&2
  exit 1
fi

safe_temp_root readiness-gate EXAM_DATA_ROOT
export EXAM_DATA_ROOT

POSTGRES_PASSWORD="rg-pass-${RUN_NUM}-$(date +%s)"
JWT_SECRET="rg-jwt-${RUN_NUM}-$(openssl rand -hex 16)"
export POSTGRES_PASSWORD JWT_SECRET CORS_ORIGIN PUBLIC_WEB_ORIGIN
export CORS_ORIGIN="${ORIGIN}" PUBLIC_WEB_ORIGIN="${ORIGIN}"

cleanup() {
  echo "--- cleanup: tearing down isolated project ${PROJECT} ---"
  compose_down_best_effort "${PROJECT}"
  cleanup_temp_root "${EXAM_DATA_ROOT}"
}
trap cleanup EXIT

# ── helpers ───────────────────────────────────────────────────────────────
# Container-internal probe (same fetch the Docker healthcheck uses) — no
# host-port dependency. Prints the HTTP status code, or ERR.
# Exit-code protocol (process exit codes wrap mod 256, so an HTTP status
# must NOT be passed to process.exit directly): 0 = 2xx, 50 = HTTP 503,
# 2 = other status, 1 = transport failure.
probe_in_app() {
  local url="$1"
  docker exec "$(app_container "${PROJECT}")" node -e \
    "fetch('${url}').then(r=>process.exit(r.ok?0:(r.status===503?50:2))).catch(()=>process.exit(1))" \
    >/dev/null 2>&1
  local code=$?
  if [ "${code}" -eq 0 ]; then
    echo "200"
  elif [ "${code}" -eq 50 ]; then
    echo "503"
  else
    echo "ERR:${code}"
  fi
}

app_health_status() {
  docker inspect "$(app_container "${PROJECT}")" \
    --format '{{.State.Health.Status}}' 2>/dev/null || echo "missing"
}

app_restarts() {
  docker inspect "$(app_container "${PROJECT}")" \
    --format '{{.RestartCount}}' 2>/dev/null || echo "?"
}

# Bounded polling with deadline: the condition is a [ ... ] string evaluated
# in THIS shell (helper functions above stay visible). On deadline: print the
# #547 failure diagnostics bundle (compose ps, bounded log tails, probe
# results, container id) and FAIL.
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
  echo "--- diagnostics: app log tail (40) ---" >&2
  compose_logs "${PROJECT}" app 40 >&2 || true
  echo "--- diagnostics: db log tail (20) ---" >&2
  compose_logs "${PROJECT}" db 20 >&2 || true
  echo "--- diagnostics: liveness=$(probe_in_app http://127.0.0.1:3000/api/health) readiness=$(probe_in_app http://127.0.0.1:3000/api/ready) dockerhealth=$(app_health_status) container=$(app_container "${PROJECT}")" >&2
  return 1
}

count_log_lines() {
  local pattern="$1" since="$2"
  local c
  c="$(app_container "${PROJECT}")"
  docker logs "${c}" --since "${since}" 2>&1 \
    | grep -c "${pattern}" || true
}

echo "=== #547 readiness gate run #${RUN_NUM} (project: ${PROJECT}) ==="

# ── D1: healthy baseline (fresh up exercises the depends_on gate) ─────────
echo "--- D1: healthy baseline ---"
D1_UP="$(run_compose "${PROJECT}" up -d 2>&1 || true)"
echo "${D1_UP}" | sed 's/^/  /'
if echo "${D1_UP}" | grep -q "db-1.*Healthy"; then
  echo "  PASS: compose gated app startup on db service_healthy (depends_on)."
else
  # Compose may skip the Waiting/Healthy line when db was already running;
  # from a COLD project it must appear. This suite always starts cold.
  echo "  FAIL: compose output lacks the db Healthy gating sequence."
  exit 1
fi

poll_until 120 "app container healthy (D1)" '[ "$(app_health_status)" = "healthy" ]'
poll_until 30 "/api/health 200 (D1)" '[ "$(probe_in_app http://127.0.0.1:3000/api/health)" = "200" ]'
poll_until 30 "/api/ready 200 (D1)" '[ "$(probe_in_app http://127.0.0.1:3000/api/ready)" = "200" ]'
echo "  PASS: liveness=200 readiness=200 dockerhealth=healthy."

# ── D2: live DB loss ──────────────────────────────────────────────────────
echo "--- D2: live DB loss (stop db) ---"
APP_ID_BEFORE="$(app_container "${PROJECT}")"
RESTARTS_BEFORE="$(app_restarts)"
run_compose "${PROJECT}" stop db >/dev/null 2>&1

# Readiness must flip while liveness NEVER drops.
if ! poll_until 150 "/api/ready 503 (D2)" '[ "$(probe_in_app http://127.0.0.1:3000/api/ready)" = "503" ]'; then
  echo "  FAIL: readiness never flipped to 503 during DB loss."
  exit 1
fi
if [ "$(probe_in_app http://127.0.0.1:3000/api/health)" != "200" ]; then
  echo "  FAIL: liveness dropped during DB loss (must stay 200)."
  exit 1
fi
echo "  PASS: liveness stayed 200 while readiness answered 503."

poll_until 150 "app container unhealthy (D2)" '[ "$(app_health_status)" = "unhealthy" ]'
APP_ID_AFTER="$(app_container "${PROJECT}")"
RESTARTS_AFTER="$(app_restarts)"
if [ "${APP_ID_AFTER}" != "${APP_ID_BEFORE}" ]; then
  echo "  FAIL: app container changed during DB loss (${APP_ID_BEFORE} -> ${APP_ID_AFTER})."
  exit 1
fi
if [ "${RESTARTS_AFTER}" != "${RESTARTS_BEFORE}" ]; then
  echo "  FAIL: app restart count changed (${RESTARTS_BEFORE} -> ${RESTARTS_AFTER}) — silent auto-restart is forbidden (#547)."
  exit 1
fi
echo "  PASS: compose flipped unhealthy; container identity and restart count unchanged."

# Active alert: exactly one unavailable transition while DB-down persists.
poll_until 60 "one operability.readiness unavailable event (D2)" '[ "$(count_log_lines "operability.readiness" "90s")" -ge 1 ]'
sleep 2
UNAVAILABLE_COUNT="$(docker logs "$(app_container "${PROJECT}")" 2>&1 | grep -c '"state":"unavailable"' || true)"
if [ "${UNAVAILABLE_COUNT}" -ne 1 ]; then
  echo "  FAIL: expected exactly 1 unavailable transition event, observed ${UNAVAILABLE_COUNT}."
  exit 1
fi
echo "  PASS: exactly one operability.readiness unavailable transition (no storm)."

# ── D3: DB recovery without app restart ───────────────────────────────────
echo "--- D3: DB recovery (start db, no app restart) ---"
run_compose "${PROJECT}" start db >/dev/null 2>&1
poll_until 120 "/api/ready 200 again (D3)" '[ "$(probe_in_app http://127.0.0.1:3000/api/ready)" = "200" ]'
poll_until 150 "app container healthy again (D3)" '[ "$(app_health_status)" = "healthy" ]'
if [ "$(app_container "${PROJECT}")" != "${APP_ID_BEFORE}" ]; then
  echo "  FAIL: recovery changed the app container (restart was NOT required)."
  exit 1
fi
if [ "$(app_restarts)" != "${RESTARTS_BEFORE}" ]; then
  echo "  FAIL: recovery incremented the restart count."
  exit 1
fi
echo "  PASS: readiness returned 200, docker health healthy, SAME container, no restart."

poll_until 60 "one operability.readiness recovered event (D3)" '[ "$(count_log_lines "\"state\":\"recovered\"" "120s")" -ge 1 ]'
RECOVERED_COUNT="$(docker logs "$(app_container "${PROJECT}")" 2>&1 | grep -c '"state":"recovered"' || true)"
if [ "${RECOVERED_COUNT}" -ne 1 ]; then
  echo "  FAIL: expected exactly 1 recovered transition event, observed ${RECOVERED_COUNT}."
  exit 1
fi
echo "  PASS: exactly one operability.readiness recovered transition."

# ── D4: monitor liveness in the real topology ─────────────────────────────
echo "--- D4: operability monitor wiring ---"
# The readiness transitions above were EMITTED by the monitor's own tick —
# their presence is the positive proof the monitor runs and logs in the real
# topology. Additionally, the monitor must not be erroring on its own cadence.
MONITOR_ERRORS="$(docker logs "$(app_container "${PROJECT}")" 2>&1 | grep -c "Operability monitor tick failed" || true)"
if [ "${MONITOR_ERRORS}" -ne 0 ]; then
  echo "  FAIL: operability monitor itself reported ${MONITOR_ERRORS} tick failures."
  exit 1
fi
echo "  PASS: monitor emitted the transitions and reports no self-failures."

echo "=== #547 readiness gate: ALL PASS ==="
