/**
 * Mutation / negative-control contract for the #614 G5 deterministic guards.
 *
 * Each guard must fail on the historical failure shape it was adopted for
 * (mutation) and accept the similar-but-valid shape (negative control).
 * A guard with no failure proof is not authorized evidence (#614 §9).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const GUARD = (name) => join(import.meta.dirname, `${name}.mjs`);

function run(name, root) {
  return execFileSync(process.execPath, [GUARD(name), root], {
    encoding: "utf8",
    timeout: 60_000,
  });
}

function runExpectFail(name, root) {
  try {
    execFileSync(process.execPath, [GUARD(name), root], {
      encoding: "utf8",
      timeout: 60_000,
    });
  } catch (e) {
    return e;
  }
  return null;
}

const TRACKER_SURFACES = (n) => ({
  "docs/README.md":
    "| Current backlog sequencing / disposition | Active roadmap tracker; currently GitHub Issue [#" +
    n +
    "](https://github.com/jnhu76/exam/issues/" +
    n +
    ") |\n",
  "docs/roadmap/current.md":
    "> Current sequencing and disposition live in GitHub Issue\n> [#" +
    n +
    "](https://github.com/jnhu76/exam/issues/" +
    n +
    ")\n",
  "docs/roadmap/post-mvp-issues.md":
    "> sequencing and disposition authority is\n> [#" +
    n +
    "](https://github.com/jnhu76/exam/issues/" +
    n +
    ")\n",
  "CONTRIBUTING.md":
    "ordering lives in the active roadmap tracker, currently [#" +
    n +
    "](https://github.com/jnhu76/exam/issues/" +
    n +
    ").\n",
  "README.md":
    "| current work is sequenced by [#" +
    n +
    "](https://github.com/jnhu76/exam/issues/" +
    n +
    ") |\n",
  "README.zh-CN.md":
    "| 当前工作由 [#" +
    n +
    "](https://github.com/jnhu76/exam/issues/" +
    n +
    ") 排序 |\n",
});

function writeAll(root, files) {
  for (const [rel, content] of Object.entries(files))
    writeDocs(root, rel, content);
}

function fixture() {
  return mkdtempSync(join(tmpdir(), "exam-guard-"));
}

function writeDocs(root, rel, content) {
  const p = join(root, rel);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, content);
}

test("roadmap-tracker: rejects a surface still pointing at the old tracker", () => {
  const root = fixture();
  const files = TRACKER_SURFACES("584");
  files["docs/roadmap/current.md"] =
    "> Current sequencing and disposition live in GitHub Issue\n> [#552](https://github.com/jnhu76/exam/issues/552)\n";
  writeAll(root, files);
  const e = runExpectFail("roadmap-tracker-contract", root);
  assert.ok(e, "guard passed on the R1 mutation (surface on the old tracker)");
  assert.match(
    String(e.stderr),
    /names #552 but the canonical tracker is #584/,
  );
  rmSync(root, { recursive: true, force: true });
});

test("roadmap-tracker: accepts a historical predecessor mention (negative control)", () => {
  const root = fixture();
  const files = TRACKER_SURFACES("584");
  files["docs/roadmap/current.md"] =
    "> Current sequencing and disposition live in GitHub Issue\n> [#584](https://github.com/jnhu76/exam/issues/584) — successor to the completed #552 roadmap.\n";
  writeAll(root, files);
  const out = run("roadmap-tracker-contract", root);
  assert.match(out, /PASS/);
  rmSync(root, { recursive: true, force: true });
});

test("adr-status-uniqueness: rejects the ADR-010 dual-status form (F-1 mutation)", () => {
  const root = fixture();
  writeDocs(
    root,
    "docs/adr/ADR-001-redis.md",
    "> **Status:** Proposed\n\n## Status\n\n**Accepted — implemented.**\n",
  );
  const e = runExpectFail("adr-status-uniqueness-contract", root);
  assert.ok(e, "guard passed on the dual-status mutation");
  assert.match(
    String(e.stderr),
    /Proposed.*conflicts.*Accepted|Accepted.*conflicts.*Proposed|conflicting|conflicts/,
  );
  rmSync(root, { recursive: true, force: true });
});

test("adr-status-uniqueness: accepts scoped statuses and historical prose (negative control)", () => {
  const root = fixture();
  writeDocs(
    root,
    "docs/adr/ADR-002-websocket-sse.md",
    "## Status\n\n**ACCEPTED** — the classification policy.\n\nThe generic platform remains **DEFERRED**.\nPreviously PROPOSED in revision 1; that framing was superseded.\n",
  );
  const out = run("adr-status-uniqueness-contract", root);
  assert.match(out, /PASS/);
  rmSync(root, { recursive: true, force: true });
});

test("docs-router: rejects a range that stops before the newest ADR (DOC-005 mutation)", () => {
  const root = fixture();
  writeDocs(
    root,
    "docs/README.md",
    "| [`adr/ADR-001-redis.md`](adr/ADR-001-redis.md) … [`ADR-002-x.md`](adr/ADR-002-x.md) | Formal architecture decisions |\n",
  );
  writeDocs(
    root,
    "docs/adr/README.md",
    "| [ADR-001](ADR-001-redis.md) | t | ACCEPTED |\n| [ADR-002](ADR-002-x.md) | t | ACCEPTED |\n| [ADR-003](ADR-003-y.md) | t | ACCEPTED |\n",
  );
  writeDocs(root, "docs/adr/ADR-001-redis.md", "x\n");
  writeDocs(root, "docs/adr/ADR-002-x.md", "x\n");
  writeDocs(root, "docs/adr/ADR-003-y.md", "x\n");
  const e = runExpectFail("docs-router-contract", root);
  assert.ok(e, "guard passed on the stale-range mutation");
  assert.match(String(e.stderr), /range ends at ADR-002/);
  rmSync(root, { recursive: true, force: true });
});

test("docs-router: rejects an ADR missing from the numeric index", () => {
  const root = fixture();
  writeDocs(
    root,
    "docs/README.md",
    "| [`adr/ADR-001-redis.md`](adr/ADR-001-redis.md) … [`ADR-002-x.md`](adr/ADR-002-x.md) | Formal architecture decisions |\n",
  );
  writeDocs(
    root,
    "docs/adr/README.md",
    "| [ADR-001](ADR-001-redis.md) | t | ACCEPTED |\n",
  );
  writeDocs(root, "docs/adr/ADR-001-redis.md", "x\n");
  writeDocs(root, "docs/adr/ADR-002-x.md", "x\n");
  const e = runExpectFail("docs-router-contract", root);
  assert.ok(e, "guard passed on the missing-index-row mutation");
  assert.match(String(e.stderr), /does not link ADR-002-x\.md/);
  rmSync(root, { recursive: true, force: true });
});

test("docs-router: accepts a complete, current router (negative control)", () => {
  const root = fixture();
  writeDocs(
    root,
    "docs/README.md",
    "| [`adr/ADR-001-redis.md`](adr/ADR-001-redis.md) … [`ADR-002-x.md`](adr/ADR-002-x.md) | Formal architecture decisions |\n",
  );
  writeDocs(
    root,
    "docs/adr/README.md",
    "| [ADR-001](ADR-001-redis.md) | t | ACCEPTED |\n| [ADR-002](ADR-002-x.md) | t | ACCEPTED |\n",
  );
  writeDocs(root, "docs/adr/ADR-001-redis.md", "x\n");
  writeDocs(root, "docs/adr/ADR-002-x.md", "x\n");
  const out = run("docs-router-contract", root);
  assert.match(out, /PASS/);
  rmSync(root, { recursive: true, force: true });
});

test("verification-marker: rejects an unresolvable SHA", () => {
  const root = mkdtempSync(join(tmpdir(), "exam-guard-git-"));
  writeDocs(
    root,
    "docs/x.md",
    "Last verified against: deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n\nVerification scope: current as of the write.\n",
  );
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  execFileSync(
    "git",
    [
      "-c",
      "user.email=t@t",
      "-c",
      "user.name=t",
      "commit",
      "--allow-empty",
      "-m",
      "init",
      "--quiet",
    ],
    { cwd: root },
  );
  const e = runExpectFail("verification-marker-contract", root);
  assert.ok(e, "guard passed on an unresolvable marker SHA");
  assert.match(String(e.stderr), /does not resolve to a commit/);
  rmSync(root, { recursive: true, force: true });
});

test("verification-marker: rejects an ambiguous marker with no disposition", () => {
  const root = mkdtempSync(join(tmpdir(), "exam-guard-git-"));
  writeDocs(
    root,
    "docs/x.md",
    "Last verified against: 0000000000000000000000000000000000000000\n",
  );
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  execFileSync(
    "git",
    [
      "-c",
      "user.email=t@t",
      "-c",
      "user.name=t",
      "commit",
      "--allow-empty",
      "-m",
      "init",
      "--quiet",
    ],
    { cwd: root },
  );
  const e = runExpectFail("verification-marker-contract", root);
  assert.ok(e, "guard passed on a disposition-less marker");
  assert.match(
    String(e.stderr),
    /no current-vs-historical disposition|does not resolve/,
  );
  rmSync(root, { recursive: true, force: true });
});

test("verification-marker: accepts a dated historical snapshot with a disposition (negative control)", () => {
  const root = mkdtempSync(join(tmpdir(), "exam-guard-git-"));
  const sha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: initGit(root),
    encoding: "utf8",
  }).trim();
  writeDocs(
    root,
    "docs/x.md",
    `Last verified against: ${sha}\n\nVerification scope:\nPoint-in-time snapshot; delivery-state claims re-verified 2026-09-25; other sections retain their baseline.\n`,
  );
  const out = run("verification-marker-contract", root);
  assert.match(out, /PASS/);
  rmSync(root, { recursive: true, force: true });
});

function initGit(root) {
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  execFileSync(
    [
      "git",
      "-c",
      "user.email=t@t",
      "-c",
      "user.name=t",
      "commit",
      "--allow-empty",
      "-m",
      "init",
      "--quiet",
    ].join(" "),
    { cwd: root, shell: true },
  );
  return root;
}
