#!/usr/bin/env node
/**
 * Config contract gate: profile-specific binding contracts over the ONE
 * application semantic settings model.
 *
 * This script is NOT a semantic authority. Membership, defaults,
 * requiredness, and binding classes are READ from
 * apps/api/src/config/settings.ts (imported directly — Node >=23.6 strips
 * erasable type syntax, and the module is dependency-free by design, so
 * this gate runs in a fresh checkout before any build). What this gate owns
 * is the per-topology binding relations; each section below states its own
 * relation and failure mode (consumption seam, Docker production bindings,
 * Docker test origin, CI env, CI zero-artifact build topology, WSL port
 * projection, test env isolation, client-IP trust wiring).
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

// ── 2. Docker production profile: compose binds every leaf by supply class ──
// This section is the ONLY place Compose/Docker constructs are named. The
// semantic model (settings.ts) declares topology-neutral supply classes; this
// is the per-topology mapping: which supply class → which Compose form.
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
        case "fixed": {
          if (!entry) {
            fail(
              `docker-compose.yml 'app' must set ${name} (fixed identity ` +
                "value).",
            );
            break;
          }
          if (entry.includes("${")) {
            fail(
              `docker-compose.yml 'app' ${name} is a fixed identity value — ` +
                `it must be a hardcoded literal (got: ${entry}).`,
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

    // Reverse closure: every key the production container receives must be
    // owned by a semantic leaf. A key with no owner is unaccounted config
    // surface — the runtime can never read it, so forwarding it is either a
    // ghost of a deleted setting or a typo (#570). TZ is the container
    // timezone (not an application setting) and is the sole allowed extra.
    const NON_SEMANTIC_ENV = new Set(["TZ"]);
    for (const name of appEnv.keys()) {
      if (!LEAVES.has(name) && !NON_SEMANTIC_ENV.has(name)) {
        fail(
          `docker-compose.yml 'app' sets ${name}, but no semantic setting ` +
            "owns it — the runtime can never read it. Remove the forward, or " +
            "define the leaf in settings.ts first if this is a new setting.",
        );
      }
    }
  }
}
console.log("   Docker production binding check complete.");

// ── 3. CI profile: required env + e2e origin relation ───────────────────────
console.log("3. Checking CI workflow env contract...");
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

// ── 3b. CI zero-artifact build topology ─────────────────────────────────────
console.log("3b. Checking CI zero-artifact build contract...");
{
  // CI must not depend on GitHub Actions artifacts AT ALL: on this private
  // repo the artifact storage quota is a hard external limit that once
  // blocked the entire pipeline (every upload is a step back toward that
  // outage). Build state is shared only through the .turbo GitHub cache
  // (task-hash validated) or rebuilt job-locally.
  const ciPath = join(ROOT, ".github/workflows/ci.yml");
  const ciContent = readFileSync(ciPath, "utf-8");

  for (const action of [
    "actions/upload-artifact",
    "actions/download-artifact",
  ]) {
    if (ciContent.includes(action)) {
      fail(
        `ci.yml must not use ${action} — CI is zero-artifact by contract ` +
          "(artifact storage quota is a hard limit on this repo); share " +
          "build state through the .turbo cache or job-local builds only",
      );
    }
  }

  // A job that reads compiled workspace output (an apps/*/dist or
  // packages/*/dist path, or a `node dist/…` entrypoint) must produce it in
  // its own execution context via the standard Turbo build — with no
  // artifact to download, a dist-reading job without a build tests nothing
  // (or stale leftovers), on first runs and partial reruns alike. Bounded
  // job-block scan; comment lines are excluded because a dist reference in
  // a comment is not a dependency. This anchors the ACTUAL consumption
  // seams, not job names or step order.
  for (const [jobId, body] of ciJobBodies(ciContent)) {
    const codeLines = body
      .split(/\r?\n/)
      .filter((line) => !/^\s*#/.test(line))
      .join("\n");
    const readsWorkspaceDist =
      /(?:apps|packages)\/[\w.*-]+\/dist\b/.test(codeLines) ||
      /\bnode\s+dist\//.test(codeLines);
    if (readsWorkspaceDist && !/(?:pnpm|turbo)\s+build\b/.test(codeLines)) {
      fail(
        `ci.yml job '${jobId}' reads workspace dist output but runs no ` +
          "build (pnpm/turbo build) in its own execution context — with no " +
          "artifact to download, dist must be produced by the job itself",
      );
    }
  }

  // The repo's own test entry points must keep compiling before testing:
  // the filtered per-package CI commands rely on Turbo's declared ^build
  // dependency, and dropping it would let tests run against stale or
  // absent builds without anyone noticing at the graph level.
  const turboTasks = JSON.parse(
    readFileSync(join(ROOT, "turbo.json"), "utf-8"),
  ).tasks;
  for (const task of ["test", "coverage"]) {
    const dependsOn = turboTasks[task]?.dependsOn ?? [];
    if (!dependsOn.includes("^build")) {
      fail(
        `turbo.json task '${task}' must keep dependsOn '^build' — removing ` +
          "it bypasses compilation for the repo's own test entry points",
      );
    }
  }

  // The production module-resolution oracle stays a CI gate: the plain-Node
  // polarity check over the built workspace (#794) is the dist-side
  // complement of the Vitest source-resolution fail-closed design.
  if (!ciContent.includes("pnpm lint:prod-resolution")) {
    fail(
      "ci.yml must keep running pnpm lint:prod-resolution — the production " +
        "module-resolution oracle must remain a CI gate",
    );
  }
}
console.log("   CI zero-artifact build contract check complete.");

