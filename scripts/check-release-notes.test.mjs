import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, describe, test } from "node:test";

import {
  checkReleaseNotes,
  listReleaseNoteFiles,
} from "./check-release-notes.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const SCRIPT = path.join(SCRIPT_DIR, "check-release-notes.mjs");
const RELEASES_DIR = path.join(REPO_ROOT, "docs", "releases");

/** Temp fixture roots removed on teardown. */
const fixtureRoots = [];

function makeFixture(files) {
  const root = mkdtempSync(path.join(tmpdir(), "exam-release-notes-"));
  fixtureRoots.push(root);
  const releases = path.join(root, "docs", "releases");
  mkdirSync(releases, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(path.join(releases, name), content);
  }
  return root;
}

after(() => {
  for (const root of fixtureRoots) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("checkReleaseNotes — soft-wrap detection", () => {
  test("flags a soft-wrapped paragraph", () => {
    const violations = checkReleaseNotes(
      "# Exam v0.0.17\n\nThis paragraph is artificially broken across\ntwo source lines.\n",
      "fixture.md",
    );
    assert.equal(violations.length, 1);
    assert.equal(violations[0].line, 4);
    assert.match(violations[0].message, /SOFT_WRAPPED_PROSE/);
  });

  test("flags a soft-wrapped unordered list item body", () => {
    const violations = checkReleaseNotes(
      "- Item text that someone wrapped at column 76\n  for no rendering reason.\n",
      "fixture.md",
    );
    assert.equal(violations.length, 1);
    assert.equal(violations[0].line, 2);
  });

  test("flags a soft-wrapped ordered list item body", () => {
    const violations = checkReleaseNotes(
      "1. Ordered item with continuation\n   indented to the marker width.\n2. Next item.\n",
      "fixture.md",
    );
    assert.equal(violations.length, 1);
    assert.equal(violations[0].line, 2);
  });

  test("flags a link label split across lines", () => {
    const joined = checkReleaseNotes(
      "See [#1020](https://example.com/1020) and [#1021](https://example.com/1021).\n",
      "fixture.md",
    );
    assert.equal(joined.length, 0);

    const split = checkReleaseNotes(
      "See [#1020](https://example.com/1020) and\n[#1021](https://example.com/1021).\n",
      "fixture.md",
    );
    assert.equal(split.length, 1);
    assert.equal(split[0].line, 2);
  });

  test("flags a wrapping sequence that breaks a PR range mid-link", () => {
    // Real v0.0.16 shape: dash-joined PR references wrapped between links.
    const violations = checkReleaseNotes(
      "1. Item referencing PRs [#973](https://github.com/jnhu76/exam/pull/973)–\n   [#977](https://github.com/jnhu76/exam/pull/977) landed.\n",
      "fixture.md",
    );
    assert.equal(violations.length, 1);
    assert.equal(violations[0].line, 2);
  });

  test("accepts a normal single-line paragraph", () => {
    const violations = checkReleaseNotes(
      "# Exam v0.0.17\n\nThis paragraph stays on one long source line no matter how far past column 80 it grows.\n",
      "fixture.md",
    );
    assert.equal(violations.length, 0);
  });

  test("accepts headings followed immediately by prose", () => {
    const violations = checkReleaseNotes(
      "## Why this release exists\nSingle-line intro.\n### Sub\nAlso fine.\n",
      "fixture.md",
    );
    assert.equal(violations.length, 0);
  });

  test("accepts multi-line fenced code blocks verbatim", () => {
    const violations = checkReleaseNotes(
      "Example:\n\n```bash\npnpm verify\npnpm e2e\n```\n\nAfter.\n",
      "fixture.md",
    );
    assert.equal(violations.length, 0);
  });

  test("accepts a markdown table", () => {
    const violations = checkReleaseNotes(
      "| Column | Value |\n| --- | --- |\n| a | b |\n",
      "fixture.md",
    );
    assert.equal(violations.length, 0);
  });

  test("accepts intentional hard breaks (trailing spaces and backslash)", () => {
    const violations = checkReleaseNotes(
      "Line one  \nline two deliberately broken\\\nline three\n",
      "fixture.md",
    );
    assert.equal(violations.length, 0);
  });

  test("accepts nested list items and blank-separated blocks", () => {
    const violations = checkReleaseNotes(
      "- Outer item.\n  - Inner item one.\n  - Inner item two.\n\nSeparate paragraph.\n",
      "fixture.md",
    );
    assert.equal(violations.length, 0);
  });

  test("negative control: the v0.0.16 historical wrap fails, the repaired text passes", () => {
    const historical =
      "`v0.0.16` is a correctness, security and observability release cut from\nmaster `081f179e`. Its substance is three campaigns:\n";
    const flagged = checkReleaseNotes(historical, "v0.0.16.md");
    assert.equal(flagged.length, 1);
    assert.equal(flagged[0].line, 2);

    const repaired =
      "`v0.0.16` is a correctness, security and observability release cut from master `081f179e`. Its substance is three campaigns:\n";
    assert.equal(checkReleaseNotes(repaired, "v0.0.16.md").length, 0);
  });
});

describe("listReleaseNoteFiles — discovery", () => {
  test("discovers only version-shaped files, sorted by version", () => {
    const root = makeFixture({
      "v0.0.2.md": "# two\n",
      "v0.0.10.md": "# ten\n",
      "v0.0.1.md": "# one\n",
      "TEMPLATE.md": "# template\n",
      "notes.txt": "ignored\n",
    });
    const files = listReleaseNoteFiles(path.join(root, "docs", "releases"));
    assert.deepEqual(
      files.map((f) => path.basename(f)),
      ["v0.0.1.md", "v0.0.2.md", "v0.0.10.md"],
    );
  });
});

describe("CLI gate", () => {
  test("exits non-zero with path:line diagnostics for a wrapped fixture", () => {
    const root = makeFixture({
      "v0.0.99.md": "# Exam v0.0.99\n\nWrapped body\nacross lines.\n",
    });
    const result = spawnSync(
      process.execPath,
      [SCRIPT, "--dir", path.join(root, "docs", "releases")],
      { encoding: "utf8" },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /v0\.0\.99\.md:4:/);
    assert.match(result.stderr, /SOFT_WRAPPED_PROSE/);
  });

  test("exits zero for clean fixtures and does not modify them", () => {
    const root = makeFixture({
      "v0.0.99.md": "# Exam v0.0.99\n\nOne long single-line paragraph.\n",
    });
    const target = path.join(root, "docs", "releases", "v0.0.99.md");
    const before = readFileSync(target, "utf8");
    const result = spawnSync(
      process.execPath,
      [SCRIPT, "--dir", path.dirname(target)],
      {
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 0);
    assert.equal(readFileSync(target, "utf8"), before);
  });

  test("repository release notes pass after the historical repair", () => {
    const files = listReleaseNoteFiles(RELEASES_DIR);
    assert.ok(
      files.length >= 16,
      `expected >=16 release notes, found ${files.length}`,
    );
    const result = spawnSync(process.execPath, [SCRIPT], {
      encoding: "utf8",
      cwd: REPO_ROOT,
    });
    assert.equal(
      result.status,
      0,
      `repository release notes must pass the gate:\n${result.stderr}`,
    );
  });
});

describe("release workflow wiring", () => {
  test("release.yml runs the release-notes gate before any build or publish step", async () => {
    const { readFile } = await import("node:fs/promises");
    const workflow = await readFile(
      path.join(REPO_ROOT, ".github", "workflows", "release.yml"),
      "utf8",
    );
    const gateIndex = workflow.indexOf("scripts/check-release-notes.mjs");
    assert.ok(
      gateIndex !== -1,
      "release.yml must invoke scripts/check-release-notes.mjs",
    );
    for (const marker of [
      "docker/setup-buildx-action",
      "docker/build-push-action",
      "Create or verify immutable tag",
      "Create GitHub Release if absent",
    ]) {
      const markerIndex = workflow.indexOf(marker);
      assert.ok(markerIndex !== -1, `release.yml must still contain ${marker}`);
      assert.ok(
        gateIndex < markerIndex,
        `release-notes gate must run before ${marker}`,
      );
    }
  });
});

describe("prettier policy wiring", () => {
  // The programmatic API does not auto-load .prettierrc; resolve the
  // override first and merge it into the per-call options.
  async function releaseNoteOptions(filepath) {
    const prettier = await import("prettier");
    const config = await prettier.resolveConfig(filepath);
    return { ...config, filepath };
  }

  test("docs/releases markdown resolves proseWrap never while other markdown stays ignored", async () => {
    const prettier = await import("prettier");
    const config = await prettier.resolveConfig(
      path.join(RELEASES_DIR, "v0.0.16.md"),
    );
    assert.equal(config?.proseWrap, "never");

    const ignorePath = path.join(REPO_ROOT, ".prettierignore");
    for (const file of [
      "docs/releases/v0.0.16.md",
      "docs/releases/TEMPLATE.md",
    ]) {
      const info = await prettier.getFileInfo(path.join(REPO_ROOT, file), {
        ignorePath,
      });
      assert.equal(
        info.ignored,
        false,
        `${file} must be covered by the format gate`,
      );
    }
    for (const file of ["README.md", "docs/README.md", "docs/SPEC.md"]) {
      const info = await prettier.getFileInfo(path.join(REPO_ROOT, file), {
        ignorePath,
      });
      assert.equal(
        info.ignored,
        true,
        `${file} must stay outside the format gate`,
      );
    }
  });

  test("prettier rejects hard-wrapped release prose and accepts the unwrapped form", async () => {
    const prettier = await import("prettier");
    const options = await releaseNoteOptions("docs/releases/v0.0.99.md");
    const wrapped =
      "# Exam v0.0.99\n\nA paragraph manually broken at column 76\nfor no reason.\n";
    const unwrapped =
      "# Exam v0.0.99\n\nA paragraph manually broken at column 76 for no reason.\n";
    assert.equal(await prettier.check(wrapped, options), false);
    assert.equal(await prettier.check(unwrapped, options), true);
  });

  test("formatting is idempotent (re-running produces no new diff)", async () => {
    const prettier = await import("prettier");
    const options = await releaseNoteOptions("docs/releases/v0.0.99.md");
    const wrapped =
      "# Exam v0.0.99\n\n- Item text wrapped\n  at 76 columns.\n- Second item.\n";
    const once = await prettier.format(wrapped, options);
    const twice = await prettier.format(once, options);
    assert.equal(twice, once);
    assert.equal(await prettier.check(once, options), true);
  });

  test("repository release notes are prettier-clean after the historical repair", async () => {
    const prettier = await import("prettier");
    for (const file of listReleaseNoteFiles(RELEASES_DIR)) {
      const relative = path.relative(REPO_ROOT, file);
      const source = readFileSync(file, "utf8");
      const options = await releaseNoteOptions(relative);
      assert.ok(
        await prettier.check(source, options),
        `${relative} must be prettier-clean`,
      );
    }
  });
});
