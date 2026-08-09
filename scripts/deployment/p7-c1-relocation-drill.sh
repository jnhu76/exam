#!/usr/bin/env bash
# P7-C1 C1.4 — portable relocation drill, Level 1: LOCAL CLEAN-ROOT.
#
# Proves the portable-deployment invariant:
#   compatible clean Docker host + deployment config (compose + .env)
#   + canonical persistent data (./data/postgres) = the SAME Exam deployment
#   via the ORDINARY `docker compose up -d` path.
#
# Two isolated Compose projects (A → B) on one host, never touching
# exam / exam_test / exam_e2e:
#   A: fresh temp root; copies docker-compose.yml + generates .env + a
#      TEST-ONLY seed override (RUN_SEED=e2e, FORCE_APP_MODE=e2e,
#      TEST_DATABASE_URL); builds the image once (exam-p7c1-probe:latest);
#      boots the ORDINARY path; preflight → FRESH_INSTALL; migrate + e2e seed
#      (baseline + demo: org, users, courses, questions, exams, enrollments,
#      attempts); records migration count + per-table counts/md5 + image
#      identity; exercises the production seed-refusal guard; clean `down`
#      (data preserved).
#   B: a SECOND fresh temp root; receives ONLY the A data root's postgres
#      dir (cp -a, metadata-preserving) + the SAME compose + the SAME .env
#      (seed override stays behind in A — the operator removes the one-time
#      seed switch after first boot); boots the ORDINARY path with RUN_SEED
#      UNSET (no rebuild — same tagged image); preflight → NORMAL; verifies
#      byte-identical invariants + seeded admin login works.
#
# Honest labels: this is CLEAN-ROOT PROVEN. The CI workflow
# (.github/workflows/p7-c1-relocation.yml) runs the same drill across TWO
# SEPARATE runners for CLEAN-HOST PROVEN.
#
# The drill NEVER weakens the production seed refusal: it seeds via the
# test-only APP_MODE=e2e / RUN_SEED=e2e override and separately asserts that
# APP_MODE=production refuses to seed (P6-008 guard intact).
#
# Usage: ./p7-c1-relocation-drill.sh [run-number]
set -euo pipefail

RUN_NUM="${1:-1}"

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

# Self-cleaning base: strict `${REPO_ROOT}/.tmp-p7c1-drill-` prefix guard.
BASE="${REPO_ROOT}/.tmp-p7c1-drill-${RUN_NUM}-$$"
DIR_A="${BASE}/a"
DIR_B="${BASE}/b"
PROJECT_A="p7c1-drill-a-${RUN_NUM}-$$"
PROJECT_B="p7c1-drill-b-${RUN_NUM}-$$"
IMAGE_TAG="exam-p7c1-probe:latest"
APP_PORT=$((39000 + RUN_NUM))

# Strong per-run credentials (test-only, isolated throwaway stack).
PG_PASSWORD="p7c1-drill-pass-${RUN_NUM}-$(date +%s)"
JWT_SECRET="p7c1-drill-jwt-${RUN_NUM}-$(openssl rand -hex 16)"
ORIGIN="http://localhost:${APP_PORT}"
# Test-named database: the drill boots the app in APP_MODE=e2e (test-only
# seed mode), and the test-name safety guard (packages/db/src/testDb.ts)
# REFUSES a TEST_DATABASE_URL whose database name lacks "test"/"e2e"/"ci".
export POSTGRES_PASSWORD="${PG_PASSWORD}"
export JWT_SECRET="${JWT_SECRET}"
export CORS_ORIGIN="${ORIGIN}"
export PUBLIC_WEB_ORIGIN="${ORIGIN}"

DB_NAME="p7c1_drill_${RUN_NUM}_e2e"

PSQL_OUTPUT=""
PSQL_ERROR=""

psql_one() {
  # psql_one <project> <query> — run a query in the drill's db container.
  local project="$1"
  local query="$2"
  local status
  set +e
  PSQL_OUTPUT=$(
    docker exec "${project}-db-1" \
      psql -v ON_ERROR_STOP=1 -U exam -d "${DB_NAME}" -tAc "${query}" 2>&1
  )
  status=$?
  set -e
  if [ "${status}" -ne 0 ]; then
    PSQL_ERROR="${PSQL_OUTPUT}"
    PSQL_OUTPUT=""
    return 1
  fi
  PSQL_ERROR=""
  return 0
}

