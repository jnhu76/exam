#!/usr/bin/env node

/**
 * Guard script: validates E2E artifact naming and merge contract.
 *
 * Checks:
 *   1. Playwright config uses blob reporter when E2E_SHARD_TOTAL > 1
 *   2. CI workflow renames blob reports to unique names per shard
 *   3. CI workflow uploads with unique artifact names per shard
 *   4. Merge job downloads with merge-multiple and validates zip integrity
 *   5. No duplicate report.zip risk (artifact names must be unique)
 *
 * Usage: node scripts/check-e2e-artifacts.mjs
 * Exit 0 = pass, exit 1 = violations found.
 */

import { readFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..");
let violations = [];

function addViolation(file, line, message) {
  violations.push({ file, line, message });
}

// ── 1. Check Playwright config for blob reporter ──────────────────────────
console.log("1. Checking Playwright config for blob reporter...");

const playwrightConfig = readFileSync(
  join(ROOT, "apps/e2e/playwright.config.ts"),
  "utf-8",
);
const relPW = "apps/e2e/playwright.config.ts";

if (!playwrightConfig.includes("blob")) {
  addViolation(
    relPW,
    0,
    "Playwright config does not use blob reporter — merge-reports requires blob input",
  );
}

if (!playwrightConfig.includes("E2E_SHARD_TOTAL")) {
  addViolation(
    relPW,
    0,
    "Playwright config does not check E2E_SHARD_TOTAL for reporter selection",
  );
}

console.log("   Playwright config check complete.");

// ── 2. Check CI workflow for unique blob naming ───────────────────────────
console.log("2. Checking CI workflow for unique blob naming...");

const ciContent = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf-8");
const relCI = ".github/workflows/ci.yml";

// Check that blob zip is renamed to unique name
if (!ciContent.includes("report-${{ matrix.shardIndex }}.zip")) {
  addViolation(
    relCI,
    0,
    "CI does not rename blob report to unique per-shard name",
  );
}

// Check that artifact name includes shard index
if (!ciContent.includes("e2e-blob-shard-${{ matrix.shardIndex }}")) {
  addViolation(
    relCI,
    0,
    "CI artifact name does not include shard index — risk of collision",
  );
}

// Check that merge-multiple is used
if (!ciContent.includes("merge-multiple: true")) {
  addViolation(relCI, 0, "CI merge job does not use merge-multiple: true");
}

// Check that zip integrity is validated before merge
if (!ciContent.includes("unzip -t")) {
  addViolation(
    relCI,
    0,
    "CI merge job does not validate zip integrity before merge",
  );
}

// Check that non-zip files are rejected
if (!ciContent.includes("! -name '*.zip'")) {
  addViolation(
    relCI,
    0,
    "CI merge job does not reject non-zip files from blob directory",
  );
}

console.log("   CI workflow blob naming check complete.");

// ── 3. Check for duplicate artifact name risk ─────────────────────────────
console.log("3. Checking for duplicate artifact name risk...");

// The pattern e2e-blob-shard-${{ matrix.shardIndex }} is unique per shard
// because matrix.shardIndex is [1, 2]. This is safe.
// But let's verify the matrix is defined correctly.
if (!ciContent.includes("shardIndex: [1, 2]")) {
  addViolation(relCI, 0, "E2E shard matrix does not define shardIndex: [1, 2]");
}

if (!ciContent.includes("shardTotal: [2]")) {
  addViolation(relCI, 0, "E2E shard matrix does not define shardTotal: [2]");
}

console.log("   Duplicate artifact name check complete.");

// ── 4. Check WSL E2E script for blob merge ───────────────────────────────
console.log("4. Checking WSL E2E script for blob merge...");

const wslScript = readFileSync(join(ROOT, "scripts/e2e/run-wsl.sh"), "utf-8");
const relWSL = "scripts/e2e/run-wsl.sh";

if (!wslScript.includes("merge-reports")) {
  addViolation(relWSL, 0, "WSL E2E script does not merge blob reports");
}

if (!wslScript.includes("PLAYWRIGHT_BLOB_OUTPUT_DIR")) {
  addViolation(
    relWSL,
    0,
    "WSL E2E script does not set PLAYWRIGHT_BLOB_OUTPUT_DIR per shard",
  );
}

console.log("   WSL E2E script check complete.");

// ── Report ─────────────────────────────────────────────────────────────────
console.log("\n" + "=".repeat(60));

if (violations.length === 0) {
  console.log("PASS: All E2E artifact contract checks passed.");
  process.exit(0);
} else {
  console.log(`FAIL: ${violations.length} violation(s) found:\n`);
  for (const v of violations) {
    const loc = v.line > 0 ? `${v.file}:${v.line}` : v.file;
    console.log(`  ${loc}`);
    console.log(`    ${v.message}\n`);
  }
  process.exit(1);
}
