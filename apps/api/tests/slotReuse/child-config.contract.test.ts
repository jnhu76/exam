import { afterAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

/**
 * Executable capability boundary for ./vitest.child.config.ts.
 *
 * The child config deliberately has NO globalSetup (the outer run already
 * holds the cluster-scoped run lease), so it must never be able to run the
 * ordinary API suite — that would be a run-lease bypass. These regressions
 * prove the boundary is machine-enforced:
 *
 *   - direct invocation without the parent orchestrator's fixture env fails
 *     at CONFIG LOAD (before any test runs) with the fixture-only message;
 *   - with a valid stage env, discovery (`vitest list`) finds EXACTLY the
 *     one pinned stage fixture — never the other stage, never an ordinary
 *     API test file — and invented "escape hatch" variables neither satisfy
 *     the guard nor widen discovery;
 *   - a positional filter cannot smuggle an ordinary test past the pinned
 *     include (intersection is empty -> "No test files found").
 *
 * Spawn-based on purpose: the contract is about what a human/CI invoking
 * vitest with this config can do, not about internal shape. Every spawn
 * here either fails at config load or performs pure discovery (`vitest
 * list`) / an empty positional intersection — none of them EXECUTE a stage
 * fixture (that is the parent orchestrator's job; running stage A without
 * its handoff file and dedicated TEST_WORKER_ID would touch the OUTER
 * run's slot databases). None of these cases touch PostgreSQL. Each boots
 * a vitest process (~seconds); not a 5s-scale test.
 */
const __dirname = fileURLToPath(new URL(".", import.meta.url));
const API_DIR = join(__dirname, "../..");
const VITEST_BIN = join(API_DIR, "node_modules/.bin/vitest");
const CHILD_CONFIG = "tests/slotReuse/vitest.child.config.ts";
const ORDINARY_TEST = "src/adapters/repoAdapters.test.ts";

const workDir = await mkdtemp(join(tmpdir(), "child-config-contract-"));
const handoffPath = join(workDir, "handoff.json");

/** The invented escape-hatch variables the design explicitly refuses. */
const ESCAPE_ENV: Record<string, string> = {
  TEST_DISABLE_RUN_LEASE: "1",
  SKIP_RUN_LEASE: "1",
  ALLOW_NESTED_TEST_RUN: "1",
};

interface ChildResult {
  code: number;
  output: string;
}

function spawnVitest(
  args: string[],
  envOverrides: Record<string, string | undefined> = {},
): Promise<ChildResult> {
  return new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = { ...process.env };
    // Never inherit orchestrator identity or fixture env — each case states
    // exactly what a direct human invocation would carry.
    delete env.SLOT_REUSE_STAGE;
    delete env.SLOT_REUSE_HANDOFF;
    delete env.VITEST_POOL_ID;
    delete env.VITEST_WORKER_ID;
    delete env.TEST_WORKER_ID;
    for (const [key, value] of Object.entries(envOverrides)) {
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
    const child = spawn(VITEST_BIN, args, { cwd: API_DIR, env });
    let output = "";
    child.stdout.on("data", (d: Buffer) => {
      output += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      output += d.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, output }));
  });
}

/** Unique test-file paths as printed by `vitest list` (path > suite > test). */
function listedFiles(output: string): string[] {
  const paths = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.includes(".test.ts"))
    .map((line) => line.split(" > ")[0]);
  return [...new Set(paths)];
}

describe("slot-reuse child config is fixture-only (executable boundary)", () => {
  it("direct invocation without fixture env fails at config load, before any test runs", async () => {
    const bare = await spawnVitest(["run", "--config", CHILD_CONFIG]);
    expect(bare.code, bare.output.slice(-2000)).not.toBe(0);
    expect(bare.output).toContain("fixture-only config");
    expect(bare.output).toContain("SLOT_REUSE_STAGE=A|B");
    // Failed while LOADING the config: no test-file summary was ever printed.
    expect(bare.output).not.toMatch(/Test Files\s+\d+/);

    // Stage set but empty handoff is the same misuse (guard is an AND).
    const noHandoff = await spawnVitest(["run", "--config", CHILD_CONFIG], {
      SLOT_REUSE_STAGE: "A",
      SLOT_REUSE_HANDOFF: "",
    });
    expect(noHandoff.code, noHandoff.output.slice(-2000)).not.toBe(0);
    expect(noHandoff.output).toContain("fixture-only config");

    // Stages outside the A|B alphabet are equally rejected.
    const alienStage = await spawnVitest(["run", "--config", CHILD_CONFIG], {
      SLOT_REUSE_STAGE: "C",
      SLOT_REUSE_HANDOFF: handoffPath,
    });
    expect(alienStage.code, alienStage.output.slice(-2000)).not.toBe(0);
    expect(alienStage.output).toContain("fixture-only config");
  }, 120_000);

  it("invented escape-hatch variables do not satisfy the guard — there is no bypass env", async () => {
    const res = await spawnVitest(["run", "--config", CHILD_CONFIG], {
      ...ESCAPE_ENV,
      SLOT_REUSE_STAGE: undefined,
      SLOT_REUSE_HANDOFF: undefined,
    });
    expect(res.code, res.output.slice(-2000)).not.toBe(0);
    expect(res.output).toContain("fixture-only config");
  }, 90_000);

  it("stage A env discovers EXACTLY the stage A fixture — nothing else", async () => {
    const res = await spawnVitest(["list", "--config", CHILD_CONFIG], {
      SLOT_REUSE_STAGE: "A",
      SLOT_REUSE_HANDOFF: handoffPath,
    });
    expect(res.code, res.output.slice(-2000)).toBe(0);
    expect(listedFiles(res.output)).toEqual([
      "tests/slotReuse/stageA.fixture.test.ts",
    ]);

    // Escape-hatch variables present alongside valid fixture env do not
    // widen discovery either.
    const withEscape = await spawnVitest(["list", "--config", CHILD_CONFIG], {
      ...ESCAPE_ENV,
      SLOT_REUSE_STAGE: "A",
      SLOT_REUSE_HANDOFF: handoffPath,
    });
    expect(withEscape.code, withEscape.output.slice(-2000)).toBe(0);
    expect(listedFiles(withEscape.output)).toEqual([
      "tests/slotReuse/stageA.fixture.test.ts",
    ]);
  }, 120_000);

  it("stage B env discovers EXACTLY the stage B fixture — nothing else", async () => {
    const res = await spawnVitest(["list", "--config", CHILD_CONFIG], {
      SLOT_REUSE_STAGE: "B",
      SLOT_REUSE_HANDOFF: handoffPath,
    });
    expect(res.code, res.output.slice(-2000)).toBe(0);
    expect(listedFiles(res.output)).toEqual([
      "tests/slotReuse/stageB.fixture.test.ts",
    ]);
  }, 90_000);

  it("a positional filter cannot smuggle an ordinary API test past the pinned include", async () => {
    const res = await spawnVitest(
      ["run", "--config", CHILD_CONFIG, ORDINARY_TEST],
      { SLOT_REUSE_STAGE: "A", SLOT_REUSE_HANDOFF: handoffPath },
    );
    expect(res.code, res.output.slice(-2000)).not.toBe(0);
    expect(res.output).toMatch(/No test files found/i);
    expect(res.output).not.toContain("repoAdapters passed");
  }, 90_000);

  afterAll(async () => {
    await rm(workDir, { recursive: true, force: true });
  });
});
