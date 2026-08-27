#!/usr/bin/env node
/**
 * Regression guard: verify the production Docker Compose topology deploys
 * every long-running process the implemented MVP requires.
 *
 * Authority: docs/adr/ADR-011-notification-and-email-delivery.md,
 * docs/adr/ADR-001-redis.md, and the P6 MVP boundary
 * (docs/audits/P6-MVP-READY-REALITY-AUDIT.md). The MVP cannot be
 * release-ready if `docker compose up` starts the API (and its in-process
 * scanners) and PostgreSQL but never starts the Email delivery worker,
 * because the worker is the only consumer of the PostgreSQL
 * `email_outbox` table that `result_published` notifications write into
 * (ADR-011).
 *
 * The scanner is NOT a separate process — it runs in-process inside the
 * API server (see apps/api/src/plugins/deadlineScanner.ts and
 * heartbeat.ts), so it is covered by the `app` service healthcheck.
 *
 * This guard fails fast if:
 *   - the production compose file loses the `app`, `db`, or `email-worker`
 *     service;
 *   - the production compose file accepts a default database password
 *     (POSTGRES_PASSWORD must use `${...:?...}` required-expansion on db,
 *      app, and email-worker) — P6-007;
 *   - the worker service is missing the required DB/JWT/PUBLIC_WEB_ORIGIN
 *     /CORS_ORIGIN env that the worker entrypoint resolves;
 *   - the worker is allowed to start before app health (it must depend on
 *     app: service_healthy so its self-migrate call serializes after the
 *     app's migrate call — the drizzle journal tracks state, it does NOT
 *     lock concurrent runners) — P6-009;
 *   - the worker has no restart policy;
 *   - the `redis` service is NOT behind a profile (it must be optional) —
 *     P6-010;
 *   - the `redis` service accepts an unauthenticated production instance
 *     when the profile IS enabled: REDIS_PASSWORD must stay OPTIONAL at
 *     Compose expansion (empty default — a bare `docker compose up` needs
 *     no Redis configuration), the redis command must carry a
 *     container-startup guard that fails the container without a non-empty
 *     REDIS_PASSWORD, the server must run with `--requirepass`, and the
 *     healthcheck must authenticate — P7 review P1-1 / ADR-001 security
 *     considerations.
 *   - there is exactly ONE production/operator Docker Compose entry point:
 *     `docker-compose.yml`. No production PITR/backup/restore/production
 *     variant Compose file may exist. Optional PostgreSQL capabilities such
 *     as PITR are database configuration (postgres-enable-pitr.sh), not an
 *     alternate Docker topology. Development/test Compose files
 *     (docker-compose.dev.yml, docker-compose.test*.yml) are development
 *     infrastructure and are explicitly ALLOWED.
 *   - `docker-compose.build.yml` is ALLOWED as the single source-build MODE
 *     override (it cannot run standalone — it defines no db service and
 *     must only carry build/image/pull_policy keys for app and
 *     email-worker). It is a mode of the one entry point, not a second
 *     production topology; the structural rules are in
 *     assertBuildVariant().
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
const composePath = join(ROOT, "docker-compose.yml");

const errors = [];

let composeText;
try {
  composeText = readFileSync(composePath, "utf-8");
} catch {
  console.error("FAIL: docker-compose.yml is missing from repository root.");
  process.exit(1);
}

// ONE production/operator Compose entry point (docker-compose.yml). No
// production PITR/backup/restore/production variant Compose file may exist.
// dev/test Compose files are allowed (development infrastructure), and
// docker-compose.build.yml is allowed as the single source-build MODE
// override (build/image/pull_policy only — see assertBuildVariant). The
// stable rule: optional operational capabilities (PITR, backup, restore)
// do NOT get another production topology — they are database
// configuration (scripts/backup/postgres-enable-pitr.sh — ALTER SYSTEM),
// not an alternate Compose topology. Development/test files match
// docker-compose.dev.yml or docker-compose.test*.yml without allowlist
// edits; anything else at repo root is flagged for explicit justification.
const FORBIDDEN_PROD_VARIANT_RE =
  /docker-compose\.(pitr|backup|restore|production)\.yml$/i;
const ALLOWED_TEST_VARIANT_RE = /^docker-compose\.test[^/]*\.ya?ml$/i;
const ALLOWED_DEV_VARIANT = "docker-compose.dev.yml";
const ALLOWED_BUILD_VARIANT = "docker-compose.build.yml";
try {
  const repoFiles = readdirSync(ROOT);
  for (const f of repoFiles) {
    if (!/^docker-compose\b.*\.ya?ml$/i.test(f)) continue;
    if (f === "docker-compose.yml" || f === ALLOWED_DEV_VARIANT) continue;
    if (f === ALLOWED_BUILD_VARIANT) {
      // Structurally checked below; here it just bypasses the
      // unrecognized-variant error.
    } else if (ALLOWED_TEST_VARIANT_RE.test(f)) {
      continue;
    } else if (FORBIDDEN_PROD_VARIANT_RE.test(f)) {
      errors.push(
        `'${f}' is a forbidden production Compose variant: there must be ` +
          "exactly ONE production/operator Compose entry point " +
          "(docker-compose.yml). Optional PostgreSQL capabilities such as " +
          "PITR are database configuration (scripts/backup/" +
          "postgres-enable-pitr.sh — ALTER SYSTEM), not an alternate Docker " +
          "topology. Development/test Compose files are allowed.",
      );
    } else {
      // An unknown docker-compose*.yml at repo root is suspicious — flag it
      // so a new production variant cannot slip in under an unrecognized name.
      errors.push(
        `'${f}' is an unrecognized docker-compose variant at repo root. ` +
          "If it is development/test infrastructure, name it " +
          "docker-compose.dev.yml or docker-compose.test*.yml. Production " +
          "capabilities must not introduce a second operator Compose " +
          "entry point.",
      );
    }
  }
} catch {
  // If the root cannot be read, the compose read above already failed.
}

// docker-compose.build.yml structural rules (see header). It is a pure
// build-mode override of the ONE entry point: only app/email-worker, only
// build/image/pull_policy keys — no ports, environment, volumes, command,
// or entrypoint (topology belongs to docker-compose.yml alone).
try {
  assertBuildVariant(readFileSync(join(ROOT, ALLOWED_BUILD_VARIANT), "utf-8"));
} catch (err) {
  if (err && err.code === "ENOENT") {
    errors.push(
      `${ALLOWED_BUILD_VARIANT} is missing: the source-build verification ` +
        "mode (contributors / PR acceptance) is a required surface.",
    );
  } else {
    throw err;
  }
}

// The deployment verification suite lives under tests/deployment/ and must
// not hard-code developer-specific checkout paths. It must derive repo-root
// from the script location so the tests run from any clone directory
// (including relocated worktrees). A MISSING tests/deployment/ directory is
// a contract error (the deployment recovery suite is a required surface);
// unexpected filesystem failures propagate instead of being swallowed.
const deploymentTestsDir = join(ROOT, "tests", "deployment");
try {
  const testFiles = readdirSync(deploymentTestsDir).filter((f) =>
    f.endsWith(".sh"),
  );
  const developerPathPatterns = [/\/home\/hoo\//, /\/Users\/\S+/];
  for (const file of testFiles) {
    const text = readFileSync(join(deploymentTestsDir, file), "utf-8");
    for (const pattern of developerPathPatterns) {
      if (pattern.test(text)) {
        errors.push(
          `'tests/deployment/${file}' contains a developer-specific absolute ` +
            `path matching ${pattern.toString()}. Deployment tests must derive ` +
            "paths from their own location so they run from any checkout.",
        );
        break;
      }
    }
  }
} catch (err) {
  if (err && err.code === "ENOENT") {
    errors.push(
      "tests/deployment/ is missing: the deployment verification suite " +
        "(compose-smoke, launchpad-bootstrap, persistence-and-cold-restore, " +
        "logical-backup-restore, pitr) is a required repository surface.",
    );
  } else {
    throw err;
  }
}

// Minimal structural parse — we only need top-level service presence and
// selected scalar values. Avoids a yaml dependency in the contract gate.
const servicesBlock = extractTopLevelBlock(composeText, "services");
if (!servicesBlock) {
  errors.push("docker-compose.yml has no top-level 'services:' mapping.");
} else {
  const serviceNames = topLevelKeys(servicesBlock);

  // P6-010: Redis is OPTIONAL (ADR-001). The required MVP topology is
  // app + db + email-worker. The `redis` service may be present (as an
  // opt-in profile) but is NOT required.
  for (const required of ["app", "db", "email-worker"]) {
    if (!serviceNames.includes(required)) {
      errors.push(
        `docker-compose.yml is missing required service '${required}'.`,
      );
    }
  }

  // P6-010: if a `redis` service is present, it MUST be behind a profile
  // so a bare `docker compose up` does not start it and the API does NOT
  // depend on its health.
  if (serviceNames.includes("redis")) {
    const redisBlock = extractServiceBlock(servicesBlock, "redis");
    if (redisBlock) {
      const redisBlockNoComments = redisBlock
        .split(/\r?\n/)
        .filter((l) => !/^\s*#/.test(l))
        .join("\n");
      if (!/^\s*profiles:\s*\S/im.test(redisBlockNoComments)) {
        errors.push(
          "'redis' service must declare a 'profiles:' attribute so a bare " +
            "'docker compose up' does not start it (P6-010: Redis is " +
            "optional in the implemented MVP).",
        );
      }
      // P7 review P1-1: when the profile IS enabled, production Redis owns
      // the shared rate-limit state, so it must never run open — but the
      // password guard lives at container startup, keeping Redis optional
      // at Compose parse time (P7 review P1).
      assertRedisAuth(redisBlock);
    }
  }

  // P6-007: the `app` service must NOT accept a default database password.
  // The DATABASE_URL line must reference POSTGRES_PASSWORD via required
  // Compose expansion (`${POSTGRES_PASSWORD:?...}`), not a fallback.
  if (serviceNames.includes("app")) {
    const appBlock = extractServiceBlock(servicesBlock, "app");
    if (appBlock) {
      assertRequiredPostgresPassword(appBlock, "app");
      // #321 two-path split: the operator path must consume the prebuilt
      // image via a REQUIRED EXAM_IMAGE pin (generate-env.mjs derives it
      // from .release-version — the single version authority), and the
      // base file must NOT carry a build key: contributors / PR acceptance
      // get source authority exclusively through docker-compose.build.yml
      // (pull_policy: build). A hardcoded tag here would drift from the
      // release version; a base build key would blur the two paths.
      const appNoComments = appBlock
        .split(/\r?\n/)
        .filter((l) => !/^\s*#/.test(l))
        .join("\n");
      if (
        !/^\s*image:\s*\$\{EXAM_IMAGE:\?EXAM_IMAGE is required \(node scripts\/generate-env\.mjs\)\}\s*$/im.test(
          appNoComments,
        )
      ) {
        errors.push(
          "'app' service must pin " +
            "'image: ${EXAM_IMAGE:?EXAM_IMAGE is required (node scripts/generate-env.mjs)}' " +
            "(the operator prebuilt-image pin derived from .release-version; " +
            "source builds belong to docker-compose.build.yml) — #321.",
        );
      }
      if (/^\s*build:\s*\S/im.test(appNoComments)) {
        errors.push(
          "'app' service must NOT carry a build key in docker-compose.yml: " +
            "the operator path consumes the prebuilt EXAM_IMAGE pin, and the " +
            "source-build path is docker-compose.build.yml (pull_policy: build).",
        );
      }
      // The app must NOT depend on redis health (Redis is optional).
      assertNoRedisDependency(appBlock, "app");
      // The Launchpad first-install setup token
      // MUST be forwarded to the app container (Compose uses .env for
      // interpolation only; without an environment: entry the token never
      // reaches the container and the browser first-install UX is inert).
      // The empty default keeps launchpad disabled for a bare
      // `docker compose up` (not fail-fast at boot).
      const appEnvBlock =
        extractServiceBlock(appBlock, "environment") ?? appBlock;
      const appEnvNoComments = appEnvBlock
        .split(/\r?\n/)
        .filter((l) => !/^\s*#/.test(l))
        .join("\n");
      if (
        !/^\s*LAUNCHPAD_SETUP_TOKEN:\s*\$\{LAUNCHPAD_SETUP_TOKEN:-\}\s*$/m.test(
          appEnvNoComments,
        )
      ) {
        errors.push(
          "'app' service must forward LAUNCHPAD_SETUP_TOKEN via " +
            "'LAUNCHPAD_SETUP_TOKEN: ${LAUNCHPAD_SETUP_TOKEN:-}' " +
            "(Compose uses .env for interpolation " +
            "only; without this entry the documented browser first-install " +
            "UX is inert — the token never reaches the container).",
        );
      }
    }
  }

  // P6-007: the `db` service must require POSTGRES_PASSWORD too.
  if (serviceNames.includes("db")) {
    const dbBlock = extractServiceBlock(servicesBlock, "db");
    if (dbBlock) {
      assertRequiredPostgresPasswordDb(dbBlock);
    }
  }

  if (serviceNames.includes("email-worker")) {
    const workerBlock = extractServiceBlock(servicesBlock, "email-worker");
    if (!workerBlock) {
      errors.push("'email-worker' service block could not be parsed.");
    } else {
      // P6-007: the worker's DATABASE_URL must require POSTGRES_PASSWORD.
      assertRequiredPostgresPassword(workerBlock, "email-worker");

      // #321: same prebuilt-image pin as app (see the app service note).
      const workerNoComments = workerBlock
        .split(/\r?\n/)
        .filter((l) => !/^\s*#/.test(l))
        .join("\n");
      if (
        !/^\s*image:\s*\$\{EXAM_IMAGE:\?EXAM_IMAGE is required \(node scripts\/generate-env\.mjs\)\}\s*$/im.test(
          workerNoComments,
        )
      ) {
        errors.push(
          "'email-worker' service must pin the same required EXAM_IMAGE as " +
            "'app' — one image authority, two services.",
        );
      }

      // The image ENTRYPOINT is docker-entrypoint.sh which hard-codes
      // `exec node dist/server.js`. The service MUST override the
      // entrypoint so the command actually runs the worker (otherwise
      // `docker compose up email-worker` silently starts the API server).
      // The service key is indented under `services:`, so match with
      // leading whitespace.
      if (!/^\s*entrypoint:\s*\S/im.test(workerBlock)) {
        errors.push(
          "'email-worker' service must override entrypoint (the image " +
            "ENTRYPOINT is docker-entrypoint.sh which hard-codes the API " +
            "server; without an entrypoint override, command: is ignored " +
            "and the worker never runs).",
        );
      }

      // Worker must run the production worker entrypoint, not the dev tsx
      // path and not the API server. Match either command: or entrypoint:
      // lines (the worker entrypoint is the source of truth).
      if (!/dist\/workers\/emailDeliveryWorker\.js/.test(workerBlock)) {
        errors.push(
          "'email-worker' command must run dist/workers/emailDeliveryWorker.js.",
        );
      }

      // Required env carried over from the worker entrypoint
      // (apps/api/src/workers/emailDeliveryWorker.ts → getRuntimeConfig).
      // Every var here is fail-fast at boot in APP_MODE=production:
      //   DATABASE_URL     — db connection
      //   JWT_SECRET       — resolveJwtSecret throws if unset in prod
      //   PUBLIC_WEB_ORIGIN — resolvePublicWebOrigin throws if unset
      //   CORS_ORIGIN      — resolveCorsOrigin throws if unset (the worker
      //                      never serves CORS-protected responses, but the
      //                      shared config loader enforces it)
      //   APP_MODE         — production mode gates the fail-fast behavior
      //                      above; a missing APP_MODE falls back to dev
      //                      and silently disables the safety checks.
      const requiredEnv = [
        "DATABASE_URL",
        "JWT_SECRET",
        "PUBLIC_WEB_ORIGIN",
        "CORS_ORIGIN",
        "APP_MODE",
      ];
      // P6-CORR1 hardening (CodeRabbit review): scope the env-var check to
      // the actual `environment:` child block of the email-worker service,
      // so a sibling key or a future x-* extension mapping cannot satisfy
      // the check by containing a matching key name. Falls back to the
      // whole worker block if `environment:` cannot be parsed (defensive).
      const envBlock =
        extractServiceBlock(workerBlock, "environment") ?? workerBlock;
      // Strip comment lines before substring matching so a comment like
      // `# CORS_ORIGIN:` cannot satisfy the check.
      const envBlockNoComments = envBlock
        .split(/\r?\n/)
        .filter((l) => !/^\s*#/.test(l))
        .join("\n");
      for (const key of requiredEnv) {
        if (
          !new RegExp(`^\\s*${escapeRegExp(key)}:\\s*\\S`, "m").test(
            envBlockNoComments,
          )
        ) {
          errors.push(
            `'email-worker' service must define environment variable '${key}' ` +
              `(fail-fast at worker boot in production).`,
          );
        }
      }
      // APP_MODE must specifically be production — the safety checks above
      // only fire in production mode.
      if (!/APP_MODE:\s*production\b/.test(envBlockNoComments)) {
        errors.push(
          "'email-worker' APP_MODE must be 'production' (otherwise the " +
            "config loader's production fail-fast checks are silently " +
            "disabled).",
        );
      }

      // P6-009: serialize migrations. The worker self-migrates at startup
      // and the drizzle migration journal tracks state but does NOT lock
      // concurrent migration runners. The worker MUST depend on
      // app: service_healthy so its migrate call occurs strictly after the
      // app container's migrate call. depending on db alone would let the
      // worker race the app's migrate call.
      const dependsMatch = workerBlock.match(
        /depends_on:\s*\n([\s\S]*?)(?=\n\S|\n\s{0,1}\S|\n$|$)/,
      );
      if (!dependsMatch) {
        errors.push(
          "'email-worker' service must declare depends_on with " +
            "app: service_healthy (P6-009: serialize migrations).",
        );
      } else {
        const depBlock = dependsMatch[1];
        const hasApp =
          /^\s{2,}app:\s*\n\s{4,}condition:\s*service_healthy\s*$/m.test(
            "depends_on:\n" + depBlock,
          );
        if (!hasApp) {
          errors.push(
            "'email-worker' depends_on must specifically require " +
              "'app: condition: service_healthy' (P6-009: the worker's " +
              "startup migrate call must serialize after the app's " +
              "migrate call; depending on db alone races the app migrate).",
          );
        }
        // The worker must NOT depend on db directly (it depends on app,
        // which transitively depends on db). A direct db dependency would
        // weaken the serialization guarantee.
        const hasDb =
          /^\s{2,}db:\s*\n\s{4,}condition:\s*service_healthy\s*$/m.test(
            "depends_on:\n" + depBlock,
          );
        if (hasDb) {
          errors.push(
            "'email-worker' depends_on must NOT name db directly (P6-009: " +
              "it must depend on app: service_healthy so the worker's " +
              "migrate call serializes after the app's migrate call).",
          );
        }
      }

      // Worker must have a non-trivial restart policy — it is a required
      // long-running process. `restart: "no"` is a valid Compose value
      // but defeats the intent; pin to the allowed set.
      if (
        !/restart:\s*(unless-stopped|always|on-failure(:\d+)?)/.test(
          workerBlock,
        )
      ) {
        errors.push(
          "'email-worker' service must define a restart policy of " +
            'unless-stopped, always, or on-failure (restart: "no" or a ' +
            "missing policy makes the worker a one-shot).",
        );
      }
    }
  }
}

// ── #329: operator lifecycle doc drift guard ─────────────────────────────
// upgrade-and-uninstall.md is the canonical operator lifecycle contract.
// This section fails when the OPERATOR commands in the doc drift from the
// real invocation contract (env-file seam, compose pull, EXAM_IMAGE /
// EXAM_DATA_ROOT keys) — a doc that teaches a dead command is a release
// defect even though no test executes it.
{
  const lifecycleDoc = join(
    ROOT,
    "docs",
    "deployment",
    "upgrade-and-uninstall.md",
  );
  if (!existsSync(lifecycleDoc)) {
    errors.push(
      "docs/deployment/upgrade-and-uninstall.md is missing (operator " +
        "upgrade/uninstall lifecycle authority — #329).",
    );
  } else {
    const doc = readFileSync(lifecycleDoc, "utf-8");
    const mustContain = [
      "--env-file .env.deploy",
      "docker compose --env-file .env.deploy pull",
      "EXAM_IMAGE",
      "EXAM_DATA_ROOT",
      "docker compose --env-file .env.deploy down",
    ];
    for (const token of mustContain) {
      if (!doc.includes(token)) {
        errors.push(
          "docs/deployment/upgrade-and-uninstall.md no longer contains " +
            `'${token}' — the documented operator contract drifted from ` +
            "the real invocation.",
        );
      }
    }
    // The dead operator form must never come back in the lifecycle guide
    // (the operator consumes the prebuilt EXAM_IMAGE pin — #321; source
    // builds belong to the contributor override).
    if (
      /docker compose(?! --env-file \.env\.deploy)[^\n]*\bup( -d)? --build/.test(
        doc,
      )
    ) {
      errors.push(
        "upgrade-and-uninstall.md teaches 'up --build' for the operator " +
          "path — the operator consumes the prebuilt EXAM_IMAGE pin " +
          "(#321); source builds belong to the contributor override.",
      );
    }
  }
}

if (errors.length > 0) {
  console.error("FAIL: Deployment topology contract regression:");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log("PASS: docker-compose.yml deploys the required MVP topology.");

// ── Helpers ───────────────────────────────────────────────────────────

/**
 * Extract the indented block for a YAML key, allowing it to be nested.
 * Returns the raw text of the block (key line + nested lines), or null.
 *
 * `key` may be top-level (column 0) or nested under a known parent block
 * (in which case the caller passes the parent block text and the key is
 * matched at any leading indent followed by `:` and end-of-line).
 *
 * WARNING: this helper matches the FIRST `key:` line at any indent. When
 * extracting a service block from inside `services:`, prefer
 * {@link extractServiceBlock}, which matches the service key at the
 * minimum indent and is not fooled by same-named child keys such as a
 * `db:` entry inside another service's `depends_on:`.
 *
 * This intentionally stays structural — it does not validate YAML semantically.
 * The contract gate only needs substring assertions on the block text.
 */