wait_healthy() {
  # wait_healthy <project> — app + db healthy (app runs migrate+seed first).
  local project="$1"
  for i in $(seq 1 90); do
    APP_STATUS=$(docker inspect "${project}-app-1" --format '{{.State.Health.Status}}' 2>/dev/null || echo "missing")
    DB_STATUS=$(docker inspect "${project}-db-1" --format '{{.State.Health.Status}}' 2>/dev/null || echo "missing")
    if [ "${APP_STATUS}" = "healthy" ] && [ "${DB_STATUS}" = "healthy" ]; then
      echo "  PASS: ${project} app=${APP_STATUS}, db=${DB_STATUS} (after ~$((i * 2))s)."
      return 0
    fi
    sleep 2
  done
  echo "  FAIL: ${project} did not become healthy in 180s (app=${APP_STATUS}, db=${DB_STATUS})." >&2
  docker logs "${project}-app-1" 2>&1 | tail -40 || true
  return 1
}

record_invariants() {
  # record_invariants <project> <outfile>
  local project="$1"
  local out="$2"
  : > "${out}"

  if ! psql_one "${project}" "SELECT count(*) FROM drizzle.__drizzle_migrations;"; then
    echo "  FAIL: cannot read migration count: ${PSQL_ERROR}" >&2
    return 1
  fi
  echo "migration_count=${PSQL_OUTPUT}" >> "${out}"

  # Count + content md5 (canonical row serialization ordered by id) for the
  # representative authority tables the demo seed populates.
  for table in organizations users questions exams exam_enrollments exam_attempts; do
    if ! psql_one "${project}" "SELECT count(*) FROM ${table};"; then
      echo "  FAIL: cannot read ${table} count: ${PSQL_ERROR}" >&2
      return 1
    fi
    echo "${table}_count=${PSQL_OUTPUT}" >> "${out}"
    if ! psql_one "${project}" "SELECT COALESCE(md5(string_agg(t::text, E'\n' ORDER BY id)), 'EMPTY') FROM ${table} t;"; then
      echo "  FAIL: cannot read ${table} md5: ${PSQL_ERROR}" >&2
      return 1
    fi
    echo "${table}_md5=${PSQL_OUTPUT}" >> "${out}"
  done
  return 0
}

cleanup() {
  echo "--- cleanup: tearing down drill projects ${PROJECT_A} / ${PROJECT_B} ---"
  # `down -v` is a data-level no-op (bind-mounted data, no named volumes),
  # but still tears down containers/networks. The bind-mounted data root is
  # removed explicitly below under the strict safety prefix guard.
  if [ -n "${PROJECT_A:-}" ]; then
    compose_a down -v --remove-orphans > /dev/null 2>&1 || true
  fi
  if [ -n "${PROJECT_B:-}" ]; then
    compose_b down -v --remove-orphans > /dev/null 2>&1 || true
  fi
  if [ -n "${BASE:-}" ] \
     && [ -n "${REPO_ROOT:-}" ] \
     && [[ "${BASE}" == "${REPO_ROOT}/.tmp-p7c1-drill-"* ]]; then
    # The postgres bind-mount tree is owned by the container's uid 999 (and
    # root-owned parents); make it removable by the invoking user. The image
    # runs as USER appuser, so root is forced explicitly with --user 0:0 and
    # --entrypoint chmod (the default ENTRYPOINT aborts without JWT_SECRET).
    if [ -n "${IMAGE_TAG:-}" ]; then
      docker run --rm --user 0:0 --entrypoint chmod \
        -v "${BASE}:/cleanup" "${IMAGE_TAG}" -R 777 /cleanup > /dev/null 2>&1 || true
    fi
    rm -rf "${BASE}" || true
  fi
}
trap cleanup EXIT

# Compose helpers: every compose invocation MUST run from the project dir
# with its local files — Compose resolves `.env` from the project directory
# (the dir of the first `-f` file), so referencing the repo-root compose file
# from outside the run dir breaks interpolation (EXAM_IMAGE / POSTGRES_* come
# from the per-run .env, not the repo).
compose_a() {
  ( cd "${DIR_A}" && docker compose -p "${PROJECT_A}" \
      -f docker-compose.yml -f p7-c1-seed.override.yml "$@" )
}
compose_b() {
  ( cd "${DIR_B}" && docker compose -p "${PROJECT_B}" \
      -f docker-compose.yml "$@" )
}

