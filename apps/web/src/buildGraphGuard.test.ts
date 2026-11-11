import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * #938 (PR3) — permanent counterfactual gate for the workspace build-graph
 * guards. The production image's Docker builder sequence and the workspace
 * build graph (manifests + turbo.json globalDependencies) are two
 * descriptions of one artifact chain; config/build-graph-policy.mjs is the
 * single policy authority and `pnpm lint:arch` is the enforcement entry.
 * This suite converts the guard into tests:
 *
 *   - the policy grammar decisions are pinned (supported forms, unsupported
 *     forms, coverage rules), so loosening the grammar fails here;
 *   - synthetic witnesses for every drift class are classified as named
 *     violations (BUILD_GRAPH_DOCKER_CLOSURE, BUILD_GRAPH_DOCKER_STALE_ENTRY,
 *     BUILD_GRAPH_DOCKER_DUPLICATE, BUILD_GRAPH_DOCKER_ORDER,
 *     BUILD_GRAPH_DOCKER_CYCLE, BUILD_GRAPH_DOCKER_UNSUPPORTED,
 *     BUILD_GRAPH_HELPER_UNREGISTERED, BUILD_GRAPH_HELPER_UNSUPPORTED_FORM);
 *   - the REAL repo scans clean through the same functions the checker uses;
 *   - the REAL `node scripts/check-architecture.mjs` entry rejects the two
 *     audited counterfactuals (#938 C4.1 synthetic package without a
 *     Dockerfile build; C4.2 build script referencing an unregistered
 *     repo-level helper) in a disposable `git worktree` and passes the
 *     pristine tree — unit fixtures alone do not prove the checker is
 *     wired to the policy.
 *
 * Placement mirrors lifecycleStateWriteBoundary.test.ts: apps/web is the
 * DB-free app suite and already hosts repo-level structural tests. The
 * policy module is loaded dynamically (apps/web's production `tsc -b`
 * includes test files while the Docker builder copies neither config/ nor
 * scripts/ — a static cross-root import would break the production image
 * build, TS2307).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..", "..", "..");
const POLICY_PATH = join(REPO_ROOT, "config", "build-graph-policy.mjs");
const CHECKER_PATH = join(REPO_ROOT, "scripts", "check-architecture.mjs");

interface DockerBuild {
  readonly name: string;
  readonly line: number;
}

interface UnsupportedItem {
  readonly line: number;
  readonly reason: string;
}

interface BuildablePackage {
  readonly name: string;
  readonly dir: string;
  readonly buildScript: string;
  readonly workspaceDependencies: readonly string[];
}

interface WorkspaceMember {
  readonly dir: string;
  readonly manifest: {
    readonly name?: string;
    readonly scripts?: { readonly build?: string };
    readonly dependencies?: Readonly<Record<string, string>>;
    readonly devDependencies?: Readonly<Record<string, string>>;
  };
}

interface HelperReference {
  readonly packageName: string;
  readonly helperPath: string;
}

interface BuildGraphPolicy {
  parseWorkspacePackageGlobs(yamlText: string): string[];
  expandWorkspaceGlobs(globs: readonly string[]): string[];
  deriveBuildablePackages(
    members: readonly WorkspaceMember[],
  ): BuildablePackage[];
  parseDockerfileBuilds(dockerfileText: string): {
    builds: DockerBuild[];
    unsupported: UnsupportedItem[];
  };
  dockerfileClosureFindings(input: {
    buildable: readonly BuildablePackage[];
    builds: readonly DockerBuild[];
    unsupported: readonly UnsupportedItem[];
  }): string[];
  parseBuildScriptHelpers(
    packageName: string,
    buildScript: string,
  ): {
    references: HelperReference[];
    unsupported: { packageName: string; reason: string }[];
  };
  helperCoverageFindings(input: {
    references: readonly HelperReference[];
    globalDependencies: readonly string[];
  }): string[];
}

let policy: BuildGraphPolicy;
beforeAll(async () => {
  policy = (await import(
    /* @vite-ignore */ pathToFileURL(POLICY_PATH).href
  )) as BuildGraphPolicy;
});

const CLEAN_DIST_BUILD =
  "node ../../scripts/clean-dist.mjs . && tsc -p tsconfig.build.json";

