#!/usr/bin/env node
// Package the v3 workflow-audit raw evidence (out/otel-w964/workflow-audit-v3/,
// gitignored) into sanitized, reviewable digests under
// docs/research/observability-workflow-audit/data-v3/.
//
// INVARIANT: every emitted value is either copied from raw evidence with the
// sanitization below applied, or derived mechanically from it. Nothing is
// hand-edited afterwards; byte identity is pinned by data-v3/SHA256SUMS and
// evidence-manifest.json ("reviewable" part).
//
// Sanitization (INVARIANT — auditors re-run `grep -RnE "/home/|file://" data-v3/`
// and expect zero hits): absolute audit-tree/home path prefixes are rewritten,
// file:// tokens are dropped, whitespace is collapsed, long text is truncated.
// No credentials exist in these artifacts (connection strings live in env,
// never serialized into segment summaries).
//
// Segments excluded from the per-workflow formal aggregate (PROTOCOL §6.3 via
// cmdAggregate, runner.js:5201 reads rounds/ only) stay in segments.jsonl with
// their suite/status labels — packaging never deletes evidence, it labels it.

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..", "..", "..");
const rawRoot = join(repoRoot, "out", "otel-w964", "workflow-audit-v3");
const outDir = join(
  repoRoot,
  "docs",
  "research",
  "observability-workflow-audit",
  "data-v3",
);

function mustReadJson(rel) {
  const full = join(repoRoot, rel);
  if (!existsSync(full)) return null;
  return JSON.parse(readFileSync(full, "utf8"));
}

function listFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out.sort();
}

function countLines(file) {
  const text = readFileSync(file, "utf8");
  const n = text.split("\n").length;
  return text.endsWith("\n") ? n - 1 : n;
}

// --- sanitization -----------------------------------------------------------

const AUDIT_TREE_PREFIX = "/home/hoo/Source/exam-otel-audit";
const HOME_PREFIX = "/home/hoo";

function sanitize(text, { max = 240 } = {}) {
  let out = String(text)
    .replace(/file:\/\/\S*/g, "")
    .replaceAll(AUDIT_TREE_PREFIX, "<audit-tree>")
    .replaceAll(HOME_PREFIX, "<home>")
    .replace(/\s+/g, " ")
    .trim();
  if (out.length > max) out = `${out.slice(0, max)}…(truncated)`;
  return out;
}

function sanitizeAll(list, opts) {
  return (list ?? []).map((entry) => sanitize(entry, opts));
}

// --- invalid-reason taxonomy -------------------------------------------------
// Single classification authority for both segment summaries and campaign
// unit reasons. First matching rule wins; code list is closed (OTHER fallback).

const REASON_RULES = [
  [/ECONNREFUSED/, "SEED_CONVERGE_DB_UNREACHABLE"],
  [/database system is starting up/, "SEED_CONVERGE_DB_STARTING"],
  [/^seed converge failed/, "SEED_CONVERGE_FAILED_OTHER"],
  [
    /steady window exceeded (\d+)s before quota/,
    "QUOTA_NOT_COMPLETED_IN_STEADY_WINDOW",
  ],
  [/loadavg [\d.]+ > 4 inside segment/, "LOADAVG_IN_WINDOW_EXCEEDED"],
  [/steady window closed with (\d+) sample/, "CPU_PAIR_FAIL_CLOSED"],
  [/violated the per-op oracle/, "ORACLE_VIOLATIONS"],
  [/exited before quota|process exited/, "PROCESS_EXITED_EARLY"],
  [
    /starved by repeated interference recheck failures/,
    "STARVED_INTERFERENCE_RECHECK",
  ],
  [/deferred: 1m loadavg [\d.]+ > 4 at entry/, "DEFERRED_ENTRY_LOADAVG"],
];

function classifyReason(raw) {
  for (const [pattern, code] of REASON_RULES) {
    if (pattern.test(raw)) return code;
  }
  return "OTHER";
}

// --- segment extraction ------------------------------------------------------

