/**
 * Generate the committed SHA256 manifest for the #885 research instrument.
 * The manifest deliberately does not hash itself (no self-reference).
 *
 * Usage: node research/issue-885/harness/fingerprint.mjs
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");
const VERSION = "issue-885-instrument-v2";
const FILES = [
  "research/issue-885/harness/experiments.test.ts",
  "research/issue-885/harness/smoke.test.ts",
  "research/issue-885/harness/analyze.mjs",
  "research/issue-885/harness/compare.mjs",
  "research/issue-885/harness/baseline-control.mjs",
  "research/issue-885/harness/expected-events.json",
  "research/issue-885/harness/vitest.config.ts",
  "research/issue-885/harness/fingerprint.mjs",
];

const files = FILES.map((relativePath) => {
  const absolutePath = path.resolve(REPO_ROOT, relativePath);
  const sha256 = createHash("sha256")
    .update(readFileSync(absolutePath))
    .digest("hex");
  return { path: relativePath, sha256 };
});

const manifest = { version: VERSION, files };
writeFileSync(
  path.resolve(HERE, "instrument-manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(
  `WROTE instrument-manifest.json version=${VERSION} files=${files.length}`,
);
