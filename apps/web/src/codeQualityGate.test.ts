import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  collectViolations,
  isConsoleOutput,
} from "../../../scripts/check-code-quality.mjs";

/**
 * Regression gate for #821 G1/G4 — `scripts/check-code-quality.mjs`.
 *
 * G1: the scanner resolved `["apps", "packages"]` against the CALLER's CWD, so
 * every workspace package's `lint` script
 * (`node ../../scripts/check-code-quality.mjs`) died with `ENOENT ... scandir
 * 'apps'` and was dead wiring. The real-CLI proof below is red before the fix
 * (apps/api CWD → exit 1 + ENOENT) and green after.
 *
 * G4: Playwright's gitignored report/test output under apps/e2e/ is generated
 * JavaScript that legitimately writes diagnostics through the banned console
 * calls; scanning it turned a local E2E run into a lint false red (12
 * violations). The fixture-repository proofs keep that output ignored while an
 * ordinary E2E spec source is still rejected, and the detector unit proof
 * shows the exclusion does not weaken the console ban itself.
 *
 * The CLI proofs spawn the REAL script. Root-resolution and scope proofs copy
 * it into a throwaway fixture repository, because the production rule is
 * "resolve from my own location": the copy exercises exactly that behaviour
 * without writing into this repository. The unit proof imports the same
 * exported scan implementation — no second scanner.
 *
 * Placement: apps/web is the DB-free app suite (apps/api's Vitest globalSetup
 * requires PostgreSQL), and repo-level structural tests already live here
 * (workspaceSourceResolution.test.ts, vite-env-file-admission.test.ts).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");
const SCANNER = join(REPO_ROOT, "scripts", "check-code-quality.mjs");

/**
 * The console ban is a line regex, so it also matches string literals (that is
 * pre-existing gate behaviour, not something this suite changes). Probe lines
 * are therefore assembled at runtime: writing the call literally here would
 * make this very test file fail `pnpm lint`.
 */
const CONSOLE = "console";
function consoleCall(method: "log" | "error", argument: string): string {
  return `${CONSOLE}.${method}(${argument});\n`;
}

const CLEAN_SOURCE =
  'import { logger } from "../lib/logger.js";\nlogger.info("ok");\n';

const createdRepos: string[] = [];
afterAll(async () => {
  for (const repo of createdRepos) {
    await rm(repo, { recursive: true, force: true });
  }
});

