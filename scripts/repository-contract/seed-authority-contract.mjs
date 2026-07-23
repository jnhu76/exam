#!/usr/bin/env node
/**
 * Regression guard: enforce a single E2E seed orchestration.
 *
 * Contract:
 *   - packages/db/src/e2eSeedOrchestrator.ts is the ONLY file that may compose
 *     baseline seed + demo seed + demo-seed verification.
 *   - apps/api/src/e2e-seed.ts and packages/db/src/e2e-seed.ts are thin
 *     adapters: they must import runE2eSeed from the orchestrator and must NOT
 *     import seed(), seedDemo(), or verifyDemoSeed() directly.
 *   - Both adapters must close the database connection in a finally block.
 *   - Both adapters must set process.exitCode = 1 on orchestrator failure.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");

const ORCHESTRATOR = "packages/db/src/e2eSeedOrchestrator.ts";
const ADAPTERS = ["apps/api/src/e2e-seed.ts", "packages/db/src/e2e-seed.ts"];

const COMPOSED = [
  /from\s+["']\.\/seed\.js["']/,
  /from\s+["']\.\/demo-seed\.js["']/,
  /from\s+["']\.\/demo-seed-verify\.js["']/,
  /\bseed\s*\(\s*conn\.db\s*,\s*hashPassword\s*\)/,
  /\bseedDemo\s*\(\s*conn\.db\s*,\s*hashPassword\s*\)/,
  /\bverifyDemoSeed\s*\(\s*conn\.db\s*,/,
];

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf-8");
}

const errors = [];

// 1. Orchestrator must exist and compose the workflow.
const orchestrator = read(ORCHESTRATOR);
if (!orchestrator.includes("export async function runE2eSeed")) {
  errors.push(`${ORCHESTRATOR} must export runE2eSeed`);
}
// The orchestrator may compose via injected workflow defaults or direct calls.
const composesWorkflow =
  (orchestrator.includes("seedFn(") &&
    orchestrator.includes("seedDemoFn(") &&
    orchestrator.includes("verifyDemoSeedFn(")) ||
  (orchestrator.includes("seed(") &&
    orchestrator.includes("seedDemo(") &&
    orchestrator.includes("verifyDemoSeed("));
if (!composesWorkflow) {
  errors.push(
    `${ORCHESTRATOR} must compose baseline seed, demo seed, and demo-seed verification`,
  );
}

// 2. Adapters must be thin.
for (const adapter of ADAPTERS) {
  const content = read(adapter);

  if (!content.includes("runE2eSeed")) {
    errors.push(`${adapter} must import and call runE2eSeed`);
  }

  for (const pattern of COMPOSED) {
    if (pattern.test(content)) {
      errors.push(
        `${adapter} must not re-compose seed workflow (matched ${pattern.source}); delegate to runE2eSeed`,
      );
    }
  }

  if (!/finally\s*\{[^}]*(?:sql\.end|conn\?\.sql\.end)/s.test(content)) {
    errors.push(
      `${adapter} must close the database connection in a finally block`,
    );
  }

  if (!content.includes("process.exitCode = 1")) {
    errors.push(`${adapter} must set process.exitCode = 1 on failure`);
  }
}

if (errors.length > 0) {
  console.error("FAIL: Seed authority contract regression:");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log("PASS: Seed authority is single-source and adapters are thin.");
