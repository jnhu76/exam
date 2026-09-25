/**
 * Contract tests for the manual frontend-primitives scanner.
 *
 * 1. Smoke: against the real tree the scanner must remain executable —
 *    exit 0 (clean) or 1 (findings) with the expected stdout banner and an
 *    empty stderr. INVARIANT: real findings and success print to stdout;
 *    stderr must stay empty because Node also exits 1 on uncaught import-time
 *    or top-level failures, which this test must not mistake for findings.
 * 2. Detection: a scanner that finds nothing forever stays green, and this
 *    script is NOT wired into lint:ui-gates — the mutation-fixture case below
 *    (same pattern as check-stale-ui-docs.test.mjs) is the only proof that a
 *    hand-rolled primitive outside components/ui is actually reported.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCANNER = join(__dirname, "check-frontend-primitives.mjs");

test("check-frontend-primitives executes to a defined outcome", () => {
  const res = spawnSync(process.execPath, [SCANNER], {
    encoding: "utf8",
    timeout: 30_000,
  });
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

test("mutation: a hand-rolled dialog fixture is detected (exit 1, finding on stdout)", () => {
  const dir = mkdtempSync(join(tmpdir(), "frontend-primitives-"));
  try {
    // One line that triggers rule R1 (handwritten-dialog) — keep in sync
    // with the scanner's regexes; a mismatch fails the fixture, not the rule.
    writeFileSync(
      join(dir, "hand-rolled-dialog.tsx"),
      'export function Widget() {\n  return <div role="dialog">custom modal</div>;\n}\n',
    );
    const res = spawnSync(process.execPath, [SCANNER], {
      encoding: "utf8",
      timeout: 30_000,
      env: {
        ...process.env,
        CHECK_FRONTEND_PRIMITIVES_SCAN_ROOT: dir,
      },
    });
    assert.equal(
      res.status,
      1,
      `fixture violation must be detected (exit ${res.status}):\n${res.stderr}`,
    );
    assert.equal(
      res.stderr.trim(),
      "",
      `scanner wrote to stderr on findings:\n${res.stderr}`,
    );
    assert.match(res.stdout, /^✗/, "findings must print the ✗ banner");
    assert.match(res.stdout, /hand-rolled-dialog\.tsx/);
    assert.match(res.stdout, /handwritten-dialog/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
