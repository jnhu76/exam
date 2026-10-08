import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { admitEnvFile } from "./loadRootEnv.js";

/**
 * Physical file admission through REAL files and the REAL dotenv parser (no
 * dotenv mock — the mocked boundary lives in `loadRootEnv.test.ts`).
 *
 * `loadRootEnv.test.ts` proves the admission DECISION (the repository-root
 * `.env` is handed to dotenv only for the bare-development profile). This
 * file proves the physical half a mocked dotenv cannot, split by the
 * #741 mechanism/authority seam so no permanent test ever writes a
 * repository env-file authority:
 *
 *   - MECHANISM: `admitEnvFile(<temp .env>)` proves an admitted file's
 *     values physically land in `process.env` (and `loadRootEnv` itself is
 *     a no-op without its root file).
 *   - AUTHORITY cwd-independence: a child process evaluates the REAL
 *     `loadRootEnv` module with a hostile `.env` in its cwd (temp dir)
 *     under both profiles; the cwd file's sentinel must never appear — the
 *     authority reads only its module-relative root source, never the cwd
 *     (#733 F-06 regression class). This is machine-independent: a real
 *     developer `repo/.env` may exist and be admitted in the bare-dev leg,
 *     but the cwd sentinel must still be absent.
 *
 * The managed-profile admission BLOCK at process level is owned by
 * `managedSeedAdmission.process.test.ts` (full seed chain, hostile temp
 * file). Fixture safety: every fixture here lives under mkdtemp — a hard
 * kill can never leave a repository runtime authority behind (#741 W3).
 */

const PROBE_KEY = "DOTENV_ADMISSION_PROBE";
const PROBE_VALUE = "dev-file-admitted";
const FIXTURE_CONTENT = `${PROBE_KEY}=${PROBE_VALUE}\n`;
const CWD_SENTINEL_VALUE = "hostile-cwd-file";

const tsxLoaderUrl = String(import.meta.resolve("tsx"));
const loadRootEnvModuleUrl = new URL("./loadRootEnv.ts", import.meta.url).href;

/**
 * Child probe: runs the REAL loadRootEnv in a process whose cwd holds a
 * hostile `.env`, then reports the sentinel as JSON on stdout. `pre` proves
 * the parent env did not leak the sentinel; `post` is the admission oracle.
 */
const PROBE_SCRIPT = `
const { loadRootEnv } = await import(process.argv[2]);
loadRootEnv();
process.stdout.write(
  JSON.stringify({ post: process.env[${JSON.stringify(PROBE_KEY)}] ?? null }),
);
`;

interface ProbeReport {
  post: string | null;
  stderr?: string;
}

const createdDirs: string[] = [];
afterAll(async () => {
  for (const dir of createdDirs) {
    await rm(dir, { recursive: true, force: true });
  }
});

/** Temp cwd holding a hostile `.env` (never a repository path). */
async function makeHostileCwdFixture(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "exam-root-env-admission-"));
  createdDirs.push(dir);
  await writeFile(join(dir, ".env"), `${PROBE_KEY}=${CWD_SENTINEL_VALUE}\n`);
  await writeFile(join(dir, "probe.mjs"), PROBE_SCRIPT);
  return dir;
}

function runProbe(
  dir: string,
  env: NodeJS.ProcessEnv,
): Promise<{ code: number; report: ProbeReport; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", tsxLoaderUrl, join(dir, "probe.mjs"), loadRootEnvModuleUrl],
      { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("exit", (code) => {
      try {
        resolve({
          code: code ?? -1,
          report: JSON.parse(stdout) as ProbeReport,
          stderr,
        });
      } catch {
        resolve({
          code: code ?? -1,
          stderr,
          report: {
            post: null,
            stderr: `child produced no JSON report — stdout=${JSON.stringify(
              stdout.slice(0, 2000),
            )} stderr=${JSON.stringify(stderr.slice(0, 2000))}`,
          },
        });
      }
    });
  });
}

/** Bare-development-looking child env: profile keys deliberately absent. */
function bareDevelopmentEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "HOME", "LANG", "TZ", "TERM"]) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
}

describe("loadRootEnv physical file admission", () => {
  let savedEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    savedEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = savedEnv;
  });

  it("MECHANISM: an admitted real .env file lands its values in process.env", async () => {
    const dir = await mkdtemp(join(tmpdir(), "exam-root-env-mechanism-"));
    createdDirs.push(dir);
    const fixturePath = join(dir, ".env");
    await writeFile(fixturePath, FIXTURE_CONTENT);
    delete process.env[PROBE_KEY];

    try {
      admitEnvFile(fixturePath);
      expect(process.env[PROBE_KEY]).toBe(PROBE_VALUE);
    } finally {
      delete process.env[PROBE_KEY];
    }
  });

  it("AUTHORITY bare development: a hostile .env in the process cwd is not admitted", async () => {
    const dir = await makeHostileCwdFixture();
    const run = await runProbe(dir, bareDevelopmentEnv());

    expect(run.code, run.report.stderr ?? "").toBe(0);
    // The authority's only source is its module-relative repository-root
    // .env — a cwd .env never reaches process.env, development or not.
    expect(run.report.post).toBeNull();
  }, 30_000);

  it("AUTHORITY managed profile: a hostile .env in the process cwd stays unadmitted", async () => {
    const dir = await makeHostileCwdFixture();
    const run = await runProbe(dir, {
      ...bareDevelopmentEnv(),
      APP_MODE: "e2e",
    });

    expect(run.code, run.report.stderr ?? "").toBe(0);
    expect(run.report.post).toBeNull();
  }, 30_000);
});
