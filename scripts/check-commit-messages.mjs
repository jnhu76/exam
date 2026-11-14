#!/usr/bin/env node
// Commit message gate for pushes and pull requests.
//
// Single rule authority: commitlint.config.mjs (loaded via @commitlint/load).
// This script adds only push-stage policy on top:
//  - fixup!/squash! are rejected (they are local rebase aids only);
//  - integration merge commits whose one parent side is already known to the
//    remote (pre-push) or outside the PR commit set (PR mode) are exempt:
//    they re-introduce already-validated commits and their message is
//    produced by integration tooling ("Merge master into wN for integration
//    CI"), not authored as a formal subject.
//
// Modes:
//   (stdin)             git pre-push, lines `<localRef> <localSha> <remoteRef> <remoteSha>`
//   --pr <number>       GitHub PR title + commits via `gh api` (immune to
//                       shallow clones and local range mistakes)
//   --pr-data <file>    same validation from an offline PR payload JSON:
//                       {"title": "...", "commits":[{"sha","message","parents"}]}
//   --range <a..b>      every commit in an explicit rev range (merge commits
//                       included, no exemption — explicit intent)
//   --title <text>      validate one message string (agent pre-flight)
//
// Spec: docs/standards/commit-messages.md

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";
import lint from "@commitlint/lint";
import load from "@commitlint/load";

export const FIXUP_PATTERN = /^(fixup|squash)!/;

const ZERO_SHA = /^0+$/;
const SHA_40 = /^[0-9a-f]{40}$/;
const RECORD_SEP = "\u001e";
const UNIT_SEP = "\u001f";
const POLICY_HEADER = [
  "required: type(scope): subject",
  "types: feat|fix|refactor|perf|docs|test|build|ci|chore|style|revert",
  "scope: [a-z][a-z0-9-]* · header ≤ 72 chars · fixup!/squash! never pushed",
  "spec: docs/standards/commit-messages.md",
].map((line) => `    ${line}`);

const USAGE = `Usage:
  node scripts/check-commit-messages.mjs                  # pre-push mode (stdin)
  node scripts/check-commit-messages.mjs --pr <number>    # GitHub PR (gh api)
  node scripts/check-commit-messages.mjs --pr-data <file> # offline PR payload
  node scripts/check-commit-messages.mjs --range <a..b>   # explicit rev range
  node scripts/check-commit-messages.mjs --title "<msg>"  # single message
Options:
  --config <path>  explicit commitlint config (default: discovered from cwd)`;

export function isZeroSha(sha) {
  return ZERO_SHA.test(sha);
}

function subjectOf(message) {
  return (message ?? "").split("\n")[0] ?? "";
}

function git(args) {
  return execFileSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

/**
 * Parse pre-push stdin lines. Machine-generated input, so anything malformed
 * fails closed instead of being skipped.
 */
export function parseRefLines(text) {
  const updates = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    const parts = line.split(/\s+/);
    if (
      parts.length !== 4 ||
      !SHA_40.test(parts[1]) ||
      !SHA_40.test(parts[3])
    ) {
      throw new Error(`malformed pre-push input line: ${rawLine}`);
    }
    const [localRef, localSha, remoteRef, remoteSha] = parts;
    updates.push({ localRef, localSha, remoteRef, remoteSha });
  }
  return updates;
}

/** Load the shared commitlint rule set once per invocation. */
export async function createEngine(configPath) {
  const loaded = await load({}, { cwd: process.cwd(), file: configPath });
  return {
    rules: loaded.rules ?? {},
    parserOpts: loaded.parserPreset?.parserOpts ?? {},
    plugins: loaded.plugins ?? {},
    // What the commit-msg hook applies (fixup!/squash! tolerated locally).
    commitTimeIgnores: loaded.ignores ?? [],
  };
}

/**
 * Push/public semantics: identical rule set, but NOTHING is ignored —
 * fixup!/squash! are rejected with a dedicated, self-explaining rule.
 */
export async function lintPushMessage(engine, message) {
  if (FIXUP_PATTERN.test(message)) {
    return {
      valid: false,
      errors: [
        {
          name: "no-fixup-on-push",
          message: "fixup!/squash! commits must be squashed before push",
        },
      ],
      warnings: [],
    };
  }
  return lint(message, engine.rules, {
    parserOpts: engine.parserOpts,
    plugins: engine.plugins,
    ignores: [],
    defaultIgnores: false,
  });
}

