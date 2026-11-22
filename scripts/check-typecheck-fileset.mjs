// INVARIANT (#1073): the apps/api A-type typecheck gate must cover test
// sources — every .ts under apps/api/tests/ and every root-level vitest*.ts —
// and stay green over that fileset. A fileset narrower than the test sources
// makes test-side type drift silent, so this check fails closed.
//
// Exit codes: 0 ok; 1 fileset gap; 2 type errors over the test-inclusive
// fileset; 3 fixture broken (no test sources found); 4 the typecheck program
// itself fails to build a fileset (e.g. TS6059 rootDir violations).
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const apiDir = path.join(repoRoot, "apps", "api");
const typecheckArgs = ["exec", "tsc", "-p", "tsconfig.typecheck.json"];

// Test sources whose type contract must sit inside the A-type fileset:
// apps/api/tests/** plus the root-level vitest config/setup/harness files.
function collectTestSources() {
  const sources = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.[cm]?ts$/.test(entry.name)) sources.push(full);
    }
  };
  walk(path.join(apiDir, "tests"));
  for (const entry of readdirSync(apiDir, { withFileTypes: true })) {
    if (entry.isFile() && /^vitest\..*\.ts$/.test(entry.name)) {
      sources.push(path.join(apiDir, entry.name));
    }
  }
  return sources.sort();
}

function runTsc(extraArgs) {
  return execFileSync("pnpm", [...typecheckArgs, ...extraArgs], {
    cwd: apiDir,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  });
}

const testSources = collectTestSources();
if (testSources.length === 0) {
  console.error(
    "fixture broken: no test sources found under apps/api/tests/ or apps/api/vitest*.ts",
  );
  process.exit(3);
}

let fileListOutput;
try {
  fileListOutput = runTsc(["--listFilesOnly", "--skipLibCheck"]);
} catch (error) {
  console.error(
    "apps/api typecheck program fails to build a fileset (--listFilesOnly):",
  );
  console.error(`${error.stdout ?? ""}${error.stderr ?? ""}`.trim());
  process.exit(4);
}
const listed = new Set(
  fileListOutput
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((file) => (path.isAbsolute(file) ? file : path.resolve(apiDir, file))),
);
const missing = testSources.filter((file) => !listed.has(file));
if (missing.length > 0) {
  console.error(
    `typecheck fileset gap: ${missing.length}/${testSources.length} test-source files are outside the apps/api tsconfig.typecheck.json fileset`,
  );
  for (const file of missing)
    console.error(`  not typechecked: ${path.relative(repoRoot, file)}`);
  process.exit(1);
}
console.log(
  `fileset ok: all ${testSources.length} test-source files are inside the apps/api typecheck fileset`,
);

try {
  runTsc([]);
} catch (error) {
  console.error(
    "apps/api typecheck gate fails over the test-inclusive fileset:",
  );
  console.error(`${error.stdout ?? ""}${error.stderr ?? ""}`.trim());
  process.exit(2);
}
console.log(
  "typecheck ok: apps/api tsconfig.typecheck.json is green over the test-inclusive fileset",
);