function classifySegment(relFromRaw) {
  // relFromRaw e.g. "campaign-isolated/sweep-1/H1-iso-C1/segment-summary.json"
  const parts = relFromRaw.split("/");
  const dir = parts.slice(0, -1).join("/");
  if (parts[0] === "pilot") {
    return { suite: "pilot", rep: parts[1], unit: parts[1] };
  }
  if (parts[0] === "campaign-isolated") {
    const unit = parts[2];
    const config = unit.split("-iso-")[0];
    const workflow = `iso-${unit.split("-iso-")[1]}`;
    return { suite: "isolated", rep: parts[1], unit, config, workflow };
  }
  if (parts[0] === "campaign-knee") {
    const unit = parts[2]; // e.g. H1-c50
    const config = unit.split("-c")[0];
    const gear = `c${unit.split("-c")[1]}`;
    return {
      suite: "knee",
      rep: parts[1],
      unit,
      config,
      workflow: "mixed",
      gear,
    };
  }
  if (
    parts[0] === "equivalence-superseded-run1" ||
    parts[0] === "equivalence-superseded-run2" ||
    parts[0] === "equivalence-superseded-run3-partial"
  ) {
    return {
      suite: "equivalence",
      rep: `${parts[0].replace("equivalence-superseded-", "")}/${parts[1]}`,
      unit: parts[2],
    };
  }
  if (parts[0] === "run-meta" && parts[1] === "archive") {
    const inner = parts.slice(2, -1); // between archive/ and segment-summary.json
    return {
      suite: "probe-archive",
      rep: inner[0],
      unit: inner.length > 1 ? inner.join("/") : inner[0],
    };
  }
  return { suite: "unclassified", rep: dir, unit: dir };
}

function num(v) {
  return typeof v === "number" ? v : null;
}

function buildSegmentRows() {
  const rows = [];
  for (const full of listFiles(rawRoot)) {
    const base = full.split("/").pop();
    if (base !== "segment-summary.json") continue;
    const relFromRaw = relative(rawRoot, full);
    const d = JSON.parse(readFileSync(full, "utf8"));
    const cls = classifySegment(relFromRaw);
    const statusBySuite = {
      pilot: "recon-ladder (pilot; never enters statistics — PROTOCOL §3.4)",
      isolated:
        "campaign (as-built: cmdAggregate reads rounds/ only — runner.js:5201)",
      knee: "campaign-recon (as-built: outside rounds/; §6.5(b) aggregation path not landed)",
      equivalence:
        "superseded interim (final h0-equivalence.json absent; not for judgment)",
      "probe-archive": "interim probe archive (round-0 probes/verifies)",
    };
    rows.push({
      suite: cls.suite,
      status: statusBySuite[cls.suite] ?? "unclassified",
      workflow: cls.workflow ?? d.workflow ?? "mixed",
      config: cls.config ?? d.config,
      rep: cls.rep,
      unit: cls.unit,
      concurrency: num(d.concurrency),
      valid: d.valid === true,
      ops: num(d.ops),
      errors: num(d.errors),
      cpuMsPerOp: num(d.cpuMsPerOp),
      p50Ms: num(d.p50Ms),
      p95Ms: num(d.p95Ms),
      p99Ms: num(d.p99Ms),
      rssMb: num(d.rssMb),
      rssMaxMb: num(d.rssMaxMb),
      throughputOpsPerSec: num(d.throughputOpsPerSec),
      wallSeconds: num(d.wallSeconds),
      maxLoad1: num(d.maxLoad1),
      externalLoadIncrement: num(d.externalLoadIncrement),
      expiredInProgressAtWindowEntry: num(d.expiredInProgressAtWindowEntry),
      invalidReasonCodes: sanitizeAll(d.invalidReasons ?? []).map(
        classifyReason,
      ),
      invalidReasons: sanitizeAll(d.invalidReasons ?? []),
      source: `out/otel-w964/workflow-audit-v3/${relFromRaw}`,
    });
  }
  rows.sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : 0));
  return rows;
}

// --- campaign summaries ------------------------------------------------------

function digestReasonList(list) {
  const histogram = {};
  for (const raw of list ?? []) {
    const code = classifyReason(raw);
    histogram[code] = (histogram[code] ?? 0) + 1;
  }
  return histogram;
}