function member(
  name: string,
  buildScript: string | undefined,
  dependencies: Record<string, string> = {},
): WorkspaceMember {
  return {
    dir: `packages/${name.replace("@exam/", "")}`,
    manifest: {
      name,
      scripts: buildScript === undefined ? undefined : { build: buildScript },
      dependencies,
    },
  };
}

describe("workspace shape parsing", () => {
  it("reads the repo's real pnpm-workspace.yaml shape", () => {
    expect(
      policy.parseWorkspacePackageGlobs(
        'packages:\n  - "apps/*"\n  - "packages/*"\nallowBuilds:\n  argon2: true\n',
      ),
    ).toEqual(["apps/*", "packages/*"]);
  });

  it("refuses a workspace without packages entries (fail closed)", () => {
    expect(() =>
      policy.parseWorkspacePackageGlobs("allowBuilds:\n  argon2: true\n"),
    ).toThrow(/no `packages:` glob entries/);
  });

  it("expands only the single-level <dir>/* form", () => {
    expect(policy.expandWorkspaceGlobs(["apps/*", "packages/*"])).toEqual([
      "apps",
      "packages",
    ]);
    expect(() => policy.expandWorkspaceGlobs(["packages/**"])).toThrow(
      /not the supported "<dir>\/\*" form/,
    );
    expect(() => policy.expandWorkspaceGlobs(["packages/domain"])).toThrow(
      /not the supported "<dir>\/\*" form/,
    );
  });
});

describe("buildable set derivation", () => {
  it("requires a non-empty build script; fixture packages stay excluded", () => {
    const buildable = policy.deriveBuildablePackages([
      member("@exam/domain", CLEAN_DIST_BUILD),
      member("@exam/source-fixture", undefined),
      member("@exam/e2e", ""),
      member("@exam/blank", "   "),
    ]);
    expect(buildable.map((pkg) => pkg.name)).toEqual(["@exam/domain"]);
  });

  it("derives workspace dependency edges from member names, not hardcoded names", () => {
    const buildable = policy.deriveBuildablePackages([
      member("@exam/dep", CLEAN_DIST_BUILD),
      member("@exam/app", CLEAN_DIST_BUILD, {
        "@exam/dep": "workspace:*",
        react: "^19.0.0",
        "@exam/source-fixture": "workspace:*",
      }),
    ]);
    const app = buildable.find((pkg) => pkg.name === "@exam/app");
    expect(app?.workspaceDependencies).toEqual(["@exam/dep"]);
  });

  it("only product dependencies form build edges (devDependencies stay outside)", () => {
    const buildable = policy.deriveBuildablePackages([
      member("@exam/dep", CLEAN_DIST_BUILD),
      member("@exam/app", CLEAN_DIST_BUILD),
    ]);
    const app = buildable.find((pkg) => pkg.name === "@exam/app");
    // @exam/dep declared only in devDependencies is not a build edge:
    // simulated by not declaring it at all in `dependencies`.
    expect(app?.workspaceDependencies).toEqual([]);
  });

  // #939 turbo 2.9.16 probe (scratch workspace, `turbo build
  // --dry-run=json`): b#build.dependencies === ["a#build"] even when b
  // declares a solely in devDependencies — turbo's `^build` schedules
  // devDependency workspace edges. These two tests pin the checker's
  // DECLARED narrowing to the product graph (#824 D2): the Docker builder
  // sequence builds product artifacts that never consume a test-scope
  // dependency, so the guard must not invent turbo's edge. A future change
  // here is a reviewed policy change, not a silent alignment.
  it("an actual devDependencies declaration forms no build edge (turbo graph superset, declared narrowing)", () => {
    const buildable = policy.deriveBuildablePackages([
      member("@exam/dep", CLEAN_DIST_BUILD),
      {
        dir: "packages/consumer",
        manifest: {
          name: "@exam/consumer",
          scripts: { build: CLEAN_DIST_BUILD },
          dependencies: {},
          devDependencies: { "@exam/dep": "workspace:*" },
        },
      },
    ]);
    const consumer = buildable.find((pkg) => pkg.name === "@exam/consumer");
    expect(consumer?.workspaceDependencies).toEqual([]);
    expect(
      buildable.find((pkg) => pkg.name === "@exam/dep")?.workspaceDependencies,
    ).toEqual([]);
  });

  it("the Dockerfile order rule ignores devDependency edges (turbo would order them)", () => {
    const buildable: BuildablePackage[] = [
      {
        name: "@exam/consumer",
        dir: "packages/consumer",
        buildScript: CLEAN_DIST_BUILD,
        workspaceDependencies: [],
      },
      {
        name: "@exam/dep",
        dir: "packages/dep",
        buildScript: CLEAN_DIST_BUILD,
        workspaceDependencies: [],
      },
    ];
    const findings = policy.dockerfileClosureFindings({
      buildable,
      builds: [
        { name: "@exam/consumer", line: 2 },
        { name: "@exam/dep", line: 3 },
      ],
      unsupported: [],
    });
    expect(findings).toEqual([]);
  });
});

