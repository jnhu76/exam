#!/usr/bin/env node

/**
 * Checks for hardcoded deployment-specific business copy in production code.
 *
 * Forbidden terms in apps/** and packages/** (excluding test/story/demo/docs):
 *   校内 / 校园 / 大学 / 学生 / 学号 / 工号 / 实验室 / 化学 / 物理 / 数学
 *   University / campus / student
 *
 * Exit code 1 if violations found.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";

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

const EXCLUDE_PATTERNS = [
  /\.test\./,
  /\.spec\./,
  /\.stories\./,
  /seed\/demo\//,
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

const violations = [];

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

    let content;
    try {
      content = readFileSync(filePath, "utf-8");
    } catch {
      return;
    }

    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const term of FORBIDDEN_TERMS) {
        if (line.includes(term)) {
          violations.push({
            file: relative(process.cwd(), filePath),
            line: i + 1,
            term,
            content: line.trim(),
          });
        }
      }
    }
  });
}

if (violations.length > 0) {
  console.error("\n❌ Hardcoded business copy found in production code:\n");
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line} — "${v.term}"`);
    console.error(`    ${v.content}\n`);
  }
  console.error(
    "See docs/code-quality.md §4.1 for the Hardcoded Business Copy Guard rules.",
  );
  console.error(
    "These terms are only allowed in docs, tests, stories, and demo seed data.\n",
  );
  process.exit(1);
} else {
  console.log("✅ No hardcoded business copy found.");
}
