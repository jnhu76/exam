#!/usr/bin/env node
/**
 * Regression guard: verify that the formal static gate includes the config
 * and time contract guards.
 *
 * This prevents future refactors from accidentally dropping
 * config-contract.mjs (the semantic-settings topology binding gate) or
 * check-test-time-contract.mjs from verify:static by editing the shell
 * chain.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));

const required = ["config-contract.mjs", "check-test-time-contract.mjs"];

const verifyStatic = pkg.scripts?.["verify:static"] ?? "";
const lintEnvContract = pkg.scripts?.["lint:env-contract"] ?? "";
const errors = [];

for (const script of required) {
  const inVerify = verifyStatic.includes(script);
  const inLint = lintEnvContract.includes(script);
  if (!inVerify && !inLint) {
    errors.push(
      `${script} is missing from verify:static and lint:env-contract`,
    );
  } else if (!inVerify && inLint) {
    // Acceptable if lint:env-contract is itself in verify:static.
    if (!verifyStatic.includes("lint:env-contract")) {
      errors.push(
        `${script} is only in lint:env-contract, but lint:env-contract is not in verify:static`,
      );
    }
  }
}

if (!verifyStatic.includes("lint:repo-contract")) {
  errors.push("lint:repo-contract is missing from verify:static");
}

if (errors.length > 0) {
  console.error("FAIL: Static gate contract regression:");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(
  "PASS: verify:static includes lint:env-contract and lint:repo-contract.",
);
