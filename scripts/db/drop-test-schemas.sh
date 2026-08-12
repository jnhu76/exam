#!/usr/bin/env bash
# Drop all test_* schemas from the test database.
# Safety: NEVER drops public, drizzle, pg_catalog, or information_schema.
# Usage:
#   bash scripts/db/drop-test-schemas.sh
#   DATABASE_URL="postgresql://..." bash scripts/db/drop-test-schemas.sh
#
# DB guard: this script is DESTRUCTIVE (schema drops). It refuses to run
# against anything but a test database (exam_test / exam_test_w* worker
# databases) — pointing it at `exam` (dev) or `exam_e2e` (E2E) is an error.

set -euo pipefail

DB_URL="${DATABASE_URL:-postgresql://exam:exam@localhost:15432/exam_test}"

CURRENT_DB="$(psql "$DB_URL" -t -A -c 'SELECT current_database();' | tr -d '[:space:]')"
case "${CURRENT_DB}" in
  exam_test|exam_test_w*)
    ;;
  *)
    echo "FAIL: refusing to drop schemas in database '${CURRENT_DB}' —" >&2
    echo "      this script may only run against a test database (exam_test)." >&2
    exit 2
    ;;
esac
echo "Guard OK: current database is '${CURRENT_DB}' (test database)."

echo "Listing test_* schemas before drop:"
psql "$DB_URL" -t -A <<'SQL'
  SELECT schema_name
  FROM information_schema.schemata
  WHERE schema_name LIKE 'test\_%'
  ORDER BY schema_name;
SQL

COUNT=$(psql "$DB_URL" -t -A <<'SQL'
  SELECT count(*)
  FROM information_schema.schemata
  WHERE schema_name LIKE 'test\_%';
SQL
)

if [ "$COUNT" -eq 0 ]; then
  echo "No test_* schemas found."
  exit 0
fi

echo ""
echo "Dropping ${COUNT} test_* schema(s)..."
psql "$DB_URL" <<'SQL'
  DO $$
  DECLARE
    rec RECORD;
  BEGIN
    FOR rec IN
      SELECT schema_name
      FROM information_schema.schemata
      WHERE schema_name LIKE 'test\_%'
      ORDER BY schema_name
    LOOP
      EXECUTE format('DROP SCHEMA IF EXISTS %I CASCADE', rec.schema_name);
      RAISE NOTICE 'Dropped schema: %', rec.schema_name;
    END LOOP;
  END $$;
SQL

echo ""
echo "Done. Remaining test_* schemas:"
psql "$DB_URL" -t -A <<'SQL'
  SELECT schema_name
  FROM information_schema.schemata
  WHERE schema_name LIKE 'test\_%'
  ORDER BY schema_name;
SQL

echo "All test schemas dropped."
