#!/usr/bin/env node
// First-run setup for Docker DEPLOYMENT: create .env.deploy from
// .env.deploy.example (if missing) and fill empty secrets. Works on
// Linux/macOS/WSL and Windows PowerShell — the only prerequisite is Node,
// which the repo already requires.
//
//   node scripts/generate-env.mjs
//
// The deployment stack is then started explicitly against the file:
//   docker compose --env-file .env.deploy -f docker-compose.yml up -d
// (source builds — contributors / PR acceptance — merge
// docker-compose.build.yml; the operator path never builds)
//
// Passing --env-file replaces the default `.env` as Compose's interpolation
// file (the dev .env is never read for deployment), and no dev tooling ever
// reads .env.deploy. Development keeps its own .env (cp .env.example .env).
//
// Secret contract: first run → generate; existing value → preserve. Re-running
// against an initialized .env.deploy never rotates a secret.
//
// Legacy carry-over: installs made before the dev/deploy env split (PR #319)
// kept the deployment secrets (JWT_SECRET / POSTGRES_*) in the repo-root .env.
// On first creation of .env.deploy, those secrets are preserved — including
// POSTGRES_PASSWORD, which must never be silently rotated (the existing
// PostgreSQL data volume is still using it). A post-split dev-only .env (no
// deployment secrets) is ignored and fresh secrets are generated instead.
// Migration is consult-the-legacy-on-empty only: an explicit value in
// .env.deploy always wins, and once .env.deploy is set, later runs never
// re-read the dev .env.
//
// Optional arguments: an env-file path to operate on (defaults to repo-root
// .env.deploy), then optionally a legacy env-file source (defaults to
// repo-root .env). The second argument exists so tests can drive the legacy
// migration hermetically.

import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = process.argv[2]
  ? resolve(process.argv[2])
  : join(root, ".env.deploy");
const legacyPath = process.argv[3]
  ? resolve(process.argv[3])
  : join(root, ".env");
const examplePath = join(root, ".env.deploy.example");

if (!existsSync(envPath)) {
  copyFileSync(examplePath, envPath);
  console.log(`Created ${envPath} from .env.deploy.example`);
}

// Deployment-owned keys carried over from a legacy dev .env (PR #319 era).
// JWT_SECRET + POSTGRES_PASSWORD are secrets already in use by an existing
// data volume / issued JWTs and must never rotate on upgrade. POSTGRES_USER /
// POSTGRES_DB are connection identity — matching them avoids orphaning the DB.
const SECRET_KEYS = ["JWT_SECRET", "POSTGRES_PASSWORD"];
const PRESERVE_KEYS = ["POSTGRES_USER", "POSTGRES_DB"];

// #321: the operator image pin is DERIVED from the repository release
// version authority (.release-version) — never an independently maintained
// copy that can silently drift. A canonical pin for THIS repository
// (ghcr.io/jnhu76/exam:vX.Y.Z) FOLLOWS .release-version on re-runs (the
// upgrade path: git pull → generate-env re-pins the new version); any other
// value is an explicit operator override (air-gapped registry mirror,
// offline docker load) and is preserved exactly like the other keys.
const IMAGE_REPOSITORY = "ghcr.io/jnhu76/exam";
const releaseVersionPath = join(root, ".release-version");
if (!existsSync(releaseVersionPath)) {
  console.error(".release-version not found at the repository root");
  process.exit(1);
}
const releaseVersion = readFileSync(releaseVersionPath, "utf-8").trim();
if (!/^v[0-9]+\.[0-9]+\.[0-9]+$/.test(releaseVersion)) {
  console.error(`Invalid .release-version: ${releaseVersion}`);
  process.exit(1);
}
const derivedImage = `${IMAGE_REPOSITORY}:${releaseVersion}`;
const canonicalPinPattern = new RegExp(
  `^${IMAGE_REPOSITORY.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:v[0-9]+\\.[0-9]+\\.[0-9]+$`,
);

// Read the legacy dev .env once. A post-split dev-only .env has none of the
// keys below, so legacyValue() returns null and fresh secrets are generated.
const legacyEnv = existsSync(legacyPath)
  ? readFileSync(legacyPath, "utf-8")
  : "";

