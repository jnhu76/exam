import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * #733 R6 (F-07) — shell test-schema tooling must observe the canonical
 * TEST_DATABASE_TARGET, not resolve it locally.
 *
 * Before the repair every audited script fell back to
 * `${DATABASE_URL:-postgresql://exam:exam@localhost:${DB_HOST_PORT:-5432}/exam_test}`:
 * a second TEST_DATABASE_TARGET authority that let DATABASE_URL (masked for
 * test targets since #730 EXP-01) control the target and re-implemented the
 * constructed fallback of `resolveTestBranchUrl`.
 *
 * The proofs below run the REAL scripts end to end with a fixture psql
 * transport that only OBSERVES which connection URL each invocation carried
 * and which SQL path ran; every expected target comes from the hostile env
 * fixture, never from the fixture recomputing precedence (no false oracle).
 * The canonical projection itself (`pnpm --filter @exam/db exec tsx
 * src/testDatabaseUrlCli.ts`) runs for real inside the scripts.
 *
 * Sentinel URLs point at non-listening localhost ports: nothing here connects
 * to a real database, and the destructive proof uses the same fixture
 * transport (records the DO-block invocation instead of executing it).
 */

const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

// Absolute real-pnpm path, resolved once so the fake pnpm can pass the
// canonical projection through to the real mechanism without recursing into
// itself (the fake dir is prepended to PATH).
const REAL_PNPM = (() => {
  const probe = spawnSync("bash", ["-c", "command -v pnpm"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const path = probe.stdout?.trim();
  if (probe.status !== 0 || !path) {
    throw new Error(
      "real pnpm binary not found on PATH — cannot build the fake pnpm pass-through",
    );
  }
  return path;
})();

const DECOY_A = "postgresql://decoy:a@localhost:9991/decoy_a";
const TARGET_B = "postgresql://exam:exam@localhost:9992/exam_test";
const LEGACY_D = "postgresql://exam:exam@localhost:9993/exam_test";
const CONSTRUCTED_55432 = "postgresql://exam:exam@localhost:55432/exam_test";

interface Fixture {
  binDir: string;
  psqlLog: string;
  sqlLog: string;
  destructiveLog: string;
  env: NodeJS.ProcessEnv;
}

const createdDirs: string[] = [];
afterAll(async () => {
  for (const dir of createdDirs) {
    await rm(dir, { recursive: true, force: true });
  }
});

/**
 * Fixture transport standing in for `psql`. It records every invocation
 * (argv to `psqlLog`, heredoc SQL to `sqlLog`) and answers from the
 * fixture-provided values only:
 *   - `SELECT current_database();`  → FAKE_CURRENT_DB (controlled identity)
 *   - any count(*) path             → FAKE_SCHEMA_COUNT
 *   - the destructive DO block      → one line in destructiveLog, no effect
 */
const FAKE_PSQL = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$FAKE_PSQL_LOG"
for arg in "$@"; do
  case "$arg" in
    *current_database*)
      printf '%s\\n' "$FAKE_CURRENT_DB"
      exit 0
      ;;
  esac
done
sql="$(cat)"
printf '%s\\n' "$sql" >> "$FAKE_SQL_LOG"
case "$sql" in
  *"count"*)
    printf '%s\\n' "$FAKE_SCHEMA_COUNT"
    ;;
  *"DROP SCHEMA"*)
    printf '%s\\n' "$sql" >> "$FAKE_DESTRUCTIVE_LOG"
    ;;
esac
`;

/**
 * Fixture transport standing in for `pnpm` (stress-script proof only): stubs
 * the workspace test stages as no-op successes but passes the canonical
 * projection through to the real pnpm, so the consumer under test still
 * reaches the real resolver.
 */
const FAKE_PNPM = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$FAKE_PNPM_LOG"
case "$*" in
  *testDatabaseUrlCli*) exec "$REAL_PNPM" "$@" ;;
esac
exit 0
`;

