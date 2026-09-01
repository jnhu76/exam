/**
 * Smoke contract for the manual frontend-primitives scanner: it must remain
 * executable (exit 0 = clean, 1 = findings — never a crash). The scanner
 * itself is intentionally manual (see its header); this test only proves the
 * manual declaration stays runnable.
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
  const out = `${res.stdout}${res.stderr}`;
  assert.ok(out.trim().length > 0, "scanner produced no output");
});
