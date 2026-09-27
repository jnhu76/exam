#!/bin/sh
set -e

# INVARIANT: the image entrypoint only checks required config, runs the
# canonical migration, and execs the server. It never seeds and never derives
# APP_MODE from seed flags (issue #636). APP_MODE resolution authority is the
# app resolver (packages/db/src/databaseUrl.ts) fed by the environment; the
# image default is APP_MODE=production (Dockerfile). Test/E2E data comes from
# the explicit canonical seed command (pnpm --filter @exam/api db:seed:e2e)
# run by the host-local E2E runner and CI against an e2e/test database; the
# production first admin comes from bootstrap-admin (deployment runbook §5).
#
# The former RUN_SEED / FORCE_APP_MODE automatic-seed interface was removed
# with the #636 image-E2E scope decision. Any non-empty value fails before
# migration or any data write — the flags are never silently ignored.

if [ -n "${RUN_SEED:-}" ] || [ -n "${FORCE_APP_MODE:-}" ]; then
  {
    echo "ERROR: the image automatic-seed interface was removed (issue #636);"
    echo "  the entrypoint no longer seeds or switches APP_MODE."
    [ -n "${RUN_SEED:-}" ] &&
      echo "  Rejected: RUN_SEED='${RUN_SEED}' is no longer a supported setting."
    [ -n "${FORCE_APP_MODE:-}" ] &&
      echo "  Rejected: FORCE_APP_MODE='${FORCE_APP_MODE}' is no longer a supported setting."
    echo "  E2E/test data: run 'pnpm --filter @exam/api db:seed:e2e' against the"
    echo "  e2e/test database (the host-local runner and CI do this; they do"
    echo "  not use this image)."
    echo "  Production first admin: bootstrap-admin (see the deployment"
    echo "  runbook, mvp-deployment-runbook.md §5)."
  } >&2
  exit 1
fi

if [ -z "$JWT_SECRET" ]; then
  echo "ERROR: JWT_SECRET environment variable is required"
  exit 1
fi

echo "Running database migrations..."
node dist/scripts/migrate.js

echo "Starting server..."
exec node dist/server.js
