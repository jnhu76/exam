#!/usr/bin/env node
// Recompute the packaged statistics from data-v3/segments.jsonl +
// data-v3/campaign-summary.json — the review-side re-derivation of the v3
// aggregation state, runnable WITHOUT any local out/ tree.
//
// INVARIANT (byte reproducibility): this output contains no wall-clock fields;
// it depends only on the two hashed inputs. Reviewers verify with:
//   node scripts/perf/otel-workflows/packaged-stats.mjs --check
// Hash authority stays the system `sha256sum` binary (same invariant as
// gen-evidence-manifest.mjs) — never a JS hash implementation.
//
// Interpretation contract (mirrors runner.js aggregateCore §6.3/§6.4):
// - formal aggregate rows pair each config against the same-round,
//   same-workflow H1 baseline; the baseline itself gets no row;
// - eligibility = formal rounds only (cmdAggregate reads rounds/ only,
//   runner.js:5201) — pilot/campaign/equivalence/probe-archive segments are
//   labeled but never paired;
// - n < 6 valid pairs → every cell UNKNOWN; CI containing 0 → INCONCLUSIVE,
//   never "zero cost".

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..", "..", "..");
const dataDir = join(
  repoRoot,
  "docs",
  "research",
  "observability-workflow-audit",
  "data-v3",
);

