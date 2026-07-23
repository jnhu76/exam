#!/usr/bin/env node
/**
 * Regression guard: ADR-007 status must stay internally consistent and must not
 * claim deferred phases as completed.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");

const ADR = "docs/adr/ADR-007-stateful-infrastructure-test-isolation.md";
const INDEX = "docs/adr/README.md";

const errors = [];

const adrContent = readFileSync(join(ROOT, ADR), "utf-8");
const indexContent = readFileSync(join(ROOT, INDEX), "utf-8");

// 1. ADR header status must be ACCEPTED with explicit deferred phases.
const statusMatch = adrContent.match(/##\s*Status\s*\n+([\s\S]*?)(?=\n##)/);
const statusText = statusMatch ? statusMatch[1] : "";
if (!/ACCEPTED/i.test(statusText)) {
  errors.push(`${ADR} Status must be ACCEPTED`);
}
if (
  !/Phase\s+6G\/7\s+.*defer/i.test(statusText) &&
  !/Phase\s+6G.*defer/i.test(adrContent)
) {
  errors.push(`${ADR} Status must note Phase 6G is deferred/pending`);
}
if (
  !/Phase\s+6G\/7\s+.*defer/i.test(statusText) &&
  !/Phase\s+7.*defer/i.test(adrContent)
) {
  errors.push(`${ADR} Status must note Phase 7 is deferred`);
}

// 2. Implementation status table must not mark Phase 6G or Phase 7 as Completed.
const tableMatch = adrContent.match(
  /##\s*Implementation Status\s*\n+([\s\S]*?)(?=\n##)/,
);
const tableText = tableMatch ? tableMatch[1] : "";
for (const phase of ["Phase 6G", "Phase 7"]) {
  const phaseRow = tableText.split("\n").find((line) => line.includes(phase));
  if (!phaseRow) {
    errors.push(`${ADR} Implementation Status table missing ${phase} row`);
    continue;
  }
  if (/\bCompleted\b/i.test(phaseRow)) {
    errors.push(`${ADR} ${phase} must not be marked Completed`);
  }
}

// 3. README index status must match ADR header.
const indexRow = indexContent
  .split("\n")
  .find((line) =>
    line.includes("ADR-007-stateful-infrastructure-test-isolation.md"),
  );
if (!indexRow) {
  errors.push(`${INDEX} missing ADR-007 row`);
} else if (!indexRow.includes("ACCEPTED")) {
  errors.push(`${INDEX} ADR-007 row must contain ACCEPTED`);
}

if (errors.length > 0) {
  console.error("FAIL: ADR-007 status contract regression:");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log("PASS: ADR-007 status contract upheld.");
