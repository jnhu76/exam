import { afterAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * #741 W2 — the supported TEST env-file source set and its precedence,
 * pinned at the shared-loader seam every vitest config consumes.
 *
 * The frozen contract (docs/standards/testing.md §2, .env.example):
 *   file sources     = repo-root `.env` + optional `.env.test.local` ONLY;
 *   file-level       = `.env.test.local` overrides `.env` per key;
 *   shell            = beats every file value (only-if-undefined seeding);
 *   TEST_RUNTIME_ENV = owns APP_MODE/NODE_ENV in the config `env`
 *                      projection (spread last).
 *
 * Unsupported root mode files (`.env.local`, `.env.test`, …) must be
 * PROVABLY ignored here — no code path parses them — while the env-surface
 * guard additionally fails loud at verify when they exist on disk (see
 * envSurfaceGuard.test.ts).
 *
 * Probe shape: the policy/loader modules live at the repository root
 * (imported by every vitest config), outside this package's vite root, so
 * the assertions run in one tsx child (the repo's standard process-level
 * probe) against throwaway mkdtemp fixtures. This suite never writes a
 * repository env-file authority (#741 W3), and the seeding semantics are
 * exercised in the child's isolated process.env instead of the worker's.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const envFilePolicyUrl = new URL(
  `file://${join(REPO_ROOT, "envFilePolicy.ts")}`,
).href;
const vitestSharedUrl = new URL(`file://${join(REPO_ROOT, "vitest.shared.ts")}`)
  .href;
const tsxLoaderUrl = String(import.meta.resolve("tsx"));

const createdDirs: string[] = [];
afterAll(async () => {
  for (const dir of createdDirs) {
    await rm(dir, { recursive: true, force: true });
  }
});

interface ProbeReport {
  supportedRootFiles: string[];
  supportedTestFiles: string[];
  supportedFlags: [string, boolean][];
  unsupportedFlags: [string, boolean][];
  parsed: {
    override: Record<string, string>;
    loneBase: Record<string, string>;
    none: Record<string, string>;
    unsupportedOnly: Record<string, string>;
  };
  seeding: { shellOwned: string; fileOnly: string };
  projection: Record<string, string>;
}

/**
 * Child probe importing the REAL root modules and running every scenario
 * against fixture dirs the parent plants. Reports one JSON object on stdout.
 */
function probeScript(dirsJson: string): string {
  return `
const [policyUrl, sharedUrl] = process.argv.slice(2);
const dirs = ${dirsJson};
const {
  SUPPORTED_ROOT_ENV_FILES,
  SUPPORTED_TEST_ENV_FILES,
  isSupportedRootEnvFileName,
} = await import(policyUrl);
const {
  TEST_RUNTIME_ENV,
  loadSupportedTestEnvFiles,
  seedProcessEnvFromFiles,
} = await import(sharedUrl);

const report = {};
report.supportedRootFiles = [...SUPPORTED_ROOT_ENV_FILES];
report.supportedTestFiles = [...SUPPORTED_TEST_ENV_FILES];
report.supportedFlags = SUPPORTED_ROOT_ENV_FILES.map((f) => [f, isSupportedRootEnvFileName(f)]);
report.unsupportedFlags = [
  ".env.local", ".env.development", ".env.development.local", ".env.test",
  ".env.production.local", ".env.e2e", "apps/api/.env",
].map((f) => [f, isSupportedRootEnvFileName(f)]);

report.parsed = {
  override: loadSupportedTestEnvFiles(dirs.override),
  loneBase: loadSupportedTestEnvFiles(dirs.loneBase),
  none: loadSupportedTestEnvFiles(dirs.none),
  unsupportedOnly: loadSupportedTestEnvFiles(dirs.unsupportedOnly),
};

// seeding + projection run against the child's own isolated process.env
const fileEnv = loadSupportedTestEnvFiles(dirs.override);
process.env.SEED_SHELL_OWNED = "from-shell";
delete process.env.SEED_FILE_ONLY;
seedProcessEnvFromFiles(fileEnv);
report.seeding = {
  shellOwned: process.env.SEED_SHELL_OWNED,
  fileOnly: process.env.SEED_FILE_ONLY,
};

const fileEnvWithMode = loadSupportedTestEnvFiles(dirs.mode);
report.projection = { ...fileEnvWithMode, ...TEST_RUNTIME_ENV };

process.stdout.write(JSON.stringify(report));
`;
}

let reportPromise: Promise<ProbeReport> | undefined;

/** Plant fixtures, run the ONE child probe, memoize its parsed report. */
function probeReport(): Promise<ProbeReport> {
  reportPromise ??= (async () => {
    const dir = await mkdtemp(join(tmpdir(), "exam-test-env-source-set-"));
    createdDirs.push(dir);
    const dirs = {
      override: join(dir, "override"),
      loneBase: join(dir, "loneBase"),
      none: join(dir, "none"),
      unsupportedOnly: join(dir, "unsupportedOnly"),
      mode: join(dir, "mode"),
    };
    for (const sub of Object.values(dirs)) {
      await mkdir(sub, { recursive: true });
    }
    await writeFile(
      join(dirs.override, ".env"),
      "KEY=A\nONLY_BASE=1\nSEED_FILE_ONLY=from-file\n",
    );
    await writeFile(join(dirs.override, ".env.test.local"), "KEY=B\n");
    await writeFile(
      join(dirs.override, ".env.local"),
      "KEY=local\nLOCAL_ONLY=1\n",
    );
    await writeFile(
      join(dirs.override, ".env.test"),
      "KEY=test\nTEST_ONLY=1\n",
    );
    await writeFile(
      join(dirs.override, ".env.development"),
      "KEY=development\n",
    );
    await writeFile(
      join(dirs.override, ".env.production.local"),
      "KEY=production_local\n",
    );
    await writeFile(join(dirs.loneBase, ".env"), "KEY=A\n");
    await writeFile(join(dirs.none, "readme.txt"), "not an env file\n");
    await writeFile(join(dirs.unsupportedOnly, ".env.local"), "KEY=local\n");
    await writeFile(join(dirs.unsupportedOnly, ".env.test"), "KEY=test\n");
    await writeFile(
      join(dirs.mode, ".env"),
      "APP_MODE=development\nNODE_ENV=development\nKEY=A\n",
    );
    const probePath = join(dir, "probe.mjs");
    await writeFile(probePath, probeScript(JSON.stringify(dirs)));

    return await new Promise<ProbeReport>((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          "--import",
          tsxLoaderUrl,
          probePath,
          envFilePolicyUrl,
          vitestSharedUrl,
        ],
        { cwd: dir, stdio: ["ignore", "pipe", "pipe"] },
      );
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk) => (stdout += chunk));
      child.stderr.on("data", (chunk) => (stderr += chunk));
      child.on("error", reject);
      child.on("exit", (code) => {
        try {
          resolve(JSON.parse(stdout) as ProbeReport);
        } catch {
          reject(
            new Error(
              `child produced no JSON report (exit=${code}) — stdout=${JSON.stringify(
                stdout.slice(0, 2000),
              )} stderr=${JSON.stringify(stderr.slice(0, 2000))}`,
            ),
          );
        }
      });
    });
  })();
  return reportPromise;
}

