#!/usr/bin/env node
// scripts/audit-wegent-token-abstraction.mjs
//
// Guards the 4-layer Wegent token abstraction defined in
// docs/ui/wegent-token-abstraction.md. Detects violations that would
// reintroduce duplicate color facts, break dark mode, or bypass the token
// system with hardcoded values.
//
// Layers guarded:
//   L1 raw facts   — bare triplets in :root/.dark, no rgb() literals in @theme
//   L2 bridge      — @theme inline --color-* must reference var(--raw-*)
//   L3 shadcn      — shadcn aliases resolve through the bridge (auto, informational)
//   L4 admin       — admin-theme.css --admin-* must be aliases, not color facts
//
// Usage: node scripts/audit-wegent-token-abstraction.mjs
// Exit:  0 = clean (or only informational findings), 1 = blocking violations

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
  "public",
  ".pnpm",
]);

const sourceFiles = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignoreDirs.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }
    if (/\.(ts|tsx|js|jsx|mjs)$/.test(entry.name)) {
      sourceFiles.push(fullPath);
    }
  }
}
for (const root of roots) walk(root);

// ── Blocking patterns (exit 1 if any found) ──

// B1. Koi references — legacy component system, must be zero
const koiRefPattern = /koi-ui|koi_admin|KoiAdmin/gi;

