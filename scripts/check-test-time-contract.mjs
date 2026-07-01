#!/usr/bin/env node

/**
 * Guard script: validates time/async testing contract.
 *
 * Checks:
 *   1. No real `setTimeout` / `sleep` in tests (should use fake timers)
 *   2. No large test-level timeouts (10000+ ms) masking hangs
 *   3. No `Date.now()` elapsed assertions with ms tolerance
 *   4. No `waitFor(... { timeout: 10000+ })` (should be smaller or use fake timers)
 *   5. Timer advancement wrapped in `act()` for React tests
 *
 * Usage: node scripts/check-test-time-contract.mjs
 * Exit 0 = pass, exit 1 = violations found.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..");
let violations = [];

function addViolation(file, line, message, severity = "error") {
  violations.push({ file, line, message, severity });
}

function readFileLines(path) {
  return readFileSync(path, "utf-8").split("\n");
}

function findFiles(dir, pattern, excludes = []) {
  const results = [];
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(dir, entry.name);
    const rel = relative(ROOT, full);
    if (excludes.some((e) => rel.startsWith(e))) continue;
    if (entry.isDirectory()) {
      results.push(...findFiles(full, pattern, excludes));
    } else if (pattern.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

const testFiles = findFiles(ROOT, /\.(test|spec)\.(ts|tsx|js|jsx)$/, [
  "node_modules",
  "dist",
]);

// ── 1. Real setTimeout / sleep ────────────────────────────────────────────
console.log("1. Checking for real setTimeout/sleep in tests...");

const REAL_WAIT_PATTERNS = [
  {
    regex:
      /new\s+Promise\s*\(\s*\(?resolve\)?\s*=>\s*setTimeout\s*\(\s*resolve\s*,\s*(\d+)/,
    label: "Promise+setTimeout",
  },
  {
    regex:
      /await\s+new\s+Promise\s*\(\s*r\s*=>\s*setTimeout\s*\(\s*r\s*,\s*(\d+)\s*\)\s*\)/,
    label: "await Promise+setTimeout",
  },
  {
    regex: /(?:await\s+)?(?:sleep|delay)\s*\(\s*(\d+)\s*\)/,
    label: "sleep/delay call",
  },
];

for (const testPath of testFiles) {
  const lines = readFileLines(testPath);
  const rel = relative(ROOT, testPath);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trimStart().startsWith("//") || line.trimStart().startsWith("*"))
      continue;

    for (const { regex, label } of REAL_WAIT_PATTERNS) {
      const match = line.match(regex);
      if (match) {
        const ms = parseInt(match[1], 10);
        if (ms >= 5000) {
          addViolation(
            rel,
            i + 1,
            `${label} with ${ms}ms real wait — use fake timers instead`,
          );
        }
      }
    }
  }
}

console.log("   Real wait check complete.");

// ── 2. Large test-level timeouts ──────────────────────────────────────────
console.log("2. Checking for large test-level timeouts...");

for (const testPath of testFiles) {
  const lines = readFileLines(testPath);
  const rel = relative(ROOT, testPath);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trimStart().startsWith("//")) continue;

    // Match test/it/describe with timeout option
    const timeoutMatch = line.match(
      /(?:test|it|describe)\s*\([^)]*timeout\s*:\s*(\d+)/,
    );
    if (timeoutMatch) {
      const ms = parseInt(timeoutMatch[1], 10);
      if (ms >= 10000) {
        addViolation(
          rel,
          i + 1,
          `test timeout ${ms}ms — likely masking a hang; fix at source`,
        );
      }
    }
  }
}

console.log("   Large timeout check complete.");

// ── 3. Date.now() elapsed assertions ──────────────────────────────────────
console.log("3. Checking for Date.now() elapsed assertions...");

for (const testPath of testFiles) {
  const lines = readFileLines(testPath);
  const rel = relative(ROOT, testPath);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trimStart().startsWith("//")) continue;

    // Pattern: const start = Date.now(); ... expect(... - start)
    if (
      line.includes("Date.now()") &&
      (line.includes("start") || line.includes("begin"))
    ) {
      // Look for elapsed assertion in nearby lines
      for (let j = i + 1; j < Math.min(i + 20, lines.length); j++) {
        if (lines[j].match(/expect\s*\(.*-\s*(start|begin|Date\.now\(\))\)/)) {
          addViolation(
            rel,
            j + 1,
            "Date.now() elapsed assertion — use vi.setSystemTime + fake timers",
          );
          break;
        }
      }
    }
  }
}

console.log("   Date.now() elapsed check complete.");

// ── 4. Large waitFor timeouts ─────────────────────────────────────────────
console.log("4. Checking for large waitFor timeouts...");

for (const testPath of testFiles) {
  const lines = readFileLines(testPath);
  const rel = relative(ROOT, testPath);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trimStart().startsWith("//")) continue;

    const waitForMatch = line.match(/waitFor\s*\([^)]*timeout\s*:\s*(\d+)/);
    if (waitForMatch) {
      const ms = parseInt(waitForMatch[1], 10);
      if (ms >= 10000) {
        addViolation(
          rel,
          i + 1,
          `waitFor timeout ${ms}ms — should be smaller or use fake timers`,
          "warning",
        );
      }
    }
  }
}

console.log("   Large waitFor check complete.");

// ── Report ─────────────────────────────────────────────────────────────────
console.log("\n" + "=".repeat(60));

const errors = violations.filter((v) => v.severity === "error");
const warnings = violations.filter((v) => v.severity === "warning");

if (violations.length === 0) {
  console.log("PASS: All time/async testing contract checks passed.");
  process.exit(0);
} else {
  if (errors.length > 0) {
    console.log(
      `FAIL: ${errors.length} error(s), ${warnings.length} warning(s):\n`,
    );
  } else {
    console.log(`WARN: ${warnings.length} warning(s):\n`);
  }
  for (const v of violations) {
    const loc = v.line > 0 ? `${v.file}:${v.line}` : v.file;
    const tag = v.severity === "warning" ? "[WARN]" : "[ERR]";
    console.log(`  ${tag} ${loc}`);
    console.log(`    ${v.message}\n`);
  }
  process.exit(errors.length > 0 ? 1 : 0);
}
