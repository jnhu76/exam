#!/usr/bin/env bash
# Shared mechanical helpers for the deployment verification suite.
#
# This library is intentionally mechanical: it factors only the repeated
# primitives (compose invocation, readiness polling, temp-root handling,
# probe writes) out of the capability tests. It is NOT a deployment
# framework — no abstractions beyond plain functions.
#
# Every test sources this file and then calls the capability helpers.
# All tests run against an ISOLATED Compose project (COMPOSE_PROJECT_NAME)
# and an isolated temp EXAM_DATA_ROOT so the repo-root ./data/ and any
# human/dev stack are never touched.
set -euo pipefail

LIB_DIR="$(
  cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1
  pwd
)"
REPO_ROOT="$(cd -- "${LIB_DIR}/../.." && pwd)"
COMPOSE_FILE="${REPO_ROOT}/docker-compose.yml"
# Source-build override (the single build-mode surface). The deployment
# verification suites ARE contributor/PR acceptance: every invocation merges
# this override so the app/email-worker images are built from THE CURRENT
# CHECKOUT (pull_policy: build) — a stale registry or local image can never
# fake a passing acceptance run, regardless of the operator `image:` pin in
# docker-compose.yml (#319 contract, #321 two-path split).
BUILD_OVERRIDE_FILE="${REPO_ROOT}/docker-compose.build.yml"

# ── Compose ──────────────────────────────────────────────────────────────
# Run docker compose against the canonical production compose file.
# Usage: run_compose [PROJECT] [ARGS...]
#   - when PROJECT is given (first arg, not starting with '-'), it is
#     passed as -p PROJECT (isolated Compose project);
#   - an explicit EMPTY first argument is consumed and dropped (helpers that
#     pass "${project}" with project empty do not forward an empty arg);
#   - otherwise COMPOSE_PROJECT_NAME is used if set (Compose native).
#
# Env authority: when DEPLOY_ENV_FILE is set (absolute path), it is passed
# as Compose's explicit --env-file — the same operator invocation the
# runbook documents (`docker compose --env-file .env.deploy ...`). Compose
# then NEVER reads the repo-root .env for interpolation, so a developer's
# dev secrets cannot leak into a test stack. Unset = legacy behavior
# (every required key is explicitly exported by the suites, which take
# precedence over any ambient .env; no test stack reads developer files).
#
# EXAM_IMAGE interpolation (#321): the operator file requires EXAM_IMAGE
# even though acceptance never RUNS that image (the build override below
# replaces it on app + email-worker). In DEPLOY_ENV_FILE mode the generated
# file carries the pin; in legacy-export mode there is no env file, so a
# placeholder is defaulted here — interpolation-only, never pulled or run.
run_compose() {
  local project=""
  if [ "${1:-}" != "" ] && [[ "${1}" != -* ]]; then
    project="$1"
    shift
  elif [ "${1:-}" = "" ]; then
    shift
  fi
  local -a args=(docker compose -f "${COMPOSE_FILE}" -f "${BUILD_OVERRIDE_FILE}")
  if [ -n "${DEPLOY_ENV_FILE:-}" ]; then
    args+=(--env-file "${DEPLOY_ENV_FILE}")
  else
    export EXAM_IMAGE="${EXAM_IMAGE:-exam-local:dev}"
  fi
  if [ -n "${project}" ]; then
    args+=(-p "${project}")
  fi
  "${args[@]}" "$@"
}

# Read one KEY=VALUE pair from DEPLOY_ENV_FILE (or an explicitly given
# file) and print the value; prints nothing when the key is absent/blank.
# Handles `export `-prefixed lines, trailing CR, and double-quoted values.
# Usage: env_file_value <KEY> [file="${DEPLOY_ENV_FILE}"]
env_file_value() {
  local key="${1:?env_file_value: missing key}"
  local file="${2:-${DEPLOY_ENV_FILE:-}}"
  if [ -z "${file}" ] || [ ! -f "${file}" ]; then
    return 0
  fi
  sed -n -E "s/^(export[[:space:]]+)?${key}=\"?(.*)\$/\\2/p" "${file}" \
    | tr -d '\r' | sed 's/"$//' | head -1
}

# Resolve the db container ID for a project via Compose (the authority on
# container names — never hand-construct <project>-db-1).
db_container() {
  local project="${1:-}"
  run_compose "${project}" ps -q db 2>/dev/null | head -1
}

