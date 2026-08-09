#!/usr/bin/env bash
# P7-C1 C1.5 — Redis non-authority proof (STRENGTHENED: Redis ENABLED).
#
# C0 §8 / ADR-001: Redis is NOT an authority — PostgreSQL is the only
# authoritative store. The default profile already has no Redis; this proof
# goes further and shows Redis persistence is OPTIONAL even when Redis is
# actually ENABLED and actively used:
#
#   Machine A (project R1): redis profile ON (authenticated), the REAL
#     rate-limit path is exercised (development mode → rate limiter enabled;
#     REDIS_URL set → the limiter's counter keys live in Redis), counters
#     verified present (ratelimit:v1:* keys), business invariants recorded.
#   Machine B (project R2): copy ONLY the PostgreSQL data root (./data/postgres
#     — Redis ./data/redis is NOT copied), redis profile ON, ordinary boot.
#     Redis starts EMPTY (dbsize=0): Exam business invariants are identical
#     to A and the seeded admin login works — only the rate-limit counters
#     were reset.
#
# Proves: Redis persistence is optional even with Redis enabled; dropping
# ./data/redis is always safe for Exam truth.
#
# Never touches exam / exam_test / exam_e2e (own isolated Compose projects
# on a fresh PG data root with a throwaway test-named database).
#
# Usage: ./p7-c1-redis-nonauthority-proof.sh [run-number]
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

# Self-cleaning base: strict `${REPO_ROOT}/.tmp-p7c1-redis-` prefix guard.
BASE="${REPO_ROOT}/.tmp-p7c1-redis-${RUN_NUM}-$$"
DIR_A="${BASE}/a"
DIR_B="${BASE}/b"
PROJECT_A="p7c1-redis-a-${RUN_NUM}-$$"
PROJECT_B="p7c1-redis-b-${RUN_NUM}-$$"
# Reuse the probe image the relocation drill builds; build it only if missing.
IMAGE_TAG="${EXAM_PROBE_IMAGE:-exam-p7c1-probe:latest}"
APP_PORT=$((39100 + RUN_NUM))

# Strong per-run credentials (test-only, isolated throwaway stack).
PG_PASSWORD="p7c1-redis-pass-${RUN_NUM}-$(date +%s)"
REDIS_PASSWORD="p7c1-redis-secret-${RUN_NUM}-$(openssl rand -hex 8)"
JWT_SECRET="p7c1-redis-jwt-${RUN_NUM}-$(openssl rand -hex 16)"
ORIGIN="http://localhost:${APP_PORT}"
export POSTGRES_PASSWORD="${PG_PASSWORD}"
export JWT_SECRET="${JWT_SECRET}"
export CORS_ORIGIN="${ORIGIN}"
export PUBLIC_WEB_ORIGIN="${ORIGIN}"

PSQL_OUTPUT=""
PSQL_ERROR=""

psql_one() {
  local project="$1"
  local query="$2"
  local status
  set +e
  PSQL_OUTPUT=$(
    docker exec "${project}-db-1" \
      psql -v ON_ERROR_STOP=1 -U exam -d exam -tAc "${query}" 2>&1
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
  local project="$1"
  for i in $(seq 1 90); do
    APP_STATUS=$(docker inspect "${project}-app-1" --format '{{.State.Health.Status}}' 2>/dev/null || echo "missing")
    DB_STATUS=$(docker inspect "${project}-db-1" --format '{{.State.Health.Status}}' 2>/dev/null || echo "missing")
    REDIS_STATUS=$(docker inspect "${project}-redis-1" --format '{{.State.Health.Status}}' 2>/dev/null || echo "missing")
    if [ "${APP_STATUS}" = "healthy" ] && [ "${DB_STATUS}" = "healthy" ] && [ "${REDIS_STATUS}" = "healthy" ]; then
      echo "  PASS: ${project} app=${APP_STATUS}, db=${DB_STATUS}, redis=${REDIS_STATUS} (after ~$((i * 2))s)."
      return 0
    fi
    sleep 2
  done
  echo "  FAIL: ${project} did not become healthy in 180s (app=${APP_STATUS}, db=${DB_STATUS}, redis=${REDIS_STATUS})." >&2
  docker logs "${project}-app-1" 2>&1 | tail -40 || true
  return 1
}

redis_dbsize() {
  # redis_dbsize <project> — number of keys in the project's Redis.
  local project="$1"
  docker exec -e REDIS_PASSWORD="${REDIS_PASSWORD}" "${project}-redis-1" \
    sh -lc 'redis-cli -a "$REDIS_PASSWORD" --no-auth-warning dbsize' 2>/dev/null
}

redis_ratelimit_key_count() {
  # redis_ratelimit_key_count <project> — count of rate-limit keyspace entries.
  local project="$1"
  docker exec -e REDIS_PASSWORD="${REDIS_PASSWORD}" "${project}-redis-1" \
    sh -lc 'redis-cli -a "$REDIS_PASSWORD" --no-auth-warning --scan --pattern "ratelimit:v1:*" | wc -l' 2>/dev/null
}

record_invariants() {
  local project="$1"
  local out="$2"
  : > "${out}"

  if ! psql_one "${project}" "SELECT count(*) FROM drizzle.__drizzle_migrations;"; then
    echo "  FAIL: cannot read migration count: ${PSQL_ERROR}" >&2
    return 1
  fi
  echo "migration_count=${PSQL_OUTPUT}" >> "${out}"

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
  echo "--- cleanup: tearing down proof projects ${PROJECT_A} / ${PROJECT_B} ---"
  if [ -n "${PROJECT_A:-}" ]; then
    compose_a down -v --remove-orphans > /dev/null 2>&1 || true
  fi
  if [ -n "${PROJECT_B:-}" ]; then
    compose_b down -v --remove-orphans > /dev/null 2>&1 || true
  fi
  if [ -n "${BASE:-}" ] \
     && [ -n "${REPO_ROOT:-}" ] \
     && [[ "${BASE}" == "${REPO_ROOT}/.tmp-p7c1-redis-"* ]]; then
    # The postgres bind-mount tree is owned by container uid 999; the image
    # runs as USER appuser, so force root with --user 0:0 and --entrypoint
    # chmod (the default ENTRYPOINT aborts without JWT_SECRET).
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
      -f docker-compose.yml -f p7-c1-seed.override.yml \
      --profile redis "$@" )
}
compose_b() {
  ( cd "${DIR_B}" && docker compose -p "${PROJECT_B}" \
      -f docker-compose.yml --profile redis "$@" )
}

