#!/usr/bin/env node
/**
 * Roadmap tracker pointer contract.
 *
 * Relation checked: every active surface that names the CURRENT roadmap
 * tracker points at the SAME issue, and — live — that issue is OPEN and
 * titled [ROADMAP][CURRENT]. Surface agreement alone is not the contract:
 * the historical failure had every active surface agreeing on a tracker
 * that was already CLOSED.
 *
 * Canonical owner: the "Active roadmap tracker" authority row in
 * docs/README.md. All other surfaces must agree with it. No issue number is
 * hardcoded and no local closed-issue table is kept — GitHub itself is the
 * only staleness oracle.
 *
 * Historical failure caught (issue #611 R1): every active surface kept
 * pointing at the CLOSED #552 tracker after its successor opened — the
 * documented first step of the agent workflow landed on a dead issue.
 *
 * Live-oracle execution modes:
 *   - CI (CI=true / GITHUB_ACTIONS=true): the live state/title check MUST
 *     run. If it cannot (no remote, no gh, API failure), the guard FAILS
 *     rather than silently claiming the full contract passed.
 *   - Local/offline: a clearly reported SKIP is allowed.
 *   - Authentication comes from the environment (GH_TOKEN); the workflow
 *     provides it from github.token.
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
import { pathToFileURL } from "node:url";

/**
 * Pure live-oracle decision over `gh api repos/N/issues/M --jq
 * '.state + "\t" + .title'` output. Returns null when the issue can be the
 * current roadmap tracker (open + [ROADMAP][CURRENT] title), otherwise the
 * contract violation. Exported for deterministic negative-control tests.
 */
export function judgeTrackerIssue(ghOut, issueNumber) {
  const [state, ...title] = ghOut.trim().split("\t");
  if (state !== "open") {
    return `GitHub issue #${issueNumber} (the current roadmap tracker) is ${state || "<no state>"}, not open — the tracker pointer is stale`;
  }
  if (!title.join("\t").includes("[ROADMAP][CURRENT]")) {
    return `GitHub issue #${issueNumber} is open but not titled [ROADMAP][CURRENT] ("${title.join("\t")}") — it is not the roadmap tracker`;
  }
  return null;
}

/**
 * Runs the live state/title oracle. Returns
 *   { verdict: "pass" } | { verdict: "fail", message } |
 *   { verdict: "skip", reason } (environment could not run the oracle).
 */
function verifyTrackerIssueLive(ROOT, canonical) {
  let remote;
  try {
    remote = execFileSync("git", ["remote", "get-url", "origin"], {
      cwd: ROOT,
      encoding: "utf8",
    }).trim();
  } catch {
    return { verdict: "skip", reason: "no git remote" };
  }
  const repo = remote.match(/github\.com[:/]+([^/]+\/[^/.]+?)(\.git)?$/)?.[1];
  if (!repo) {
    return {
      verdict: "skip",
      reason: `origin is not a GitHub remote (${remote})`,
    };
  }
  try {
    execFileSync("gh", ["--version"], { encoding: "utf8" });
  } catch {
    return { verdict: "skip", reason: "gh CLI unavailable" };
  }
  let out;
  try {
    out = execFileSync(
      "gh",
      [
        "api",
        `repos/${repo}/issues/${canonical}`,
        "--jq",
        '.state + "\\t" + .title',
      ],
      { encoding: "utf8", timeout: 30_000 },
    );
  } catch (e) {
    return {
      verdict: "skip",
      reason: `GitHub API unreachable (${String(e.message).split("\n")[0]})`,
    };
  }
  const message = judgeTrackerIssue(out, canonical);
  return message ? { verdict: "fail", message } : { verdict: "pass" };
}

function main() {
  const ROOT = process.argv[2]
    ? join(process.argv[2])
    : join(import.meta.dirname, "../..");
  const IN_CI =
    process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true";
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

  // ── Live issue-state oracle (state = open, title = [ROADMAP][CURRENT]) ──
  if (canonical !== null && errors.length === 0) {
    const live = verifyTrackerIssueLive(ROOT, canonical);
    if (live.verdict === "fail") {
      errors.push(live.message);
    } else if (live.verdict === "skip") {
      if (IN_CI) {
        errors.push(
          `live roadmap oracle could not run in CI (${live.reason}) — refusing to pass without verifying that the canonical tracker is OPEN and titled [ROADMAP][CURRENT]`,
        );
      } else {
        notes.push(`live issue-state check SKIPPED (${live.reason})`);
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
}

const isMain =
  !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) main();
