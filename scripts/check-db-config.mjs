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
//   4. Vitest configs never read process.env.DATABASE_URL directly (they go
//      through resolveDatabaseUrl), and test files never read a bare
//      process.env.DATABASE_URL outside the config-resolution tests that
//      legitimately exercise the resolver itself. (Absorbed from the retired
//      check-test-env-contract.mjs when its CI/WSL/origin obligations moved
//      to scripts/repository-contract/config-contract.mjs — #370.)
//   5. Queue-participant lifecycle hooks declare an explicit numeric hook
//      budget (PR #242 rule). A hook participates in the shared test-infra DDL
//      advisory lock queue when it directly calls a lock holder
//      (setupIsolatedTestDb / getIsolatedTestDb / ensureDatabaseExists /
//      dropDatabaseIfExists / applyAllMigrations / createTestSchema /
//      dropTestSchema / withTestInfraLifecycleLock), tears down an isolated
//      test schema (`.cleanup()` on a setup binding, or a bare call of a
//      cleanup alias assigned from one), or calls a same-file helper that
//      queues. Such hooks must pass `beforeAll(fn, 30_000/120_000)` — the 10s
//      default silently pays the lock queue wait, and a timed-out hook is
//      not cancelled (it keeps holding the lock → cascade). There is
//      deliberately NO package-wide hookTimeout raise. Scans both the
//      @exam/db and @exam/api test trees (they share the same lock).

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

