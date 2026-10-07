import { afterAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * #733 R5 (F-06) — importing the shared seed mechanism admits no physical
 * configuration source.
 *
 * `packages/db/src/seed.ts` used to run a module-level
 * `dotenv.config({ quiet: true })`, so merely importing it — from tests, API
 * helpers, the E2E seed orchestrator, or research harnesses — silently read a
 * `.env` from the process cwd into `process.env`, independent of the caller's
 * runtime profile. In the managed E2E chain that is a SECOND admission
 * authority: the entrypoint's `loadRootEnv()` has just refused the developer
 * file, and the seed-module side effect then readmits it.
 *
 * The hostile counterexample spawns a fresh Node child (tsx loader) in a
 * temporary cwd holding a hostile `.env` and requires the file-only sentinel
 * to remain ABSENT after the import. This proves physical-source ADMISSION,
 * not value precedence: a hostile value that lost to an already-set variable
 * would satisfy a precedence check while the file was still being read
 * (SOURCE_ADMISSION_MASK != PRIORITY_OVERLAY — #730/#732).
 *
 * No database is involved: importing the modules evaluates declarations only;
 * connections happen exclusively in the `isMain` block or through a caller
 * supplied `Database`.
 */

const SENTINEL_KEY = "DOTENV_ADMISSION_SENTINEL";
const SENTINEL_VALUE = "hostile-developer-file";

// Absolute loader URL so the hostile experiment can run with cwd = the temp
// fixture directory (a bare `tsx` specifier would resolve against that cwd).
const tsxLoaderUrl = String(import.meta.resolve("tsx"));

const seedModuleUrl = new URL("./seed.ts", import.meta.url).href;
const orchestratorModuleUrl = new URL(
  "./e2eSeedOrchestrator.ts",
  import.meta.url,
).href;

/**
 * Child probe: asserts the sentinel is absent BEFORE the import (the parent
 * env must not leak it), then imports the target module and reports the
 * sentinel state afterwards as the last stdout line (JSON).
 */
const PROBE_SCRIPT = `
const [targetUrl, sentinelKey] = process.argv.slice(2);
if (process.env[sentinelKey] !== undefined) {
  process.stdout.write(JSON.stringify({ ok: true, pre: process.env[sentinelKey], post: process.env[sentinelKey] }));
  process.exit(0);
}
try {
  await import(targetUrl);
} catch (err) {
  process.stdout.write(JSON.stringify({ ok: false, importError: String(err) }));
  process.exit(1);
}
process.stdout.write(JSON.stringify({ ok: true, pre: null, post: process.env[sentinelKey] ?? null }));
`;

interface ProbeReport {
  ok: boolean;
  pre: string | null;
  post: string | null;
  importError?: string;
}

interface ProbeRun {
  code: number;
  report: ProbeReport;
  stderr: string;
}

const createdDirs: string[] = [];
afterAll(async () => {
  for (const dir of createdDirs) {
    await rm(dir, { recursive: true, force: true });
  }
});

/** Temporary cwd with a hostile developer `.env` (never a repository path). */
async function makeHostileFixture(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "exam-seed-dotenv-admission-"));
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
  return dir;
}

/**
 * Bare development profile: no APP_MODE, no NODE_ENV — the profile where the
 * developer `.env` is legitimate authority, admitted by the ENTRYPOINT. The
 * allowlist also guarantees the sentinel cannot leak in from the vitest
 * worker environment.
 */
function bareDevelopmentEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "HOME", "LANG", "TZ", "TERM"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
}

function runProbe(
  probePath: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd: string,
): Promise<ProbeRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", tsxLoaderUrl, probePath, ...args],
      { cwd, env, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("exit", (code) => {
      // A child that dies before reporting must fail the test with its raw
      // output, not leave the promise unsettled on an uncaught parse error.
      let report: ProbeReport;
      try {
        report = JSON.parse(stdout);
      } catch {
        report = {
          ok: false,
          pre: null,
          post: null,
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

describe("shared seed module admits no dotenv source on import", () => {
  it("importing seed.ts leaves a hostile cwd .env unadmitted", async () => {
    const dir = await makeHostileFixture();
    const probePath = join(dir, "probe.mjs");
    await writeFile(probePath, PROBE_SCRIPT);

    const run = await runProbe(
      probePath,
      [seedModuleUrl, SENTINEL_KEY],
      bareDevelopmentEnv(),
      dir,
    );

    expect(run.report.ok, run.report.importError ?? run.stderr).toBe(true);
    expect(run.report.pre).toBeNull();
    // The hostile file must not enter the process through the import — not
    // even in the bare-development profile, where admission belongs to the
    // entrypoint's loadRootEnv and not to the shared mechanism.
    expect(run.report.post).toBeNull();
  }, 30_000);

  it("importing e2eSeedOrchestrator transitively admits no developer .env", async () => {
    const dir = await makeHostileFixture();
    const probePath = join(dir, "probe.mjs");
    await writeFile(probePath, PROBE_SCRIPT);

    const run = await runProbe(
      probePath,
      [orchestratorModuleUrl, SENTINEL_KEY],
      bareDevelopmentEnv(),
      dir,
    );

    expect(run.report.ok, run.report.importError ?? run.stderr).toBe(true);
    expect(run.report.pre).toBeNull();
    // The managed E2E entry imports runE2eSeed from this module; the
    // transitive seed.ts evaluation must not become a second admission path.
    expect(run.report.post).toBeNull();
  }, 30_000);
});
