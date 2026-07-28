import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// P3-FORMAL-P0-D2 — EA lock-order structural regression closure.
//
// These are STRUCTURAL architecture tests. They lock the accepted
// transaction-affine Enrollment→Attempt lock protocol against future
// regression by scanning PRODUCTION source text (never test files, never
// dist/ builds, never the frontend). Cheap, local, regex-based guardrails —
// they are NOT a TypeScript lifetime/borrow proof. Runtime repo-affinity
// (assertCapabilityFor) remains the correctness authority; these rules are
// supplementary guardrails (HR-5).
//
// Style mirrors apps/api/src/runtime/gradingArchitecture.structural.test.ts.

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");

const SCAN_DIRS = [
  "apps/api/src/routes",
  "apps/api/src/plugins",
  "apps/api/src/orchestrators",
  "apps/api/src/adapters",
  "packages/exam-engine/src",
  "packages/domain/src",
  "packages/db/src/repository",
];

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

function stripComments(line: string): string {
  const jsdocEndOrOpen = new RegExp("^\\s*\\*\\/|^\\s*\\/\\*");
  const jsdocCloseOnly = new RegExp("^\\s*\\*\\/$");
  if (jsdocEndOrOpen.test(line) || jsdocCloseOnly.test(line)) {
    return "";
  }
  if (new RegExp("^\\s*\\*\\s").test(line)) {
    return "";
  }
  const inline = line.match(/^([^"'/]*)\/\/.*$/);
  if (inline) {
    return inline[1] ?? "";
  }
  return line;
}

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

function invocationCallSites(name: string): RegExp[] {
  return [
    new RegExp(
      `^(?!\\s*(export\\s+)?(async\\s+)?function\\s+${name}\\b)` +
        `.*(?<![\\w.$])${name}\\s*\\(`,
    ),
  ];
}

function readProductionFile(relPath: string): string {
  const abs = resolve(REPO_ROOT, relPath);
  return readFileSync(abs, "utf8");
}

/**
 * Extract the executable body of a named exported async function via a
 * brace-depth walker. Returns null if the function declaration is not found.
 * Correctly handles default-parameter braces (`= {}`) by tracking paren depth
 * through the parameter list before searching for the body-opening brace.
 */
function functionBody(relPath: string, name: string): string | null {
  const text = readProductionFile(relPath);
  const declRe = new RegExp(`export\\s+async\\s+function\\s+${name}\\s*\\(`);
  const m = declRe.exec(text);
  if (!m) return null;
  // Skip through the parameter list tracking paren depth; ignore braces
  // inside default values (e.g. `options: Foo = {}`).
  let i = m.index + m[0].length;
  let parenDepth = 1;
  while (i < text.length && parenDepth > 0) {
    if (text[i] === "(") parenDepth++;
    else if (text[i] === ")") parenDepth--;
    i++;
  }
  // Now find the first `{` that opens the function body.
  while (i < text.length && text[i] !== "{") i++;
  if (i >= text.length) return null;
  const start = i + 1;
  let depth = 1;
  i++;
  while (i < text.length && depth > 0) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") depth--;
    i++;
  }
  return text.slice(start, i - 1);
}

// The 7 exact AE production entry points (PRODUCTION_ENTRY_POINT_COUNT = 7).
const AE_ENTRY_POINTS: { rel: string; label: string }[] = [
  {
    rel: "apps/api/src/orchestrators/submitAndGradeAttempt.ts",
    label: "submitAndGradeAttempt",
  },
  {
    rel: "apps/api/src/routes/attempts.candidate.ts",
    label: "candidate take",
  },
  {
    rel: "apps/api/src/routes/attempts.candidate.ts",
    label: "candidate save",
  },
  {
    rel: "apps/api/src/routes/attempts.candidate.ts",
    label: "candidate restore",
  },
  {
    rel: "apps/api/src/routes/attempts.admin.ts",
    label: "admin force-submit",
  },
  {
    rel: "apps/api/src/plugins/deadlineScanner.ts",
    label: "deadline autoSubmitAndGrade",
  },
  {
    rel: "apps/api/src/routes/gradingQueue.ts",
    label: "manual gradeQuestion route",
  },
];

describe("P3-FORMAL-P0-D2 — EA lock-order structural closure", () => {
  it("lockEnrollmentAndAttempt is defined in exactly one production file (lockSeam.ts)", () => {
    const defs = findInProduction([
      new RegExp(`export\\s+async\\s+function\\s+lockEnrollmentAndAttempt\\b`),
    ]);
    expect(defs).toHaveLength(1);
    expect(defs[0]!.file).toBe("packages/exam-engine/src/lockSeam.ts");
  });

  it("assertCapabilityFor is defined in exactly one production file (lockSeam.ts)", () => {
    const defs = findInProduction([
      new RegExp(`export\\s+function\\s+assertCapabilityFor\\b`),
    ]);
    expect(defs).toHaveLength(1);
    expect(defs[0]!.file).toBe("packages/exam-engine/src/lockSeam.ts");
  });

  // Rule 1 — runtime brand tokens stay private.
  it("LOCK_TOKEN / TX_AFFINITY_TOKEN are never exported from lockSeam.ts", () => {
    const text = readProductionFile("packages/exam-engine/src/lockSeam.ts");
    const exportHits = [
      ...text.matchAll(
        /export\s+(?:const|let|var)\s+([A-Za-z_][A-Za-z0-9_]*)/g,
      ),
    ].map((m) => m[1]);
    expect(exportHits).not.toContain("LOCK_TOKEN");
    expect(exportHits).not.toContain("TX_AFFINITY_TOKEN");
    const aliasRe =
      /export\s+(?:const|let|var)\s+\w+\s*=\s*(LOCK_TOKEN|TX_AFFINITY_TOKEN)\b/;
    expect(aliasRe.test(text)).toBe(false);
  });

  // Rule 2 — no exported capability type guard.
  it("no production file exports a type predicate narrowing to LockedEnrollmentAttemptIdentity", () => {
    const hits = findInProduction([
      new RegExp(`is\\s+LockedEnrollmentAttemptIdentity\\b`),
    ]);
    const guardHits = hits.filter(
      (h) =>
        /\)\s*:\s*\w+\s+is\s+LockedEnrollmentAttemptIdentity/.test(h.snippet) ||
        /:\s*\w+\s+is\s+LockedEnrollmentAttemptIdentity/.test(h.snippet),
    );
    expect(guardHits).toHaveLength(0);
  });

  // Rule 3 — ban explicit capability casts.
  it("no production source uses an explicit `as` cast to LockedEnrollmentAttemptIdentity", () => {
    const hits = findInProduction([
      new RegExp(`\\bas\\s+LockedEnrollmentAttemptIdentity\\b`),
    ]);
    expect(hits).toHaveLength(0);
  });

  // Rule 4 — finalizeTerminalGrading consumes affinity.
  it("finalizeTerminalGrading signature depends on LockedEnrollmentAttemptIdentity", () => {
    const text = readProductionFile("packages/exam-engine/src/grading.ts");
    const decl =
      /export\s+async\s+function\s+finalizeTerminalGrading\s*\([^)]*\)/s.exec(
        text,
      );
    expect(
      decl,
      "finalizeTerminalGrading declaration not found",
    ).not.toBeNull();
    expect(decl![0]).toContain("LockedEnrollmentAttemptIdentity");
  });

  it("finalizeTerminalGrading invokes assertCapabilityFor before any repository operation", () => {
    const body = functionBody(
      "packages/exam-engine/src/grading.ts",
      "finalizeTerminalGrading",
    );
    expect(body, "finalizeTerminalGrading body not found").not.toBeNull();
    const b = body!;
    const assertIdx = b.indexOf("assertCapabilityFor");
    expect(assertIdx).toBeGreaterThanOrEqual(0);
    const repoOps = [
      "attemptRepo.findById",
      "attemptRepo.findByIdForUpdate",
      "attemptRepo.update",
      "enrollmentRepo.findByExamAndCandidate",
      "enrollmentRepo.findByExamAndCandidateForUpdate",
      "enrollmentRepo.update",
      "gradingWorksetRepo.findByAttempt",
    ];
    for (const op of repoOps) {
      const opIdx = b.indexOf(op);
      if (opIdx >= 0) {
        expect(
          opIdx,
          `${op} must come AFTER assertCapabilityFor`,
        ).toBeGreaterThan(assertIdx);
      }
    }
  });

  // Rule 5 — no Enrollment FOR UPDATE in terminal finalization.
  it("finalizeTerminalGrading never calls an Enrollment *ForUpdate method", () => {
    const body = functionBody(
      "packages/exam-engine/src/grading.ts",
      "finalizeTerminalGrading",
    );
    expect(body, "body not found").not.toBeNull();
    expect(body!).not.toMatch(
      /enrollmentRepo\.findByExamAndCandidateForUpdate/,
    );
    expect(body!).not.toMatch(/enrollmentRepo\.\w*ForUpdate/);
  });

  // Rule 6 — exact 7-entry-point cutover gate.
  describe("all 7 AE production entry points call the canonical seam", () => {
    for (const ep of AE_ENTRY_POINTS) {
      it(`${ep.label} (${ep.rel}) mints via lockEnrollmentAndAttempt`, () => {
        const text = readProductionFile(ep.rel);
        expect(text).toMatch(/lockEnrollmentAndAttempt\s*\(/);
      });
    }

    it("exactly 7 production AE entry points are covered", () => {
      expect(AE_ENTRY_POINTS).toHaveLength(7);
    });
  });

  // Rule 7 — natural EA exception remains legal.
  it("startOrRestoreAttempt retains its natural Enrollment→Attempt sequence (EA exception)", () => {
    const body = functionBody(
      "packages/exam-engine/src/attemptCommands.ts",
      "startOrRestoreAttempt",
    );
    expect(body, "startOrRestoreAttempt body not found").not.toBeNull();
    const b = body!;
    // The EA lock order is now delegated to the canonical seam.
    expect(b).toMatch(/lockEnrollmentAndActiveAttempt/);
    expect(b).not.toMatch(/lockEnrollmentAndAttempt\b/);
  });

  it("single-lock Attempt paths (extendAttemptTime) remain legal without the seam", () => {
    for (const fn of ["extendAttemptTime"]) {
      const body = functionBody(
        "packages/exam-engine/src/attemptCommands.ts",
        fn,
      );
      expect(body, `${fn} body not found`).not.toBeNull();
      expect(body!).not.toMatch(/lockEnrollmentAndAttempt/);
    }
  });
});
