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

// ── 5. Check E2E public web origin contract ────────────────────────────────
console.log("5. Checking E2E public web origin contract...");

// Identity one-time links (invitation acceptance, password reset) are
// server-generated absolute URLs: PUBLIC_WEB_ORIGIN + a fixed site-relative
// path. The browser later goes to that URL directly, so every E2E launch
// path must bind PUBLIC_WEB_ORIGIN to the origin the browser actually uses
// — otherwise the link points at a closed port (the API serves the SPA in
// test topologies, and an unset var falls back to the dev Vite origin).

const e2eBaseUrl = ciContent.match(/^\s+E2E_BASE_URL:\s*(.+?)\s*$/m);
const ciOrigin = ciContent.match(/^\s+PUBLIC_WEB_ORIGIN:\s*(.+?)\s*$/m);
if (!e2eBaseUrl) {
  addViolation(".github/workflows/ci.yml", 0, "e2e job missing E2E_BASE_URL");
} else if (!ciOrigin) {
  addViolation(
    ".github/workflows/ci.yml",
    0,
    "e2e job missing PUBLIC_WEB_ORIGIN — identity one-time links would fall back to the dev Vite origin",
  );
} else if (e2eBaseUrl[1] !== ciOrigin[1]) {
  addViolation(
    ".github/workflows/ci.yml",
    0,
    `e2e PUBLIC_WEB_ORIGIN (${ciOrigin[1]}) must equal E2E_BASE_URL (${e2eBaseUrl[1]}) — the API serves the SPA on one origin`,
  );
}

const composeTestPath = join(ROOT, "docker-compose.test.yml");
const composeTestContent = readFileSync(composeTestPath, "utf-8");
if (
  !composeTestContent.includes(
    "PUBLIC_WEB_ORIGIN: http://localhost:${EXAM_PORT:-3000}",
  )
) {
  addViolation(
    "docker-compose.test.yml",
    0,
    "compose test env missing PUBLIC_WEB_ORIGIN derived from EXAM_PORT",
  );
}

// WSL runner: PUBLIC_WEB_ORIGIN must be bound INSIDE launch_api, derived from
// that process's port argument. A missing binding falls back to :5173; a
// fixed origin (e.g. :3000) fixes serial mode while parallel shards keep
// pointing at the wrong port. Bounded textual extraction of the function
// body — not a shell parser.
const runWslPath = join(ROOT, "scripts/e2e/run-wsl.sh");
const runWslLines = readFileLines(runWslPath);
const launchStart = runWslLines.findIndex((l) => /^launch_api\(\) \{/.test(l));
if (launchStart === -1) {
  addViolation(
    "scripts/e2e/run-wsl.sh",
    0,
    "launch_api() not found — API launch seam changed; re-bind PUBLIC_WEB_ORIGIN to the per-process API port",
  );
} else {
  let launchEnd = launchStart;
  while (launchEnd < runWslLines.length && runWslLines[launchEnd] !== "}") {
    launchEnd++;
  }
  const originBindings = [];
  for (let i = launchStart; i <= launchEnd && i < runWslLines.length; i++) {
    if (/PUBLIC_WEB_ORIGIN\s*=/.test(runWslLines[i])) {
      originBindings.push({ n: i + 1, line: runWslLines[i] });
    }
  }
  if (originBindings.length === 0) {
    addViolation(
      "scripts/e2e/run-wsl.sh",
      launchStart + 1,
      "launch_api does not bind PUBLIC_WEB_ORIGIN — identity one-time links fall back to the dev Vite origin (:5173), where no E2E process listens",
    );
  }
  for (const b of originBindings) {
    if (
      !/PUBLIC_WEB_ORIGIN\s*=\s*"http:\/\/localhost:\$\{port\}"/.test(b.line)
    ) {
      addViolation(
        "scripts/e2e/run-wsl.sh",
        b.n,
        'launch_api PUBLIC_WEB_ORIGIN must bind this API process port ("http://localhost:${port}") — a fixed origin leaves parallel shards pointing at the wrong port',
      );
    }
  }
}

console.log("   E2E public web origin check complete.");

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