/**
 * PR-mode merge exemption (topology, not message shape): a merge commit with
 * at least one parent outside the PR's commit set merges already-landed,
 * already-validated history into the branch. Sibling merges (all parents
 * inside the set) introduce new commits and are validated like any commit.
 */
export function classifyPrCommits(payload) {
  const commits = payload.commits ?? [];
  const inPr = new Set(commits.map((commit) => commit.sha));
  const toCheck = [];
  const skipped = [];
  for (const commit of commits) {
    const parents = commit.parents ?? [];
    const exempt = parents.length >= 2 && parents.some((p) => !inPr.has(p));
    if (exempt) {
      skipped.push(commit);
    } else {
      toCheck.push(commit);
    }
  }
  return { toCheck, skipped };
}

function remoteTrackingTips() {
  return git(["for-each-ref", "--format=%(objectname)", "refs/remotes/"])
    .split("\n")
    .map((sha) => sha.trim())
    .filter(Boolean);
}

/**
 * Pre-push candidates: commits reachable from the pushed tips but from none
 * of the pre-push remote tips (the refs' current remote SHAs plus every
 * remote-tracking ref). Commits already on the server are never re-validated.
 */
function collectPushCandidates(updates) {
  const tips = [
    ...new Set([
      ...updates.filter((u) => !isZeroSha(u.remoteSha)).map((u) => u.remoteSha),
      ...remoteTrackingTips(),
    ]),
  ];
  const reachable = new Set(
    tips.length === 0
      ? []
      : git(["rev-list", ...tips])
          .split("\n")
          .filter(Boolean),
  );
  const shas = new Set();
  for (const update of updates) {
    if (isZeroSha(update.localSha)) {
      continue; // ref deletion
    }
    if (!update.localRef.startsWith("refs/heads/")) {
      continue; // tags carry tag objects, not formal commit subjects
    }
    if (update.localSha === update.remoteSha) {
      continue; // nothing new
    }
    const listed = tips.length
      ? git(["rev-list", update.localSha, "--not", ...tips])
      : git(["rev-list", update.localSha]);
    for (const sha of listed
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)) {
      shas.add(sha);
    }
  }
  return { shas: [...shas], reachable };
}

/** Full messages + parents for explicit SHAs (one git invocation). */
function loadCommits(shas) {
  if (shas.length === 0) {
    return [];
  }
  const out = git([
    "log",
    "--no-walk=unsorted",
    `--format=%H${UNIT_SEP}%P${UNIT_SEP}%B${RECORD_SEP}`,
    ...shas,
  ]);
  return out
    .split(RECORD_SEP)
    .map((chunk) => chunk.replace(/^\n/, ""))
    .filter((chunk) => chunk.trim().length > 0)
    .map((chunk) => {
      const [sha, parents, message] = chunk.split(UNIT_SEP);
      return {
        sha,
        parents: parents.trim().split(/\s+/).filter(Boolean),
        message: (message ?? "").trimEnd(),
      };
    });
}

/** Same topology exemption as PR mode, against the pre-push reachable set. */
function exemptIntegrationMerges(commits, reachable) {
  const toCheck = [];
  const skipped = [];
  for (const commit of commits) {
    const exempt =
      commit.parents.length >= 2 &&
      commit.parents.some((p) => reachable.has(p));
    if (exempt) {
      skipped.push(commit);
    } else {
      toCheck.push(commit);
    }
  }
  return { toCheck, skipped };
}

function commitViolationBlock(commit, result) {
  const lines = [`✖ ${commit.sha.slice(0, 10)}  ${subjectOf(commit.message)}`];
  for (const error of result.errors) {
    lines.push(`    ✖ ${error.message}  [${error.name}]`);
  }
  lines.push(
    FIXUP_PATTERN.test(commit.message)
      ? "    → fix: git rebase -i --autosquash <upstream> (fixup!/squash! are local-only)"
      : '    → fix: git commit --amend -m "type(scope): subject" (or git rebase -i for older commits)',
  );
  return lines.join("\n");
}

async function findCommitViolations(engine, commits) {
  const blocks = [];
  for (const commit of commits) {
    const result = await lintPushMessage(engine, commit.message);
    if (!result.valid) {
      blocks.push(commitViolationBlock(commit, result));
    }
  }
  return blocks;
}

function fail(blocks) {
  const label = blocks.length === 1 ? "violation" : "violations";
  process.stdout.write(
    [
      `✖ commit message policy: ${blocks.length} ${label}`,
      ...POLICY_HEADER,
      "",
      ...blocks,
      "",
    ].join("\n"),
  );
  process.exitCode = 1;
}

