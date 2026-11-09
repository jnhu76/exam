#!/usr/bin/env bash
# Protection-metric direct evidence collector.
#  NEW_REQUEST_ID_DB_WRITES: schema-level (pg_dump --schema-only diff of the
#    two migrated+seeded benchmark DBs) + information_schema column scan +
#    source grep for requestId reaching any repository write.
#  NEW_SUCCESS_TELEMETRY_WRITES: post-run DB census of client_events names
#    written during the benchmark (load generator never posts during answer
#    phases; only 'perf.load.event' rows from the events phases may exist).
set -uo pipefail
OUT=/tmp/perf-ab/out
mkdir -p "$OUT"

echo "== schema diff (baseline vs integration benchmark DBs) =="
docker exec exam-dev-db-1 pg_dump -U exam --schema-only exam_ci_perf_ab_base > "$OUT/schema-base.sql" 2>/dev/null
docker exec exam-dev-db-1 pg_dump -U exam --schema-only exam_ci_perf_ab_int > "$OUT/schema-int.sql" 2>/dev/null
if diff "$OUT/schema-base.sql" "$OUT/schema-int.sql" > "$OUT/schema-diff.txt"; then
  echo "SCHEMA_IDENTICAL=yes"
else
  echo "SCHEMA_IDENTICAL=no (see schema-diff.txt)"
fi

echo "== information_schema request-id-like columns (int DB) =="
docker exec exam-dev-db-1 psql -U exam -d exam_ci_perf_ab_int -tA -c \
  "SELECT table_name||'.'||column_name FROM information_schema.columns WHERE column_name ILIKE '%request%'" \
  | tee "$OUT/request-id-columns.txt"
echo "(empty above = no column stores a request id)"

echo "== source audit: requestId in repository write paths (integration tree) =="
grep -rn "requestId" /home/hoo/Source/exam-gap-worktrees/integration-final/packages/db/src/repository/ \
  > "$OUT/requestid-repository-grep.txt" || true
grep -c "requestId" "$OUT/requestid-repository-grep.txt" || echo "0 matches in repository layer"
git -C /home/hoo/Source/exam-gap-worktrees/integration-final diff --stat 5140c3dd..5d4b2773 -- packages/db/src/migrations \
  | tee "$OUT/migrations-diff-stat.txt"
echo "(empty migrations diff = no schema change)"

echo "== client_events census (post-benchmark) =="
for db in exam_ci_perf_ab_base exam_ci_perf_ab_int; do
  echo "-- $db"
  docker exec exam-dev-db-1 psql -U exam -d "$db" -tA -c \
    "SELECT name, count(*), min(received_at), max(received_at) FROM client_events GROUP BY name ORDER BY 2 DESC" \
    | tee "$OUT/client-events-census-$db.txt"
done

echo "== save-receipt per-accepted-write check (raw counts, whole-run) =="
for db in exam_ci_perf_ab_base exam_ci_perf_ab_int; do
  echo "-- $db"
  docker exec exam-dev-db-1 psql -U exam -d "$db" -tA -c \
    "SELECT count(*) FROM exam_answer_save_receipts WHERE client_seq >= 500000" \
    | tee "$OUT/receipts-benchmark-window-$db.txt"
done
echo PROTECTION_EVIDENCE_DONE
