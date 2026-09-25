/**
 * Mutation / negative-control contract for the #614 G5 deterministic guards.
 *
 * Each guard must fail on the historical failure shape it was adopted for
 * (mutation) and accept the similar-but-valid shape (negative control).
 * A guard with no failure proof is not authorized evidence (#614 §9).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { judgeTrackerIssue } from "./roadmap-tracker-contract.mjs";

const GUARD = (name) => join(import.meta.dirname, `${name}.mjs`);

function run(name, root, envOverrides) {
  return execFileSync(process.execPath, [GUARD(name), root], {
    encoding: "utf8",
    timeout: 60_000,
    env: envOverrides ? { ...process.env, ...envOverrides } : process.env,
  });
}

function runExpectFail(name, root, envOverrides) {
  try {
    execFileSync(process.execPath, [GUARD(name), root], {
      encoding: "utf8",
      timeout: 60_000,
      env: envOverrides ? { ...process.env, ...envOverrides } : process.env,
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
  // Surface agreement is a docs relation; run in local mode (CI cleared) so
  // the live GitHub oracle takes its clearly reported SKIP path.
  const out = run("roadmap-tracker-contract", root, {
    CI: "",
    GITHUB_ACTIONS: "",
  });
  assert.match(out, /PASS/);
  rmSync(root, { recursive: true, force: true });
});

test("roadmap-tracker: live oracle rejects a CLOSED canonical issue even when all surfaces agree", () => {
  assert.match(
    judgeTrackerIssue("closed\t[ROADMAP][CURRENT] #584 roadmap", "584"),
    /is closed, not open/,
  );
});

test("roadmap-tracker: live oracle rejects an OPEN issue without the [ROADMAP][CURRENT] title", () => {
  assert.match(
    judgeTrackerIssue("open\tBacklog sequencing", "584"),
    /not titled \[ROADMAP\]\[CURRENT\]/,
  );
});

test("roadmap-tracker: live oracle accepts OPEN + [ROADMAP][CURRENT] (negative control)", () => {
  assert.equal(
    judgeTrackerIssue("open\t[ROADMAP][CURRENT] #584 roadmap", "584"),
    null,
  );
});

test("roadmap-tracker: fails closed in CI when the live oracle cannot run", () => {
  const root = fixture();
  writeAll(root, TRACKER_SURFACES("584"));
  const e = runExpectFail("roadmap-tracker-contract", root, {
    CI: "true",
    GITHUB_ACTIONS: "true",
  });
  assert.ok(e, "guard passed in CI without a runnable live oracle");
  assert.match(String(e.stderr), /live roadmap oracle could not run in CI/);
  rmSync(root, { recursive: true, force: true });
});

test("roadmap-tracker: executes the live gh oracle and rejects a closed tracker end-to-end", () => {
  const root = mkdtempSync(join(tmpdir(), "exam-guard-gh-"));
  writeAll(root, TRACKER_SURFACES("584"));
  // Fake gh seam: answers with a CLOSED tracker so the guard's verdict (not
  // a silent skip) is what gets proven.
  writeDocs(
    root,
    "bin/gh",
    "#!/bin/sh\nprintf 'closed\\t[ROADMAP][CURRENT] #584 roadmap\\n'\n",
  );
  chmodSync(join(root, "bin", "gh"), 0o755);
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  execFileSync(
    "git",
    ["remote", "add", "origin", "https://github.com/jnhu76/exam.git"],
    { cwd: root },
  );
  const e = runExpectFail("roadmap-tracker-contract", root, {
    PATH: `${join(root, "bin")}:${process.env.PATH ?? ""}`,
    CI: "",
    GITHUB_ACTIONS: "",
  });
  assert.ok(
    e,
    "guard passed although the live gh oracle reported a closed tracker",
  );
  assert.match(String(e.stderr), /is closed, not open/);
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

test("adr-status-uniqueness: rejects an ADR with no document-level current status (zero-status mutation)", () => {
  const root = fixture();
  writeDocs(
    root,
    "docs/adr/ADR-003-statusless.md",
    "# ADR — Something\n\n## Context\n\nBody prose. A revision was previously Proposed and later dropped, but no document-level current status is declared anywhere.\n",
  );
  const e = runExpectFail("adr-status-uniqueness-contract", root);
  assert.ok(e, "guard passed on a statusless ADR");
  assert.match(
    String(e.stderr),
    /no recognizable document-level current status/,
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

test("verification-marker: associates the SHA with the marker, not arbitrary nearby prose (mutation)", () => {
  const root = mkdtempSync(join(tmpdir(), "exam-guard-git-"));
  const sha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: initGit(root),
    encoding: "utf8",
  }).trim();
  // The marker itself names no commit; the only resolvable SHA inside the
  // disposition window belongs to unrelated prose. A broad-window parser
  // would resolve it and wrongly PASS; the marker-scoped parser must fail.
  writeDocs(
    root,
    "docs/x.md",
    `Last verified against commit:\n\nVerification scope: baseline history lives in ${sha}; retained as evidence.\n`,
  );
  const e = runExpectFail("verification-marker-contract", root);
  assert.ok(
    e,
    "guard accepted a marker whose SHA association came from surrounding prose",
  );
  assert.match(String(e.stderr), /names no commit SHA/);
  rmSync(root, { recursive: true, force: true });
});

test("verification-marker: accepts a two-line marker whose value line carries the SHA (negative control)", () => {
  const root = mkdtempSync(join(tmpdir(), "exam-guard-git-"));
  const sha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: initGit(root),
    encoding: "utf8",
  }).trim();
  writeDocs(
    root,
    "docs/x.md",
    `Last verified against commit:\n${sha} (2026-09-25, corrective pass)\n\nVerification scope:\nPoint-in-time snapshot; delivery-state claims re-verified 2026-09-25; other sections retain their baseline.\n`,
  );
  const out = run("verification-marker-contract", root);
  assert.match(out, /PASS/);
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
