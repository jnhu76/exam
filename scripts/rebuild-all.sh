#!/usr/bin/env bash
# Rebuild all @exam/* package dist in dependency order, then web/api dist.
#
# WHY: in this monorepo, apps (api/web) and tests resolve @exam/* via the
# built `dist/` (package.json `main`/`exports` point at dist, NOT src). So
# after editing any package source, you MUST rebuild its dist before running
# api/web tests or the app — otherwise they silently use stale code.
# `turbo test` already chains `^build`, but running a single package's tests
# via `pnpm --filter <pkg> test` BYPASSES that chain. This script is the
# one-shot rebuild to run before such filtered commands.
#
# USAGE:
#   bash scripts/rebuild-all.sh          # rebuild packages + apps
#   bash scripts/rebuild-all.sh --check  # rebuild + verify no type errors
#
# Determinism: builds in hardcoded dependency order (leaf packages first).
set -euo pipefail

cd "$(dirname "$0")/.."

# Package build order (dependency-respecting). domain and contracts are leaves;
# auth/db/import-export depend on them; exam-engine depends on db; apps last.
PACKAGES=(
  "domain"
  "contracts"
  "auth"
  "import-export"
  "db"
  "exam-engine"
)
APPS=("api" "web")

echo "==> Rebuilding packages (dependency order)"
for pkg in "${PACKAGES[@]}"; do
  printf "  - @exam/%s ... " "$pkg"
  if ./packages/"$pkg"/node_modules/.bin/tsc -p packages/"$pkg"/tsconfig.json >/tmp/rebuild-"$pkg".log 2>&1; then
    echo "OK"
  else
    echo "FAILED"
    cat /tmp/rebuild-"$pkg".log
    exit 1
  fi
done

echo "==> Typechecking apps (no emit)"
for app in "${APPS[@]}"; do
  printf "  - apps/%s ... " "$app"
  if ./apps/"$app"/node_modules/.bin/tsc -p apps/"$app"/tsconfig.json --noEmit >/tmp/rebuild-"$app".log 2>&1; then
    echo "OK"
  else
    echo "FAILED"
    cat /tmp/rebuild-"$app".log
    exit 1
  fi
done

if [[ "${1:-}" == "--check" ]]; then
  echo "==> --check: running lint:arch"
  node scripts/check-architecture.mjs >/tmp/rebuild-arch.log 2>&1 || { cat /tmp/rebuild-arch.log; exit 1; }
  echo "  OK"
fi

echo "==> All dist rebuilt + apps typecheck clean."
