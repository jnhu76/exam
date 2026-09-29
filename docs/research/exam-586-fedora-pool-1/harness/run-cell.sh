#!/usr/bin/env bash
# EXAM-586 RESEARCH ONLY single-cell orchestrator (Issue #586).
#
# Runs one experiment cell end-to-end against an ISOLATED Compose project
# (exam-586) with a fresh per-run data root. Never touches any other
# deployment, database, or ./data path (protocol §2/§18).
#
# Usage: run-cell.sh <RUN_ID> <pool:unset|10|20|30> <scale:50|100|200> <rep>
# Env:   EXAM586_APP_IMAGE / EXAM586_WEB_IMAGE (required, research images)
#        EXAM586_PASSWORD_HASH (required, shared argon2id fixture hash)
#        EXAM586_RUNS_ROOT (default /home/jnhu/exam-586/runs)
#        EXAM586_PORT (default 18080)
set -euo pipefail

RUN_ID="${1:?RUN_ID required}"
POOL="${2:?pool required (unset|10|20|30)}"
SCALE="${3:?scale required}"
REP="${4:?rep required}"
HARNESS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(git -C "$HARNESS/../../.." rev-parse --show-toplevel)"
RUNS_ROOT="${EXAM586_RUNS_ROOT:-/home/jnhu/exam-586/runs}"
PORT="${EXAM586_PORT:-18080}"
APP_IMAGE="${EXAM586_APP_IMAGE:?EXAM586_APP_IMAGE required}"
WEB_IMAGE="${EXAM586_WEB_IMAGE:?EXAM586_WEB_IMAGE required}"
PASS_HASH="${EXAM586_PASSWORD_HASH:?EXAM586_PASSWORD_HASH required}"
PROJECT="exam-586"
RUN_DIR="$RUNS_ROOT/$RUN_ID"
LAN_IP="$(hostname -I | awk '{print $1}')"
ORIGIN="http://$LAN_IP:$PORT"

case "$POOL" in
  unset) POOL_ENV="" ;;
  10|20|30) POOL_ENV="$POOL" ;;
  *) echo "FATAL: bad pool '$POOL'" >&2; exit 2 ;;
esac
case "$SCALE" in 20|50|100|200) ;; *) echo "FATAL: bad scale" >&2; exit 2 ;; esac
# scale 20 is smoke-only (rig shakedown, never treatment — 02-experiment-schedule.md)