describe("Dockerfile build-line grammar", () => {
  it("attributes the repo's real build line form", () => {
    const parsed = policy.parseDockerfileBuilds(
      "FROM node AS builder\nRUN pnpm --reporter=append-only --filter @exam/domain build\nRUN pnpm --filter @exam/api --prod deploy --legacy /out\n",
    );
    expect(parsed.builds).toEqual([{ name: "@exam/domain", line: 2 }]);
    expect(parsed.unsupported).toEqual([]);
  });

  it("flags flags-only preamble and ignores non-build pnpm commands", () => {
    const parsed = policy.parseDockerfileBuilds(
      "RUN pnpm install --frozen-lockfile\nRUN pnpm --filter @exam/api --prod deploy --legacy /out\n",
    );
    expect(parsed.builds).toEqual([]);
    expect(parsed.unsupported).toEqual([]);
  });

  it.each([
    [
      "RUN pnpm --filter @exam/domain run build",
      /"run" spelling included|unexpected positional/,
    ],
    ["RUN pnpm -r build", /recursive\/root pnpm build/],
    ["RUN pnpm build", /recursive\/root pnpm build/],
    ["RUN pnpm --filter @exam/* build", /not an exact package name/],
    ["RUN pnpm --filter A --filter B build", /multiple --filter flags/],
    ["RUN pnpm --filter @exam/domain build --prod", /unsupported position/],
    ["RUN pnpm --filter=@exam/domain build", /--filter=<name> spelling/],
    ["RUN npm run build", /non-pnpm build runner/],
    ["RUN make build", /non-pnpm build runner/],
    ["RUN <<EOF", /heredoc RUN cannot be classified/],
    [
      "RUN pnpm --filter @exam/domain build && cp x y",
      /chained RUN containing a build command/,
    ],
    [
      "RUN pnpm --filter @exam/domain build \\\n  && cp x y",
      /multi-line RUN carrying a build command/,
    ],
    [
      // Shell wrapper forms hide the command text behind quoting; the guard
      // does not parse shell semantics, so the line must fail closed (a
      // silent skip here would let a workspace build escape the closure —
      // observed live before the fail-closed tail existed, #939).
      'RUN sh -c "pnpm --filter @exam/domain build"',
      /unrecognized RUN form may execute a workspace build/,
    ],
    [
      // Docker exec-form RUN: same fail-closed decision — the form is never
      // attributed as a build, it is rejected as unverifiable.
      'RUN ["pnpm", "--filter", "@exam/domain", "build"]',
      /unrecognized RUN form may execute a workspace build/,
    ],
  ])("unsupported form: %s", (line, reasonPattern) => {
    const parsed = policy.parseDockerfileBuilds(line);
    expect(parsed.builds).toEqual([]);
    expect(parsed.unsupported).toHaveLength(1);
    expect(parsed.unsupported[0]?.reason).toMatch(reasonPattern as RegExp);
  });

  it("comments and non-RUN lines carry no build claim", () => {
    const parsed = policy.parseDockerfileBuilds(
      '# RUN pnpm --filter @exam/ghost build\nCOPY --from=builder /out ./\nENTRYPOINT ["x"]\n',
    );
    expect(parsed.builds).toEqual([]);
    expect(parsed.unsupported).toEqual([]);
  });
});

