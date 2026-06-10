#!/usr/bin/env bash
set -euo pipefail

echo "== LAN Exam Platform Phase 1.1 Checks =="

run_pnpm_script() {
  local script="$1"
  if pnpm run | grep -E "^[[:space:]]*$script($|[[:space:]])" >/dev/null 2>&1; then
    echo ""
    echo "== pnpm $script =="
    pnpm "$script"
  else
    echo ""
    echo "== skip: pnpm $script not found =="
  fi
}

if [ ! -f "package.json" ]; then
  echo "ERROR: run this script from project root"
  exit 1
fi

echo ""
echo "== install check =="
pnpm install

run_pnpm_script "format:check"
run_pnpm_script "lint"
run_pnpm_script "lint:copy"
run_pnpm_script "lint:arch"
run_pnpm_script "typecheck"
run_pnpm_script "test"
run_pnpm_script "test:integration"
run_pnpm_script "build"
run_pnpm_script "smoke"
run_pnpm_script "verify"

echo ""
echo "== docker compose config =="
if command -v docker >/dev/null 2>&1 && [ -f "docker-compose.yml" ]; then
  docker compose config >/tmp/lan_exam_compose_config.yml
  echo "docker compose config OK"
else
  echo "skip docker compose config"
fi

echo ""
echo "Phase 1.1 checks finished."
