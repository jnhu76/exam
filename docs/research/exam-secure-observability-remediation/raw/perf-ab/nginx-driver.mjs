#!/usr/bin/env node
/** Request driver + byte-volume recorder for the nginx A/B experiment. */
import http from "node:http";
import net from "node:net";
import fs from "node:fs";

const VARIANTS = { base: 8301, int: 8302 };
const out = { startedAt: new Date().toISOString(), stages: [] };
const results = {};

function get(port, path) {
  return new Promise((resolve) => {
    const r = http.request({ host: "127.0.0.1", port, path, method: "GET" }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode));
    });
    r.on("error", () => resolve(0));
    r.end();
  });
}

function rawMalformed(port) {
  return new Promise((resolve) => {
    const s = net.connect(port, "127.0.0.1", () => {
      s.write("GET /api/a%2zz\\x01 HTTP/1.1\r\nHost: exam.local\r\n\r\n");
    });
    s.on("data", (d) => { const m = /HTTP\/1\.[01] (\d{3})/.exec(d.toString()); s.destroy(); resolve(m ? Number(m[1]) : 0); });
    s.on("error", () => resolve(0));
    setTimeout(() => { s.destroy(); resolve(0); }, 2000);
  });
}

function clientAbort(port) {
  return new Promise((resolve) => {
    const r = http.request({ host: "127.0.0.1", port, path: "/api/slow", method: "GET" }, (res) => {
      res.resume(); resolve(res.statusCode);
    });
    r.on("error", () => resolve("aborted"));
    r.end();
    setTimeout(() => r.destroy(), 150);
  });
}

async function logBytes(container) {
  const cmd = `docker exec ${container} sh -c "wc -c /var/log/nginx/access.log /var/log/nginx/error.log 2>/dev/null | head -2"`;
  const { execSync } = await import("node:child_process");
  const txt = execSync(cmd, { encoding: "utf8" });
  const access = Number(/(\d+) \/var\/log\/nginx\/access\.log/.exec(txt)?.[1] ?? 0);
  const error = Number(/(\d+) \/var\/log\/nginx\/error\.log/.exec(txt)?.[1] ?? 0);
  return { access, error };
}

async function stage(name, n, fn) {
  const before = {};
  for (const [v, port] of Object.entries(VARIANTS)) before[v] = await logBytes(`nginx-ab-${v}`);
  const codes = {};
  for (const [v, port] of Object.entries(VARIANTS)) {
    codes[v] = {};
    for (let i = 0; i < n; i++) {
      const code = await fn(port, i);
      codes[v][code] = (codes[v][code] ?? 0) + 1;
    }
  }
  await new Promise((r) => setTimeout(r, 400));
  const after = {};
  for (const [v] of Object.entries(VARIANTS)) after[v] = await logBytes(`nginx-ab-${v}`);
  const row = {
    stage: name, n,
    perVariant: Object.fromEntries(Object.keys(VARIANTS).map((v) => [
      v,
      {
        codes: codes[v],
        accessBytes: after[v].access - before[v].access,
        errorBytes: after[v].error - before[v].error,
        accessBytesPerReq: Number((((after[v].access - before[v].access) / n)).toFixed(1)),
        errorBytesPerReq: Number((((after[v].error - before[v].error) / n)).toFixed(1)),
      },
    ])),
  };
  out.stages.push(row);
  console.log(JSON.stringify(row));
}

await stage("api-200", 300, (p) => get(p, "/api/attempts/x" + Math.floor(Math.random() * 1e6)));
await stage("api-200-with-token-query", 100, (p) => get(p, "/api/auth/login?token=SECRETTOKEN" + Math.floor(Math.random() * 1e5)));
await stage("spa-index", 200, (p) => get(p, "/"));
await stage("spa-deeplink", 100, (p) => get(p, "/exam/some-attempt/take?x=1"));
await stage("api-upstream-404", 100, (p) => get(p, "/api/notfound"));
await stage("api-upstream-500", 50, (p) => get(p, "/api/boom"));
await stage("malformed-uri", 50, (p) => rawMalformed(p));
await stage("client-abort-slow", 30, (p) => clientAbort(p));

// fault injection F1: kill the upstream node process (container stays up) ->
// resolver still resolves, connect() refused at the edge.
// NOTE: match "node /upstream" so the grep never matches the exec shell's own
// cmdline (that self-match killed the driver shell in an earlier iteration).
const { execSync } = await import("node:child_process");
try {
  execSync("docker exec nginx-ab-app sh -c 'for p in /proc/[0-9]*; do [ \"$p\" = \"/proc/$$\" ] && continue; grep -aq \"node /upstream\" $p/cmdline 2>/dev/null && kill ${p#/proc/}; done' || true");
} catch { /* shell exit code from killing a sibling is fine */ }
await new Promise((r) => setTimeout(r, 700));
const probe1 = await get(8301, "/api/ok");
await stage("fault-upstream-refused", 100, (p) => get(p, "/api/attempts/y" + Math.floor(Math.random() * 1e6)));
// fault injection F2: stop the upstream container -> name no longer resolves
execSync("docker stop nginx-ab-app >/dev/null");
await new Promise((r) => setTimeout(r, 700));
const probe2 = await get(8301, "/api/ok");
await stage("fault-upstream-unresolvable", 100, (p) => get(p, "/api/attempts/z" + Math.floor(Math.random() * 1e6)));
fs.writeFileSync("/tmp/perf-ab/nginx/out/fault-probes.json", JSON.stringify({ afterKill: probe1, afterStop: probe2 }));

out.finishedAt = new Date().toISOString();
fs.writeFileSync("/tmp/perf-ab/nginx/out/nginx-ab-results.json", JSON.stringify(out, null, 2));

// qualitative evidence: what each access log actually recorded for the token stage
for (const v of Object.keys(VARIANTS)) {
  const sample = execSync(`docker exec nginx-ab-${v} sh -c "grep -c SECRETTOKEN /var/log/nginx/access.log; tail -2 /var/log/nginx/access.log; echo ---ERRLOG---; tail -4 /var/log/nginx/error.log"`, { encoding: "utf8" });
  fs.writeFileSync(`/tmp/perf-ab/nginx/out/${v}-log-samples.txt`, sample);
}
console.log("NGINX_AB_DONE");