echo "=== P7-C1 C1.4 relocation drill #${RUN_NUM} (clean-root, projects ${PROJECT_A} → ${PROJECT_B}) ==="
echo "  base: ${BASE}"

# ── 0. Build the probe image ONCE (record identity) ──────────────────────
echo "--- 0. build probe image ${IMAGE_TAG} (record identity) ---"
docker build -t "${IMAGE_TAG}" "${REPO_ROOT}" 2>&1 | tail -3
IMAGE_IDENTITY=$(docker image inspect "${IMAGE_TAG}" \
  --format '{{.Id}} repoDigests={{.RepoDigests}}' 2>/dev/null || echo "unknown")
echo "  image identity: ${IMAGE_IDENTITY}"
mkdir -p "${BASE}"
echo "${IMAGE_IDENTITY}" > "${BASE}/image-identity.txt" 2>/dev/null || true

# ── 1. Project A: fresh root, config + data ──────────────────────────────
echo "--- 1. project A: fresh temp root + deployment config ---"
mkdir -p "${DIR_A}"
cp "${COMPOSE_FILE}" "${DIR_A}/docker-compose.yml"
cat > "${DIR_A}/.env" <<EOF
POSTGRES_PASSWORD=${PG_PASSWORD}
POSTGRES_DB=${DB_NAME}
JWT_SECRET=${JWT_SECRET}
CORS_ORIGIN=${ORIGIN}
PUBLIC_WEB_ORIGIN=${ORIGIN}
EXAM_IMAGE=${IMAGE_TAG}
APP_PORT=${APP_PORT}
EOF
# TEST-ONLY one-time seed switch (NOT part of deployment config; stays in A):
# RUN_SEED=e2e → entrypoint boots APP_MODE=e2e and runs the canonical E2E
# seed (baseline + demo). NODE_ENV is lifted off production because the demo
# seed's guard keys on NODE_ENV (demo-seed.ts); APP_MODE=e2e keeps rate
# limiting off. The production seed refusal is NOT weakened — it is asserted
# separately below (APP_MODE=production refuses to seed).
cat > "${DIR_A}/p7-c1-seed.override.yml" <<EOF
services:
  app:
    environment:
      RUN_SEED: "e2e"
      FORCE_APP_MODE: "e2e"
      NODE_ENV: "development"
      TEST_DATABASE_URL: postgresql://exam:${PG_PASSWORD}@db:5432/${DB_NAME}
EOF

# ── 2. Boot A via the ORDINARY path ──────────────────────────────────────
echo "--- 2. boot project A (ordinary path; preflight must say FRESH_INSTALL) ---"
compose_a up -d --quiet-pull 2>&1 | tail -3
wait_healthy "${PROJECT_A}"

PREFLIGHT_A=$(docker logs "${PROJECT_A}-app-1" 2>&1 \
  | grep -o '"preflight":"[A-Z_]*"' | tail -1 || true)
echo "  preflight (A): ${PREFLIGHT_A:-<not found>}"
case "${PREFLIGHT_A}" in
  '"preflight":"FRESH_INSTALL"') echo "  PASS: fresh install proceeded." ;;
  *)
    echo "  FAIL: expected FRESH_INSTALL, got ${PREFLIGHT_A:-<none>}" >&2
    exit 1
    ;;
esac

# ── 3. Production seed refusal stays intact (P6-008 safety test) ─────────
echo "--- 3. production seed refusal guard intact (P6-008) ---"
SEED_ERR=$(docker exec -e APP_MODE=production "${PROJECT_A}-app-1" \
  node dist/seed.js 2>&1 || true)
if echo "${SEED_ERR}" | grep -q "Refusing to run the baseline seed in production"; then
  echo "  PASS: baseline seed refused in APP_MODE=production."
else
  echo "  FAIL: baseline seed did not refuse in production: ${SEED_ERR}" >&2
  exit 1
fi

# ── 4. Record invariants A ───────────────────────────────────────────────
echo "--- 4. record invariants (A) ---"
INVARIANTS_A="${BASE}/invariants-a.txt"
if ! record_invariants "${PROJECT_A}" "${INVARIANTS_A}"; then
  echo "  FAIL: invariants recording (A)." >&2
  exit 1
fi
echo "  recorded:"
sed 's/^/    /' "${INVARIANTS_A}"

