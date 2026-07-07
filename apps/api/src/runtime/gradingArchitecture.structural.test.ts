import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// P3-L0-2E Slice 5 — Durable Grading Workset Architecture regression closure.
//
// These are STRUCTURAL architecture tests. They lock the accepted grading-truth
// graph against future regression by scanning PRODUCTION source text (never
// test files, never dist/ builds, never the frontend):
//
//   frozen submitted_answers + frozen QuestionSnapshot
//           ↓
//   submitAttempt
//           ↓
//   attempt_grading_entries
//           ├── completed_auto
//           └── pending_manual → completed_manual
//           ↓
//   aggregateGradingEntries
//           ↓
//   attempt.gradingResult / attempt.score / attempt.passed
//
// Accepted invariants locked here:
//   - submitAttempt exclusively owns grading workset materialization
//   - aggregateGradingEntries is the single terminal score authority
//   - attempt.gradingResult is a terminal projection ONLY (never scoring input)
//   - deleted reconciliation logic (reconcileScores, reconstructObjectiveScore,
//     buildAutoGradingAnswers, persistedByQuestion) stays deleted
//
// Style mirrors apps/api/src/runtime/time-authority.structural.test.ts: scan
// source text over a fixed set of directories, fail closed on any violation
// outside a short reason-documented allowlist. A future regression that
// reintroduces a second materialization caller, a second terminal authority, or
// deleted reconciliation semantics turns one of these tests RED.

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");

/** Directories scanned for grading-architecture regressions. Production only. */
const SCAN_DIRS = [
  "apps/api/src/routes",
  "apps/api/src/plugins",
  "apps/api/src/orchestrators",
  "apps/api/src/adapters",
  "packages/exam-engine/src",
  "packages/domain/src",
  "packages/db/src/repository",
];

/** Exclude test files, type declarations, dist builds, and the frontend. */
function isExcluded(absPath: string): boolean {
  const normalized = absPath.replace(/\\/g, "/");
  return (
    normalized.includes(".test.") ||
    normalized.includes("__tests__") ||
    normalized.endsWith(".d.ts") ||
    normalized.includes("/dist/") ||
    normalized.includes("/apps/web/")
  );
}

/** Recursively collect source files under a directory matching the exts. */
function collectFiles(dirAbs: string, exts: string[]): string[] {
  const entries: string[] = [];
  const stack: string[] = [dirAbs];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    let dirents;
    try {
      dirents = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const d of dirents) {
      const full = join(current, d.name);
      if (d.isDirectory()) {
        stack.push(full);
      } else if (d.isFile() && exts.includes(extname(d.name))) {
        entries.push(full);
      }
    }
  }
  return entries.sort();
}

function toRepoRelative(absPath: string): string {
  return absPath
    .replace(/\\/g, "/")
    .replace(REPO_ROOT.replace(/\\/g, "/") + "/", "");
}

/** Collects all production .ts files under SCAN_DIRS (excluding tests/dist). */
function collectProductionFiles(): string[] {
  const all: string[] = [];
  for (const dir of SCAN_DIRS) {
    const dirAbs = resolve(REPO_ROOT, dir);
    if (!existsSync(dirAbs)) continue;
    for (const file of collectFiles(dirAbs, [".ts"])) {
      if (!isExcluded(file)) all.push(file);
    }
  }
  return all;
}

interface Hit {
  file: string;
  line: number;
  snippet: string;
}

/**
 * Strips comments from a line so structural scans only inspect executable code.
 * Doc/comment references to deprecated patterns are legitimate and must not
 * register as violations. Drops JSDoc continuation lines, block-comment
 * delimiters, full-line slash-slash comments, and trailing inline comments.
 */
