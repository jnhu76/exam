#!/bin/sh
set -e

if [ -z "$JWT_SECRET" ]; then
  echo "ERROR: JWT_SECRET environment variable is required"
  exit 1
fi

echo "Running database migrations..."
node dist/scripts/migrate.js

if [ "$RUN_SEED" = "1" ]; then
  echo "Running seed..."
  node dist/seed.js --skip-migrate
fi

echo "Starting server..."
exec node dist/server.js
