#!/usr/bin/env node
/**
 * Route-projection microbenchmark (TASK-CONTRACT §6.1 "route projection cost").
 *
 * A (baseline): normalizeRouteForStorage — the pathname-only normalizer that
 *   master 5140c3dd shipped in apps/api/src/routes/clientEvents.ts (removed
 *   by #864). Reproduced verbatim below from
 *   `git show 5140c3dd:apps/api/src/routes/clientEvents.ts` — it was a
 *   module-private function, so it cannot be imported from the baseline dist.
 * B (integration): projectClientEventRoute — the closed SPA-template
 *   projection from @exam/contracts (packages/contracts/src/clientEventRoute.ts),
 *   imported from integration-final's BUILT dist (stale-dist checked).
 *
 * Workload mixes (each 40% template / 40% parameterized / 20% miss, plus a
 * pure-miss stress) with 5 repetitions, median ns/op reported.
 */
import { performance } from "node:perf_hooks";

const INT_DIST = "/home/hoo/Source/exam-gap-worktrees/integration-final/packages/contracts/dist/clientEventRoute.js";
const { projectClientEventRoute } = await import(INT_DIST);
if (typeof projectClientEventRoute !== "function") throw new Error("stale dist: projectClientEventRoute missing");

const USER_AGENT_MAX_LENGTH = 500;
/** verbatim from master 5140c3dd apps/api/src/routes/clientEvents.ts (#875 regime) */
function normalizeRouteForStorage(route) {
  if (!route) return null;
  try {
    const url = new URL(route, "http://client-event.invalid");
    return url.pathname.slice(0, USER_AGENT_MAX_LENGTH) || null;
  } catch {
    const pathOnly = route.split(/[?#]/, 1)[0] ?? "";
    return pathOnly.slice(0, USER_AGENT_MAX_LENGTH) || null;
  }
}

const uuid = "7bf3d3cd-8896-4c72-b34f-284d922f827f";
const inputs = {
  template: ["/login", "/admin/grading-queue", "/exam/list", "/admin/settings"],
  parameterized: [
    `/admin/exams/${uuid}`,
    `/exam/${uuid}/take`,
    `/admin/attempts/${uuid}`,
    `/admin/recovery/incidents/${uuid}`,
  ],
  miss: ["/totally/unknown/a/b/c", "/x/y?q=1", "/opaque:data:text/plain,hi"],
};

function bench(fn, values, iters) {
  const t0 = performance.now();
  let sink = 0;
  for (let i = 0; i < iters; i++) {
    const v = fn(values[i % values.length]);
    sink += v ? v.length : 0;
  }
  const dt = performance.now() - t0;
  return { nsPerOp: (dt * 1e6) / iters, sink };
}

function median(a) {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
}

const REPS = 5;
const ITERS = 200000;
console.log("warmup...");
for (let i = 0; i < 50000; i++) {
  projectClientEventRoute(inputs.miss[i % inputs.miss.length]);
  normalizeRouteForStorage(inputs.miss[i % inputs.miss.length]);
}

const rows = [];
for (const [name, mix] of [
  ["realistic-mix", [...inputs.template, ...inputs.parameterized, ...inputs.miss.slice(0, 2)]],
  ["pure-miss", inputs.miss],
  ["pure-template", inputs.template],
]) {
  const a = [], b = [];
  for (let r = 0; r < REPS; r++) {
    a.push(bench(normalizeRouteForStorage, mix, ITERS).nsPerOp);
    b.push(bench(projectClientEventRoute, mix, ITERS).nsPerOp);
  }
  rows.push({
    mix: name,
    baselineNormalizeNsPerOp: Number(median(a).toFixed(1)),
    integrationProjectNsPerOp: Number(median(b).toFixed(1)),
    deltaNs: Number((median(b) - median(a)).toFixed(1)),
  });
}

// sanity: both correctly classify the mix members
const sample = {
  template: projectClientEventRoute("/exam/" + uuid + "/take"),
  miss: projectClientEventRoute("/totally/unknown/a/b/c"),
  baselineMissPersisted: normalizeRouteForStorage("/totally/unknown/a/b/c"),
};
console.log(JSON.stringify({ rows, sample, node: process.version }, null, 2));
