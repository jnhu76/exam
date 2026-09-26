#!/usr/bin/env bash
# The ONE operator backup/restore path: pg_dump -Fc / pg_restore against the
# production Compose stack (docker-compose.yml + .env.production).
#
# Usage:
#   ./scripts/db-backup.sh backup  /path/exam.dump
#   ./scripts/db-backup.sh restore /path/exam.dump
#
# backup : pg_dump -Fc inside the running db container -> host file (streamed
#          with exec -T; no temp copy on the container filesystem).
# restore: stop the app (the only DB writer), DROP + CREATE the target DB
#          from template0, pg_restore the dump, restart the app, wait for
#          its healthcheck.
#
# DB identity is resolved from the RUNNING db container (printenv), never
# re-parsed from the env file, so backup/restore always address the database
# the stack is actually using. Scheduling and retention belong to
# cron/systemd and operator policy, not to this script.

set -euo pipefail

usage() {
  echo "Usage: $0 backup|restore /path/exam.dump" >&2
  exit 2
}

[[ $# -eq 2 ]] || usage
MODE="$1"
DUMP_FILE="$2"
case "$MODE" in
  backup | restore) ;;
  *) usage ;;
esac

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env.production"
COMPOSE_FILE="$ROOT_DIR/docker-compose.yml"

[[ -f "$ENV_FILE" ]] || {
  echo "ERROR: $ENV_FILE not found (create it first: node scripts/init-production-env.mjs)" >&2
  exit 1
}
[[ "$MODE" == "backup" || -f "$DUMP_FILE" ]] || {
  echo "ERROR: dump file $DUMP_FILE does not exist" >&2
  exit 1
}

compose() { docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"; }

compose ps -q db | grep -q . || {
  echo "ERROR: production db container is not running (docker compose --env-file .env.production -f docker-compose.yml up -d)" >&2
  exit 1
}

# </dev/null: compose exec attaches stdin by default and would drain a
# piped-in restore confirmation before `read` sees it.
PGUSER="$(compose exec -T db printenv POSTGRES_USER < /dev/null)"
PGDB="$(compose exec -T db printenv POSTGRES_DB < /dev/null)"

if [[ "$MODE" == "backup" ]]; then
  mkdir -p "$(dirname "$DUMP_FILE")"
  compose exec -T db pg_dump -U "$PGUSER" -Fc "$PGDB" < /dev/null > "$DUMP_FILE"
  echo "Backup written: $DUMP_FILE ($(wc -c < "$DUMP_FILE") bytes)"
  exit 0
fi

echo "RESTORE will DROP the current database '$PGDB' and overwrite it with $DUMP_FILE."
read -r -p "Type the database name to confirm [$PGDB]: " CONFIRM
[[ "$CONFIRM" == "$PGDB" ]] || {
  echo "Aborted." >&2
  exit 1
}

echo "Stopping app (sole DB writer)..."
compose stop app

echo "Recreating clean target database..."
compose exec -T db psql -U "$PGUSER" -d postgres -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS \"$PGDB\" WITH (FORCE)" \
  -c "CREATE DATABASE \"$PGDB\" TEMPLATE template0" < /dev/null

echo "Restoring dump..."
compose exec -T db pg_restore -U "$PGUSER" -d "$PGDB" --no-owner < "$DUMP_FILE"

echo "Restarting app..."
compose up -d --wait app >/dev/null

echo "Restore complete. Verifying app health..."
for _ in $(seq 1 30); do
  health="$(docker inspect --format '{{.State.Health.Status}}' "$(compose ps -q app)" 2>/dev/null || echo unknown)"
  [[ "$health" == "healthy" ]] && { echo "app is healthy."; exit 0; }
  sleep 2
done
echo "WARNING: app did not become healthy within 60s — check: docker compose --env-file .env.production -f docker-compose.yml logs app" >&2
exit 1
