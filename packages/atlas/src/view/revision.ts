/**
 * RevisionView implementations.
 *
 * The resolver and builder observe a revision through this interface, never
 * through direct filesystem walks — that is what makes STALE/AMBIGUOUS
 * detection testable and the build independent of working-directory state.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { RevisionView } from "../sref/resolve.js";

/** In-memory view — tests and synthetic fixtures. */
export class MemoryRevisionView implements RevisionView {
  constructor(
    readonly revision: string,
    private readonly files: Map<string, string>,
  ) {}

  fileExists(path: string): boolean {
    return this.files.has(path);
  }

  readFile(path: string): string | undefined {
    return this.files.get(path);
  }
}

/**
 * Git-backed view: reads blobs via `git show <revision>:<path>` so the
 * observed bytes are pinned to the revision, never to the working tree
 * state. Runs against the repository that contains the atlas package.
 */
export class GitRevisionView implements RevisionView {
  constructor(
    readonly revision: string,
    private readonly repoRoot: string,
  ) {}

  fileExists(path: string): boolean {
    try {
      execFileSync("git", ["cat-file", "-e", `${this.revision}:${path}`], {
        cwd: this.repoRoot,
        stdio: "ignore",
      });
      return true;
    } catch {
      return false;
    }
  }

  readFile(path: string): string | undefined {
    try {
      return execFileSync("git", ["show", `${this.revision}:${path}`], {
        cwd: this.repoRoot,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      });
    } catch {
      return undefined;
    }
  }

  commitExists(sha: string): boolean {
    try {
      execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], {
        cwd: this.repoRoot,
        stdio: "ignore",
      });
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Composite view: the atlas package's OWN files (curation input, capture
 * artifact, generated snapshot) are part of the PR under construction and
 * are read from the working tree; everything else is read pinned to the
 * observed revision. This breaks the snapshot-SHA circularity (R1 handoff
 * §6) without weakening pinning: observed product sources always come from
 * the git object store at SOURCE_SHA.
 */
export class CompositeRevisionView implements RevisionView {
  constructor(
    readonly revision: string,
    private readonly pinned: RevisionView,
    private readonly workingTreePrefix: string,
    private readonly workingTreeRoot: string,
  ) {}

  private isWorkingTreePath(path: string): boolean {
    return path.startsWith(this.workingTreePrefix);
  }

  fileExists(path: string): boolean {
    if (this.isWorkingTreePath(path)) {
      return existsSync(join(this.workingTreeRoot, path));
    }
    return this.pinned.fileExists(path);
  }

  readFile(path: string): string | undefined {
    if (this.isWorkingTreePath(path)) {
      try {
        return readFileSync(join(this.workingTreeRoot, path), "utf8");
      } catch {
        return undefined;
      }
    }
    return this.pinned.readFile(path);
  }

  commitExists(sha: string): boolean {
    return this.pinned.commitExists?.(sha) ?? false;
  }
}
