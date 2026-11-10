import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import {
  copyFile,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * EXSEM-014 lifecycle-state write boundary — permanent counterfactual
 * regression gate for the two name-anchored write funnels
 * (EXSEM014_LIFECYCLE_STATE_SEAM / EXSEM014_ASSIGNMENT_REVOKE_FUNNEL).
 *
 * Lifecycle state columns (`status`, `gradingStatus`) are written only
 * through the engine command funnel (EXSEM-014; ADR-005
 * lock-reconcile-assert-mutate). The repo layer narrows the generic
 * `update` input and exposes the named `updateIncludingLifecycleState`
 * seam; `pnpm lint:arch` anchors the seam (and the assignment-revoke
 * funnel) to a reviewed file allowlist so a future route or script that
 * grabs a repo handle cannot silently acquire a lifecycle writer. This
 * suite converts that rule into tests:
 *
 *   - the policy table is pinned (rule names, member-call anchored
 *     patterns, exact allowlists), so shrinking a list or renaming a
 *     rule fails here;
 *   - synthetic route-shaped witnesses that directly write the seam or
 *     `revokeAssignment` outside the allowlist are classified as
 *     violations; the as-built compliant call sites are not;
 *   - the REAL production tree scans clean through the same classifier
 *     the checker uses;
 *   - the REAL `node scripts/check-architecture.mjs` entry rejects both
 *     witnesses in a disposable `git worktree` and passes the pristine
 *     tree — the unit fixtures alone would not prove the checker is
 *     wired to the policy.
 *
 * Placement mirrors architectureBoundary.test.ts: apps/web is the DB-free
 * app suite and already hosts repo-level structural tests. The policy
 * module is loaded dynamically (apps/web's production `tsc -b` includes
 * test files while the Docker builder copies neither config/ nor
 * scripts/ — a static cross-root import would break the production image
 * build, TS2307).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");
const POLICY_PATH = join(REPO_ROOT, "config", "architecture-policy.mjs");
const BUILD_GRAPH_POLICY_PATH = join(
  REPO_ROOT,
  "config",
  "build-graph-policy.mjs",
);
const CHECKER_PATH = join(REPO_ROOT, "scripts", "check-architecture.mjs");

const SEAM_RULE = "EXSEM014_LIFECYCLE_STATE_SEAM";
const REVOKE_RULE = "EXSEM014_ASSIGNMENT_REVOKE_FUNNEL";

/**
 * The ratified allowlists, hardcoded as the normative expectation on
 * purpose: the test must fail if a rule silently grows or loses a
 * reviewed caller (or if a list is deleted outright).
 */
const SEAM_ALLOWED = [
  "apps/api/src/adapters/repoAdapters.ts",
  "packages/exam-engine/src/incidentCommands.ts",
];
const REVOKE_ALLOWED = [
  "packages/exam-engine/src/proctorAssignmentCommands.ts",
  "apps/api/src/routes/teacherAssignments.admin.ts",
  "apps/api/src/routes/graderAssignments.admin.ts",
];

interface LifecycleStateWriteRule {
  readonly rule: string;
  readonly pattern: RegExp;
  readonly allowedFiles: readonly string[];
  readonly rationale: string;
}

interface LifecycleStateWritePolicy {
  readonly LIFECYCLE_STATE_WRITE_RULES: readonly LifecycleStateWriteRule[];
  readonly LIFECYCLE_STATE_WRITE_SCAN_ROOTS: readonly string[];
  lifecycleStateWriteViolations(
    files: ReadonlyArray<{ path: string; text: string }>,
  ): string[];
}

let policy: LifecycleStateWritePolicy;
beforeAll(async () => {
  policy = (await import(
    /* @vite-ignore */ pathToFileURL(POLICY_PATH).href
  )) as LifecycleStateWritePolicy;
});

function violationsFor(path: string, text: string): string[] {
  return policy.lifecycleStateWriteViolations([{ path, text }]);
}

describe("policy table pins the EXSEM-014 write funnels", () => {
  it("declares exactly the two anchored rules with their allowlists", () => {
    expect(policy.LIFECYCLE_STATE_WRITE_RULES).toHaveLength(2);
    const [seam, revoke] = policy.LIFECYCLE_STATE_WRITE_RULES;
    expect(seam?.rule).toBe(SEAM_RULE);
    expect(seam?.pattern.source).toContain("updateIncludingLifecycleState");
    expect([...(seam?.allowedFiles ?? [])]).toEqual([...SEAM_ALLOWED]);
    expect(revoke?.rule).toBe(REVOKE_RULE);
    expect(revoke?.pattern.source).toContain("revokeAssignment");
    expect([...(revoke?.allowedFiles ?? [])]).toEqual([...REVOKE_ALLOWED]);
  });

  it("scans every server-side source root", () => {
    for (const root of [
      "apps/api/src",
      "apps/web/src",
      "packages/db/src",
      "packages/exam-engine/src",
    ]) {
      expect(policy.LIFECYCLE_STATE_WRITE_SCAN_ROOTS, root).toContain(root);
    }
  });
});

describe("synthetic route-shaped witnesses are violations", () => {
  // A future route that grabs a repo handle and writes lifecycle state
  // directly — exactly the bypass shape the boundary exists to surface.
  const ROUTE_SEAM_WITNESS = `
  fastify.patch("/exams/:id", async (request, reply) => {
    const repo = createExamRepo(fastify.db);
    const updated = await repo.updateIncludingLifecycleState(ctx, id, {
      status: "archived",
    });
    return toExamResponse(updated);
  });
  `;
  const ROUTE_REVOKE_WITNESS = `
  fastify.post("/assignments/:id/revoke", async (request, reply) => {
    const repo = createProctorAssignmentRepo(fastify.db);
    const revoked = await repo.revokeAssignment(ctx, target.id, {
      revokedBy: ctx.actorId,
    });
    return toAssignmentResponse(revoked);
  });
  `;

  it("a route-shaped direct seam write is a SEAM violation", () => {
    const findings = violationsFor(
      "apps/api/src/routes/synthetic.route.ts",
      ROUTE_SEAM_WITNESS,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain("apps/api/src/routes/synthetic.route.ts");
    expect(findings[0]).toContain(SEAM_RULE);
  });

  it("a route-shaped direct revoke write is a REVOKE violation", () => {
    const findings = violationsFor(
      "apps/api/src/routes/synthetic.route.ts",
      ROUTE_REVOKE_WITNESS,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain(REVOKE_RULE);
  });

  it("both witnesses together produce both findings", () => {
    const findings = violationsFor(
      "apps/api/src/orchestrators/synthetic.ts",
      `${ROUTE_SEAM_WITNESS}\n${ROUTE_REVOKE_WITNESS}`,
    );
    expect(findings).toHaveLength(2);
    expect(findings.map((f) => f).join("\n")).toContain(SEAM_RULE);
    expect(findings.map((f) => f).join("\n")).toContain(REVOKE_RULE);
  });

  it("the as-built compliant call sites are not findings", () => {
    for (const file of SEAM_ALLOWED) {
      expect(violationsFor(file, ROUTE_SEAM_WITNESS), file).toEqual([]);
    }
    for (const file of REVOKE_ALLOWED) {
      expect(violationsFor(file, ROUTE_REVOKE_WITNESS), file).toEqual([]);
    }
  });

  it("definitions and prose mentions are not member-call matches", () => {
    const code = [
      "async function updateIncludingLifecycleState(ctx, id, input) {}",
      "  updateIncludingLifecycleState,", // return-object shorthand
      "  updateIncludingLifecycleState(ctx, id, input), // interface member",
      "// see updateIncludingLifecycleState docs",
    ].join("\n");
    expect(
      violationsFor("apps/api/src/routes/synthetic.route.ts", code),
    ).toEqual([]);
    const defs = [
      "async function revokeAssignment(ctx, id, input) {}",
      "  revokeAssignment,",
    ].join("\n");
    expect(
      violationsFor("packages/db/src/repository/syntheticRepo.ts", defs),
    ).toEqual([]);
  });

  it("is textual: a comment carrying the call shape does match", () => {
    const findings = violationsFor(
      "apps/api/src/routes/synthetic.route.ts",
      "// repo.revokeAssignment(ctx, id, input); — example",
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain(REVOKE_RULE);
  });

  it("test files stay exempt from the boundary", () => {
    expect(
      violationsFor(
        "apps/api/src/routes/synthetic.route.test.ts",
        ROUTE_SEAM_WITNESS,
      ),
    ).toEqual([]);
    expect(
      violationsFor(
        "packages/db/src/repository/testHelpers.ts",
        ROUTE_REVOKE_WITNESS,
      ),
    ).toEqual([]);
  });
});

describe("real production tree scans clean", () => {
  async function collectSources(
    root: string,
  ): Promise<{ path: string; text: string }[]> {
    const out: { path: string; text: string }[] = [];
    async function walk(dir: string): Promise<void> {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (["dist", "coverage", "node_modules"].includes(entry.name)) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (/\.tsx?$/.test(extname(entry.name))) {
          out.push({
            path: full.replace(/\\/g, "/").slice(REPO_ROOT.length + 1),
            text: await readFile(full, "utf8"),
          });
        }
      }
    }
    for (const root of policy.LIFECYCLE_STATE_WRITE_SCAN_ROOTS) {
      await walk(resolve(REPO_ROOT, root));
    }
    return out;
  }

  it("the same classifier the checker uses reports zero violations", async () => {
    const sources = await collectSources(REPO_ROOT);
    expect(sources.length).toBeGreaterThan(100);
    expect(policy.lifecycleStateWriteViolations(sources)).toEqual([]);
  }, 30_000);
});

/**
 * CLI-level counterfactuals through the REAL gate entry, in a disposable
 * `git worktree` (main working tree never touched). The checker and
 * policy modules are copied from the WORKING tree so local pre-commit
 * runs exercise the current implementation (byte-identical no-op in CI).
 *
 * INVARIANT: the copy list below must cover every repo-owned module the
 * checker imports. A missing module fails the pristine-green test with a
 * module-not-found error rather than passing vacuously.
 */
describe("real lint:arch entry rejects the witnesses (disposable worktree)", () => {
  let worktreeRoot: string;
  let worktree: string;

  function git(args: string[], cwd: string): void {
    const result = spawnSync("git", args, { cwd, encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(
        `git ${args.join(" ")} failed (exit ${result.status}): ${
          result.stderr ?? ""
        }`,
      );
    }
  }

  function runChecker(): { code: number; stdout: string; stderr: string } {
    const result = spawnSync(
      process.execPath,
      [join(worktree, "scripts", "check-architecture.mjs")],
      { cwd: worktree, encoding: "utf8" },
    );
    return {
      code: result.status ?? -1,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  }

  async function appendWitness(
    sourceRelativePath: string,
    line: string,
  ): Promise<void> {
    const target = join(worktree, sourceRelativePath);
    const original = await readFile(target, "utf8");
    await writeFile(target, `${original}\n${line}\n`);
  }

  beforeAll(async () => {
    worktreeRoot = await mkdtemp(join(tmpdir(), "exam-lifecycle-seam-"));
    worktree = join(worktreeRoot, "wt");
    git(["worktree", "add", "--detach", worktree, "HEAD"], REPO_ROOT);
    await copyFile(
      CHECKER_PATH,
      join(worktree, "scripts", "check-architecture.mjs"),
    );
    await copyFile(
      POLICY_PATH,
      join(worktree, "config", "architecture-policy.mjs"),
    );
    // The checker also imports config/build-graph-policy.mjs (#938); the
    // copy list must track every module the real entry resolves.
    await copyFile(
      BUILD_GRAPH_POLICY_PATH,
      join(worktree, "config", "build-graph-policy.mjs"),
    );
  }, 30_000);

  afterAll(async () => {
    if (worktree) {
      // OWNERSHIP: remove ONLY the worktree this suite created. No global
      // `git worktree prune` — it would sweep stale registrations belonging
      // to other worktrees and sessions out of the shared repository.
      const removal = spawnSync(
        "git",
        ["worktree", "remove", "--force", worktree],
        { cwd: REPO_ROOT, encoding: "utf8" },
      );
      expect(removal.status, removal.stderr ?? "").toBe(0);
    }
    await rm(worktreeRoot, { recursive: true, force: true });
  });

  it("pristine committed tree passes the real gate", () => {
    const run = runChecker();
    expect(run.stderr, run.stderr).toBe("");
    expect(run.code).toBe(0);
  }, 60_000);

  it("a route-shaped seam write fails as EXSEM014_LIFECYCLE_STATE_SEAM", async () => {
    await appendWitness(
      "apps/api/src/routes/exam.ts",
      `void fakeRepo.updateIncludingLifecycleState(ctx, "x", { status: "archived" });`,
    );
    const run = runChecker();
    expect(run.code, run.stderr).toBe(1);
    expect(run.stderr).toContain("apps/api/src/routes/exam.ts");
    expect(run.stderr).toContain(SEAM_RULE);
    git(["checkout", "--", "apps/api/src/routes/exam.ts"], worktree);
  }, 60_000);

  it("a route-shaped revoke write fails as EXSEM014_ASSIGNMENT_REVOKE_FUNNEL", async () => {
    await appendWitness(
      "apps/api/src/routes/exam.ts",
      `void fakeRepo.revokeAssignment(ctx, "x", { revokedBy: "u" });`,
    );
    const run = runChecker();
    expect(run.code, run.stderr).toBe(1);
    expect(run.stderr).toContain("apps/api/src/routes/exam.ts");
    expect(run.stderr).toContain(REVOKE_RULE);
    git(["checkout", "--", "apps/api/src/routes/exam.ts"], worktree);
  }, 60_000);

  it("restored tree passes the real gate again", () => {
    const run = runChecker();
    expect(run.stderr, run.stderr).toBe("");
    expect(run.code).toBe(0);
  }, 60_000);
});
