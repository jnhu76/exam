#!/usr/bin/env node
// Generate docs/research/observability-workflow-audit/evidence-manifest.json —
// the DUAL evidence inventory (R2-09 closure):
//
//   reviewable : files delivered inside the PR — data-v3/ packaged digests
//                (sha256-anchored; reviewers verify from the PR alone) and the
//                pinned PROTOCOL variants. data-v3/SHA256SUMS is written here
//                before hashing so `sha256sum -c` works out of the box.
//   localRaw   : gitignored raw evidence (out/), which reviewers cannot see.
//                Registered as local path + sha256 + regeneration command so
//                the provenance chain is auditable on the producing machine.
//
// INVARIANT: every sha256 is produced by invoking the system `sha256sum`
// binary (never a JS hash implementation), so reviewers can reproduce any
// entry with `sha256sum <path>` directly.
//
// Run order: package-data-v3.mjs → packaged-stats.mjs → this script.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..", "..", "..");
const docsDir = join(
  repoRoot,
  "docs",
  "research",
  "observability-workflow-audit",
);
const dataDir = join(docsDir, "data-v3");
const outputFile = join(docsDir, "evidence-manifest.json");

const RAW_ROOTS = {
  v3: "out/otel-w964/workflow-audit-v3",
  v1: "out/otel-w964/workflow-audit",
  scratchV1Copy: "out/out",
  scratchH0Pilot: "out/pilot-h0",
};

const PROTOCOL_FILES = {
  "PROTOCOL.md": join(docsDir, "PROTOCOL.md"),
  "PROTOCOL-v2.md": join(docsDir, "PROTOCOL-v2.md"),
  "PROTOCOL-v3.md": join(docsDir, "PROTOCOL-v3.md"),
  "PROTOCOL-v4.md": join(docsDir, "PROTOCOL-v4.md"),
};

const DATA_V3_FILES = [
  "README.md",
  "segments.jsonl",
  "campaign-summary.json",
  "aggregate.json",
  "stats-output.json",
];