# ── Isolation proof: the run dir must be under the experiment namespace ──
case "$RUN_DIR" in
  /home/jnhu/exam-586/runs/*) ;;
  *) echo "FATAL: run dir outside experiment namespace: $RUN_DIR" >&2; exit 2 ;;
esac
mkdir -p "$RUN_DIR"
RUN_DIR="$(cd "$RUN_DIR" && pwd)"

COMPOSE="docker compose -p $PROJECT --env-file $RUN_DIR/env -f $REPO/docker-compose.yml -f $HARNESS/compose.586-research.yml"
log() { echo "[run-cell $RUN_ID] $(date --iso-8601=seconds) $*"; }

cleanup() {
  # Stop samplers and log followers; keep raw evidence. Never delete the run dir.
  for pid in "${SAMPLER_PIDS[@]:-}"; do [ -n "$pid" ] && kill "$pid" 2>/dev/null || true; done
  $COMPOSE down --remove-orphans >/dev/null 2>&1 || true
}
SAMPLER_PIDS=()
trap cleanup EXIT

# ── 1. Run env + meta skeleton ──────────────────────────────────────────
PG_PASS="$(openssl rand -hex 16)"
JWT="$(openssl rand -hex 32)"
ADMIN_PASS="$(openssl rand -hex 12)Aa"
cat > "$RUN_DIR/env" <<EOF
# EXAM-586 RESEARCH ONLY run env (generated; experiment-dedicated secrets)
POSTGRES_USER=exam
POSTGRES_PASSWORD=$PG_PASS
POSTGRES_DB=exam
JWT_SECRET=$JWT
EXAM_IMAGE=$APP_IMAGE
EXAM_WEB_IMAGE=$WEB_IMAGE
EXAM_PORT=$PORT
EXAM_DATA_ROOT=$RUN_DIR/data
TRUSTED_PROXY_CIDRS=172.31.0.0/16
CORS_ORIGIN=$ORIGIN
PUBLIC_WEB_ORIGIN=$ORIGIN
EXAM_586_RESEARCH_POOL_MAX=$POOL_ENV
EXAM_586_TIMING=1
EOF
chmod 600 "$RUN_DIR/env"

GIT_SHA="$(git -C "$REPO" rev-parse HEAD)"
APP_DID="$(docker image inspect "$APP_IMAGE" --format '{{.Id}} {{index .RepoDigests 0}}' 2>/dev/null || docker image inspect "$APP_IMAGE" --format '{{.Id}}')"
WEB_DID="$(docker image inspect "$WEB_IMAGE" --format '{{.Id}} {{index .RepoDigests 0}}' 2>/dev/null || docker image inspect "$WEB_IMAGE" --format '{{.Id}}')"

# ── 2. Stack up: db → healthy, app (migrates via entrypoint) + web ──────
log "starting db"
$COMPOSE up -d db
for i in $(seq 1 60); do
  st="$($COMPOSE ps --format json db | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{console.log(JSON.parse(d.split("\n").filter(Boolean)[0]).Health)}catch{console.log("unknown")}})')"
  [ "$st" = "healthy" ] && break
  [ "$i" = 60 ] && { log "FATAL db not healthy"; echo "db_not_healthy" > "$RUN_DIR/INVALID_REASON.txt"; exit 4; }
  sleep 1
done
log "db healthy; starting app+web (entrypoint migrates)"
$COMPOSE up -d app web
# Capture live service logs from here (migrations + EXAM586_POOL witness included)
$COMPOSE logs --no-log-prefix -f app  > "$RUN_DIR/app.log"  2>&1 & SAMPLER_PIDS+=($!)
$COMPOSE logs --no-log-prefix -f web  > "$RUN_DIR/web.log"  2>&1 & SAMPLER_PIDS+=($!)
$COMPOSE logs --no-log-prefix -f db   > "$RUN_DIR/db.log"   2>&1 & SAMPLER_PIDS+=($!)
for i in $(seq 1 90); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/ready" || true)"
  [ "$code" = "200" ] && break
  [ "$i" = 90 ] && { log "FATAL app never ready (last=$code)"; echo "app_not_ready" > "$RUN_DIR/INVALID_REASON.txt"; exit 4; }
  sleep 1
done
log "app ready via nginx ingress"

# ── 3. Bootstrap admin (canonical production path) + org id ────────────
$COMPOSE exec -T app node dist/scripts/bootstrap-admin.js \
  --username admin586 --password "$ADMIN_PASS" \
  --name 'Exam 586 Experiment Admin' \
  --organization-name 'Exam 586 Experiment Org' > "$RUN_DIR/bootstrap.log" 2>&1
ORG_ID="$($COMPOSE exec -T db psql -U exam -d exam -At -c \
  "SELECT id::text FROM organizations ORDER BY created_at LIMIT 1" | tr -d '\r')"
cat > "$RUN_DIR/org.json" <<EOF
{"orgId": "$ORG_ID"}
EOF
cat > "$RUN_DIR/admin.json" <<EOF
{"username": "admin586", "password": "$ADMIN_PASS"}
EOF

# ── 4. PostgreSQL server facts (§5; never varied) ───────────────────────
$COMPOSE exec -T db psql -U exam -d exam -At -F '|' -c "
SELECT name, setting, unit, source FROM pg_settings
WHERE name IN ('max_connections','superuser_reserved_connections','shared_buffers','work_mem',
  'maintenance_work_mem','effective_cache_size','default_transaction_isolation',
  'synchronous_commit','fsync','full_page_writes','wal_level') ORDER BY name" \
  > "$RUN_DIR/pg-settings.txt"
$COMPOSE exec -T db psql -U exam -d exam -At -c "SHOW server_version" > "$RUN_DIR/pg-version.txt"

# ── 5. Driver setup (HTTP: course, questions, exams, publish) ──────────
log "driver setup"
docker run --rm --name "${PROJECT}-drv-setup" \
  --network "${PROJECT}_exam-net" --cap-add NET_ADMIN --ulimit nofile=4096:8192 \
  -v "$RUN_DIR:/data/run" \
  -e RUN_DIR=/data/run -e BASE_URL=http://web -e ORIGIN="$ORIGIN" \
  -e RUN_ID="$RUN_ID" -e POOL_DESC="$POOL" -e N="$SCALE" \
  "$EXAM586_DRIVER_IMAGE" setup > "$RUN_DIR/driver-setup.log" 2>&1 \
  || { log "FATAL driver setup failed"; echo "driver_setup_failed" > "$RUN_DIR/INVALID_REASON.txt"; exit 4; }

# ── 6. Seed candidates (bulk SQL through docker exec; PG unpublished) ──
EXAM_ID="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).examId)' "$RUN_DIR/exams.json")"
WARM_ID="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).warmupExamId)' "$RUN_DIR/exams.json")"
EXAM586_PASSWORD_HASH="$PASS_HASH" node "$HARNESS/gen-seed.mjs" "$RUN_DIR" "$ORG_ID" "$EXAM_ID" "$WARM_ID" "$SCALE"
$COMPOSE exec -T db psql -U exam -d exam -v ON_ERROR_STOP=1 -q < "$RUN_DIR/candidates.sql" \
  || { log "FATAL candidate seed failed"; echo "seed_failed" > "$RUN_DIR/INVALID_REASON.txt"; exit 4; }

# ── 7. Samplers: pg_stat_activity (200ms) + lock waits + docker stats ──
# Long-lived `\watch` psql sessions INSIDE the db container (one exec each,
# application_name-tagged and excluded from their own samples).
$COMPOSE exec -T db psql -U exam -d exam -At -c "
SELECT 'SELECT now(), state, coalesce(wait_event_type,''-''), coalesce(wait_event,''-''), count(*)::int FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND coalesce(application_name,'''') <> ''exam586-sampler'' GROUP BY state, wait_event_type, wait_event ORDER BY state'" \
  > "$RUN_DIR/.watch-activity.sql"
( echo "SET application_name='exam586-sampler';"; cat "$RUN_DIR/.watch-activity.sql"; printf '\\watch 0.2\n' ) \
  | $COMPOSE exec -T db psql -U exam -d exam -qAt -F '|' > "$RUN_DIR/pg-activity.jsonl" 2>"$RUN_DIR/pg-activity.err" & SAMPLER_PIDS+=($!)
# Query-text sampler: which statements wait on Lock/tuple (hot-row diagnosis).
$COMPOSE exec -T db psql -U exam -d exam -At -c "
SELECT 'SELECT now(), left(regexp_replace(coalesce(query,''''''''),''[[:space:]]+'','' '',''g''),100), a_pid_count::int FROM (SELECT query, count(*)::int a_pid_count FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND coalesce(application_name,'''') <> ''exam586-sampler'' AND wait_event_type = ''Lock'' AND wait_event = ''tuple'' GROUP BY query) q'" \
  > "$RUN_DIR/.watch-qtext.sql"
( echo "SET application_name='exam586-sampler';"; cat "$RUN_DIR/.watch-qtext.sql"; printf '\\watch 0.2\n' ) \
  | $COMPOSE exec -T db psql -U exam -d exam -qAt -F '|' > "$RUN_DIR/pg-qtext.jsonl" 2>"$RUN_DIR/pg-qtext.err" & SAMPLER_PIDS+=($!)
$COMPOSE exec -T db psql -U exam -d exam -At -c "
SELECT 'SELECT now(), l.locktype::text, coalesce(n.relname::text,''-''), a.wait_event_type::text, coalesce(a.wait_event::text,''-''), count(*)::int FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid LEFT JOIN pg_class n ON n.oid = l.relation WHERE l.granted = false AND a.datname = current_database() AND a.pid <> pg_backend_pid() AND coalesce(a.application_name,'''') <> ''exam586-sampler'' GROUP BY l.locktype, n.relname, a.wait_event_type, a.wait_event'" \
  > "$RUN_DIR/.watch-locks.sql"
( echo "SET application_name='exam586-sampler';"; cat "$RUN_DIR/.watch-locks.sql"; printf '\\watch 0.2\n' ) \
  | $COMPOSE exec -T db psql -U exam -d exam -qAt -F '|' > "$RUN_DIR/pg-locks.jsonl" 2>"$RUN_DIR/pg-locks.err" & SAMPLER_PIDS+=($!)
( while true; do
    echo "SAMPLE $(date --iso-8601=seconds) load:$(cut -d' ' -f1-3 /proc/loadavg)"
    docker stats --no-stream --format '{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}' \
      "${PROJECT}-web-1" "${PROJECT}-app-1" "${PROJECT}-db-1" 2>/dev/null || true
    sleep 1
  done ) > "$RUN_DIR/docker-stats.txt" 2>&1 & SAMPLER_PIDS+=($!)

# ── 8. pg_stat_database before-burst snapshot ──────────────────────────
$COMPOSE exec -T db psql -U exam -d exam -At -F '|' -c "
SELECT datname, numbackends, xact_commit, xact_rollback, blks_read, blks_hit,
  tup_returned, tup_fetched, tup_inserted, tup_updated, tup_deleted,
  conflicts, deadlocks, temp_files, temp_bytes
FROM pg_stat_database WHERE datname = current_database()" > "$RUN_DIR/pg-before.json"

# ── 9. Driver measure (warmup → bursts → treatment) ────────────────────
log "driver measure (pool=$POOL scale=$SCALE rep=$REP)"
BURST_START="$(date --iso-8601=seconds)"
docker run --rm --name "${PROJECT}-drv-measure" \
  --network "${PROJECT}_exam-net" --cap-add NET_ADMIN --ulimit nofile=4096:8192 \
  -v "$RUN_DIR:/data/run" \
  -e RUN_DIR=/data/run -e BASE_URL=http://web -e ORIGIN="$ORIGIN" \
  -e RUN_ID="$RUN_ID" -e POOL_DESC="$POOL" -e N="$SCALE" \
  "$EXAM586_DRIVER_IMAGE" measure > "$RUN_DIR/driver-measure.log" 2>&1
DRIVER_EXIT=$?
BURST_END="$(date --iso-8601=seconds)"

# ── 10. pg_stat_database after-burst snapshot ──────────────────────────
$COMPOSE exec -T db psql -U exam -d exam -At -F '|' -c "
SELECT datname, numbackends, xact_commit, xact_rollback, blks_read, blks_hit,
  tup_returned, tup_fetched, tup_inserted, tup_updated, tup_deleted,
  conflicts, deadlocks, temp_files, temp_bytes
FROM pg_stat_database WHERE datname = current_database()" > "$RUN_DIR/pg-after.json"

# ── 11. Stop samplers, oracles, inspect, meta ──────────────────────────
for pid in "${SAMPLER_PIDS[@]}"; do kill "$pid" 2>/dev/null || true; done
sleep 1
# Belt-and-braces: terminate any surviving in-container \watch sampler
# backends so nothing leaks past the cell (OWNERSHIP: this cell's backends only).
$COMPOSE exec -T db psql -U exam -d exam -At -c \
  "SELECT count(*) FROM (SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'exam586-sampler') t" \
  > "$RUN_DIR/sampler-terminated.txt" 2>/dev/null || true
sleep 1

VALID="valid"
INVALID_REASON=""
if [ "$DRIVER_EXIT" -ne 0 ]; then
  VALID="INVALID"; INVALID_REASON="driver_exit_${DRIVER_EXIT} (see driver-measure.log; driver law: login/start/save failures or 429 ⇒ workload deviation, §13/§28)"
  echo "$INVALID_REASON" > "$RUN_DIR/INVALID_REASON.txt"
fi

RUN_ID="$RUN_ID" N="$SCALE" COMPOSE_ARGS="--env-file $RUN_DIR/env -f $REPO/docker-compose.yml -f $HARNESS/compose.586-research.yml" \
  node "$HARNESS/oracles.mjs" "$RUN_DIR" > "$RUN_DIR/oracle.log" 2>&1 || {
    [ "$VALID" = "valid" ] && { VALID="INVALID"; INVALID_REASON="correctness_oracle_failed (§30: performance result disqualified)"; echo "$INVALID_REASON" > "$RUN_DIR/INVALID_REASON.txt"; }
  }

$COMPOSE ps --format json > "$RUN_DIR/compose-ps.json"
for svc in app web db; do
  cid="$($COMPOSE ps -q $svc 2>/dev/null || true)"
  if [ -n "$cid" ]; then
    docker inspect "$cid" > "$RUN_DIR/docker-inspect-$svc.json"
  fi
done

# Pool-mode config witness (EXAM586_POOL line the app printed at startup).
grep -m1 "EXAM586_POOL" "$RUN_DIR/app.log" > "$RUN_DIR/pool-witness.txt" || {
  [ "$VALID" = "valid" ] && { VALID="INVALID"; INVALID_REASON="pool_value_unverifiable (no EXAM586_POOL witness, §28)"; echo "$INVALID_REASON" > "$RUN_DIR/INVALID_REASON.txt"; }
}
grep -c "EXAM586_TIMING" "$RUN_DIR/app.log" > "$RUN_DIR/timing-count.txt" || true

APP_ID="$($COMPOSE ps -q app 2>/dev/null || true)"
cat > "$RUN_DIR/meta.json" <<EOF
{
  "run_id": "$RUN_ID",
  "git_sha": "$GIT_SHA",
  "app_image": "$APP_IMAGE",
  "web_image": "$WEB_IMAGE",
  "app_image_id_digest": "$APP_DID",
  "web_image_id_digest": "$WEB_DID",
  "driver_image": "${EXAM586_DRIVER_IMAGE:-}",
  "fedora": "$(cat /etc/fedora-release)",
  "kernel": "$(uname -r)",
  "docker": "$(docker version --format '{{.Server.Version}}')",
  "compose": "$(docker compose version --short)",
  "pool_mode": "$POOL",
  "effective_pool_max": "${POOL_ENV:-postgres.js_default_10}",
  "scale": $SCALE,
  "replicate": $REP,
  "app_mode": "production",
  "rate_limiter": "production defaults ON (global 100/min/IP, login 10/min/IP), in-process store (Redis off = compose default, P6-010)",
  "redis": "off",
  "exam_data_root": "$RUN_DIR/data",
  "public_test_port": $PORT,
  "burst_window": {"start": "$BURST_START", "end": "$BURST_END"},
  "status": "$VALID",
  "invalid_reason": "${INVALID_REASON:-}",
  "driver_exit": $DRIVER_EXIT,
  "finished_at": "$(date --iso-8601=seconds)"
}
EOF

# ── 12. Evidence integrity (§32): checksum raw evidence, then teardown ──
( cd "$RUN_DIR" && sha256sum requests.jsonl app.log web.log db.log \
    pg-activity.jsonl pg-locks.jsonl docker-stats.txt pg-before.json pg-after.json \
    driver-summary.json correctness.json candidates.sql meta.json 2>/dev/null > SHA256SUMS || true )

$COMPOSE down --remove-orphans > "$RUN_DIR/compose-down.log" 2>&1
log "cell done: status=$VALID (data root retained: $RUN_DIR/data)"
[ "$VALID" = "valid" ]
