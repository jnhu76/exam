#!/usr/bin/env node
// §6.5(a) campaign aggregation bridge (PROTOCOL-v3 §6.5(a)/v4 §106 machine
// path): cmdAggregate only reads rounds/round-N (runner.js cmdAggregate),
// so formal campaign segments under out/…/campaign-<suite>/sweep-N/ had no
// machine pairing path. This bridge feeds those sweeps into the SAME
// authoritative aggregateCore (paired Δ% vs same-sweep baseline, workflow
// dimension, bootstrap 10,000 / seed 20261115) and applies the §2.3 rule
// table (CI 上界 ≤+5% PASS / 下界 >+5% FAIL / 跨 +5% UNKNOWN；n<6 UNKNOWN；
// IQR>5pp UNKNOWN；CI 含 0 另标 INCONCLUSIVE@0)。No second statistics
// implementation: every number comes from runner.js exports.
//
// Usage: node campaign-aggregate.mjs [--suite mixed|isolated|knee]
//   (writes out/otel-w964/workflow-audit-v3/campaign-<suite>/aggregate-campaign.json
//    and prints ###AGG-CAMPAIGN###<json> as the last stdout line)

import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  aggregateCore,
  bootstrapCi,
  BOOTSTRAP_RESAMPLES,
  BOOTSTRAP_SEED,
  OUT_ROOT,
} from "./runner.js";

const args = process.argv.slice(2);
const suiteIdx = args.indexOf("--suite");
const suite = suiteIdx >= 0 ? args[suiteIdx + 1] : "mixed";
const campaignDir = join(OUT_ROOT, `campaign-${suite}`);

