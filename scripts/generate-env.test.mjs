// Contract tests for scripts/generate-env.mjs.
//
// The generator owns the Docker first-run secret contract:
//   first run → generate; second run → preserve; existing value → preserve.
// A violation of "never rotate" would silently invalidate issued JWTs or
// break the running PostgreSQL credential, so the contract is test-enforced.
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
const EXAMPLE = join(__dirname, "..", ".env.example");

function runGenerator(envPath) {
  return child_process.spawnSync(process.execPath, [GENERATOR, envPath], {
    encoding: "utf-8",
  });
}

function secretLine(envText, key) {
  const match = envText.match(new RegExp(`^${key}=(\\S+)$`, "m"));
  return match ? match[1] : null;
}

test("first run: .env is created from .env.example and both empty secrets are filled", () => {
  const dir = mkdtempSync(join(tmpdir(), "genenv-first-"));
  try {
    const envPath = join(dir, ".env");
    const result = runGenerator(envPath);
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
    const envPath = join(dir, ".env");
    runGenerator(envPath);
    const first = readFileSync(envPath, "utf-8");
    const result = runGenerator(envPath);
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

test("operator-set secrets are preserved", () => {
  const dir = mkdtempSync(join(tmpdir(), "genenv-existing-"));
  try {
    const envPath = join(dir, ".env");
    writeFileSync(
      envPath,
      readFileSync(EXAMPLE, "utf-8")
        .replace(/^JWT_SECRET=.*$/m, "JWT_SECRET=operator-jwt")
        .replace(/^POSTGRES_PASSWORD=.*$/m, "POSTGRES_PASSWORD=operator-pg"),
      "utf-8",
    );
    const result = runGenerator(envPath);
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
    const envPath = join(dir, ".env");
    writeFileSync(envPath, "APP_PORT=3000\n", "utf-8");
    const result = runGenerator(envPath);
    assert.equal(result.status, 0, result.stderr);
    const env = readFileSync(envPath, "utf-8");
    assert.match(env, /^APP_PORT=3000$/m);
    assert.ok(secretLine(env, "JWT_SECRET"));
    assert.ok(secretLine(env, "POSTGRES_PASSWORD"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("quoted-empty secrets are filled in place (Windows PowerShell style)", () => {
  const dir = mkdtempSync(join(tmpdir(), "genenv-quoted-"));
  try {
    const envPath = join(dir, ".env");
    writeFileSync(envPath, "JWT_SECRET=\"\"\nPOSTGRES_PASSWORD=''\n", "utf-8");
    const result = runGenerator(envPath);
    assert.equal(result.status, 0, result.stderr);
    const env = readFileSync(envPath, "utf-8");
    assert.match(env, /^JWT_SECRET=[0-9a-f]{64}$/m);
    assert.match(env, /^POSTGRES_PASSWORD=[0-9a-f]{64}$/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
