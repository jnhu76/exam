#!/usr/bin/env node

/**
 * Hardcoded copy guard — two-tier check:
 *
 * 1. Deployment-specific terms (校内/校园/大学/etc.) — forbidden everywhere
 *    except docs, tests, stories, demo seed.
 *
 * 2. Production source CJK detection — user-visible Chinese in production
 *    source must go through i18n. Allowed exceptions:
 *    - zh-CN locale catalog
 *    - test files / fixtures
 *    - comments
 *    - documented CSV/template allowlist
 *    - PlaceholderPage (temporary)
 *
 * Exit code 1 if violations found.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";

// ─── Tier 1: Deployment-specific terms ──────────────────────────────

const FORBIDDEN_TERMS = [
  "校内",
  "校园",
  "大学",
  "学生",
  "学号",
  "工号",
  "实验室",
  "化学",
  "物理",
  "数学",
  "University",
  "campus",
  "student",
];

// ─── Tier 2: Production source CJK gate ─────────────────────────────

const CJK_REGEX = /[\u4e00-\u9fff]/;

/**
 * Files exempted from CJK detection. Each entry documents WHY the
 * Chinese is acceptable and when the exemption should be removed.
 */
const CJK_ALLOWLIST = [
  {
    path: "apps/web/src/lib/candidateImport.ts",
    reason:
      "CSV header aliases (用户名/密码/姓名) for import compatibility, not UI copy.",
    removal: "Never — CSV format is a data contract, not user-facing copy.",
  },
  {
    path: "apps/web/src/pages/admin/QuestionImportPage.tsx",
    reason:
      "CSV template headers, parser tokens (是→true), and example row content. Data format, not UI.",
    removal: "Never — template format is a data contract.",
  },
  {
    path: "apps/web/src/pages/PlaceholderPage.tsx",
    reason: "Temporary placeholder page awaiting implementation.",
    removal: "When the page is implemented or removed.",
  },
];

const ALLOWED_PATH_SET = new Set(CJK_ALLOWLIST.map((e) => e.path));

// ─── Shared helpers ─────────────────────────────────────────────────

const EXCLUDE_PATTERNS = [
  /\.test\./,
  /\.spec\./,
  /\.stories\./,
  /seed\/demo\//,
  /(^|\/)demo-seed(\/|$|\.)/,
  /docs\//,
  /node_modules\//,
  /dist\//,
  /\.git\//,
];

const SCAN_DIRS = ["apps", "packages"];

function walkDir(dir, callback) {
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      try {
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          walkDir(fullPath, callback);
        } else if (stat.isFile()) {
          callback(fullPath);
        }
      } catch {
        // skip inaccessible files
      }
    }
  } catch {
    // skip inaccessible directories
  }
}

function isExcluded(filePath) {
  return EXCLUDE_PATTERNS.some((pattern) => pattern.test(filePath));
}

function isTextFile(filePath) {
  const textExtensions = [
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".json",
    ".html",
    ".css",
    ".md",
    ".yaml",
    ".yml",
  ];
  return textExtensions.includes(extname(filePath));
}

function isCommentLine(line) {
  const trimmed = line.trim();
  return (
    trimmed.startsWith("//") ||
    trimmed.startsWith("/*") ||
    trimmed.startsWith("*")
  );
}

// ─── Tier 1: Deployment-specific violations ─────────────────────────

const tier1Violations = [];

// ─── Tier 2: CJK violations ────────────────────────────────────────

const tier2Violations = [];

for (const dir of SCAN_DIRS) {
  const fullPath = join(process.cwd(), dir);
  try {
    statSync(fullPath);
  } catch {
    continue;
  }

  walkDir(fullPath, (filePath) => {
    if (!isTextFile(filePath)) return;
    if (isExcluded(filePath)) return;

    const relPath = relative(process.cwd(), filePath);

    let content;
    try {
      content = readFileSync(filePath, "utf-8");
    } catch {
      return;
    }

    const lines = content.split("\n");

    // ── Tier 1 check ──
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const term of FORBIDDEN_TERMS) {
        if (line.includes(term)) {
          tier1Violations.push({
            file: relPath,
            line: i + 1,
            term,
            content: line.trim(),
          });
        }
      }
    }

    // ── Tier 2 check: CJK in production source ──
    // Only scan apps/web/src for CJK gate
    if (!relPath.startsWith("apps/web/src/")) return;

    // Skip locale catalog
    if (relPath.includes("i18n/locales/")) return;

    // Skip test files (caught by EXCLUDE_PATTERNS, but double-check)
    if (relPath.includes(".test.") || relPath.includes("__tests__/")) return;

    // Check if file is in allowlist
    const isAllowed = ALLOWED_PATH_SET.has(relPath);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!CJK_REGEX.test(line)) continue;

      // Skip comment lines
      if (isCommentLine(line)) continue;

      // If file is in allowlist, skip silently
      if (isAllowed) continue;

      tier2Violations.push({
        file: relPath,
        line: i + 1,
        content: line.trim(),
      });
    }
  });
}

// ─── Report ─────────────────────────────────────────────────────────

let hasErrors = false;

if (tier1Violations.length > 0) {
  hasErrors = true;
  console.error(
    "\n❌ Hardcoded deployment-specific copy found in production code:\n",
  );
  for (const v of tier1Violations) {
    console.error(`  ${v.file}:${v.line} — "${v.term}"`);
    console.error(`    ${v.content}\n`);
  }
  console.error(
    "See docs/code-quality.md §4.1 for the Hardcoded Business Copy Guard rules.\n",
  );
}

if (tier2Violations.length > 0) {
  hasErrors = true;
  console.error(
    "\n❌ Hardcoded Chinese found in production source (not in i18n catalog):\n",
  );
  for (const v of tier2Violations) {
    console.error(`  ${v.file}:${v.line}`);
    console.error(`    ${v.content}\n`);
  }
  console.error(
    "Move user-visible copy to apps/web/src/i18n/locales/zh-CN.ts\n" +
      "and render it through t(...).\n" +
      "If this is CSV/template compatibility or fixture data,\n" +
      "add a documented allowlist entry in scripts/check-hardcoded-copy.mjs\n" +
      "with justification.\n",
  );
}

if (hasErrors) {
  process.exit(1);
} else {
  console.log("✅ No hardcoded business copy found.");
}
