// DB / test-config regression guards.
//
// Locks in the invariants established by the config single-source refactor so a
// future change can't silently regress them. Runs as part of `pnpm verify`
// (via the lint step). Mirrors the walk + regex + exit-1 style of
// check-code-quality.mjs — pure Node, no deps.
//
// Guards:
//   1. No second DB URL resolver: only packages/db/src/databaseUrl.ts may
//      declare `resolveDatabaseUrl` / `resolveTestDatabaseUrl` /
//      `resolveTestBranchUrl`. Other files may call/import them, not redefine.
//      (Prevents the 3-resolver drift that caused the dev/test DB split.)
//   2. No hardcoded `postgresql://...localhost...` LIVE defaults outside
//      databaseUrl.ts. The dev-mode convenience fallback lives there once;
//      database.ts / drizzle.config.ts / runtimeConfig.ts must not reintroduce
//      a localhost default (a missing URL must fail fast).
//   3. vitest configs force test mode via the shared TEST_RUNTIME_ENV constant,
//      not an inline `APP_MODE: "test"` literal. (Prevents per-config drift of
//      the forced test mode — the "one macro per AI" failure mode.)

import { readFile } from "node:fs/promises";
import { relative } from "node:path";

const violations = [];

// --- Guard 1: single DB URL resolver declaration site -----------------------
// `databaseUrl.ts` is the sole source of DB URL resolution logic. Other files
// may read TEST_DATABASE_URL ?? TEST_DB_URL ONLY as a pre-check before
// delegating to the single-source resolver (e.g. testWorkerDatabase checks the
// postgres protocol, then calls resolveTestBranchUrl for name-safety). A file
// that resolves the URL AND never delegates is a true reimplementation.
const RESOLVER_BODY_RE =
  /TEST_DATABASE_URL\s*\?\?\s*(process\.env\.)?TEST_DB_URL/;
const DELEGATION_RE =
  /resolve(TestBranchUrl|DatabaseUrl|DatabaseUrlFromEnv|TestDatabaseUrl)\b/;
const resolverBodyFiles = [
  "packages/db/src/testIsolation.ts",
  "packages/db/src/testWorkerDatabase.ts",
  "packages/db/src/database.ts",
  "packages/db/src/testDb.ts",
  "apps/api/src/config/runtimeConfig.ts",
  "apps/api/src/scripts/migrate.ts",
];
for (const f of resolverBodyFiles) {
  const text = await readFile(f, "utf8");
  // Strip comments so docstrings mentioning the pattern don't trigger.
  const codeOnly = text
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
    .join("\n");
  if (RESOLVER_BODY_RE.test(codeOnly) && !DELEGATION_RE.test(text)) {
    violations.push(
      `${f}: resolves DB URL (TEST_DATABASE_URL ?? TEST_DB_URL) without delegating to packages/db/src/databaseUrl.ts`,
    );
  }
}

// --- Guard 2: no live localhost default outside databaseUrl.ts --------------
// Only databaseUrl.ts may hold the dev convenience fallback. The other sites
// must fail fast on a missing URL (no silent localhost guess).
const LOCALHOST_DEFAULT_RE = /localhost:5432\/exam["']/;
const liveDefaultFiles = [
  "packages/db/src/database.ts",
  "packages/db/drizzle.config.ts",
  "apps/api/src/config/runtimeConfig.ts",
];
for (const f of liveDefaultFiles) {
  const text = await readFile(f, "utf8");
  // A localhost default as a *value* (assignment/return), not a comment or
  // error message. Heuristic: the URL appears outside a comment line.
  for (const [i, line] of text.split("\n").entries()) {
    if (line.trim().startsWith("//") || line.trim().startsWith("*")) continue;
    if (line.trim().startsWith('"') && line.includes("TEST_DATABASE_URL"))
      continue; // error-message string
    if (LOCALHOST_DEFAULT_RE.test(line)) {
      violations.push(
        `${f}:${i + 1} hardcodes a localhost:5432/exam live default — only packages/db/src/databaseUrl.ts may do this; a missing URL must fail fast`,
      );
    }
  }
}

// --- Guard 3: vitest configs use TEST_RUNTIME_ENV, not inline APP_MODE ------
const vitestConfigs = [
  "packages/db/vitest.config.ts",
  "apps/api/vitest.config.ts",
];
for (const f of vitestConfigs) {
  const text = await readFile(f, "utf8");
  // An inline APP_MODE: "test" / NODE_ENV: "test" object literal (not inside a
  // comment, not the shared file itself). These must come from TEST_RUNTIME_ENV.
  for (const [i, line] of text.split("\n").entries()) {
    if (line.trim().startsWith("//") || line.trim().startsWith("*")) continue;
    if (/APP_MODE\s*:\s*["']test["']/.test(line)) {
      violations.push(
        `${f}:${i + 1} inline APP_MODE: "test" — import TEST_RUNTIME_ENV from ../../vitest.shared.ts instead`,
      );
    }
    if (/NODE_ENV\s*:\s*["']test["']/.test(line)) {
      violations.push(
        `${f}:${i + 1} inline NODE_ENV: "test" — import TEST_RUNTIME_ENV from ../../vitest.shared.ts instead`,
      );
    }
  }
  if (!text.includes("TEST_RUNTIME_ENV")) {
    violations.push(
      `${f}: does not import/use TEST_RUNTIME_ENV — test mode must be forced via the shared constant`,
    );
  }
}

// --- Report -----------------------------------------------------------------
if (violations.length > 0) {
  process.stderr.write(
    `DB/test-config regression guards failed:\n${violations.join("\n")}\n`,
  );
  process.exit(1);
}

process.stdout.write("DB/test-config regression guards passed.\n");