async function makeFixture(hostile: Record<string, string>): Promise<Fixture> {
  const binDir = await mkdtemp(join(tmpdir(), "exam-r6-shell-target-"));
  createdDirs.push(binDir);
  const psqlLog = join(binDir, "psql.invocations.log");
  const sqlLog = join(binDir, "psql.sql.log");
  const destructiveLog = join(binDir, "psql.destructive.log");

  const psql = join(binDir, "psql");
  await writeFile(psql, FAKE_PSQL);
  await chmod(psql, 0o755);

  // Allowlist env: hostile inputs enter ONLY via the fixture, so the vitest
  // worker's own TEST_DATABASE_URL / DB_HOST_PORT / APP_MODE cannot leak in
  // and cannot mask the counterexample.
  const env: NodeJS.ProcessEnv = { ...hostile };
  for (const key of ["PATH", "HOME", "LANG", "TERM", "TZ", "TMPDIR"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  env.PATH = `${binDir}:${process.env.PATH ?? ""}`;
  env.FAKE_PSQL_LOG = psqlLog;
  env.FAKE_SQL_LOG = sqlLog;
  env.FAKE_DESTRUCTIVE_LOG = destructiveLog;

  return { binDir, psqlLog, sqlLog, destructiveLog, env };
}

/** First whitespace token of each recorded invocation = the connection URL. */
function invokedUrls(fixture: Fixture): string[] {
  let raw = "";
  try {
    raw = readFileSync(fixture.psqlLog, "utf8");
  } catch {
    return [];
  }
  return raw
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => line.split(" ")[0] ?? "");
}

interface ScriptRun {
  status: number;
  stdout: string;
  stderr: string;
}

function runScript(
  script: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeout = 90_000,
): ScriptRun {
  const run = spawnSync("bash", [join(REPO_ROOT, script), ...args], {
    cwd: REPO_ROOT,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout,
  });
  return {
    status: run.status ?? -1,
    stdout: run.stdout ?? "",
    stderr: run.stderr ?? "",
  };
}

describe("list-test-schemas.sh observes the canonical TEST_DATABASE_TARGET", () => {
  it("hostile matrix: DATABASE_URL decoy loses to TEST_DATABASE_URL (consumer proof)", async () => {
    const fixture = await makeFixture({
      DATABASE_URL: DECOY_A,
      TEST_DATABASE_URL: TARGET_B,
      FAKE_CURRENT_DB: "exam_test",
    });
    const run = runScript("scripts/db/list-test-schemas.sh", [], fixture.env);
    expect(run.status, run.stderr).toBe(0);
    const urls = invokedUrls(fixture);
    expect(urls.length).toBeGreaterThan(0);
    expect(urls).toContain(TARGET_B);
    expect(urls.every((url) => url === TARGET_B)).toBe(true);
    expect(run.stdout).not.toContain("decoy_a");
  });

  it("hostile matrix: legacy TEST_DB_URL alias is honored over DATABASE_URL", async () => {
    const fixture = await makeFixture({
      DATABASE_URL: DECOY_A,
      TEST_DB_URL: LEGACY_D,
      FAKE_CURRENT_DB: "exam_test",
    });
    const run = runScript("scripts/db/list-test-schemas.sh", [], fixture.env);
    expect(run.status, run.stderr).toBe(0);
    expect(invokedUrls(fixture)).toContain(LEGACY_D);
  });

  it("hostile matrix: implicit local target comes from DB_HOST_PORT via the resolver, DATABASE_URL ignored", async () => {
    const fixture = await makeFixture({
      DATABASE_URL: DECOY_A,
      DB_HOST_PORT: "55432",
      FAKE_CURRENT_DB: "exam_test",
    });
    const run = runScript("scripts/db/list-test-schemas.sh", [], fixture.env);
    expect(run.status, run.stderr).toBe(0);
    const urls = invokedUrls(fixture);
    expect(urls).toContain(CONSTRUCTED_55432);
    expect(urls.every((url) => url === CONSTRUCTED_55432)).toBe(true);
  });

  it("set-but-empty TEST_DATABASE_URL counts as unset (no shell divergence from canonical empty semantics)", async () => {
    const fixture = await makeFixture({
      DATABASE_URL: DECOY_A,
      TEST_DATABASE_URL: "",
      TEST_DB_URL: LEGACY_D,
      FAKE_CURRENT_DB: "exam_test",
    });
    const run = runScript("scripts/db/list-test-schemas.sh", [], fixture.env);
    expect(run.status, run.stderr).toBe(0);
    expect(invokedUrls(fixture)).toContain(LEGACY_D);
    expect(invokedUrls(fixture).every((url) => url === LEGACY_D)).toBe(true);
  });

  it("unsafe test database name: the seam's refusal fails the script closed before any psql call", async () => {
    const fixture = await makeFixture({
      DATABASE_URL: DECOY_A,
      TEST_DATABASE_URL: "postgresql://exam:exam@localhost:5432/exam",
    });
    const run = runScript("scripts/db/list-test-schemas.sh", [], fixture.env);
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('does not contain "test"');
    expect(invokedUrls(fixture)).toEqual([]);
  });

  it("ALLOW_UNSAFE_TEST_DATABASE_URL=1 passes the seam canonically (the shell cannot bypass nor veto it)", async () => {
    const unsafe = "postgresql://exam:exam@localhost:5432/exam";
    const fixture = await makeFixture({
      DATABASE_URL: DECOY_A,
      TEST_DATABASE_URL: unsafe,
      ALLOW_UNSAFE_TEST_DATABASE_URL: "1",
      FAKE_CURRENT_DB: "exam_test",
    });
    const run = runScript("scripts/db/list-test-schemas.sh", [], fixture.env);
    expect(run.status, run.stderr).toBe(0);
    const urls = invokedUrls(fixture);
    expect(urls).toContain(unsafe);
    expect(urls.every((url) => url === unsafe)).toBe(true);
  });
});

describe("drop-test-schemas.sh keeps both safety layers on the canonical target", () => {
  it("destructive path runs only after the identity guard, against the canonical target", async () => {
    const fixture = await makeFixture({
      DATABASE_URL: DECOY_A,
      TEST_DATABASE_URL: TARGET_B,
      FAKE_CURRENT_DB: "exam_test",
      FAKE_SCHEMA_COUNT: "1",
    });
    const run = runScript("scripts/db/drop-test-schemas.sh", [], fixture.env);
    expect(run.status, run.stderr).toBe(0);
    const urls = invokedUrls(fixture);
    expect(urls).toContain(TARGET_B);
    expect(urls.every((url) => url === TARGET_B)).toBe(true);
    // The destructive DO block was dispatched against the canonical target…
    const destructive = readFileSync(fixture.destructiveLog, "utf8");
    expect(destructive).toContain("DROP SCHEMA IF EXISTS");
    // …while the decoy never appeared anywhere.
    expect(readFileSync(fixture.psqlLog, "utf8")).not.toContain("decoy_a");
  });

  it("connected-DB identity guard still refuses when the actual database is not an approved test identity", async () => {
    const fixture = await makeFixture({
      DATABASE_URL: DECOY_A,
      TEST_DATABASE_URL: TARGET_B,
      // Requested target resolves to exam_test, but the observed connection
      // identity is the dev database — the destructive layer must veto.
      FAKE_CURRENT_DB: "exam",
    });
    const run = runScript("scripts/db/drop-test-schemas.sh", [], fixture.env);
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("refusing to drop schemas");
    expect(
      readFileSync(fixture.psqlLog, "utf8")
        .split("\n")
        .filter((l) => l.length > 0),
    ).toHaveLength(1);
    let destructive = "";
    try {
      destructive = readFileSync(fixture.destructiveLog, "utf8");
    } catch {
      destructive = "";
    }
    expect(destructive).toBe("");
  });
});

describe("db-isolation-stress.sh direct leak-count path", () => {
  it("targets the canonical TEST_DATABASE_TARGET, never the DATABASE_URL decoy", async () => {
    const fixture = await makeFixture({
      DATABASE_URL: DECOY_A,
      TEST_DATABASE_URL: TARGET_B,
      FAKE_CURRENT_DB: "exam_test",
      FAKE_SCHEMA_COUNT: "0",
      KEEP_TEST_SCHEMAS: "1",
    });
    const pnpmLog = join(fixture.binDir, "pnpm.invocations.log");
    fixture.env.FAKE_PNPM_LOG = pnpmLog;
    fixture.env.REAL_PNPM = REAL_PNPM;
    const pnpm = join(fixture.binDir, "pnpm");
    await writeFile(pnpm, FAKE_PNPM);
    await chmod(pnpm, 0o755);

    const run = runScript(
      "scripts/test/db-isolation-stress.sh",
      ["1", "--fast"],
      fixture.env,
      180_000,
    );
    expect(run.status, run.stderr.slice(0, 2000)).toBe(0);

    // The canonical projection ran for real through the pass-through…
    expect(readFileSync(pnpmLog, "utf8")).toContain("testDatabaseUrlCli");
    // …the leak-count query observed the canonical target…
    const leakLine = readFileSync(fixture.psqlLog, "utf8")
      .split("\n")
      .find((line) => line.includes("count"));
    expect(leakLine).toBeDefined();
    expect(leakLine?.startsWith(TARGET_B)).toBe(true);
    // …and no invocation anywhere carried the decoy.
    expect(readFileSync(fixture.psqlLog, "utf8")).not.toContain("decoy_a");
  });
});
