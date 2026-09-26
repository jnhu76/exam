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
 * Docker test origin, CI env, CI artifact identity, WSL port projection,
 * test env isolation, client-IP trust wiring).
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

// ── 3b. CI build artifact identity: run-scoped, not attempt-scoped ──────────
console.log("3b. Checking CI build artifact identity contract...");
{
  // The build artifact belongs to the workflow RUN, not the rerun ATTEMPT.
  // A partial rerun ("Re-run failed jobs") keeps the original attempt's
  // build artifact; a consumer looking up an attempt-scoped name would fail
  // with Artifact not found. A full rerun re-uploads the same run-scoped
  // name, which requires upload overwrite (artifact names are immutable
  // within a run). Cross-run provenance is preserved because artifact
  // lookup is scoped to the current github.run_id.
  const ciPath = join(ROOT, ".github/workflows/ci.yml");
  const ciContent = readFileSync(ciPath, "utf-8");

  const RUN_SCOPED = "build-outputs-${{ github.run_id }}";
  const ATTEMPT_SCOPED =
    "build-outputs-${{ github.run_id }}-${{ github.run_attempt }}";

  if (ciContent.includes(ATTEMPT_SCOPED)) {
    fail(
      "ci.yml build artifact name must be run-scoped — an attempt-scoped " +
        `name is not downloadable by partial-rerun consumers: ${ATTEMPT_SCOPED}`,
    );
  }

  // Every producer/consumer reference must use the exact run-scoped name;
  // a mismatch would silently change whose build a consumer tests against.
  const artifactNames = [
    ...ciContent.matchAll(/^\s*name:\s*(build-outputs.*?)\s*$/gm),
  ].map((match) => match[1]);
  if (artifactNames.length < 2) {
    fail(
      "ci.yml must declare the build-outputs artifact producer and at " +
        "least one consumer",
    );
  }
  for (const name of artifactNames) {
    if (name !== RUN_SCOPED) {
      fail(
        `ci.yml build-outputs artifact name must be exactly "${RUN_SCOPED}" ` +
          `(found "${name}") — producer/consumer identity must match`,
      );
    }
  }

  // Without overwrite, the full-rerun upload fails on the immutable
  // same-run artifact name.
  const uploadStart = ciContent.indexOf("name: Upload build outputs");
  if (uploadStart === -1) {
    fail("ci.yml must contain the 'Upload build outputs' step");
  } else {
    const uploadBlock = ciContent.slice(
      uploadStart,
      ciContent.indexOf("- name:", uploadStart),
    );
    if (!uploadBlock.includes("actions/upload-artifact@")) {
      fail("'Upload build outputs' step must use actions/upload-artifact");
    }
    if (!uploadBlock.includes("overwrite: true")) {
      fail(
        "'Upload build outputs' must set overwrite: true so a full rerun " +
          "can replace the same-run run-scoped artifact",
      );
    }
  }

  // download-artifact resolves within the current run by default; an
  // explicit run-id override would silently widen whose build a consumer
  // tests against. Like the name checks above, this is a bounded textual
  // check: quoted/folded scalar forms of the key are not recognized.
  if (/^\s*run-id:/m.test(ciContent)) {
    fail(
      "ci.yml must not override the download-artifact run-id — build " +
        "consumers resolve the artifact within the current workflow run",
    );
  }
}
console.log("   CI artifact identity check complete.");

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
