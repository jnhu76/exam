#!/usr/bin/env bash
# List all test_* schemas in the test database.
# Usage:
#   bash scripts/db/list-test-schemas.sh
#   DATABASE_URL="postgresql://..." bash scripts/db/list-test-schemas.sh
#
# DB guard: mirrors drop-test-schemas.sh — only a test database
# (exam_test / exam_test_w*) makes sense for listing test_* schemas.

set -euo pipefail

DB_URL="${DATABASE_URL:-postgresql://exam:exam@localhost:${DB_HOST_PORT:-5432}/exam_test}"

CURRENT_DB="$(psql "$DB_URL" -t -A -c 'SELECT current_database();' | tr -d '[:space:]')"
case "${CURRENT_DB}" in
  exam_test|exam_test_w*)
    ;;
  *)
    echo "FAIL: refusing to list schemas in database '${CURRENT_DB}' —" >&2
    echo "      this script may only run against a test database (exam_test)." >&2
    exit 2
    ;;
esac

psql "$DB_URL" -t -A <<'SQL'
  SELECT schema_name
  FROM information_schema.schemata
  WHERE schema_name LIKE 'test\_%'
  ORDER BY schema_name;
SQL
