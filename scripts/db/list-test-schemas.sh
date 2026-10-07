#!/usr/bin/env bash
# List all test_* schemas in the test database.
# Usage:
#   bash scripts/db/list-test-schemas.sh
#   TEST_DATABASE_URL="postgresql://..." bash scripts/db/list-test-schemas.sh
#
# Target authority: mirrors drop-test-schemas.sh — the test database target
# comes from the canonical resolver (packages/db/src/databaseUrl.ts::
# resolveTestBranchUrl) through its executable projection
# (src/testDatabaseUrlCli.ts). DATABASE_URL is never consulted (#733 R6).
#
# DB guard: only a test database (exam_test / exam_test_w*) makes sense for
# listing test_* schemas; the connected database is re-checked via
# current_database() before any query runs.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# Canonical TEST_DATABASE_TARGET projection — no shell-local URL grammar.
# A non-zero seam exit stops here under set -e, before any psql call.
DB_URL="$(cd "$repo_root" && pnpm --filter @exam/db exec tsx src/testDatabaseUrlCli.ts)"

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
