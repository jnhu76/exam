#!/usr/bin/env node
/**
 * postWithMeta frontend hot-path microbenchmark (TASK-CONTRACT §6.1
 * "postWithMeta 前端开销").
 *
 * The ONLY hot-path difference between master's `request()` and the
 * integration's shared `requestWithMeta()` core (verified by reading the
 * api.ts diff) is, per request:
 *   1. one `response.headers.get("x-request-id")` Headers lookup,
 *   2. one `{ requestId }` meta object allocation,
 *   3. one `{ data, meta }` wrapper object allocation (plain `request()`
 *      in B also pays this — it delegates to requestWithMeta and destructures).
 * Everything else (fetch, json parse, error path) is byte-identical.
 *
 * This benchmark times exactly those operations on REAL Response objects
 * (undici Response with real Headers), A-path vs B-path, 5 reps × 300k ops,
 * median ns/op.
 */
import { performance } from "node:perf_hooks";

const bodyText = JSON.stringify({
  accepted: true, serverVersion: 42, savedAt: "2026-11-08T12:00:00.000Z",
});
const reqId = "b74a1986-d1d1-4567-9061-07044a74f665";

function makeResponse(withHeader) {
  return new Response(bodyText, {
    status: 200,
    headers: withHeader ? { "x-request-id": reqId, "content-type": "application/json" } : { "content-type": "application/json" },
  });
}

// A-path: master request() tail
async function aPath(res) {
  return res.json();
}
// B-path: integration requestWithMeta() tail
async function bPath(res) {
  const meta = { requestId: res.headers.get("x-request-id") };
  return { data: await res.json(), meta };
}

// json() consumes the body; build a fresh Response per op for BOTH paths so
// allocation cost of Response itself is shared and cancels in the delta.
// To isolate the wrapper/header cost from Response construction, time three
// variants: construction-only, construction+A, construction+B.
function constructOnly() { return makeResponse(true); }

function timeSync(fn, iters) {
  const t0 = performance.now();
  let sink = 0;
  for (let i = 0; i < iters; i++) sink += fn(i) ? 1 : 0;
  return { ns: ((performance.now() - t0) * 1e6) / iters, sink };
}

async function timeAsync(fn, iters) {
  const t0 = performance.now();
  let sink = 0;
  for (let i = 0; i < iters; i++) {
    const r = await fn(makeResponse(true), i);
    sink += r ? 1 : 0;
  }
  return { ns: ((performance.now() - t0) * 1e6) / iters, sink };
}

function median(a) { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; }

const ITERS = 300000, REPS = 5;
// warmup
for (let i = 0; i < 20000; i++) { await aPath(makeResponse(true)); await bPath(makeResponse(true)); constructOnly(); }

const construct = [], a = [], b = [];
for (let r = 0; r < REPS; r++) {
  construct.push(timeSync(() => constructOnly(), ITERS).ns);
  a.push((await timeAsync((res) => aPath(res), ITERS)).ns);
  b.push((await timeAsync((res) => bPath(res), ITERS)).ns);
}
const cM = median(construct), aM = median(a), bM = median(b);
const out = {
  node: process.version,
  constructOnlyNsPerOp: Number(cM.toFixed(1)),
  constructPlusJsonNsPerOp: Number(aM.toFixed(1)),          // A-path total
  constructPlusJsonPlusMetaNsPerOp: Number(bM.toFixed(1)),  // B-path total
  bMinusANs: Number((bM - aM).toFixed(1)),
  bMinusAPercent: Number((((bM - aM) / aM) * 100).toFixed(2)),
  note: "B-A isolates: 1 headers.get + 2 object allocations per request, on real undici Response/Headers",
};
console.log(JSON.stringify(out, null, 2));
