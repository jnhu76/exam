/**
 * Git-backed view admission (ATLAS-IR-060).
 *
 * The extractor reads product sources out of the object store at the observed
 * revision and derives freshness from history. A repository that cannot supply
 * either has to be refused loudly: the alternative — observing it as empty — is
 * a silently *different* snapshot, which is how a depth-1 CI checkout rebuilt
 * the wrong body hash instead of failing.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GitRevisionView } from "../src/view/revision.js";

const scratch: string[] = [];

/** A throwaway repository with one commit, so history exists to be missing. */
function tempRepo(): { dir: string; head: string } {
  const dir = mkdtempSync(join(tmpdir(), "atlas-gitview-"));
  scratch.push(dir);
  const git = (...args: string[]): string =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8" }).trim();
  git("init", "-q", ".");
  writeFileSync(join(dir, "file.txt"), "content\n");
  git("add", "file.txt");
  git(
    "-c",
    "user.email=atlas@test",
    "-c",
    "user.name=atlas",
    "commit",
    "-qm",
    "init",
  );
  return { dir, head: git("rev-parse", "HEAD") };
}

afterEach(() => {
  while (scratch.length > 0) {
    rmSync(scratch.pop() as string, { recursive: true, force: true });
  }
});

describe("GitRevisionView admission", () => {
  it("observes a repository that holds the revision and its history", () => {
    const { dir, head } = tempRepo();
    const view = new GitRevisionView(head, dir);
    expect(view.readFile("file.txt")).toBe("content\n");
    expect(view.commitExists(head)).toBe(true);
  });

  it("refuses a shallow repository instead of observing every file as missing", () => {
    const { dir, head } = tempRepo();
    writeFileSync(join(dir, ".git", "shallow"), `${head}\n`);
    expect(() => new GitRevisionView(head, dir)).toThrow(/shallow repository/);
  });

  it("refuses a revision the repository does not contain", () => {
    const { dir } = tempRepo();
    expect(() => new GitRevisionView("f".repeat(40), dir)).toThrow(
      /not present in this repository/,
    );
  });
});