# Resolve the app container ID for a project via Compose.
app_container() {
  local project="${1:-}"
  run_compose "${project}" ps -q app 2>/dev/null | head -1
}

# Best-effort teardown of an isolated project (never fatal). Extra args are
# compose GLOBAL options and must precede the `down` subcommand — e.g.
# `--profile redis` (profile-gated services are NOT in the compose model
# without it, so a plain down leaves them behind).
compose_down_best_effort() {
  local project="${1:-}"
  shift || true
  run_compose "${project}" "$@" down --remove-orphans >/dev/null 2>&1 || true
}

# Tail logs of a service in a project (diagnostics only).
compose_logs() {
  local project="${1:-}" service="$2" tail_n="${3:-40}"
  run_compose "${project}" logs --tail="${tail_n}" "${service}" 2>&1 || true
}

# ── Readiness polling (bounded, deterministic — no arbitrary sleeps) ─────
# Derive POSTGRES_USER / POSTGRES_DB from the RUNNING db container
# (fallback exam/exam — the canonical compose defaults), so a deployment
# with customized POSTGRES_USER/POSTGRES_DB is honored.
pg_user_db() {
  local project="${1:-}"
  local c
  c="$(db_container "${project}")"
  local user db
  user="$(docker inspect "${c}" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null \
    | sed -n 's/^POSTGRES_USER=//p' | head -1)"
  db="$(docker inspect "${c}" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null \
    | sed -n 's/^POSTGRES_DB=//p' | head -1)"
  printf '%s %s' "${user:-exam}" "${db:-exam}"
}

wait_for_postgres() {
  local project="${1:-}"
  local c pg_user pg_db
  for _ in $(seq 1 60); do
    c="$(db_container "${project}")"
    if [ -n "${c}" ]; then
      read -r pg_user pg_db <<< "$(pg_user_db "${project}")"
      if docker exec "${c}" pg_isready -U "${pg_user}" -d "${pg_db}" >/dev/null 2>&1; then
        return 0
      fi
    fi
    sleep 1
  done
  echo "FAIL: db never became ready (project '${project:-${COMPOSE_PROJECT_NAME:-}}')." >&2
  exit 1
}

wait_for_app() {
  local project="${1:-}"
  local c
  for _ in $(seq 1 90); do
    c="$(app_container "${project}")"
    if [ -n "${c}" ] && docker exec "${c}" node -e \
      "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
      >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  echo "FAIL: app never became healthy (project '${project:-${COMPOSE_PROJECT_NAME:-}}')." >&2
  exit 1
}

# Wait until the given WAL segment name exists in the /wal-archive mount
# of the db container (real archiver evidence, not a fixed sleep).
wait_for_archived_wal() {
  local project="${1:-}" segment="$2"
  local c
  for _ in $(seq 1 30); do
    c="$(db_container "${project}")"
    if [ -n "${c}" ] && docker exec "${c}" test -f "/wal-archive/${segment}" 2>/dev/null; then
      return 0
    fi
    sleep 1
  done
  echo "FAIL: archived WAL segment '${segment}' never appeared in /wal-archive." >&2
  exit 1
}

# ── Temp roots ───────────────────────────────────────────────────────────
# Registry of every path safe_temp_root has created. cleanup_temp_root
# removes ONLY a path recorded here (exact match), so the TMPDIR location
# never matters and an arbitrary path can never be removed.
SAFE_TEMP_ROOTS=()

# Create a temp root with the given mktemp prefix, record it in the
# registry, and assign the path to the caller's variable (passed by NAME).
# The variable-name convention is REQUIRED: a `VAR="$(safe_temp_root ...)"`
# command-substitution call would run the function in a subshell and the
# registry append would be lost, silently disabling cleanup. printf -v
# assigns in the caller's scope, so both effects survive.
safe_temp_root() {
  local prefix="${1:?safe_temp_root: missing mktemp prefix}"
  local var="${2:?safe_temp_root: missing variable name}"
  local d
  d="$(mktemp -d -t "${prefix}-XXXXXX")"
  SAFE_TEMP_ROOTS+=("${d}")
  printf -v "${var}" '%s' "${d}"
}