interface ScriptRun {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

function runScanner(scriptPath: string, cwd: string): ScriptRun {
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd,
    encoding: "utf8",
  });
  return {
    code: result.status ?? -1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

async function writeRepoFile(
  repoRoot: string,
  relativePath: string,
  text: string,
): Promise<void> {
  const target = join(repoRoot, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, text, "utf8");
}

/**
 * Throwaway repository with the real scanner copied into `scripts/`, so the
 * copy resolves its repository root from its own location — the production
 * behaviour.
 */
async function makeFixtureRepository(): Promise<string> {
  const repoRoot = await mkdtemp(join(tmpdir(), "exam-code-quality-"));
  createdRepos.push(repoRoot);
  await writeRepoFile(
    repoRoot,
    "scripts/check-code-quality.mjs",
    await readFile(SCANNER, "utf8"),
  );
  await writeRepoFile(repoRoot, "apps/api/src/clean.ts", CLEAN_SOURCE);
  await writeRepoFile(repoRoot, "packages/domain/src/clean.ts", CLEAN_SOURCE);
  await writeRepoFile(repoRoot, "apps/e2e/e2e/clean.spec.ts", CLEAN_SOURCE);
  return repoRoot;
}

describe("G1: lint is CWD-independent and repository-wide", () => {
  it("passes from the repository root and from apps/api with identical output", () => {
    const fromRoot = runScanner(SCANNER, REPO_ROOT);
    const fromApiPackage = runScanner(SCANNER, join(REPO_ROOT, "apps", "api"));

    // Pre-fix this exits 1 with `ENOENT ... scandir 'apps'`.
    expect(fromApiPackage.code).toBe(0);
    expect(fromApiPackage.stderr).toBe("");
    expect(fromRoot.code).toBe(0);
    expect(fromRoot.stdout).toBe("Code quality checks passed.\n");
    expect(fromApiPackage.stdout).toBe(fromRoot.stdout);
  });

  it("catches violations in both scan roots from a package CWD", async () => {
    const repoRoot = await makeFixtureRepository();
    const scanner = join(repoRoot, "scripts", "check-code-quality.mjs");
    const packageCwd = join(repoRoot, "apps", "api");

    expect(runScanner(scanner, repoRoot)).toMatchObject({
      code: 0,
      stderr: "",
    });
    expect(runScanner(scanner, packageCwd).code).toBe(0);

    await writeRepoFile(
      repoRoot,
      "apps/web/src/probe.tsx",
      consoleCall("error", '"probe"'),
    );
    await writeRepoFile(
      repoRoot,
      "packages/domain/src/probe.ts",
      consoleCall("log", '"probe"'),
    );

    const fromRoot = runScanner(scanner, repoRoot);
    const fromPackage = runScanner(scanner, packageCwd);

    expect(fromRoot.code).toBe(1);
    expect(fromPackage.code).toBe(1);
    // Byte-identical report from both CWDs: same scope, repo-relative paths.
    expect(fromPackage.stderr).toBe(fromRoot.stderr);
    expect(fromPackage.stderr).toContain(
      "apps/web/src/probe.tsx:1 console output",
    );
    expect(fromPackage.stderr).toContain(
      "packages/domain/src/probe.ts:1 console output",
    );
    // Paths are repo-relative, not CWD-dependent absolute paths.
    expect(fromPackage.stderr).not.toContain(repoRoot);

    await rm(join(repoRoot, "apps/web/src/probe.tsx"));
    await rm(join(repoRoot, "packages/domain/src/probe.ts"));
    expect(runScanner(scanner, packageCwd).code).toBe(0);
  });
});

describe("G4: generated Playwright output is not judged as source", () => {
  it("ignores report/test output but still rejects handwritten spec sources", async () => {
    const repoRoot = await makeFixtureRepository();
    const scanner = join(repoRoot, "scripts", "check-code-quality.mjs");

    // Bundled report JS is generated output; its diagnostics are expected.
    for (const generated of [
      "apps/e2e/playwright-report/data/report.js",
      "apps/e2e/test-results/error-context.js",
      "apps/e2e/test-results-patrol/report.js",
      "apps/e2e/blob-report/report.js",
    ]) {
      await writeRepoFile(
        repoRoot,
        generated,
        consoleCall("log", '"generated"'),
      );
    }
    const withGenerated = runScanner(scanner, repoRoot);
    expect(withGenerated.code, withGenerated.stderr).toBe(0);

    // Negative control: an ordinary E2E spec is handwritten source, not
    // generated output, so it must still fail the gate.
    await writeRepoFile(
      repoRoot,
      "apps/e2e/e2e/handwritten.spec.ts",
      consoleCall("log", '"handwritten"'),
    );
    const withHandwritten = runScanner(scanner, repoRoot);
    expect(withHandwritten.code).toBe(1);
    expect(withHandwritten.stderr).toContain(
      "apps/e2e/e2e/handwritten.spec.ts:1 console output",
    );
  });
});

describe("shared scan implementation", () => {
  it("detects only log/error console calls", () => {
    expect(isConsoleOutput(consoleCall("log", '"x"'))).toBe(true);
    expect(isConsoleOutput(consoleCall("error", '"x"'))).toBe(true);
    expect(isConsoleOutput(`${CONSOLE}.log(JSON.stringify({})) `)).toBe(true);
    expect(isConsoleOutput('logger.info("x")')).toBe(false);
    expect(isConsoleOutput("consoleLogger.warn(...)")).toBe(false);
  });

  it("collects violations from a mkdtemp repository (both scan roots)", async () => {
    const repoRoot = await makeFixtureRepository();
    expect(await collectViolations(repoRoot)).toEqual([]);

    await writeRepoFile(
      repoRoot,
      "apps/api/src/probe.ts",
      consoleCall("log", '"probe"'),
    );
    await writeRepoFile(
      repoRoot,
      "packages/contracts/src/probe.ts",
      consoleCall("error", '"probe"'),
    );

    const violations = await collectViolations(repoRoot);
    expect(violations).toHaveLength(2);
    expect(violations).toEqual(
      expect.arrayContaining([
        "apps/api/src/probe.ts:1 console output",
        "packages/contracts/src/probe.ts:1 console output",
      ]),
    );
  });
});