function buildCampaigns() {
  const campaigns = {};

  campaigns.mixed = {
    dir: null,
    status: "never-started (fail-closed)",
    segmentsLaunched: 0,
    gateOutcome:
      "entry precheck gate rejected every attempt; only failing item = H0 §6.6-3 equivalence register missing (gate 6/7 passed; run-meta 1794745651376 et al.)",
    evidence:
      "out/otel-w964/workflow-audit-v3/BLOCKED-20261115-hostside-docker-desktop-shutdown.md",
  };

  const isolatedDir = join(rawRoot, "campaign-isolated");
  if (existsSync(join(isolatedDir, "campaign.json"))) {
    const c = JSON.parse(
      readFileSync(join(isolatedDir, "campaign.json"), "utf8"),
    );
    const units = {};
    let reasonTexts = [];
    for (const [unit, u] of Object.entries(c.units ?? {})) {
      units[unit] = {
        config: u.config,
        workflow: u.workflow,
        valid: u.valid,
        attempts: u.attempts,
        deferrals: u.deferrals,
        reasonCodes: digestReasonList(u.reasons),
      };
      reasonTexts = reasonTexts.concat(u.reasons ?? []);
    }
    campaigns.isolated = {
      dir: "out/otel-w964/workflow-audit-v3/campaign-isolated/",
      generatedAt: c.generatedAt,
      totalValid: Object.values(units).reduce((s, u) => s + u.valid, 0),
      totalAttempts: Object.values(units).reduce((s, u) => s + u.attempts, 0),
      totalDeferrals: Object.values(units).reduce((s, u) => s + u.deferrals, 0),
      units,
      overallReasonCodes: digestReasonList(reasonTexts),
      notesDigest: sanitizeAll(c.notes ?? []).slice(0, 12),
    };
  }

  const kneeDir = join(rawRoot, "campaign-knee");
  if (existsSync(join(kneeDir, "campaign.json"))) {
    const c = JSON.parse(readFileSync(join(kneeDir, "campaign.json"), "utf8"));
    const units = {};
    for (const [unit, u] of Object.entries(c.units ?? {})) {
      units[unit] = {
        config: u.config,
        gear: u.gear,
        valid: u.valid,
        attempts: u.attempts,
        deferrals: u.deferrals,
        reasonCodes: digestReasonList(u.reasons),
      };
    }
    const validSegments = (c.rounds ?? [])
      .flatMap((r) => r.segments ?? [])
      .filter((s) => s.valid === true)
      .map((s) => ({
        unit: s.unit,
        config: s.config,
        workflow: s.workflow,
        concurrency: s.concurrency,
        ops: s.ops,
        cpuMsPerOp: s.cpuMsPerOp,
        p99Ms: s.p99Ms,
        invalidReasons: sanitizeAll(s.invalidReasons ?? []),
      }));
    campaigns.knee = {
      dir: "out/otel-w964/workflow-audit-v3/campaign-knee/",
      generatedAt: c.generatedAt,
      gears: c.gears ?? null,
      totalValid: Object.values(units).reduce((s, u) => s + u.valid, 0),
      totalAttempts: Object.values(units).reduce((s, u) => s + u.attempts, 0),
      totalDeferrals: Object.values(units).reduce((s, u) => s + u.deferrals, 0),
      units,
      validSegments,
      deferredEntryCount: (c.notes ?? []).filter((n) =>
        /deferred: 1m loadavg/.test(n),
      ).length,
      notesDigest: sanitizeAll(c.notes ?? []).slice(0, 8),
    };
  }

  const abortedDir = join(rawRoot, "campaign-knee-aborted-probe-20261115");
  if (existsSync(abortedDir)) {
    const opsFile = join(abortedDir, "sweep-1", "H1-c100", "ops.jsonl");
    campaigns.kneeAbortedProbe = {
      dir: "out/otel-w964/workflow-audit-v3/campaign-knee-aborted-probe-20261115/",
      status:
        "aborted CLI probe (INCIDENT-20261115-knee-gate-probe-aborted.md); no segment-summary, no round.json, no campaign.json judgment face",
      opsJsonlLines: existsSync(opsFile) ? countLines(opsFile) : null,
      archivedAsIs: true,
    };
  }

  return campaigns;
}

