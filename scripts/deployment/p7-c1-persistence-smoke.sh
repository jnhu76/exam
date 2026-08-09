#!/usr/bin/env bash
# P7-C1 portable-persistence + cold-relocation smoke test.
#
# Proves the central P7-C1 invariant: "Containers are disposable; the
# declared host data directory is not." Runs the bundled production
# docker-compose.yml against an ISOLATED Compose project AND an isolated
# temp data root (EXAM_DATA_ROOT), so the smoke run never shares the
# repo-root ./data/ or any other stack.
#
# Scenario (C1.4 persistence):
#   isolated temp root
#       → docker compose up
#       → bootstrap first Admin (canonical bootstrap-admin path)
#       → record business invariants (org, admin count, audit row, a probe row)
#       → docker compose down            (containers removed, data retained)
#       → docker compose up              (fresh containers, same data root)
#       → assert identical invariants    (container restart persistence PROVEN)
#
# Scenario (C1.5 cold relocation):
#   deployment A (temp root A, same invariants as above)
#       → docker compose down            (PostgreSQL stopped cleanly)
#       → cp -a ROOT_A ROOT_B            (plain filesystem copy, no PG tooling)
#       → start deployment B with EXAM_DATA_ROOT=ROOT_B (NEW project name)
#       → assert identical invariants    (cold directory relocation PROVEN)
#
# This is a same-host temp-directory proof. It does NOT claim to prove every
# OS/filesystem combination — the product contract is ordinary filesystem
# relocation (rsync -a / tar while PostgreSQL is stopped), documented in
# docs/deployment/backup-and-recovery.md. Readiness is polled deterministically
# (healthcheck + psql), never via arbitrary sleeps.
#
# All state lives in throwaway temp directories removed on exit (guarded
# against an empty/unsafe path). No human/dev database is touched.
#
# Usage: ./p7-c1-persistence-smoke.sh
set -euo pipefail

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

RUN_TS="$(date +%s)"
PROJECT_A="p7c1-persist-a-${RUN_TS}"
PROJECT_B="p7c1-persist-b-${RUN_TS}"

# Two isolated temp data roots: A is the primary deployment; B is the
# relocation target. Both are created by this script and removed on exit.
ROOT_A="$(mktemp -d -t p7c1-persist-A-XXXXXX)"
ROOT_B="$(mktemp -d -t p7c1-persist-B-XXXXXX)"
export EXAM_DATA_ROOT="${ROOT_A}"

# Strong per-run credentials (test-only, isolated throwaway stack).
export POSTGRES_PASSWORD="p7c1-persist-pg-${RUN_TS}-$(openssl rand -hex 8)"
export JWT_SECRET="p7c1-persist-jwt-$(openssl rand -hex 16)"
ORIGIN="http://localhost:3000"
export CORS_ORIGIN="${ORIGIN}"
export PUBLIC_WEB_ORIGIN="${ORIGIN}"

ADMIN_USER="p7c1admin"
ADMIN_PASS="P7C1-Persist-Admin-$(openssl rand -hex 8)"
ADMIN_NAME="P7C1 Persist Admin"
ORG_NAME="P7C1 Persist Org"

# Probe row written into a dedicated schema so the invariant check has a
# stable, content-addressed marker that is independent of seed/bootstrap row
# counts. Dropped/recreated each run; never touches app tables.
PROBE_SCHEMA="p7c1_probe"
PROBE_TABLE="persistence_marker"
PROBE_LABEL="persist-A-${RUN_TS}"

# Paths this script created and is responsible for removing on exit.
CREATED_DIRS=("${ROOT_A}" "${ROOT_B}")

