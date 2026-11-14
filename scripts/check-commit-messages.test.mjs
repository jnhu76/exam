import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, test } from "node:test";
import commitlintLint from "@commitlint/lint";

import {
  FIXUP_PATTERN,
  classifyPrCommits,
  createEngine,
  lintPushMessage,
  parseRefLines,
} from "./check-commit-messages.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const SCRIPT = path.join(SCRIPT_DIR, "check-commit-messages.mjs");
const CONFIG = path.join(REPO_ROOT, "commitlint.config.mjs");

const ZERO = "0000000000000000000000000000000000000000";

const ALL_TYPES = [
  "feat",
  "fix",
  "refactor",
  "perf",
  "docs",
  "test",
  "build",
  "ci",
  "chore",
  "style",
  "revert",
];

/** Shared commitlint engine loaded once from the repository config. */
let engine;

/** Temp git fixtures created during the run, removed on teardown. */
const fixtures = [];

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function commit(cwd, message, ...extra) {
  git(cwd, "commit", "--allow-empty", "-m", message, ...extra);
}

/**
 * A real remote/work clone pair. The work clone has no hooks installed, so
 * commits with arbitrary messages can be constructed freely; the gate script
 * is invoked directly with simulated pre-push stdin, exactly like
 * `.husky/pre-push` does.
 */
function initFixture() {
  const base = mkdtempSync(path.join(tmpdir(), "commit-governance-"));
  const remote = path.join(base, "remote.git");
  const work = path.join(base, "work");
  execFileSync("git", ["init", "--bare", "-b", "master", remote], {
    encoding: "utf8",
  });
  execFileSync("git", ["clone", remote, work], { encoding: "utf8" });
  git(work, "config", "user.email", "governance@example.invalid");
  git(work, "config", "user.name", "Governance Test");
  fixtures.push(base);
  return { base, remote, work };
}

/** One pre-push stdin line: `<localRef> <localSha> <remoteRef> <remoteSha>`. */
function pushLine(work, branch, { newBranch = false } = {}) {
  const local = git(work, "rev-parse", `refs/heads/${branch}`);
  const remote = newBranch
    ? ZERO
    : git(work, "rev-parse", `refs/remotes/origin/${branch}`);
  return `refs/heads/${branch} ${local} refs/heads/${branch} ${remote}\n`;
}

/** Run the gate script inside `cwd` (defaults to a fixture work clone). */
function runGate(cwd, { stdin = "", args = [] } = {}) {
  return spawnSync(process.execPath, [SCRIPT, "--config", CONFIG, ...args], {
    cwd,
    input: stdin,
    encoding: "utf8",
  });
}

before(async () => {
  engine = await createEngine(CONFIG);
});

after(() => {
  for (const base of fixtures) {
    rmSync(base, { recursive: true, force: true });
  }
});

/**
 * Commit-time semantics mirror the commit-msg hook: the config's own
 * `ignores` apply (fixup!/squash! tolerated locally for rebase workflows).
 */
async function lintCommitTime(message) {
  return commitlintLint(message, engine.rules, {
    parserOpts: engine.parserOpts,
    plugins: engine.plugins,
    ignores: engine.commitTimeIgnores,
    defaultIgnores: false,
  });
}

