#!/usr/bin/env node
/**
 * Regression guard: verify package script naming honesty.
 *
 * Current rules:
 *   - format:write must not exist (format is canonical).
 *   - lint:quality must exist as the canonical code-quality script.
 *   - test:integration must be documented as an alias of test.
 *   - every verifier-shaped script is gate-wired or explicitly manual (#380).
 */
import { readdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));

const errors = [];

if (pkg.scripts["format:write"] !== undefined) {
  errors.push(
    "Remove root 'format:write'; 'format' is the canonical prettier --write script.",
  );
}

if (!pkg.scripts["lint:quality"]?.includes("check-code-quality.mjs")) {
  errors.push(
    "Root 'lint:quality' must be the canonical code-quality checker.",
  );
}

if (!pkg.scripts["lint"]?.includes("check-code-quality.mjs")) {
  errors.push("Root 'lint' must run check-code-quality.mjs (legacy alias).");
}

const testIntegration = pkg.scripts["test:integration"];
if (!testIntegration || !testIntegration.includes("turbo test:integration")) {
  errors.push(
    "Root 'test:integration' must be an alias of turbo test:integration.",
  );
}

// ---------------------------------------------------------------------------
// Meta-guard (#380): every verifier-shaped script must be reachable from an
// enforced package/gate script OR explicitly declared manual.
//
// Verifier scope (naming boundary, per issue non-goals — runners/backup/lib
// are operator-facing or support modules and are deliberately out of scope):
//   - scripts/**/check-*.mjs (recursive, includes *.test.mjs suites)
//   - scripts/repository-contract/*.mjs (includes this guard itself, so the
//     guard's own wiring is covered by its own rule)
//
// Wired = the file's basename appears in the command line of a root package
// script named `lint`, `test`, `verify` or a `lint:`/`test:`/`verify:`
// variant. One hop is sufficient because aggregate gates (lint:ui-gates,
// lint:repo-contract, ...) list their checkers verbatim; the inclusion of
// those aggregates in verify:static is pinned separately by
// verify-static-includes-guards.mjs.
// ---------------------------------------------------------------------------
const MANUAL_TOOLS = {
  "check-frontend-primitives.mjs":
    "manual heuristic scanner — exits 1 with 2 known findings on the current tree, so it is not CI-stable; dispositioned EXPLICIT_MANUAL by #379 with an executability smoke (test:frontend-primitives-smoke)",
};

const GATE_SCRIPT_RE = /^(?:lint|test|verify)(?::.*)?$/;

const wiredBasenames = new Set(
  Object.entries(pkg.scripts)
    .filter(([name, cmd]) => GATE_SCRIPT_RE.test(name) && cmd)
    .flatMap(([, cmd]) => cmd.split(/\s+/).map((tok) => tok.split("/").pop())),
);

async function walk(dir, out = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (["node_modules", "dist"].includes(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) await walk(full, out);
    else out.push(full);
  }
  return out;
}

const scriptsDir = join(ROOT, "scripts");
// The two scope sources overlap for repository-contract/check-*.mjs files;
// dedupe by path so a file is inventoried exactly once.
const verifierPaths = [
  ...new Set([
    ...(await walk(scriptsDir)).filter((f) =>
      /[/\\]check-[^/\\]*\.mjs$/.test(f),
    ),
    ...(
      await readdir(join(scriptsDir, "repository-contract"), {
        withFileTypes: true,
      })
    )
      .filter((e) => e.isFile() && e.name.endsWith(".mjs"))
      .map((e) => join(scriptsDir, "repository-contract", e.name)),
  ]),
];

// Guard against silent basename collisions (wiring is matched by basename).
const byBasename = new Map();
for (const p of verifierPaths) {
  const base = p.split(/[/\\]/).pop();
  if (byBasename.has(base)) {
    errors.push(
      `Verifier basename collision: ${base} (${p}, ${byBasename.get(base)})`,
    );
  }
  byBasename.set(base, p);
}

for (const [base, path] of byBasename) {
  const wired = wiredBasenames.has(base);
  const manual = base in MANUAL_TOOLS;
  if (wired && manual) {
    errors.push(
      `${base} is gate-wired but also in MANUAL_TOOLS — remove the allowlist entry.`,
    );
  } else if (!wired && !manual) {
    errors.push(
      `Orphan verifier: scripts/${base} is neither wired into any lint:/test:/verify: package script nor declared in MANUAL_TOOLS.`,
    );
  } else if (manual) {
    const head = readFileSync(path, "utf8").slice(0, 2048);
    if (!/manual/i.test(head)) {
      errors.push(
        `${base} is in MANUAL_TOOLS but its file header does not declare manual usage.`,
      );
    }
  }
}
for (const base of Object.keys(MANUAL_TOOLS)) {
  if (!byBasename.has(base)) {
    errors.push(
      `MANUAL_TOOLS entry ${base} does not match any verifier-shaped file (deleted or renamed?).`,
    );
  }
  if (!MANUAL_TOOLS[base]?.trim()) {
    errors.push(`MANUAL_TOOLS entry ${base} needs a non-empty reason.`);
  }
}

if (errors.length > 0) {
  console.error("FAIL: Package script contract regression:");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log("PASS: Package script naming contract upheld.");