cleanup() {
  echo "--- cleanup: tearing down isolated projects ---"
  for proj in "${PROJECT_A}" "${PROJECT_B}"; do
    docker compose -p "${proj}" -f "${COMPOSE_FILE}" down --remove-orphans \
      > /dev/null 2>&1 || true
  done
  # Remove ONLY the temp directories this script created. Guard against an
  # empty or unsafe path: each must match the mktemp(1) prefix this script
  # uses, and must be a directory. Never run a broad rm -rf on a path that
  # could be empty, the repo root, or a path we did not create.
  for d in "${CREATED_DIRS[@]}"; do
    if [ -n "${d}" ] && [ -d "${d}" ] \
      && printf '%s\n' "${d}" | grep -Eq '/tmp/p7c1-persist-[AB]-[A-Za-z0-9_-]+$'; then
      rm -rf "${d}" > /dev/null 2>&1 || true
    fi
  done
}
trap cleanup EXIT

# ── Helpers ─────────────────────────────────────────────────────────────
# Poll the db container healthcheck deterministically instead of sleeping.
wait_for_db() {
  local project="$1"
  local container="${project}-db-1"
  for _ in $(seq 1 60); do
    if docker exec "${container}" pg_isready -U exam -d exam > /dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "FAIL: db never became ready for project ${project}" >&2
  exit 1
}

# Poll the app container healthcheck (/api/health) deterministically.
wait_for_app() {
  local project="$1"
  local container="${project}-app-1"
  for _ in $(seq 1 90); do
    if docker exec "${container}" \
      node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
      > /dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "FAIL: app never became healthy for project ${project}" >&2
  docker compose -p "${project}" -f "${COMPOSE_FILE}" logs --tail=40 app >&2 || true
  exit 1
}

psql_exec() {
  # $1 = project, $2 = SQL. Output to stdout.
  local project="$1"
  local sql="$2"
  docker exec "${project}-db-1" psql -v ON_ERROR_STOP=1 -U exam -d exam -tAc "${sql}"
}

# Write the probe marker (idempotent: schema/table created if absent, row
# upserted by label). The probe is independent of app tables so app
# migration/seed changes cannot make this regression flaky.
write_probe() {
  local project="$1"
  local label="$2"
  psql_exec "${project}" "CREATE SCHEMA IF NOT EXISTS ${PROBE_SCHEMA};"
  psql_exec "${project}" "CREATE TABLE IF NOT EXISTS ${PROBE_SCHEMA}.${PROBE_TABLE} (id text primary key, label text not null, written_at text not null);"
  psql_exec "${project}" "INSERT INTO ${PROBE_SCHEMA}.${PROBE_TABLE} (id, label, written_at) VALUES ('1','${label}', now()::text) ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, written_at = EXCLUDED.written_at;"
}

# Capture business invariants into stdout as a single comparable digest:
#   org count | admin count | audit(admin.bootstrap) count | probe label
capture_invariants() {
  local project="$1"
  local org_count admin_count bootstrap_audit probe_label
  org_count="$(psql_exec "${project}" "SELECT count(*) FROM organizations;")"
  admin_count="$(psql_exec "${project}" "SELECT count(*) FROM users WHERE role='Admin' AND is_active=true;")"
  bootstrap_audit="$(psql_exec "${project}" "SELECT count(*) FROM audit_logs WHERE action='admin.bootstrap';")"
  probe_label="$(psql_exec "${project}" "SELECT label FROM ${PROBE_SCHEMA}.${PROBE_TABLE} WHERE id='1';")"
  printf 'orgs=%s|admins=%s|admin_bootstrap_audit=%s|probe=%s\n' \
    "${org_count}" "${admin_count}" "${bootstrap_audit}" "${probe_label}"
}

bootstrap_admin() {
  local project="$1"
  docker exec "${project}-app-1" node dist/scripts/bootstrap-admin.js \
    --username "${ADMIN_USER}" --password "${ADMIN_PASS}" \
    --name "${ADMIN_NAME}" --organization-name "${ORG_NAME}" > /dev/null
}

up_default() {
  local project="$1"
  docker compose -p "${project}" -f "${COMPOSE_FILE}" up -d --quiet-pull > /dev/null
  wait_for_db "${project}"
  wait_for_app "${project}"
}

