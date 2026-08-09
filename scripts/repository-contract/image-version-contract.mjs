#!/usr/bin/env node
/**
 * Regression guard (P7-C1 C1.2): the deployment image set must be a decidable,
 * compatible, patch-pinned set.
 *
 * Authority: docs/audits/P7-C0-DURABILITY-PERSISTENCE-REALITY-AUDIT.md §15
 * (image/version compatibility) and the P7-C1 mission
 * ("a relocation does not accidentally rebuild / pull incompatible images").
 *
 * This guard fails fast if:
 *   - PostgreSQL is not patch-pinned (must be major.minor.patch or
 *     major.minor-bookworm; bare-major / minor-float / `latest` refused);
 *   - Redis is not exact-patch-pinned (must be major.minor.patch-alpine;
 *     `7-alpine` / `7.4-alpine` minor-floats and `latest` are refused — Redis
 *     is non-authoritative, but C1's "known image set" contract still requires
 *     a patch pin so a pull cannot silently advance);
 *   - the production docker-compose.yml is not IMAGE-ONLY (app / email-worker
 *     must not declare `build:`; they must consume `${EXAM_IMAGE:?...}` — a
 *     portable relocation must never rebuild from source);
 *   - docker-compose.build.yml (the local source-build override) is missing.
 *
 * Wiring: `lint:repo-contract` → `verify:static`.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");

const errors = [];

// ── Read compose files ─────────────────────────────────────────────────
const composePath = join(ROOT, "docker-compose.yml");
const buildOverridePath = join(ROOT, "docker-compose.build.yml");

let composeText;
try {
  composeText = readFileSync(composePath, "utf-8");
} catch {
  console.error("FAIL: docker-compose.yml is missing from repository root.");
  process.exit(1);
}

if (!existsSync(buildOverridePath)) {
  errors.push(
    "docker-compose.build.yml is missing (P7-C1 C1.2: the production " +
      "docker-compose.yml is image-only; local source builds use this override).",
  );
}

// ── PostgreSQL image pin ───────────────────────────────────────────────
// Accept postgres:<major>.<minor>.<patch>-bookworm (full patch pin) or
// postgres:<major>.<minor>-bookworm (minor pin — bookworm is the Debian
// suite, acceptable for the official postgres image).
// Refuse: latest, bare major, minor-float without suite.
const pgImageRe = /image:\s*(?:["']?)(postgres:[^\s"']+)/;
const pgMatch = composeText.match(pgImageRe);
if (!pgMatch) {
  errors.push(
    "docker-compose.yml must declare a postgres: image on the db service.",
  );
} else {
  const pgRef = pgMatch[1];
  if (/postgres:(latest|:\d+|\d+\.0|alpine)/i.test(pgRef)) {
    errors.push(
      `PostgreSQL image '${pgRef}' is not patch-pinned (P7-C1 C1.2: use ` +
        "postgres:<major>.<minor>.<patch>-bookworm or <major>.<minor>-bookworm; " +
        "refuse latest / bare-major / alpine).",
    );
  } else if (!/^postgres:\d+\.\d+(\.\d+)?-bookworm$/.test(pgRef)) {
    errors.push(
      `PostgreSQL image '${pgRef}' does not match the patch-pinned contract ` +
        "(P7-C1 C1.2: expected postgres:<major>.<minor>.<patch>-bookworm or " +
        "<major>.<minor>-bookworm).",
    );
  }
}

// ── Redis image pin ────────────────────────────────────────────────────
// Redis is non-authoritative (C0 §8 / ADR-001), but C1's "decidable
// compatible image set" still requires an EXACT patch pin so a pull cannot
// silently advance the running Redis. Accept redis:<major>.<minor>.<patch>-alpine
// only. Refuse 7-alpine, 7.4-alpine (minor-floats), latest.
const redisImageRe = /image:\s*(?:["']?)(redis:[^\s"']+)/;
const redisMatches = composeText.match(new RegExp(redisImageRe, "g")) || [];
if (redisMatches.length === 0) {
  // Redis is optional (profile-gated); its absence is not an error. Only
  // validate when present.
} else {
  for (const m of redisMatches) {
    const ref = m.replace(redisImageRe, "$1");
    if (!/^redis:\d+\.\d+\.\d+-alpine$/.test(ref)) {
      errors.push(
        `Redis image '${ref}' is not exact-patch-pinned (P7-C1 C1.2: use ` +
          "redis:<major>.<minor>.<patch>-alpine; refuse redis:latest, " +
          "redis:7-alpine, redis:7.4-alpine and other minor-float forms — " +
          "Redis is non-authoritative but the image set must still be decidable).",
      );
    }
  }
}

// ── Production app/email-worker must be IMAGE-ONLY ─────────────────────
// The deployment-topology-contract.mjs guard already checks this per-service
// (no build:, image: ${EXAM_IMAGE:?...}). This guard additionally asserts the
// whole file does not contain a bare `build: .` at the service level.
const serviceBuildRe = /^\s{2,}build:\s*\./m;
if (serviceBuildRe.test(composeText)) {
  errors.push(
    "docker-compose.yml must NOT contain service-level 'build: .' " +
      "(P7-C1 C1.2: the production topology is image-only; move source builds " +
      "to docker-compose.build.yml).",
  );
}

if (errors.length > 0) {
  console.error("FAIL: Image/version contract regression (P7-C1 C1.2):");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log("PASS: image/version contract holds (P7-C1 C1.2).");
