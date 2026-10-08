import { afterAll, describe, expect, it } from "vitest";
import { spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** apps/web — resolved via import.meta.url directly (relative `new URL`
 * resolution returns dev-server http URLs under the jsdom test environment). */
const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const VITE_BIN = join(WEB_DIR, "node_modules", ".bin", "vite");
const VITE_CONFIG = join(WEB_DIR, "vite.config.ts");

/**
 * #741 H2 — package-local env files cannot become client/build
 * configuration, proven with the REAL apps/web vite config against an
 * isolated throwaway workspace.
 *
 * The fixture root plants `.env` and `.env.production` with VITE_* probe
 * sentinels — exactly the files the pre-#741 default envDir (= vite root)
 * would inline into the client bundle. The production build must:
 *
 *   - exit 0 (the supported config path still builds), and
 *   - contain NONE of the package-local sentinels in the emitted assets,
 *     while the entry's own fallback string proves the probe module was
 *     actually bundled.
 *
 * Killability: against the pre-#741 config (no `envDir: false`), the
 * production-mode `.env.production` sentinel IS inlined into dist — this
 * test fails there. The structural pin (envDir: false present in
 * vite.config.ts) is additionally enforced by scripts/check-env-surface.mjs.
 *
 * The fixture lives under mkdtemp: this test never creates a repository
 * env-file candidate (#741 W3).
 */

const SENTINEL = "vite-probe-from-package-local-env";
const ENTRY_FALLBACK = "vite-probe-unset-fallback";

const createdDirs: string[] = [];
afterAll(async () => {
  for (const dir of createdDirs) {
    await rm(dir, { recursive: true, force: true });
  }
});

function runViteBuild(root: string): Promise<{ code: number; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(VITE_BIN, ["build", "--config", VITE_CONFIG, root], {
      cwd: WEB_DIR,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (d: Buffer) => (output += d.toString()));
    child.stderr.on("data", (d: Buffer) => (output += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, output }));
  });
}

async function readEmittedAssets(root: string): Promise<string> {
  const dist = join(root, "dist");
  const parts: string[] = [];
  const walk = async (dir: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (/\.(js|html|css)$/.test(entry.name)) {
        parts.push(await readFile(full, "utf8"));
      }
    }
  };
  await walk(dist);
  return parts.join("\n");
}

describe("vite build admits no package-local env file (#741 H2)", () => {
  it("a production build over hostile package-local .env files ships no sentinel", async () => {
    const root = await mkdtemp(join(tmpdir(), "exam-vite-env-admission-"));
    createdDirs.push(root);
    await mkdir(join(root, "src"), { recursive: true });
    await writeFile(join(root, ".env"), `VITE_PROBE=${SENTINEL}-base\n`);
    await writeFile(
      join(root, ".env.production"),
      `VITE_PROBE=${SENTINEL}-production\nVITE_SECRET_LEAK_TEST=${SENTINEL}-secret\n`,
    );
    await writeFile(
      join(root, "index.html"),
      '<!doctype html><html><body><script type="module" src="/src/main.ts"></script></body></html>\n',
    );
    await writeFile(
      join(root, "src", "main.ts"),
      `const v = import.meta.env.VITE_PROBE ?? ${JSON.stringify(ENTRY_FALLBACK)};\nconsole.log(v);\n`,
    );

    const build = await runViteBuild(root);
    expect(build.code, build.output.slice(-3000)).toBe(0);

    const emitted = await readEmittedAssets(root);
    // Positive control first: the probe entry was actually bundled, so an
    // absent sentinel means "not admitted", not "not built".
    expect(emitted).toContain(ENTRY_FALLBACK);
    expect(emitted).not.toContain(SENTINEL);
  }, 180_000);
});
