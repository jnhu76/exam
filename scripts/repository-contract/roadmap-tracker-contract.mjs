#!/usr/bin/env node
/**
 * Roadmap tracker pointer contract (#614 G5 guard 1).
 *
 * Relation checked: every active surface that names the CURRENT roadmap
 * tracker points at the SAME issue, and (when GitHub is reachable) that issue
 * is OPEN and titled as the current roadmap.
 *
 * Canonical owner: the "Active roadmap tracker" authority row in
 * docs/README.md. All other surfaces must agree with it.
 *
 * Historical failure caught (issue #611 R1): all seven active surfaces kept
 * pointing at the CLOSED #552 tracker after its successor opened — the
 * documented first step of the agent workflow landed on a dead issue.
 *
 * Negative controls: surfaces may still mention the predecessor tracker as
 * historical context (successor sentences); only the CURRENT-pointer lines
 * are constrained. Commit distance and issue age are never consulted.
 *
 * Usage: node scripts/repository-contract/roadmap-tracker-contract.mjs [root]
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = process.argv[2]
  ? join(process.argv[2])
  : join(import.meta.dirname, "../..");
const errors = [];
const notes = [];

const read = (rel) => readFileSync(join(ROOT, rel), "utf-8");

// ── Canonical tracker number: docs/README.md authority row ──
let canonical = null;
{
  const readme = read("docs/README.md");
  const m = readme.match(
    /Active roadmap tracker; currently GitHub Issue \[#(\d+)\]/,
  );
  if (!m) {
    errors.push(
      "docs/README.md: no 'Active roadmap tracker; currently GitHub Issue [#N]' authority row found",
    );
  } else {
    canonical = m[1];
  }
}

const surfaces = [
  {
    file: "docs/README.md",
    pattern: /Active roadmap tracker; currently GitHub Issue \[#(\d+)\]/,
  },
  {
    file: "docs/roadmap/current.md",
    pattern:
      /Current sequencing and disposition live in GitHub Issue\s*\n?>\s*\[#(\d+)\]/,
  },
  {
    file: "docs/roadmap/post-mvp-issues.md",
    pattern: /sequencing and disposition authority is\s*\n?>?\s*\[#(\d+)\]/,
  },
  { file: "CONTRIBUTING.md", pattern: /currently \[#(\d+)\]/ },
  { file: "README.md", pattern: /sequenced by \[#(\d+)\]/ },
  { file: "README.zh-CN.md", pattern: /由 \[#(\d+)\]/ },
];

for (const { file, pattern } of surfaces) {
  if (canonical === null) break;
  if (!existsSync(join(ROOT, file))) {
    errors.push(`${file}: required tracker surface is missing`);
    continue;
  }
  const m = read(file).match(pattern);
  if (!m) {
    errors.push(
      `${file}: no current-tracker pointer line found (expected a pointer matching the canonical form)`,
    );
  } else if (m[1] !== canonical) {
    errors.push(
      `${file}: current-tracker pointer names #${m[1]} but the canonical tracker is #${canonical}`,
    );
  }
}

// ── Live issue-state check (best effort; skipped without gh/remote) ──
// Commit distance is never used; the only staleness oracle is GitHub itself.
if (canonical !== null && errors.length === 0) {
  let remote = null;
  try {
    remote = execFileSync("git", ["remote", "get-url", "origin"], {
      cwd: ROOT,
      encoding: "utf8",
    }).trim();
  } catch {
    notes.push("no git remote — live issue-state check SKIPPED");
  }
  const repo = remote?.match(/github\.com[:/]+([^/]+\/[^/.]+?)(\.git)?$/)?.[1];
  let gh = true;
  try {
    execFileSync("gh", ["--version"], { encoding: "utf8" });
  } catch {
    gh = false;
    notes.push("gh CLI unavailable — live issue-state check SKIPPED");
  }
  if (gh && repo) {
    try {
      const out = execFileSync(
        "gh",
        [
          "api",
          `repos/${repo}/issues/${canonical}`,
          "--jq",
          '.state + "\\t" + .title',
        ],
        { encoding: "utf8", timeout: 30_000 },
      ).trim();
      const [state, ...title] = out.split("\t");
      if (state !== "open") {
        errors.push(
          `GitHub issue #${canonical} (the current roadmap tracker) is ${state}, not open — the tracker pointer is stale`,
        );
      } else if (!title.join("\t").includes("[ROADMAP][CURRENT]")) {
        errors.push(
          `GitHub issue #${canonical} is open but not titled [ROADMAP][CURRENT] ("${title.join("\t")}") — it is not the roadmap tracker`,
        );
      }
    } catch (e) {
      notes.push(
        `GitHub API unreachable — live issue-state check SKIPPED (${e.message.split("\n")[0]})`,
      );
    }
  }
}

if (errors.length > 0) {
  console.error("FAIL: roadmap tracker pointer contract:");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
for (const n of notes) console.log(`NOTE: ${n}`);
console.log(`PASS: roadmap tracker pointer contract upheld (#${canonical}).`);
