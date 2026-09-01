#!/usr/bin/env node
/**
 * Regression guard: verify the production Docker Compose topology deploys
 * every long-running process the implemented MVP requires.
 *
 * Authority: docs/adr/ADR-011-notification-and-email-delivery.md,
 * docs/adr/ADR-001-redis.md, and the P6 MVP boundary
 * (docs/audits/P6-MVP-READY-REALITY-AUDIT.md). The MVP cannot be
 * release-ready if `docker compose up` starts the API and PostgreSQL but
 * nothing consumes the PostgreSQL `email_outbox` table that identity and
 * notification flows write into (ADR-011).
 *
 * The email outbox delivery loop is NOT a separate process — since #320
 * (CONVERGE) it runs in-process inside the API server
 * (apps/api/src/plugins/emailOutboxLoop.ts), exactly like the deadline
 * scanner and heartbeat plugins, so it is covered by the `app` service
 * healthcheck. The dedicated `email-worker` Compose service was removed by
 * #320; its reintroduction is an ADR-011 topology change that must update
 * this guard first.
 *
 * This guard fails fast if:
 *   - the production compose file loses the `app` or `db` service;
 *   - a dedicated `email-worker` service reappears (#320 CONVERGE removed
 *     it; the outbox loop is in-process);
 *   - the `app` service stops forwarding an application runtime env key the
 *     runtime consumes, or a Compose fallback default drifts from the
 *     semantic default (verified generically from the settings model by
 *     scripts/repository-contract/config-contract.mjs — #367/#370; this
 *     file no longer carries an Email-specific membership table);
 *   - the #351 shutdown budget contract breaks: `app` must declare an
 *     explicit `stop_grace_period` that strictly dominates the serial
 *     graceful-shutdown worst case (email loop drain + audit drain + DB
 *     pool close), or a stuck email send ends in SIGKILL (exit 137);
 *   - the production compose file accepts a default database password
 *     (POSTGRES_PASSWORD must use `${...:?...}` required-expansion on db
 *      and app) — P6-007;
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
 *     must only carry build/image/pull_policy keys for app). It is a mode
 *     of the one entry point, not a second
 *     production topology; the structural rules are in
 *     assertBuildVariant().
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
const composePath = join(ROOT, "docker-compose.yml");

const errors = [];

// Semantic settings model (env membership / defaults / bindings for the
// app container) is owned by apps/api/src/config/settings.ts and verified
// per-topology by scripts/repository-contract/config-contract.mjs — this
// file no longer carries any email env membership table or runtime-source
// default parser (#370). The settings import here is read-only, for the
// #351 shutdown budget term below.
const { settingsLeaves } =
  await import("../../apps/api/src/config/settings.ts");

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
// build-mode override of the ONE entry point: only app, only
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
  // app + db (#320 CONVERGE: the email outbox loop runs in-process in the
  // app container). The `redis` service may be present (as an opt-in
  // profile) but is NOT required.
  for (const required of ["app", "db"]) {
    if (!serviceNames.includes(required)) {
      errors.push(
        `docker-compose.yml is missing required service '${required}'.`,
      );
    }
  }

  // #320 CONVERGE: the dedicated email-worker Compose service was removed —
  // the outbox delivery loop runs in-process inside the app container
  // (ADR-011 §8.6). A reappearing worker service is a topology regression
  // this guard must catch (it would double-consume the outbox and split the
  // migration-ownership model the deployment tests encode).
  if (serviceNames.includes("email-worker")) {
    errors.push(
      "'email-worker' service must NOT exist in docker-compose.yml (#320 " +
        "CONVERGE: the email outbox loop runs in-process inside 'app'; " +
        "reintroducing a dedicated worker container is an ADR-011 topology " +
        "change that must revise this guard and the deployment tests).",
    );
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
      // #320 CONVERGE + #367 + #370: the in-process email outbox loop reads
      // its sender and polling configuration from the app environment.
      // Forwarding completeness and default parity for EVERY runtime env
      // key are verified generically from the settings model by
      // scripts/repository-contract/config-contract.mjs.
      // #351: the container stop grace must strictly dominate the app's
      // whole graceful-shutdown worst case.
      assertShutdownBudgetContract(appNoComments, appEnvNoComments);
    }
  }

  // P6-007: the `db` service must require POSTGRES_PASSWORD too.
  if (serviceNames.includes("db")) {
    const dbBlock = extractServiceBlock(servicesBlock, "db");
    if (dbBlock) {
      assertRequiredPostgresPasswordDb(dbBlock);
    }
  }
}

// ── Dockerfile pnpm pin: packageManager parity (retired test-docker-config) ─
// The image must build with the SAME pnpm the repo declares — a drift between
// package.json#packageManager and the Dockerfile corepack pin would ship an
// image whose toolchain differs from CI/dev (reproducible-build contract).
// This migrates the retired test-docker-config.mjs pin check onto the
// deployment oracle; the fresh-install source build still catches a broken
// pin at build time.
{
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  const packageManager = pkg.packageManager;
  if (
    typeof packageManager !== "string" ||
    !/^pnpm@\d+\.\d+\.\d+$/.test(packageManager)
  ) {
    errors.push(
      "package.json#packageManager must be an exact pnpm@x.y.z pin " +
        "(reproducible-build authority).",
    );
  } else {
    const dockerfile = readFileSync(join(ROOT, "Dockerfile"), "utf-8");
    const corepack = dockerfile.match(/corepack prepare pnpm@[\d.]+/);
    if (
      !corepack ||
      corepack[0].replace("corepack prepare ", "") !== packageManager
    ) {
      errors.push(
        `Dockerfile corepack pin (${corepack?.[0] ?? "missing"}) must equal ` +
          `package.json#packageManager (${packageManager}) — the image ` +
          "toolchain must match the repo-declared pnpm (reproducible build).",
      );
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
    // builds belong to the contributor override). No `--build` form is
    // legitimate in an OPERATOR lifecycle document, so any occurrence is
    // flagged — including env-file variants.
    if (/docker compose[^\n]*\bup( -d)? --build/.test(doc)) {
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
 *   - only `app` may appear;
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
    if (name !== "app") {
      errors.push(
        `${ALLOWED_BUILD_VARIANT} may only override 'app' ` +
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
 * fallback default. Used on the `app` service, whose DATABASE_URL
 * composition embeds POSTGRES_PASSWORD.
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
 * #351 shutdown budget contract: the app container's stop_grace_period must
 * strictly dominate the app's whole graceful-shutdown worst case. Fastify
 * onClose hooks run SERIALLY in reverse registration order, so the bound is
 * the SUM of the per-component budgets (no parallelism credit):
 *
 *   stop_grace_period
 *     > email loop drain (EMAIL_WORKER_SHUTDOWN_TIMEOUT_MS semantic
 *       default, read from the settings model)
 *     + audit drain (AUDIT_DRAIN_TIMEOUT_MS, read from auditLifecycle.ts)
 *     + DB pool close (sql.end timeout = ceil(AUDIT_DRAIN_TIMEOUT_MS/1000),
 *       read from db.ts)
 *     + bounded exit assist (BOUNDED_EXIT_ASSIST_MS, read from server.ts —
 *       the post-close grace before a forced exit cuts off work ABANDONED
 *       by the bounded shutdown, e.g. an in-flight send past the loop
 *       budget)
 *
 * If the relation breaks, a stuck in-flight email send turns SIGTERM into
 * SIGKILL (exit 137) — the exact #349 post-merge failure this guards. The
 * component budgets are parsed from their real sources (not duplicated
 * constants): if either source moves, this guard fails until it is
 * consciously reconciled.
 */
