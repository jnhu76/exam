#!/usr/bin/env node
/**
 * Env-file source-surface guard (#741, ROOT_ONLY_ENV_FILE_POLICY).
 *
 * POLICY DATA lives in ../../envFilePolicy.ts (imported here via Node type
 * stripping, the same pattern config-contract.mjs uses for settings.ts);
 * this script owns the ENFORCEMENT relations only:
 *
 *   G1  physical filesystem policy — no `.env`-style file outside the
 *       repository root. Scans the real filesystem (not git), so gitignored
 *       residue a hard-killed test left behind still fails loud.
 *   G2  root filename allowlist — env-like files at the root must be one of
 *       the supported names; unsupported variants (`.env.local`,
 *       `.env.development*`, `.env.test`, …) fail loud instead of silently
 *       participating.
 *   G3  env reader allowlist — only the approved admission modules may
 *       import dotenv or vite's loadEnv. Docs/tests mentioning ".env" are
 *       out of scope; custom fs readers are a documented limitation.
 *   G4  no real-candidate test writers — test files must not write env
 *       paths anchored to repository locations; mkdtemp/tmp fixtures pass.
 *       Bounded textual enforcement (statement-level anchor heuristics).
 *   G5  structural pins — `envDir: false` in every vite/vitest config
 *       (package-local implicit env admission disabled), drizzle's
 *       module-relative root .env, web's development-only file admission.
 *   G6  deployment ownership — the production entrypoints keep
 *       `--env-file .env.production` (Compose interpolation), the one
 *       reader of `.env.production`.
 *
 * `--root <dir>` checks a different tree (guard self-tests use this; it
 * changes only which tree is scanned, never any runtime configuration).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SUPPORTED_ROOT_ENV_FILES } from "../envFilePolicy.ts";

const args = process.argv.slice(2);
let ROOT = fileURLToPath(new URL("../", import.meta.url));
{
  const rootFlag = args.indexOf("--root");
  if (rootFlag !== -1) {
    const value = args[rootFlag + 1];
    if (!value) {
      console.error("--root requires a directory argument");
      process.exit(2);
    }
    ROOT = resolve(value);
  }
}

const errors = [];

function fail(message) {
  errors.push(message);
}

/** Env-file candidate: basename is exactly `.env` or starts with `.env.`. */
function isEnvFileName(name) {
  return name === ".env" || name.startsWith(".env.");
}

/** Generated/dependency trees never contain repository env sources. */
const PRUNED_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "coverage",
  ".turbo",
  ".pnpm-store",
]);

function walk(dir, file, top = dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (PRUNED_DIRS.has(entry.name)) continue;
      walk(join(dir, entry.name), file, top);
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      file(join(dir, entry.name), top);
    }
  }
}

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".mjs",
  ".js",
  ".jsx",
]);

function walkSourceFiles(file) {
  walk(ROOT, (full) => {
    const name = basename(full);
    const dot = name.lastIndexOf(".");
    if (dot === -1) return;
    if (!SOURCE_EXTENSIONS.has(name.slice(dot))) return;
    file(full);
  });
}

// ── G1 + G2: physical env-file surface ──────────────────────────────────────
console.log(
  "G1/G2. Checking physical env-file surface (root-only, allowlist)…",
);
{
  const nonRoot = [];
  const unsupportedRoot = [];
  walk(ROOT, (full, top) => {
    if (!isEnvFileName(basename(full))) return;
    const rel = relative(top, full);
    if (dirname(rel) !== ".") {
      nonRoot.push(rel);
    } else if (!SUPPORTED_ROOT_ENV_FILES.includes(basename(full))) {
      unsupportedRoot.push(rel);
    }
  });
  for (const rel of nonRoot) {
    fail(
      `${rel}: non-root env file — physical env-file sources live ONLY at ` +
        "the repository root (#741 ROOT_ONLY_ENV_FILE_POLICY); readers may " +
        "sit in packages, sources may not. Remove the file; configure via " +
        "the root .env / .env.test.local / .env.production instead.",
    );
  }
  for (const rel of unsupportedRoot) {
    fail(
      `${rel}: unsupported root env file — supported names are ` +
        `${SUPPORTED_ROOT_ENV_FILES.join(", ")}; this variant has no ` +
        "admission owner and must not exist (silent-drift guard, #741).",
    );
  }
}
console.log("   Physical surface check complete.");

