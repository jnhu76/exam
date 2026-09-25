#!/usr/bin/env node
/**
 * Verification-marker contract.
 *
 * Relation checked: every "Last verified against (commit):" marker in an
 * ACTIVE doc must (a) name a SHA that resolves to a real commit in this
 * repository — the SHA must sit on the marker line itself or on the
 * immediate marker value line that follows — or carry an explicit "not
 * pinned" declaration, AND (b) state a current-vs-historical disposition (a
 * verification scope / snapshot / historical note) near the marker.
 *
 * Historical failure caught (issue #611 CD-04 / REC-05): the exam-system doc
 * set shared one stale verification lineage with no disposition, so its
 * delivery-state claims silently drifted for hundreds of commits.
 *
 * NOT checked (deliberately): commit distance from HEAD. Age alone is never
 * semantic staleness; a dated historical snapshot with a disposition is
 * valid.
 *
 * Usage: node scripts/repository-contract/verification-marker-contract.mjs [root]
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = process.argv[2]
  ? join(process.argv[2])
  : join(import.meta.dirname, "../..");
const DOC_ROOT = join(ROOT, "docs");
const SKIP_DIRS = new Set(["archive", "research", "node_modules"]);
const MARKER = /Last (?:runtime )?verified against(?::| commit:)/i;
const SHA = /\b[0-9a-f]{7,40}\b/i;
const DISPOSITION =
  /verification scope|point-in-time|snapshot|historical|re-verified|retain|not pinned/i;

const errors = [];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue;
      walk(p, out);
    } else if (entry.endsWith(".md")) {
      out.push(p);
    }
  }
  return out;
}

const resolvable = (sha) => {
  try {
    execFileSync(
      "git",
      ["rev-parse", "--verify", "--quiet", `${sha}^{commit}`],
      {
        cwd: ROOT,
        stdio: "pipe",
      },
    );
    return true;
  } catch {
    return false;
  }
};

const hasGit = existsSync(join(ROOT, ".git"));

const files = existsSync(DOC_ROOT) ? walk(DOC_ROOT) : [];
for (const file of files) {
  const rel = file.slice(ROOT.length + 1);
  const text = readFileSync(file, "utf-8");
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!MARKER.test(lines[i])) continue;
    // The marker block: the label line plus the following lines up to a
    // blank-line-then-non-list boundary or a fence end (~12 lines window).
    const block = lines.slice(i, i + 12).join("\n");

    if (!DISPOSITION.test(block)) {
      errors.push(
        `${rel}:${i + 1}: verification marker carries no current-vs-historical disposition (add a verification scope / snapshot / historical note)`,
      );
    }

    // The SHA must sit on the marker line itself or on the immediate marker
    // value line that follows (two-line form) — never an arbitrary hex token
    // picked from the surrounding disposition prose.
    const sha = lines[i].match(SHA)?.[0] ?? lines[i + 1]?.match(SHA)?.[0];
    if (!sha) {
      if (!/not pinned/i.test(block)) {
        errors.push(
          `${rel}:${i + 1}: marker names no commit SHA and no explicit "not pinned" declaration`,
        );
      }
      continue;
    }
    if (hasGit && !resolvable(sha)) {
      errors.push(
        `${rel}:${i + 1}: marker SHA ${sha} does not resolve to a commit in this repository`,
      );
    }
  }
}

if (errors.length > 0) {
  console.error("FAIL: verification marker contract:");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(
  `PASS: verification marker contract upheld (${files.length} docs scanned).`,
);