function extractTopLevelBlock(text, key) {
  const lines = text.split(/\r?\n/);
  let keyLineIdx = -1;
  const keyRe = new RegExp(`^(\\s*)${escapeRegExp(key)}:\\s*$`);
  for (let i = 0; i < lines.length; i++) {
    if (keyRe.test(lines[i])) {
      keyLineIdx = i;
      break;
    }
  }
  if (keyLineIdx === -1) return null;

  // Determine the indent of the key line itself (could be 0 for top-level).
  const keyLine = lines[keyLineIdx];
  const keyIndentMatch = keyLine.match(/^(\s*)/);
  const keyIndentLen = keyIndentMatch ? keyIndentMatch[1].length : 0;

  // Determine the indent of children: the next non-blank, non-comment line's
  // leading whitespace establishes the block indent.
  let childIndent = null;
  for (let j = keyLineIdx + 1; j < lines.length; j++) {
    const line = lines[j];
    if (/^\s*$/.test(line)) continue;
    if (/^\s*#/.test(line)) continue;
    const match = line.match(/^(\s+)/);
    childIndent = match ? match[1] : "";
    break;
  }
  if (childIndent === null || childIndent === "") {
    // No children or scalar value; return the key line only.
    return lines[keyLineIdx];
  }

  const block = [lines[keyLineIdx]];
  for (let j = keyLineIdx + 1; j < lines.length; j++) {
    const line = lines[j];
    if (/^\s*$/.test(line)) {
      block.push(line);
      continue;
    }
    const match = line.match(/^(\s*)/);
    const indent = match ? match[1] : "";
    // Same or deeper indent than the first child → still inside the block.
    if (indent.length >= childIndent.length) {
      block.push(line);
    } else {
      break;
    }
  }
  return block.join("\n");
}

/**
 * Extract a service block from a parent `services:` block by matching the
 * service key at the MINIMUM indent among all `key:` lines. This avoids
 * the ambiguity where a child key (e.g. `db:` inside another service's
 * `depends_on:`) shares a name with a real service. The real service key
 * is always at the shallowest indent inside `services:`.
 */
function extractServiceBlock(servicesBlockText, serviceName) {
  const lines = servicesBlockText.split(/\r?\n/);
  // Find all candidate `serviceName:` lines and pick the one with the
  // smallest leading indent.
  let best = null; // { idx, indentLen }
  const keyRe = new RegExp(`^(\\s*)${escapeRegExp(serviceName)}:\\s*(?:#.*)?$`);
  for (let i = 0; i < lines.length; i++) {
    const m = keyRe.exec(lines[i]);
    if (!m) continue;
    const indentLen = m[1].length;
    if (best === null || indentLen < best.indentLen) {
      best = { idx: i, indentLen };
    }
  }
  if (best === null) return null;
  return extractTopLevelBlock(lines.slice(best.idx).join("\n"), serviceName);
}

/**
 * docker-compose.build.yml is the single allowed source-build MODE override
 * of the one operator entry point. It cannot run standalone (no db service),
 * so the rules here keep it from silently growing into a second topology:
 *   - only `app` and `email-worker` may appear;
 *   - each must carry build + a pinned local image tag + pull_policy: build
 *     (the PR-acceptance guarantee that containers run the freshly built
 *     checkout, never a registry/local-cache image);
 *   - it must not carry any topology keys (ports/environment/volumes/
 *     command/entrypoint) — those live in docker-compose.yml alone.
 */
function assertBuildVariant(text) {
  const services = extractTopLevelBlock(text, "services");
  if (!services) {
    errors.push(
      `${ALLOWED_BUILD_VARIANT} has no top-level 'services:' mapping.`,
    );
    return;
  }
  for (const name of topLevelKeys(services)) {
    if (name !== "app" && name !== "email-worker") {
      errors.push(
        `${ALLOWED_BUILD_VARIANT} may only override 'app' and 'email-worker' ` +
          `(found '${name}'); it is a build-mode override of docker-compose.yml, ` +
          "not a second topology.",
      );
      continue;
    }
    const block = extractServiceBlock(services, name);
    if (!block) continue;
    const noComments = block
      .split(/\r?\n/)
      .filter((l) => !/^\s*#/.test(l))
      .join("\n");
    if (!/^\s*build:\s*\S/im.test(noComments)) {
      errors.push(
        `${ALLOWED_BUILD_VARIANT} service '${name}' must keep a build key.`,
      );
    }
    if (!/^\s*image:\s*exam-local:dev\s*$/im.test(noComments)) {
      errors.push(
        `${ALLOWED_BUILD_VARIANT} service '${name}' must pin 'image: exam-local:dev' ` +
          "(the stable local tag used to prove which build the containers run).",
      );
    }
    if (!/^\s*pull_policy:\s*build\s*$/im.test(noComments)) {
      errors.push(
        `${ALLOWED_BUILD_VARIANT} service '${name}' must pin 'pull_policy: build' ` +
          "(source-build verification must never reuse a registry/local-cache image).",
      );
    }
    for (const forbidden of [
      "ports:",
      "environment:",
      "volumes:",
      "command:",
      "entrypoint:",
    ]) {
      if (new RegExp(`^\\s*${forbidden}\\s*$`, "im").test(noComments)) {
        errors.push(
          `${ALLOWED_BUILD_VARIANT} service '${name}' must not carry '${forbidden}' — ` +
            "topology belongs to docker-compose.yml alone.",
        );
      }
    }
  }
}

function topLevelKeys(blockText) {
  const keys = [];
  for (const line of blockText.split(/\r?\n/).slice(1)) {
    if (/^\s*$/.test(line)) continue;
    // Service entries are indented exactly one level under `services:`
    // and end with `:`. We capture the first such level.
    const match = line.match(/^(\s+)([A-Za-z0-9_.-]+):\s*$/);
    if (match) {
      keys.push(match[2]);
    } else {
      // Once we hit a non-key indented line, the service list ended.
      const indented = line.match(/^(\s+)/);
      if (indented && indented[1].length === 2) {
        // Could be a service with inline mapping (e.g. `app: { ... }`).
        const inline = line.match(/^(\s+)([A-Za-z0-9_.-]+):\s*\{/);
        if (inline) keys.push(inline[2]);
      }
    }
  }
  return keys;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * P6-007: assert that a service block references POSTGRES_PASSWORD via
 * Compose required-expansion (`${POSTGRES_PASSWORD:?...}`) and NOT via a
 * fallback default. Used on the `app` and `email-worker` services, whose
 * DATABASE_URL composition embeds POSTGRES_PASSWORD.
 *
 * Acceptable:
 *   DATABASE_URL: postgresql://...:${POSTGRES_PASSWORD:?...}@db:5432/...
 *   POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?...}
 *
 * Rejected:
 *   DATABASE_URL: ...${POSTGRES_PASSWORD:-exam}...     (functional fallback)
 *   DATABASE_URL: ...exam...                           (hardcoded password)
 */
function assertRequiredPostgresPassword(block, serviceName) {
  const noComments = block
    .split(/\r?\n/)
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");
  // The block must reference POSTGRES_PASSWORD via required expansion.
  // `\:?` requires the Compose `${VAR:?err}` form (or `${VAR:?msg}` with
  // arbitrary message text).
  if (!/\$\{POSTGRES_PASSWORD:\?[^}]*\}/.test(noComments)) {
    errors.push(
      `'${serviceName}' service must reference POSTGRES_PASSWORD via ` +
        "Compose required-expansion '${POSTGRES_PASSWORD:?...}' " +
        "(P6-007: the production database credential must have no " +
        "functional fallback).",
    );
  }
  // The block must NOT use a fallback default for POSTGRES_PASSWORD.
  if (/\$\{POSTGRES_PASSWORD:-[^}]*\}/.test(noComments)) {
    errors.push(
      `'${serviceName}' service must NOT use '\${POSTGRES_PASSWORD:-...}' ` +
        "(P6-007: a functional fallback default is forbidden for the " +
        "production database credential; use '${POSTGRES_PASSWORD:?...}').",
    );
  }
}

/**
 * P6-007: assert that the `db` service requires POSTGRES_PASSWORD via
 * required-expansion. The db service sets the password directly (not via
 * DATABASE_URL), so we just check the POSTGRES_PASSWORD line within the
 * db service block (indented under `environment:`).
 */
function assertRequiredPostgresPasswordDb(block) {
  const noComments = block
    .split(/\r?\n/)
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");
  // The db service sets POSTGRES_PASSWORD as an environment scalar. It
  // must use required-expansion. Indented under environment: (≥6 spaces).
  if (
    !/^\s{4,}POSTGRES_PASSWORD:\s*\$\{POSTGRES_PASSWORD:\?[^}]*\}/m.test(
      noComments,
    )
  ) {
    errors.push(
      "'db' service POSTGRES_PASSWORD must use Compose required-expansion " +
        "'${POSTGRES_PASSWORD:?...}' (P6-007: the production database " +
        "credential must have no functional fallback).",
    );
  }
}