function stripComments(line: string): string {
  // JSDoc/block-comment marker lines are entirely documentation — drop them.
  // Built from strings to avoid literal escape ambiguity in source text.
  const jsdocEndOrOpen = new RegExp("^\\s*\\*\\/|^\\s*\\/\\*");
  const jsdocCloseOnly = new RegExp("^\\s*\\*\\/$");
  if (jsdocEndOrOpen.test(line) || jsdocCloseOnly.test(line)) {
    return "";
  }
  // Lines beginning with a JSDoc continuation asterisk — drop the whole line.
  if (new RegExp("^\\s*\\*\\s").test(line)) {
    return "";
  }
  // Drop trailing inline slash-slash comment (preserving code before it).
  const inline = line.match(/^([^"'/]*)\/\/.*$/);
  if (inline) {
    return inline[1] ?? "";
  }
  return line;
}

/**
 * Finds all production source hits matching any of the patterns, ignoring
 * comments so documentation references do not register as violations.
 */
function findInProduction(patterns: RegExp[]): Hit[] {
  const hits: Hit[] = [];
  for (const file of collectProductionFiles()) {
    const text = readFileSync(file, "utf8");
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const code = stripComments(lines[i]!);
      if (!code.trim()) continue;
      for (const pattern of patterns) {
        if (pattern.test(code)) {
          hits.push({
            file: toRepoRelative(file),
            line: i + 1,
            snippet: lines[i]!.trim(),
          });
        }
      }
    }
  }
  return hits;
}

/**
 * Matches invocation sites of `name(` while excluding the function's own
 * declaration line. Comment references are already stripped by findInProduction,
 * so this only needs to skip `export async function name(` and
 * `function name(` declarations.
 */
function invocationCallSites(name: string): RegExp[] {
  return [
    new RegExp(
      `^(?!\\s*(export\\s+)?(async\\s+)?function\\s+${name}\\b)` +
        `.*(?<![\\w.$])${name}\\s*\\(`,
    ),
  ];
}

describe("Slice 5 — Step 2: submitAttempt exclusively owns workset materialization", () => {
  it("materializeGradingWorkset is defined in exactly one production source file", () => {
    // The function must exist (authoritative definition site) and be defined in
    // exactly one production file (gradingWorkset.ts).
    const definitionHits = findInProduction([
      new RegExp(`export\\s+async\\s+function\\s+materializeGradingWorkset\\b`),
    ]);
    expect(definitionHits.length).toBe(1);
    expect(definitionHits[0]!.file).toBe(
      "packages/exam-engine/src/gradingWorkset.ts",
    );
  });

  it("materializeGradingWorkset has exactly ONE production invocation, inside submitAttempt", () => {
    // The authoritative (and only) production caller is submitAttempt in
    // attemptCommands.ts. Any independent invocation from a route, orchestrator,
    // plugin, scanner, or reconciliation module is a forbidden second
    // materialization authority.
    const callSites = findInProduction(
      invocationCallSites("materializeGradingWorkset"),
    );
    expect(callSites).toHaveLength(1);
    expect(callSites[0]!.file).toBe(
      "packages/exam-engine/src/attemptCommands.ts",
    );
    // Defensive: the call must live inside submitAttempt's body, not a sibling
    // function in the same file. Read the file and confirm the enclosing
    // function name.
    const text = readFileSync(
      resolve(REPO_ROOT, "packages/exam-engine/src/attemptCommands.ts"),
      "utf8",
    );
    const callLine = callSites[0]!.line;
    const lines = text.split(/\r?\n/);
    // Walk upward from the call to find the enclosing `export async function`.
    let enclosing: string | null = null;
    for (let i = callLine - 1; i >= 0; i--) {
      const m = lines[i]!.match(/export\s+async\s+function\s+(\w+)\s*\(/);
      if (m) {
        enclosing = m[1]!;
        break;
      }
    }
    expect(enclosing).toBe("submitAttempt");
  });

  it("no forbidden production caller invokes materializeGradingWorkset independently", () => {
    // Routes, orchestrators, plugins (deadline scanner), and reconciliation
    // must NOT materialize worksets themselves — they must go through
    // submitAttempt. This test fails if any such file adds a direct call.
    const forbiddenFileSubstrings = [
      "/routes/",
      "/orchestrators/",
      "/plugins/",
      "deadlineReconciliation",
      "deadlineScanner",
      "attempts.admin",
      "submitAndGradeAttempt",
    ];
    const callSites = findInProduction(
      invocationCallSites("materializeGradingWorkset"),
    );
    const forbidden = callSites.filter((hit) =>
      forbiddenFileSubstrings.some((s) => hit.file.includes(s)),
    );
    expect(forbidden).toEqual([]);
  });
});

describe("Slice 5 — Step 3: gradingResult cannot become scoring input", () => {
  it("aggregateGradingEntries is the single terminal score authority (exactly 2 production call sites)", () => {
    // Two terminal paths flow through ONE aggregation seam:
    //   1. finalizeGrading (pure-objective: submit/deadline/force-submit)
    //   2. gradeQuestion manual terminal branch (manual/mixed completion)
    // Any third production caller would be a second terminal authority.
    const callSites = findInProduction(
      invocationCallSites("aggregateGradingEntries"),
    );
    expect(callSites).toHaveLength(2);
    const files = callSites.map((h) => h.file).sort();
    expect(files).toEqual([
      "packages/exam-engine/src/grading.ts",
      "packages/exam-engine/src/manualGrading.ts",
    ]);
  });

  it("deleted reconciliation functions stay deleted from production", () => {
    // reconcileScores, reconstructObjectiveScore, buildAutoGradingAnswers, and
    // persistedByQuestion were removed in Slice 4. They must not return as
    // production references (a stale JSDoc reference counts as a regression
    // signal — the doc must point at the live authority).
    const deleted = findInProduction([
      /\breconcileScores\b/,
      /\breconstructObjectiveScore\b/,
      /\bbuildAutoGradingAnswers\b/,
      /\bpersistedByQuestion\b/,
    ]);
    expect(deleted).toEqual([]);
  });

  it("the manual_grading_entries legacy table is absent as a production authority", () => {
    // The durable manual queue is backed by attempt_grading_entries, NOT a
    // separate manual_grading_entries table. No production reference to such a
    // table name may exist.
    const legacy = findInProduction([
      /\bmanual_grading_entries\b/,
      /\bmanualGradingEntries\b/,
    ]);
    expect(legacy).toEqual([]);
  });

  it("the deprecated standardAnswer==null manual-classification heuristic is absent from authority code", () => {
    // Slice 3/4 replaced `standardAnswer == null` (and ===) as a manual-grading
    // classifier with the canonical text_response QuestionType check. The
    // authority modules (gradingWorkset, grading, manualGrading) must not
    // reintroduce the heuristic in executable code. (Defensive — guards against
    // a copy-paste revival. Documentation references are stripped before
    // scanning, so comments explaining the deprecation are not flagged.)
    const authorityFiles = collectProductionFiles().filter((f) =>
      toRepoRelative(f).match(
        /exam-engine\/src\/(gradingWorkset|grading|manualGrading)\.ts$/,
      ),
    );
    const hits: Hit[] = [];
    for (const file of authorityFiles) {
      const text = readFileSync(file, "utf8");
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const code = stripComments(lines[i]!);
        if (!code.trim()) continue;
        if (
          /standardAnswer\s*==\s*null|standardAnswer\s*===\s*null/.test(code)
        ) {
          hits.push({
            file: toRepoRelative(file),
            line: i + 1,
            snippet: lines[i]!.trim(),
          });
        }
      }
    }
    expect(hits).toEqual([]);
  });
});

describe("Slice 5 — Steps 5/6/7: aggregator reads neither draft answers, submittedAnswers, gradingResult, nor live questions", () => {
  // The canonical terminal aggregator aggregateGradingEntries(attempt, entries,
  // passingScore) receives an ExamAttempt, so by TYPE it could read
  // attempt.answers / attempt.submittedAnswers / attempt.gradingResult. These
  // tests structurally prove its function body does NOT — locking that draft
  // answers, submittedAnswers (no re-grade), and stale gradingResult have zero
  // terminal authority. Live questions are unreachable: the aggregator has no
  // question-repo and reads only the frozen questionSnapshot.
  const AGG_FILE = "packages/exam-engine/src/gradingWorkset.ts";

  /** Returns the executable body of `name` as joined code lines (comments stripped). */
  function functionBody(repoFile: string, name: string): string {
    const text = readFileSync(resolve(REPO_ROOT, repoFile), "utf8");
    const lines = text.split(/\r?\n/);
    // Find the function declaration line, then the opening `{` of its body.
    let i = 0;
    while (i < lines.length) {
      if (
        new RegExp(`function\\s+${name}\\s*\\(`).test(stripComments(lines[i]!))
      ) {
        break;
      }
      i++;
    }
    // Advance to the line containing the opening brace of the body (skipping
    // the parameter list and return type).
    while (i < lines.length) {
      if (stripComments(lines[i]!).includes("{")) break;
      i++;
    }
    if (i >= lines.length) return "";
    // Now collect body lines, tracking brace depth. The opening line counts as
    // depth 1; we stop when depth returns to 0.
    let depth = 0;
    const body: string[] = [];
    for (; i < lines.length; i++) {
      const code = stripComments(lines[i]!);
      for (const ch of code) {
        if (ch === "{") depth++;
        else if (ch === "}") depth--;
      }
      body.push(code);
      if (depth <= 0) break;
    }
    return body.join("\n");
  }

  it("aggregateGradingEntries body never reads attempt.answers (draft answers have zero terminal authority)", () => {
    const body = functionBody(AGG_FILE, "aggregateGradingEntries");
    // `.answers` would indicate a read of mutable draft answers. The frozen
    // answer truth is materialized into entries at submit-freeze time; the
    // aggregator must not re-consult drafts.
    expect(/\.answers\b/.test(body)).toBe(false);
  });

  it("aggregateGradingEntries body never reads attempt.submittedAnswers (no terminal re-grade)", () => {
    const body = functionBody(AGG_FILE, "aggregateGradingEntries");
    expect(/\.submittedAnswers\b/.test(body)).toBe(false);
  });

  it("aggregateGradingEntries body never reads attempt.gradingResult (stale projection has zero authority)", () => {
    const body = functionBody(AGG_FILE, "aggregateGradingEntries");
    expect(/\.gradingResult\b/.test(body)).toBe(false);
  });

  it("aggregateGradingEntries body reads only attempt.id and attempt.questionSnapshot from the attempt", () => {
    // Positive lock: enumerate every `attempt.<field>` access in the body and
    // confirm the field set is exactly {id, questionSnapshot}. Any new field
    // access is a regression that needs explicit review.
    const body = functionBody(AGG_FILE, "aggregateGradingEntries");
    const accessed = new Set<string>();
    const re = /\battempt\.(\w+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(body)) !== null) {
      accessed.add(m[1]!);
    }
    expect([...accessed].sort()).toEqual(["id", "questionSnapshot"]);
  });
});
