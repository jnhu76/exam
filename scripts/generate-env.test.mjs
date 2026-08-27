// Contract tests for scripts/generate-env.mjs.
//
// The generator owns the Docker first-run secret contract:
//   first run → generate; second run → preserve; existing value → preserve.
// A violation of "never rotate" would silently invalidate issued JWTs or
// break the running PostgreSQL credential, so the contract is test-enforced.
//
// Legacy carry-over (PR #322 review P1-1): an install made before the
// dev/deploy env split (#319) keeps its deployment secrets in the repo-root
// .env. When .env.deploy is first created, those secrets must be preserved —
// especially POSTGRES_PASSWORD, whose silent rotation would break the existing
// data volume. A post-split dev-only .env (no deployment secrets) must be
// ignored so fresh secrets are generated.
//
// Run:  node --test scripts/generate-env.test.mjs

import assert from "node:assert/strict";
import test from "node:test";
import child_process from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const GENERATOR = join(__dirname, "generate-env.mjs");
const EXAMPLE = join(__dirname, "..", ".env.deploy.example");

// A custom env loaded with no legacy source: absent path → generate fresh.
function runGenerator(envPath, legacyPath) {
  const args = [GENERATOR, envPath];
  if (legacyPath !== undefined) args.push(legacyPath);
  return child_process.spawnSync(process.execPath, args, {
    encoding: "utf-8",
  });
}

function secretLine(envText, key) {
  const match = envText.match(new RegExp(`^${key}=(\\S+)$`, "m"));
  return match ? match[1] : null;
}

