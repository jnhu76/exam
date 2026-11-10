import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Canonical build-first dev entrypoints — structural contract gate for
 * ADOPT_BUILD_FIRST_DEV (ADR-027; approved with errata E1–E3 via #937
 * comment 6774167661, implementation contract in #938).
 *
 * The adopted decision makes `pnpm dev` the canonical managed entry
 * (`turbo watch dev`): the first invocation must build the full upstream
 * dependency closure before managed API/Web processes start, and upstream
 * source changes rebuild + restart them. Two unmanaged escape hatches are
 * part of the same contract:
 *
 *   `pnpm dev:once`  → `turbo dev`  — one-shot start after a first build,
 *                  without Turbo's cross-package watch coordination (E2:
 *                  Vite/tsx's own watchers stay alive; this is NOT "no hot
 *                  reload");
 *   `pnpm watch:dist` → `turbo watch build` — rebuild artifacts only, never
 *                  restart start/worker/CLI consumers (E3: independent
 *                  tool for unmanaged consumers, not a second dev entry).
 *
 * Build fail-safety (E1): noEmitOnError guarantees only that a failing
 * compile emits no NEW artifacts of that run — it is not an atomic
 * workspace release; old artifacts may remain on disk and running
 * processes keep serving the old version. A failed build must never be
 * reported as a successful publish.
 *
 * This gate parses the ACTUAL repo files (root package.json scripts,
 * turbo.json task definitions, every managed build tsconfig resolved
 * through its extends chain). It pins the declared contract; the runtime
 * behavior verification (watch/restart semantics) is separate evidence.
 *
 * Placement mirrors lifecycleStateWriteBoundary.test.ts: apps/web is the
 * DB-free app suite and already hosts repo-level structural tests. Only
 * node:fs/node:path are used — no repo .mjs module is imported, so the
 * production `tsc -b` (which compiles test files, unlike the Docker
 * builder's copy set) stays safe.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");

interface JsonRecord {
  readonly [key: string]: unknown;
}

function readJsonFile(path: string): JsonRecord {
  const raw = readFileSync(path, "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Expected a JSON object at ${path}`);
  }
  return parsed as JsonRecord;
}

function asString(value: unknown, context: string): string {
  if (typeof value !== "string") {
    throw new Error(
      `Expected a string for ${context}, got ${JSON.stringify(value)}`,
    );
  }
  return value;
}

/** Workspace members that own a `build` script — the managed build graph. */
interface BuildablePackage {
  readonly name: string;
  readonly dir: string;
  readonly buildScript: string;
}

function discoverBuildablePackages(): BuildablePackage[] {
  const packages: BuildablePackage[] = [];
  // Workspace roots per pnpm-workspace.yaml ("apps/*", "packages/*"). A
  // future workspace-root change is a manifest decision that must revisit
  // this gate; until then, unknown roots would be silently ungoverned
  // here, which is why the roots are explicit constants.
  const workspaceRoots = ["apps", "packages"];
  for (const root of workspaceRoots) {
    const rootDir = join(REPO_ROOT, root);
    for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = join(rootDir, entry.name, "package.json");
      if (!existsSync(manifestPath)) continue;
      const manifest = readJsonFile(manifestPath);
      const name = asString(manifest["name"], `${manifestPath} name`);
      const scripts = manifest["scripts"];
      if (
        scripts === undefined ||
        scripts === null ||
        typeof scripts !== "object"
      ) {
        continue;
      }
      const build = (scripts as JsonRecord)["build"];
      if (typeof build !== "string") continue;
      packages.push({
        name,
        dir: join(rootDir, entry.name),
        buildScript: build,
      });
    }
  }
  return packages;
}

/**
 * Extract the TypeScript project file a package's build script compiles
 * with. Fail-closed: an unrecognized build-script shape is a contract
 * violation, not a silent skip.
 */
function buildTsconfigRelativePath(pkg: BuildablePackage): string {
  const tscSegments = pkg.buildScript
    .split("&&")
    .map((segment) => segment.trim())
    .filter((segment) => segment.startsWith("tsc "));
  if (tscSegments.length !== 1) {
    throw new Error(
      `${pkg.name} build script must contain exactly one tsc invocation, got: ${pkg.buildScript}`,
    );
  }
  const tscSegment = tscSegments[0] as string;
  const projectFlag = tscSegment.match(/-p\s+(\S+)/);
  if (projectFlag !== null) {
    return projectFlag[1] as string;
  }
  if (/^tsc\s+-b(\s|$)/.test(tscSegment)) {
    // `tsc -b` without an explicit project compiles the package's
    // tsconfig.json (verified: `tsc -b --dry` in apps/web resolves to
    // apps/web/tsconfig.json).
    return "tsconfig.json";
  }
  throw new Error(
    `${pkg.name} build script uses an unsupported tsc form: ${tscSegment}`,
  );
}

/**
 * Flatten a tsconfig into application order (ancestors first, self last),
 * mirroring TypeScript's `extends` semantics: parents are applied
 * left-to-right, and the child's own fields override every parent.
 */
function flattenExtendsChain(
  configPath: string,
  visited: Set<string>,
): JsonRecord[] {
  if (visited.has(configPath)) {
    throw new Error(`Circular tsconfig extends chain at ${configPath}`);
  }
  visited.add(configPath);
  const config = readJsonFile(configPath);
  const extendsField = config["extends"];
  const chain: JsonRecord[] = [];
  if (extendsField !== undefined) {
    const parents = Array.isArray(extendsField) ? extendsField : [extendsField];
    for (const parent of parents) {
      if (typeof parent !== "string") {
        throw new Error(
          `Unsupported extends entry in ${configPath}: ${JSON.stringify(parent)}`,
        );
      }
      const parentPath = parent.startsWith(".")
        ? resolve(dirname(configPath), parent)
        : // Bare package specifiers ("@tsconfig/…") resolve through
          // node_modules; none exist in this repo today, but the branch
          // keeps the resolver honest if one is ever added.
          join(REPO_ROOT, "node_modules", parent);
      chain.push(...flattenExtendsChain(parentPath, visited));
    }
  }
  chain.push(config);
  return chain;
}

/**
 * Resolve `compilerOptions.noEmitOnError` through the config's full
 * `extends` chain (child wins), mirroring TypeScript's inheritance.
 */
function resolveNoEmitOnError(configPath: string): boolean {
  const chain = flattenExtendsChain(configPath, new Set());
  let value: boolean | undefined;
  for (const config of chain) {
    const options = config["compilerOptions"];
    if (
      options !== undefined &&
      options !== null &&
      typeof options === "object"
    ) {
      const inherited = (options as JsonRecord)["noEmitOnError"];
      if (typeof inherited === "boolean") {
        value = inherited;
      }
    }
  }
  return value === true;
}

describe("canonical build-first dev entrypoints (ADOPT_BUILD_FIRST_DEV)", () => {
  const rootManifest = readJsonFile(join(REPO_ROOT, "package.json"));
  const rootScriptsValue = rootManifest["scripts"];
  if (
    rootScriptsValue === undefined ||
    rootScriptsValue === null ||
    typeof rootScriptsValue !== "object"
  ) {
    throw new Error("Root package.json has no scripts object");
  }
  const rootScripts = rootScriptsValue as JsonRecord;

  it("pins `pnpm dev` to `turbo watch dev` (canonical managed entry)", () => {
    expect(rootScripts["dev"]).toBe("turbo watch dev");
  });

  it("pins `pnpm dev:once` to `turbo dev` (one-shot start after first build)", () => {
    expect(rootScripts["dev:once"]).toBe("turbo dev");
  });

  it("pins `pnpm watch:dist` to `turbo watch build` (artifact-only rebuild)", () => {
    expect(rootScripts["watch:dist"]).toBe("turbo watch build");
  });

  it("orders the dev task after the upstream build closure (^build)", () => {
    const turboConfig = readJsonFile(join(REPO_ROOT, "turbo.json"));
    const tasks = turboConfig["tasks"];
    if (tasks === undefined || tasks === null || typeof tasks !== "object") {
      throw new Error("turbo.json has no tasks object");
    }
    const devTask = (tasks as JsonRecord)["dev"];
    if (
      devTask === undefined ||
      devTask === null ||
      typeof devTask !== "object"
    ) {
      throw new Error("turbo.json has no dev task definition");
    }
    const dependsOn = (devTask as JsonRecord)["dependsOn"];
    if (!Array.isArray(dependsOn)) {
      throw new Error(
        `turbo.json tasks.dev.dependsOn must be an array containing "^build", ` +
          `got ${JSON.stringify(dependsOn)}`,
      );
    }
    expect(dependsOn, "turbo.json tasks.dev.dependsOn").toContain("^build");
  });

  it("marks the dev task interruptible so watch cycles can restart it", () => {
    const turboConfig = readJsonFile(join(REPO_ROOT, "turbo.json"));
    const tasks = turboConfig["tasks"];
    if (tasks === undefined || tasks === null || typeof tasks !== "object") {
      throw new Error("turbo.json has no tasks object");
    }
    const devTask = (tasks as JsonRecord)["dev"];
    if (
      devTask === undefined ||
      devTask === null ||
      typeof devTask !== "object"
    ) {
      throw new Error("turbo.json has no dev task definition");
    }
    expect(
      (devTask as JsonRecord)["interruptible"],
      "turbo.json tasks.dev.interruptible",
    ).toBe(true);
  });

  it("fails builds closed: every managed build config resolves noEmitOnError=true", () => {
    const violations: string[] = [];
    for (const pkg of discoverBuildablePackages()) {
      let relativeConfig: string;
      try {
        relativeConfig = buildTsconfigRelativePath(pkg);
      } catch (error) {
        violations.push(
          `${pkg.name}: ${error instanceof Error ? error.message : String(error)}`,
        );
        continue;
      }
      const configPath = resolve(pkg.dir, relativeConfig);
      if (!existsSync(configPath)) {
        violations.push(`${pkg.name}: build tsconfig missing at ${configPath}`);
        continue;
      }
      if (!resolveNoEmitOnError(configPath)) {
        violations.push(
          `${pkg.name}: ${relativeConfig} resolves noEmitOnError=${"false"} (inherited or unset) — ` +
            `a failing compile must not emit new artifacts for this package`,
        );
      }
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });
});