function iqr(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => {
    const idx = (s.length - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    return s[lo] + (s[hi] - s[lo]) * (idx - lo);
  };
  return q(0.75) - q(0.25);
}

/** §2.3 rule table for one metric's CI + paired deltas. */
function judgeMetric({ n, deltas, ciLow, ciHigh, budgetPct = 5 }) {
  if (n < 6) return { verdict: "UNKNOWN", why: `n=${n} < 6 valid pairs` };
  if (iqr(deltas) > 5)
    return { verdict: "UNKNOWN", why: `IQR ${iqr(deltas).toFixed(3)}pp > 5pp` };
  if (ciLow === null || ciHigh === null)
    return { verdict: "UNKNOWN", why: "CI not computable" };
  let verdict;
  if (ciHigh <= budgetPct) verdict = "PASS";
  else if (ciLow > budgetPct) verdict = "FAIL";
  else verdict = "UNKNOWN";
  const why = `CI [${ciLow.toFixed(3)}, ${ciHigh.toFixed(3)}]% vs +${budgetPct}%`;
  const containsZero = ciLow <= 0 && ciHigh >= 0;
  return { verdict, why, containsZero };
}

if (!existsSync(campaignDir)) {
  console.error(`campaign dir not found: ${campaignDir}`);
  process.exit(1);
}

// rounds input shape (aggregateCore contract): one round per sweep.
const rounds = [];
for (const name of readdirSync(campaignDir).sort()) {
  if (!/^sweep-\d+$/.test(name)) continue;
  const sweep = Number(name.slice("sweep-".length));
  const segments = [];
  for (const entry of readdirSync(join(campaignDir, name)).sort()) {
    const summaryPath = join(campaignDir, name, entry, "segment-summary.json");
    if (!existsSync(summaryPath)) continue;
    const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
    segments.push({
      config: summary.config,
      valid: summary.valid === true,
      workflow: summary.workflow,
      summary,
    });
  }
  rounds.push({ round: sweep, segments });
}

// Acceptance face: baseline H1 (ADR-028 §3 表三, PROTOCOL §2-2). H0 drift
// context comes from a second aggregateCore pass with baseline H0.
const acc = aggregateCore(rounds, { baseline: "H1" });
const drift = aggregateCore(rounds, { baseline: "H0" });

// Recompute per-row delta arrays for the p99 CI (aggregateCore bootstraps
// CPU only) and attach §2.3 verdicts. Pairing is rebuilt from the same
// rounds input with identical same-sweep/same-workflow rules.
function pairDeltas(baseline) {
  const out = new Map(); // `${workflow}|${config}` -> {cpu:[], p99:[]}
  for (const r of rounds) {
    const byWf = new Map();
    for (const seg of r.segments) {
      if (!(seg.valid && seg.summary)) continue;
      const wf = seg.workflow ?? seg.summary.workflow ?? "mixed";
      if (!byWf.has(wf)) byWf.set(wf, {});
      byWf.get(wf)[seg.config] = seg.summary;
    }
    for (const [wf, cfgs] of byWf) {
      const base = cfgs[baseline];
      if (!base) continue;
      for (const [config, s] of Object.entries(cfgs)) {
        if (config === baseline) continue;
        const key = `${wf}|${config}`;
        if (!out.has(key)) out.set(key, { cpu: [], p99: [] });
        out
          .get(key)
          .cpu.push(((s.cpuMsPerOp - base.cpuMsPerOp) / base.cpuMsPerOp) * 100);
        out.get(key).p99.push(((s.p99Ms - base.p99Ms) / base.p99Ms) * 100);
      }
    }
  }
  return out;
}

const accPairs = pairDeltas("H1");
const rows = [];
for (const row of acc.rows) {
  const key = `${row.workflow}|${row.config}`;
  const deltas = accPairs.get(key) ?? { cpu: [], p99: [] };
  const p99Ci = bootstrapCi(deltas.p99, BOOTSTRAP_RESAMPLES, BOOTSTRAP_SEED);
  const cpu = judgeMetric({
    n: row.n,
    deltas: deltas.cpu,
    ciLow: row.ciLow,
    ciHigh: row.ciHigh,
  });
  const p99 = judgeMetric({
    n: row.n,
    deltas: deltas.p99,
    ciLow: p99Ci.low,
    ciHigh: p99Ci.high,
  });
  // T1-T4 acceptance conjunction (PROTOCOL §2-3): any UNKNOWN → UNKNOWN.
  const verdictOrder = { FAIL: 0, UNKNOWN: 1, PASS: 2 };
  const overall =
    verdictOrder[cpu.verdict] > verdictOrder[p99.verdict]
      ? cpu.verdict
      : p99.verdict;
  rows.push({
    workflow: row.workflow,
    config: row.config,
    n: row.n,
    cpuDeltaPctMedian: row.cpuDeltaPct,
    cpuCiPct: [row.ciLow, row.ciHigh],
    p99DeltaPctMedian: row.p99DeltaPct,
    p99CiPct: [
      p99Ci.low === null ? null : +p99Ci.low.toFixed(3),
      p99Ci.high === null ? null : +p99Ci.high.toFixed(3),
    ],
    p50DeltaPctMedian: row.p50DeltaPct,
    p95DeltaPctMedian: row.p95DeltaPct,
    rssDeltaMbMedian: row.rssDeltaMb,
    cpuVerdict: cpu,
    p99Verdict: p99,
    overall,
  });
}

const result = {
  suite,
  baseline: "H1",
  bootstrap: { resamples: BOOTSTRAP_RESAMPLES, seed: BOOTSTRAP_SEED },
  throughputSemantics:
    "closed-loop: C fixed workers over a finite plan, ops/s = C/latency — NOT constant-arrival-rate latency",
  sweeps: rounds.length,
  rows,
  h0DriftContext: drift.rows.map((r) => ({
    workflow: r.workflow,
    config: r.config,
    n: r.n,
    cpuDeltaPctMedian: r.cpuDeltaPct,
    cpuCiPct: [r.ciLow, r.ciHigh],
  })),
  notes: [...acc.notes],
};
const outPath = join(campaignDir, "aggregate-campaign.json");
writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n");
console.log(`###AGG-CAMPAIGN###${JSON.stringify(result)}`);
