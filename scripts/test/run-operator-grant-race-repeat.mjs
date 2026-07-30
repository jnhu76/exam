#!/usr/bin/env node

/**
 * REC-I4-V1 — Deterministic repeat runner for the operator-grant race test.
 *
 * Runs the concurrency test N times (default 20) and reports pass/fail.
 * Each iteration creates a fresh isolated schema, so iterations are
 * independent and do not share database state.
 *
 * Usage:
 *   node scripts/test/run-operator-grant-race-repeat.mjs [count]
 *
 *   count - Number of iterations (default 20, must be a positive integer).
 *
 * Environment:
 *   REPEAT_COUNT - Alternative way to set the count (overrides positional arg).
 *
 * Exit codes:
 *   0 - All iterations passed.
 *   1 - One or more iterations failed.
 */

import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../..");

function getRepeatCount() {
  const envCount = process.env.REPEAT_COUNT;
  const argCount = process.argv[2];

  const raw = envCount ?? argCount ?? "20";
  const count = Number(raw);

  if (!Number.isInteger(count) || count < 1) {
    console.error(
      `[ERROR] Repeat count must be a positive integer, got: ${raw}`,
    );
    process.exit(1);
  }

  return count;
}

function runTest(iteration, total) {
  const testFile = "src/routes/attempts/admin-time-grants.concurrency.test.ts";
  const args = [
    "--filter",
    "@exam/api",
    "exec",
    "vitest",
    "run",
    testFile,
    "--reporter=verbose",
  ];

  const result = spawnSync("pnpm", args, {
    cwd: PROJECT_ROOT,
    stdio: "pipe",
    timeout: 120_000,
    env: { ...process.env },
    shell: false,
  });

  const stdout = result.stdout?.toString() ?? "";
  const stderr = result.stderr?.toString() ?? "";

  // Success is the vitest exit code only. `result.status === 0` means vitest
  // ran and every test passed (vitest exits non-zero on any failure or
  // collection error). Do NOT additionally scrape stdout for literal tokens
  // like "Tests"/"passed" — a future reporter tweak that drops those tokens
  // would make every iteration report failure despite exit 0.
  const passed = result.status === 0;

  if (!passed) {
    console.error(`[FAIL] Iteration ${iteration}/${total}`);
    if (stdout) process.stdout.write(`stdout:\n${stdout}\n`);
    if (stderr) process.stderr.write(`stderr:\n${stderr}\n`);
  }

  return passed;
}

function main() {
  const count = getRepeatCount();
  console.log(`\n[REC-I4-V1] Running ${count} deterministic iterations...\n`);

  let passed = 0;
  let failed = 0;

  for (let i = 1; i <= count; i++) {
    const ok = runTest(i, count);
    if (ok) {
      passed++;
      process.stdout.write(`  \u2713 Iteration ${i}/${count}\n`);
    } else {
      failed++;
      process.stdout.write(`  \u2717 Iteration ${i}/${count}\n`);
    }
  }

  console.log(
    `\n[REC-I4-V1] Results: ${passed}/${count} passed, ${failed}/${count} failed\n`,
  );

  if (failed > 0) {
    process.exit(1);
  }
}

main();
