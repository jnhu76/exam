#!/usr/bin/env node
/**
 * Regression guard: verify package script naming honesty.
 *
 * Current rules:
 *   - format:write must not exist (format is canonical).
 *   - lint:quality must exist as the canonical code-quality script.
 *   - test:integration must be documented as an alias of test.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));

const errors = [];

if (pkg.scripts["format:write"] !== undefined) {
  errors.push(
    "Remove root 'format:write'; 'format' is the canonical prettier --write script.",
  );
}

if (!pkg.scripts["lint:quality"]?.includes("check-code-quality.mjs")) {
  errors.push(
    "Root 'lint:quality' must be the canonical code-quality checker.",
  );
}

if (!pkg.scripts["lint"]?.includes("check-code-quality.mjs")) {
  errors.push("Root 'lint' must run check-code-quality.mjs (legacy alias).");
}

const testIntegration = pkg.scripts["test:integration"];
if (!testIntegration || !testIntegration.includes("turbo test:integration")) {
  errors.push(
    "Root 'test:integration' must be an alias of turbo test:integration.",
  );
}

if (errors.length > 0) {
  console.error("FAIL: Package script contract regression:");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log("PASS: Package script naming contract upheld.");
