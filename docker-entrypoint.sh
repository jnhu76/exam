#!/bin/sh
set -e

# E2E seed implies the E2E runtime mode: when RUN_SEED=e2e, default APP_MODE to
# "e2e" (the E2E runtime mode). This is necessary because the image's
# Dockerfile sets ENV APP_MODE=production, and production-mode security headers
# (Strict-Transport-Security + Secure cookies) are wrong for the plain-HTTP E2E
# app container: they make browsers upgrade HTTP->HTTPS, causing
# ERR_SSL_PROTOCOL_ERROR (no TLS server). In e2e mode runtimeConfig resolves
# isProduction=false -> no HSTS, no Secure cookie.
# A caller may still override via FORCE_APP_MODE to validate production headers.
if [ "$RUN_SEED" = "e2e" ]; then
  APP_MODE="${FORCE_APP_MODE:-e2e}"
  export APP_MODE
fi

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
