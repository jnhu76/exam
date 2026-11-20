#!/usr/bin/env node
/**
 * S2-TIMING isolated fault-injection proxy (RESEARCH ONLY; PROTOCOL §10
 * S2-TIMING「可控 failpoint 或隔离代理」). Plain node, no deps.
 *
 *   client ──► 127.0.0.1:PROXY_PORT ──► 127.0.0.1:UPSTREAM_PORT (real nginx)
 *
 * Control channel 127.0.0.1:CONTROL_PORT (HTTP JSON):
 *   POST /rule    {id, match, action: "hold-request"|"swallow-response"}
 *   POST /release {id, deliver?}   (default deliver=false)
 *   GET  /events                  chronological log (wall + monotonic)
 *   POST /reset
 *
 * hold-request: the matching request is parked at the proxy — bytes never
 *   reach nginx — until release, when the whole buffered request is flushed
 *   upstream and the connection proceeds normally (S2 case ④-A window:
 *   restart before the request enters any transaction).
 * swallow-response: the request is forwarded immediately; the upstream
 *   response is captured at the proxy and NOT delivered. release(deliver=false)
 *   destroys the client socket (response never delivered — case ④-B / ③
 *   response loss); deliver=true writes the captured bytes and closes.
 */
import net from "node:net";
import http from "node:http";

const PROXY_PORT = Number(process.env.S2_PROXY_PORT ?? 8090);
const LISTEN_HOST = process.env.S2_LISTEN_HOST ?? "127.0.0.1";
const CONTROL_PORT = Number(process.env.S2_CONTROL_PORT ?? 8091);
const UPSTREAM_HOST = process.env.S2_UPSTREAM_HOST ?? "127.0.0.1";
const UPSTREAM_PORT = Number(process.env.S2_UPSTREAM_PORT ?? 8080);