echo "=== P7-C1 C1.5 Redis non-authority proof #${RUN_NUM} (redis ENABLED, projects ${PROJECT_A} → ${PROJECT_B}) ==="
echo "  base: ${BASE}"

# ── 0. Probe image (build once if missing) ───────────────────────────────
if ! docker image inspect "${IMAGE_TAG}" > /dev/null 2>&1; then
  echo "--- 0. building probe image ${IMAGE_TAG} ---"
  docker build -t "${IMAGE_TAG}" "${REPO_ROOT}" 2>&1 | tail -3
else
  echo "--- 0. reuse probe image ${IMAGE_TAG} ---"
fi

# ── 1. Machine A: redis profile ON + seed override ───────────────────────
echo "--- 1. machine A: fresh root + deployment config (redis profile ON) ---"
mkdir -p "${DIR_A}"
cp "${COMPOSE_FILE}" "${DIR_A}/docker-compose.yml"
cat > "${DIR_A}/.env" <<EOF
POSTGRES_PASSWORD=${PG_PASSWORD}
JWT_SECRET=${JWT_SECRET}
CORS_ORIGIN=${ORIGIN}
PUBLIC_WEB_ORIGIN=${ORIGIN}
EXAM_IMAGE=${IMAGE_TAG}
APP_PORT=${APP_PORT}
REDIS_PASSWORD=${REDIS_PASSWORD}
REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379
EOF
# TEST-ONLY one-time seed switch (stays in A). FORCE_APP_MODE=development
# keeps the rate limiter ENABLED (e2e mode disables it) so the REAL
# rate-limit path actually writes to Redis. NODE_ENV is lifted off production
# because the demo seed's guard keys on NODE_ENV (demo-seed.ts).
cat > "${DIR_A}/p7-c1-seed.override.yml" <<EOF
services:
  app:
    environment:
      RUN_SEED: "e2e"
      FORCE_APP_MODE: "development"
      NODE_ENV: "development"
EOF

echo "--- 2. boot machine A (redis profile ON; seed; rate limiter enabled) ---"
compose_a up -d --quiet-pull 2>&1 | tail -3
wait_healthy "${PROJECT_A}"

# ── 3. Exercise the REAL rate-limit path (wrong-password logins) ─────────
echo "--- 3. exercise the real rate-limit path (login max=10/60s) ---"
RATE_LIMITED=0
for i in $(seq 1 15); do
  STATUS=$(docker exec "${PROJECT_A}-app-1" node -e "
    fetch('http://127.0.0.1:3000/api/auth/login', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', 'Origin': '${ORIGIN}'},
      body: JSON.stringify({username: 'admin', password: 'wrong-password'})
    }).then(r => r.status).then(s => console.log(s)).catch(e => console.error('ERR', e.message))
  " 2>/dev/null || echo "ERR")
  if [ "${STATUS}" = "429" ]; then
    RATE_LIMITED=1
    echo "  rate limited on attempt ${i} (HTTP 429)."
    break
  fi
