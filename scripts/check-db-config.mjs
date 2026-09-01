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
//   5. Queue-participant lifecycle hooks declare an explicit numeric hook
//      budget (PR #242 rule). Hooks that acquire the shared test-infra DDL
//      advisory lock must pass `beforeAll(fn, 30_000/120_000)` — the 10s
//      default silently pays the lock queue wait, and a timed-out hook is
//      not cancelled (it keeps holding the lock → cascade). There is
//      deliberately NO package-wide hookTimeout raise.

import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..");
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

// --- Guard 5: queue-participant hooks declare an explicit hook budget ------
// PR #242 rule (2026-08-26 audit): lifecycle hooks whose body acquires the
// shared test-infra DDL advisory lock (via setupIsolatedTestDb /
// getIsolatedTestDb / ensureDatabaseExists / dropDatabaseIfExists /
// applyAllMigrations) must pass an explicit numeric timeout as the second
// argument. Vitest's per-describe `{ timeout }` covers TEST bodies only —
// hooks resolve their own timeout from beforeAll(fn, timeout =
// getDefaultHookTimeout()), i.e. the 10s global default. A queue wait + full
// migration can exceed 10s, and a timed-out hook is NOT cancelled (its
// orphaned promise keeps holding the lock — cascade). There is deliberately
// NO package-wide hookTimeout raise (an unrelated broken hook must surface
// at 10s, not be masked for 30s), so the budget belongs at each call site.
{
  const LOCK_FNS = [
    "setupIsolatedTestDb",
    "getIsolatedTestDb",
    "ensureDatabaseExists",
    "dropDatabaseIfExists",
    "applyAllMigrations",
  ];
  const HOOK_RE = /\b(beforeAll|afterAll|beforeEach|afterEach)\s*\(/;

  // Char-level, comment/string-aware scan of a hook call starting at `start`.
  // Returns the call text (keyword through the matching close paren) or null
  // when the line is not a plain `beforeAll(async () => { ... })` shape.
  function scanHook(src, start) {
    const m = HOOK_RE.exec(src.slice(start));
    if (!m) return null;
    const kwStart = start + m.index;
    const open = kwStart + m[0].length - 1; // position of '('
    const head = /\(\s*(?:async\s*)?\(\)\s*=>\s*\{/.exec(src.slice(open));
    if (!head) return null;
    let depth = 0;
    let k = open + head[0].length - 1; // the callback's '{'
    while (k < src.length) {
      const c = src[k];
      if (c === "/" && src[k + 1] === "/") {
        const nl = src.indexOf("\n", k);
        k = nl === -1 ? src.length : nl + 1;
        continue;
      }
      if (c === "/" && src[k + 1] === "*") {
        const e = src.indexOf("*/", k + 2);
        k = e === -1 ? src.length : e + 2;
        continue;
      }
      if (c === '"' || c === "'") {
        const q = c;
        k++;
        while (k < src.length) {
          if (src[k] === "\\") {
            k += 2;
            continue;
          }
          if (src[k] === q) {
            k++;
            break;
          }
          k++;
        }
        continue;
      }
      if (c === "`") {
        k++;
        let tDepth = 0;
        while (k < src.length) {
          if (src[k] === "\\") {
            k += 2;
            continue;
          }
          if (src[k] === "`" && tDepth === 0) {
            k++;
            break;
          }
          if (src[k] === "$" && src[k + 1] === "{") {
            tDepth++;
            k += 2;
            continue;
          }
          if (src[k] === "}" && tDepth > 0) {
            tDepth--;
            k++;
            continue;
          }
          if (src[k] === "{" && tDepth > 0) tDepth++;
          k++;
        }
        continue;
      }
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) {
          let p = k + 1;
          while (p < src.length && /\s/.test(src[p])) p++;
          if (src[p] === ")") return src.slice(kwStart, p + 1);
          return null;
        }
      }
      k++;
    }
    return null;
  }

  const dbDir = join(ROOT, "packages/db/src");
  const files = [];
  async function collect(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await collect(full);
      else if (/\.test\.ts$/.test(entry.name)) files.push(full);
    }
  }
  await collect(dbDir);

  for (const path of files) {
    const src = await readFile(path, "utf8");
    let idx = 0;
    for (;;) {
      const hook = scanHook(src, idx);
      if (!hook) break;
      const hookStart = src.indexOf(hook, idx);
      idx = hookStart + hook.length;
      if (!LOCK_FNS.some((fn) => hook.includes(fn))) continue;
      // Timed iff the close paren is directly preceded by a numeric arg
      // (`}, 30_000);` or the prettier `},\n 30_000,\n);` form).
      const tail = hook.replace(/\s+/g, "").match(/\d[\d_]*\s*,?\s*\);?$/);
      if (tail) continue;
      const lineNo = src.slice(0, hookStart).split("\n").length;
      violations.push(
        `${relative(ROOT, path)}:${lineNo} queue-participant lifecycle hook ` +
          "(acquires the shared test-infra DDL advisory lock) must pass an " +
          "explicit numeric hook timeout (e.g. `}, 30_000);` for repository " +
          "bootstrap, `}, 120_000);` for full-migration beforeAll) — the 10s " +
          "default silently pays the lock queue wait (PR #242 rule).",
      );
    }
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
