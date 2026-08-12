#!/usr/bin/env bash
# Drop all test_* schemas from the test database.
# Safety: NEVER drops public, drizzle, pg_catalog, or information_schema.
# Usage:
#   bash scripts/db/drop-test-schemas.sh
#   DATABASE_URL="postgresql://..." bash scripts/db/drop-test-schemas.sh

set -euo pipefail

DB_URL="${DATABASE_URL:-postgresql://exam:exam@localhost:15432/exam_test}"

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
