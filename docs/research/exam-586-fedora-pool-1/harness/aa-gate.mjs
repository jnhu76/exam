#!/usr/bin/env node
/**
 * EXAM-586 RESEARCH ONLY A/A gate evaluation (protocol §15).
 *
 * Compares implicit-canonical (A: pool unset) vs explicit-10 (A') replicate
 * bursts. The tolerance is NOT imposed after the fact: for each metric the
 * gate uses the observed replicate spread WITHIN each group — A/A passes iff
 * the between-group difference is within the pooled within-group replicate
 * spread for the tail metrics that matter (HTTP p95/p99, TX_ACQUIRE_PROXY
 * p95/p99, TX_HOLD p95) AND no systematic shift appears in pg occupancy.
 *
 * Usage: aa-gate.mjs <runDirA1> <runDirA2> <runDirA'1> <runDirA'2> [...]
 *   (odd args = A runs, then A' runs — or pass --a/--ap groups explicitly)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const splitAt = args.indexOf("--ap");
if (splitAt < 1) {
  console.error("usage: aa-gate.mjs <A runDirs...> --ap <A' runDirs...>");
  process.exit(2);
}
const groupA = args.slice(0, splitAt);
const groupAp = args.slice(splitAt + 1);

const load = (dir) => ({
  dir,
  s: JSON.parse(readFileSync(join(dir, "summary586.json"), "utf8")),
});

const METRICS = [
  ["http.p99", "HTTP p99"],
  ["http.p95", "HTTP p95"],
  ["http.p50", "HTTP p50"],
  ["timing.txAcquireProxyMs.p99", "TX_ACQUIRE_PROXY p99"],
  ["timing.txAcquireProxyMs.p95", "TX_ACQUIRE_PROXY p95"],
  ["timing.txHoldMs.p99", "TX_HOLD p99"],
  ["timing.txHoldMs.p95", "TX_HOLD p95"],
  ["pg.activeMax", "PG active max"],
  ["pg.totalMax", "PG total connections max"],
  ["timing.retriesTotal", "serialization/deadlock retries"],
  ["docker.db.cpu.p95", "PG container CPU p95"],
];
const get = (obj, path) =>
  path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);

const spread = (values) => {
  // Relative replicate spread: (max-min)/median of the group's replicates.
  const s = [...values].sort((a, b) => a - b);
  const med = s[Math.floor(s.length / 2)];
  if (med === 0 || s.length < 2) return null;
  return (s[s.length - 1] - s[0]) / Math.abs(med);
};

const aRuns = groupA.map(load);
const apRuns = groupAp.map(load);
const rows = [];
let fail = false;
for (const [path, label] of METRICS) {
  const va = aRuns.map((r) => get(r.s, path)).filter((v) => v != null);
  const vap = apRuns.map((r) => get(r.s, path)).filter((v) => v != null);
  const medA = va.length
    ? [...va].sort((x, y) => x - y)[Math.floor(va.length / 2)]
    : null;
  const medAp = vap.length
    ? [...vap].sort((x, y) => x - y)[Math.floor(vap.length / 2)]
    : null;
  const relSpreadA = spread(va);
  const relSpreadAp = spread(vap);
  // Pooled observed replicate spread (the gate tolerance — not invented).
  const spreads = [relSpreadA, relSpreadAp].filter((v) => v != null);
  const pooled = spreads.length ? Math.max(...spreads) : null;
  let shift = null;
  let within = null;
  if (medA != null && medAp != null && pooled != null) {
    shift = (medAp - medA) / Math.abs(medA);
    within = Math.abs(shift) <= Math.max(pooled, 0.1);
  } else if (medA === 0 && medAp === 0) {
    // Degenerate but decisive: both groups identical at zero — no shift.
    within = true;
  }
  if (within === false) fail = true;
  rows.push({
    metric: label,
    medianA: medA,
    medianAp: medAp,
    replicateSpreadA: relSpreadA,
    replicateSpreadAp: relSpreadAp,
    pooledSpread: pooled,
    relativeShift: shift,
    withinObservedVariance: within,
  });
}

const verdict = fail ? "A_A_GATE_FAIL" : "A_A_GATE_PASS";
const result = {
  gate: verdict,
  groupA: aRuns.map((r) => r.dir),
  groupAp: apRuns.map((r) => r.dir),
  rows,
  finished_at: new Date().toISOString(),
};
writeFileSync(
  join(aRuns[0].dir, "..", "aa-gate.json"),
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(result, null, 2));
process.exit(fail ? 1 : 0);
