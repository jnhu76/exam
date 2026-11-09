#!/usr/bin/env node
/** Mock Fastify upstream for the nginx A/B log-volume experiment.
 *  Mimics the response-header behavior of the integration API (#865: stamps
 *  an x-request-id UUID on every response; baseline's combined access log
 *  simply does not reference it). */
import http from "node:http";
import { randomUUID } from "node:crypto";

const server = http.createServer((req, res) => {
  const stamp = () => {
    res.setHeader("x-request-id", randomUUID());
    res.setHeader("content-type", "application/json");
  };
  if (req.url?.startsWith("/api/slow")) {
    stamp();
    setTimeout(() => { res.end(JSON.stringify({ ok: true, slow: true })); }, 2000);
    return;
  }
  if (req.url?.startsWith("/api/notfound")) {
    stamp(); res.statusCode = 404; res.end(JSON.stringify({ error: { code: "RESOURCE_NOT_FOUND" } })); return;
  }
  if (req.url?.startsWith("/api/boom")) {
    stamp(); res.statusCode = 500; res.end(JSON.stringify({ error: { code: "INTERNAL" } })); return;
  }
  stamp(); res.end(JSON.stringify({ ok: true }));
});
server.listen(3000, "0.0.0.0", () => console.log("upstream :3000"));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