function buildPilot() {
  const pilot = mustReadJson("out/otel-w964/workflow-audit-v3/pilot.json");
  const register = mustReadJson(
    "out/otel-w964/workflow-audit-v3/pilot-register.json",
  );
  if (!pilot) return null;
  return {
    file: "out/otel-w964/workflow-audit-v3/pilot.json",
    generatedAt: pilot.generatedAt,
    config: pilot.config,
    ok: pilot.ok,
    kPilot: pilot.kPilot,
    cpuSamplesValid: pilot.cpuSamplesValid,
    loadStats: sanitize(pilot.loadStats ?? ""),
    ladder: (pilot.ladder ?? []).map((g) => ({
      concurrency: g.concurrency,
      valid: g.valid,
      ops: g.ops,
      p99Ms: g.p99Ms,
      throughputOpsPerSec: g.throughputOpsPerSec,
      cpuMsPerOp: g.cpuMsPerOp,
      maxLoad1: g.maxLoad1,
      quotaExceededExpected: g.quotaExceededExpected,
      invalidReasonCodes: sanitizeAll(g.invalidReasons ?? []).map(
        classifyReason,
      ),
    })),
    recommended: pilot.recommended
      ? {
          steadyMaxSeconds: pilot.recommended.steadyMaxSeconds,
          quotaOps: pilot.recommended.quotaOps,
          concurrency: pilot.recommended.concurrency,
          basis: sanitizeAll(pilot.recommended.basis ?? [], { max: 200 }),
        }
      : null,
    notesDigest: sanitizeAll(pilot.notes ?? []),
    registerDigest: register
      ? {
          file: "out/otel-w964/workflow-audit-v3/pilot-register.json",
          generatedAt: register.generatedAt,
          session: sanitize(register.session ?? "", { max: 160 }),
          idleSeries: register.idleSeries
            ? {
                n: register.idleSeries.n,
                idleMax1m: register.idleSeries.idleMax1m,
                idleMed1m: register.idleSeries.idleMed1m,
                B_entry: register.idleSeries.B_entry,
                finalized: register.idleSeries.finalized,
              }
            : null,
          timingInputsUsed: register.timingInputs
            ? {
                overheadSeconds: register.timingInputs.overheadSeconds?.used,
                s_scSeconds: register.timingInputs.s_scSeconds?.used,
                steadyBudgetSeconds: register.timingInputs.steadyBudgetSeconds,
              }
            : null,
          kPilot: register.ladderRef?.kPilot ?? null,
          backfill: register.backfill
            ? {
                P_STEADY: {
                  value: register.backfill.P_STEADY?.value,
                  finalized: register.backfill.P_STEADY?.finalized,
                },
                B_entry: {
                  value: register.backfill.B_entry?.value,
                  finalized: register.backfill.B_entry?.finalized,
                },
                P_CONC: {
                  finalized: register.backfill.P_CONC?.finalized,
                  status: sanitize(register.backfill.P_CONC?.status ?? "", {
                    max: 80,
                  }),
                },
              }
            : null,
          adjudication: register.adjudication
            ? {
                decision: sanitize(register.adjudication.decision ?? "", {
                  max: 200,
                }),
                keyParameters: register.adjudication.keyParameters,
                flaggedForOwnerReview: true,
              }
            : null,
          escalationState: register.escalation
            ? {
                required: register.escalation.required,
                state: sanitize(register.escalation.state ?? "", { max: 200 }),
              }
            : null,
          noLooseningItems: (register.noLoosening?.frozenCoresUntouched ?? [])
            .length,
          measuredLadderRows: (register.measuredLadder?.rows ?? []).map(
            (r) => ({ c: r.c, throughputOpsPerSec: r.y, maxLoad1: r.maxLoad1 }),
          ),
        }
      : null,
  };
}

