#!/usr/bin/env node
/** Aggregate the interleaved A/B phase JSONs into per-metric medians,
 *  B/A ratios with dispersion, and protection-metric roll-ups. */
import fs from "node:fs";
import path from "node:path";

const OUT = "/tmp/perf-ab/out";
const REPS = [1, 2, 3, 4, 5, 6];

function load(variant) {
  const phases = new Map();
  for (const rep of REPS) {
    const f = path.join(OUT, `phases-${variant}-rep${rep}.json`);
    if (!fs.existsSync(f)) continue;
    for (const p of JSON.parse(fs.readFileSync(f, "utf8")).phases) {
      if (!phases.has(p.phase)) phases.set(p.phase, []);
      phases.get(p.phase).push(p);
    }
  }
  return phases;
}

function med(arr) {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
function spread(arr) {
  const m = med(arr);
  const lo = Math.min(...arr), hi = Math.max(...arr);
  return m === 0 ? 0 : (hi - lo) / m;
}

const base = load("base");
const ints = load("int");
const phaseNames = [...new Set([...base.keys(), ...ints.keys()])];

const table = [];
for (const ph of phaseNames) {
  const A = base.get(ph) ?? [];
  const B = ints.get(ph) ?? [];
  if (A.length === 0 || B.length === 0) continue;
  const metrics = {
    rps: (p) => p.rps,
    p50: (p) => p.p50,
    p95: (p) => p.p95,
    p99: (p) => p.p99,
    cpuMsPerReq: (p) => p.cpuMsPerReq,
    pinoBytesPerReq: (p) => p.pinoBytesPerReq,
    xactPerReq: (p) => p.xactPerReq,
    receiptsPerReq: (p) => p.tables.exam_answer_save_receipts / p.n,
    clientEventsPerReq: (p) => p.tables.client_events / p.n,
    auditPerReq: (p) => p.tables.audit_logs / p.n,
  };
  for (const [name, f] of Object.entries(metrics)) {
    const a = A.map(f), b = B.map(f);
    const aM = med(a), bM = med(b);
    const ratio = aM === 0 ? null : bM / aM;
    const perRepRatio = a.map((v, i) => (v === 0 ? null : b[i] / v)).filter((v) => v !== null);
    table.push({
      phase: ph, metric: name,
      baseMedian: Number(aM.toFixed(3)), intMedian: Number(bM.toFixed(3)),
      ratioBA: ratio === null ? null : Number(ratio.toFixed(4)),
      baseSpreadPct: Number((spread(a) * 100).toFixed(1)),
      intSpreadPct: Number((spread(b) * 100).toFixed(1)),
      perRepRatioSpreadPct: perRepRatio.length
        ? Number(((Math.max(...perRepRatio) - Math.min(...perRepRatio)) / med(perRepRatio) * 100).toFixed(1))
        : null,
      repsA: a.length, repsB: b.length,
    });
  }
}

// protection roll-ups
const protection = {};
for (const v of ["base", "int"]) {
  const phases = v === "base" ? base : ints;
  let successTelemetryWrites = 0, receipts = 0, acceptedTrue = 0, auditRows = 0;
  let answersReqs = 0, ceWritesAnswers = 0;
  for (const [name, list] of phases) {
    if (!name.startsWith("answers-")) continue;
    for (const p of list) {
      successTelemetryWrites += p.tables.client_events;
      receipts += p.tables.exam_answer_save_receipts;
      acceptedTrue += p.acceptedTrue;
      auditRows += p.tables.audit_logs;
      answersReqs += p.n;
    }
  }
  protection[v] = { successTelemetryWrites, receipts, acceptedTrue, auditRows, answersReqs };
}

const summary = {
  generatedAt: new Date().toISOString(),
  repsAnalyzed: REPS,
  table,
  protection,
};
fs.writeFileSync(path.join(OUT, "analysis.json"), JSON.stringify(summary, null, 2));

// console digest
for (const ph of phaseNames) {
  console.log(`\n== ${ph} ==`);
  for (const r of table.filter((t) => t.phase === ph)) {
    console.log(
      `  ${r.metric.padEnd(18)} A=${String(r.baseMedian).padStart(9)} B=${String(r.intMedian).padStart(9)} ` +
      `B/A=${r.ratioBA === null ? "-" : r.ratioBA.toFixed(4)} spreadA=${r.baseSpreadPct}% spreadB=${r.intSpreadPct}% perRepSpread=${r.perRepRatioSpreadPct ?? "-"}%`,
    );
  }
}
console.log("\nprotection:", JSON.stringify(protection, null, 2));
