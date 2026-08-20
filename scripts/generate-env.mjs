#!/usr/bin/env node
// First-run setup: create .env from .env.example (if missing) and fill empty
// secrets. Works on Linux/macOS/WSL and Windows PowerShell — the only
// prerequisite is Node, which the repo already requires.
//
//   node scripts/generate-env.mjs
//
// Secret contract: first run → generate; existing value → preserve. Re-running
// against an initialized .env never rotates a secret.
//
// Optional argument: a .env path to operate on (defaults to repo-root .env).

import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = process.argv[2] ? resolve(process.argv[2]) : join(root, ".env");
const examplePath = join(root, ".env.example");

if (!existsSync(envPath)) {
  copyFileSync(examplePath, envPath);
  console.log(`Created ${envPath} from .env.example`);
}

const SECRET_KEYS = ["JWT_SECRET", "POSTGRES_PASSWORD"];

let env = readFileSync(envPath, "utf-8");
const original = env;

for (const key of SECRET_KEYS) {
  const secret = randomBytes(32).toString("hex");
  // Fill an existing empty `KEY=` line in place (matches `KEY=""`, `KEY=''`).
  const filled = env.replace(
    new RegExp(`^${key}=(?:""|'')?[ \\t]*$`, "m"),
    `${key}=${secret}`,
  );
  if (filled !== env) {
    env = filled;
    console.log(`${key} written to ${envPath}`);
  } else if (new RegExp(`^${key}=\\S`, "m").test(env)) {
    console.log(`${key} already set in ${envPath}; leaving it unchanged.`);
  } else {
    // No active KEY= line (commented or absent): append one.
    const separator = env.endsWith("\n") ? "" : "\n";
    env = `${env}${separator}${key}=${secret}\n`;
    console.log(`${key} appended to ${envPath}`);
  }
}

if (env !== original) {
  writeFileSync(envPath, env);
}

console.log("Next: docker compose up -d --build");