function sha256sum(file) {
  const stdout = execFileSync("sha256sum", [file], { encoding: "utf8" }).trim();
  const hash = stdout.slice(0, stdout.indexOf(" "));
  if (!/^[0-9a-f]{64}$/.test(hash)) {
    throw new Error(`unexpected sha256sum output for ${file}: ${stdout}`);
  }
  return hash;
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

function buildGroup(rootRel, files) {
  const entries = files.map((full) => ({
    path: relative(repoRoot, full),
    sha256: sha256sum(full),
    bytes: statSync(full).size,
  }));
  return {
    root: rootRel,
    fileCount: entries.length,
    totalBytes: entries.reduce((sum, e) => sum + e.bytes, 0),
    files: entries,
  };
}

// --- data-v3/SHA256SUMS (written first, then hashed like any other file) -----

for (const name of DATA_V3_FILES) {
  const full = join(dataDir, name);
  if (!existsSync(full)) {
    console.error(
      `missing ${relative(repoRoot, full)} — run package-data-v3.mjs and packaged-stats.mjs first`,
    );
    process.exit(1);
  }
}
writeFileSync(
  join(dataDir, "SHA256SUMS"),
  DATA_V3_FILES.map(
    (name) => `${sha256sum(join(dataDir, name))}  ${name}`,
  ).join("\n") + "\n",
  "utf8",
);

const dataV3Group = buildGroup(
  "docs/research/observability-workflow-audit/data-v3",
  [...DATA_V3_FILES.map((n) => join(dataDir, n)), join(dataDir, "SHA256SUMS")],
);

const protocolsGroup = buildGroup(
  "docs/research/observability-workflow-audit (PROTOCOL variants)",
  Object.values(PROTOCOL_FILES).filter((f) => existsSync(f)),
);

// --- protocol pin verification (content calibre = revision-log section excluded)

const configs = JSON.parse(
  execFileSync(
    "cat",
    [join(repoRoot, "scripts", "perf", "otel-workflows", "configs.json")],
    {
      encoding: "utf8",
    },
  ),
);

const pinnedProtocolVersion = configs.protocol.version;
const pinnedProtocolSha = configs.protocol.sha256;
const v4ContentSha = execFileSync("sha256sum", ["-"], {
  encoding: "utf8",
  input: execFileSync(
    "awk",
    [
      "/^### 修订日志$/{exit} {print}",
      relative(repoRoot, PROTOCOL_FILES["PROTOCOL-v4.md"]),
    ],
    { encoding: "utf8", cwd: repoRoot },
  ),
})
  .trim()
  .split(/\s+/)[0];
const protocolPin = {
  manifest: "scripts/perf/otel-workflows/configs.json",
  pinnedVersion: pinnedProtocolVersion,
  pinnedSha256: pinnedProtocolSha,
  calibre:
    "content hash: trailing '### 修订日志' section excluded (awk '/^### 修订日志$/{exit} {print}' | sha256sum)",
  recomputedSha256: v4ContentSha,
  match: v4ContentSha === pinnedProtocolSha,
};

// --- local raw groups --------------------------------------------------------

const localRawGroups = {
  v3: {
    ...buildGroup(RAW_ROOTS.v3, listFiles(join(repoRoot, RAW_ROOTS.v3))),
    regenerate: [
      "node scripts/perf/otel-workflows/runner.js selftest",
      "node scripts/perf/otel-workflows/runner.js pilot --config H1",
      "node scripts/perf/otel-workflows/runner.js campaign --suite isolated",
      "node scripts/perf/otel-workflows/runner.js campaign --suite knee",
      "node scripts/perf/otel-workflows/runner.js equivalence [--rounds N]",
      "node scripts/perf/otel-workflows/runner.js w09 --config H1 --pool N --delay-seconds S",
      "node scripts/perf/otel-workflows/b4-race-test.mjs --label L --expect-violations true|false [--concurrency C]",
      "node scripts/perf/otel-workflows/runner.js profile --config X --out <dir>",
      "node scripts/perf/otel-workflows/runner.js aggregate",
      "node scripts/perf/otel-workflows/package-data-v3.mjs   # → docs/…/data-v3/",
    ],
    regenerateNotes:
      "DB lifecycle via repository semantic commands (pnpm db:up, testing.md §2.8 worker-DB family exam_e2e_w964/w150); real sampling (Stage D–G) separately authorized. This cycle: mixed suite was gate-rejected (H0 §6.6-3 register not finalized), isolated died in the host Docker shutdown window, knee produced 1 valid segment (see data-v3/campaign-summary.json).",
  },
  v1: {
    ...buildGroup(RAW_ROOTS.v1, listFiles(join(repoRoot, RAW_ROOTS.v1))),
    regenerate: [
      "historical PROTOCOL.md/PROTOCOL-v2 sessions (v1-era configs.json); the raw root is read-only since the v3 partition and is NOT directly reproducible from the current configs.json",
    ],
    regenerateNotes:
      "45 recorded segments, 0 valid (PERFORMANCE-REPORT §2–§8); retained verbatim, never re-adjudicated (PROTOCOL-v4 partition discipline).",
  },
  scratch: {
    parts: [
      buildGroup(
        RAW_ROOTS.scratchV1Copy,
        listFiles(join(repoRoot, RAW_ROOTS.scratchV1Copy)),
      ),
      buildGroup(
        RAW_ROOTS.scratchH0Pilot,
        listFiles(join(repoRoot, RAW_ROOTS.scratchH0Pilot)),
      ),
    ],
    regenerateNotes:
      "accidental nested copy of v1 rounds (out/out) and a draft H0 pilot attempt (out/pilot-h0); draft state, not evidence; registered for inventory completeness only",
  },
};

const manifest = {
  generatedAt: new Date().toISOString(),
  generator: "scripts/perf/otel-workflows/gen-evidence-manifest.mjs",
  hashTool: "sha256sum",
  gitHead: execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim(),
  reviewable: {
    meaning:
      "files delivered inside the PR; verifiable by any reviewer without the producing machine",
    dataV3: dataV3Group,
    dataV3Verify:
      "cd docs/research/observability-workflow-audit/data-v3 && sha256sum -c SHA256SUMS",
    dataV3StatsRecompute:
      "node scripts/perf/otel-workflows/packaged-stats.mjs --check   # byte-identical reproduction from segments.jsonl + campaign-summary.json",
    dataV3SanitizationAssert:
      'grep -RnE --exclude=README.md "/home/|file://|postgres(ql)?://|PASSWORD|SECRET|Bearer " docs/research/observability-workflow-audit/data-v3/   # expect zero hits (README self-references the command text)',
    protocols: protocolsGroup,
    protocolPin,
  },
  localRaw: {
    meaning:
      "gitignored raw evidence under out/ (.gitignore:77) — NOT verifiable from the PR; recorded here as local path + sha256 + regeneration command at packaging time (R2-09 dual inventory)",
    machineRoot: "/home/hoo/Source/exam-otel-audit",
    machineRootNote:
      "paths in this section are repo-root-relative; prepend this root on the producing machine",
    groups: localRawGroups,
  },
  excluded: {
    fileCount: 0,
    reason:
      "nothing excluded: the dual inventory registers every file (v1+raw logs included under localRaw). The previous single-sided manifest excluded raw logs; R2-09 closure replaces that with full local registration + packaged reviewable digests.",
  },
  notes: [
    "Reviewable part: data-v3/ is the sanitized, hash-anchored package of out/otel-w964/workflow-audit-v3/ (73 segment summaries, 8 valid / 65 invalid at packaging time); regeneration chain = package-data-v3.mjs → packaged-stats.mjs → gen-evidence-manifest.mjs.",
    "data-v3/ is hash-anchored identity evidence (SHA256SUMS pins exact bytes) and is therefore listed in .prettierignore — same class as the EXAM-668 / exam-secure-observability precedent entries.",
    "Formal judgment remains UNKNOWN: aggregate rows=[], campaign validPaired mixed/isolated/knee = 0/0/0 (n=0 < 6, PROTOCOL §6.4); the single valid knee segment is recon-grade, never a budget verdict.",
    "All numbers are WSL2 exploration-grade (PROTOCOL §2): mechanism attribution only, never production capacity.",
  ],
};

writeFileSync(outputFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

console.log(`wrote ${relative(repoRoot, outputFile)}`);
console.log(
  `reviewable dataV3=${dataV3Group.fileCount} protocols=${protocolsGroup.fileCount}; ` +
    `localRaw v3=${localRawGroups.v3.fileCount} v1=${localRawGroups.v1.fileCount} ` +
    `scratch=${localRawGroups.scratch.parts.reduce((s, p) => s + p.fileCount, 0)}; ` +
    `protocolPin match=${protocolPin.match}`,
);
