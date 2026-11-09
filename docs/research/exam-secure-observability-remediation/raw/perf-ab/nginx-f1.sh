#!/usr/bin/env bash
# F1-only fault stage: upstream container alive, node process killed ->
# connect() refused. (The in-driver kill regex missed NUL-separated cmdlines.)
set -uo pipefail
ROOT=/tmp/perf-ab/nginx
INTWT=/home/hoo/Source/exam-gap-worktrees/integration-final
docker rm -f nginx-ab-base nginx-ab-int nginx-ab-app >/dev/null 2>&1 || true
docker network rm perf-nginx-ab >/dev/null 2>&1 || true
docker network create perf-nginx-ab >/dev/null
docker run -d --rm --name nginx-ab-app --network perf-nginx-ab --network-alias app \
  -v /tmp/perf-ab/nginx-upstream.mjs:/upstream.mjs:ro -w / \
  node:24.22.1-bookworm-slim sh -c "node /upstream.mjs & exec sleep infinity" >/dev/null
docker run -d --rm --name nginx-ab-base --network perf-nginx-ab -p 8301:80 \
  -v "$ROOT/base/default.conf":/etc/nginx/conf.d/default.conf:ro \
  -v "$ROOT/base/index.html":/usr/share/nginx/html/index.html:ro \
  -v "$ROOT/base/logs":/var/log/nginx nginx:1.30.5-alpine3.24 >/dev/null
docker run -d --rm --name nginx-ab-int --network perf-nginx-ab -p 8302:80 \
  -v "$ROOT/int/default.conf":/etc/nginx/conf.d/default.conf:ro \
  -v "$ROOT/int/index.html":/usr/share/nginx/html/index.html:ro \
  -v "$ROOT/int/logs":/var/log/nginx nginx:1.30.5-alpine3.24 >/dev/null
sleep 3
for i in $(seq 1 15); do
  c1=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8301/api/ok || true)
  [ "$c1" = "200" ] && break; sleep 1
done
echo "readiness base=$c1"
# kill ONLY the node server: match "upstream" but skip the exec shell itself
docker exec nginx-ab-app sh -c 'for p in /proc/[0-9]*; do [ "${p#/proc/}" = "$$" ] && continue; grep -aq upstream $p/cmdline 2>/dev/null && kill ${p#/proc/}; done' || true
sleep 1
p=$(curl -s -o /dev/null -m 5 -w '%{http_code}' http://127.0.0.1:8301/api/ok)
echo "probe after kill: $p"
[ "$p" = "502" ] || { echo "KILL_FAILED"; exit 1; }
for c in nginx-ab-base nginx-ab-int; do docker exec "$c" sh -c 'true > /var/log/nginx/access.log; true > /var/log/nginx/error.log'; done
node - <<'NODE'
import http from "node:http";
import { execSync } from "node:child_process";
const get=(port,path)=>new Promise((res)=>{const r=http.request({host:"127.0.0.1",port,path,method:"GET"},(rs)=>{rs.resume();rs.on("end",()=>res(rs.statusCode));});r.on("error",()=>res(0));r.end();});
const before={},after={},codes={};
for (const [v,port] of [["base",8301],["int",8302]]) {
  const wc=(f)=>Number(execSync(`docker exec nginx-ab-${v} wc -c /var/log/nginx/${f}`,{encoding:"utf8"}).trim().split(" ")[0]);
  before[v]={a:wc("access.log"),e:wc("error.log")}; codes[v]={};
  for(let i=0;i<100;i++){const c=await get(port,"/api/refused-"+Math.floor(Math.random()*1e6));codes[v][c]=(codes[v][c]??0)+1;}
  after[v]={a:wc("access.log"),e:wc("error.log")};
}
console.log(JSON.stringify({stage:"fault-upstream-refused",n:100,perVariant:{
  base:{codes:codes.base,accessBytes:after.base.a-before.base.a,errorBytes:after.base.e-before.base.e},
  int:{codes:codes.int,accessBytes:after.int.a-before.int.a,errorBytes:after.int.e-before.int.e}}}));
for (const v of ["base","int"]) {
  const s=execSync(`docker exec nginx-ab-${v} sh -c "tail -1 /var/log/nginx/access.log; tail -2 /var/log/nginx/error.log"`,{encoding:"utf8"});
  console.log(`--- ${v} ---\n`+s);
}
NODE
docker rm -f nginx-ab-base nginx-ab-int nginx-ab-app >/dev/null 2>&1 || true
docker network rm perf-nginx-ab >/dev/null 2>&1 || true
echo F1_DONE