describe("C1 closure findings", () => {
  // Minimal valid closure: @exam/app depends on @exam/dep, built in order.
  const base: { buildable: BuildablePackage[]; builds: DockerBuild[] } = {
    buildable: [
      {
        name: "@exam/dep",
        dir: "packages/dep",
        buildScript: CLEAN_DIST_BUILD,
        workspaceDependencies: [],
      },
      {
        name: "@exam/app",
        dir: "apps/app",
        buildScript: CLEAN_DIST_BUILD,
        workspaceDependencies: ["@exam/dep"],
      },
    ],
    builds: [
      { name: "@exam/dep", line: 2 },
      { name: "@exam/app", line: 3 },
    ],
  };

  it("the matching closure is clean", () => {
    expect(
      policy.dockerfileClosureFindings({ ...base, unsupported: [] }),
    ).toEqual([]);
  });

  it("a buildable package missing from the Dockerfile is a CLOSURE violation (C4.1)", () => {
    const findings = policy.dockerfileClosureFindings({
      buildable: [
        ...base.buildable,
        {
          name: "@exam/new-pkg",
          dir: "packages/new-pkg",
          buildScript: CLEAN_DIST_BUILD,
          workspaceDependencies: [],
        },
      ],
      builds: base.builds,
      unsupported: [],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain("BUILD_GRAPH_DOCKER_CLOSURE");
    expect(findings[0]).toContain("@exam/new-pkg");
  });

  it("a Dockerfile build without a workspace build script is a STALE_ENTRY", () => {
    const findings = policy.dockerfileClosureFindings({
      buildable: base.buildable,
      builds: [...base.builds, { name: "@exam/ghost", line: 4 }],
      unsupported: [],
    });
    expect(
      findings.find((f) => f.includes("BUILD_GRAPH_DOCKER_STALE_ENTRY")),
    ).toContain("@exam/ghost");
  });

  it("a duplicated build line is a DUPLICATE violation", () => {
    const findings = policy.dockerfileClosureFindings({
      buildable: base.buildable,
      builds: [...base.builds, { name: "@exam/dep", line: 4 }],
      unsupported: [],
    });
    const finding = findings.find((f) =>
      f.includes("BUILD_GRAPH_DOCKER_DUPLICATE"),
    );
    expect(finding).toContain("@exam/dep");
    expect(finding).toContain("Dockerfile:4");
  });

  it("building a package before its workspace dependency is an ORDER violation", () => {
    const findings = policy.dockerfileClosureFindings({
      buildable: base.buildable,
      builds: [
        { name: "@exam/app", line: 2 },
        { name: "@exam/dep", line: 3 },
      ],
      unsupported: [],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain("BUILD_GRAPH_DOCKER_ORDER");
    expect(findings[0]).toContain("@exam/app");
    expect(findings[0]).toContain("@exam/dep");
  });

  it("a dependency cycle has no valid order and is a CYCLE violation", () => {
    const cyclic: BuildablePackage[] = [
      {
        name: "@exam/a",
        dir: "packages/a",
        buildScript: CLEAN_DIST_BUILD,
        workspaceDependencies: ["@exam/b"],
      },
      {
        name: "@exam/b",
        dir: "packages/b",
        buildScript: CLEAN_DIST_BUILD,
        workspaceDependencies: ["@exam/a"],
      },
    ];
    const findings = policy.dockerfileClosureFindings({
      buildable: cyclic,
      builds: [
        { name: "@exam/a", line: 2 },
        { name: "@exam/b", line: 3 },
      ],
      unsupported: [],
    });
    // In a cycle every linearization also violates the order rule, so the
    // cycle is reported alongside the order findings it implies.
    expect(
      findings.find((f) => f.includes("BUILD_GRAPH_DOCKER_CYCLE")),
    ).toContain("@exam/a");
    expect(findings.length).toBeGreaterThanOrEqual(1);
  });

  it("unsupported Dockerfile forms surface as named violations", () => {
    const findings = policy.dockerfileClosureFindings({
      buildable: base.buildable,
      builds: base.builds,
      unsupported: [{ line: 9, reason: "heredoc RUN cannot be classified" }],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain("Dockerfile:9");
    expect(findings[0]).toContain("BUILD_GRAPH_DOCKER_UNSUPPORTED");
  });
});

describe("C2 helper reference parsing", () => {
  it("recognizes the repo's clean-dist invocation form", () => {
    const parsed = policy.parseBuildScriptHelpers(
      "@exam/domain",
      CLEAN_DIST_BUILD,
    );
    expect(parsed.references).toEqual([
      { packageName: "@exam/domain", helperPath: "scripts/clean-dist.mjs" },
    ]);
    expect(parsed.unsupported).toEqual([]);
  });

  it("web's tsc+vite build references no repo-level helper", () => {
    const parsed = policy.parseBuildScriptHelpers(
      "@exam/web",
      "tsc -b && vite build",
    );
    expect(parsed.references).toEqual([]);
    expect(parsed.unsupported).toEqual([]);
  });

  it("normalizes dot-segment dodges onto the repo helper path", () => {
    const parsed = policy.parseBuildScriptHelpers(
      "@exam/x",
      "node ../x/../../scripts/clean-dist.mjs . && tsc -p tsconfig.build.json",
    );
    expect(parsed.references).toEqual([
      { packageName: "@exam/x", helperPath: "scripts/clean-dist.mjs" },
    ]);
    expect(parsed.unsupported).toEqual([]);
  });

  it("a helper invoked with simple literal arguments is a recognized reference", () => {
    const parsed = policy.parseBuildScriptHelpers(
      "@exam/x",
      "node ../../scripts/prune.mjs dist && tsc -p tsconfig.build.json",
    );
    expect(parsed.unsupported).toEqual([]);
    expect(parsed.references).toEqual([
      { packageName: "@exam/x", helperPath: "scripts/prune.mjs" },
    ]);
  });

  it.each([
    [
      "bash ../../scripts/helper.sh && tsc",
      "references a repo-level helper without the supported",
    ],
    ["node $HELPER . && tsc", "shell features"],
    ["node /abs/scripts/helper.mjs && tsc", "not a plain relative path"],
    [
      "node ../../scripts/../package.json && tsc",
      "reaches scripts/ in an unsupported spelling",
    ],
    ["node ../../scripts && tsc", "does not name a single file"],
    ["node ./gen.mjs > out.log && tsc", "redirection"],
    ["node ./gen.mjs; tsc", "shell features"],
    ["node ./gen.mjs || tsc", "shell features"],
    [
      "npx node ../../scripts/h.mjs && tsc",
      "references a repo-level helper without the supported",
    ],
    ["node ../../scripts/h.mjs --flag=$X && tsc", "shell features"],
    ["node ../../scripts/h.mjs *.log && tsc", "unclassifiable argument"],
  ])("unsupported/witness form: %s", (script, reasonPattern) => {
    const parsed = policy.parseBuildScriptHelpers("@exam/x", script);
    expect(parsed.unsupported.length).toBeGreaterThanOrEqual(1);
    expect(parsed.unsupported[0]?.reason).toMatch(new RegExp(reasonPattern));
  });
});

describe("C2 helper coverage", () => {
  const refs = [
    { packageName: "@exam/domain", helperPath: "scripts/clean-dist.mjs" },
    { packageName: "@exam/new", helperPath: "scripts/prune-stale-types.mjs" },
    { packageName: "@exam/deep", helperPath: "scripts/nested/deep-helper.mjs" },
  ];

  it("an uncovered helper is a HELPER_UNREGISTERED violation naming the registration (C4.2)", () => {
    const findings = policy.helperCoverageFindings({
      references: refs,
      globalDependencies: [
        "config/**",
        "scripts/clean-dist.mjs",
        "tsconfig.base.json",
      ],
    });
    expect(findings).toHaveLength(2);
    expect(findings[0]).toContain("BUILD_GRAPH_HELPER_UNREGISTERED");
    expect(findings[0]).toContain("scripts/prune-stale-types.mjs");
    expect(findings[1]).toContain("scripts/nested/deep-helper.mjs");
  });

  it("exact entries cover; scripts/* covers direct children only; scripts/** covers nested", () => {
    expect(
      policy.helperCoverageFindings({
        references: [refs[0] as HelperReference],
        globalDependencies: ["scripts/clean-dist.mjs"],
      }),
    ).toEqual([]);
    expect(
      policy.helperCoverageFindings({
        references: [refs[0] as HelperReference, refs[2] as HelperReference],
        globalDependencies: ["scripts/*"],
      }),
    ).toHaveLength(1);
    expect(
      policy.helperCoverageFindings({
        references: refs,
        globalDependencies: ["scripts/**"],
      }),
    ).toEqual([]);
    expect(
      policy.helperCoverageFindings({
        references: [refs[0] as HelperReference],
        globalDependencies: ["config/**"],
      }).length,
    ).toBe(1);
  });
});

describe("real repo scans clean through the policy the checker uses", () => {
  async function collectMembers(): Promise<WorkspaceMember[]> {
    const yaml = await readFile(join(REPO_ROOT, "pnpm-workspace.yaml"), "utf8");
    const members: WorkspaceMember[] = [];
    for (const base of policy.expandWorkspaceGlobs(
      policy.parseWorkspacePackageGlobs(yaml),
    )) {
      for (const entry of await readdir(join(REPO_ROOT, base), {
        withFileTypes: true,
      })) {
        if (!entry.isDirectory()) continue;
        const manifestPath = join(REPO_ROOT, base, entry.name, "package.json");
        const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
        members.push({
          dir: `${base}/${entry.name}`,
          manifest: {
            name: manifest.name,
            scripts: { build: manifest.scripts?.build },
            dependencies: manifest.dependencies,
          },
        });
      }
    }
    return members;
  }

  it("real buildable set, Dockerfile sequence and helper coverage agree", async () => {
    const buildable = policy.deriveBuildablePackages(await collectMembers());
    expect(buildable.length).toBeGreaterThan(0);
    const parsed = policy.parseDockerfileBuilds(
      await readFile(join(REPO_ROOT, "Dockerfile"), "utf8"),
    );
    expect(parsed.unsupported).toEqual([]);
    expect(policy.dockerfileClosureFindings({ buildable, ...parsed })).toEqual(
      [],
    );
    const globalDependencies = JSON.parse(
      await readFile(join(REPO_ROOT, "turbo.json"), "utf8"),
    ).globalDependencies as string[];
    const references = buildable.flatMap(
      (pkg) =>
        policy.parseBuildScriptHelpers(pkg.name, pkg.buildScript).references,
    );
    expect(references.length).toBeGreaterThan(0);
    expect(
      policy.helperCoverageFindings({ references, globalDependencies }),
    ).toEqual([]);
  }, 30_000);
});

/**
 * CLI-level counterfactuals through the REAL gate entry, in a disposable
 * `git worktree` (main working tree never touched). The checker and the
 * build-graph policy are copied from the WORKING tree so local pre-commit
 * runs exercise the current implementation (byte-identical no-op in CI).
 *
 * INVARIANT: the copy list below must cover every repo-owned module this
 * PR changes; modules the checker shares with the committed tree
 * (architecture-policy, workspace-resolution) are exercised at their
 * committed versions. A missing module fails the pristine-green test with
 * a module-not-found error rather than passing vacuously.
 */
describe("real lint:arch entry rejects the counterfactuals (disposable worktree)", () => {
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

  beforeAll(async () => {
    worktreeRoot = await mkdtemp(join(tmpdir(), "exam-build-graph-"));
    worktree = join(worktreeRoot, "wt");
    git(["worktree", "add", "--detach", worktree, "HEAD"], REPO_ROOT);
    await copyFile(
      CHECKER_PATH,
      join(worktree, "scripts", "check-architecture.mjs"),
    );
    await copyFile(
      POLICY_PATH,
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

  it("C4.1: a new buildable workspace package without a Dockerfile build is rejected", async () => {
    const pkgDir = join(worktree, "packages", "synthetic-idx");
    await mkdir(join(pkgDir, "src"), { recursive: true });
    await writeFile(
      join(pkgDir, "package.json"),
      JSON.stringify(
        {
          name: "@exam/synthetic-idx",
          private: true,
          type: "module",
          scripts: { build: CLEAN_DIST_BUILD },
          exports: {
            ".": {
              "@exam/test-source": "./src/index.ts",
              types: "./dist/index.d.ts",
              default: "./dist/index.js",
            },
          },
        },
        null,
        2,
      ),
    );
    await writeFile(
      join(pkgDir, "src", "index.ts"),
      'export const SYNTHETIC_IDX = "synthetic-idx";\n',
    );
    const run = runChecker();
    await rm(pkgDir, { recursive: true, force: true });
    expect(run.code, run.stderr).toBe(1);
    expect(run.stderr).toContain("BUILD_GRAPH_DOCKER_CLOSURE");
    expect(run.stderr).toContain("@exam/synthetic-idx");
  }, 60_000);

  it("C4.2: a build script referencing an unregistered repo-level helper is rejected", async () => {
    const helperRel = "scripts/prune-stale-types.mjs";
    await writeFile(
      join(worktree, helperRel),
      "import { rmSync } from 'node:fs';\nrmSync(process.argv[2], { recursive: true, force: true });\n",
    );
    const manifestPath = join(worktree, "packages", "domain", "package.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const original = await readFile(manifestPath, "utf8");
    manifest.scripts.build = `${CLEAN_DIST_BUILD.replace(
      " && tsc -p tsconfig.build.json",
      "",
    )} && node ../../scripts/prune-stale-types.mjs dist/types-stale && tsc -p tsconfig.build.json`;
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    const run = runChecker();
    await writeFile(manifestPath, original);
    await rm(join(worktree, helperRel));
    expect(run.code, run.stderr).toBe(1);
    expect(run.stderr).toContain("BUILD_GRAPH_HELPER_UNREGISTERED");
    expect(run.stderr).toContain("scripts/prune-stale-types.mjs");
  }, 60_000);

  it("an unsupported Dockerfile build form is rejected, not ignored", async () => {
    const dockerfilePath = join(worktree, "Dockerfile");
    const original = await readFile(dockerfilePath, "utf8");
    await writeFile(
      dockerfilePath,
      original.replace(
        "RUN pnpm --reporter=append-only --filter @exam/domain build",
        "RUN pnpm --reporter=append-only --filter @exam/domain run build",
      ),
    );
    const run = runChecker();
    await writeFile(dockerfilePath, original);
    expect(run.code, run.stderr).toBe(1);
    expect(run.stderr).toContain("BUILD_GRAPH_DOCKER_UNSUPPORTED");
  }, 60_000);

  // Both wrapper variants below append a workspace build that escapes the
  // declared closure: @exam/e2e is a real workspace member with NO build
  // script, so a recognized `--filter @exam/e2e build` line would be a
  // STALE_ENTRY violation. If the checker silently ignored the wrapper form
  // instead (the pre-#939 defect), the gate exited 0 with the workspace
  // build unverifiable in the image.
  it('a shell-wrapped workspace build (RUN sh -c "...") is rejected, not ignored', async () => {
    const dockerfilePath = join(worktree, "Dockerfile");
    const original = await readFile(dockerfilePath, "utf8");
    await writeFile(
      dockerfilePath,
      `${original}RUN sh -c "pnpm --filter @exam/e2e build"\n`,
    );
    const run = runChecker();
    await writeFile(dockerfilePath, original);
    expect(run.code, run.stderr).toBe(1);
    expect(run.stderr).toContain("BUILD_GRAPH_DOCKER_UNSUPPORTED");
    expect(run.stderr).toContain("workspace build");
  }, 60_000);

  it('a JSON exec-form workspace build (RUN ["pnpm", ...]) is rejected, not ignored', async () => {
    const dockerfilePath = join(worktree, "Dockerfile");
    const original = await readFile(dockerfilePath, "utf8");
    await writeFile(
      dockerfilePath,
      `${original}RUN ["pnpm", "--filter", "@exam/e2e", "build"]\n`,
    );
    const run = runChecker();
    await writeFile(dockerfilePath, original);
    expect(run.code, run.stderr).toBe(1);
    expect(run.stderr).toContain("BUILD_GRAPH_DOCKER_UNSUPPORTED");
    expect(run.stderr).toContain("workspace build");
  }, 60_000);
});
