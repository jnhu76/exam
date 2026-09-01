#!/usr/bin/env node
/**
 * Config contract gate (#370): profile-specific binding contracts over the
 * ONE application semantic settings model.
 *
 * This script is NOT a semantic authority. Membership, defaults,
 * requiredness, and binding classes are READ from
 * apps/api/src/config/settings.ts (imported directly — Node >=23.6 strips
 * erasable type syntax, and the module is dependency-free by design, so
 * this gate runs in a fresh checkout before any build). What this gate
 * owns is the per-topology binding relations:
 *
 *   Consumption — every non-delegated settings leaf is actually consumed
 *     by the runtimeConfig policy facade (an unconsumed leaf is dead
 *     semantic weight, not a feature); and settings.ts is imported only by
 *     runtimeConfig (+ its own tests), keeping one consumption seam.
 *
 *   Docker production — docker-compose.yml binds every leaf according to
 *     its semantic binding class (operator forward / required expansion /
 *     derived origin / container identity / dev-only absence). Literal
 *     Compose fallbacks may only mirror the semantic default exactly.
 *
 *   Docker test — the E2E stack derives PUBLIC_WEB_ORIGIN from the
 *     published EXAM_PORT (the origin the container browser uses).
 *
 *   CI — the verify/coverage jobs provide the required DB/auth env; the
 *     e2e job binds PUBLIC_WEB_ORIGIN to the same single origin the
 *     browser navigates (E2E_BASE_URL).
 *
 *   Local/WSL — run-wsl.sh binds PUBLIC_WEB_ORIGIN INSIDE launch_api to
 *     each API process's own port (serial AND per-shard; #365).
 *
 *   Test discipline — production-guard tests mutate process.env only via
 *     vi.stubEnv (unreliable manual mutation once leaked config states).
 *
 * Profiles are independent BY DESIGN: nothing here compares values ACROSS
 * topologies (CI may differ from WSL may differ from Docker). Only each
 * topology's internal relations are checked.
 *
 * DB/test raw-env discipline (vitest configs / test files reading
 * DATABASE_URL directly) lives in scripts/check-db-config.mjs, not here.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
const errors = [];

function fail(message) {
  errors.push(message);
}

// ── Load the semantic settings model ────────────────────────────────────────
// settings.ts is import-standalone on purpose (see its header); a failure
// here means the module gained an un-strippable import/syntax, which is
// itself a contract violation.
const { settingsLeaves } =
  await import("../../apps/api/src/config/settings.ts");
const LEAVES = settingsLeaves();

// ── 1. Consumption: every non-delegated leaf is consumed by the facade ──────
console.log("1. Checking settings consumption by runtimeConfig...");
{
  const runtimeConfigPath = join(ROOT, "apps/api/src/config/runtimeConfig.ts");
  const runtimeSrc = readFileSync(runtimeConfigPath, "utf-8");
  for (const [name, leaf] of LEAVES) {
    if (leaf.delegatedTo) continue; // resolution owned by the delegate module
    if (!new RegExp(`\\b${name}\\b`).test(runtimeSrc)) {
      fail(
        `settings leaf ${name} is not consumed by runtimeConfig.ts — ` +
          "an unconsumed semantic leaf is dead weight; wire it into the " +
          "policy facade or remove it (no speculative leaves).",
      );
    }
  }

  // Import boundary: runtimeConfig is the single consumption seam. Only
  // imports that actually resolve to apps/api/src/config/settings.ts are
  // flagged (a route-local or contracts-local module named settings is a
  // different module and none of this gate's business).
  const allowedImporters = new Set([
    "apps/api/src/config/runtimeConfig.ts",
    "apps/api/src/config/settings.test.ts",
    "apps/api/src/config/settings.ts",
  ]);
  const offenders = [];
  walk(
    join(ROOT, "apps"),
    (full) => {
      if (!full.endsWith(".ts") && !full.endsWith(".tsx")) return;
      const text = readFileSync(full, "utf-8");
      const rel = relative(ROOT, full);
      const importsConfigSettings =
        /(from|import)\s+"[^"]*config\/settings(\.js)?"/.test(text) ||
        (rel.startsWith("apps/api/src/config/") &&
          /(from|import)\s+"\.\.?\/settings(\.js)?"/.test(text));
      if (importsConfigSettings && !allowedImporters.has(rel)) {
        offenders.push(rel);
      }
    },
    (full) => {
      const base = full.split("/").pop();
      return base === "node_modules" || base === "dist";
    },
  );
  for (const rel of offenders) {
    fail(
      `${rel} imports config/settings — runtimeConfig.ts is the single ` +
        "consumption seam for application semantic settings; layer on " +
        "top of getRuntimeConfig()/loadRuntimeConfig() instead.",
    );
  }
}
console.log("   Consumption check complete.");

// ── 2. Docker production profile: compose binds every leaf by class ─────────
console.log("2. Checking docker-compose.yml app environment bindings...");
{
  const composeText = readFileSync(join(ROOT, "docker-compose.yml"), "utf-8");
  const appEnv = extractAppEnvironment(composeText);
  if (appEnv === null) {
    fail(
      "docker-compose.yml: cannot locate the app service environment block " +
        "(bounded textual extraction — re-check the app/env shape).",
    );
  } else {
    for (const [name, leaf] of LEAVES) {
      const entry = appEnv.get(name);
      switch (leaf.binding) {
        case "operator": {
          if (!entry) {
            fail(
              `docker-compose.yml 'app' must forward ${name} ` +
                "(the runtime consumes it; `--env-file` interpolates only — " +
                "an operator value without an environment entry never " +
                "reaches the container).",
            );
            break;
          }
          const m = entry.match(new RegExp(`^\\$\\{${name}:-(.*)\\}$`, "s"));
          if (!m) {
            fail(
              `docker-compose.yml 'app' ${name} must use the ` +
                `\`\${${name}:-…}\` forward form (got: ${entry}).`,
            );
            break;
          }
          const fallback = m[1].trim();
          const semantic = leaf.defaultRaw ?? "";
          if (fallback !== "" && fallback !== semantic) {
            fail(
              `docker-compose.yml ${name} fallback '${fallback}' must be ` +
                `empty (or exactly mirror the semantic default ` +
                `'${semantic}') — defaults are defined once in ` +
                "settings.ts; a diverging literal here is the #368 drift " +
                "class.",
            );
          }
          break;
        }
        case "required": {
          if (!entry) {
            fail(`docker-compose.yml 'app' must forward ${name}.`);
            break;
          }
          if (!new RegExp(`^\\$\\{${name}:\\?[^}]*\\}$`, "s").test(entry)) {
            fail(
              `docker-compose.yml 'app' ${name} is production-required — ` +
                `it must use required-expansion \`\${${name}:?…}\` with no ` +
                `fallback (got: ${entry}).`,
            );
          }
          break;
        }
        case "derived": {
          if (
            !entry ||
            !new RegExp(`^\\$\\{${name}:-`, "s").test(entry ?? "")
          ) {
            fail(
              `docker-compose.yml 'app' must forward ${name} as ` +
                `\`\${${name}:-…}\` — Compose derives a deployment-specific ` +
                "value (e.g. from EXAM_PORT) that the application cannot " +
                "know; the fallback content itself is Compose's to own.",
            );
          }
          break;
        }
        case "container": {
          if (!entry) {
            fail(
              `docker-compose.yml 'app' must set ${name} (container ` +
                "identity value).",
            );
            break;
          }
          if (entry.includes("${")) {
            fail(
              `docker-compose.yml 'app' ${name} is container identity — it ` +
                `must be a hardcoded literal (got: ${entry}).`,
            );
          }
          if (
            (name === "NODE_ENV" || name === "APP_MODE") &&
            entry !== "production"
          ) {
            fail(
              `docker-compose.yml 'app' ${name} must be 'production' in the ` +
                `operator stack (got: ${entry}).`,
            );
          }
          break;
        }
        case "dev-only": {
          if (entry) {
            fail(
              `docker-compose.yml 'app' must NOT set ${name} — it is a ` +
                "development-only variable and has no meaning inside the " +
                "production container.",
            );
          }
          break;
        }
        case "composed": {
          // DATABASE_URL is composed by Compose from the POSTGRES_*
          // variables — the single source of the deployed DB identity.
          if (!entry) {
            fail(
              "docker-compose.yml 'app' must compose DATABASE_URL from the " +
                "POSTGRES_* variables.",
            );
          } else if (!entry.includes("POSTGRES_")) {
            fail(
              `docker-compose.yml 'app' DATABASE_URL must interpolate the ` +
                `POSTGRES_* variables (got: ${entry}).`,
            );
          }
          break;
        }
        default:
          fail(`settings leaf ${name} has unknown binding '${leaf.binding}'.`);
      }
    }
  }
}
console.log("   Docker production binding check complete.");

// ── 3. Docker test profile: PUBLIC_WEB_ORIGIN follows the published port ────
console.log("3. Checking docker-compose.test.yml public web origin...");
{
  const composeTest = readFileSync(
    join(ROOT, "docker-compose.test.yml"),
    "utf-8",
  );
  if (
    !composeTest.includes(
      "PUBLIC_WEB_ORIGIN: http://localhost:${EXAM_PORT:-3000}",
    )
  ) {
    fail(
      "docker-compose.test.yml env missing PUBLIC_WEB_ORIGIN derived from " +
        "EXAM_PORT — the e2e browser reaches the app through the published " +
        "host port; identity one-time links must use that same origin.",
    );
  }
}
console.log("   Docker test origin check complete.");

// ── 4. CI profile: required env + e2e origin relation ───────────────────────
console.log("4. Checking CI workflow env contract...");
{
  const ciPath = join(ROOT, ".github/workflows/ci.yml");
  const ciContent = readFileSync(ciPath, "utf-8");

  for (const envVar of [
    "DATABASE_URL",
    "TEST_DATABASE_URL",
    "JWT_SECRET",
    "NODE_ENV",
    "APP_MODE",
    "DEPLOYMENT_MODE",
  ]) {
    if (!ciContent.includes(`${envVar}:`)) {
      fail(
        `.github/workflows/ci.yml verify job missing required env: ${envVar}`,
      );
    }
  }
  if (!ciContent.includes("APP_MODE: ci")) {
    fail(".github/workflows/ci.yml verify job should set APP_MODE: ci");
  }
  if (!ciContent.includes("TEST_DB_ISOLATION=worker-database")) {
    fail(
      ".github/workflows/ci.yml verify job missing " +
        "TEST_DB_ISOLATION=worker-database",
    );
  }

  // CI-internal relation only: the origin the server builds links from must
  // equal the origin the browser navigates. CI's VALUE may legitimately
  // differ from WSL/Docker — that is not checked here by design.
  const e2eBaseUrl = ciContent.match(/^\s+E2E_BASE_URL:\s*(.+?)\s*$/m);
  const ciOrigin = ciContent.match(/^\s+PUBLIC_WEB_ORIGIN:\s*(.+?)\s*$/m);
  if (!e2eBaseUrl) {
    fail(".github/workflows/ci.yml e2e job missing E2E_BASE_URL");
  } else if (!ciOrigin) {
    fail(
      ".github/workflows/ci.yml e2e job missing PUBLIC_WEB_ORIGIN — " +
        "identity one-time links would fall back to the dev Vite origin",
    );
  } else if (e2eBaseUrl[1] !== ciOrigin[1]) {
    fail(
      `ci.yml e2e PUBLIC_WEB_ORIGIN (${ciOrigin[1]}) must equal E2E_BASE_URL ` +
        `(${e2eBaseUrl[1]}) — the API serves the SPA on one origin`,
    );
  }
}
console.log("   CI env contract check complete.");

// ── 5. Local/WSL profile: launch_api binds PUBLIC_WEB_ORIGIN per port ───────
console.log("5. Checking WSL runner public web origin contract...");
{
  // PUBLIC_WEB_ORIGIN must be bound INSIDE launch_api, derived from that
  // process's port argument. A missing binding falls back to :5173; a fixed
  // origin (e.g. :3000) fixes serial mode while parallel shards keep pointing
  // at the wrong port (#365). Bounded textual extraction of the function
  // body — not a shell parser.
  const runWslLines = readFileSync(
    join(ROOT, "scripts/e2e/run-wsl.sh"),
    "utf-8",
  ).split("\n");
  const launchStart = runWslLines.findIndex((l) =>
    /^launch_api\(\) \{/.test(l),
  );
  if (launchStart === -1) {
    fail(
      "scripts/e2e/run-wsl.sh launch_api() not found — API launch seam " +
        "changed; re-bind PUBLIC_WEB_ORIGIN to the per-process API port",
    );
  } else {
    let launchEnd = launchStart;
    while (launchEnd < runWslLines.length && runWslLines[launchEnd] !== "}") {
      launchEnd++;
    }
    const originBindings = [];
    for (let i = launchStart; i <= launchEnd && i < runWslLines.length; i++) {
      if (/PUBLIC_WEB_ORIGIN\s*=/.test(runWslLines[i])) {
        originBindings.push({ n: i + 1, line: runWslLines[i] });
      }
    }
    if (originBindings.length === 0) {
      fail(
        "run-wsl.sh launch_api does not bind PUBLIC_WEB_ORIGIN — identity " +
          "one-time links fall back to the dev Vite origin (:5173), where " +
          "no E2E process listens",
      );
    }
    for (const b of originBindings) {
      if (
        !/PUBLIC_WEB_ORIGIN\s*=\s*"http:\/\/localhost:\$\{port\}"/.test(b.line)
      ) {
        fail(
          `run-wsl.sh:${b.n} launch_api PUBLIC_WEB_ORIGIN must bind this API ` +
            'process port ("http://localhost:${port}") — a fixed origin ' +
            "leaves parallel shards pointing at the wrong port",
        );
      }
    }
  }
}
console.log("   WSL origin check complete.");

// ── 6. Test discipline: production-guard tests use vi.stubEnv ───────────────
console.log("6. Checking production-guard test env isolation...");
{
  const testFiles = [];
  walk(
    ROOT,
    (full) => {
      if (/\.test\.(ts|tsx|js|jsx)$/.test(full)) testFiles.push(full);
    },
    (full) => {
      const base = full.split("/").pop();
      return base === "node_modules" || base === "dist";
    },
  );

  // Config-resolution tests legitimately set process.env directly — they
  // test the resolver's behavior itself.
  const DB_URL_EXEMPT =
    /databaseUrl|runtimeConfig|settings|loadRootEnv|testWorkerDatabase/i;

  for (const testPath of testFiles) {
    const rel = relative(ROOT, testPath);
    if (DB_URL_EXEMPT.test(rel)) continue;
    const content = readFileSync(testPath, "utf-8");

    // Only flag tests that actually MUTATE process.env with production
    // values. Tests that pass env via function arguments are properly
    // isolated and don't need vi.stubEnv.
    const mutatesProductionEnv =
      /process\.env\.(APP_MODE|NODE_ENV)\s*=\s*["']production["']/.test(
        content,
      ) ||
      (/process\.env\.JWT_SECRET\s*=\s*["']/.test(content) &&
        /process\.env\.(APP_MODE|NODE_ENV)\s*=/.test(content));

    if (mutatesProductionEnv) {
      if (!content.includes("vi.stubEnv")) {
        fail(
          `${rel}: production-guard test mutates process.env without ` +
            "vi.stubEnv — env isolation unreliable",
        );
      }
      if (!content.includes("vi.unstubAllEnvs")) {
        fail(
          `${rel}: production-guard test missing vi.unstubAllEnvs in ` +
            "afterEach",
        );
      }
    }
  }
}
console.log("   Production-guard test check complete.");

// ── Report ───────────────────────────────────────────────────────────────────
console.log("\n" + "=".repeat(60));
if (errors.length === 0) {
  console.log(
    `PASS: config contract upheld (${LEAVES.size} semantic leaves, ` +
      "4 topology profiles, 1 consumption seam).",
  );
  process.exit(0);
} else {
  console.error(`FAIL: config contract violations (${errors.length}):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract the `app` service's environment mapping from docker-compose.yml as
 * KEY → raw-value strings. Bounded textual scan: find the `  app:` service
 * header, then its `    environment:` block, then collect `      KEY: value`
 * entries until the indentation dedents. Structural YAML parsing is not
 * needed for flat scalar env entries.
 */
function extractAppEnvironment(composeText) {
  const lines = composeText.split(/\r?\n/);
  let i = 0;
  // Locate the top-level `  app:` service under `services:`.
  for (; i < lines.length; i++) {
    if (/^  app:\s*$/.test(lines[i])) break;
  }
  if (i === lines.length) return null;
  // Locate its `    environment:` block.
  for (; i < lines.length; i++) {
    if (/^  \S/.test(lines[i]) && !/^  app:\s*$/.test(lines[i])) break;
    if (/^    environment:\s*$/.test(lines[i])) {
      const entries = new Map();
      for (let j = i + 1; j < lines.length; j++) {
        const line = lines[j];
        if (/^\s*$/.test(line) || /^\s*#/.test(line)) continue;
        if (!/^      /.test(line)) return entries;
        const m = line.match(/^      ([A-Z0-9_]+):\s*(.*)$/);
        if (m) entries.set(m[1], m[2].trim());
      }
      return entries;
    }
  }
  return null;
}

/** Recursive walk with dir pruning; calls `file` on every regular file. */
function walk(dir, file, prune) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (prune && prune(full)) continue;
      walk(full, file, prune);
    } else if (entry.isFile()) {
      file(full);
    }
  }
}
