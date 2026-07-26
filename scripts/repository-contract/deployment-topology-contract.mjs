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
      // Required env carried over from the worker entrypoint
      // (apps/api/src/workers/emailDeliveryWorker.ts):
      //   DATABASE_URL (db connection), JWT_SECRET (never used by worker
      //   itself, but kept for env parity so a single image/runtime
      //   contract is deployable), PUBLIC_WEB_ORIGIN (validated by
      //   runtimeConfig at worker boot — worker calls getRuntimeConfig).
      const requiredEnv = [
        "DATABASE_URL",
        "JWT_SECRET",
        "PUBLIC_WEB_ORIGIN",
        "APP_MODE",
      ];
      for (const key of requiredEnv) {
        if (!workerBlock.includes(`${key}:`)) {
          errors.push(
            `'email-worker' service must define environment variable '${key}'.`,
          );
        }
      }

      // Worker must depend on DB health to avoid racing migrations against
      // the app container (the worker also self-migrates; both are
      // idempotent via the drizzle journal, but starting before DB health
      // produces noisy retry logs and a slower first-poll).
      if (!/depends_on:/.test(workerBlock)) {
        errors.push(
          "'email-worker' service must declare depends_on with db health.",
        );
      } else if (!/condition:\s*service_healthy/.test(workerBlock)) {
        errors.push(
          "'email-worker' depends_on must require db: service_healthy.",
        );
      }

      // Worker must have a restart policy — it is a required long-running
      // process, not a one-shot.
      if (!/restart:\s*\S+/.test(workerBlock)) {
        errors.push("'email-worker' service must define a restart policy.");
      }

      // Worker must run the production worker entrypoint, not the dev tsx
      // path and not the API server.
      if (!/dist\/workers\/emailDeliveryWorker\.js/.test(workerBlock)) {
        errors.push(
          "'email-worker' command must run dist/workers/emailDeliveryWorker.js.",
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
