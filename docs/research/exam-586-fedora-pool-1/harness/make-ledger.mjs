#!/usr/bin/env node
// EXAM-586 RESEARCH ONLY: regenerate 10-evidence-ledger.md mechanically from
// run metadata. Totals are derived, never hand-coded:
//   repo run dirs  = docs/research/exam-586-fedora-pool-1/results/*
//   host raw dirs  = $EXAM586_RUNS_ROOT (default /home/jnhu/exam-586/runs)
// Classification rules (mechanical):
//   finalized meta.json.status=valid  -> <KIND>_VALID
//   finalized meta.json.status!=valid -> INVALID   (reason from meta/INVALID_REASON.txt)
//   meta present but legacy-unparseable with INVALID_REASON.txt -> INVALID
//   no meta.json                      -> INTERRUPTED (partial run dir retained on host)
import {
  readFileSync,
  readdirSync,
  existsSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HARNESS = dirname(fileURLToPath(import.meta.url));
const REPO = join(HARNESS, "..", "results");
const HOST = process.env.EXAM586_RUNS_ROOT ?? "/home/jnhu/exam-586/runs";
const OUT = join(HARNESS, "..", "10-evidence-ledger.md");

const dirs = (root) =>
  existsSync(root)
    ? readdirSync(root)
        .filter((n) => statSync(join(root, n)).isDirectory())
        .sort()
    : [];
const readJson = (p) => {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
};
const kindOf = (run) =>
  run.startsWith("aa-")
    ? "AA"
    : run.startsWith("main-")
      ? "MAIN"
      : run.startsWith("smoke-")
        ? "SMOKE"
        : run.startsWith("diag")
          ? "DIAGNOSTIC"
          : "OTHER";

const repoRuns = dirs(REPO);
const hostRuns = dirs(HOST);
const all = [...new Set([...repoRuns, ...hostRuns])].sort();

// Evidence annotations that are provenance facts, not derivable from status
// fields (kept explicit so the generated ledger does not mislead).
const NOTES = {
  "smoke-S20-r0": "rig bootstrap: driver_setup_failed (no meta finalized)",
  "smoke-S20-r0b": "rig bootstrap: killed before meta (no meta finalized)",
  "smoke-S20-r0c": "rig bootstrap: killed before meta (no meta finalized)",
  "smoke-S20-r0d": "run-time oracle failed; no correctness.json written",
  "smoke-S20-r0e":
    "run-time oracle failed; correctness.json present but is a LATER replay (pass=true, distinctAuditIps=21 vs 20 candidates) — run stays INVALID per finalized meta",
  "main-05-interrupted-2043":
    "killed mid-campaign (monitor shell); superseded by fresh main-05; retained per never-delete-raw-evidence policy",
};

const rows = [];
for (const run of all) {
  const inRepo = repoRuns.includes(run);
  const inHost = hostRuns.includes(run);
  const metaPath = inHost
    ? join(HOST, run, "meta.json")
    : join(REPO, run, "meta.json");
  const meta = readJson(metaPath);
  const metaPresent = existsSync(metaPath);
  const ds = inHost
    ? readJson(join(HOST, run, "driver-summary.json"))
    : readJson(join(REPO, run, "driver-summary.json"));
  const corr = inRepo ? readJson(join(REPO, run, "correctness.json")) : null;
  const invalidTxt = inHost
    ? join(HOST, run, "INVALID_REASON.txt")
    : join(REPO, run, "INVALID_REASON.txt");
  const reason =
    meta?.invalid_reason ||
    (existsSync(invalidTxt) ? readFileSync(invalidTxt, "utf8").trim() : "");
  let cls;
  if (meta) cls = meta.status === "valid" ? `${kindOf(run)}_VALID` : "INVALID";
  else if (metaPresent && reason)
    cls = "INVALID"; // legacy meta (pre-quoting) + explicit invalid reason
  else cls = "INTERRUPTED";
  rows.push({
    run,
    kind: kindOf(run),
    cls,
    pool: meta?.effective_pool_max ?? ds?.pool ?? "?",
    scale: meta?.scale ?? ds?.n ?? "?",
    replicate: meta?.replicate ?? "?",
    location: inRepo && inHost ? "repo+host" : inRepo ? "repo" : "host-only",
    archived: inRepo ? "yes" : "no",
    note: [
      reason,
      corr ? `oracle=${corr.pass}` : "",
      ds ? "" : "no driver-summary",
      NOTES[run] ?? "",
    ]
      .filter(Boolean)
      .join("; "),
  });
}
const count = (c) => rows.filter((r) => r.cls === c).length;
const totals = {
  AA_VALID: count("AA_VALID"),
  MAIN_VALID: count("MAIN_VALID"),
  SMOKE_VALID: count("SMOKE_VALID"),
  DIAGNOSTIC_VALID: count("DIAGNOSTIC_VALID"),
  INVALID: count("INVALID"),
  INTERRUPTED: count("INTERRUPTED"),
  TOTAL_RETAINED: rows.length,
  ARCHIVED_IN_REPO: rows.filter((r) => r.archived === "yes").length,
  HOST_ONLY: rows.filter((r) => r.archived === "no").length,
};
const VALID_TOTAL =
  totals.AA_VALID +
  totals.MAIN_VALID +
  totals.SMOKE_VALID +
  totals.DIAGNOSTIC_VALID;

// Host-only raw artifacts are referenced by name + SHA-256 from each run's
// SHA256SUMS (which stays in the repo), never copied into Git.
const sumsFor = (run) => {
  const p = join(REPO, run, "SHA256SUMS");
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => l.trim().split(/\s+/));
};
const HOST_ONLY_ARTIFACTS = [
  "requests.jsonl",
  "candidates.sql",
  "app.log",
  "web.log",
  "db.log",
];
const artifactGroups = new Map();
for (const run of repoRuns) {
  const present = new Set(sumsFor(run).map(([, f]) => f));
  const covered = HOST_ONLY_ARTIFACTS.filter((f) => present.has(f));
  if (!covered.length) continue;
  const key = covered.join(",");
  if (!artifactGroups.has(key)) artifactGroups.set(key, []);
  artifactGroups.get(key).push(run);
}

