import { afterAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * #733 R5 (F-06) — managed E2E hostile-counterexample: a developer `.env`
 * cannot enter the seed workflow, and the runner remains the configuration
 * authority.
 *
 * Composition under `APP_MODE=e2e` (the exact chain `apps/api/src/e2e-seed.ts`
 * runs, minus the database connection, which importing modules never opens):
 *
 *   loadRootEnv()            ← the real managed admission boundary (block)
 *   import e2eSeedOrchestrator
 *                            ← transitively evaluates seed.ts, which used to
 *                              run its own unconditional dotenv.config() and
 *                              readmit the file from cwd — the F-06 defect
 *   loadRuntimeConfig()      ← runner-owned resolution must stay intact
 *
 * The oracle is a FILE-ONLY sentinel (present in the hostile `.env`, nowhere
 * in the process env): its absence proves the physical source was never
 * ADMITTED. `TEST_DATABASE_URL` winning over the file's `DATABASE_URL` would
 * not prove that — that is precedence, not admission (#730/#732:
 * SOURCE_ADMISSION_MASK != PRIORITY_OVERLAY).
 */

const SENTINEL_KEY = "DOTENV_ADMISSION_SENTINEL";
const SENTINEL_VALUE = "hostile-developer-file";

const RUNNER_TEST_DATABASE_URL =
  "postgresql://exam:exam@127.0.0.1:9/exam_e2e_managed_b";

const tsxLoaderUrl = String(import.meta.resolve("tsx"));

const loadRootEnvModuleUrl = new URL("./loadRootEnv.ts", import.meta.url).href;
const runtimeConfigModuleUrl = new URL("./runtimeConfig.ts", import.meta.url)
  .href;
const orchestratorModuleUrl = new URL(
  "../../../../packages/db/src/e2eSeedOrchestrator.ts",
  import.meta.url,
).href;

/**
 * Child probe mirroring the admission-relevant prefix of
 * `apps/api/src/e2e-seed.ts`: loadRootEnv() → managed seed chain import →
 * runner-owned config resolution. Reports the post-chain environment facts as
 * the last stdout line (JSON). No database connection is attempted.
 */
const MANAGED_PROBE_SCRIPT = `
const [loadRootEnvUrl, orchestratorUrl, runtimeConfigUrl, sentinelKey] = process.argv.slice(2);
try {
  const { loadRootEnv } = await import(loadRootEnvUrl);
  loadRootEnv();
  await import(orchestratorUrl);
  const { loadRuntimeConfig } = await import(runtimeConfigUrl);
  const cfg = loadRuntimeConfig();
  process.stdout.write(JSON.stringify({
    ok: true,
    sentinel: process.env[sentinelKey] ?? null,
    seedAdminUsername: process.env.SEED_ADMIN_USERNAME ?? null,
    resolvedDatabaseUrl: cfg.database.url,
    mode: cfg.app.mode,
  }));
} catch (err) {
  process.stdout.write(JSON.stringify({ ok: false, importError: String(err) }));
  process.exit(1);
}
`;

interface ManagedProbeReport {
  ok: boolean;
  sentinel: string | null;
  seedAdminUsername: string | null;
  resolvedDatabaseUrl: string;
  mode: string;
  importError?: string;
}

const createdDirs: string[] = [];
afterAll(async () => {
  for (const dir of createdDirs) {
    await rm(dir, { recursive: true, force: true });
  }
});

function runManagedProbe(dir: string): Promise<{
  code: number;
  report: ManagedProbeReport;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
    // Runner-owned managed env (the allowlist IS the profile: nothing else
    // — in particular no pre-existing sentinel — may leak in from vitest).
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      APP_MODE: "e2e",
      TEST_DATABASE_URL: RUNNER_TEST_DATABASE_URL,
    };
    const child = spawn(
      process.execPath,
      [
        "--import",
        tsxLoaderUrl,
        join(dir, "managed-probe.mjs"),
        loadRootEnvModuleUrl,
        orchestratorModuleUrl,
        runtimeConfigModuleUrl,
        SENTINEL_KEY,
      ],
      { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("exit", (code) => {
      // A child that dies before reporting must fail the test with its raw
      // output, not leave the promise unsettled on an uncaught parse error.
      let report: ManagedProbeReport;
      try {
        report = JSON.parse(stdout);
      } catch {
        report = {
          ok: false,
          sentinel: null,
          seedAdminUsername: null,
          resolvedDatabaseUrl: "",
          mode: "",
          importError:
            `child produced no JSON report (exit=${code}) — ` +
            `stdout=${JSON.stringify(stdout.slice(0, 2000))} ` +
            `stderr=${JSON.stringify(stderr.slice(0, 2000))}`,
        };
      }
      resolve({ code: code ?? -1, report, stderr });
    });
  });
}

describe("managed e2e seed path admits no developer .env", () => {
  it("APP_MODE=e2e: file-only hostile values stay absent, runner config stays authoritative", async () => {
    const dir = await mkdtemp(join(tmpdir(), "exam-managed-seed-admission-"));
    createdDirs.push(dir);
    await writeFile(
      join(dir, ".env"),
      [
        `${SENTINEL_KEY}=${SENTINEL_VALUE}`,
        "DATABASE_URL=postgresql://attacker:attacker@127.0.0.1:9/hostile_db",
        "SEED_ADMIN_USERNAME=hostile-admin",
        "",
      ].join("\n"),
    );
    await writeFile(join(dir, "managed-probe.mjs"), MANAGED_PROBE_SCRIPT);

    const run = await runManagedProbe(dir);

    expect(run.report.ok, run.report.importError ?? run.stderr).toBe(true);
    // File-only sentinel: the physical-source admission oracle.
    expect(run.report.sentinel).toBeNull();
    // File-only SEED_* override must not reach the seed workflow either.
    expect(run.report.seedAdminUsername).toBeNull();
    // parseAppMode semantics untouched through the whole chain.
    expect(run.report.mode).toBe("e2e");
    // Runner-owned database authority survives intact (value precedence is
    // necessary but NOT sufficient — the sentinel above is the admission
    // proof).
    expect(run.report.resolvedDatabaseUrl).toBe(RUNNER_TEST_DATABASE_URL);
  }, 30_000);
});
