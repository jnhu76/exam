import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// J5-I1C Slice 2 re-review P2-1 — test-only export boundary.
//
// The production entry `forceSubmitWithOperationRaceRecovery` requires
// `audit: { request }`, so "an applied force-submit with no compliance audit"
// is unrepresentable at the production call boundary. The test-only adapter
// `forceSubmitWithOperationRaceRecoveryTestOnly` relaxes that invariant by
// name so deterministic concurrency tests can assert audit absence. Without a
// structural guard, production code could import the test-only symbol and the
// type system would not stop it — the audit-mandatory invariant would rest
// only on a naming convention.
//
// This rule locks the boundary deterministically: the test-only symbol may
// appear ONLY inside `*.test.ts` files or under any `testing/` directory. A
// production file (anything else under the API/exam-engine/db/repository
// source trees) referencing it fails the test.
//
// Style mirrors apps/api/src/runtime/lock-order.structural.test.ts.

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../../..");

const SCAN_DIRS = [
  "apps/api/src",
  "packages/exam-engine/src",
  "packages/domain/src",
  "packages/db/src/repository",
];

const TEST_ONLY_SYMBOLS = [
  "forceSubmitWithOperationRaceRecoveryTestOnly",
] as const;

function isTestFile(absPath: string): boolean {
  const normalized = absPath.replace(/\\/g, "/");
  return (
    normalized.includes(".test.") ||
    normalized.includes("__tests__") ||
    // Any path segment named `testing` is a test harness root by convention
    // (apps/api/src/testing/*). Production source never lives there.
    /\/testing\//.test(normalized)
  );
}

function isExcluded(absPath: string): boolean {
  const normalized = absPath.replace(/\\/g, "/");
  return (
    normalized.endsWith(".d.ts") ||
    normalized.includes("/dist/") ||
    normalized.includes("/apps/web/") ||
    normalized.includes("/apps/e2e/")
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
  return entries;
}

function collectProductionFiles(): string[] {
  const all: string[] = [];
  for (const dir of SCAN_DIRS) {
    const dirAbs = resolve(REPO_ROOT, dir);
    if (!existsSync(dirAbs)) continue;
    for (const file of collectFiles(dirAbs, [".ts"])) {
      if (isExcluded(file) || isTestFile(file)) continue;
      all.push(file);
    }
  }
  return all;
}

function toRepoRelative(absPath: string): string {
  return absPath
    .replace(/\\/g, "/")
    .replace(REPO_ROOT.replace(/\\/g, "/") + "/", "");
}

interface Hit {
  file: string;
  line: number;
  snippet: string;
  symbol: string;
}

/**
 * Strips JSDoc / line comments so a `{@link TestOnly}` reference in a doc
 * comment is not mistaken for a real source reference. Mirrors the comment
 * handling in lock-order.structural.test.ts.
 */
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

/**
 * Scans production source (non-test, non-testing) for any CODE reference to a
 * test-only symbol. A reference is any whole-word identifier occurrence in
 * non-comment text that is NOT the export declaration site itself. The symbol
 * is intentionally defined in a production module but only test files may
 * consume it; the declaration is filtered by recognizing
 * `export async function <name>`.
 */
function findTestOnlyReferencesInProduction(): Hit[] {
  const hits: Hit[] = [];
  const symbolPattern = TEST_ONLY_SYMBOLS.join("|");
  const refRe = new RegExp(`\\b(${symbolPattern})\\b`);
  const declRe = new RegExp(
    `^\\s*export\\s+async\\s+function\\s+(?:${symbolPattern})\\b`,
  );
  for (const file of collectProductionFiles()) {
    const text = readFileSync(file, "utf8");
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i]!;
      const code = stripComments(raw);
      if (!code.trim()) continue;
      const decl = declRe.test(raw);
      const m = refRe.exec(code);
      if (!m) continue;
      if (decl) continue; // declaration site — allowed in the production module
      hits.push({
        file: toRepoRelative(file),
        line: i + 1,
        snippet: raw.trim(),
        symbol: m[1]!,
      });
    }
  }
  return hits.sort((a, b) =>
    a.file === b.file ? a.line - b.line : a.file.localeCompare(b.file),
  );
}

describe("J5-I1C Slice 2 re-review P2-1 — test-only export boundary", () => {
  it("forceSubmitWithOperationRaceRecoveryTestOnly is referenced only from test files / testing harness", () => {
    const hits = findTestOnlyReferencesInProduction();
    expect(hits, formatHits(hits)).toEqual([]);
  });
});

function formatHits(hits: Hit[]): string {
  if (hits.length === 0) return "";
  const listing = hits
    .map((h) => `  ${h.file}:${h.line}  [${h.symbol}]  ${h.snippet}`)
    .join("\n");
  return (
    `Test-only symbol leaked into production source:\n${listing}\n` +
    `These symbols may relax production invariants (e.g. the audit-mandatory ` +
    `applied force-submit) and must only be imported from *.test.ts or testing/.`
  );
}
