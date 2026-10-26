#!/usr/bin/env node
/**
 * Repository code-quality gate: bans `console.log` / `console.error` calls in
 * application and package sources. Runs as the root `lint` script and as each
 * workspace package's `lint` script
 * (`node ../../scripts/check-code-quality.mjs`).
 *
 * INVARIANT (root resolution): the scan roots are resolved from THIS FILE's
 * location, never from the caller's CWD. A package CWD (e.g. apps/api) runs
 * the exact same repository-wide scan: it cannot shrink the scope to one
 * package, and it cannot ENOENT on a package-relative "apps/" path.
 *
 * INVARIANT (generated output): Playwright writes report/test output into
 * gitignored directories under apps/e2e/. Those are build artifacts, not
 * source — their bundled JavaScript calls console.* by design, so scanning
 * them made `pnpm lint` fail after any local E2E run (false red). Only the
 * exact output directories declared by the E2E configs are pruned; ordinary
 * spec sources and fixtures stay in scope.
 *
 * The scan helpers are exported for the regression suite
 * (apps/web/src/codeQualityGate.test.ts) so this stays the one and only scan
 * implementation.
 */
import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Authoritative scan roots of THIS repository. Deliberately not configurable:
 * a caller must not be able to narrow the gate's scope.
 */
export const SCAN_ROOTS = ["apps", "packages"];

/**
 * Playwright-generated output directories, repo-relative. Every entry is
 * confirmed by an E2E config, not guessed:
 *   - playwright-report     HTML reporter output (apps/e2e/playwright.config.ts)
 *   - test-results          `outputDir` (apps/e2e/playwright.config.ts)
 *   - test-results-patrol   `outputDir` (apps/e2e/playwright.patrol.config.ts)
 *   - blob-report           sharded blob reporter output
 *                           (apps/e2e/playwright.config.ts)
 * All four are gitignored (apps/e2e/.gitignore) build output, never source.
 */
export const GENERATED_E2E_OUTPUT_DIRS = [
  "apps/e2e/playwright-report",
  "apps/e2e/test-results",
  "apps/e2e/test-results-patrol",
  "apps/e2e/blob-report",
];

const PRUNED_DIR_NAMES = new Set(["dist", "coverage", "node_modules"]);
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs"]);
const CONSOLE_CALL_RE = /\bconsole\.(log|error)\s*\(/;

/** True when `line` contains a banned console output call. */
export function isConsoleOutput(line) {
  return CONSOLE_CALL_RE.test(line);
}

/** Repository root this script belongs to (always `<repo>/scripts/..`). */
export function repositoryRoot() {
  return fileURLToPath(new URL("..", import.meta.url));
}

function toRepoRelative(repoRoot, path) {
  return relative(repoRoot, path).split(sep).join("/");
}

function isGeneratedE2eOutput(repoRoot, path) {
  return GENERATED_E2E_OUTPUT_DIRS.includes(toRepoRelative(repoRoot, path));
}

async function walk(path, repoRoot, violations) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const target = join(path, entry.name);
    if (entry.isDirectory()) {
      if (
        PRUNED_DIR_NAMES.has(entry.name) ||
        (entry.name === "public" && path.includes(join("apps", "api"))) ||
        isGeneratedE2eOutput(repoRoot, target)
      ) {
        continue;
      }
      await walk(target, repoRoot, violations);
    } else if (SOURCE_EXTENSIONS.has(extname(entry.name))) {
      const text = await readFile(target, "utf8");
      text.split("\n").forEach((line, index) => {
        if (isConsoleOutput(line)) {
          violations.push(
            `${toRepoRelative(repoRoot, target)}:${index + 1} console output`,
          );
        }
      });
    }
  }
}

/**
 * Every violation under `repoRoot`, covering both authoritative scan roots.
 * Exported for the regression suite; the CLI passes `repositoryRoot()`.
 */
export async function collectViolations(repoRoot = repositoryRoot()) {
  const violations = [];
  for (const root of SCAN_ROOTS) {
    await walk(join(repoRoot, root), repoRoot, violations);
  }
  return violations;
}

async function main() {
  const violations = await collectViolations();
  if (violations.length > 0) {
    process.stderr.write(
      `Code quality violations:\n${violations.join("\n")}\n`,
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write("Code quality checks passed.\n");
}

// Compare URLs, not filesystem paths: when this module is imported by a
// bundler/test runner, `import.meta.url` is not a `file:` URL and must not be
// handed to fileURLToPath — the CLI entry point is simply not triggered.
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedDirectly) await main();