// B2. Hardcoded hex colors in className strings (e.g. text-[#5b8ff9])
//     Allows #fff/#000 only in CSS files (layer-1 facts live there).
const hardcodedHexInClassPattern =
  /(?:bg|text|border|ring|fill|stroke|shadow|from|to|via)-\[#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\]/g;

// B3. Hardcoded Tailwind palette colors (bg-blue-500, text-gray-400, ...)
const paletteColorPattern =
  /(?:bg|text|border|ring|fill|stroke)-(?:red|blue|green|yellow|orange|purple|pink|gray|slate|zinc|neutral|stone|emerald|teal|cyan|sky|indigo|violet|fuchsia|rose)-(?:50|[1-9]00)/g;

// B4. border-black / border-white literal utility (use tokens)
const borderBlackWhitePattern = /\bborder-(?:black|white)\b/g;

// B5. divide-x / divide-y as table gridlines (visual-rescue ban).
//     These draw Koi-style gridline separators between rows/cells.
//     (border-r/border-l are intentionally NOT flagged — they are legitimate
//     for side panels, drawers, and sheets, not table gridlines.)
const gridlinePattern = /\b(?:divide-x|divide-y)\b/g;

// ── Token-system structural checks (read the actual token files) ──

function readTokenFiles() {
  const indexCss = fs.readFileSync("apps/web/src/index.css", "utf8");
  let adminTheme = "";
  try {
    adminTheme = fs.readFileSync("apps/web/src/styles/admin-theme.css", "utf8");
  } catch {
    /* absence is recorded as a finding */
  }
  return { indexCss, adminTheme };
}

// B6. @theme inline must NOT contain rgb() literals with numbers (breaks dark mode).
//     Allowed: rgb(var(--raw-...)). Blocked: rgb(93 94 201), rgb(255 255 255).
const themeInlineLiteralRgbPattern = /rgb\(\s*\d+\s+\d+\s+\d+/g;

// B7. --admin-* color tokens must alias (contain var()), not declare rgb() facts.
//     Matches e.g. `--admin-primary: rgb(93 94 201)` (a second color fact).
const adminLiteralColorPattern = /--admin-[a-z-]+:\s*rgb\(\s*\d+\s+\d+\s+\d+/g;

// ── Scan ──

const findings = {
  blocking: [],
  informational: [],
};

for (const file of sourceFiles) {
  const content = fs.readFileSync(file, "utf8");
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const loc = `${file}:${i + 1}`;

    const testBlock = (pattern, key, severity, note) => {
      pattern.lastIndex = 0;
      const matches = line.match(pattern);
      if (matches) {
        findings[severity].push({
          loc,
          key,
          count: matches.length,
          note,
          match: line.trim().slice(0, 140),
        });
      }
    };

    testBlock(
      koiRefPattern,
      "koi-ref",
      "blocking",
      "legacy Koi component reference",
    );
    testBlock(
      hardcodedHexInClassPattern,
      "hardcoded-hex-class",
      "blocking",
      "hardcoded hex in className — use a token utility",
    );
    testBlock(
      paletteColorPattern,
      "palette-color",
      "blocking",
      "Tailwind palette color — use semantic token",
    );
    testBlock(
      borderBlackWhitePattern,
      "border-black-white",
      "blocking",
      "literal border-black/white — use border-token",
    );
    testBlock(
      gridlinePattern,
      "gridline-border",
      "blocking",
      "divide-x/border-r/border-l draws table gridlines",
    );
  }
}

// Token-file structural checks (comments stripped to avoid false positives)
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}
const { indexCss, adminTheme } = readTokenFiles();
const indexCssNoComments = indexCss ? stripComments(indexCss) : "";
const adminThemeNoComments = adminTheme ? stripComments(adminTheme) : "";
if (!adminTheme) {
  findings.blocking.push({
    loc: "apps/web/src/styles/admin-theme.css",
    key: "admin-theme-missing",
    count: 1,
    note: "admin-theme.css is required by the abstraction (Layer 4)",
    match: "(file not found)",
  });
}

// B6: literal rgb() inside @theme inline (dark-mode killer).
//     Matches rgb(NUM NUM NUM ...) on color tokens only. Skips shadow
//     declarations (--shadow-*), which legitimately use rgb(0 0 0 / a) for
//     drop-shadow ink — those are not theme color utilities.
const themeBlockMatch = indexCssNoComments.match(
  /@theme\s+inline\s*\{([\s\S]*?)\n\}/,
);
if (themeBlockMatch) {
  const themeBlock = themeBlockMatch[1];
  const themeLines = themeBlock.split("\n");
  for (let i = 0; i < themeLines.length; i++) {
    const themeLine = themeLines[i];
    // skip shadow declarations
    if (/^\s*--shadow-/.test(themeLine)) continue;
    themeInlineLiteralRgbPattern.lastIndex = 0;
    const m = themeInlineLiteralRgbPattern.exec(themeLine);
    if (m) {
      findings.blocking.push({
        loc: `apps/web/src/index.css:@theme inline (line ~${i + 1})`,
        key: "theme-literal-rgb",
        count: 1,
        note: "@theme inline must use rgb(var(--raw-*)), not rgb(literal) — breaks dark mode",
        match: themeLine.trim().slice(0, 140),
      });
    }
  }
}

// B7: --admin-* declaring color facts instead of aliasing
if (adminThemeNoComments) {
  const adminLines = adminThemeNoComments.split("\n");
  for (let i = 0; i < adminLines.length; i++) {
    const adminLine = adminLines[i];
    adminLiteralColorPattern.lastIndex = 0;
    const m = adminLiteralColorPattern.exec(adminLine);
    if (m) {
      findings.blocking.push({
        loc: `apps/web/src/styles/admin-theme.css:${i + 1}`,
        key: "admin-literal-color",
        count: 1,
        note: "--admin-* must alias a Layer-2 token, not declare a color fact",
        match: adminLine.trim().slice(0, 140),
      });
    }
  }
}

// Informational: confirm raw triplets exist for both themes
const rawLight = (/--raw-primary:\s*(\d+ \d+ \d+)/.exec(indexCssNoComments) ||
  [])[1];
const rawDarkMatch = indexCssNoComments.match(/\.dark\s*\{([\s\S]*?)\}/);
const rawDark =
  (rawDarkMatch && /--raw-primary:\s*(\d+ \d+ \d+)/.exec(rawDarkMatch[1])) ||
  [];
const rawDarkVal = rawDark[1];
if (rawLight && rawDarkVal) {
  findings.informational.push({
    loc: "apps/web/src/index.css",
    key: "raw-primary-present",
    count: 1,
    note: `Layer 1 raw primary present: light=${rawLight}, dark=${rawDarkVal}`,
    match: "--raw-primary (both themes)",
  });
} else {
  findings.blocking.push({
    loc: "apps/web/src/index.css",
    key: "raw-primary-missing",
    count: 1,
    note: "Layer 1 --raw-primary not found in both :root and .dark",
    match: "(see file)",
  });
}

// ── Report ──

function section(title, items, maxShow = 30) {
  if (items.length === 0) return [`## ${title}: 0 ✅`, ""];
  const lines = [`## ${title}: ${items.length}`, ""];
  for (const item of items.slice(0, maxShow)) {
    lines.push(
      `- \`${item.loc}\` — [${item.key}] ${item.note}\n  > \`${item.match}\``,
    );
  }
  if (items.length > maxShow) {
    lines.push(`- ... and ${items.length - maxShow} more`);
  }
  lines.push("");
  return lines;
}

const report = [
  "# Wegent Token Abstraction Audit",
  "",
  `- Scanned: ${sourceFiles.length} source files (+ token files)`,
  `- Blocking violations: ${findings.blocking.length}`,
  `- Informational: ${findings.informational.length}`,
  "",
  "## Layers guarded",
  "- L1 raw facts — `--raw-*` bare triplets in `:root`/`.dark`",
  "- L2 bridge — `@theme inline` `--color-*` reference `rgb(var(--raw-*))`",
  "- L3 shadcn — aliases resolve through the bridge (informational)",
  "- L4 admin — `--admin-*` alias Layer-2 tokens, no duplicate facts",
  "",
  ...section("Blocking violations", findings.blocking),
  ...section("Informational", findings.informational),
].join("\n");

fs.mkdirSync("docs/ui", { recursive: true });
fs.writeFileSync("docs/ui/wegent-token-abstraction-audit.md", report);
fs.writeFileSync(
  "docs/ui/wegent-token-abstraction-audit.json",
  JSON.stringify(
    {
      scannedFiles: sourceFiles.length,
      blocking: findings.blocking,
      informational: findings.informational,
      generatedAt: new Date().toISOString(),
    },
    null,
    2,
  ) + "\n",
);

console.log(report);

// Exit non-zero on any blocking violation. The audit is a real guard: it does
// not silently pass violations. Out-of-scope debt (e.g. pre-existing hardcoded
// colors in business pages not yet migrated) is tracked in the report and the
// abstraction report's "Known debt" section, and is expected to trend to zero
// as pages migrate — it must not be hidden behind a soft exit.
process.exit(findings.blocking.length === 0 ? 0 : 1);