# Remove a temp root created by safe_temp_root. Files inside may be owned
# by the container postgres user (not host-readable), so removal is
# container-assisted. Paths NOT recorded by safe_temp_root are never
# touched.
cleanup_temp_root() {
  local d="$1"
  local i
  local remaining=()
  local found="no"
  for i in "${SAFE_TEMP_ROOTS[@]}"; do
    if [ "${i}" = "${d}" ]; then
      found="yes"
    else
      remaining+=("${i}")
    fi
  done
  if [ "${found}" != "yes" ]; then
    return 0
  fi
  SAFE_TEMP_ROOTS=("${remaining[@]}")
  if [ ! -d "${d}" ]; then
    return 0
  fi
  docker run --rm -v "${d}:/d" alpine:latest \
    sh -c 'rm -rf /d/* /d/.[!.]* 2>/dev/null || true' \
    >/dev/null 2>&1 || true
  rmdir "${d}" 2>/dev/null || rm -rf "${d}" 2>/dev/null || true
  if [ -d "${d}" ]; then
    echo "WARN: cleanup_temp_root could not fully remove ${d} (left in place)." >&2
  fi
}

# ── PostgreSQL version discovery ─────────────────────────────────────────
# The PostgreSQL image + major version are derived from the canonical
# compose file (single source of truth), so a version bump in
# docker-compose.yml updates the tests automatically.
PG_IMAGE="$(sed -n 's/^[[:space:]]*image:[[:space:]]*\(postgres:[^[:space:]]*\).*/\1/p' \
  "${COMPOSE_FILE}" | head -1)"
PG_MAJOR="$(printf '%s' "${PG_IMAGE}" | sed -n 's/^postgres:\([0-9][0-9]*\).*/\1/p')"

# ── Exam probe state ─────────────────────────────────────────────────────
# psql -tAc against the project's db container with the deployment's
# POSTGRES_USER / POSTGRES_DB (derived from the container, exam fallback).
psql_exec() {
  local project="${1:-}" sql="$2"
  local c pg_user pg_db
  c="$(db_container "${project}")"
  read -r pg_user pg_db <<< "$(pg_user_db "${project}")"
  docker exec "${c}" psql -v ON_ERROR_STOP=1 -U "${pg_user}" -d "${pg_db}" -tAc "${sql}"
}

# Bootstrap the first Admin via the canonical CLI inside the app container.
bootstrap_admin() {
  local project="${1:-}" username="$2" password="$3" name="$4" org="$5"
  local c
  c="$(app_container "${project}")"
  docker exec "${c}" node dist/scripts/bootstrap-admin.js \
    --username "${username}" --password "${password}" \
    --name "${name}" --organization-name "${org}" >/dev/null
}

# Idempotent probe-marker write (schema/table created if absent). The probe
# lives in a dedicated schema, independent of app tables, so app
# migration/seed changes cannot make the invariants flaky.
write_probe() {
  local project="${1:-}" schema_name="$2" table_name="$3" id="$4" label="$5"
  psql_exec "${project}" "CREATE SCHEMA IF NOT EXISTS ${schema_name};"
  psql_exec "${project}" "CREATE TABLE IF NOT EXISTS ${schema_name}.${table_name} (id text primary key, label text not null, written_at text not null);"
  psql_exec "${project}" "INSERT INTO ${schema_name}.${table_name} (id, label, written_at) VALUES ('${id}','${label}', now()::text) ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, written_at = EXCLUDED.written_at;"
}

# Read a probe label, or "ABSENT" when the row does not exist (or the
# cluster is not yet queryable — callers decide whether that is a failure).
probe_label() {
  local project="${1:-}" schema_name="$2" table_name="$3" id="$4"
  local out
  out="$(psql_exec "${project}" "SELECT label FROM ${schema_name}.${table_name} WHERE id='${id}';" 2>/dev/null | head -1 || true)"
  if [ -z "${out}" ]; then
    echo "ABSENT"
  else
    echo "${out}"
  fi
}

# Business invariants digest: orgs|active-admins|admin.bootstrap audits.
# Tests append their own probe labels.
capture_business_invariants() {
  local project="${1:-}"
  local orgs admins audit
  orgs="$(psql_exec "${project}" "SELECT count(*) FROM organizations;")"
  admins="$(psql_exec "${project}" "SELECT count(*) FROM users WHERE role='Admin' AND is_active=true;")"
  audit="$(psql_exec "${project}" "SELECT count(*) FROM audit_logs WHERE action='admin.bootstrap';")"
  printf 'orgs=%s|admins=%s|audit=%s' "${orgs}" "${admins}" "${audit}"
}