describe("commitlint config — commit-time semantics (scenario 1, 2, 4)", () => {
  test("accepts every one of the 11 whitelisted types", async () => {
    for (const type of ALL_TYPES) {
      const result = await lintCommitTime(`${type}(exam): example subject`);
      assert.deepEqual(
        result.errors.map((e) => e.name),
        [],
        `${type} must be valid, got: ${JSON.stringify(result.errors)}`,
      );
    }
  });

  test("accepts spec examples, breaking-change markers, revert type and Chinese subjects", async () => {
    const messages = [
      "feat(exam): support timed exam recovery",
      "fix(otel): correct telemetry configuration",
      "docs(api): clarify error response contract",
      "chore(merge): integrate reviewed W6 changes into W7",
      "ci(github): enforce commit message policy",
      "feat(api)!: change the public error contract\n\nBREAKING CHANGE: callers must read error.code",
      "revert(deploy): remove the observability stack",
      "fix(otel): 修正遥测配置",
      `feat(exam): ${"x".repeat(72 - "feat(exam): ".length)}`,
    ];
    for (const message of messages) {
      const result = await lintCommitTime(message);
      assert.deepEqual(
        result.errors.map((e) => e.name),
        [],
        `${message} must be valid, got: ${JSON.stringify(result.errors)}`,
      );
    }
  });

  test("rejects missing scope, illegal type, case errors and over-long headers", async () => {
    const cases = [
      "feat: add recovery", // scope missing
      "Feat(exam): add recovery", // type case
      "wip(exam): x", // type not whitelisted
      "update(exam): x",
      "misc(exam): x",
      "chore(): update tools", // empty scope
      "Update files", // no type at all
      "fix some bugs",
      `feat(exam): ${"x".repeat(73 - "feat(exam): ".length)}`, // 73-char header
      `Merge branch 'otel/w6' into otel/w7`, // merge default message must not be ignored
      `Revert "feat(exam): add recovery"`, // git default revert message must be edited
      "fix(2fa): x", // scope may not start with a digit
      "fix(Api): x", // scope case
      "fix(a b): x", // scope charset
    ];
    for (const message of cases) {
      const result = await lintCommitTime(message);
      assert.notEqual(result.errors.length, 0, `${message} must be rejected`);
    }
  });

  test("allows fixup!/squash! locally for interactive rebase (scenario 5, commit side)", async () => {
    for (const message of [
      "fixup! feat(exam): support recovery",
      "squash! feat(exam): support recovery",
    ]) {
      const result = await lintCommitTime(message);
      assert.deepEqual(
        result.errors.map((e) => e.name),
        [],
        `${message} must be tolerated at commit time`,
      );
    }
  });
});

describe("push-time linting — nothing is ignored (scenario 5, push side)", () => {
  test("rejects fixup! and squash! with a dedicated rule", async () => {
    for (const message of ["fixup! feat(exam): x", "squash! feat(exam): x"]) {
      const result = await lintPushMessage(engine, message);
      assert.equal(result.valid, false, `${message} must fail at push time`);
      assert.ok(
        result.errors.some((e) => e.name === "no-fixup-on-push"),
        `${message} must carry the no-fixup-on-push rule`,
      );
    }
  });

  test("accepts a conforming message and reports commitlint rule names otherwise", async () => {
    assert.equal(
      (await lintPushMessage(engine, "feat(exam): support recovery")).valid,
      true,
    );
    const bad = await lintPushMessage(
      engine,
      "Merge branch 'otel/w6' into otel/w7",
    );
    assert.equal(bad.valid, false);
    assert.ok(
      bad.errors.some((e) => e.name === "type-enum" || e.name === "type-empty"),
    );
  });
});

describe("parseRefLines", () => {
  test("parses standard pre-push lines, blank lines and deletions", () => {
    const updates = parseRefLines(
      `refs/heads/w7 ${"a".repeat(40)} refs/heads/w7 ${ZERO}\n\n` +
        `refs/heads/master ${"b".repeat(40)} refs/heads/master ${"c".repeat(40)}\n` +
        `refs/heads/gone ${ZERO} refs/heads/gone ${"d".repeat(40)}\n`,
    );
    assert.equal(updates.length, 3);
    assert.equal(updates[0].remoteSha, ZERO);
    assert.equal(updates[2].localSha, ZERO);
  });

  test("fails closed on malformed input", () => {
    assert.throws(() => parseRefLines("not-a-ref-line\n"));
  });
});