done
if [ "${RATE_LIMITED}" = "0" ]; then
  echo "  FAIL: never hit HTTP 429 after 15 failed logins — rate limiter not active." >&2
  exit 1
fi

A_RKEY_COUNT=$(redis_ratelimit_key_count "${PROJECT_A}")
A_RDB_SIZE=$(redis_dbsize "${PROJECT_A}")
echo "  redis ratelimit:v1:* keys: ${A_RKEY_COUNT}; dbsize: ${A_RDB_SIZE}"
if [ "${A_RKEY_COUNT}" = "0" ] || [ "${A_RDB_SIZE}" = "0" ]; then
  echo "  FAIL: Redis has no rate-limit keys — counters did NOT land in Redis." >&2
  exit 1
fi
echo "  PASS: rate-limit counters live in Redis on machine A."

# ── 4. Record invariants A ───────────────────────────────────────────────
echo "--- 4. record invariants (A) ---"
INVARIANTS_A="${BASE}/invariants-a.txt"
if ! record_invariants "${PROJECT_A}" "${INVARIANTS_A}"; then
  echo "  FAIL: invariants recording (A)." >&2
  exit 1
fi
sed 's/^/    /' "${INVARIANTS_A}"

# ── 5. Clean shutdown (data preserved) ───────────────────────────────────
echo "--- 5. clean shutdown of A (down preserves bind-mounted data) ---"
compose_a down
for d in data/postgres data/redis; do
  if [ ! -d "${DIR_A}/${d}" ]; then
    echo "  FAIL: ${DIR_A}/${d} missing after down." >&2
    exit 1
  fi
done
echo "  PASS: data/postgres AND data/redis preserved after down."

# ── 6. Machine B: copy ONLY postgres (NOT redis) ─────────────────────────
echo "--- 6. machine B: copy ONLY ./data/postgres (Redis data deliberately dropped) ---"
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
echo "  copied: data/postgres, docker-compose.yml, .env. ./data/redis NOT copied."

# ── 7. Boot B (redis profile ON; Redis data root was NOT copied) ─────────
echo "--- 7. boot machine B (redis profile ON; ./data/redis was not copied) ---"
compose_b up -d --quiet-pull 2>&1 | tail -3
wait_healthy "${PROJECT_B}"

# The redis DATA ROOT is fresh, but B's own traffic (e.g. the app
# healthcheck, which is also rate-limited) immediately creates fresh
# counters — so "dbsize == 0" is not the right assertion. What must NOT
# survive is A's persisted state: the burned login counter. Key names are
# route+IP-digest (deterministic for the same secret/IP), so A's burned
# `POST /api/auth/login` counter and B's fresh one share a NAME but not a
# VALUE — the behavioral proof is step 9 (B's first login succeeds while
# the same request in A is 429).
B_RKEY_COUNT=$(redis_ratelimit_key_count "${PROJECT_B}")
B_RDB_SIZE=$(redis_dbsize "${PROJECT_B}")
echo "  redis ratelimit:v1:* keys: ${B_RKEY_COUNT}; dbsize: ${B_RDB_SIZE} (fresh keys from B's own traffic)"
echo "  (A had ${A_RKEY_COUNT} keys / dbsize ${A_RDB_SIZE} incl. the burned login counter)"

# ── 8. Verify business invariants identical ──────────────────────────────
echo "--- 8. verify business invariants identical (A == B) ---"
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

# ── 9. Login works in B — only the counters were reset ───────────────────
echo "--- 9. seeded admin login works in B on the FIRST attempt (counters reset) ---"
# In A the login route was burned to HTTP 429 by step 3. If Redis
# persistence had leaked across the relocation, B's first login (same
# route + same IP digest + same secret → same counter) would also be 429.
# It must succeed: only the rate-limit counters were reset, business state
# is intact.
LOGIN_B=$(docker exec "${PROJECT_B}-app-1" node -e "
  fetch('http://127.0.0.1:3000/api/auth/login', {
    method: 'POST',
    headers: {'Content-Type': 'application/json', 'Origin': '${ORIGIN}'},
    body: JSON.stringify({username: 'admin', password: 'admin123'})
  }).then(r => ({status: r.status, ok: r.ok})).then(o => console.log(JSON.stringify(o)))
    .catch(e => console.error('ERR', e.message))
" 2>&1)
echo "  login: ${LOGIN_B}"
echo "${LOGIN_B}" | grep -q '"ok":true' && echo "  PASS: seeded admin login succeeded — Redis counters did NOT persist across relocation." || {
  echo "  FAIL: seeded admin login failed." >&2
  exit 1
}

echo ""
echo "=== RUN #${RUN_NUM}: ALL CHECKS PASSED (Redis non-authority proven with Redis ENABLED) ==="
