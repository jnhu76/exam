#!/usr/bin/env bash

# scripts/test/verify-stress.sh
#
# 手动连续运行 pnpm verify 若干次，用于验证 BUG-FLAKE-001 类非确定性 timeout
# 是否在改动后稳定。
#
# 用法:
#   bash scripts/test/verify-stress.sh             # 默认 3 次，开启 turbo cache
#   bash scripts/test/verify-stress.sh 5           # 跑 5 次
#   bash scripts/test/verify-stress.sh 5 --no-cache # 5 次且每轮禁用 turbo cache
#
# 不进入默认 CI；CI 仍然只跑一次 pnpm verify。
# 任意一次失败立即退出，并打印第几轮失败。
#
# 注意：turbo cache 命中时一次 verify 可能只有 ~25s，并不等于真实跑了一遍测试。
# 想验证"测试运行时稳定性"请加 --no-cache 强制每轮重跑。

set -euo pipefail

usage() {
  sed -n '3,18p' "$0"
}

case "${1:-}" in
  -h|--help)
    usage
    exit 0
    ;;
esac

ITERATIONS="${1:-3}"
NO_CACHE="${2:-}"

if ! [[ "$ITERATIONS" =~ ^[1-9][0-9]*$ ]]; then
  echo "ERROR: iterations must be a positive integer, got: $ITERATIONS" >&2
  echo "Run with --help for usage." >&2
  exit 2
fi

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$repo_root"

verify_cmd=(pnpm verify)
extra_env=()
if [[ "$NO_CACHE" == "--no-cache" ]]; then
  extra_env=(env TURBO_FORCE=true)
  echo "==> verify-stress: --no-cache enabled (TURBO_FORCE=true), each round bypasses turbo cache"
fi

echo "==> verify-stress: running ${extra_env[*]:-} ${verify_cmd[*]} $ITERATIONS time(s) from $repo_root"
start_ts=$(date +%s)

for i in $(seq 1 "$ITERATIONS"); do
  echo
  echo "==> [round $i/$ITERATIONS] ${extra_env[*]:-} ${verify_cmd[*]}"
  round_start=$(date +%s)
  if ! ${extra_env[@]+"${extra_env[@]}"} "${verify_cmd[@]}"; then
    echo
    echo "==> FAIL at round $i/$ITERATIONS"
    exit 1
  fi
  round_end=$(date +%s)
  echo "==> [round $i/$ITERATIONS] passed in $((round_end - round_start))s"
done

end_ts=$(date +%s)
echo
echo "==> verify-stress: all $ITERATIONS round(s) passed in $((end_ts - start_ts))s total"