describe("classifyPrCommits — merge exemption by topology (scenario 3, 7, 8)", () => {
  const A = { sha: "a1", message: "feat(exam): a", parents: ["a0"] };
  const B = { sha: "b1", message: "feat(exam): b", parents: ["a1"] };

  test("checks normal commits and sibling merge commits", () => {
    const siblingMerge = {
      sha: "m1",
      message: "Merge branch 'otel/w6' into otel/w7",
      parents: ["a1", "b1"],
    };
    const { toCheck, skipped } = classifyPrCommits({
      title: "feat(exam): pr",
      commits: [A, B, siblingMerge],
    });
    assert.deepEqual(
      toCheck.map((c) => c.sha),
      ["a1", "b1", "m1"],
    );
    assert.deepEqual(skipped, []);
  });

  test("exempts integration merges whose one side is already outside the PR (CI-only synthetic merge)", () => {
    // A merge of the PR base branch into the feature branch: one parent is not
    // part of the PR's new commits, so its message is GitHub/CI-controlled.
    const integrationMerge = {
      sha: "m2",
      message: "Merge branch 'master' into otel/w7",
      parents: ["b1", "outside-pr"],
    };
    const { toCheck, skipped } = classifyPrCommits({
      title: "feat(exam): pr",
      commits: [A, B, integrationMerge],
    });
    assert.deepEqual(
      toCheck.map((c) => c.sha),
      ["a1", "b1"],
    );
    assert.deepEqual(
      skipped.map((c) => c.sha),
      ["m2"],
    );
  });
});