// ── G3: env reader allowlist ────────────────────────────────────────────────
// Import-based detection only: a bare `dotenv` import or vite `loadEnv`
// import outside the allowlist opens a second admission path. Raw fs reads
// of env-like paths are NOT scanned (false-positive prone); review covers
// them, and the audit found none outside the allowlisted deployment tool.
console.log("G3. Checking env reader allowlist…");
{
  const allowedReaders = new Set([
    // application runtime admission (API, dev profile)
    "apps/api/src/config/loadRootEnv.ts",
    // web build-tool Node-side admission (development mode only)
    "apps/web/vite.config.ts",
    // shared vitest test-env loader (imported by every vitest config)
    "vitest.shared.ts",
    // DB tooling bootstrap
    "packages/db/drizzle.config.ts",
  ]);

  const dotenvImport =
    /from ["']dotenv["']|require\(["']dotenv["']\)|import\s+["']dotenv["']/;
  const viteLoadEnvImport =
    /import\s*\{[^}]*\bloadEnv\b[^}]*\}\s*from\s*["']vite["']/;

  walkSourceFiles((full) => {
    const rel = relative(ROOT, full);
    if (allowedReaders.has(rel)) return;
    if (basename(full).includes(".test.")) return; // test fixtures/mocks
    const text = readFileSync(full, "utf8");
    if (dotenvImport.test(text)) {
      fail(
        `${rel}: imports dotenv outside the reader allowlist — env-file ` +
          "admission belongs to loadRootEnv (runtime), the web vite config " +
          "(dev), vitest.shared (tests) or drizzle.config (DB tooling) " +
          "(#741).",
      );
    }
    if (viteLoadEnvImport.test(text)) {
      fail(
        `${rel}: imports loadEnv from vite outside the reader allowlist — ` +
          "vite's loadEnv admits the whole 4-layer mode-file family; use " +
          "the exact-path loaders from envFilePolicy/vitest.shared (#741).",
      );
    }
  });
}
console.log("   Reader allowlist check complete.");

