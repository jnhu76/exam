// FIJ stand-in upstream for the exam edge (NOT the real Fastify app).
// Mimics only the ADR-025-relevant behavior: stamps an X-Request-Id
// (UUIDv4) response header like the real API does. Clearly labeled as a
// stand-in in all evidence; requestId provenance is stand-in, not API.
import http from "node:http";
import { randomUUID } from "node:crypto";

const server = http.createServer((req, res) => {
  const reqid = randomUUID();
  const url = req.url ?? "/";
  if (url.startsWith("/api/hang")) {
    // Accept, then never respond: exercises proxy_read_timeout.
    return;
  }
  if (url.startsWith("/api/close")) {
    res.destroy(); // upstream closes the connection mid-request
    return;
  }
  const statusMatch = url.match(/^\/api\/status\/(502|503|504)/);
  if (statusMatch) {
    res.writeHead(Number(statusMatch[1]), {
      "x-request-id": reqid,
      "content-type": "application/json",
    });
    res.end(JSON.stringify({ standin: true, status: statusMatch[1] }));
    return;
  }
  const slowMatch = url.match(/[?&]ms=(\d+)/);
  const respond = () => {
    res.writeHead(200, {
      "x-request-id": reqid,
      "content-type": "application/json",
    });
    res.end(JSON.stringify({ standin: true, ok: true }));
  };
  if (slowMatch) setTimeout(respond, Number(slowMatch[1]));
  else respond();
});
server.listen(3000, () => console.log("fij stand-in upstream on :3000"));