function buildEquivalence() {
  const runIds = ["run1", "run2", "run3-partial"];
  const superseded = [];
  for (const id of runIds) {
    const reg = mustReadJson(
      `out/otel-w964/workflow-audit-v3/h0-equivalence.superseded-${id}.json`,
    );
    if (!reg) continue;
    const byWorkload = {};
    for (const [w, st] of Object.entries(reg.workloadStatus ?? {})) {
      byWorkload[w] = {
        verifiedPairs: st.verifiedPairs,
        nonComparable: st.nonComparable === true,
        divergences: sanitizeAll(st.divergences ?? []).map((d) =>
          typeof d === "string" ? d : sanitize(JSON.stringify(d)),
        ),
      };
    }
    superseded.push({
      id,
      register: `out/otel-w964/workflow-audit-v3/h0-equivalence.superseded-${id}.json`,
      verified: reg.verified === true,
      rounds: (reg.rounds ?? []).length,
      targetRoundsPerWorkload: reg.targetRoundsPerWorkload,
      gear: reg.gear,
      workloadStatus: byWorkload,
      notes: sanitizeAll(reg.notes ?? [], { max: 200 }),
    });
  }
  return {
    finalRegister: {
      file: "out/otel-w964/workflow-audit-v3/h0-equivalence.json",
      present: existsSync(join(rawRoot, "h0-equivalence.json")),
    },
    supersededRuns: superseded,
    run4: {
      status:
        "died at entry — connect ECONNREFUSED (host Docker Desktop shutdown)",
      producedSegments: 0,
      evidence:
        "out/otel-w964/workflow-audit-v3/BLOCKED-20261115-hostside-docker-desktop-shutdown.md",
    },
    emptyDir:
      "out/otel-w964/workflow-audit-v3/equivalence/ (run4 shell, no segments)",
  };
}

function buildSupportingEvidence() {
  const supp = { b4Repro: null, w09: null, profileH0: null, incidents: [] };

  const b4 = {};
  for (const name of [
    "pre-fix",
    "post-fix",
    "post-fix-final",
    "post-fix-v3-final",
  ]) {
    const d = mustReadJson(
      `out/otel-w964/workflow-audit-v3/b4-repro/${name}.json`,
    );
    if (!d) continue;
    b4[name] = {
      expectViolations: d.expectViolations,
      saves: d.saves,
      concurrency: d.concurrency,
      result: d.result,
      concurrentBatch: d.concurrentBatch,
    };
  }
  for (const name of ["pre-fix.error", "post-fix.error"]) {
    const d = mustReadJson(
      `out/otel-w964/workflow-audit-v3/b4-repro/${name}.json`,
    );
    if (d) b4[name] = { label: d.label, error: sanitize(d.error ?? "") };
  }
  const mech = mustReadJson(
    "out/otel-w964/workflow-audit-v3/b4-repro/b4-mechanism-round0.json",
  );
  if (mech) {
    b4.mechanismRound0 = {
      id: mech.id,
      title: sanitize(mech.title ?? "", { max: 200 }),
      root: sanitize(mech.mechanism?.root ?? "", { max: 400 }),
    };
  }
  const invalidFirst = mustReadJson(
    "out/otel-w964/workflow-audit-v3/b4-repro/invalid-first-attempt-resumed-attempt/post-fix.json",
  );
  if (invalidFirst) {
    b4.invalidFirstAttemptArchive = {
      dir: "out/otel-w964/workflow-audit-v3/b4-repro/invalid-first-attempt-resumed-attempt/",
      why: "post /start resume semantics reused a dirty attempt → all saves legally STALE; evidence voided and resampled (runner re-seeds by force now)",
    };
  }
  supp.b4Repro = b4;

  const w09 = mustReadJson("out/otel-w964/workflow-audit-v3/w09/w09-H1.json");
  if (w09) {
    supp.w09 = {
      ok: w09.ok,
      config: w09.config,
      pool: w09.pool,
      delaySeconds: w09.delaySeconds,
      poolAttempts: w09.poolAttempts,
      sentinels: w09.sentinels,
      untouchedOk: w09.untouchedOk,
      violations: w09.violations,
    };
  }

  supp.profileH0 = {
    dir: "out/otel-w964/workflow-audit-v3/profile-H0/",
    files: listFiles(join(rawRoot, "profile-H0")).map((f) =>
      f.split("/").pop(),
    ),
  };

  for (const name of [
    "BLOCKED-20261115-hostside-docker-desktop-shutdown.md",
    "INCIDENT-20261115-knee-gate-probe-aborted.md",
  ]) {
    const full = join(rawRoot, name);
    if (!existsSync(full)) continue;
    const head = readFileSync(full, "utf8").split("\n").slice(0, 4).join(" ");
    supp.incidents.push({
      file: `out/otel-w964/workflow-audit-v3/${name}`,
      head: sanitize(head, { max: 300 }),
    });
  }
  return supp;
}

