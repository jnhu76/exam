#!/usr/bin/env node

/**
 * Guard script: validates environment variable contract for tests.
 *
 * Checks:
 *   1. CI workflow sets expected env vars (DATABASE_URL, TEST_DATABASE_URL, JWT_SECRET, etc.)
 *   2. No dangerous DATABASE_URL fallback in vitest configs
 *   3. No bare `process.env.DATABASE_URL` in test files (should use resolveDatabaseUrl)
 *   4. Production-guard tests use vi.stubEnv (not process.env mutation)
 *
 * Usage: node scripts/check-test-env-contract.mjs
 * Exit 0 = pass, exit 1 = violations found.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..");
let violations = [];

function addViolation(file, line, message) {
  violations.push({ file, line, message });
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
    // Exclude by path segment (e.g. "dist" matches "packages/db/dist/...")
    if (excludes.some((e) => rel.split("/").includes(e))) continue;
    if (entry.isDirectory()) {
      results.push(...findFiles(full, pattern, excludes));
    } else if (pattern.test(entry.name)) {
      results.push(full);
    }
  }
  return results;
}

// ── 1. Check CI workflow env vars ──────────────────────────────────────────
console.log("1. Checking CI workflow env contract...");

const ciPath = join(ROOT, ".github/workflows/ci.yml");
const ciContent = readFileSync(ciPath, "utf-8");

const requiredVerifyEnv = [
  "DATABASE_URL",
  "TEST_DATABASE_URL",
  "JWT_SECRET",
  "NODE_ENV",
  "APP_MODE",
  "DEPLOYMENT_MODE",
];

for (const envVar of requiredVerifyEnv) {
  if (!ciContent.includes(`${envVar}:`)) {
    addViolation(
      ".github/workflows/ci.yml",
      0,
      `verify job missing required env: ${envVar}`,
    );
  }
}

if (!ciContent.includes("APP_MODE: ci")) {
  addViolation(
    ".github/workflows/ci.yml",
    0,
    "verify job should set APP_MODE: ci",
  );
}

if (!ciContent.includes("TEST_DB_ISOLATION=worker-database")) {
  addViolation(
    ".github/workflows/ci.yml",
    0,
    "verify job missing TEST_DB_ISOLATION=worker-database",
  );
}

console.log("   CI workflow env check complete.");

// ── 2. Check vitest configs for dangerous DATABASE_URL fallback ────────────
console.log("2. Checking vitest configs for DATABASE_URL fallback...");

const vitestConfigs = findFiles(ROOT, /vitest\.config\.(ts|js|mjs)$/, [
  "node_modules",
  "dist",
]);

for (const configPath of vitestConfigs) {
  const lines = readFileLines(configPath);
  const rel = relative(ROOT, configPath);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip comments
    if (line.trimStart().startsWith("//")) continue;
    // Check for process.env.DATABASE_URL usage in test configs (should use resolveDatabaseUrl)
    if (
      line.includes("process.env.DATABASE_URL") &&
      !line.includes("resolveDatabaseUrl")
    ) {
      addViolation(
        rel,
        i + 1,
        "vitest config reads process.env.DATABASE_URL directly — use resolveDatabaseUrl",
      );
    }
  }
}

console.log("   Vitest config check complete.");

// ── 3. Check test files for bare process.env.DATABASE_URL ──────────────────
console.log("3. Checking test files for bare process.env.DATABASE_URL...");

const testFiles = findFiles(ROOT, /\.test\.(ts|tsx|js|jsx)$/, [
  "node_modules",
  "dist",
]);

// Config-resolution tests (databaseUrl, runtimeConfig, loadRootEnv) legitimately
// test how DATABASE_URL is read. These files are expected to reference it.
const DB_URL_EXEMPT =
  /databaseUrl|runtimeConfig|loadRootEnv|testWorkerDatabase/i;

for (const testPath of testFiles) {
  const lines = readFileLines(testPath);
  const rel = relative(ROOT, testPath);
  if (DB_URL_EXEMPT.test(rel)) continue;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trimStart().startsWith("//") || line.trimStart().startsWith("*"))
      continue;
    if (
      line.includes("process.env.DATABASE_URL") &&
      !line.includes("TEST_DATABASE_URL")
    ) {
      addViolation(
        rel,
        i + 1,
        "test file reads process.env.DATABASE_URL — should use TEST_DATABASE_URL or resolveTestDatabaseUrl",
      );
    }
  }
}

console.log("   Test file DATABASE_URL check complete.");

// ── 4. Check production-guard tests use vi.stubEnv ─────────────────────────
console.log("4. Checking production-guard tests for vi.stubEnv...");

for (const testPath of testFiles) {
  const content = readFileSync(testPath, "utf-8");
  const rel = relative(ROOT, testPath);

  // Config-resolution tests test the resolver logic itself — they legitimately
  // set process.env directly because they're testing the resolver's behavior.
  if (DB_URL_EXEMPT.test(rel)) continue;

  // Only flag tests that actually MUTATE process.env with production values.
  // Tests that pass env via function arguments (e.g. buildAppWithDocs({ NODE_ENV: "production" }))
  // are properly isolated and don't need vi.stubEnv.
  const mutatesProductionEnv =
    /process\.env\.(APP_MODE|NODE_ENV)\s*=\s*["']production["']/.test(
      content,
    ) ||
    (/process\.env\.JWT_SECRET\s*=\s*["']/.test(content) &&
      /process\.env\.(APP_MODE|NODE_ENV)\s*=/.test(content));

  if (mutatesProductionEnv) {
    if (!content.includes("vi.stubEnv")) {
      addViolation(
        rel,
        0,
        "production-guard test mutates process.env without vi.stubEnv — env isolation unreliable",
      );
    }
    if (!content.includes("vi.unstubAllEnvs")) {
      addViolation(
        rel,
        0,
        "production-guard test missing vi.unstubAllEnvs in afterEach",
      );
    }
  }
}

console.log("   Production-guard test check complete.");

// ── Report ─────────────────────────────────────────────────────────────────
console.log("\n" + "=".repeat(60));

if (violations.length === 0) {
  console.log("PASS: All environment variable contract checks passed.");
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
