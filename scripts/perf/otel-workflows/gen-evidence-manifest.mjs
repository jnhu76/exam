#!/usr/bin/env node
// Generate docs/research/observability-workflow-audit/evidence-manifest.json.
//
// INVARIANT: every sha256 in the manifest is produced by invoking the system
// `sha256sum` binary (never a JS hash implementation), so reviewers can
// reproduce any entry with `sha256sum <path>` directly.
//
// Group mapping (out/ has no dedicated ablation/ or profiles/ directories):
//   aggregate : aggregate.json (harness aggregate entry-point output)
//   ablation  : rounds/round-101..103 (S0/S1/S2 sampling-ratio ablation)
//               round.json + segment-summary.json + ops.jsonl
//   profiles  : all segments' samples.json (CPU/RSS sampler series) and
//               telemetry-memory-dump.jsonl (H3 memory-ring shutdown dump)
//   rounds    : rounds/round-0..6, round-20 — round.json +
//               segment-summary.json + ops.jsonl
// Raw logs (server-out.log, server-err.log, seed-converge.log) are excluded:
// non-key raw output, regenerable by the runner.

import { execFileSync } from "node:child_process";
import { readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..", "..", "..");
const evidenceRoot = join(repoRoot, "out", "otel-w964", "workflow-audit");
const docsDir = join(
  repoRoot,
  "docs",
  "research",
  "observability-workflow-audit",
);
const protocolFile = join(docsDir, "PROTOCOL.md");
const protocolV2File = join(docsDir, "PROTOCOL-v2.md");
const outputFile = join(docsDir, "evidence-manifest.json");

const EXPECTED_PROTOCOL_SHA256 =
  "8bc7f7cdf06353b80d149336e492cbb41b0896a844a5781a34ee03fdee80df63";

const ABLATION_ROUNDS = new Set(["round-101", "round-102", "round-103"]);
const PROFILE_FILES = new Set(["samples.json", "telemetry-memory-dump.jsonl"]);
const SEGMENT_FILES = new Set([
  "round.json",
  "segment-summary.json",
  "ops.jsonl",
]);

function sha256sum(file) {
  const stdout = execFileSync("sha256sum", [file], { encoding: "utf8" }).trim();
  const hash = stdout.slice(0, stdout.indexOf(" "));
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    throw new Error(`unexpected sha256sum output for ${file}: ${stdout}`);
  }
  return hash;
}

function listFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full));
    else if (entry.isFile()) out.push(full);
  }
  return out.sort();
}

const groups = { aggregate: [], rounds: [], ablation: [], profiles: [] };
const excluded = [];

for (const full of listFiles(evidenceRoot)) {
  const rel = relative(repoRoot, full);
  const parts = relative(evidenceRoot, full).split(/[\\/]/);
  const roundDir = parts[0] === "rounds" ? parts[1] : null;
  const base = parts[parts.length - 1];

  if (base === "aggregate.json" && roundDir === null) {
    groups.aggregate.push(rel);
  } else if (
    roundDir !== null &&
    ABLATION_ROUNDS.has(roundDir) &&
    SEGMENT_FILES.has(base)
  ) {
    groups.ablation.push(rel);
  } else if (PROFILE_FILES.has(base)) {
    groups.profiles.push(rel);
  } else if (SEGMENT_FILES.has(base)) {
    groups.rounds.push(rel);
  } else {
    excluded.push(rel);
  }
}

function buildGroup(files) {
  const entries = files.map((rel) => ({
    path: rel,
    sha256: sha256sum(join(repoRoot, rel)),
    bytes: statSync(join(repoRoot, rel)).size,
  }));
  return {
    fileCount: entries.length,
    totalBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
    files: entries,
  };
}

const groupsBuilt = Object.fromEntries(
  Object.entries(groups).map(([name, files]) => [name, buildGroup(files)]),
);

const protocolSha = sha256sum(protocolFile);

// Documented dual-calibre variant (PERFORMANCE-REPORT header): the content hash
// strips the trailing revision-log section. Computed here with the exact
// documented pipeline `awk '/^### 修订日志$/{exit} {print}' | sha256sum`.
const protocolContentSha = execFileSync("sha256sum", ["-"], {
  encoding: "utf8",
  input: execFileSync(
    "awk",
    ["/^### 修订日志$/{exit} {print}", relative(repoRoot, protocolFile)],
    { encoding: "utf8", cwd: repoRoot },
  ),
})
  .trim()
  .split(/\s+/)[0];

const manifest = {
  generatedAt: new Date().toISOString(),
  generator: "scripts/perf/otel-workflows/gen-evidence-manifest.mjs",
  hashTool: "sha256sum",
  gitHead: execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim(),
  evidenceRoot: relative(repoRoot, evidenceRoot),
  protocol: {
    file: relative(repoRoot, protocolFile),
    sha256: protocolSha,
    expectedSha256: EXPECTED_PROTOCOL_SHA256,
    match: protocolSha === EXPECTED_PROTOCOL_SHA256,
    calibre:
      "full-file sha256 (sha256sum). A second documented calibre strips the trailing revision-log section and hashes to 4eddc216… (the value pinned by configs.json); both values are true and differ only by calibre — see PERFORMANCE-REPORT.md header.",
    contentCalibreSha256: protocolContentSha,
    contentCalibreCommand:
      "awk '/^### 修订日志$/{exit} {print}' <PROTOCOL.md> | sha256sum",
  },
  protocolVariants: {
    "PROTOCOL-v2.md": {
      file: relative(repoRoot, protocolV2File),
      sha256: sha256sum(protocolV2File),
      note: "revision present alongside PROTOCOL.md; v1-vs-v2 version adjudication belongs to the Owner — recorded here for evidence completeness",
    },
  },
  groups: groupsBuilt,
  excluded: {
    fileCount: excluded.length,
    reason:
      "raw logs (server-out.log, server-err.log, seed-converge.log): non-key raw output, regenerable by the runner; not hashed in this manifest",
  },
  notes: [
    "Group mapping: out/ has no dedicated ablation/ or profiles/ directories on disk. Sampling-ratio ablation data (S0/S1/S2) lives in rounds/round-101..103 (group 'ablation': round manifest + segment summaries + ops series). Profile-class data (per-segment CPU/RSS sampler series samples.json and H3 memory-ring shutdown dumps telemetry-memory-dump.jsonl) lives inside each segment directory and is grouped as 'profiles' across all rounds.",
    "Every sha256 above was computed by invoking the sha256sum binary on the exact file; reproduce any entry with `sha256sum <repo-root>/<path>`.",
    "All hashed files live under out/, which is gitignored (.gitignore); this manifest is the tracked, committable record of their content at generation time.",
  ],
};

writeFileSync(outputFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

const summary = Object.entries(groupsBuilt)
  .map(([name, group]) => `${name}=${group.fileCount}`)
  .join(", ");
console.log(`wrote ${relative(repoRoot, outputFile)}`);
console.log(`groups: ${summary}, excluded=${excluded.length}`);
console.log(
  `protocol sha256=${protocolSha} match=${manifest.protocol.match} contentCalibre=${protocolContentSha}`,
);
