/**
 * Smoke contract for the manual frontend-primitives scanner: it must remain
 * executable — exit 0 (clean) or 1 (findings) with the expected stdout banner
 * and an empty stderr. INVARIANT: real findings and success print to stdout;
 * stderr must stay empty because Node also exits 1 on uncaught import-time or
 * top-level failures, which this test must not mistake for findings.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("check-frontend-primitives executes to a defined outcome", () => {
  const res = spawnSync(
    process.execPath,
    ["scripts/check-frontend-primitives.mjs"],
    { encoding: "utf8", timeout: 30_000 },
  );
  assert.ok(
    res.status === 0 || res.status === 1,
    `scanner crashed (exit ${res.status}):\n${res.stderr}`,
  );
  assert.equal(
    res.stderr.trim(),
    "",
    `scanner wrote to stderr (crash signature, not findings):\n${res.stderr}`,
  );
  assert.match(res.stdout, /^[✓✗]/, "scanner stdout missing the ✓/✗ banner");
});