const t0 = performance.now();
const mono = () => Math.round((performance.now() - t0) * 1000) / 1000;
const wall = () => new Date().toISOString();
const redact = (s) => s.replace(/(auth-token|session)=[^;\s"']+/g, "$1=<redacted>");

const events = [];
const emit = (ev) => {
  const line = { ...ev, monoAt: mono(), wallAt: wall() };
  events.push(line);
  console.log(`[s2-proxy] ${JSON.stringify(line)}`);
};

const rules = new Map(); // id -> {id, match, action}
const active = new Set(); // connection states

function makeConn(client) {
  const st = {
    client,
    head: [],
    headDone: false,
    requestLine: "",
    rule: null,
    parked: false,
    parkedChunks: [],
    upstream: null,
    swallow: null,
    releaseHold: null,   // set when parked
    releaseSwallow: null,// set when swallowing
  };
  return st;
}

const proxyServer = net.createServer((client) => {
  const st = makeConn(client);
  active.add(st);

  const openUpstream = () => {
    const up = net.connect(UPSTREAM_PORT, UPSTREAM_HOST);
    up.on("error", (err) => {
      emit({ rule: st.rule?.id ?? null, ev: "upstream-error", error: String(err.code ?? err.message) });
      client.destroy();
    });
    st.upstream = up;
    return up;
  };
  const pipePlain = () => {
    const up = openUpstream();
    up.write(Buffer.concat(st.head));
    st.head = [];
    up.pipe(client);
    client.pipe(up);
  };

  client.on("data", (chunk) => {
    if (st.parked) { st.parkedChunks.push(chunk); return; }
    if (!st.headDone) {
      st.head.push(chunk);
      const head = Buffer.concat(st.head).toString("latin1");
      const nl = head.indexOf("\r\n");
      if (nl === -1) return;
      st.headDone = true;
      st.requestLine = head.slice(0, nl);
      st.rule = [...rules.values()].find((r) => st.requestLine.includes(r.match)) ?? null;
      if (!st.rule) return pipePlain();
      if (st.rule.action === "hold-request") {
        st.parked = true;
        st.parkedChunks = [...st.head];
        st.head = [];
        st.releaseHold = () => {
          st.parked = false;
          const up = openUpstream();
          for (const c of st.parkedChunks) up.write(c);
          st.parkedChunks = [];
          up.pipe(st.client);
          st.client.pipe(up);
          emit({ rule: st.rule.id, ev: "released", flushed: true });
        };
        emit({ rule: st.rule.id, ev: "held-request", requestLine: redact(st.requestLine) });
        return;
      }
      if (st.rule.action === "swallow-response") {
        const up = openUpstream();
        st.swallow = { chunks: [], statusLine: null, captured: false };
        emit({ rule: st.rule.id, ev: "request-forwarded", requestLine: redact(st.requestLine) });
        up.on("data", (c) => {
          st.swallow.chunks.push(c);
          if (st.swallow.statusLine === null) {
            const s = Buffer.concat(st.swallow.chunks).toString("latin1");
            const n2 = s.indexOf("\r\n");
            if (n2 !== -1) st.swallow.statusLine = s.slice(0, n2);
          }
          // End-of-response detection by Content-Length (nginx keepalive keeps
          // the upstream socket open, so 'close' is NOT a response boundary).
          if (!st.swallow.captured) {
            const all = Buffer.concat(st.swallow.chunks).toString("latin1");
            const hdrEnd = all.indexOf("\r\n\r\n");
            if (hdrEnd !== -1) {
              const m = /content-length:\s*(\d+)/i.exec(all.slice(0, hdrEnd));
              if (m) {
                const total = hdrEnd + 4 + Number(m[1]);
                if (Buffer.concat(st.swallow.chunks).length >= total) {
                  st.swallow.captured = true;
                  emit({
                    rule: st.rule.id, ev: "response-captured",
                    statusLine: st.swallow.statusLine,
                    bytes: Buffer.concat(st.swallow.chunks).length,
                  });
                }
              }
            }
          }
        });
        up.on("close", () => {
          if (st.swallow && !st.swallow.captured) {
            st.swallow.captured = true;
            emit({
              rule: st.rule.id, ev: "response-captured",
              statusLine: st.swallow.statusLine,
              bytes: Buffer.concat(st.swallow.chunks).length,
            });
          }
        });
        up.write(Buffer.concat(st.head));
        st.head = [];
        st.releaseSwallow = (deliver) => {
          if (deliver) {
            for (const c of st.swallow.chunks) st.client.write(c);
            st.client.end();
            emit({ rule: st.rule.id, ev: "response-delivered", bytes: Buffer.concat(st.swallow.chunks).length });
          } else {
            st.client.destroy();
            emit({ rule: st.rule.id, ev: "client-destroyed", bytes: Buffer.concat(st.swallow.chunks).length });
          }
        };
        return;
      }
    }
    if (st.upstream && !st.swallow) st.upstream.write(chunk);
  });

  client.on("error", () => {});
  client.on("close", () => active.delete(st));
});

const control = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const send = (code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  const readBody = () => new Promise((r) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => r(JSON.parse(b || "{}"))); });
  (async () => {
    if (req.method === "GET" && url.pathname === "/events") return send(200, { events });
    if (req.method === "POST" && url.pathname === "/rule") {
      const r = await readBody();
      if (!r.id || !r.match || !["hold-request", "swallow-response"].includes(r.action)) return send(400, { error: "bad rule" });
      rules.set(r.id, { id: r.id, match: r.match, action: r.action });
      emit({ rule: r.id, ev: "rule-set", action: r.action });
      return send(200, { ok: true });
    }
    if (req.method === "POST" && url.pathname === "/release") {
      const { id, deliver = false } = await readBody();
      for (const st of [...active]) {
        if (st.rule?.id !== id) continue;
        if (st.parked && st.releaseHold) { st.releaseHold(); return send(200, { ok: true, action: "hold-request-released" }); }
        if (st.swallow && st.releaseSwallow) { st.releaseSwallow(deliver); return send(200, { ok: true, action: deliver ? "delivered" : "destroyed" }); }
      }
      return send(404, { error: "no affected connection for id" });
    }
    if (req.method === "POST" && url.pathname === "/rule/delete") {
      const { id } = await readBody();
      rules.delete(id);
      emit({ rule: id, ev: "rule-deleted" });
      return send(200, { ok: true });
    }
    if (req.method === "POST" && url.pathname === "/reset") {
      rules.clear(); events.length = 0;
      return send(200, { ok: true });
    }
    return send(404, { error: "not found" });
  })().catch((e) => send(500, { error: String(e) }));
});

proxyServer.listen(PROXY_PORT, LISTEN_HOST, () => {
  control.listen(CONTROL_PORT, "127.0.0.1", () => {
    console.log(`[s2-proxy] proxy=${LISTEN_HOST}:${PROXY_PORT} → ${UPSTREAM_HOST}:${UPSTREAM_PORT}; control=127.0.0.1:${CONTROL_PORT}`);
  });
});

process.on("SIGINT", () => { proxyServer.close(); control.close(); process.exit(0); });
