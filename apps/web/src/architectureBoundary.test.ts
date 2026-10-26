import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
const CHECKER_PATH = join(REPO_ROOT, "scripts", "check-architecture.mjs");

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
});

/**
 * CLI-level counterfactuals through the REAL gate entry. A disposable
 * `git worktree` of this repository carries the mutations — the main
 * working tree is never touched. The checker and policy modules are copied
 * from the WORKING tree into the worktree so local pre-commit runs exercise
 * the current implementation (byte-identical no-op in CI, where HEAD equals
 * the working tree).
 *
 * INVARIANT: the copy list below must cover every repo-owned module the
 * checker imports. A missing module fails the pristine-green test with a
 * module-not-found error rather than passing vacuously.
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
  }, 30_000);

  afterAll(async () => {
    if (worktree) {
      spawnSync("git", ["worktree", "remove", "--force", worktree], {
        cwd: REPO_ROOT,
        encoding: "utf8",
      });
      spawnSync("git", ["worktree", "prune"], {
        cwd: REPO_ROOT,
        encoding: "utf8",
      });
    }
    await rm(worktreeRoot, { recursive: true, force: true });
  });

  it("pristine committed tree passes the real gate", () => {
    const run = runChecker();
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

  it("restored tree passes the real gate again", () => {
    const run = runChecker();
    expect(run.stderr, run.stderr).toBe("");
    expect(run.code).toBe(0);
  }, 30_000);
});
