import { afterAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * #741 H3/H6/H7 — the env-file source-surface guard
 * (scripts/check-env-surface.mjs) must FAIL LOUD on exactly the surfaces
 * the ROOT_ONLY_ENV_FILE_POLICY forbids, and pass on the live repository.
 *
 * Git cannot provide this signal: `.env` at any depth is gitignored, so a
 * hard-killed test's residue is invisible to `git status` — the guard scans
 * the real filesystem instead (H6: a nested ignored `.env` fails loud).
 * Unsupported ROOT variants (`.env.local`, `.env.test`, …) fail loud too
 * (H3); the mechanism half of H3 (unsupported files provably ignored by the
 * loaders even when present) is owned by testEnvSourceSet.test.ts.
 *
 * H7 lives here as the repo-level run: this suite never writes repository
 * env candidates (fixtures are throwaway trees under mkdtemp), and the
 * guard's G4 section passing against the live tree is the static proof that
 * the R1/R5 permanent suites write no repository env authority.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const GUARD_SCRIPT = join(REPO_ROOT, "scripts/check-env-surface.mjs");

const createdDirs: string[] = [];
afterAll(async () => {
  for (const dir of createdDirs) {
    await rm(dir, { recursive: true, force: true });
  }
});

interface GuardRun {
  code: number;
  output: string;
}

function runGuard(root: string): Promise<GuardRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [GUARD_SCRIPT, "--root", root], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, output }));
  });
}

/** Minimal clean fixture tree the guard accepts. */
async function makeCleanFixtureTree(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "exam-env-surface-guard-"));
  createdDirs.push(root);
  await mkdir(join(root, "apps/api/src/config"), { recursive: true });
  await mkdir(join(root, "apps/web"), { recursive: true });
  await mkdir(join(root, "packages/db"), { recursive: true });
  await mkdir(join(root, "scripts"), { recursive: true });
  await mkdir(join(root, "docs/deployment"), { recursive: true });
  await writeFile(join(root, ".env.example"), "# template\n");
  // The exact structural shapes G5 pins.
  await writeFile(
    join(root, "apps/api/vitest.config.ts"),
    "export default defineConfig(() => ({ envDir: false, test: {} }));\n",
  );
  await writeFile(
    join(root, "apps/web/vite.config.ts"),
    "export default defineConfig(({ mode }) => ({ envDir: false }));\n" +
      'const dev = mode !== "development" ? {} : parse();\n' +
      "void SUPPORTED_DEV_ENV_FILE;\n",
  );
  await writeFile(
    join(root, "packages/db/drizzle.config.ts"),
    'config({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });\n',
  );
  await writeFile(
    join(root, "apps/api/src/config/loadRootEnv.ts"),
    "export function resolveRootEnvPath() {\n" +
      '  return fileURLToPath(new URL("../../../../.env", import.meta.url));\n' +
      "}\n",
  );
  await writeFile(
    join(root, "scripts/db-backup.sh"),
    "docker compose --env-file .env.production exec db pg_dump\n",
  );
  await writeFile(
    join(root, "docs/deployment/mvp-deployment-runbook.md"),
    "docker compose --env-file .env.production up -d\n",
  );
  return root;
}

describe("env-surface guard (#741 H3/H6)", () => {
  it("passes the live repository tree", async () => {
    const run = await runGuard(REPO_ROOT);
    expect(run.output).toContain("PASS");
    expect(run.code, run.output.slice(-2000)).toBe(0);
  }, 60_000);

  it("accepts a clean fixture tree (temp .env fixtures outside the tree are not its business)", async () => {
    const root = await makeCleanFixtureTree();
    const run = await runGuard(root);
    expect(run.code, run.output.slice(-3000)).toBe(0);
  });

  it("FAILS LOUD on a nested ignored .env even though git would ignore it (H6)", async () => {
    const root = await makeCleanFixtureTree();
    await mkdir(join(root, "apps/api"), { recursive: true });
    await writeFile(join(root, "apps/api/.env"), "APP_PORT=46001\n");

    const run = await runGuard(root);

    expect(run.code).toBe(1);
    expect(run.output).toContain("FAIL");
    expect(run.output).toContain("apps/api/.env");
    expect(run.output).toContain("non-root env file");
  });

  it.each([
    [".env.local", "unsupported root env file"],
    [".env.development", "unsupported root env file"],
    [".env.test", "unsupported root env file"],
    [".env.production.local", "unsupported root env file"],
  ])("FAILS LOUD on the unsupported root variant %s (H3)", async (name) => {
    const root = await makeCleanFixtureTree();
    await writeFile(join(root, name), "KEY=drift\n");

    const run = await runGuard(root);

    expect(run.code).toBe(1);
    expect(run.output).toContain(name);
    expect(run.output).toContain("unsupported root env file");
  });

  it("FAILS LOUD when a vite/vitest config drops envDir: false (#741 G5)", async () => {
    const root = await makeCleanFixtureTree();
    await writeFile(
      join(root, "apps/web/vitest.config.ts"),
      "export default defineConfig({ test: {} });\n",
    );

    const run = await runGuard(root);

    expect(run.code).toBe(1);
    expect(run.output).toContain("apps/web/vitest.config.ts");
    expect(run.output).toContain("envDir: false");
  });

  it("FAILS LOUD on a dotenv reader outside the allowlist (#741 G3)", async () => {
    const root = await makeCleanFixtureTree();
    await writeFile(
      join(root, "apps/api/src/config/rogueAdmission.ts"),
      'import { config } from "dotenv";\nconfig();\n',
    );

    const run = await runGuard(root);

    expect(run.code).toBe(1);
    expect(run.output).toContain("rogueAdmission.ts");
    expect(run.output).toContain("allowlist");
  });

  it("FAILS LOUD on a test writing a repository-anchored env path (#741 G4)", async () => {
    const root = await makeCleanFixtureTree();
    // The violating tokens are assembled from parts: this test file is
    // itself scanned by the guard's G4 when it runs against the live tree,
    // so the literal writer shape must exist only in the planted fixture.
    const dirnameAnchor = ["__dir", "name"].join("");
    const envRelative = ["../.en", "v"].join("");
    const rogueSource =
      'import { writeFileSync } from "node:fs";\n' +
      'import { resolve } from "node:path";\n' +
      `writeFileSync(resolve(${dirnameAnchor}, ${JSON.stringify(envRelative)}), "APP_PORT=1\\n");\n`;
    await writeFile(
      join(root, "apps/api/src/rogue.fixture.test.ts"),
      rogueSource,
    );

    const run = await runGuard(root);

    expect(run.code).toBe(1);
    expect(run.output).toContain("rogue.fixture.test.ts");
    expect(run.output).toContain("real-candidate");
  });

  it("accepts a mkdtemp .env fixture writer (#741 G4 — temp fixtures are legitimate)", async () => {
    const root = await makeCleanFixtureTree();
    await writeFile(
      join(root, "apps/api/src/tempFixture.test.ts"),
      'import { writeFileSync } from "node:fs";\n' +
        'import { mkdtempSync } from "node:fs";\n' +
        'import { tmpdir } from "node:os";\n' +
        'const dir = mkdtempSync(join(tmpdir(), "fixture-"));\n' +
        'writeFileSync(join(dir, ".env"), "KEY=v\\n");\n',
    );

    const run = await runGuard(root);

    expect(run.code, run.output.slice(-3000)).toBe(0);
  });
});
