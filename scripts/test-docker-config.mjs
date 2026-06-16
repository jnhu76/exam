#!/usr/bin/env node
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");

function readFile(path) {
  return readFileSync(join(rootDir, path), "utf-8");
}

const tests = {
  "Dockerfile pnpm version is fixed": () => {
    const dockerfile = readFile("Dockerfile");
    const lines = dockerfile.split("\n");

    const basePnpmLine = lines.find((l) =>
      l.includes("corepack prepare pnpm@"),
    );
    const runnerPnpmLine = lines.find(
      (l) => l.includes("FROM node") && l.includes("runner"),
    );

    if (!basePnpmLine?.includes("pnpm@11.1.2")) {
      throw new Error(`Base stage pnpm not fixed: ${basePnpmLine}`);
    }
    if (
      !dockerfile.includes(
        "RUN corepack enable && corepack prepare pnpm@11.1.2 --activate",
      )
    ) {
      throw new Error("Runner stage pnpm not fixed to 11.1.2");
    }
  },

  "Dockerfile copies packages for migrations": () => {
    const dockerfile = readFile("Dockerfile");
    if (!dockerfile.includes("COPY packages/ packages/")) {
      throw new Error("Dockerfile should COPY packages/ (includes migrations)");
    }
  },

  "docker-compose.yml JWT_SECRET has no default": () => {
    const compose = readFile("docker-compose.yml");
    if (compose.includes("JWT_SECRET: ${JWT_SECRET:-")) {
      throw new Error("JWT_SECRET should not have default value in production");
    }
  },

  "docker-compose.dev.yml uses PostgreSQL 18": () => {
    const compose = readFile("docker-compose.dev.yml");
    if (!compose.includes("postgres:18")) {
      throw new Error("Dev compose (local DB) should use PostgreSQL 18");
    }
  },

  ".env.example JWT_SECRET has no default": () => {
    const envExample = readFile(".env.example");
    const lines = envExample.split("\n");
    const jwtLine = lines.find((l) => l.startsWith("JWT_SECRET="));
    if (
      jwtLine &&
      (jwtLine.includes("change-me") || jwtLine === 'JWT_SECRET=""')
    ) {
      throw new Error(
        "JWT_SECRET in .env.example should be commented or empty placeholder",
      );
    }
  },

  ".env.example has PG configuration": () => {
    const envExample = readFile(".env.example");
    if (
      !envExample.includes("POSTGRES_USER") ||
      !envExample.includes("POSTGRES_PASSWORD") ||
      !envExample.includes("POSTGRES_DB")
    ) {
      throw new Error(".env.example should have PG configuration variables");
    }
  },

  "docker-entrypoint.sh migration path is correct": () => {
    const entrypoint = readFile("docker-entrypoint.sh");
    if (!entrypoint.includes("node dist/scripts/migrate.js")) {
      throw new Error("Entrypoint should call node dist/scripts/migrate.js");
    }
  },
};

console.log("Running Docker configuration tests...\n");

let passed = 0;
let failed = 0;

for (const [name, testFn] of Object.entries(tests)) {
  try {
    testFn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (error) {
    console.log(`✗ ${name}`);
    console.log(`  Error: ${error.message}\n`);
    failed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed`);

process.exit(failed > 0 ? 1 : 0);