// --- Guard 4: no direct DATABASE_URL reads in vitest configs / test files ----
// Vitest configs must route through the single-source resolver; test files
// must use TEST_DATABASE_URL / resolveTestDatabaseUrl. Config-resolution
// tests (databaseUrl, runtimeConfig, settings, loadRootEnv,
// testWorkerDatabase) legitimately exercise how DATABASE_URL is read.
{
  const DB_URL_EXEMPT =
    /databaseUrl|runtimeConfig|settings|loadRootEnv|testWorkerDatabase/i;

  const dirsToWalk = [join(ROOT, "packages"), join(ROOT, "apps")];
  const vitestConfigs = [];
  const testFiles = [];
  const PRUNE = new Set([
    "node_modules",
    "dist",
    "coverage",
    "playwright-report",
  ]);
  async function walkTests(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (PRUNE.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walkTests(full);
      } else if (/vitest\.config\.(ts|js|mjs)$/.test(entry.name)) {
        vitestConfigs.push(full);
      } else if (/\.test\.(ts|tsx|js|jsx)$/.test(entry.name)) {
        testFiles.push(full);
      }
    }
  }
  for (const dir of dirsToWalk) await walkTests(dir);

  for (const configPath of vitestConfigs) {
    const lines = (await readFile(configPath, "utf8")).split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trimStart().startsWith("//")) continue;
      if (
        line.includes("process.env.DATABASE_URL") &&
        !line.includes("resolveDatabaseUrl")
      ) {
        violations.push(
          `${relative(ROOT, configPath)}:${i + 1} vitest config reads process.env.DATABASE_URL directly — use resolveDatabaseUrl`,
        );
      }
    }
  }

  for (const testPath of testFiles) {
    const rel = relative(ROOT, testPath);
    if (DB_URL_EXEMPT.test(rel)) continue;
    const lines = (await readFile(testPath, "utf8")).split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trimStart().startsWith("//") || line.trimStart().startsWith("*"))
        continue;
      if (
        line.includes("process.env.DATABASE_URL") &&
        !line.includes("TEST_DATABASE_URL")
      ) {
        violations.push(
          `${rel}:${i + 1} test file reads process.env.DATABASE_URL — should use TEST_DATABASE_URL or resolveTestDatabaseUrl`,
        );
      }
    }
  }
}
// --- Guard 5: queue-participant hooks declare an explicit hook budget ------
// PR #242 rule (2026-08-26 audit): lifecycle hooks whose body enters the
// shared test-infra DDL advisory lock queue must pass an explicit numeric
// timeout as the second argument. Vitest's per-describe `{ timeout }` covers
// TEST bodies only — hooks resolve their own timeout from beforeAll(fn,
// timeout = getDefaultHookTimeout()), i.e. the 10s global default. A queue
// wait + full migration can exceed 10s, and a timed-out hook is NOT cancelled
// (its orphaned promise keeps holding the lock — cascade). There is
// deliberately NO package-wide hookTimeout raise (an unrelated broken hook
// must surface at 10s, not be masked for 30s), so the budget belongs at each
// call site.
//
// "Queue participant" is a semantic class, not a syntax class. A hook
// participates when ANY of these hold (bounded data-flow, no AST / call-graph
// analysis):
//   1. direct:   the hook body names a lock holder
//                (setupIsolatedTestDb / getIsolatedTestDb / ensureDatabaseExists
//                / dropDatabaseIfExists / applyAllMigrations / createTestSchema
//                / dropTestSchema / withTestInfraLifecycleLock — current source
//                reality, every one wraps withTestInfraLifecycleLock);
//   2. cleanup:  the hook body calls `.cleanup()` on a binding assigned from
//                setupIsolatedTestDb / getIsolatedTestDb in the same file
//                (`iso.cleanup()`, `iso?.cleanup()`, `env.iso.cleanup()`);
//   3. alias:    the hook body bare-calls a cleanup alias assigned from a
//                setup binding's `.cleanup` (`cleanup = result.cleanup;`
//                → `await cleanup();`), or an arrow closure whose body queues;
//   4. helper:   the hook body calls a same-file `function` whose body queues
//                by rules 1-3 (e.g. `teardown(env)` / `makeEnv(...)`).
// A `.cleanup()` on a binding that is NOT from a setup call (e.g. an unrelated
// `cache.cleanup()`) is deliberately NOT a participant — the receiver must be
// one of the file's own setup bindings. Hooks that look like participants but
// use a non-arrow shape the scanner cannot audit FAIL LOUD instead of silently
// passing.
{
  const LOCK_FNS = [
    "setupIsolatedTestDb",
    "getIsolatedTestDb",
    "ensureDatabaseExists",
    "dropDatabaseIfExists",
    "applyAllMigrations",
    "createTestSchema",
    "dropTestSchema",
    "withTestInfraLifecycleLock",
  ];
  const HOOK_RE = /\b(beforeAll|afterAll|beforeEach|afterEach)\s*\(/;
  const SETUP_BINDING_RE =
    /([A-Za-z_$][\w$]*)\s*=\s*await\s+(?:setupIsolatedTestDb|getIsolatedTestDb)\s*\(/g;

  // Char-level, comment/string/template-aware scan of a balanced region
  // starting at `open` (index of the opening char). Tracks only the given
  // `openCh`/`closeCh` pair (`(`→`)` for hook argument regions, `{`→`}` for
  // function bodies). Returns the text through the matching close char, or
  // null when unbalanced.
  function scanRegion(src, open, openCh, closeCh) {
    let depth = 0;
    let k = open;
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
      if (c === openCh) depth++;
      else if (c === closeCh) {
        depth--;
        if (depth === 0) return src.slice(open, k + 1);
      }
      k++;
    }
    return null;
  }

  // Last identifier before the end of `text` (handles `iso.cleanup()` and
  // `iso?.cleanup()` — the optional `?` is the trailing char in both).
  function lastIdBefore(text) {
    const m = /([A-Za-z_$][\w$]*)\s*\??\s*$/.exec(text);
    return m ? m[1] : null;
  }

  // Does `text` tear down an isolated test schema — `.cleanup()` on one of the
  // file's own setup bindings, or a bare call of a cleanup alias?
  function tearsDownIsolatedSchema(text, setupBindings, aliases) {
    for (const m of text.matchAll(/\.cleanup\s*\(/g)) {
      const id = lastIdBefore(text.slice(0, m.index));
      if (id && setupBindings.has(id)) return true;
    }
    for (const alias of aliases) {
      if (new RegExp(`\\b${alias}\\s*\\??\\s*\\(`).test(text)) return true;
    }
    return false;
  }

  // Brace body of a top-level `function NAME(...) { ... }` starting at the
  // parameter-list open paren. Skips a return-type annotation
  // (`): Promise<Env> {`) — bounded: finds the next `{` after the params.
  function functionBody(src, open) {
    let depth = 0;
    let k = open;
    while (k < src.length) {
      if (src[k] === "(") depth++;
      else if (src[k] === ")") {
        depth--;
        if (depth === 0) {
          k++;
          break;
        }
      }
      k++;
    }
    while (k < src.length && /\s/.test(src[k])) k++;
    if (src[k] === ":") {
      const brace = src.indexOf("{", k);
      if (brace === -1) return null;
      return scanRegion(src, brace, "{", "}");
    }
    if (src[k] !== "{") return null;
    return scanRegion(src, k, "{", "}");
  }

  const testRoots = ["packages/db/src", "apps/api/src"];
  const files = [];
  async function collect(root) {
    const dir = join(ROOT, root);
    async function walk(d) {
      for (const entry of await readdir(d, { withFileTypes: true })) {
        const full = join(d, entry.name);
        if (entry.isDirectory()) await walk(full);
        else if (/\.test\.ts$/.test(entry.name)) files.push(full);
      }
    }
    await walk(dir);
  }
  for (const root of testRoots) await collect(root);

  for (const path of files) {
    const src = await readFile(path, "utf8");

    // Bindings assigned from the setup helpers (rule 2 receiver set).
    const setupBindings = new Set();
    for (const m of src.matchAll(SETUP_BINDING_RE)) setupBindings.add(m[1]);

    // Cleanup aliases (rule 3): `NAME = <setupBinding>.cleanup`, plus arrow
    // closures whose body queues (`cleanup = async () => { ... iso.cleanup() }`).
    const aliases = new Set();
    for (const m of src.matchAll(
      /([A-Za-z_$][\w$]*)\s*=\s*([A-Za-z_$][\w$]*)\.cleanup/g,
    )) {
      if (setupBindings.has(m[2])) aliases.add(m[1]);
    }
    for (const m of src.matchAll(
      /([A-Za-z_$][\w$]*)\s*=\s*async\s*\([^)]*\)\s*=>\s*\{/g,
    )) {
      const body = scanRegion(src, m.index + m[0].length - 1, "{", "}");
      if (
        body &&
        (LOCK_FNS.some((fn) => body.includes(fn)) ||
          tearsDownIsolatedSchema(body, setupBindings, aliases))
      ) {
        aliases.add(m[1]);
      }
    }

    // Same-file helpers that queue (rule 4).
    const queueHelpers = new Set();
    for (const m of src.matchAll(
      /(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g,
    )) {
      const body = functionBody(src, m.index + m[0].length - 1);
      if (
        body &&
        (LOCK_FNS.some((fn) => body.includes(fn)) ||
          tearsDownIsolatedSchema(body, setupBindings, aliases))
      ) {
        queueHelpers.add(m[1]);
      }
    }

    // Lifecycle hooks.
    let idx = 0;
    for (;;) {
      const m = HOOK_RE.exec(src.slice(idx));
      if (!m) break;
      const kwStart = idx + m.index;
      const open = kwStart + m[0].length - 1;
      const region = scanRegion(src, open, "(", ")");
      if (!region) {
        idx = kwStart + m[0].length;
        continue;
      }
      idx = kwStart + region.length;
      const lineNo = src.slice(0, kwStart).split("\n").length;

      const plain = /^\(\s*(?:async\s*)?\(\)\s*=>\s*\{/.test(region);
      const direct = LOCK_FNS.some((fn) => region.includes(fn));
      const teardown = tearsDownIsolatedSchema(region, setupBindings, aliases);
      const helper = [...queueHelpers].some((hn) =>
        new RegExp(`\\b${hn}\\s*\\(`).test(region),
      );
      if (!direct && !teardown && !helper) continue;

      if (!plain) {
        violations.push(
          `${relative(ROOT, path)}:${lineNo} queue-participant lifecycle hook ` +
            "uses a non-arrow shape that Guard 5 cannot audit (expected " +
            "`beforeAll(async () => { ... })` / `afterAll(...)` with an arrow " +
            "callback). Refactor to a plain arrow callback so the hook budget " +
            "is checkable (PR #242 rule).",
        );
        continue;
      }
      // Timed iff the close paren is directly preceded by a numeric arg
      // (`}, 30_000);` or the prettier `},\n 30_000,\n);` form).
      const tail = region.replace(/\s+/g, "").match(/\d[\d_]*\s*,?\s*\);?$/);
      if (tail) continue;
      violations.push(
        `${relative(ROOT, path)}:${lineNo} queue-participant lifecycle hook ` +
          "(enters the shared test-infra DDL advisory lock directly, or tears " +
          "down an isolated test schema that holds it) must pass an explicit " +
          "numeric hook timeout (e.g. `}, 30_000);` for bootstrap/teardown, " +
          "`}, 120_000);` for full-migration setup) — the 10s default silently " +
          "pays the lock queue wait (PR #242 rule).",
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