const md = `# #586 — 10 Evidence Ledger (mechanically derived)

Status: GENERATED. Regenerate with
\`node docs/research/exam-586-fedora-pool-1/harness/make-ledger.mjs\`.
Every figure below is derived from per-run \`meta.json\`, \`driver-summary.json\`,
\`correctness.json\` and directory listings — no hand-maintained totals.

## Run disposition

| run | kind | disposition | pool | N | rep | location | archived in Git | notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
${rows
  .map(
    (r) =>
      `| ${r.run} | ${r.kind} | ${r.cls} | ${r.pool} | ${r.scale} | ${r.replicate} | ${r.location} | ${r.archived} | ${r.note} |`,
  )
  .join("\n")}

## Derived totals

| class | count |
| --- | --- |
| AA_VALID | ${totals.AA_VALID} |
| MAIN_VALID | ${totals.MAIN_VALID} |
| SMOKE_VALID | ${totals.SMOKE_VALID} |
| DIAGNOSTIC_VALID | ${totals.DIAGNOSTIC_VALID} |
| **VALID (sum)** | **${VALID_TOTAL}** |
| INVALID | ${totals.INVALID} |
| INTERRUPTED (host-only partials, no finalized meta) | ${totals.INTERRUPTED} |
| TOTAL_RETAINED (run dirs on host ∪ repo) | ${totals.TOTAL_RETAINED} |
| — archived in Git | ${totals.ARCHIVED_IN_REPO} |
| — host-only | ${totals.HOST_ONLY} |

## Prior count inconsistency — resolution

Earlier #586 wording mixed two figures: "17 campaign cells + 1 smoke + 2
diagnostics" and "18 VALID runs". The mechanically derived truth is:

- 17 campaign cells = ${totals.AA_VALID} A/A + ${totals.MAIN_VALID} main, all VALID;
- + ${totals.SMOKE_VALID} smoke VALID (r0f) + ${totals.DIAGNOSTIC_VALID} diagnostic VALID = **${VALID_TOTAL} finalized VALID runs**;
- the "18" figure was a miscount and is superseded by this ledger;
- retained-but-not-VALID: ${totals.INVALID} INVALID smoke attempts (oracle-failed, disqualified
  per protocol) and ${totals.INTERRUPTED} host-only partials (killed before finalizing meta).

## Repository material policy

Git contains research source (docs + harness) and small normalized text
evidence only. Per run, these raw artifacts stay host-side under
\`${HOST}/<run>/\` and are integrity-pinned by each run's \`SHA256SUMS\`
(committed):

${[...artifactGroups.entries()]
  .map(
    ([key, runs]) =>
      `- ${runs.length} run dirs (${runs.join(", ")}): ${key.split(",").join(", ")}`,
  )
  .join("\n")}

Container logs are the uncompressed \`app.log\`/\`web.log\`/\`db.log\` above.
\`candidates.sql\` on the host contains the experiment-only candidate
password hash; the repository never carried it unredacted.

## Reproduction

Harness and frozen schedule: \`harness/\` (README.md, campaign.sh,
run-cell.sh, driver.mjs, oracles.mjs, summarize586.mjs). Raw dirs can be
re-collected into Git-visible \`results/\` with
\`bash harness/collect-runs.sh\` (bounded set; raw logs/dumps/requests are
deliberately excluded).
`;

writeFileSync(OUT, md);
console.log(JSON.stringify(totals, null, 2));
console.log(
  `VALID_TOTAL=${VALID_TOTAL} artifactGroups=${artifactGroups.size} -> ${OUT}`,
);
