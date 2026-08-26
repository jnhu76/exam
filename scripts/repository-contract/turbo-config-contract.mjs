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

// Root generic 'test' must hash/forward the same vars as 'coverage'.
const testEnv = turbo.tasks.test?.env ?? [];
const coverageEnv = turbo.tasks.coverage?.env ?? [];
for (const envVar of coverageEnv) {
  assert(
    testEnv.includes(envVar),
    `turbo.json 'test' env missing ${envVar} (present in 'coverage')`,
  );
}

// DB-routing / test-topology variables must be part of the test-task cache
// identity (turbo `env`), NOT mere pass-through. A pass-through-only routing
// variable lets a stale cache replay a green result recorded against a
// different database/topology (acceptance F). Every DB-backed test task must
// declare the full routing set; `test` is checked exhaustively and the
// package-specific tasks are checked for parity with it.
const ROUTING_ENV_VARS = [
  "TEST_DATABASE_URL",
  "TEST_DB_URL",
  "DB_HOST_PORT",
  "TEST_DB_ISOLATION",
  "API_TEST_MAX_WORKERS",
  "TEST_INFRA_SCOPE",
  "TEST_SHARD_INDEX",
  "TEST_WORKER_ID",
  "TEST_ADMIN_DATABASE",
  "ALLOW_UNSAFE_TEST_DATABASE_URL",
];
const DB_BACKED_TEST_TASKS = [
  "test",
  "coverage",
  "test:integration",
  "@exam/api#test",
  "@exam/api#coverage",
  "@exam/api#test:integration",
];
for (const task of DB_BACKED_TEST_TASKS) {
  const taskEnv = turbo.tasks[task]?.env ?? [];
  for (const envVar of ROUTING_ENV_VARS) {
    assert(
      taskEnv.includes(envVar),
      `turbo.json '${task}' env missing ${envVar} (DB-routing vars must be cache identity, not pass-through)`,
    );
  }
  assert(
    !Array.isArray(turbo.tasks[task]?.passThroughEnv),
    `turbo.json '${task}' must not declare passThroughEnv for routing vars — fold them into 'env' (pass-through variables are not hashed)`,
  );
}

if (errors.length > 0) {
  console.error("FAIL: Turbo config contract regression:");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log("PASS: Turbo stateful-task and env-forwarding contract upheld.");