describe("pre-push integration against real git repositories", () => {
  test("scenario 3: rejects a real merge commit created with git's default message", () => {
    const { work } = initFixture();
    commit(work, "feat(api): initial work");
    git(work, "push", "-q", "-u", "origin", "master");

    git(work, "checkout", "-q", "-b", "otel/w6");
    commit(work, "feat(otel): w6 payload");
    git(work, "checkout", "-q", "master");
    git(work, "checkout", "-q", "-b", "otel/w7");
    commit(work, "feat(otel): w7 receiver");
    // A real two-parent merge of two new branches with git's default subject.
    git(
      work,
      "merge",
      "--no-ff",
      "-m",
      "Merge branch 'otel/w6' into otel/w7",
      "otel/w6",
    );

    const result = runGate(work, {
      stdin: pushLine(work, "otel/w7", { newBranch: true }),
    });
    assert.notEqual(
      result.status,
      0,
      "push with a non-conforming merge commit must fail",
    );
    assert.match(result.stdout, /Merge branch 'otel\/w6' into otel\/w7/);
    assert.match(result.stdout, /type/);
  });

  test("scenario 3: accepts the same merge with a conforming chore(merge) message", () => {
    const { work } = initFixture();
    commit(work, "feat(api): initial work");
    git(work, "push", "-q", "-u", "origin", "master");

    git(work, "checkout", "-q", "-b", "otel/w6");
    commit(work, "feat(otel): w6 payload");
    git(work, "checkout", "-q", "master");
    git(work, "checkout", "-q", "-b", "otel/w7");
    commit(work, "feat(otel): w7 receiver");
    git(
      work,
      "merge",
      "--no-ff",
      "-m",
      "chore(merge): integrate reviewed W6 changes into W7",
      "otel/w6",
    );

    const result = runGate(work, {
      stdin: pushLine(work, "otel/w7", { newBranch: true }),
    });
    assert.notEqual(
      git(work, "rev-list", "--merges", "--count", "otel/w7"),
      0,
      "fixture must contain a real merge commit",
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
  });

  test("scenario 3: exempts integration merges of already-remote history (the 'for integration CI' pattern)", () => {
    const { work } = initFixture();
    commit(work, "feat(api): initial work");
    git(work, "push", "-q", "-u", "origin", "master");

    git(work, "checkout", "-q", "-b", "otel/w7");
    commit(work, "feat(otel): w7 receiver");
    // Advance remote master, then merge it back in: one parent side is
    // already on the remote, so the merge message is exempt.
    git(work, "checkout", "-q", "master");
    commit(work, "fix(api): follow-up on master");
    git(work, "push", "-q", "origin", "master");
    git(work, "checkout", "-q", "otel/w7");
    git(
      work,
      "merge",
      "--no-ff",
      "-m",
      "Merge master into otel/w7 for integration CI",
      "origin/master",
    );

    const result = runGate(work, {
      stdin: pushLine(work, "otel/w7", { newBranch: true }),
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  });

  test("scenario 6: new branch with one bad commit fails and prints self-correcting guidance", () => {
    const { work } = initFixture();
    commit(work, "feat(api): initial work");
    git(work, "push", "-q", "-u", "origin", "master");
    git(work, "checkout", "-q", "-b", "feature");
    commit(work, "Update files");

    const result = runGate(work, {
      stdin: pushLine(work, "feature", { newBranch: true }),
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /Update files/);
    assert.match(result.stdout, /type\(scope\): subject/);
    assert.match(result.stdout, /git commit --amend|git rebase -i/);
  });

  test("scenario 6: new branch with only conforming commits passes", () => {
    const { work } = initFixture();
    commit(work, "feat(api): initial work");
    git(work, "push", "-q", "-u", "origin", "master");
    git(work, "checkout", "-q", "-b", "feature");
    commit(work, "fix(web): correct login redirect");

    const result = runGate(work, {
      stdin: pushLine(work, "feature", { newBranch: true }),
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  });

  test("scenario 6: existing remote branch — only the newly added commits are checked", () => {
    const { work } = initFixture();
    commit(work, "feat(api): initial work");
    git(work, "push", "-q", "-u", "origin", "master");
    git(work, "checkout", "-q", "-b", "feature");
    commit(work, "feat(web): first push");
    git(work, "push", "-q", "-u", "origin", "feature");

    commit(work, "some later work");
    const result = runGate(work, { stdin: pushLine(work, "feature") });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /some later work/);
    assert.doesNotMatch(result.stdout, /first push/);
  });

  test("scenario 6: empty push range and branch deletion pass without checks", () => {
    const { work } = initFixture();
    commit(work, "feat(api): initial work");
    git(work, "push", "-q", "-u", "origin", "master");

    // No-op update: local tip equals the remote tip.
    const noop = `refs/heads/master ${git(work, "rev-parse", "refs/heads/master")} refs/heads/master ${git(work, "rev-parse", "refs/remotes/origin/master")}\n`;
    assert.equal(runGate(work, { stdin: noop }).status, 0);

    const deletion = `refs/heads/master ${ZERO} refs/heads/master ${git(work, "rev-parse", "refs/remotes/origin/master")}\n`;
    assert.equal(runGate(work, { stdin: deletion }).status, 0);
  });

  test("scenario 6: multi-ref push validates each shared commit exactly once", () => {
    const { work } = initFixture();
    commit(work, "feat(api): initial work");
    git(work, "push", "-q", "-u", "origin", "master");

    git(work, "checkout", "-q", "-b", "w2");
    commit(work, "shared commit without format");
    git(work, "checkout", "-q", "-b", "w3");
    commit(work, "w3 commit without format");

    const stdin =
      pushLine(work, "w2", { newBranch: true }) +
      pushLine(work, "w3", { newBranch: true });
    const result = runGate(work, { stdin });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /shared commit without format/);
    assert.match(result.stdout, /w3 commit without format/);
    const occurrences =
      result.stdout.match(/shared commit without format/g)?.length ?? 0;
    assert.equal(
      occurrences,
      1,
      "shared commit must be reported once, not per ref",
    );
  });

  test("scenario 7: commits already on the remote are never re-validated", () => {
    const { work } = initFixture();
    commit(work, "feat(api): initial work");
    git(work, "push", "-q", "-u", "origin", "master");
    // A legacy non-conforming commit reaches the remote without the gate
    // (direct git push, no hooks in this fixture).
    commit(work, "Legacy historical commit");
    git(work, "push", "-q", "origin", "master");

    git(work, "checkout", "-q", "-b", "feature");
    commit(work, "feat(web): new conforming work");
    const result = runGate(work, {
      stdin: pushLine(work, "feature", { newBranch: true }),
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.doesNotMatch(result.stdout, /Legacy historical commit/);
  });

  test("scenario 7: stacked branch — base branch commits are not re-validated", () => {
    const { work } = initFixture();
    commit(work, "feat(api): initial work");
    git(work, "push", "-q", "-u", "origin", "master");

    git(work, "checkout", "-q", "-b", "w1");
    commit(work, "feat(otel): w1 telemetry");
    git(work, "push", "-q", "-u", "origin", "w1");

    git(work, "checkout", "-q", "-b", "w2");
    commit(work, "w2 raw message");
    const result = runGate(work, {
      stdin: pushLine(work, "w2", { newBranch: true }),
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /w2 raw message/);
    assert.doesNotMatch(result.stdout, /w1 telemetry/);
  });

  test("scenario 5: fixup commits are rejected at push with an autosquash hint", () => {
    const { work } = initFixture();
    commit(work, "feat(api): initial work");
    git(work, "push", "-q", "-u", "origin", "master");
    git(work, "checkout", "-q", "-b", "feature");
    commit(work, "feat(web): base change");
    commit(work, "fixup! base change");

    const result = runGate(work, {
      stdin: pushLine(work, "feature", { newBranch: true }),
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /fixup!/);
    assert.match(result.stdout, /autosquash/);
  });
});

describe("--title preflight mode (agent-era pre-commit check)", () => {
  test("accepts a conforming title and rejects a non-conforming or fixup title", () => {
    const { work } = initFixture();
    assert.equal(
      runGate(work, { args: ["--title", "feat(api): add recovery"] }).status,
      0,
    );
    assert.notEqual(
      runGate(work, { args: ["--title", "Update files"] }).status,
      0,
    );
    assert.notEqual(
      runGate(work, { args: ["--title", "feat: add recovery"] }).status,
      0,
    );
    const fixup = runGate(work, { args: ["--title", "fixup! feat(api): x"] });
    assert.notEqual(fixup.status, 0);
    assert.match(fixup.stdout, /no-fixup-on-push/);
  });
});

describe("--range mode", () => {
  test("checks every commit in an explicit range, merge commits included", () => {
    const { work } = initFixture();
    commit(work, "feat(api): first");
    commit(work, "second commit without format");
    const first = git(work, "rev-list", "--max-parents=0", "HEAD");

    const result = runGate(work, { args: ["--range", `${first}..HEAD`] });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /second commit without format/);
    assert.doesNotMatch(result.stdout, /feat\(api\): first/);
  });
});

describe("--pr-data mode — offline PR payload validation (scenario 8)", () => {
  function runWithPayload(fixture, payload) {
    const file = path.join(fixture.base, "pr-payload.json");
    writeFileSync(file, JSON.stringify(payload), "utf8");
    return runGate(fixture.work, { args: ["--pr-data", file] });
  }

  test("fails on a non-conforming PR title and commit, passes conforming PRs", () => {
    const fixture = initFixture();

    const bad = runWithPayload(fixture, {
      title: "Update files",
      commits: [{ sha: "a1", message: "feat(exam): fine", parents: ["a0"] }],
    });
    assert.notEqual(bad.status, 0);
    assert.match(bad.stdout, /PR title/);

    const good = runWithPayload(fixture, {
      title: "feat(exam): support timed exam recovery",
      commits: [
        { sha: "a1", message: "feat(exam): recovery core", parents: ["a0"] },
        {
          sha: "m1",
          message: "Merge branch 'master' into otel/w7",
          parents: ["a1", "base-side"],
        },
      ],
    });
    assert.equal(good.status, 0, good.stdout + good.stderr);
  });
});

describe("FIXUP_PATTERN", () => {
  test("matches git's fixup!/squash! prefixes only", () => {
    assert.ok(FIXUP_PATTERN.test("fixup! feat(x): y"));
    assert.ok(FIXUP_PATTERN.test("squash! feat(x): y"));
    assert.ok(!FIXUP_PATTERN.test("fixup(x): not a fixup commit"));
    assert.ok(!FIXUP_PATTERN.test("feat(x): support fixup workflows"));
  });
});