describe("root env-file policy data (#741)", () => {
  it("supports exactly the five root files and rejects unsupported variants", async () => {
    const report = await probeReport();
    expect(report.supportedRootFiles).toEqual([
      ".env",
      ".env.test.local",
      ".env.production",
      ".env.example",
      ".env.production.example",
    ]);
    expect(report.supportedFlags.every(([, ok]) => ok)).toBe(true);
    expect(report.unsupportedFlags.map(([name]) => name)).toEqual(
      expect.arrayContaining([
        ".env.local",
        ".env.development",
        ".env.test",
        ".env.production.local",
      ]),
    );
    expect(report.unsupportedFlags.every(([, ok]) => !ok)).toBe(true);
  });

  it("the vitest source set is the development .env plus the test override only", async () => {
    const report = await probeReport();
    expect(report.supportedTestFiles).toEqual([".env", ".env.test.local"]);
  });

  it("lives at the repository root, next to the workspace manifest", () => {
    expect(existsSync(join(REPO_ROOT, "envFilePolicy.ts"))).toBe(true);
    expect(existsSync(join(REPO_ROOT, "package.json"))).toBe(true);
  });
});

describe("loadSupportedTestEnvFiles (file-level precedence + provable ignorance)", () => {
  it("admits .env, lets .env.test.local override per key, and provably ignores unsupported root files", async () => {
    const report = await probeReport();

    // H4: the override file wins for the shared key …
    expect(report.parsed.override.KEY).toBe("B");
    // … while non-overlapping base keys still flow through.
    expect(report.parsed.override.ONLY_BASE).toBe("1");
    // H3 mechanism half: unsupported mode files contribute NOTHING — not
    // their keys, not their overriding values.
    expect(report.parsed.override).not.toHaveProperty("LOCAL_ONLY");
    expect(report.parsed.override).not.toHaveProperty("TEST_ONLY");
    expect(report.parsed.unsupportedOnly).toEqual({});
  });

  it("parses a lone .env and returns an empty record when no supported file exists", async () => {
    const report = await probeReport();
    expect(report.parsed.loneBase).toEqual({ KEY: "A" });
    expect(report.parsed.none).toEqual({});
  });
});

describe("seedProcessEnvFromFiles (shell wins over file values)", () => {
  it("keeps shell-owned values and fills undefined keys only", async () => {
    const report = await probeReport();
    expect(report.seeding.shellOwned).toBe("from-shell");
    expect(report.seeding.fileOnly).toBe("from-file");
  });
});

describe("config env projection composition ({...fileEnv, ...TEST_RUNTIME_ENV})", () => {
  it("TEST_RUNTIME_ENV owns APP_MODE/NODE_ENV over any file-provided value", async () => {
    const report = await probeReport();
    expect(report.projection.APP_MODE).toBe("test");
    expect(report.projection.NODE_ENV).toBe("test");
    expect(report.projection.KEY).toBe("A");
  });
});