# ── 5. Clean shutdown (down, NOT down -v): data preserved ────────────────
echo "--- 5. clean shutdown of A (down preserves bind-mounted data) ---"
compose_a down
if [ ! -d "${DIR_A}/data/postgres" ]; then
  echo "  FAIL: ${DIR_A}/data/postgres missing after down (bind mount not preserved)." >&2
  exit 1
fi
echo "  PASS: ${DIR_A}/data/postgres preserved after down."

# ── 6. Project B: copy ONLY data root + compose + .env ───────────────────
echo "--- 6. project B: copy ONLY ./data/postgres + compose + .env ---"
mkdir -p "${DIR_B}/data"
# Metadata-preserving copy (tar, uid-999 = the postgres data owner): the
# PGDATA tree is 700/uid-999, which the invoking host user cannot read;
# copying as uid 999 preserves ownership/modes/times exactly.
chmod 777 "${DIR_B}/data"
docker run --rm --user 999:999 --entrypoint sh \
  -v "${DIR_A}/data/postgres:/src:ro" -v "${DIR_B}/data:/dst" "${IMAGE_TAG}" \
  -c 'mkdir -p /dst/postgres && tar -C /src -cf - . | tar -C /dst/postgres -xf -'
cp "${DIR_A}/docker-compose.yml" "${DIR_B}/docker-compose.yml"
cp "${DIR_A}/.env" "${DIR_B}/.env"
# The one-time seed switch never leaves project A: B boots the ordinary path
# with RUN_SEED unset (production mode, no seed).
echo "  copied: data/postgres, docker-compose.yml, .env (seed override stays in A)."

# ── 7. Boot B via the ORDINARY path (same image, no rebuild, no seed) ────
echo "--- 7. boot project B (preflight must say NORMAL; RUN_SEED unset) ---"
compose_b up -d --quiet-pull 2>&1 | tail -3
wait_healthy "${PROJECT_B}"

PREFLIGHT_B=$(docker logs "${PROJECT_B}-app-1" 2>&1 \
  | grep -o '"preflight":"[A-Z_]*"' | tail -1 || true)
echo "  preflight (B): ${PREFLIGHT_B:-<not found>}"
case "${PREFLIGHT_B}" in
  '"preflight":"NORMAL"') echo "  PASS: converged database classified NORMAL." ;;
  *)
    echo "  FAIL: expected NORMAL, got ${PREFLIGHT_B:-<none>}" >&2
    exit 1
    ;;
esac

if docker logs "${PROJECT_B}-app-1" 2>&1 \
   | grep -q "Running canonical E2E seed"; then
  echo "  FAIL: B ran a seed — RUN_SEED must stay unset in the relocated deployment." >&2
  exit 1
fi
echo "  PASS: no seed ran in B."

# ── 8. Verify invariants identical (A == B) ──────────────────────────────
echo "--- 8. verify relocated invariants identical ---"
INVARIANTS_B="${BASE}/invariants-b.txt"
if ! record_invariants "${PROJECT_B}" "${INVARIANTS_B}"; then
  echo "  FAIL: invariants recording (B)." >&2
  exit 1
fi
if diff -u "${INVARIANTS_A}" "${INVARIANTS_B}" > "${BASE}/invariants.diff" 2>&1; then
  echo "  PASS: migration count + per-table counts and md5 identical."
else
  echo "  FAIL: invariant drift after relocation:" >&2
  cat "${BASE}/invariants.diff" >&2
  exit 1
fi

# ── 9. Seeded admin login works in B ─────────────────────────────────────
echo "--- 9. seeded admin login works in B ---"
LOGIN_B=$(docker exec "${PROJECT_B}-app-1" node -e "
  fetch('http://127.0.0.1:3000/api/auth/login', {
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'Origin': '${ORIGIN}'},
    body: JSON.stringify({username: 'admin', password: 'admin123'})
  }).then(r => ({status: r.status, ok: r.ok})).then(o => console.log(JSON.stringify(o)))
    .catch(e => console.error('ERR', e.message))
" 2>&1)
echo "  login: ${LOGIN_B}"
echo "${LOGIN_B}" | grep -q '"ok":true' && echo "  PASS: seeded admin login succeeded." || {
  echo "  FAIL: seeded admin login failed." >&2
  exit 1
}

echo ""
echo "=== RUN #${RUN_NUM}: ALL CHECKS PASSED (clean-root relocation proven) ==="
