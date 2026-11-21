import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * #824 P2 — permanent counterfactual regression gate for the runtime
 * dependency boundaries.
 *
 * P1 (issue #824, comment 6420998551) proved with disposable-clone mutants
 * that the pre-P2 gate accepted "declared-but-forbidden" edges at every
 * layer: @exam/authz could declare @exam/db and @exam/web could declare
 * @exam/import-export with `lint:arch` EXIT=0 (cases C1c′/C2b), because the
 * textual bans anchored `from` and required a trailing subpath slash. This
 * suite converts those one-off experiments into permanent tests:
 *
 *   - the policy table is pinned to the Owner-ratified deny-lists (D1/D3),
 *     so deleting an entry or silently growing the list fails here;
 *   - the manifest audit rejects every forbidden declaration with the right
 *     rule/field/importer diagnostic, and stays green on the legitimate
 *     as-built graph and on sanctioned test-scope devDependencies (D2);
 *   - the source early-warning pattern is characterized per claimed import
 *     form (static/type/side-effect/re-export/dynamic/require, root and
 *     subpath) — no coverage beyond those forms is claimed;
 *   - the REAL `node scripts/check-architecture.mjs` entry rejects the two
 *     P1 mutants in a disposable `git worktree` and passes the pristine
 *     tree — the unit tests alone would not prove the checker is wired to
 *     the policy.
 *   - #1074: every documented dotenv admission shape inside the shared db
 *     mechanism is killed by the real gate that claims that surface
 *     (check-architecture, check-env-surface), while prose mentions without
 *     an import position stay clean — F-06 semantics keep env-file
 *     admission owned by the entrypoints.
 *
 * Placement mirrors codeQualityGate.test.ts: apps/web is the DB-free app
 * suite and already hosts repo-level structural tests. The policy module is
 * loaded dynamically (apps/web's production `tsc -b` includes test files
 * while the Docker builder copies neither config/ nor scripts/ — a static
 * cross-root import would break the production image build, TS2307).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");
const POLICY_PATH = join(REPO_ROOT, "config", "architecture-policy.mjs");
const BUILD_GRAPH_POLICY_PATH = join(
  REPO_ROOT,
  "config",
  "build-graph-policy.mjs",
);
const CHECKER_PATH = join(REPO_ROOT, "scripts", "check-architecture.mjs");
const ENV_SURFACE_PATH = join(REPO_ROOT, "scripts", "check-env-surface.mjs");
const ENV_FILE_POLICY_PATH = join(REPO_ROOT, "config", "envFilePolicy.ts");

/**
 * The ratified normative sets (#824 Owner dispositions D1/D3, ADR-010 for
 * authz). Hardcoded here as the normative expectation on purpose: the test
 * must fail if the policy table drifts from the adopted decision in either
 * direction (shrunk entry or unratified extra).
 */
const AUTHZ_FORBIDDEN = [
  "@exam/db",
  "@exam/contracts",
  "@exam/auth",
  "@exam/exam-engine",
  "@exam/import-export",
];
const WEB_FORBIDDEN = [
  "@exam/db",
  "@exam/auth",
  "@exam/exam-engine",
  "@exam/import-export",
  "@exam/api",
];

interface BoundaryFinding {
  readonly importer: string;
  readonly dependency: string;
  readonly field: string;
  readonly rule: string;
  readonly rationale: string;
}

interface BoundaryEntry {
  readonly importer: string;
  readonly rule: string;
  readonly rationale: string;
  readonly forbidden: readonly string[];
}

interface ArchitecturePolicy {
  readonly RUNTIME_DEPENDENCY_BOUNDARIES: readonly BoundaryEntry[];
  forbiddenRuntimeDependencies(manifest: unknown): BoundaryFinding[];
  forbiddenImportPattern(importer: string): RegExp;
}

let policy: ArchitecturePolicy;
beforeAll(async () => {
  policy = (await import(
    /* @vite-ignore */ pathToFileURL(POLICY_PATH).href
  )) as ArchitecturePolicy;
});

function manifestWith(
  name: string,
  dependencies: Record<string, string> = {},
  devDependencies: Record<string, string> = {},
): unknown {
  return { name, dependencies, devDependencies };
}

describe("policy table pins the ratified deny-lists", () => {
  it("declares exactly the two ratified importers with their five-sets", () => {
    expect([...policy.RUNTIME_DEPENDENCY_BOUNDARIES]).toEqual([
      {
        importer: "@exam/authz",
        rule: "AUTHZ_RUNTIME_BOUNDARY",
        rationale: expect.any(String),
        forbidden: [...AUTHZ_FORBIDDEN],
      },
      {
        importer: "@exam/web",
        rule: "WEB_RUNTIME_BOUNDARY",
        rationale: expect.any(String),
        forbidden: [...WEB_FORBIDDEN],
      },
    ]);
  });

  it("refuses to derive a pattern for an importer without a boundary", () => {
    expect(() => policy.forbiddenImportPattern("@exam/contracts")).toThrow(
      /no runtime dependency boundary/,
    );
  });
});

describe("manifest audit — declared forbidden edges are findings (M1–M4)", () => {
  it("M1: authz declaring @exam/db is an AUTHZ_RUNTIME_BOUNDARY finding", () => {
    const findings = policy.forbiddenRuntimeDependencies(
      manifestWith("@exam/authz", {
        "@exam/domain": "workspace:*",
        "@exam/db": "workspace:*",
      }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      importer: "@exam/authz",
      dependency: "@exam/db",
      field: "dependencies",
      rule: "AUTHZ_RUNTIME_BOUNDARY",
    });
    expect(findings[0]?.rationale).toContain("@exam/domain");
  });

  it("M2: web declaring @exam/import-export is a WEB_RUNTIME_BOUNDARY finding", () => {
    const findings = policy.forbiddenRuntimeDependencies(
      manifestWith("@exam/web", {
        "@exam/authz": "workspace:*",
        "@exam/contracts": "workspace:*",
        "@exam/domain": "workspace:*",
        "@exam/import-export": "workspace:*",
      }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      importer: "@exam/web",
      dependency: "@exam/import-export",
      field: "dependencies",
      rule: "WEB_RUNTIME_BOUNDARY",
    });
  });

  it("M4: every ratified authz forbidden package is caught at root identity", () => {
    for (const dependency of AUTHZ_FORBIDDEN) {
      const findings = policy.forbiddenRuntimeDependencies(
        manifestWith("@exam/authz", {
          "@exam/domain": "workspace:*",
          [dependency]: "workspace:*",
        }),
      );
      expect(findings, dependency).toHaveLength(1);
      expect(findings[0]?.dependency).toBe(dependency);
      expect(findings[0]?.rule).toBe("AUTHZ_RUNTIME_BOUNDARY");
    }
  });

  it("M3: every ratified web forbidden package is caught at root identity", () => {
    for (const dependency of WEB_FORBIDDEN) {
      const findings = policy.forbiddenRuntimeDependencies(
        manifestWith("@exam/web", {
          "@exam/authz": "workspace:*",
          [dependency]: "workspace:*",
        }),
      );
      expect(findings, dependency).toHaveLength(1);
      expect(findings[0]?.dependency).toBe(dependency);
      expect(findings[0]?.rule).toBe("WEB_RUNTIME_BOUNDARY");
    }
  });

  it("five simultaneous declarations produce five findings", () => {
    const findings = policy.forbiddenRuntimeDependencies(
      manifestWith(
        "@exam/web",
        Object.fromEntries(WEB_FORBIDDEN.map((d) => [d, "workspace:*"])),
      ),
    );
    expect(findings).toHaveLength(WEB_FORBIDDEN.length);
    expect(findings.map((f) => f.dependency).sort()).toEqual(
      [...WEB_FORBIDDEN].sort(),
    );
  });
});

describe("manifest audit — legitimate and test-scope edges stay green (M5–M6)", () => {
  it("M5: legitimate as-built dependency graphs produce no findings", () => {
    expect(
      policy.forbiddenRuntimeDependencies(
        manifestWith("@exam/authz", { "@exam/domain": "workspace:*" }),
      ),
    ).toEqual([]);
    expect(
      policy.forbiddenRuntimeDependencies(
        manifestWith("@exam/web", {
          "@exam/authz": "workspace:*",
          "@exam/contracts": "workspace:*",
          "@exam/domain": "workspace:*",
          react: "^19.1.0",
        }),
      ),
    ).toEqual([]);
    // @exam/api depends on the whole server-side set — it is NOT a deny-list
    // importer, so its as-built graph must stay untouched by this policy.
    expect(
      policy.forbiddenRuntimeDependencies(
        manifestWith("@exam/api", {
          "@exam/db": "workspace:*",
          "@exam/auth": "workspace:*",
          "@exam/exam-engine": "workspace:*",
          "@exam/import-export": "workspace:*",
        }),
      ),
    ).toEqual([]);
    expect(
      policy.forbiddenRuntimeDependencies(
        manifestWith("@exam/import-export", {}),
      ),
    ).toEqual([]);
  });

  it("M6: test-scope devDependencies are not production violations", () => {
    expect(
      policy.forbiddenRuntimeDependencies({
        name: "@exam/authz",
        dependencies: { "@exam/domain": "workspace:*" },
        devDependencies: {
          "@exam/db": "workspace:*",
          "@exam/source-fixture": "workspace:*",
        },
      }),
    ).toEqual([]);
    // The sanctioned db → auth test-witness devDependency (db is not a
    // deny-list importer in the first place).
    expect(
      policy.forbiddenRuntimeDependencies({
        name: "@exam/db",
        dependencies: { "@exam/domain": "workspace:*" },
        devDependencies: { "@exam/auth": "workspace:*" },
      }),
    ).toEqual([]);
    // No dependencies field at all.
    expect(
      policy.forbiddenRuntimeDependencies({
        name: "@exam/authz",
        devDependencies: { "@exam/db": "workspace:*" },
      }),
    ).toEqual([]);
  });

  it("manifests without a boundary (or without a name) are out of scope", () => {
    expect(policy.forbiddenRuntimeDependencies(null)).toEqual([]);
    expect(policy.forbiddenRuntimeDependencies({})).toEqual([]);
    expect(
      policy.forbiddenRuntimeDependencies(
        manifestWith("@exam/domain", { "@exam/db": "workspace:*" }),
      ),
    ).toEqual([]);
  });
});

describe("source early-warning pattern characterization (M7)", () => {
  // Every import spelling the scan CLAIMS to cover (see the policy module's
  // contract comment). Each form needs at least one counterfactual here; the
  // root and subpath identities are covered separately.
  const SOURCE_FORMS: ReadonlyArray<
    readonly [label: string, template: string]
  > = [
    ["static import", `import { parseAppMode } from "SPEC";`],
    ["type-only import", `import type { ParseAppMode } from "SPEC";`],
    ["side-effect import", `import "SPEC";`],
    ["named re-export", `export { parseAppMode } from "SPEC";`],
    ["star re-export", `export * from "SPEC";`],
    ["dynamic import", `const m = await import("SPEC");`],
    ["spaced dynamic import", `const m = await import ("SPEC");`],
    ["require call", `const m = require("SPEC");`],
  ];

  it("matches every ratified forbidden package at root identity, both importers", () => {
    for (const [importer, forbidden] of [
      ["@exam/authz", AUTHZ_FORBIDDEN],
      ["@exam/web", WEB_FORBIDDEN],
    ] as const) {
      const pattern = policy.forbiddenImportPattern(importer);
      for (const pkg of forbidden) {
        expect(
          pattern.test(`import { x } from "${pkg}";`),
          `${importer} static root ${pkg}`,
        ).toBe(true);
        expect(
          pattern.test(`import "${pkg}";`),
          `${importer} side-effect root ${pkg}`,
        ).toBe(true);
        expect(
          pattern.test(`export * from "${pkg}";`),
          `${importer} re-export root ${pkg}`,
        ).toBe(true);
        expect(
          pattern.test(`const m = await import("${pkg}");`),
          `${importer} dynamic root ${pkg}`,
        ).toBe(true);
      }
    }
  });

  it("matches every claimed import form for a representative package", () => {
    for (const [importer, representative] of [
      ["@exam/authz", "@exam/db"],
      ["@exam/web", "@exam/db"],
    ] as const) {
      const pattern = policy.forbiddenImportPattern(importer);
      for (const [label, template] of SOURCE_FORMS) {
        expect(
          pattern.test(template.replace("SPEC", representative)),
          `${importer} ${label}`,
        ).toBe(true);
        expect(
          pattern.test(
            template.replace("SPEC", `${representative}/repository/userRepo`),
          ),
          `${importer} ${label} (subpath)`,
        ).toBe(true);
      }
    }
  });

  it("does not match legitimate edges, near-miss identities or prose mentions", () => {
    const authz = policy.forbiddenImportPattern("@exam/authz");
    expect(authz.test(`import { permission } from "@exam/domain";`)).toBe(
      false,
    );
    expect(authz.test(`import { permission } from "@exam/domain/scope";`)).toBe(
      false,
    );
    expect(authz.test(`import { marker } from "@exam/source-fixture";`)).toBe(
      false,
    );
    // Near-miss package identities are not the forbidden package.
    expect(authz.test(`import { x } from "@exam/dbx";`)).toBe(false);
    expect(authz.test(`import { x } from "@exam/db-x";`)).toBe(false);
    // Quoted or unquoted prose without an import position is not a match —
    // the scan is import-position shaped, not occurrence shaped.
    expect(authz.test(`const note = "see @exam/db docs";`)).toBe(false);
    expect(authz.test(`// the database package lives in @exam/db`)).toBe(false);

    const web = policy.forbiddenImportPattern("@exam/web");
    for (const allowed of ["@exam/authz", "@exam/contracts", "@exam/domain"]) {
      expect(web.test(`import { x } from "${allowed}";`)).toBe(false);
      expect(web.test(`import { x } from "${allowed}/detail";`)).toBe(false);
    }
    expect(web.test(`import { client } from "@exam/api-client";`)).toBe(false);
  });

  // Characterization of the documented false-positive boundary (#824
  // delta review P2-1): the scan is textual, NOT comment/string aware.
  // Comment or template-literal text that itself carries an import shape
  // matches — the same posture as the pre-existing from-anchored guards.
  // This is deliberate bounded coverage, not a bug to fix with an AST
  // parser here; declared edges are caught by the manifest audit regardless.
  it("is textual: comments and strings carrying an import shape do match", () => {
    const authz = policy.forbiddenImportPattern("@exam/authz");
    expect(
      authz.test(`// import "@exam/db"; — a documented code example`),
    ).toBe(true);
    // A single-quoted string embedding a double-quoted specifier keeps the
    // real quote characters in the source text, so the scan matches it.
    expect(
      authz.test(`const hint = 'write import "@exam/db" carefully';`),
    ).toBe(true);
    expect(authz.test('const hint = `like import "@exam/db" here`;')).toBe(
      true,
    );
  });
});

/**
 * CLI-level counterfactuals through the REAL gate entries. A disposable
 * `git worktree` of this repository carries the mutations — the main
 * working tree is never touched. The gate scripts and their policy modules
 * are copied from the WORKING tree into the worktree so local pre-commit
 * runs exercise the current implementation (byte-identical no-op in CI,
 * where HEAD equals the working tree).
 *
 * INVARIANT: the copy list below must cover every repo-owned module the
 * gated entries import — check-architecture.mjs loads architecture-policy
 * and build-graph-policy; check-env-surface.mjs loads envFilePolicy (via
 * Node type stripping, no other repo-owned imports). A missing module fails
 * the pristine-green tests with a module-not-found error rather than
 * passing vacuously.
 */
describe("real lint:arch entry rejects the P1 mutants (disposable worktree)", () => {
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

  // check-env-surface derives its scan root from its own script location
  // (`new URL("../", import.meta.url)`), so running the worktree copy scans
  // the worktree tree — no cwd coupling.
  function runEnvSurface(): { code: number; stdout: string; stderr: string } {
    const result = spawnSync(
      process.execPath,
      [join(worktree, "scripts", "check-env-surface.mjs")],
      { cwd: worktree, encoding: "utf8" },
    );
    return {
      code: result.status ?? -1,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  }

  async function addDependency(
    manifestRelativePath: string,
    dependency: string,
  ): Promise<void> {
    const target = join(worktree, manifestRelativePath);
    const manifest = JSON.parse(await readFile(target, "utf8")) as {
      dependencies: Record<string, string>;
    };
    manifest.dependencies[dependency] = "workspace:*";
    await writeFile(target, `${JSON.stringify(manifest, null, 2)}\n`);
  }

  async function appendImport(
    sourceRelativePath: string,
    line: string,
  ): Promise<void> {
    const target = join(worktree, sourceRelativePath);
    const original = await readFile(target, "utf8");
    await writeFile(target, `${original}\n${line}\n`);
  }

  beforeAll(async () => {
    worktreeRoot = await mkdtemp(join(tmpdir(), "exam-arch-boundary-"));
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
    // The env-surface gate (#1074 cases below) gets the same working-tree
    // treatment; it loads config/envFilePolicy.ts via Node type stripping.
    await copyFile(
      ENV_SURFACE_PATH,
      join(worktree, "scripts", "check-env-surface.mjs"),
    );
    await copyFile(
      ENV_FILE_POLICY_PATH,
      join(worktree, "config", "envFilePolicy.ts"),
    );
  }, 30_000);

  afterAll(async () => {
    if (worktree) {
      // OWNERSHIP: remove ONLY the worktree this suite created. No global
      // `git worktree prune` — it would sweep stale registrations belonging
      // to other worktrees and sessions out of the shared repository. A
      // failed removal is surfaced here, not swallowed; the rm backstop
      // below still deletes this suite's own mkdtemp directory.
      const removal = spawnSync(
        "git",
        ["worktree", "remove", "--force", worktree],
        { cwd: REPO_ROOT, encoding: "utf8" },
      );
      expect(removal.status, removal.stderr ?? "").toBe(0);
    }
    await rm(worktreeRoot, { recursive: true, force: true });
  });

  // INVARIANT: every case below mutates only disposable-worktree files and
  // restores them before yielding. The in-case checkouts only run on
  // success, so the afterEach backstop restores the shared #1074 mutation
  // target even when a case fails mid-way — a RED-state failure must not
  // leak mutant lines into later cases (checkout of an unmodified file is a
  // no-op for the cases that never touch it).
  afterEach(() => {
    git(
      [
        "checkout",
        "--",
        "packages/db/src/sqlIdent.ts",
        "packages/domain/src/errors.ts",
        "packages/authz/src/systemActor.ts",
        "packages/contracts/src/common.ts",
        "packages/auth/src/tokens.ts",
        "apps/api/src/config/runtimeConfig.ts",
        "packages/exam-engine/src/answerProtocol.ts",
        "packages/exam-engine/src/admissionCommands.ts",
        "apps/api/src/demo-seed-grader.ts",
        "apps/api/src/routes/attempts.ts",
        "packages/db/src/repository/attemptRepo.ts",
        "apps/api/src/scripts/recover-legacy-grading-workset.ts",
      ],
      worktree,
    );
  });

  it("pristine committed tree passes the real gate", () => {
    const run = runChecker();
    expect(run.stderr, run.stderr).toBe("");
    expect(run.code).toBe(0);
  }, 30_000);

  // Zero-false-positive pin for the env-surface gate on the real tree: the
  // allowlisted admission readers (loadRootEnv, vite dev config,
  // vitest.shared, drizzle.config) and every other source file stay clean.
  it("pristine committed tree passes the env-surface gate", () => {
    const run = runEnvSurface();
    expect(run.stderr, run.stderr).toBe("");
    expect(run.code).toBe(0);
  }, 30_000);

  it("M1: authz manifest declaring @exam/db fails as AUTHZ_RUNTIME_BOUNDARY", async () => {
    await addDependency("packages/authz/package.json", "@exam/db");
    const run = runChecker();
    expect(run.code, run.stderr).toBe(1);
    expect(run.stderr).toContain("packages/authz/package.json");
    expect(run.stderr).toContain("AUTHZ_RUNTIME_BOUNDARY");
    expect(run.stderr).toContain('"@exam/db"');
    expect(run.stderr).toContain('"dependencies"');
    git(["checkout", "--", "packages/authz/package.json"], worktree);
  }, 30_000);

  it("M2: web manifest declaring @exam/import-export fails as WEB_RUNTIME_BOUNDARY", async () => {
    await addDependency("apps/web/package.json", "@exam/import-export");
    const run = runChecker();
    expect(run.code, run.stderr).toBe(1);
    expect(run.stderr).toContain("apps/web/package.json");
    expect(run.stderr).toContain("WEB_RUNTIME_BOUNDARY");
    expect(run.stderr).toContain('"@exam/import-export"');
    expect(run.stderr).toContain('"dependencies"');
    git(["checkout", "--", "apps/web/package.json"], worktree);
  }, 30_000);

  it("C1b': an undeclared authz root import is caught by the source scan", async () => {
    await appendImport(
      "packages/authz/src/systemActor.ts",
      `import { parseAppMode } from "@exam/db";`,
    );
    const run = runChecker();
    expect(run.code, run.stderr).toBe(1);
    expect(run.stderr).toContain("packages/authz/src/systemActor.ts");
    expect(run.stderr).toContain("AUTHZ_RUNTIME_BOUNDARY");
    git(["checkout", "--", "packages/authz/src/systemActor.ts"], worktree);
  }, 30_000);

  it("C2a': an undeclared web import of a server package is caught by the source scan", async () => {
    await appendImport(
      "apps/web/src/main.tsx",
      `import { exportBundle } from "@exam/import-export";`,
    );
    const run = runChecker();
    expect(run.code, run.stderr).toBe(1);
    expect(run.stderr).toContain("apps/web/src/main.tsx");
    expect(run.stderr).toContain("WEB_RUNTIME_BOUNDARY");
    git(["checkout", "--", "apps/web/src/main.tsx"], worktree);
  }, 30_000);

  // ── #1074 (WP-08 R-GATE-02): dotenv admission shapes in packages/db/src ──
  //
  // Both gates anchor their dotenv patterns to a quote immediately after
  // `dotenv`, so every subpath spelling ("dotenv/config") escapes BOTH, and
  // the checker additionally has no side-effect branch at all (bare
  // `import "dotenv"` escapes lint:arch while env-surface catches it). F-06
  // semantics: a module-level admission inside the shared db mechanism
  // re-admits the developer .env behind the entrypoint's refusal (#733).
  // INVARIANT: each documented admission shape is killed by the gate that
  // claims the surface, with its precise diagnostic — these cases fail
  // while any shape is admitted, and the augmentation must be anchored to
  // import positions (see the prose negative below).

  it("#1074: lint:arch kills the bare dotenv side-effect import", async () => {
    await appendImport("packages/db/src/sqlIdent.ts", `import "dotenv";`);
    const run = runChecker();
    expect(run.code, run.stderr).toBe(1);
    expect(run.stderr).toContain("packages/db/src/sqlIdent.ts");
    expect(run.stderr).toContain(
      "shared db mechanism must not admit dotenv sources",
    );
    git(["checkout", "--", "packages/db/src/sqlIdent.ts"], worktree);
  }, 30_000);

  it("#1074: lint:arch kills the dotenv/config subpath import", async () => {
    await appendImport(
      "packages/db/src/sqlIdent.ts",
      `import "dotenv/config";`,
    );
    const run = runChecker();
    expect(run.code, run.stderr).toBe(1);
    expect(run.stderr).toContain("packages/db/src/sqlIdent.ts");
    expect(run.stderr).toContain(
      "shared db mechanism must not admit dotenv sources",
    );
    git(["checkout", "--", "packages/db/src/sqlIdent.ts"], worktree);
  }, 30_000);

  it("#1074: lint:arch kills the dotenv/config from-import", async () => {
    await appendImport(
      "packages/db/src/sqlIdent.ts",
      `import dotenv from "dotenv/config";`,
    );
    const run = runChecker();
    expect(run.code, run.stderr).toBe(1);
    expect(run.stderr).toContain("packages/db/src/sqlIdent.ts");
    expect(run.stderr).toContain(
      "shared db mechanism must not admit dotenv sources",
    );
    git(["checkout", "--", "packages/db/src/sqlIdent.ts"], worktree);
  }, 30_000);

  it("#1074: env-surface kills the dotenv/config subpath import", async () => {
    await appendImport(
      "packages/db/src/sqlIdent.ts",
      `import "dotenv/config";`,
    );
    const run = runEnvSurface();
    expect(run.code, run.stderr).toBe(1);
    expect(run.stderr).toContain("packages/db/src/sqlIdent.ts");
    expect(run.stderr).toContain("imports dotenv outside the reader allowlist");
    git(["checkout", "--", "packages/db/src/sqlIdent.ts"], worktree);
  }, 30_000);

  it("#1074: env-surface kills the dotenv/config from-import", async () => {
    await appendImport(
      "packages/db/src/sqlIdent.ts",
      `import dotenv from "dotenv/config";`,
    );
    const run = runEnvSurface();
    expect(run.code, run.stderr).toBe(1);
    expect(run.stderr).toContain("packages/db/src/sqlIdent.ts");
    expect(run.stderr).toContain("imports dotenv outside the reader allowlist");
    git(["checkout", "--", "packages/db/src/sqlIdent.ts"], worktree);
  }, 30_000);

  // Guard on the augmentation direction: the subpath closure must extend,
  // not replace, the bare-specifier coverage these branches already provide.
  it("#1074: lint:arch keeps killing the bare from/require dotenv shapes", async () => {
    await appendImport(
      "packages/db/src/sqlIdent.ts",
      `import { config } from "dotenv";`,
    );
    await appendImport(
      "packages/db/src/sqlIdent.ts",
      `const dotenv = require("dotenv");`,
    );
    const run = runChecker();
    expect(run.code, run.stderr).toBe(1);
    expect(run.stderr).toContain(
      "shared db mechanism must not admit dotenv sources",
    );
    git(["checkout", "--", "packages/db/src/sqlIdent.ts"], worktree);
  }, 30_000);

  it("#1074: env-surface keeps killing the bare dotenv side-effect import", async () => {
    await appendImport("packages/db/src/sqlIdent.ts", `import "dotenv";`);
    const run = runEnvSurface();
    expect(run.code, run.stderr).toBe(1);
    expect(run.stderr).toContain("packages/db/src/sqlIdent.ts");
    expect(run.stderr).toContain("imports dotenv outside the reader allowlist");
    git(["checkout", "--", "packages/db/src/sqlIdent.ts"], worktree);
  }, 30_000);

  // Minimal negative: the augmented patterns must match admission positions,
  // not any occurrence of the specifier — otherwise prose in the shared
  // mechanism becomes a false violation. Same textual posture as the M7
  // characterization: import-shaped text matches, bare mentions do not.
  it("#1074: prose mention without an import position stays clean", async () => {
    await appendImport(
      "packages/db/src/sqlIdent.ts",
      `// see "dotenv/config" docs — admission belongs to the entrypoint`,
    );
    const archRun = runChecker();
    expect(archRun.stderr, archRun.stderr).toBe("");
    expect(archRun.code).toBe(0);
    const envRun = runEnvSurface();
    expect(envRun.stderr, envRun.stderr).toBe("");
    expect(envRun.code).toBe(0);
    git(["checkout", "--", "packages/db/src/sqlIdent.ts"], worktree);
  }, 30_000);

  // ── #1074 scope 1 — one kill-case per inline architecture ban that no
  // existing probe consumes. Each case pins ONE real invariant: it first
  // appends the LEGAL shape for that boundary (the minimal negative — the
  // pattern must not swallow legitimate code) and then the documented
  // violation shape, asserting the REAL gate kills the latter with its
  // precise diagnostic. Deleting the corresponding inline block from
  // scripts/check-architecture.mjs fails exactly that case, so rule death
  // is visible in the suite (E0: deleting all nine inline blocks left every
  // gate green). Mutants exist only in the disposable worktree.
  interface InlineBanProbe {
    readonly target: string;
    readonly legalTarget?: string;
    readonly legal: string;
    readonly violation: string;
    readonly diagnostics: readonly string[];
  }

  async function expectInlineBan(probe: InlineBanProbe): Promise<void> {
    const legalTarget = probe.legalTarget ?? probe.target;
    await appendImport(legalTarget, probe.legal);
    const legalRun = runChecker();
    expect(legalRun.stderr, legalRun.stderr).toBe("");
    expect(legalRun.code).toBe(0);
    git(["checkout", "--", legalTarget], worktree);

    await appendImport(probe.target, probe.violation);
    const killRun = runChecker();
    expect(killRun.code, killRun.stderr).toBe(1);
    expect(killRun.stderr).toContain(probe.target);
    for (const diagnostic of probe.diagnostics) {
      expect(killRun.stderr).toContain(diagnostic);
    }
    git(["checkout", "--", probe.target], worktree);
  }

  it("#1074: domain stays a leaf package (no fastify/react/drizzle/@exam)", async () => {
    // packages/domain is the transport-independent domain core; importing
    // any runtime dependency there would couple the domain vocabulary to a
    // delivery mechanism (repo boundary rule, AGENTS.md §5).
    await expectInlineBan({
      target: "packages/domain/src/errors.ts",
      legal: `import { ExamErrorCode } from "./enums";`,
      violation: `export * from "@exam/db";`,
      diagnostics: ["domain must remain a leaf package"],
    });
  }, 30_000);

  it("#1074: authz stays a leaf package (no fastify/react/drizzle)", async () => {
    // authz is the RBAC leaf (ADR-010): the permission vocabulary must stay
    // portable, reaching only @exam/domain.
    await expectInlineBan({
      target: "packages/authz/src/systemActor.ts",
      legal: `import { permission } from "@exam/domain";`,
      violation: `import { FastifyInstance } from "fastify";`,
      diagnostics: [
        "authz must stay a leaf package (no fastify/React/Drizzle)",
      ],
    });
  }, 30_000);

  it("#1074: contracts cannot depend on fastify", async () => {
    // @exam/contracts is the shared wire-format authority; transport types
    // would leak server plumbing into every consumer of the contract.
    await expectInlineBan({
      target: "packages/contracts/src/common.ts",
      legal: `import { ExamError } from "@exam/domain";`,
      violation: `import type { FastifyRequest } from "fastify";`,
      diagnostics: ["contracts cannot depend on fastify"],
    });
  }, 30_000);

  it("#1074: auth package must not read process.env", async () => {
    // #733 R3: @exam/auth owns the JWT/password mechanism only; application
    // mode and secret policy enter as explicit arguments, never from the
    // process environment (the canonical authority is settings/runtimeConfig).
    await expectInlineBan({
      target: "packages/auth/src/tokens.ts",
      legal: `export interface TokenConfig { issuer: string; }`,
      violation: `const mode = process.env.NODE_ENV;`,
      diagnostics: ["auth package must not read process.env"],
    });
  }, 30_000);

  it("#1074: apps/api must not read the raw APP_MODE env var", async () => {
    // #733 R4 (F-05/F-08): runtime mode is resolved ONLY by @exam/db
    // parseAppMode; a consumer reading the raw env re-implements the
    // precedence policy (APP_MODE authoritative, NODE_ENV fallback) and
    // silently drifts. Other process.env reads stay legal — the pattern
    // pins the two mode variables only.
    await expectInlineBan({
      target: "apps/api/src/config/runtimeConfig.ts",
      legal: `const port = Number(process.env.PORT ?? 3000);`,
      violation: `const rawMode = process.env.APP_MODE;`,
      diagnostics: ["runtime mode comes from @exam/db parseAppMode"],
    });
  }, 30_000);

  it("#1074: packages/db must not read the raw NODE_ENV env var", async () => {
    // Same rule as above, second scan root (apps/api/src and packages/db/src
    // are the modules owning runtime-mode consumers).
    await expectInlineBan({
      target: "packages/db/src/sqlIdent.ts",
      legal: `const debug = process.env.DEBUG === "1";`,
      violation: `const rawEnv = process.env.NODE_ENV;`,
      diagnostics: ["runtime mode comes from @exam/db parseAppMode"],
    });
  }, 30_000);

  it("#1074: exam-engine cannot depend on fastify", async () => {
    // The exam state machine is transport-independent; a fastify import
    // would bind the engine to the HTTP delivery layer (repo boundary rule).
    await expectInlineBan({
      target: "packages/exam-engine/src/answerProtocol.ts",
      legal: `import { ExamError } from "@exam/domain";`,
      violation: `import { FastifyPluginAsync } from "fastify";`,
      diagnostics: ["exam-engine cannot depend on fastify"],
    });
  }, 30_000);

  it("#1074: no cast to LockedEnrollmentAttemptIdentity in exam-engine", async () => {
    // Lock-order capability: the brand symbols are module-private and the
    // only legitimate mint is lockEnrollmentAndAttempt — a cast forges the
    // repo-affinity proof. The legal shape is the type annotation the real
    // mint seam uses (lockSeam.ts), not a cast.
    await expectInlineBan({
      target: "packages/exam-engine/src/admissionCommands.ts",
      legal: `const minted: LockedEnrollmentAttemptIdentity = capability;`,
      violation: `const forged = {} as LockedEnrollmentAttemptIdentity;`,
      diagnostics: ["do not cast to LockedEnrollmentAttemptIdentity"],
    });
  }, 30_000);

  it("#1074: no cast to ReconciledAttemptMutationContext in apps/api", async () => {
    // Same forgery defense for the opaque Attempt mutation context: the
    // only legitimate provenance is prepareReconciledAttemptMutation. This
    // case pins the apps/api/src scan root (the cast ban is enforced in
    // both the engine and the API application).
    await expectInlineBan({
      target: "apps/api/src/demo-seed-grader.ts",
      legal: `const prepared: ReconciledAttemptMutationContext = context;`,
      violation: `const forged = {} as ReconciledAttemptMutationContext;`,
      diagnostics: ["do not cast to ReconciledAttemptMutationContext"],
    });
  }, 30_000);

  it("#1074: routes must use repositories, not db.select", async () => {
    // Repository funnel (repo boundary rule): route handlers reach data
    // through repositories; a direct db builder call inside a route bypasses
    // the query ownership boundary. The legal shape is the same builder
    // chain inside the repository layer, where db access is owned.
    await expectInlineBan({
      target: "apps/api/src/routes/attempts.ts",
      legalTarget: "packages/db/src/repository/attemptRepo.ts",
      legal: `const rows = await db.select().from(users);`,
      violation: `const rows = await db.select().from(examAttempts);`,
      diagnostics: ["routes must use repositories"],
    });
  }, 30_000);

  it("#1074: routes must not import drizzle-orm directly", async () => {
    await expectInlineBan({
      target: "apps/api/src/routes/attempts.ts",
      legalTarget: "packages/db/src/repository/attemptRepo.ts",
      legal: `import { sql } from "drizzle-orm";`,
      violation: `import { sql } from "drizzle-orm";`,
      diagnostics: ["routes must not import drizzle-orm directly"],
    });
  }, 30_000);

  it("#1074: routes must not import the DB schema directly", async () => {
    // The schema export is reachable outside routes (e.g. api scripts), so
    // the ban is anchored to the routes scan root only — the legal shape
    // imports the same specifier from a non-route api module.
    await expectInlineBan({
      target: "apps/api/src/routes/attempts.ts",
      legalTarget: "apps/api/src/scripts/recover-legacy-grading-workset.ts",
      legal: `import { examAttempts } from "@exam/db/schema";`,
      violation: `import { examAttempts } from "@exam/db/schema";`,
      diagnostics: ["routes must not import DB schema directly"],
    });
  }, 30_000);

  it("restored tree passes the real gates again", () => {
    const run = runChecker();
    expect(run.stderr, run.stderr).toBe("");
    expect(run.code).toBe(0);
    const envRun = runEnvSurface();
    expect(envRun.stderr, envRun.stderr).toBe("");
    expect(envRun.code).toBe(0);
  }, 30_000);
});
