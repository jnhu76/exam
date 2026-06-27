#!/usr/bin/env node
// scripts/audit-koi-ui-usage.mjs
//
// Scans the codebase for any remaining koi-ui imports, JSX usage,
// or legacy component references. Outputs a markdown report and JSON.
//
// Usage: node scripts/audit-koi-ui-usage.mjs

import fs from "node:fs";
import path from "node:path";

const roots = ["apps", "packages"].filter((dir) => fs.existsSync(dir));
const ignoreDirs = new Set([
  "node_modules",
  ".next",
  "dist",
  "build",
  "coverage",
  ".turbo",
  ".git",
]);

const files = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignoreDirs.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }
    if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
}

for (const root of roots) walk(root);

// ── Patterns to detect ──

// 1. Legacy component imports (PageHeader, ListToolbar, DataToolbar, DataTableShell)
const legacyComponentPatterns = [
  /PageHeader/g,
  /ListToolbar/g,
  /DataToolbar/g,
  /DataTableShell/g,
];

// 2. Old Badge variant usage that should be AdminStatusTag
const badgeVariantPattern = /<Badge\s+variant=["']/g;

// 3. space-x / space-y usage (should be gap-)
const spacePattern = /\bspace-[xy]-\d/g;

// 4. w-\d+\s+h-\d+ (should be size-* when equal)
const sizePattern = /\bw-(\d+)\s+h-\1\b/g;

// 5. Hardcoded color values (not tokens)
const hardcodedColorPattern =
  /(?:bg|text|border)-(red|blue|green|yellow|orange|purple|pink|gray|slate|zinc|neutral|stone|emerald|teal|cyan|sky|indigo|violet|fuchsia|rose)-\d{2,3}/g;

// 6. Koi-specific references
const koiRefPattern = /koi-ui|koi_admin|KoiAdmin/gi;

const results = {
  legacyComponents: [],
  badgeVariants: [],
  spaceClasses: [],
  sizeClasses: [],
  hardcodedColors: [],
  koiRefs: [],
};

for (const file of files) {
  const content = fs.readFileSync(file, "utf8");
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    const loc = `${file}:${lineNum}`;

    for (const pattern of legacyComponentPatterns) {
      pattern.lastIndex = 0;
      if (pattern.test(line)) {
        results.legacyComponents.push({ loc, match: line.trim() });
      }
    }

    badgeVariantPattern.lastIndex = 0;
    if (badgeVariantPattern.test(line)) {
      results.badgeVariants.push({ loc, match: line.trim() });
    }

    spacePattern.lastIndex = 0;
    if (spacePattern.test(line)) {
      results.spaceClasses.push({ loc, match: line.trim() });
    }

    sizePattern.lastIndex = 0;
    if (sizePattern.test(line)) {
      results.sizeClasses.push({ loc, match: line.trim() });
    }

    hardcodedColorPattern.lastIndex = 0;
    if (hardcodedColorPattern.test(line)) {
      results.hardcodedColors.push({ loc, match: line.trim() });
    }

    koiRefPattern.lastIndex = 0;
    if (koiRefPattern.test(line)) {
      results.koiRefs.push({ loc, match: line.trim() });
    }
  }
}

// ── Report ──

const totalIssues =
  results.legacyComponents.length +
  results.badgeVariants.length +
  results.spaceClasses.length +
  results.sizeClasses.length +
  results.hardcodedColors.length;

function section(title, items, maxShow = 20) {
  if (items.length === 0) return [`## ${title}: 0 issues ✅`, ""];
  const lines = [`## ${title}: ${items.length} issues`, ""];
  for (const item of items.slice(0, maxShow)) {
    lines.push(`- \`${item.loc}\` — ${item.match}`);
  }
  if (items.length > maxShow) {
    lines.push(`- ... and ${items.length - maxShow} more`);
  }
  lines.push("");
  return lines;
}

const report = [
  "# Koi-UI Migration Audit",
  "",
  `- Scanned: ${files.length} files`,
  `- Total issues: ${totalIssues}`,
  "",
  ...section(
    "Legacy Components (should use AdminShell/AdminStatusTag)",
    results.legacyComponents,
  ),
  ...section(
    "Badge variant= (should use AdminStatusTag)",
    results.badgeVariants,
  ),
  ...section("space-x/y (should use gap-)", results.spaceClasses),
  ...section("w-N h-N same value (should use size-N)", results.sizeClasses),
  ...section("Hardcoded colors (should use tokens)", results.hardcodedColors),
  ...section("Koi-UI references (informational)", results.koiRefs, 50),
].join("\n");

fs.mkdirSync("docs/ui", { recursive: true });
fs.writeFileSync("docs/ui/koi-migration-audit.md", report);
fs.writeFileSync(
  "docs/ui/koi-migration-audit.json",
  JSON.stringify(results, null, 2),
);

console.log(report);
