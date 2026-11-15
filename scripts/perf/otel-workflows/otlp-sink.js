#!/usr/bin/env node
/**
 * Local OTLP/HTTP receiver for the otel-w964 workflow benchmark harness.
 *
 * Zero external dependencies (node:http only). Supports the three
 * fault-injection modes required by the PROTOCOL §7.3 T8 scenarios and the
 * normal H4 export path (PROTOCOL §5 "exporter 字节与请求数" channel):
 *
 *   --mode ok      200 {} for every OTLP request (normal export path)
 *   --mode reject  400 for every OTLP request (exporter rejection scenario)
 *   --mode slow    hold each OTLP request for SINK_DELAY_MS (default 35000,
 *                  matching the PR #980 35s slow-read scenario) then 200
 *
 * Machine-readable state (for the runner and for coverage audits):
 *   GET /_health    → {ok:true, mode, port, startedAt}
 *   GET /_counters  → {requests:{path:count}, bytes:{path:n}, errors, bodiesKept}
 *   POST /_reset    → zero the counters
 *   GET /_dump      → counters + kept bodies (base64) — coverage audit evidence
 *
 * Body capture: with --keep-bodies (or SINK_KEEP_BODIES=1) the last
 * SINK_MAX_BODIES (default 200) request bodies are kept (base64, capped at
 * SINK_MAX_BODY_BYTES each, default 256 KiB) so the span-coverage audit can
 * decode exported protobuf payloads offline. Without the flag only byte
 * counts are recorded — that is the default so long segments stay bounded.
 *
 * --dump-file <path>: on SIGTERM/SIGINT write {counters, bodies} JSON to the
 * path before exit (best-effort; exit is never blocked by write failure).
 *
 * CLI (exact):
 *   node otlp-sink.js --mode ok|reject|slow --port P [--keep-bodies] [--dump-file <path>]
 */

import http from "node:http";
import { writeFileSync } from "node:fs";

function parseArgs(argv) {
  const out = { mode: "ok", port: 4901, keepBodies: false, dumpFile: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--mode") out.mode = argv[++i];
    else if (a === "--port") out.port = Number(argv[++i]);
    else if (a === "--keep-bodies") out.keepBodies = true;
    else if (a === "--dump-file") out.dumpFile = argv[++i];
    else {
      process.stderr.write(`otlp-sink: unknown argument ${a}\n`);
      process.exit(2);
    }
  }
  if (!["ok", "reject", "slow"].includes(out.mode)) {
    process.stderr.write(`otlp-sink: invalid --mode ${out.mode}\n`);
    process.exit(2);
  }
  if (!Number.isInteger(out.port) || out.port <= 0 || out.port > 65535) {
    process.stderr.write(`otlp-sink: invalid --port ${argv}\n`);
    process.exit(2);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const delayMs = Number(process.env.SINK_DELAY_MS ?? 35000);
const maxBodies = Number(process.env.SINK_MAX_BODIES ?? 200);
const maxBodyBytes = Number(process.env.SINK_MAX_BODY_BYTES ?? 262144);

const counters = {
  startedAt: new Date().toISOString(),
  mode: args.mode,
  delayMs: args.mode === "slow" ? delayMs : 0,
  requests: Object.create(null), // by path: /v1/traces, /v1/metrics, /v1/logs
  bytes: Object.create(null), // request body bytes by path
  statusCodes: Object.create(null),
  bodiesKept: 0,
  bodiesDroppedForCap: 0,
  bodies: args.keepBodies ? [] : null,
  lastRequestAt: null,
};

function recordRequest(path, byteLength, bodyBuf) {
  counters.requests[path] = (counters.requests[path] ?? 0) + 1;
  counters.bytes[path] = (counters.bytes[path] ?? 0) + byteLength;
  counters.lastRequestAt = new Date().toISOString();
  if (args.keepBodies && counters.bodies) {
    if (counters.bodies.length >= maxBodies) {
      counters.bodiesDroppedForCap++;
    } else if (byteLength <= maxBodyBytes) {
      counters.bodies.push({
        at: counters.lastRequestAt,
        path,
        byteLength,
        base64: bodyBuf.toString("base64"),
      });
      counters.bodiesKept++;
    } else {
      counters.bodiesDroppedForCap++;
    }
  }
}

function dumpState() {
  return {
    ...counters,
    dumpedAt: new Date().toISOString(),
  };
}

function handleStatusEndpoint(res, status) {
  const body = JSON.stringify(status);
  res.writeHead(200, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const urlPath = (req.url ?? "/").split("?")[0];

  if (req.method === "GET" && urlPath === "/_health") {
    return handleStatusEndpoint(res, {
      ok: true,
      mode: counters.mode,
      port: args.port,
      startedAt: counters.startedAt,
    });
  }
  if (req.method === "GET" && urlPath === "/_counters") {
    return handleStatusEndpoint(res, dumpState());
  }
  if (req.method === "POST" && urlPath === "/_reset") {
    counters.requests = Object.create(null);
    counters.bytes = Object.create(null);
    counters.statusCodes = Object.create(null);
    if (counters.bodies) counters.bodies.length = 0;
    counters.bodiesKept = 0;
    counters.bodiesDroppedForCap = 0;
    return handleStatusEndpoint(res, { ok: true });
  }
  if (req.method === "GET" && urlPath === "/_dump") {
    return handleStatusEndpoint(res, dumpState());
  }

  // OTLP export paths: /v1/traces, /v1/metrics, /v1/logs (and anything else —
  // the sink counts it under its exact path so misconfigurations are visible).
  const chunks = [];
  let byteLength = 0;
  req.on("data", (c) => {
    chunks.push(c);
    byteLength += c.length;
  });
  req.on("end", () => {
    const bodyBuf = Buffer.concat(chunks);
    recordRequest(urlPath, byteLength, bodyBuf);

    const respond = () => {
      let code = 200;
      let payload = "{}";
      if (args.mode === "reject") {
        code = 400;
        payload = JSON.stringify({ error: "sink reject mode" });
      }
      counters.statusCodes[String(code)] =
        (counters.statusCodes[String(code)] ?? 0) + 1;
      res.writeHead(code, {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(payload),
      });
      res.end(payload);
    };

    if (args.mode === "slow") {
      // Hold the request open without reading further — the exporter-side
      // timeout path is what T8's slow-read scenario exercises. The timer is
      // unref'd so a SIGTERM during the wait still exits promptly.
      const t = setTimeout(respond, delayMs);
      t.unref?.();
      res.on("close", () => clearTimeout(t));
    } else {
      respond();
    }
  });
  req.on("error", () => {
    counters.statusCodes.aborted = (counters.statusCodes.aborted ?? 0) + 1;
  });
});

server.listen(args.port, "127.0.0.1", () => {
  process.stdout.write(
    `${JSON.stringify({
      event: "sink.listening",
      mode: counters.mode,
      port: args.port,
      keepBodies: args.keepBodies,
    })}\n`,
  );
});

function shutdown(signal) {
  if (args.dumpFile) {
    try {
      writeFileSync(args.dumpFile, JSON.stringify(dumpState(), null, 2));
    } catch (err) {
      process.stderr.write(
        `otlp-sink: dump-file write failed: ${String(err)}\n`,
      );
    }
  }
  server.close(() => process.exit(0));
  // Bounded: a hung keep-alive socket must not block exit.
  setTimeout(() => process.exit(0), 1500).unref();
}
process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