/**
 * P6-010: assert that a service does NOT depend on redis health. Redis is
 * optional in the implemented MVP (ADR-001); the API must not gate its
 * startup on Redis health.
 */
function assertNoRedisDependency(block, serviceName) {
  const dependsMatch = block.match(
    /depends_on:\s*\n([\s\S]*?)(?=\n\S|\n\s{0,1}\S|\n$|$)/,
  );
  if (!dependsMatch) return;
  const depBlock = dependsMatch[1];
  const hasRedis =
    /^\s{2,}redis:\s*\n\s{4,}condition:\s*service_healthy\s*$/m.test(
      "depends_on:\n" + depBlock,
    );
  if (hasRedis) {
    errors.push(
      `'${serviceName}' service must NOT depend on 'redis: service_healthy' ` +
        "(P6-010: Redis is optional in the implemented MVP).",
    );
  }
}

/**
 * P7 review P1-1: an ENABLED production Redis must be authenticated. Redis
 * stays optional at Compose parse time — the password is checked at
 * CONTAINER STARTUP, not expansion, so a bare `docker compose up` (redis
 * profile inactive) needs no Redis configuration (P7 review P1). The redis
 * service must:
 *   - keep REDIS_PASSWORD OPTIONAL at Compose expansion (`${REDIS_PASSWORD:-}`
 *     empty default; `${REDIS_PASSWORD:?...}` required-expansion is
 *     forbidden — it would make the secret mandatory for the whole stack);
 *   - fail the redis container at startup when REDIS_PASSWORD is unset or
 *     empty (a shell guard `: "${REDIS_PASSWORD:?...}"` in the command);
 *   - run the server with `--requirepass` (the password comes from the
 *     container environment, never interpolated into the stored command
 *     definition);
 *   - authenticate in its healthcheck (`$$REDIS_PASSWORD`), so an open
 *     instance would fail its own health probe.
 */
