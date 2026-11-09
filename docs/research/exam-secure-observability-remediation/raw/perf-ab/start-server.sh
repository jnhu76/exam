#!/usr/bin/env bash
# start-server.sh <variant: base|int> <port>
# DB routing: APP_MODE=e2e makes @exam/db resolve the TEST branch
# (TEST_DATABASE_URL ?? TEST_DB_URL ?? exam_test) and IGNORES DATABASE_URL
# (packages/db/src/databaseUrl.ts). Both vars are set to the same isolated
# exam_ci_perf_ab_* URL; the actual connected DB is verified after startup.
set -euo pipefail
V="$1"; PORT="$2"
case "$V" in
  base) WT=/home/hoo/Source/exam-gap-worktrees/perf-baseline;    DB=exam_ci_perf_ab_base ;;
  int)  WT=/home/hoo/Source/exam-gap-worktrees/integration-final; DB=exam_ci_perf_ab_int ;;
  *) echo "bad variant"; exit 2 ;;
esac
DBURL="postgresql://exam:exam@127.0.0.1:5432/${DB}"
mkdir -p /tmp/perf-ab/logs
cd "$WT/apps/api"
APP_MODE=e2e \
APP_PORT="$PORT" \
DATABASE_URL="$DBURL" \
TEST_DATABASE_URL="$DBURL" \
HEARTBEAT_SCAN_INTERVAL_MS=60000 \
HEARTBEAT_TIMEOUT_MS=3600000 \
NODE_ENV=development \
./node_modules/.bin/tsx src/server.ts \
  > "/tmp/perf-ab/logs/${V}.pino.log" 2> "/tmp/perf-ab/logs/${V}.stderr.log" &
echo $! > "/tmp/perf-ab/logs/${V}.pid"
for i in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then
    ACTUAL=$(docker exec exam-dev-db-1 psql -U exam -d "$DB" -tA -c \
      "SELECT count(*) FROM pg_stat_activity WHERE datname='${DB}' AND application_name='postgres.js'")
    echo "SERVER_UP variant=$V pid=$(cat /tmp/perf-ab/logs/${V}.pid) port=$PORT db=$DB live_conns=$ACTUAL"
    [ "$ACTUAL" -gt 0 ] || { echo "DB_CONN_VERIFY_FAILED"; exit 1; }
    exit 0
  fi
  sleep 1
done
echo "SERVER_FAILED variant=$V"; tail -5 "/tmp/perf-ab/logs/${V}.stderr.log" || true; exit 1