down_default() {
  local project="$1"
  docker compose -p "${project}" -f "${COMPOSE_FILE}" down --remove-orphans > /dev/null 2>&1 || true
}

echo "=== P7-C1 persistence + relocation smoke (ts ${RUN_TS}) ==="

# ── C1.4: container-restart persistence ─────────────────────────────────
echo "--- C1.4: start deployment A, bootstrap, record invariants ---"
up_default "${PROJECT_A}"
bootstrap_admin "${PROJECT_A}"
write_probe "${PROJECT_A}" "${PROBE_LABEL}"
INV_A_FRESH="$(capture_invariants "${PROJECT_A}")"
echo "  invariants A (fresh): ${INV_A_FRESH}"

echo "--- C1.4: down then up (containers removed, data root retained) ---"
down_default "${PROJECT_A}"
up_default "${PROJECT_A}"
INV_A_RESTART="$(capture_invariants "${PROJECT_A}")"
echo "  invariants A (restart): ${INV_A_RESTART}"

if [ "${INV_A_FRESH}" != "${INV_A_RESTART}" ]; then
  echo "  FAIL: container restart changed invariants."
  exit 1
fi
echo "  PASS: container-restart persistence (C1.4)."

# ── C1.5: cold directory relocation ─────────────────────────────────────
echo "--- C1.5: stop deployment A, copy data root to B (PostgreSQL stopped) ---"
down_default "${PROJECT_A}"
# Copy the COMPLETE data root while PostgreSQL is stopped. The PGDATA files
# are owned by the container's postgres user (uid 999) and are not readable
# by the host user, so a host-side cp -a fails with EACCES. The supported
# cold-copy contract is a container-assisted copy (root inside a throwaway
# container) that preserves ownership/mode/symlinks — equivalent to running
# `rsync -aHAX` or `tar` as root on the host. This mirrors the relocation
# proof in the P7-C0 audit (§13) and is the operator-documented procedure
# in docs/deployment/backup-and-recovery.md. ROOT_B is a temp dir this
# script created and owns; the alpine container is removed (--rm).
docker run --rm \
  -v "${ROOT_A}:/from:ro" \
  -v "${ROOT_B}:/to" \
  alpine:latest \
  sh -c 'cp -a /from/. /to/'

echo "--- C1.5: start deployment B from copied data root (new project) ---"
# Start B with the SAME credentials (the volume was initialized with them)
# but a NEW project name and EXAM_DATA_ROOT pointed at B.
export EXAM_DATA_ROOT="${ROOT_B}"
up_default "${PROJECT_B}"
INV_B="$(capture_invariants "${PROJECT_B}")"
echo "  invariants B (relocated): ${INV_B}"

if [ "${INV_A_FRESH}" != "${INV_B}" ]; then
  echo "  FAIL: cold relocation changed invariants."
  exit 1
fi
echo "  PASS: cold directory relocation (C1.5)."

# ── Bonus invariant: data root on disk is operator-visible ──────────────
# The PGDATA files are owned by the container postgres user (uid 999) and
# not readable by the host user, so prove operator-visibility via a
# throwaway container with the data root mounted (the same access path an
# operator uses for cold copy / inspection).
if ! docker run --rm -v "${ROOT_A}/postgres:/pg:ro" alpine:latest \
  sh -c 'test -f /pg/18/docker/PG_VERSION && cat /pg/18/docker/PG_VERSION'; then
  echo "  FAIL: PG_VERSION not visible at \${EXAM_DATA_ROOT}/postgres/18/docker/PG_VERSION."
  exit 1
fi
echo "  PASS: PGDATA is operator-visible at \${EXAM_DATA_ROOT}/postgres (via helper container)."

echo ""
echo "=== P7-C1 PERSISTENCE + RELOCATION SMOKE: ALL CHECKS PASSED ==="