// ── 4. Local/WSL profile: launch_api owns the per-shard port projection ────
console.log("4. Checking E2E runner port projection contract...");
{
  // Every port authority of a WSL E2E API process must be bound INSIDE
  // launch_api to that process's port argument, so the runner-selected port
  // is the single source for: bind port, health probe target, and identity
  // one-time links. A missing PUBLIC_WEB_ORIGIN binding falls back to :5173;
  // a fixed origin (e.g. :3000) fixes serial mode while parallel shards keep
  // pointing at the wrong port (#365). An unprojected APP_PORT is worse: e2e
  // mode resolves the bind as APP_PORT ?? DEV_API_PORT, so a leftover
  // developer `.env` APP_PORT (or stray shell export) binds every shard to
  // the same port — EADDRINUSE / health-probe misalignment (#565). Bounded
  // textual extraction of the function body — not a shell parser.
  const runWslLines = readFileSync(
    join(ROOT, "scripts/e2e/run.sh"),
    "utf-8",
  ).split("\n");
  const launchStart = runWslLines.findIndex((l) =>
    /^launch_api\(\) \{/.test(l),
  );
  if (launchStart === -1) {
    fail(
      "scripts/e2e/run.sh launch_api() not found — API launch seam " +
        "changed; re-bind the per-process port to APP_PORT, DEV_API_PORT and " +
        "PUBLIC_WEB_ORIGIN",
    );
  } else {
    let launchEnd = launchStart;
    while (launchEnd < runWslLines.length && runWslLines[launchEnd] !== "}") {
      launchEnd++;
    }
    const launchBody = runWslLines.slice(launchStart, launchEnd + 1).join("\n");

    // The runner-selected port must be the ONE port authority for the whole
    // process: bind (APP_PORT ?? DEV_API_PORT in e2e mode) == health target
    // == PUBLIC_WEB_ORIGIN.
    const requiredBindings = [
      {
        re: /\bAPP_PORT\s*=\s*"\$\{?port\}?"/,
        why:
          "the e2e bind-port owner resolves APP_PORT ?? DEV_API_PORT — an " +
          "unprojected APP_PORT lets a developer .env / stray shell export " +
          "own the shard bind (#565)",
      },
      {
        re: /\bDEV_API_PORT\s*=\s*"\$\{?port\}?"/,
        why:
          "DEV_API_PORT is the fallback bind authority; leaving it " +
          "runner-unbound lets inherited values pick the port",
      },
      {
        re: /PUBLIC_WEB_ORIGIN\s*=\s*"http:\/\/localhost:\$\{?port\}?"/,
        why:
          "identity one-time links fall back to the dev Vite origin (:5173), " +
          "where no E2E process listens",
      },
    ];
    for (const { re, why } of requiredBindings) {
      if (!re.test(launchBody)) {
        fail(
          "run.sh launch_api does not bind the runner-selected shard " +
            `port to every port authority: ${why} (required inside ` +
            'launch_api: APP_PORT="$port", DEV_API_PORT="$port", ' +
            'PUBLIC_WEB_ORIGIN="http://localhost:${port}").',
        );
      }
    }
  }
}
console.log("   E2E runner port projection check complete.");

// ── 5. Test discipline: production-guard tests use vi.stubEnv ───────────────
console.log("5. Checking production-guard test env isolation...");
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

// ── 6. Client-IP trust wiring: server.ts derives trustProxy from config ─────
// #546: the ONE place client-IP trust is decided is the Fastify constructor
// in server.ts, and the option must come from resolveTrustProxyOption — the
// same function the topology tests derive it through. A regression to
// `trustProxy: true` (trust every hop) or a hand-built array would either
// make every DIRECT_LAN deployment spoofable or fork the derivation the
// tests pin. Bounded textual check on the single construction site.
{
  const serverPath = join("apps/api/src/server.ts");
  const content = readFileSync(serverPath, "utf8");
  if (!content.includes("resolveTrustProxyOption(getRuntimeConfig())")) {
    fail(
      `${serverPath}: the Fastify trustProxy option must be derived through ` +
        "resolveTrustProxyOption(getRuntimeConfig()) — the shared authority " +
        "the topology tests use (#546)",
    );
  }
  if (/trustProxy:(?!\s*resolveTrustProxyOption\b)/.test(content)) {
    fail(
      `${serverPath}: trustProxy must not be hand-built; derive it via ` +
        "resolveTrustProxyOption (#546)",
    );
  }
}
console.log("   Client-IP trust wiring check complete.");

// ── Report ───────────────────────────────────────────────────────────────────
console.log("\n" + "=".repeat(60));
if (errors.length === 0) {
  console.log(
    `PASS: config contract upheld (${LEAVES.size} semantic leaves, ` +
      "3 topology profiles, 1 consumption seam).",
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

/**
 * Split ci.yml into [jobId, bodyText] pairs: job keys are the 2-space-indented
 * `key:` lines that follow the top-level `jobs:` header (everything deeper —
 * steps, services, matrix entries — is body text). Bounded textual scan, like
 * the other topology sections; not a YAML parser.
 */
function ciJobBodies(ciContent) {
  const lines = ciContent.split(/\r?\n/);
  const jobsStart = lines.findIndex((l) => /^jobs:\s*$/.test(l));
  if (jobsStart === -1) return [];
  const jobs = [];
  for (let i = jobsStart + 1; i < lines.length; i++) {
    const m = lines[i].match(/^ {2}([\w.-]+):\s*$/);
    if (m) jobs.push([m[1], []]);
    if (jobs.length > 0) jobs[jobs.length - 1][1].push(lines[i]);
  }
  return jobs.map(([id, bodyLines]) => [id, bodyLines.join("\n")]);
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