function sha256sum(file) {
  const stdout = execFileSync("sha256sum", [file], { encoding: "utf8" }).trim();
  const hash = stdout.slice(0, stdout.indexOf(" "));
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    throw new Error(`unexpected sha256sum output for ${file}: ${stdout}`);
  }
  return hash;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Self-contained mirror of the frozen PROTOCOL §6.3 bootstrap (mulberry32,
// 10,000 resamples, seed 20261115, median statistic, 2.5/97.5 percentiles).
// Deliberately independent of runner.js so this file cross-validates the
// authoritative implementation rather than importing it.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const BOOTSTRAP_RESAMPLES = 10_000;
const BOOTSTRAP_SEED = 20261115;
function bootstrapCiMedian(deltas) {
  if (deltas.length === 0) return [null, null];
  const rand = mulberry32(BOOTSTRAP_SEED);
  const n = deltas.length;
  const stats = new Array(BOOTSTRAP_RESAMPLES);
  const buf = new Array(n);
  for (let b = 0; b < BOOTSTRAP_RESAMPLES; b++) {
    for (let i = 0; i < n; i++) buf[i] = deltas[Math.floor(rand() * n)];
    stats[b] = median(buf);
  }
  stats.sort((a, b) => a - b);
  const r3 = (x) => (x === null ? null : +x.toFixed(3));
  return [
    r3(stats[Math.floor(BOOTSTRAP_RESAMPLES * 0.025)]),
    r3(
      stats[
        Math.min(
          BOOTSTRAP_RESAMPLES - 1,
          Math.ceil(BOOTSTRAP_RESAMPLES * 0.975) - 1,
        )
      ],
    ),
  ];
}
function iqrPp(xs) {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => {
    const idx = (s.length - 1) * p;
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    return s[lo] + (s[hi] - s[lo]) * (idx - lo);
  };
  return +(q(0.75) - q(0.25)).toFixed(3);
}

const segmentsPath = join(dataDir, "segments.jsonl");
const campaignPath = join(dataDir, "campaign-summary.json");
const segments = readFileSync(segmentsPath, "utf8")
  .split("\n")
  .filter((line) => line.trim().length > 0)
  .map((line) => JSON.parse(line));
const campaign = JSON.parse(readFileSync(campaignPath, "utf8"));

// --- totals ------------------------------------------------------------------

const totals = {
  segments: segments.length,
  valid: segments.filter((s) => s.valid).length,
  invalid: segments.filter((s) => !s.valid).length,
};

const bySuite = {};
for (const s of segments) {
  const e = (bySuite[s.suite] ??= {
    segments: 0,
    valid: 0,
    invalid: 0,
    invalidReasonCodes: {},
  });
  e.segments += 1;
  s.valid ? (e.valid += 1) : (e.invalid += 1);
  for (const code of s.invalidReasonCodes) {
    e.invalidReasonCodes[code] = (e.invalidReasonCodes[code] ?? 0) + 1;
  }
}
const suiteOrder = [
  "pilot",
  "mixed-campaign",
  "mixed-superseded-run1",
  "isolated",
  "knee",
  "equivalence-final",
  "equivalence",
  "probe-archive",
];
const bySuiteOrdered = Object.fromEntries(
  suiteOrder
    .filter((k) => k in bySuite)
    .map((k) => [
      k,
      Object.fromEntries(
        Object.entries(bySuite[k]).map(([k2, v]) =>
          k2 === "invalidReasonCodes"
            ? [k2, Object.fromEntries(Object.entries(v).sort())]
            : [k2, v],
        ),
      ),
    ]),
);

// --- valid-segment medians per (suite, workflow, config) -----------------------
// Recon-grade descriptive statistics over harness-valid segments only. These
// are NOT paired deltas and never enter the formal aggregate.

const groups = new Map();
for (const s of segments) {
  if (!s.valid) continue;
  const key = `${s.suite}|${s.workflow}|${s.config}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(s);
}
const validSegmentsBySuiteWorkflowConfig = [...groups.entries()]
  .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  .map(([key, rows]) => {
    const [suite, workflow, config] = key.split("|");
    const pick = (field) =>
      median(rows.map((r) => r[field]).filter((v) => v !== null));
    return {
      suite,
      workflow,
      config,
      n: rows.length,
      reps: rows.map((r) => r.rep).sort(),
      medianCpuMsPerOp: pick("cpuMsPerOp"),
      medianP50Ms: pick("p50Ms"),
      medianP95Ms: pick("p95Ms"),
      medianP99Ms: pick("p99Ms"),
      medianRssMb: pick("rssMb"),
    };
  });

// --- formal aggregate (aggregateCore semantics over formal rounds) ------------

// The formal judgment carrier is the mixed campaign (PROTOCOL-v3 §6.3);
// its sweeps are the formal "rounds" for pairing (§6.5(a) bridge).
const FORMAL_ROUND_SUITES = ["mixed-campaign"];
const formalSegments = segments.filter((s) =>
  FORMAL_ROUND_SUITES.includes(s.suite),
);
const rows = [];
{
  // Group formal segments by (rep, workflow) then pair configs vs H1.
  const byRepWorkflow = new Map();
  for (const s of formalSegments) {
    if (!s.valid) continue;
    const key = `${s.rep}|${s.workflow}`;
    if (!byRepWorkflow.has(key)) byRepWorkflow.set(key, {});
    byRepWorkflow.get(key)[s.config] = s;
  }
  const baseline = "H1";
  const configOrder = [...new Set(formalSegments.map((s) => s.config))].filter(
    (c) => c !== baseline,
  );
  for (const workflow of [...new Set(formalSegments.map((s) => s.workflow))]) {
    for (const config of configOrder) {
      const pairs = { cpu: [], p50: [], p95: [], p99: [], rss: [] };
      for (const [, segs] of byRepWorkflow) {
        const base = segs[baseline];
        const cfg = segs[config];
        if (!base || !cfg) continue;
        pairs.cpu.push(
          ((cfg.cpuMsPerOp - base.cpuMsPerOp) / base.cpuMsPerOp) * 100,
        );
        pairs.p50.push(((cfg.p50Ms - base.p50Ms) / base.p50Ms) * 100);
        pairs.p95.push(((cfg.p95Ms - base.p95Ms) / base.p95Ms) * 100);
        pairs.p99.push(((cfg.p99Ms - base.p99Ms) / base.p99Ms) * 100);
        pairs.rss.push(cfg.rssMb - base.rssMb);
      }
      const n = pairs.cpu.length;
      rows.push({
        workflow,
        config,
        comparable: n > 0,
        cpuDeltaPct: median(pairs.cpu),
        cpuCiPct: bootstrapCiMedian(pairs.cpu),
        p50DeltaPct: median(pairs.p50),
        p95DeltaPct: median(pairs.p95),
        p99DeltaPct: median(pairs.p99),
        p99CiPct: bootstrapCiMedian(pairs.p99),
        rssDeltaMb: median(pairs.rss),
        cpuIqrPp: iqrPp(pairs.cpu),
        p99IqrPp: iqrPp(pairs.p99),
        n,
      });
    }
  }
}

// --- campaign validPaired (PERFORMANCE-REPORT §9.2 口径: min over units) ------

const campaigns = campaign.campaigns ?? {};
const campaignValidPaired = {};
{
  {
    const units = campaigns.mixed?.units;
    campaignValidPaired.mixed =
      units && Object.keys(units).length > 0
        ? Math.min(...Object.values(units).map((u) => u.valid))
        : 0;
  }
  for (const suite of ["isolated", "knee"]) {
    const units = campaigns[suite]?.units;
    campaignValidPaired[suite] =
      units && Object.keys(units).length > 0
        ? Math.min(...Object.values(units).map((u) => u.valid))
        : null;
  }
}

const output = {
  inputs: {
    "segments.jsonl": {
      sha256: sha256sum(segmentsPath),
      lines: totals.segments,
    },
    "campaign-summary.json": {
      sha256: sha256sum(campaignPath),
    },
  },
  totals,
  bySuite: bySuiteOrdered,
  validSegmentsBySuiteWorkflowConfig,
  formalAggregate: {
    semantics:
      "aggregateCore (runner.js:256) over formal rounds only: paired relative delta vs the same-round same-workflow H1 baseline; baseline excluded from rows; cross-workflow pairing never happens",
    formalRoundSegmentsInPackage: formalSegments.length,
    rows,
    exclusionBasis: {
      pilot: "PROTOCOL §3.4: pilot/ladder data never enters statistics",
      "mixed-superseded-run1":
        "superseded harness-gap run (defer-starve, pre waitForQuietLoad1 fix); not for judgment",
      isolated:
        "as-built: cmdAggregate reads rounds/ only (runner.js:5201); campaign segments are outside rounds/",
      knee: "same as isolated; additionally §6.5(b) campaign aggregation path not landed (PROTOCOL-v3)",
      "equivalence-final":
        "§6.6-3 comparability evidence (0 oracle violations, terminal fields equal); not a performance judgment channel",
      equivalence:
        "superseded interim registers (final h0-equivalence.json absent); §6.6-3 evidence, never a performance judgment channel",
      "probe-archive": "round-0 probe/verify archives, interim evidence",
    },
    note: "n < 6 → the cell is UNKNOWN (PROTOCOL §6.4); CI containing 0 must be reported INCONCLUSIVE, never 'zero cost'; CI straddling +5% is UNKNOWN→Owner; CI low > +5% is FAIL; IQR > 5pp is UNKNOWN (the frozen table gives FAIL and UNKNOWN-no-precedence when both hit)",
  },
  campaignValidPaired,
  kneeRecon: {
    note: "single harness-valid knee gradient segment (recon; not a formal sampling unit — freeze.json absent, §6.5(b) not landed); no budget judgment",
    segments: segments
      .filter((s) => s.suite === "knee" && s.valid)
      .map((s) => ({
        unit: s.unit,
        config: s.config,
        concurrency: s.concurrency,
        ops: s.ops,
        errors: s.errors,
        cpuMsPerOp: s.cpuMsPerOp,
        p50Ms: s.p50Ms,
        p95Ms: s.p95Ms,
        p99Ms: s.p99Ms,
        rssMb: s.rssMb,
        throughputOpsPerSec: s.throughputOpsPerSec,
        maxLoad1: s.maxLoad1,
        externalLoadIncrement: s.externalLoadIncrement,
        expiredInProgressAtWindowEntry: s.expiredInProgressAtWindowEntry,
      })),
  },
  determinism: {
    note: "no wall-clock fields; output depends only on the two hashed inputs above; hash authority = system sha256sum binary",
    reproduceCommand:
      "node scripts/perf/otel-workflows/packaged-stats.mjs --check",
  },
};

const outPath = join(dataDir, "stats-output.json");
const serialized = `${JSON.stringify(output, null, 2)}\n`;

if (process.argv.includes("--check")) {
  const existing = readFileSync(outPath, "utf8");
  if (existing === serialized) {
    console.log(
      `stats-output.json reproduced byte-identical from ${totals.segments} packaged segments (${totals.valid} valid) — OK`,
    );
  } else {
    console.error(
      "stats-output.json MISMATCH — packaged file diverges from recomputation",
    );
    process.exit(1);
  }
} else {
  writeFileSync(outPath, serialized, "utf8");
  console.log(`wrote ${relative(repoRoot, outPath)}`);
}
