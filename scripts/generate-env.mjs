#!/usr/bin/env node
// First-run setup: create .env from .env.example (if missing) and fill an
// empty JWT_SECRET. Works on Linux/macOS/WSL and Windows PowerShell — the
// only prerequisite is Node, which the repo already requires.
//
//   node scripts/generate-env.mjs
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

const secret = randomBytes(32).toString("hex");
const env = readFileSync(envPath, "utf-8");

// Fill an existing empty JWT_SECRET= line in place (matches `JWT_SECRET=`,
// `JWT_SECRET=""`, `JWT_SECRET=''`).
const filled = env.replace(
  /^JWT_SECRET=(?:""|'')?[ \t]*$/m,
  `JWT_SECRET=${secret}`,
);
if (filled !== env) {
  writeFileSync(envPath, filled);
  console.log(`JWT_SECRET written to ${envPath}`);
} else if (/^JWT_SECRET=\S/m.test(env)) {
  console.log(`JWT_SECRET already set in ${envPath}; leaving it unchanged.`);
} else {
  // No active JWT_SECRET line (commented or absent): append one.
  const separator = env.endsWith("\n") ? "" : "\n";
  writeFileSync(envPath, `${env}${separator}JWT_SECRET=${secret}\n`);
  console.log(`JWT_SECRET appended to ${envPath}`);
}

console.log("Next: docker compose up -d --build");
