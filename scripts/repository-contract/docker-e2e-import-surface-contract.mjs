#!/usr/bin/env node
/**
 * Regression guard (#503): the Docker E2E container must mount every
 * repository source surface the e2e suite imports.
 *
 * apps/e2e specs intentionally import web-side authorities by relative path
 * (ui-governance-1.spec.ts → ../../web/src/{statusMeta,statusMetaUtils,i18n}).
 * Those imports ARE the drift alarm: a web-side vocabulary change turns the
 * Docker E2E gate red at compile/load time. The e2e compose service must
 * therefore expose the same surfaces, or the canonical `pnpm e2e:docker`
 * aborts at module load with:
 *
 *   Error: Cannot find module '/app/apps/web/...' imported from
 *          /app/apps/e2e/e2e/ui-governance-1.spec.ts
 *
 * CI never exercises the Docker path (its E2E lane runs Playwright against a
 * full checkout), which is exactly why this breakage went unnoticed — the
 * guard must be a static gate, not a runtime witness.
 *
 * The required surface set is DERIVED from the specs themselves (no
 * hand-maintained import allowlist):
 *   1. scan the canonical suite surfaces (apps/e2e config root, e2e/, lib/)
 *      for relative import specifiers — comment text is stripped first;
 *   2. resolve each specifier against the importing file to a
 *      repo-root-relative path;
 *   3. reduce to the top-level surface it lands in (apps/<pkg>,
 *      packages/<pkg>, ...) — packages and node_modules resolve through the
 *      pnpm symlink farm and are mounted, so only genuinely missing surfaces
 *      fail;
 *   4. require docker-compose.test.yml's e2e service to mount every required
 *      surface, read-only (the suite's own home apps/e2e is legitimately rw —
 *      Playwright writes test-results/ there).
 *
 * patrol/ specs are out of scope: playwright.config.ts testDir is ./e2e, so
 * they are not part of the canonical suite.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
const COMPOSE_TEST = join(ROOT, "docker-compose.test.yml");
const E2E_DIR = join(ROOT, "apps", "e2e");
const SCAN_DIRS = ["", "e2e", "lib"]; // relative to apps/e2e

const SPECIFIER_RE =
  /\bfrom\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

const errors = [];

// ---------- 1. derive required surfaces from the suite ----------

/** All .ts files under dir, recursively (directory must exist). */
function listTsFiles(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) out.push(...listTsFiles(full));
    else if (e.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

/** repo-root-relative surface a resolved import lands in, or null. */
function surfaceOf(resolved) {
  const segs = resolved.split("/");
  if (segs[0] === "apps" || segs[0] === "packages") {
    return segs[1] ? `${segs[0]}/${segs[1]}` : segs[0];
  }
  return segs[0];
}

// surface -> first importer that requires it (for actionable errors)
const requiredSurfaces = new Map();

for (const rel of SCAN_DIRS) {
  const dir = join(E2E_DIR, rel);
  let files;
  try {
    files = listTsFiles(dir);
  } catch (err) {
    if (err && err.code === "ENOENT") {
      errors.push(
        `apps/e2e/${rel} is missing — the canonical e2e suite surface ` +
          "cannot be derived (#503 import-surface guard).",
      );
      continue;
    }
    throw err;
  }
  for (const file of files) {
    const text = readFileSync(file, "utf-8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    const importerRepo = posix.normalize(
      relative(ROOT, file).split(sep).join("/"),
    );
    const importerDir = posix.dirname(importerRepo);
    for (const m of text.matchAll(SPECIFIER_RE)) {
      const spec = m[1] ?? m[2];
      if (!spec || !spec.startsWith(".")) continue; // bare → node_modules
      const resolved = posix.normalize(posix.join(importerDir, spec));
      // Same suite surface (apps/e2e) — mounted rw for test artifacts.
      if (resolved === "apps/e2e" || resolved.startsWith("apps/e2e/")) {
        continue;
      }
      const surface = surfaceOf(resolved);
      if (surface && !requiredSurfaces.has(surface)) {
        requiredSurfaces.set(surface, importerRepo);
      }
    }
  }
}

// ---------- 2. parse docker-compose.test.yml e2e volumes ----------

let composeText;
try {
  composeText = readFileSync(COMPOSE_TEST, "utf-8");
} catch {
  console.error(
    "FAIL: docker-compose.test.yml is missing from repository root.",
  );
  process.exit(1);
}

function extractServiceBlock(text, serviceName) {
  const lines = text.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^  ([A-Za-z0-9_.-]+):\s*(?:#.*)?$/);
    if (m && m[1] === serviceName) {
      start = i;
      break;
    }
  }
  if (start === -1) return null;
  const block = [lines[start]];
  for (let j = start + 1; j < lines.length; j++) {
    if (/^ {4,}/.test(lines[j]) || /^\s*$/.test(lines[j])) {
      block.push(lines[j]);
    } else {
      break;
    }
  }
  return block.join("\n");
}

const e2eBlock = extractServiceBlock(composeText, "e2e");
const mounts = []; // {host, target, ro}
if (!e2eBlock) {
  errors.push(
    "docker-compose.test.yml has no 'e2e' service — the Docker E2E " +
      "topology is missing (#503 import-surface guard).",
  );
} else {
  const lines = e2eBlock.split(/\r?\n/);
  let inVolumes = false;
  for (const line of lines) {
    if (/^\s*volumes:\s*$/.test(line)) {
      inVolumes = true;
      continue;
    }
    if (inVolumes && /^\s{6}-/.test(line)) {
      // Strip trailing comments; split host:target[:opts] (short syntax).
      const spec = line
        .slice(line.indexOf("-") + 1)
        .trim()
        .replace(/\s+#.*$/, "");
      const parts = spec.split(":");
      if (parts.length < 2) {
        errors.push(
          `Cannot parse e2e volume entry '${line.trim()}' — expected short ` +
            "syntax '<host>:<container>[:opts]' (#503 import-surface guard).",
        );
        continue;
      }
      mounts.push({
        host: parts[0],
        target: parts[1],
        ro: parts.slice(2).join(":").split(",").includes("ro"),
      });
    } else if (inVolumes && /^\s*#/.test(line)) {
      // Comment inside the volumes block — does not end it.
      continue;
    } else if (inVolumes && /^\s+\S/.test(line)) {
      inVolumes = false;
    }
  }
}

// ---------- 3. coverage check ----------

for (const [surface, importer] of requiredSurfaces) {
  const need = `/app/${surface}`;
  const cover = mounts.find(
    (m) => m.target === need || need.startsWith(`${m.target}/`),
  );
  if (!cover) {
    errors.push(
      `Docker E2E container must mount '${need}' — imported by ` +
        `${importer} (specs resolve cross-package sources inside the ` +
        "container; the canonical pnpm e2e:docker aborts at module load " +
        `without it). Add '- ./${surface}:/app/${surface}:ro' to the e2e ` +
        "service volumes (#503).",
    );
    continue;
  }
  if (!cover.ro) {
    errors.push(
      `Docker E2E mount '${cover.host}' (${cover.target}) must be ` +
        `read-only (:ro) — required by ${importer}; tests must never ` +
        "write into repository source surfaces (#503).",
    );
  }
}

if (errors.length > 0) {
  console.error("FAIL: Docker E2E import-surface contract regression (#503):");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(
  "PASS: Docker E2E container mounts the full suite import surface " +
    `(${[...requiredSurfaces.keys()].join(", ") || "no cross-package imports"}).`,
);