function buildAggregatePackage() {
  const raw = mustReadJson("out/otel-w964/workflow-audit-v3/aggregate.json");
  if (!raw) return null;
  return {
    generatedAt: raw.generatedAt,
    rows: raw.rows,
    notes: sanitizeAll(raw.notes ?? []),
    workflows: raw.workflows,
    packagingProvenance: {
      sourceFile: "out/otel-w964/workflow-audit-v3/aggregate.json",
      sourceGeneratedAt: raw.generatedAt,
      regenerateCommand: "node scripts/perf/otel-workflows/runner.js aggregate",
      sanitization:
        "note strings rewritten: absolute audit-tree prefix → repo-relative; content otherwise verbatim",
      interpretation:
        "rows=[] because cmdAggregate reads rounds/ only (runner.js:5201) and v3 rounds/ holds no round manifests; campaign/isolated/knee segments live outside rounds/ and do not enter this aggregation (as-built). Formal judgment stays UNKNOWN per PROTOCOL §6.4 (n=0 < 6).",
    },
  };
}

// --- emit --------------------------------------------------------------------

function writeJson(name, value) {
  writeFileSync(
    join(outDir, name),
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8",
  );
}

if (!existsSync(rawRoot)) {
  console.error(`raw root missing: ${relative(repoRoot, rawRoot)}`);
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

const segments = buildSegmentRows();
writeFileSync(
  join(outDir, "segments.jsonl"),
  segments.map((r) => JSON.stringify(r)).join("\n") + "\n",
  "utf8",
);

const aggregatePackage = buildAggregatePackage();

const campaignSummary = {
  packagedAt: new Date().toISOString(),
  packagedBy: "scripts/perf/otel-workflows/package-data-v3.mjs",
  rawSourceRoot: "out/otel-w964/workflow-audit-v3/",
  rawSourceRootNote:
    "gitignored (.gitignore:77 out/); packaged here as sanitized digests; per-file sha256 recorded in evidence-manifest.json (localRaw part)",
  protocolPinned: {
    manifest: "scripts/perf/otel-workflows/configs.json",
    version: "v4",
    contentSha256:
      "6739a741f4b29f82cb12a74d7b9fc0c3aab77ed474a05e3c954080c5898a6a25",
    params: { P_CONC: 1, P_STEADY: 300, P_QUOTA: 2100 },
  },
  segmentTotals: {
    segments: segments.length,
    valid: segments.filter((s) => s.valid).length,
    invalid: segments.filter((s) => !s.valid).length,
    bySuite: segments.reduce((acc, s) => {
      const e = (acc[s.suite] ??= { segments: 0, valid: 0, invalid: 0 });
      e.segments += 1;
      s.valid ? (e.valid += 1) : (e.invalid += 1);
      return acc;
    }, {}),
  },
  pilot: buildPilot(),
  campaigns: buildCampaigns(),
  equivalence: buildEquivalence(),
  supportingEvidence: buildSupportingEvidence(),
  aggregateState: aggregatePackage?.packagingProvenance ?? null,
};
writeJson("campaign-summary.json", campaignSummary);

if (aggregatePackage) {
  writeJson("aggregate.json", aggregatePackage);
}

console.log(
  `packaged ${segments.length} segments (${segments.filter((s) => s.valid).length} valid) → ${relative(repoRoot, outDir)}/segments.jsonl + campaign-summary.json`,
);
