#!/usr/bin/env bash
# FIJ harness: (re)start the edge container for one run.
# usage: run-web.sh <runid> <conf-abs-path> [extra docker args...]
set -u
F=/tmp/exam-fij
RID="$1"; CONF="$2"; shift 2
docker rm -f fij-web >/dev/null 2>&1 || true
rm -rf "$F/runs/$RID"; mkdir -p "$F/runs/$RID/nglog"
docker run -d --name fij-web --network exam-fij \
  -v "$CONF":/etc/nginx/conf.d/default.conf:ro \
  -v "$F/runs/$RID/nglog":/var/log/nginx \
  -v "$F/www":/usr/share/nginx/html:ro \
  "$@" \
  -p 127.0.0.1:18080:80 nginx:1.30.5-alpine3.24 >/dev/null
# readiness: entrypoint prints "ready for start up" immediately before exec nginx
for _ in $(seq 1 40); do
  docker logs fij-web 2>&1 | grep -q "ready for start up" && exit 0
  sleep 0.25
done
echo "WARN: fij-web readiness signal not seen" >&2
