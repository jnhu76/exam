// Mutation tests for scripts/check-stale-ui-docs.mjs.
//
// Each test runs the checker as a child process with STALE_UI_DOCS_TARGETS_OVERRIDE
// pointing at throwaway fixtures, and asserts the checker's verdict. A "golden"
// test confirms the real, unmutated repository passes. The mutation tests are
// also the permanent-no-op regression: if the scan branch ever becomes
// unreachable again (the historical `readFile` without utf8 bug), injected
// wording goes undetected, the checker exits 0, and the tests fail.
//
// Run:  node --test scripts/check-stale-ui-docs.test.mjs

import assert from "node:assert/strict";
import test from "node:test";
import child_process from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHECKER = join(__dirname, "check-stale-ui-docs.mjs");

// One line that triggers each MISLEADING pattern. Keep in sync with the
// checker's regexes — a mismatch fails the fixture, not the scanner.
const FORBIDDEN_LINES = [
  "推荐使用 Ant Design 作为当前技术栈",
  "A/B/C table 已批准 production 方向",
  "业务页面可以使用 raw slate 调色板",
  "使用 font-bold 建立层级",
];

function fixtureDir() {
  return mkdtempSync(join(tmpdir(), "stale-ui-docs-"));
}

function runChecker(overrideTargets) {
  const env = {
    ...process.env,
    STALE_UI_DOCS_TARGETS_OVERRIDE: overrideTargets.join(","),
  };
  const res = child_process.spawnSync(process.execPath, [CHECKER], {
    env,
    encoding: "utf8",
  });
  return { code: res.status ?? 0, stdout: res.stdout, stderr: res.stderr };
}

test("golden: real repository scans clean", () => {
  const res = child_process.spawnSync(process.execPath, [CHECKER], {
    encoding: "utf8",
  });
  assert.equal(res.status, 0, `stderr: ${res.stderr}`);
  assert.match(
    res.stdout,
    /No misleading UI architecture framing in active docs/,
  );
});

for (const line of FORBIDDEN_LINES) {
  test(`mutation: forbids "${line.slice(0, 20)}…" in an active doc`, () => {
    const dir = fixtureDir();
    try {
      writeFileSync(join(dir, "active.md"), `${line}\n`);
      const res = runChecker([join(dir, "active.md")]);
      assert.notEqual(res.code, 0, "injected wording must be detected");
      assert.match(res.stderr, /active\.md:1:/);
      assert.match(res.stderr, /Stale\/misleading doc violations \(1\)/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("directory target scans active files and ignores docs/archive per policy", () => {
  const dir = fixtureDir();
  try {
    mkdirSync(join(dir, "docs", "archive"), { recursive: true });
    writeFileSync(join(dir, "active.md"), `${FORBIDDEN_LINES[0]}\n`);
    writeFileSync(
      join(dir, "docs", "archive", "history.md"),
      `${FORBIDDEN_LINES[0]}\n`,
    );
    const res = runChecker([dir]);
    assert.notEqual(res.code, 0, "active-doc wording must be detected");
    assert.match(res.stderr, /active\.md:1:/);
    assert.match(res.stderr, /Stale\/misleading doc violations \(1\)/);
    assert.doesNotMatch(
      res.stderr,
      /history\.md/,
      "archive wording is ignored",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("missing targets are skipped, not an error", () => {
  const dir = fixtureDir();
  try {
    writeFileSync(join(dir, "active.md"), "clean content\n");
    const res = runChecker([
      join(dir, "does-not-exist.md"),
      join(dir, "active.md"),
    ]);
    assert.equal(res.status ?? res.code, 0, `stderr: ${res.stderr}`);
    assert.match(res.stdout, /No misleading UI architecture framing/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