function legacyValue(key) {
  const match = legacyEnv.match(new RegExp(`^${key}=\\s*(.*)$`, "m"));
  if (!match) return null;
  const raw = match[1].trim();
  if (raw === "") return null;
  // Strip a single pair of matching surrounding quotes (dotenv syntax).
  return raw.replace(/^(["'])(.*)\1$/, "$2");
}

let env = readFileSync(envPath, "utf-8");
const original = env;

// Write `key=value`, filling an existing empty KEY= line in place (matches
// `KEY=""`, `KEY=''`), appending a new line only when the key is absent.
function ensureKey(key, value, label) {
  const filled = env.replace(
    new RegExp(`^${key}=(?:""|'')?[ \\t]*$`, "m"),
    `${key}=${value}`,
  );
  if (filled !== env) {
    env = filled;
    console.log(`${label} written to ${envPath}`);
  } else if (new RegExp(`^${key}=\\S`, "m").test(env)) {
    console.log(`${key} already set in ${envPath}; leaving it unchanged.`);
  } else {
    const separator = env.endsWith("\n") ? "" : "\n";
    env = `${env}${separator}${key}=${value}\n`;
    console.log(`${label} appended to ${envPath}`);
  }
}

for (const key of SECRET_KEYS) {
  const legacy = legacyValue(key);
  const value = legacy ?? randomBytes(32).toString("hex");
  const label = legacy === null ? key : `${key} (preserved from legacy .env)`;
  ensureKey(key, value, label);
}

for (const key of PRESERVE_KEYS) {
  const legacy = legacyValue(key);
  if (legacy !== null) {
    ensureKey(key, legacy, `${key} (preserved from legacy .env)`);
  }
}

// EXAM_IMAGE follows .release-version when its current value is a canonical
// pin for this repository (the upgrade path); any other value is an explicit
// operator override and wins (see the derivation comment above). Blank and
// quoted-empty values are "absent" — they fall into ensureKey for filling.
// Values are classified on their UNQUOTED form (dotenv quoting around a
// canonical pin must not mask it), and every EXAM_IMAGE line is rewritten
// on the re-pin path so a stale or blank sibling can never create a
// duplicate key whose LAST definition silently wins.
const nonBlankImage = env.match(/^EXAM_IMAGE=(\S.*)$/m);
let existingImage = null;
if (nonBlankImage) {
  const unquoted = nonBlankImage[1].trim().replace(/^(["'])(.*)\1$/, "$2");
  if (unquoted !== "") {
    existingImage = unquoted;
  }
}
if (existingImage !== null && !canonicalPinPattern.test(existingImage)) {
  // Explicit override wins; drop blank EXAM_IMAGE siblings so a later fill
  // cannot create a last-wins duplicate.
  env = env.replace(/^EXAM_IMAGE=(?:""|'')?[ \t]*$/gm, "");
  console.log(`EXAM_IMAGE already set in ${envPath}; leaving it unchanged.`);
} else if (existingImage !== null) {
  // Canonical pin: strip every previous EXAM_IMAGE line (quoted or blank)
  // and append the single derived pin. Byte-idempotent when the pin is
  // already current and alone.
  const occurrences = env.match(/^EXAM_IMAGE=.*$/gm) ?? [];
  if (
    occurrences.length === 1 &&
    occurrences[0] === `EXAM_IMAGE=${derivedImage}`
  ) {
    console.log(`EXAM_IMAGE already pinned to ${derivedImage}.`);
  } else {
    env = env.replace(/^EXAM_IMAGE=.*$/gm, "");
    if (!env.endsWith("\n")) env += "\n";
    env = `${env}EXAM_IMAGE=${derivedImage}\n`;
    console.log(
      `EXAM_IMAGE re-pinned to ${derivedImage} (follows .release-version)`,
    );
  }
} else {
  ensureKey(
    "EXAM_IMAGE",
    derivedImage,
    "EXAM_IMAGE (pinned from .release-version)",
  );
}

if (env !== original) {
  writeFileSync(envPath, env);
}

console.log(
  "Next: docker compose --env-file .env.deploy -f docker-compose.yml up -d",
);