function assertRedisAuth(redisBlock) {
  const noComments = redisBlock
    .split(/\r?\n/)
    .filter((l) => !/^\s*#/.test(l))
    .join("\n");

  // The environment must keep the secret optional at Compose expansion.
  // `(?<!\$)` excludes the `$$`-escaped shell guard in the command (the
  // container sees `$`, Compose never does) — only the single-`$` Compose
  // interpolation form is a parse-time requirement.
  if (/(?<!\$)\$\{REDIS_PASSWORD:\?/.test(noComments)) {
    errors.push(
      "'redis' service must NOT use Compose required-expansion " +
        "'${REDIS_PASSWORD:?...}' (P7 review P1: Redis is an optional " +
        "profile — a bare 'docker compose up' must not require the " +
        "secret; the guard belongs at container startup).",
    );
  }
  if (!/(?<!\$)\$\{REDIS_PASSWORD:-[^}]*\}/.test(noComments)) {
    errors.push(
      "'redis' service REDIS_PASSWORD must use the empty-default form " +
        "'${REDIS_PASSWORD:-}' (P7 review P1: Redis stays optional at " +
        "Compose parse time).",
    );
  }
  // The command must fail the container at startup without the password.
  if (!/\$\$\{REDIS_PASSWORD:\?[^}]*\}/.test(noComments)) {
    errors.push(
      "'redis' service command must carry a startup guard that fails the " +
        "container when REDIS_PASSWORD is unset or empty (P7 review P1-1: " +
        "an enabled production Redis must never run open).",
    );
  }
  if (!/--requirepass/.test(noComments)) {
    errors.push(
      "'redis' service command must run redis-server with '--requirepass' " +
        "(P7 review P1-1: an open production Redis instance is not " +
        "acceptable now that Redis owns the shared rate-limit state).",
    );
  }
  if (!/\$\$REDIS_PASSWORD/.test(noComments)) {
    errors.push(
      "'redis' service healthcheck must authenticate via '$$REDIS_PASSWORD' " +
        "(P7 review P1-1: the health probe must prove the server enforces " +
        "the password).",
    );
  }
}