test("first run: .env.deploy is created from .env.deploy.example and both empty secrets are filled", () => {
  const dir = mkdtempSync(join(tmpdir(), "genenv-first-"));
  try {
    const envPath = join(dir, ".env.deploy");
    const absentLegacy = join(dir, ".absent-dev-env");
    const result = runGenerator(envPath, absentLegacy);
    assert.equal(result.status, 0, result.stderr);

    const env = readFileSync(envPath, "utf-8");
    const jwt = secretLine(env, "JWT_SECRET");
    const pg = secretLine(env, "POSTGRES_PASSWORD");
    assert.ok(jwt && /^[0-9a-f]{64}$/.test(jwt), "JWT_SECRET must be filled");
    assert.ok(
      pg && /^[0-9a-f]{64}$/.test(pg),
      "POSTGRES_PASSWORD must be filled",
    );
    assert.notEqual(jwt, pg, "the two secrets must be independent");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("second run: generated secrets are preserved, never rotated", () => {
  const dir = mkdtempSync(join(tmpdir(), "genenv-second-"));
  try {
    const envPath = join(dir, ".env.deploy");
    const absentLegacy = join(dir, ".absent-dev-env");
    runGenerator(envPath, absentLegacy);
    const first = readFileSync(envPath, "utf-8");
    const result = runGenerator(envPath, absentLegacy);
    assert.equal(result.status, 0, result.stderr);
    const second = readFileSync(envPath, "utf-8");

    assert.equal(
      secretLine(second, "JWT_SECRET"),
      secretLine(first, "JWT_SECRET"),
    );
    assert.equal(
      secretLine(second, "POSTGRES_PASSWORD"),
      secretLine(first, "POSTGRES_PASSWORD"),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("operator-set secrets in .env.deploy are preserved", () => {
  const dir = mkdtempSync(join(tmpdir(), "genenv-existing-"));
  try {
    const envPath = join(dir, ".env.deploy");
    writeFileSync(
      envPath,
      readFileSync(EXAMPLE, "utf-8")
        .replace(/^JWT_SECRET=.*$/m, "JWT_SECRET=operator-jwt")
        .replace(/^POSTGRES_PASSWORD=.*$/m, "POSTGRES_PASSWORD=operator-pg"),
      "utf-8",
    );
    const result = runGenerator(envPath, join(dir, ".absent-dev-env"));
    assert.equal(result.status, 0, result.stderr);
    const env = readFileSync(envPath, "utf-8");
    assert.equal(secretLine(env, "JWT_SECRET"), "operator-jwt");
    assert.equal(secretLine(env, "POSTGRES_PASSWORD"), "operator-pg");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("absent secret lines are appended without touching the rest", () => {
  const dir = mkdtempSync(join(tmpdir(), "genenv-append-"));
  try {
    const envPath = join(dir, ".env.deploy");
    writeFileSync(envPath, "EXAM_PORT=3001\n", "utf-8");
    const result = runGenerator(envPath, join(dir, ".absent-dev-env"));
    assert.equal(result.status, 0, result.stderr);
    const env = readFileSync(envPath, "utf-8");
    assert.match(env, /^EXAM_PORT=3001$/m);
    assert.ok(secretLine(env, "JWT_SECRET"));
    assert.ok(secretLine(env, "POSTGRES_PASSWORD"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("quoted-empty secrets are filled in place (Windows PowerShell style)", () => {
  const dir = mkdtempSync(join(tmpdir(), "genenv-quoted-"));
  try {
    const envPath = join(dir, ".env.deploy");
    writeFileSync(envPath, "JWT_SECRET=\"\"\nPOSTGRES_PASSWORD=''\n", "utf-8");
    const result = runGenerator(envPath, join(dir, ".absent-dev-env"));
    assert.equal(result.status, 0, result.stderr);
    const env = readFileSync(envPath, "utf-8");
    assert.match(env, /^JWT_SECRET=[0-9a-f]{64}$/m);
    assert.match(env, /^POSTGRES_PASSWORD=[0-9a-f]{64}$/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── PR #322 review P1-1: legacy .env → .env.deploy migration ─────────────
// A legacy dev .env (pre-split install) carries the deployment secrets. On
// first .env.deploy creation they must be copied exactly — especially
// POSTGRES_PASSWORD, which the existing data volume still uses. A second run
// must not rotate anything.

function legacyDevEnv() {
  return [
    'DATABASE_URL="postgresql://exam:exam@localhost:15432/exam"',
    "APP_MODE=development",
    "NODE_ENV=development",
    "APP_PORT=3000",
    "HOST=0.0.0.0",
    "JWT_SECRET=legacy-jwt-A",
    "POSTGRES_PASSWORD=legacy-pg-B",
    "POSTGRES_USER=exam",
    "POSTGRES_DB=exam",
  ].join("\n");
}

test("legacy .env secrets are preserved exactly into a fresh .env.deploy", () => {
  const dir = mkdtempSync(join(tmpdir(), "genenv-legacy-"));
  try {
    const envPath = join(dir, ".env.deploy");
    const legacyPath = join(dir, ".env");
    writeFileSync(legacyPath, `${legacyDevEnv()}\n`, "utf-8");

    const result = runGenerator(envPath, legacyPath);
    assert.equal(result.status, 0, result.stderr);
    const env = readFileSync(envPath, "utf-8");

    assert.equal(secretLine(env, "JWT_SECRET"), "legacy-jwt-A");
    assert.equal(secretLine(env, "POSTGRES_PASSWORD"), "legacy-pg-B");
    assert.equal(secretLine(env, "POSTGRES_USER"), "exam");
    assert.equal(secretLine(env, "POSTGRES_DB"), "exam");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("legacy migration second run does not rotate the preserved secrets", () => {
  const dir = mkdtempSync(join(tmpdir(), "genenv-legacy-2nd-"));
  try {
    const envPath = join(dir, ".env.deploy");
    const legacyPath = join(dir, ".env");
    writeFileSync(legacyPath, `${legacyDevEnv()}\n`, "utf-8");

    runGenerator(envPath, legacyPath);
    const first = readFileSync(envPath, "utf-8");
    const secondResult = runGenerator(envPath, legacyPath);
    assert.equal(secondResult.status, 0, secondResult.stderr);
    const second = readFileSync(envPath, "utf-8");

    assert.equal(secretLine(second, "JWT_SECRET"), "legacy-jwt-A");
    assert.equal(secretLine(second, "POSTGRES_PASSWORD"), "legacy-pg-B");
    assert.equal(secretLine(second, "POSTGRES_USER"), "exam");
    assert.equal(second, first, "second run must leave .env.deploy untouched");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("explicit .env.deploy secret wins over a legacy .env value", () => {
  const dir = mkdtempSync(join(tmpdir(), "genenv-legacy-explicit-"));
  try {
    const envPath = join(dir, ".env.deploy");
    const legacyPath = join(dir, ".env");
    writeFileSync(legacyPath, `${legacyDevEnv()}\n`, "utf-8");
    writeFileSync(
      envPath,
      readFileSync(EXAMPLE, "utf-8")
        .replace(/^JWT_SECRET=.*$/m, "JWT_SECRET=deploy-operator-jwt")
        .replace(
          /^POSTGRES_PASSWORD=.*$/m,
          "POSTGRES_PASSWORD=deploy-operator-pg",
        ),
      "utf-8",
    );

    const result = runGenerator(envPath, legacyPath);
    assert.equal(result.status, 0, result.stderr);
    const env = readFileSync(envPath, "utf-8");
    assert.equal(secretLine(env, "JWT_SECRET"), "deploy-operator-jwt");
    assert.equal(secretLine(env, "POSTGRES_PASSWORD"), "deploy-operator-pg");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("post-split dev-only .env (no deployment secrets) is ignored: fresh secrets are generated", () => {
  const dir = mkdtempSync(join(tmpdir(), "genenv-legacy-none-"));
  try {
    const envPath = join(dir, ".env.deploy");
    const legacyPath = join(dir, ".env");
    writeFileSync(
      legacyPath,
      [
        "DEV_API_PORT=3000",
        "VITE_PORT=5173",
        "DB_HOST_PORT=5432",
        "APP_MODE=development",
        "NODE_ENV=development",
      ].join("\n") + "\n",
      "utf-8",
    );

    const result = runGenerator(envPath, legacyPath);
    assert.equal(result.status, 0, result.stderr);
    const env = readFileSync(envPath, "utf-8");
    const jwt = secretLine(env, "JWT_SECRET");
    const pg = secretLine(env, "POSTGRES_PASSWORD");
    assert.ok(jwt && /^[0-9a-f]{64}$/.test(jwt), "fresh JWT_SECRET generated");
    assert.ok(
      pg && /^[0-9a-f]{64}$/.test(pg),
      "fresh POSTGRES_PASSWORD generated",
    );
    assert.notEqual(jwt, pg);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── #321: EXAM_IMAGE is derived from the release version authority ────────
// The operator image pin must be ghcr.io/jnhu76/exam:<.release-version> —
// derived at generation time, never an independently maintained copy that
// can silently drift from the release authority.

const RELEASE_VERSION = readFileSync(
  join(__dirname, "..", ".release-version"),
  "utf-8",
).trim();

test("EXAM_IMAGE is derived from .release-version on first run (#321)", () => {
  const dir = mkdtempSync(join(tmpdir(), "genenv-image-first-"));
  try {
    const envPath = join(dir, ".env.deploy");
    const absentLegacy = join(dir, ".absent-dev-env");
    const result = runGenerator(envPath, absentLegacy);
    assert.equal(result.status, 0, result.stderr);

    const env = readFileSync(envPath, "utf-8");
    assert.match(RELEASE_VERSION, /^v\d+\.\d+\.\d+$/);
    assert.equal(
      secretLine(env, "EXAM_IMAGE"),
      `ghcr.io/jnhu76/exam:${RELEASE_VERSION}`,
      "EXAM_IMAGE must pin the current release version",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("explicit EXAM_IMAGE wins over the derived pin (never rotated)", () => {
  const dir = mkdtempSync(join(tmpdir(), "genenv-image-explicit-"));
  try {
    const envPath = join(dir, ".env.deploy");
    const absentLegacy = join(dir, ".absent-dev-env");
    writeFileSync(
      envPath,
      readFileSync(EXAMPLE, "utf-8").replace(
        /^EXAM_IMAGE=.*$/m,
        "EXAM_IMAGE=registry.mirror.internal/exam:v9.9.9",
      ),
      "utf-8",
    );

    const result = runGenerator(envPath, absentLegacy);
    assert.equal(result.status, 0, result.stderr);
    const env = readFileSync(envPath, "utf-8");
    assert.equal(
      secretLine(env, "EXAM_IMAGE"),
      "registry.mirror.internal/exam:v9.9.9",
      "an explicit operator pin must never be overwritten",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("quoted stale canonical pin + blank sibling: re-pinned, never duplicated", () => {
  const dir = mkdtempSync(join(tmpdir(), "genenv-image-quoted-"));
  try {
    const envPath = join(dir, ".env.deploy");
    const absentLegacy = join(dir, ".absent-dev-env");
    // The reviewer repro (#346): the shipped example carries a blank
    // EXAM_IMAGE= line; an operator who hand-edits the stale pin in
    // QUOTED dotenv form creates two keys. Duplicate keys are last-wins
    // in dotenv/--env-file — the stale quoted value must not survive.
    writeFileSync(
      envPath,
      readFileSync(EXAMPLE, "utf-8").replace(
        /^EXAM_IMAGE=.*$/m,
        'EXAM_IMAGE="ghcr.io/jnhu76/exam:v0.0.0"',
      ),
      "utf-8",
    );
    // reintroduce the blank sibling as the reviewer found it
    writeFileSync(
      envPath,
      readFileSync(envPath, "utf-8").replace(
        /^EXAM_IMAGE=.*$/m,
        'EXAM_IMAGE="ghcr.io/jnhu76/exam:v0.0.0"\nEXAM_IMAGE=',
      ),
      "utf-8",
    );

    const result = runGenerator(envPath, absentLegacy);
    assert.equal(result.status, 0, result.stderr);
    const env = readFileSync(envPath, "utf-8");
    const matches = env.match(/^EXAM_IMAGE=.*$/gm) ?? [];
    assert.equal(matches.length, 1, "exactly one EXAM_IMAGE key must remain");
    assert.equal(
      matches[0],
      `EXAM_IMAGE=ghcr.io/jnhu76/exam:${RELEASE_VERSION}`,
      "the stale quoted pin must be re-pinned to the current release",
    );
    assert.match(result.stdout, /re-pinned/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("canonical EXAM_IMAGE pin follows .release-version on re-run (upgrade drift)", () => {
  const dir = mkdtempSync(join(tmpdir(), "genenv-image-repin-"));
  try {
    const envPath = join(dir, ".env.deploy");
    const absentLegacy = join(dir, ".absent-dev-env");
    // v0.0.0 is a canonical pin SHAPE (ghcr.io/jnhu76/exam:vX.Y.Z) for an
    // older release — exactly what an operator's .env.deploy holds after
    // `git pull` to the next version. generate-env must re-pin it to the
    // current .release-version instead of preserving a stale pin.
    writeFileSync(
      envPath,
      readFileSync(EXAMPLE, "utf-8").replace(
        /^EXAM_IMAGE=.*$/m,
        "EXAM_IMAGE=ghcr.io/jnhu76/exam:v0.0.0",
      ),
      "utf-8",
    );

    const result = runGenerator(envPath, absentLegacy);
    assert.equal(result.status, 0, result.stderr);
    const env = readFileSync(envPath, "utf-8");
    assert.equal(
      secretLine(env, "EXAM_IMAGE"),
      `ghcr.io/jnhu76/exam:${RELEASE_VERSION}`,
      "a stale canonical pin must follow the current .release-version",
    );
    assert.match(result.stdout, /re-pinned/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
