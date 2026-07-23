#!/usr/bin/env node
/**
 * Regression guard: verify that stateful E2E tasks and test/coverage env
 * forwarding meet the repository contract.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
const turbo = JSON.parse(readFileSync(join(ROOT, "turbo.json"), "utf-8"));

const errors = [];

function assert(cond, msg) {
  if (!cond) errors.push(msg);
}

// Stateful E2E tasks must not be cached.
for (const task of ["test:e2e", "smoke"]) {
  const cfg = turbo.tasks[task];
  assert(cfg !== undefined, `turbo.json missing task '${task}'`);
  assert(cfg.cache === false, `turbo.json '${task}' must set cache:false`);
  assert(
    Array.isArray(cfg.passThroughEnv),
    `turbo.json '${task}' must declare passThroughEnv`,
  );
  for (const envVar of [
    "E2E_BASE_URL",
    "E2E_SHARD_TOTAL",
    "E2E_WORKERS_PER_SHARD",
    "E2E_TRACE",
    "CI",
  ]) {
    assert(
      cfg.passThroughEnv.includes(envVar),
      `turbo.json '${task}' passThroughEnv missing ${envVar}`,
    );
  }
}

// Root generic 'test' must forward the same vars as 'coverage'.
const testEnv = turbo.tasks.test?.passThroughEnv ?? [];
const coverageEnv = turbo.tasks.coverage?.passThroughEnv ?? [];
for (const envVar of coverageEnv) {
  assert(
    testEnv.includes(envVar),
    `turbo.json 'test' passThroughEnv missing ${envVar} (present in 'coverage')`,
  );
}

if (errors.length > 0) {
  console.error("FAIL: Turbo config contract regression:");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log("PASS: Turbo stateful-task and env-forwarding contract upheld.");
