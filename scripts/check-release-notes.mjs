// Release-notes prose gate.
//
// WHY: GitHub renders release bodies with a hard line break on every
// newline, so hand-wrapped prose publishes as stacked short lines hugging
// the left edge and splits link sequences mid-sentence (verified on the
// published v0.0.1..v0.0.16 release pages). The formatting authority for
// `docs/releases/**/*.md` is the prettier override (`proseWrap: "never"`,
// see .prettierrc + .prettierignore) used by `pnpm format`/`format:check`;
// this script is the dependency-free enforcement point that release.yml
// runs before any build or publish step, so a bad notes file can never
// reach `gh release create` even without a node_modules install.
//
// INVARIANT: the gate only detects, never rewrites. Intentional hard
// breaks (a trailing backslash or two trailing spaces) are allowed;
// fenced code, tables, headings and list structure are exempt.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_DIR = path.join(REPO_ROOT, "docs", "releases");

const VERSION_FILE = /^v(\d+)\.(\d+)\.(\d+)\.md$/;
const FENCE = /^ *( {0,3})(`{3,}|~{3,})(.*)$/;
const HEADING = /^ {0,3}#{1,6}(?:\s|#*$)/;
const TABLE_ROW = /^ *\|/;
const THEMATIC_BREAK = /^ {0,3}([-*_])(?: *\1){2,} *$/;
const LIST_MARKER = /^ *([-*+]|\d{1,9}[.)]) /;
const HARD_BREAK = /(?: {2,}|\\)$/;

function isBlank(line) {
  return /^\s*$/.test(line);
}

/**
 * Scan one release-notes document for hard-wrapped prose.
 *
 * Returns violations as `{ line, message }` (1-based line numbers). A
 * violation is any prose line that continues the previous line inside the
 * same paragraph or list item without an intentional hard-break marker,
 * because GitHub will render that newline as a visible line break.
 */
export function checkReleaseNotes(markdown, sourceName) {
  const violations = [];
  const lines = markdown.split("\n");
  let inFence = false;
  let fenceMarker = null;
  let prevWasProse = false;
  let prevHadHardBreak = false;

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i].replace(/\r$/, "");
    const line = i + 1;

    const fence = FENCE.exec(raw);
    if (fence) {
      if (inFence) {
        const closes =
          fenceMarker !== null &&
          fence[2][0] === fenceMarker[0] &&
          fence[2].length >= fenceMarker.length &&
          fence[3].trim() === "";
        if (closes) {
          inFence = false;
          fenceMarker = null;
        }
      } else {
        inFence = true;
        fenceMarker = fence[2];
      }
      prevWasProse = false;
      prevHadHardBreak = false;
      continue;
    }
    if (inFence) {
      continue; // code blocks keep their original line structure
    }

    if (
      isBlank(raw) ||
      HEADING.test(raw) ||
      TABLE_ROW.test(raw) ||
      THEMATIC_BREAK.test(raw)
    ) {
      prevWasProse = false;
      prevHadHardBreak = false;
      continue;
    }

    if (LIST_MARKER.test(raw)) {
      // The marker line carries the item's first prose line, so a wrapped
      // continuation on the next line must still be flagged.
      prevWasProse = true;
      prevHadHardBreak = HARD_BREAK.test(raw);
      continue;
    }

    if (!prevWasProse && /^ {4,}/.test(raw)) {
      // Indented code block (only a block start after a blank line).
      continue;
    }

    if (prevWasProse && !prevHadHardBreak) {
      violations.push({
        line,
        message: `${sourceName}:${line}: SOFT_WRAPPED_PROSE — line ${line} hard-wraps the paragraph or list item started above; GitHub renders release-body newlines as line breaks, so unwrap the prose (keep intentional breaks as a trailing "\\" or two spaces)`,
      });
    }

    prevWasProse = true;
    prevHadHardBreak = HARD_BREAK.test(raw);
  }

  return violations;
}

/**
 * List version-shaped release notes in a directory, sorted by version.
 */
export function listReleaseNoteFiles(dir) {
  const version = (name) => {
    const match = VERSION_FILE.exec(name);
    if (!match) {
      return null;
    }
    return match.slice(1).map((part) => Number.parseInt(part, 10));
  };
  return readdirSync(dir)
    .map((name) => ({ name, key: version(name) }))
    .filter((entry) => entry.key !== null)
    .sort((a, b) => {
      for (let i = 0; i < 3; i += 1) {
        if (a.key[i] !== b.key[i]) {
          return a.key[i] - b.key[i];
        }
      }
      return a.name.localeCompare(b.name);
    })
    .map((entry) => path.join(dir, entry.name));
}

function usage() {
  return "usage: node scripts/check-release-notes.mjs [--dir <docs/releases path>]";
}

function main(argv) {
  let dir = DEFAULT_DIR;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--dir" && i + 1 < argv.length) {
      dir = argv[i + 1];
      i += 1;
    } else {
      process.stderr.write(`unknown argument: ${argv[i]}\n${usage()}\n`);
      process.exit(2);
    }
  }

  let files;
  try {
    files = listReleaseNoteFiles(dir);
  } catch (error) {
    // Fail closed: an unreadable release-notes directory is a gate failure.
    process.stderr.write(`cannot list ${dir}: ${error.message}\n`);
    process.exit(1);
  }
  if (files.length === 0) {
    process.stderr.write(`no docs/releases/vX.Y.Z.md files found in ${dir}\n`);
    process.exit(1);
  }

  const violations = [];
  for (const file of files) {
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch (error) {
      process.stderr.write(`cannot read ${file}: ${error.message}\n`);
      process.exit(1);
    }
    violations.push(
      ...checkReleaseNotes(text, path.relative(REPO_ROOT, file) || file),
    );
  }

  if (violations.length > 0) {
    process.stderr.write(
      `Release notes prose violations:\n${violations.map((v) => v.message).join("\n")}\n`,
    );
    process.exit(1);
  }

  process.stdout.write(
    `Release notes prose checks passed (${files.length} files under ${path.relative(REPO_ROOT, dir) || dir}).\n`,
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main(process.argv.slice(2));
}
