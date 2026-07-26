#!/usr/bin/env node
/**
 * Regression guard: verify the production Docker Compose topology deploys
 * every long-running process the implemented MVP requires.
 *
 * Authority: docs/adr/ADR-011-notification-and-email-delivery.md and
 * P6 MVP boundary. The MVP cannot be release-ready if `docker compose up`
 * starts the API (and its in-process scanners) and PostgreSQL but never
 * starts the Email delivery worker, because the worker is the only
 * consumer of the PostgreSQL `email_outbox` table that
 * `result_published` notifications write into (ADR-011).
 *
 * The scanner is NOT a separate process — it runs in-process inside the
 * API server (see apps/api/src/plugins/deadlineScanner.ts and
 * heartbeat.ts), so it is covered by the `app` service healthcheck.
 *
 * This guard fails fast if:
 *   - the production compose file loses the `email-worker` service;
 *   - the worker service is missing the required DB/JWT/PUBLIC_WEB_ORIGIN
 *     env that the worker entrypoint resolves;
 *   - the worker is allowed to start before DB health;
 *   - the worker has no restart policy.
 */
import { readFileSync } from "node:fs";
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

// Minimal structural parse — we only need top-level service presence and
// selected scalar values. Avoids a yaml dependency in the contract gate.
const servicesBlock = extractTopLevelBlock(composeText, "services");
if (!servicesBlock) {
  errors.push("docker-compose.yml has no top-level 'services:' mapping.");
} else {
  const serviceNames = topLevelKeys(servicesBlock);

  for (const required of ["app", "db", "redis", "email-worker"]) {
    if (!serviceNames.includes(required)) {
      errors.push(
        `docker-compose.yml is missing required service '${required}'.`,
      );
    }
  }

  if (serviceNames.includes("email-worker")) {
    const workerBlock = extractTopLevelBlock(servicesBlock, "email-worker");
    if (!workerBlock) {
      errors.push("'email-worker' service block could not be parsed.");
    } else {
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
      // Strip comment lines before substring matching so a comment like
      // `# CORS_ORIGIN:` cannot satisfy the check.
      const workerBlockNoComments = workerBlock
        .split(/\r?\n/)
        .filter((l) => !/^\s*#/.test(l))
        .join("\n");
      for (const key of requiredEnv) {
        if (
          !new RegExp(`^\\s*${escapeRegExp(key)}:\\s*\\S`, "m").test(
            workerBlockNoComments,
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
      if (!/APP_MODE:\s*production\b/.test(workerBlockNoComments)) {
        errors.push(
          "'email-worker' APP_MODE must be 'production' (otherwise the " +
            "config loader's production fail-fast checks are silently " +
            "disabled).",
        );
      }

      // Worker must depend on DB health specifically (not just any
      // service_healthy). A future `depends_on: redis: service_healthy`
      // would satisfy a loose check and let the worker start before the DB
      // exists, producing a restart loop.
      const dependsMatch = workerBlock.match(
        /depends_on:\s*\n([\s\S]*?)(?=\n\S|\n\s{0,1}\S|\n$|$)/,
      );
      if (!dependsMatch) {
        errors.push(
          "'email-worker' service must declare depends_on with db: service_healthy.",
        );
      } else {
        const depBlock = dependsMatch[1];
        const hasDb =
          /^\s{2,}db:\s*\n\s{4,}condition:\s*service_healthy\s*$/m.test(
            "depends_on:\n" + depBlock,
          );
        if (!hasDb) {
          errors.push(
            "'email-worker' depends_on must specifically require " +
              "'db: condition: service_healthy'.",
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
