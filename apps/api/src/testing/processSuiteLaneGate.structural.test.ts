import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Process-suite lane gate structural guard (test-lane contract).
//
// The real-child-process suites spawn the production server entry as OS
// children whose PostgreSQL connections resolve from TEST_DATABASE_URL alone.
// Such connections cannot inherit the parent process's per-file schema binding
// (search_path is connection-local), so process-restart / durability evidence
// requires worker-database isolation, where the physical per-worker database
// carries the isolation (docs/standards/testing.md §5.2, testing.md §2.8).
//
// The lane contract is:
//   file-schema lane (local serial default) → the suites SKIP before any setup
//   worker-database lane (pnpm verify / CI api-coverage)   → the suites RUN
//
// This guard pins that wiring against both regression directions:
//   - un-gating a process suite re-exposes the deterministic file-schema 42P01
//     failures (empty public schema: the suite never binds nor migrates it);
//   - hard-skipping a suite, or excluding it in vitest config, silently deletes
//     mandatory process-boundary evidence.
//
// Scan rule: EVERY test file that spawns through restartProcessHarness must
// gate itself on the single sanctioned capability predicate
// (`isWorkerDatabaseMode` from routes/testDatabase.ts) via
// `isWorkerDatabaseMode() ? describe : describe.skip` — collection-time
// evaluation, so the skip is decided before any schema creation or server
// spawn.

const API_SRC_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const GATE = "isWorkerDatabaseMode() ? describe : describe.skip";
const GATED_DESCRIBE = "workerDbDescribe(";
/** An actual import of the spawn harness — comments mentioning it don't count. */
const HARNESS_IMPORT = /from\s+"[^"]*restartProcessHarness\.js"/;

function listTestFiles(dir: string): string[] {
  const out: string[] = [];
  const stack = [dir];
  for (
    let current = stack.pop();
    current !== undefined;
    current = stack.pop()
  ) {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && entry.name.endsWith(".test.ts")) {
        out.push(full);
      }
    }
  }
  return out.sort();
}

describe("process-suite lane gate (worker-database only)", () => {
  const testFiles = listTestFiles(API_SRC_DIR);

  it("spawns real process suites only through restartProcessHarness, all lane-gated", () => {
    const spawnSuites = testFiles.filter((file) =>
      HARNESS_IMPORT.test(readFileSync(file, "utf8")),
    );
    // The two suites that own the process-restart / durability evidence.
    expect(spawnSuites.length).toBe(2);
    for (const file of spawnSuites) {
      const source = readFileSync(file, "utf8");
      expect(
        source.includes(GATE),
        `${file} must gate itself with \`${GATE}\` — real child-process suites require worker-database isolation (docs/standards/testing.md §5.2)`,
      ).toBe(true);
      expect(
        source.includes(GATED_DESCRIBE),
        `${file} must run its top-level describe through the gated alias (${GATED_DESCRIBE})`,
      ).toBe(true);
      expect(
        /import\s*\{[^}]*isWorkerDatabaseMode[^}]*\}\s*from\s*"[^"]*testDatabase\.js"/.test(
          source,
        ),
        `${file} must read the lane capability from the single adapter predicate (routes/testDatabase.ts)`,
      ).toBe(true);
    }
  });

  it("vitest config does not exclude the process suites (no hidden lane exclusion)", () => {
    const config = readFileSync(
      resolve(API_SRC_DIR, "../vitest.config.ts"),
      "utf8",
    );
    expect(config).not.toContain("process.test");
    expect(config).not.toContain("restartProcessDeadline");
    expect(config).not.toContain("admissions.durability");
  });

  it("canonical verification lanes keep worker-database isolation (no silent CI skip)", () => {
    const repoRoot = resolve(API_SRC_DIR, "../../..");
    const rootPackageJson = JSON.parse(
      readFileSync(join(repoRoot, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    // The suites run ONLY when TEST_DB_ISOLATION=worker-database; if these
    // env pins drift away, the suites skip EVERYWHERE and the process-boundary
    // evidence silently disappears (skips do not fail coverage thresholds).
    expect(rootPackageJson.scripts.verify).toContain(
      "TEST_DB_ISOLATION=worker-database",
    );
    const ciWorkflow = readFileSync(
      join(repoRoot, ".github/workflows/ci.yml"),
      "utf8",
    );
    expect(ciWorkflow).toContain("TEST_DB_ISOLATION=worker-database");
  });
});
