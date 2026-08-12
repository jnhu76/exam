#!/usr/bin/env bash
# List all test_* schemas in the test database.
# Usage:
#   bash scripts/db/list-test-schemas.sh
#   DATABASE_URL="postgresql://..." bash scripts/db/list-test-schemas.sh

set -euo pipefail

DB_URL="${DATABASE_URL:-postgresql://exam:exam@localhost:15432/exam_test}"

psql "$DB_URL" -t -A <<'SQL'
  SELECT schema_name
  FROM information_schema.schemata
  WHERE schema_name LIKE 'test\_%'
  ORDER BY schema_name;
SQL