async function runPrePush(engine) {
  const stdin = readFileSync(0, "utf8");
  const updates = parseRefLines(stdin);
  const { shas, reachable } = collectPushCandidates(updates);
  const commits = loadCommits(shas);
  const { toCheck, skipped } = exemptIntegrationMerges(commits, reachable);
  for (const merge of skipped) {
    process.stdout.write(
      `ⓘ ${merge.sha.slice(0, 10)}  integration merge skipped (one parent side is already on the remote)\n`,
    );
  }
  const blocks = await findCommitViolations(engine, toCheck);
  if (blocks.length > 0) {
    fail(blocks);
    return;
  }
  process.stdout.write(`✓ ${toCheck.length} new commit(s) conform\n`);
}

async function runRange(engine, range) {
  const shas = git(["rev-list", range]).split("\n").filter(Boolean);
  const blocks = await findCommitViolations(engine, loadCommits(shas));
  if (blocks.length > 0) {
    fail(blocks);
    return;
  }
  process.stdout.write(`✓ ${shas.length} commit(s) conform\n`);
}

async function runTitle(engine, title) {
  const result = await lintPushMessage(engine, title);
  if (!result.valid) {
    const lines = [`✖ title  ${title}`];
    for (const error of result.errors) {
      lines.push(`    ✖ ${error.message}  [${error.name}]`);
    }
    lines.push(
      FIXUP_PATTERN.test(title)
        ? "    → fix: fixup!/squash! prefixes are never valid for public titles"
        : "    → fix: use type(scope): subject",
    );
    fail([lines.join("\n")]);
    return;
  }
  process.stdout.write("✓ title conforms\n");
}

async function runPr(engine, pr) {
  const blocks = [];
  const title = pr.title ?? "";
  const titleResult = await lintPushMessage(engine, title);
  if (!titleResult.valid) {
    const lines = [`✖ PR title  ${title}`];
    for (const error of titleResult.errors) {
      lines.push(`    ✖ ${error.message}  [${error.name}]`);
    }
    lines.push("    → fix: rename the pull request to type(scope): subject");
    blocks.push(lines.join("\n"));
  }
  const { toCheck, skipped } = classifyPrCommits(pr);
  for (const merge of skipped) {
    process.stdout.write(
      `ⓘ ${merge.sha.slice(0, 10)}  integration merge skipped (one parent side is outside the PR)\n`,
    );
  }
  blocks.push(...(await findCommitViolations(engine, toCheck)));
  if (blocks.length > 0) {
    fail(blocks);
    return;
  }
  process.stdout.write(`✓ PR title + ${toCheck.length} commit(s) conform\n`);
}

function ghJson(args) {
  return JSON.parse(
    execFileSync("gh", args, {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      env: process.env,
    }),
  );
}

function fetchPr(number) {
  const slug =
    process.env.GITHUB_REPOSITORY ??
    execFileSync(
      "gh",
      ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"],
      { encoding: "utf8" },
    ).trim();
  const pr = ghJson(["api", `repos/${slug}/pulls/${number}`]);
  const commits = ghJson([
    "api",
    "--paginate",
    `repos/${slug}/pulls/${number}/commits?per_page=100`,
  ]);
  return {
    title: pr.title,
    commits: commits.map((commit) => ({
      sha: commit.sha,
      message: commit.commit.message,
      parents: (commit.parents ?? []).map((parent) => parent.sha),
    })),
  };
}

function parseArgs(argv) {
  const options = {
    config: undefined,
    pr: undefined,
    prData: undefined,
    range: undefined,
    title: undefined,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined) {
        throw new Error(`${arg} requires a value`);
      }
      i += 1;
      return value;
    };
    if (arg === "--config") {
      options.config = next();
    } else if (arg === "--pr") {
      options.pr = next();
    } else if (arg === "--pr-data") {
      options.prData = next();
    } else if (arg === "--range") {
      options.range = next();
    } else if (arg === "--title") {
      options.title = next();
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`unknown option: ${arg}`);
    }
  }
  return options;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  const engine = await createEngine(options.config);
  if (options.title !== undefined) {
    await runTitle(engine, options.title);
  } else if (options.pr !== undefined) {
    await runPr(engine, fetchPr(options.pr));
  } else if (options.prData !== undefined) {
    await runPr(engine, JSON.parse(readFileSync(options.prData, "utf8")));
  } else if (options.range !== undefined) {
    await runRange(engine, options.range);
  } else {
    if (process.stdin.isTTY) {
      process.stdout.write(`${USAGE}\n`);
      process.exitCode = 1;
      return;
    }
    await runPrePush(engine);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