// ── G4: no real-candidate test writers ──────────────────────────────────────
// Statement-level heuristics: (a) a WRITE call in a test file whose line
// also anchors an env path to a repository location (__dirname /
// import.meta.url / resolveRootEnvP* / workspaceRoot / repoRoot /
// process.cwd()) is a real-candidate writer; temp-anchored fixtures
// (mkdtemp/tmpdir) pass. (b) `resolve(__dirname, "<...>.env")` in a test
// file — the pre-#741 R1 writer shape — is flagged even though the write
// itself happened through a variable on another line. Indirect writes
// through unrelated variables remain out of reach — an honest limitation;
// the resolveRootEnvPaths plural check below kills the R5 shape.
console.log("G4. Checking for real-candidate env writers in tests…");
{
  const writeCall =
    /\b(?:writeFile|writeFileSync|appendFile|appendFileSync|cp|cpSync|rename|renameSync)\s*\(/;
  const repoAnchor =
    /__dirname|import\.meta\.url|resolveRootEnvP\w+|workspaceRoot|repoRoot|process\.cwd\(\)/;
  const tempAnchor = /mkdtemp|tmpdir|tempDir|fixtureDir|hostileCwd/;
  const dirnameEnvResolve =
    /resolve\(\s*__dirname\s*,\s*["'][^"']*\.env(?:["']|\.)/;

  walkSourceFiles((full) => {
    const rel = relative(ROOT, full);
    if (!basename(full).includes(".test.")) return;
    const text = readFileSync(full, "utf8");
    for (const [index, line] of text.split("\n").entries()) {
      if (!writeCall.test(line)) continue;
      if (!/\.env/.test(line)) continue;
      if (tempAnchor.test(line)) continue;
      if (repoAnchor.test(line)) {
        fail(
          `${rel}:${index + 1}: test writes an env file anchored to a ` +
            "repository location — permanent tests must never write a " +
            "repository env-file authority; use mkdtemp/tmpdir fixtures " +
            "(#741 W3).",
        );
      }
    }
    if (dirnameEnvResolve.test(text)) {
      fail(
        `${rel}: resolves a repository env path via ` +
          "`resolve(__dirname, … .env …)` — the pre-#741 real-candidate " +
          "fixture shape; tests must use temp-dir fixtures (#741 W3).",
      );
    }
    // The pre-#741 multi-candidate resolver API must not come back.
    if (/resolveRootEnvPaths/.test(text)) {
      fail(
        `${rel}: references resolveRootEnvPaths (the retired multi-` +
          "candidate API) — the application source is single-candidate " +
          "resolveRootEnvPath (#741).",
      );
    }
  });
}
console.log("   Test-writer check complete.");

// ── G5: structural pins ─────────────────────────────────────────────────────
console.log("G5. Checking envDir / drizzle / web admission structural pins…");
{
  // Every vite/vitest config disables implicit env-file admission. A future
  // contributor cannot delete one line and silently re-enable a package-
  // local .env* family — this guard fails first.
  const configFiles = [];
  walk(ROOT, (full, top) => {
    const name = basename(full);
    if (/^vite(?:st)?[\w.-]*\.config\.ts$/.test(name)) {
      configFiles.push(relative(top, full));
    }
  });
  if (configFiles.length === 0) {
    fail("no vite/vitest configs discovered — the discovery pattern broke");
  }
  for (const rel of configFiles) {
    const text = readFileSync(join(ROOT, rel), "utf8");
    if (!text.includes("envDir: false")) {
      fail(
        `${rel}: missing "envDir: false" — package-local implicit env-file ` +
          "admission must stay disabled in every vite/vitest config (#741).",
      );
    }
  }

  // Drizzle resolves the root .env module-relatively (cwd-independent).
  const drizzle = readFileSync(
    join(ROOT, "packages/db/drizzle.config.ts"),
    "utf8",
  );
  if (!/new URL\(["'][^"']*\.env["'],\s*import\.meta\.url\)/.test(drizzle)) {
    fail(
      "packages/db/drizzle.config.ts: the dotenv path must be a " +
        "module-relative URL resolution, not a cwd-relative string (#741 F-6).",
    );
  }

  // Web admits the development env file ONLY, and only in development mode.
  const viteConfig = readFileSync(
    join(ROOT, "apps/web/vite.config.ts"),
    "utf8",
  );
  if (!/mode !== "development"/.test(viteConfig)) {
    fail(
      "apps/web/vite.config.ts: the env-file read must be gated on " +
        'mode === "development" — production builds read no env file ' +
        "(.env.production stays deployment-owned, #741 F-3).",
    );
  }
  if (!/SUPPORTED_DEV_ENV_FILE/.test(viteConfig)) {
    fail(
      "apps/web/vite.config.ts: must source the dev file name from " +
        "envFilePolicy (SUPPORTED_DEV_ENV_FILE) — policy data stays in one " +
        "place (#741).",
    );
  }

  // The API admission seam resolves exactly the repository-root .env.
  const loadRootEnv = readFileSync(
    join(ROOT, "apps/api/src/config/loadRootEnv.ts"),
    "utf8",
  );
  if (
    !/new URL\(["']\.\.\/\.\.\/\.\.\/\.\.\/\.env["'],\s*import\.meta\.url\)/.test(
      loadRootEnv,
    )
  ) {
    fail(
      "apps/api/src/config/loadRootEnv.ts: resolveRootEnvPath must anchor " +
        "the single candidate to the repository root (four hops up, " +
        "#741 F-1/F-5).",
    );
  }
}
console.log("   Structural pins check complete.");

// ── G6: deployment env ownership ────────────────────────────────────────────
console.log("G6. Checking deployment --env-file ownership…");
{
  const dbBackup = readFileSync(join(ROOT, "scripts/db-backup.sh"), "utf8");
  if (!dbBackup.includes("--env-file .env.production")) {
    fail(
      "scripts/db-backup.sh: deployment tooling must keep " +
        "`--env-file .env.production` — Compose interpolation is the one " +
        "reader of .env.production (#741).",
    );
  }
  const runbook = readFileSync(
    join(ROOT, "docs/deployment/mvp-deployment-runbook.md"),
    "utf8",
  );
  if (!runbook.includes("--env-file .env.production")) {
    fail(
      "docs/deployment/mvp-deployment-runbook.md: the deployment entrypoint " +
        "must document `--env-file .env.production` (#741).",
    );
  }
}
console.log("   Deployment ownership check complete.");

// ── Report ──────────────────────────────────────────────────────────────────
console.log("\n" + "=".repeat(60));
if (errors.length === 0) {
  console.log(
    `PASS: env-file source surface upheld (root-only physical sources, ` +
      `${SUPPORTED_ROOT_ENV_FILES.length} supported root files, reader ` +
      "allowlist, fixture-writer guard, envDir pins).",
  );
  process.exit(0);
}
console.error(`FAIL: env-file source surface violations (${errors.length}):`);
for (const e of errors) console.error(`  - ${e}`);
process.exit(1);
