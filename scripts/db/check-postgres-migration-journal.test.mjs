// Mutation tests for scripts/db/check-postgres-migration-journal.mjs.
//
// Each test constructs a deliberately-broken journal (and migration folder) in
// a temp dir, runs the checker as a child process with MIGRATIONS_DIR_OVERRIDE
// pointing at that dir, and asserts the checker exits non-zero with a specific
// diagnostic. A "golden" test confirms the real, unmutated journal passes.
//
// Run:  node --test scripts/db/check-postgres-migration-journal.test.mjs

import assert from "node:assert/strict";
import test from "node:test";
import child_process from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHECKER = join(__dirname, "check-postgres-migration-journal.mjs");

// A clean base journal whose `when` is strictly increasing. Used for mutation
// tests so each mutation isolates ONE invariant. (The checker's historical
// backward-when allowlist does NOT match this clean journal — that is covered
// by the dedicated allowlist-drift test, which uses an allowlist-empty harness.)
const BASE_ENTRIES = [
  { idx: 0, version: "7", when: 1000, tag: "0000_aaa", breakpoints: true },
  { idx: 1, version: "7", when: 2000, tag: "0001_bbb", breakpoints: true },
  { idx: 2, version: "7", when: 3000, tag: "0002_ccc", breakpoints: true },
];

/**
 * Build a throwaway migration dir containing meta/_journal.json with the given
 * entries, plus a .sql file per (selected) tag and optional orphan files.
 */
function buildJournalDir(entries, opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), "mig-journal-"));
  const metaDir = join(dir, "meta");
  mkdirSync(metaDir, { recursive: true });
  writeFileSync(
    join(metaDir, "_journal.json"),
    JSON.stringify({ version: "7", dialect: "postgresql", entries }, null, 2),
  );
  const writeTags = opts.writeTags ?? entries.map((e) => e.tag);
  for (const t of writeTags) {
    writeFileSync(join(dir, `${t}.sql`), "-- empty\n");
  }
  for (const f of opts.orphanFiles ?? []) {
    writeFileSync(join(dir, f), "-- orphan\n");
  }
  return dir;
}

/**
 * Run the checker against a temp migrations dir (via MIGRATIONS_DIR_OVERRIDE),
 * optionally allowing the caller to neuter the historical-allowlist via
 * ALLOWLIST_EMPTY=1 (a test-only escape hatch documented in the checker).
 * Returns {code, stdout, stderr}.
 */
function runChecker(dir, { allowlistEmpty = false } = {}) {
  const env = { ...process.env, MIGRATIONS_DIR_OVERRIDE: dir };
  if (allowlistEmpty) env.MIGRATIONS_JOURNAL_ALLOWLIST_EMPTY = "1";
  const res = child_process.spawnSync(process.execPath, [CHECKER], {
    env,
    encoding: "utf8",
  });
  return {
    code: res.status ?? 0,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
  };
}

function expectFail(dir, matchSubstr, opts) {
  const { code, stderr } = runChecker(dir, opts);
  assert.notEqual(code, 0, `checker should fail but exited 0`);
  if (matchSubstr) {
    assert.ok(
      stderr.includes(matchSubstr),
      `stderr should include ${JSON.stringify(matchSubstr)}; got:\n${stderr}`,
    );
  }
}

function expectPass(dir, opts) {
  const { code, stdout, stderr } = runChecker(dir, opts);
  assert.equal(code, 0, `checker should pass but exited ${code}:\n${stderr}`);
  assert.match(stdout, /passed/);
}

// --- Golden: the real journal passes ----------------------------------------
test("real journal passes (golden)", () => {
  const res = child_process.spawnSync(process.execPath, [CHECKER], {
    encoding: "utf8",
  });
  assert.equal(res.status, 0, `real journal check failed:\n${res.stderr}`);
  assert.match(res.stdout, /passed/);
});

// --- Mutation: new backward `when` (not in allowlist) — the 0022 regression
test("fails on a NEW backward when (0022-style regression)", () => {
  const entries = [
    { idx: 0, version: "7", when: 3000, tag: "0000_aaa", breakpoints: true },
    { idx: 1, version: "7", when: 4000, tag: "0001_bbb", breakpoints: true },
    { idx: 2, version: "7", when: 1000, tag: "0002_ccc", breakpoints: true },
  ];
  const dir = buildJournalDir(entries);
  try {
    expectFail(dir, "NEW backward when=1000", { allowlistEmpty: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Mutation: duplicate tag ------------------------------------------------
test("fails on duplicate tag", () => {
  const entries = [
    { idx: 0, version: "7", when: 1000, tag: "0000_aaa", breakpoints: true },
    { idx: 1, version: "7", when: 2000, tag: "0000_aaa", breakpoints: true },
  ];
  const dir = buildJournalDir(entries);
  try {
    expectFail(dir, "duplicate tag", { allowlistEmpty: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Mutation: duplicate idx ------------------------------------------------
test("fails on duplicate idx", () => {
  const entries = [
    { idx: 0, version: "7", when: 1000, tag: "0000_aaa", breakpoints: true },
    { idx: 0, version: "7", when: 2000, tag: "0001_bbb", breakpoints: true },
  ];
  const dir = buildJournalDir(entries);
  try {
    expectFail(dir, "duplicate idx", { allowlistEmpty: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Mutation: duplicate when -----------------------------------------------
test("fails on duplicate when", () => {
  const entries = [
    { idx: 0, version: "7", when: 1000, tag: "0000_aaa", breakpoints: true },
    { idx: 1, version: "7", when: 1000, tag: "0001_bbb", breakpoints: true },
  ];
  const dir = buildJournalDir(entries);
  try {
    expectFail(dir, "duplicate when=1000", { allowlistEmpty: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Mutation: idx gap ------------------------------------------------------
test("fails on idx gap", () => {
  const entries = [
    { idx: 0, version: "7", when: 1000, tag: "0000_aaa", breakpoints: true },
    { idx: 2, version: "7", when: 3000, tag: "0002_ccc", breakpoints: true },
  ];
  const dir = buildJournalDir(entries);
  try {
    expectFail(dir, "idx is 2, expected 1", { allowlistEmpty: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Mutation: missing SQL file ---------------------------------------------
test("fails when a registered tag's .sql file is missing", () => {
  const dir = buildJournalDir(BASE_ENTRIES, {
    writeTags: ["0000_aaa", "0001_bbb"],
  });
  try {
    expectFail(dir, '"0002_ccc.sql" not found', { allowlistEmpty: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Mutation: orphan SQL file ----------------------------------------------
test("fails on an orphan numbered .sql file", () => {
  const dir = buildJournalDir(BASE_ENTRIES, {
    orphanFiles: ["0099_orphan.sql"],
  });
  try {
    expectFail(dir, 'orphan migration .sql file "0099_orphan.sql"', {
      allowlistEmpty: true,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Mutation: allowlist drift (real allowlist, no matching backward step) --
test("fails when the historical allowlist no longer matches the journal", () => {
  // Real allowlist expects two backward steps; a clean journal has none → drift.
  const dir = buildJournalDir(BASE_ENTRIES);
  try {
    expectFail(dir, "historical backward-when allowlist entry");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- Positive control: a clean journal passes when allowlist is empty -------
test("structural invariants pass on a clean, complete journal", () => {
  const dir = buildJournalDir(BASE_ENTRIES);
  try {
    expectPass(dir, { allowlistEmpty: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
