#!/usr/bin/env bash
# nginx access/error log byte-volume A/B (TASK-CONTRACT §6.1: nginx access
# log bytes; error-log output under fault injection).
#
# A (base): deploy/nginx/web.conf @ master 5140c3dd (verbatim) PLUS explicit
#   `access_log ... combined; error_log ... error;` — byte-identical to
#   nginx's implicit defaults for a server without directives; made explicit
#   only so the log files can be measured. Documented deviation, zero
#   behavioral delta.
# B (int):  deploy/nginx/web.conf @ integration 5d4b2773 (verbatim:
#   exam_privacy format, error level).
# Same image (nginx:1.30.5-alpine3.24), same upstream (node:24.22.1 container
# named `app` on a user-defined bridge so nginx's 127.0.0.11 resolver works),
# same request script, same stage order. Upstream stamps x-request-id like
# the real integration API (#865).
set -uo pipefail
ROOT=/tmp/perf-ab/nginx
INTWT=/home/hoo/Source/exam-gap-worktrees/integration-final
rm -rf "$ROOT"; mkdir -p "$ROOT/base/logs" "$ROOT/int/logs" "$ROOT/out"

git -C "$INTWT" show 5140c3dd:deploy/nginx/web.conf > "$ROOT/base/default.conf"
cat >> "$ROOT/base/default.conf" <<'EOF'

# [perf-harness only] explicit equivalents of nginx's implicit defaults for
# this server block (combined access log, error-level error log) so both
# variants write measurable files. No behavioral change vs master.
access_log /var/log/nginx/access.log combined;
error_log /var/log/nginx/error.log error;
EOF
git -C "$INTWT" show 5d4b2773:deploy/nginx/web.conf > "$ROOT/int/default.conf"
printf '<!doctype html><title>exam</title><div id="root"></div>\n' | tee "$ROOT/base/index.html" > "$ROOT/int/index.html"

docker rm -f nginx-ab-base nginx-ab-int nginx-ab-app >/dev/null 2>&1 || true
docker network rm perf-nginx-ab >/dev/null 2>&1 || true
docker network create perf-nginx-ab >/dev/null

docker run -d --rm --name nginx-ab-app --network perf-nginx-ab --network-alias app \
  -v /tmp/perf-ab/nginx-upstream.mjs:/upstream.mjs:ro \
  -w / node:24.22.1-bookworm-slim sh -c "node /upstream.mjs & exec sleep infinity" >/dev/null
docker run -d --rm --name nginx-ab-base --network perf-nginx-ab -p 8301:80 \
  -v "$ROOT/base/default.conf":/etc/nginx/conf.d/default.conf:ro \
  -v "$ROOT/base/index.html":/usr/share/nginx/html/index.html:ro \
  -v "$ROOT/base/logs":/var/log/nginx nginx:1.30.5-alpine3.24 >/dev/null
docker run -d --rm --name nginx-ab-int --network perf-nginx-ab -p 8302:80 \
  -v "$ROOT/int/default.conf":/etc/nginx/conf.d/default.conf:ro \
  -v "$ROOT/int/index.html":/usr/share/nginx/html/index.html:ro \
  -v "$ROOT/int/logs":/var/log/nginx nginx:1.30.5-alpine3.24 >/dev/null
sleep 2

for i in $(seq 1 15); do
  c1=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8301/api/ok || true)
  c2=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8302/api/ok || true)
  [ "$c1" = "200" ] && [ "$c2" = "200" ] && break
  sleep 1
done
echo "readiness: base=$c1 int=$c2"
[ "$c1" = "200" ] && [ "$c2" = "200" ] || { echo "READINESS_FAILED"; docker logs nginx-ab-base 2>&1 | tail -5; exit 1; }

for c in nginx-ab-base nginx-ab-int; do
  docker exec "$c" sh -c 'true > /var/log/nginx/access.log; true > /var/log/nginx/error.log'
done

node /tmp/perf-ab/nginx-driver.mjs; RC=$?

docker rm -f nginx-ab-base nginx-ab-int nginx-ab-app >/dev/null 2>&1 || true
docker network rm perf-nginx-ab >/dev/null 2>&1 || true
exit $RC
