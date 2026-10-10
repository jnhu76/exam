/**
 * RevisionView implementations.
 *
 * The resolver and builder observe a revision through this interface, never
 * through direct filesystem walks — that is what makes STALE/AMBIGUOUS
 * detection testable and the build independent of working-directory state.
 */

import { execFileSync } from "node:child_process";
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