function assertShutdownBudgetContract(appNoComments, appEnvNoComments) {
  const graceMatch = appNoComments.match(
    /^\s*stop_grace_period:\s*(\d+)s\s*$/m,
  );
  const loopForwarded =
    /^\s*EMAIL_WORKER_SHUTDOWN_TIMEOUT_MS:\s*\$\{EMAIL_WORKER_SHUTDOWN_TIMEOUT_MS:/m.test(
      appEnvNoComments,
    );
  const loopDefaultRaw =
    settingsLeaves().get("EMAIL_WORKER_SHUTDOWN_TIMEOUT_MS")?.defaultRaw ??
    null;
  const loopMs = loopDefaultRaw === null ? null : Number(loopDefaultRaw);

  let auditMs = null;
  try {
    const auditSrc = readFileSync(
      join(ROOT, "apps/api/src/plugins/auditLifecycle.ts"),
      "utf-8",
    );
    const m = auditSrc.match(/AUDIT_DRAIN_TIMEOUT_MS\s*=\s*([\d_]+)/);
    if (m) auditMs = Number(m[1].replace(/_/g, ""));
  } catch {
    // missing file → null → reported below
  }

  let assistMs = null;
  try {
    const serverSrc = readFileSync(
      join(ROOT, "apps/api/src/server.ts"),
      "utf-8",
    );
    const m = serverSrc.match(/BOUNDED_EXIT_ASSIST_MS\s*=\s*([\d_]+)/);
    if (m) assistMs = Number(m[1].replace(/_/g, ""));
  } catch {
    // missing file → null → reported below
  }

  const dbSrc = (() => {
    try {
      return readFileSync(join(ROOT, "apps/api/src/plugins/db.ts"), "utf-8");
    } catch {
      return null;
    }
  })();
  // The DB close budget is coupled to the audit drain timeout in db.ts;
  // if that coupling is refactored away, fail here rather than silently
  // reading a stale budget.
  const dbCoupled =
    dbSrc !== null &&
    /sql\.end\(\{\s*timeout:\s*Math\.ceil\(AUDIT_DRAIN_TIMEOUT_MS\s*\/\s*1000\)\s*\}\)/.test(
      dbSrc,
    );

  if (!graceMatch) {
    errors.push(
      "'app' service must declare an explicit 'stop_grace_period: <N>s' " +
        "(#351: Docker's default 10s grace is shorter than the app's " +
        "graceful-shutdown worst case, so a stuck email send ends in " +
        "SIGKILL/137).",
    );
  }
  if (!loopForwarded) {
    errors.push(
      "'app' environment must forward " +
        "'EMAIL_WORKER_SHUTDOWN_TIMEOUT_MS: ${EMAIL_WORKER_SHUTDOWN_TIMEOUT_MS:-}' " +
        "(#351 budget contract: the loop drain budget must reach the container).",
    );
  }
  if (loopMs === null || !Number.isFinite(loopMs)) {
    errors.push(
      "#351 budget contract: no numeric EMAIL_WORKER_SHUTDOWN_TIMEOUT_MS " +
        "semantic default in apps/api/src/config/settings.ts — the loop drain " +
        "budget is a term of this contract and must stay visible.",
    );
  }
  if (auditMs === null) {
    errors.push(
      "#351 budget contract: cannot parse AUDIT_DRAIN_TIMEOUT_MS from " +
        "apps/api/src/plugins/auditLifecycle.ts — reconcile this guard with " +
        "the audit shutdown budget's real source.",
    );
  }
  if (assistMs === null) {
    errors.push(
      "#351 budget contract: cannot parse BOUNDED_EXIT_ASSIST_MS from " +
        "apps/api/src/server.ts — the post-close exit assist is a budget " +
        "term and must stay visible to this guard.",
    );
  }
  if (!dbCoupled) {
    errors.push(
      "#351 budget contract: apps/api/src/plugins/db.ts no longer derives " +
        "its sql.end timeout from AUDIT_DRAIN_TIMEOUT_MS — the DB pool close " +
        "budget must stay an explicit term of this contract; update the " +
        "guard and the compose budget comment together.",
    );
  }

  if (
    graceMatch &&
    loopForwarded &&
    loopMs !== null &&
    Number.isFinite(loopMs) &&
    auditMs !== null &&
    assistMs !== null &&
    dbCoupled
  ) {
    const graceMs = Number(graceMatch[1]) * 1000;
    const dbCloseMs = Math.ceil(auditMs / 1000) * 1000;
    const sumMs = loopMs + auditMs + dbCloseMs + assistMs;
    if (sumMs >= graceMs) {
      errors.push(
        `#351 shutdown budget violation: stop_grace_period (${graceMatch[1]}s) ` +
          `must strictly dominate the serial shutdown worst case — email loop ` +
          `(${loopMs}ms) + audit drain (${auditMs}ms) + DB pool close ` +
          `(${dbCloseMs}ms) + exit assist (${assistMs}ms) = ${sumMs}ms. Raise ` +
          `the grace or lower a component budget.`,
      );
    }
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
