#!/bin/sh
set -e

if [ -z "$JWT_SECRET" ]; then
  echo "ERROR: JWT_SECRET environment variable is required"
  exit 1
fi

echo "Running database migrations..."
node dist/scripts/migrate.js

# Seed mode selection:
#   RUN_SEED=1   → baseline seed only (admin / candidate / candidate2)
#   RUN_SEED=e2e → canonical E2E seed (baseline + demo: candidate1..4)
# Local Docker E2E (scripts/e2e/run.sh + docker-compose.test.yml) and CI E2E
# must converge on RUN_SEED=e2e to share one seed contract.
case "$RUN_SEED" in
  e2e)
    echo "Running canonical E2E seed (baseline + demo)..."
    node dist/e2e-seed.js --skip-migrate
    ;;
  1)
    echo "Running baseline seed..."
    node dist/seed.js --skip-migrate
    ;;
  "" )
    : # no seed
    ;;
  *)
    echo "WARN: unknown RUN_SEED='$RUN_SEED' (expected '', '1', or 'e2e'); skipping seed"
    ;;
esac

echo "Starting server..."
exec node dist/server.js
