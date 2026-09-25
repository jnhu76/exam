#!/usr/bin/env node
/**
 * Docs router ↔ tree listing contract (#614 G5 guard 3).
 *
 * Relations checked:
 *   1. The docs/README.md ADR range expression ("ADR-001 … ADR-0NN") must
 *      match the actual docs/adr/ tree: every number from 001 to NN exists
 *      and no higher-numbered ADR exists.
 *   2. The docs/adr/README.md numeric index must list every ADR file present.
 *   3. Relative links in docs/README.md table rows must resolve.
 *
 * Historical failure caught (issue #611 DOC-005 / REC-04): docs/README.md's
 * range stopped at ADR-018 while ADR-019/020 existed, and the ADR-011
 * corrective amendment was absent from the index — the router was silently
 * incomplete.
 *
 * Negative controls: historical/archive material is unconstrained (only the
 * router's own tables and the numeric index are parsed); prose that merely
 * mentions an ADR number is not a range expression.
 *
 * Usage: node scripts/repository-contract/docs-router-contract.mjs [root]
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

const ROOT = process.argv[2]
  ? join(process.argv[2])
  : join(import.meta.dirname, "../..");
const errors = [];

// ── 1. ADR range expression ↔ docs/adr tree ──
const readme = readFileSync(join(ROOT, "docs/README.md"), "utf-8");
const range = readme.match(
  /\(adr\/ADR-(\d{3})-[^)]*\)[^|]*…[^|]*\(adr\/ADR-(\d{3})-[^)]*\)/,
);
const adrFiles = readdirSync(join(ROOT, "docs/adr")).filter((f) =>
  /^ADR-\d{3}/.test(f),
);
const present = new Set(
  adrFiles.map((f) => Number(f.match(/^ADR-(\d{3})/)[1])),
);
if (!range) {
  errors.push("docs/README.md: no ADR range expression found");
} else {
  const first = Number(range[1]);
  const last = Number(range[2]);
  for (let n = first; n <= last; n++) {
    if (!present.has(n)) {
      errors.push(
        `docs/README.md ADR range includes ADR-${String(n).padStart(3, "0")} but no such file exists`,
      );
    }
  }
  for (const n of present) {
    if (n > last) {
      errors.push(
        `docs/adr/ contains ADR-${String(n).padStart(3, "0")} but docs/README.md's range ends at ADR-${String(last).padStart(3, "0")}`,
      );
    }
    if (n < first) {
      errors.push(
        `docs/adr/ contains ADR-${String(n).padStart(3, "0")} but docs/README.md's range starts at ADR-${String(first).padStart(3, "0")}`,
      );
    }
  }
}

// ── 2. numeric index ↔ tree ──
const adrIndex = readFileSync(join(ROOT, "docs/adr/README.md"), "utf-8");
for (const f of adrFiles) {
  if (!adrIndex.includes(`(${f})`)) {
    errors.push(`docs/adr/README.md: numeric index does not link ${f}`);
  }
}

// ── 3. router table links resolve ──
const tableLines = readme
  .split("\n")
  .filter((l) => l.trimStart().startsWith("|"));
const link = /\]\(([^)#\s]+)(?:#[^)]*)?\)/g;
for (const line of tableLines) {
  for (const m of line.matchAll(link)) {
    const target = m[1];
    if (/^[a-z]+:\/\//i.test(target)) continue; // external
    const abs = resolve(dirname(join(ROOT, "docs/README.md")), target);
    if (!existsSync(abs)) {
      errors.push(
        `docs/README.md: table link target does not exist: ${target}`,
      );
      continue;
    }
    if (statSync(abs).isFile() === false && !target.endsWith("/")) {
      // directory targets are fine; nothing to check
    }
  }
}

if (errors.length > 0) {
  console.error("FAIL: docs router contract:");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log("PASS: docs router contract upheld.");
