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
 *
 * Web entries: UI copy that lives here for CSV/template compatibility or is a
 * temporary placeholder.
 *
 * Backend entries (apps/api/src): the API contract is code-driven — the error
 * handler (plugins/errors.ts) serializes an error CODE, never the thrown
 * message, so Chinese strings in thrown `ValidationError`/`NotFoundError` calls
 * are server-side log/debug copy that never reaches the client. The remaining
 * categories are API-provided data strings:
 *  - CSV/export column headers + row values (a data-format contract, not UI
 *    copy — the same as the web CSV import allowlist).
 *  - status-reason strings (`scoreViewDisabledReason`/`deleteDisabledReason`)
 *    returned in the response body and rendered verbatim by the web client
 *    today. Migrating these to machine-readable codes + web i18n mapping is a
 *    tracked follow-up (see docs/dev/i18n-copy-policy.md); until then they are
 *    allowlisted as an explicit documented exception.
 */
const CJK_ALLOWLIST = [
  // ── Web ──────────────────────────────────────────────────────────────
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
  // ── Backend: CSV/export data-format contract ─────────────────────────
  {
    path: "apps/api/src/routes/export.ts",
    reason:
      "Scores CSV column headers + row values (考生姓名/成绩/及格状态/...). Data-format contract, not UI copy.",
    removal: "Never — CSV export header/row format is a data contract.",
  },
  {
    path: "apps/api/src/routes/attempts.admin.ts",
    reason:
      "Attempt-detail CSV column headers + row values (题号/题型/题目内容/...). Data-format contract, not UI copy.",
    removal: "Never — CSV export header/row format is a data contract.",
  },
  // ── Backend: API-provided status-reason strings (rendered verbatim by
  //    the web client today; code+web-i18n mapping is a tracked follow-up). ──
  {
    path: "apps/api/src/routes/exam.ts",
    reason:
      "scoreViewDisabledReason / deleteDisabledReason status-reason strings returned in the response body and rendered verbatim by the web client.",
    removal:
      "When migrated to machine-readable reason codes with a web i18n mapping (follow-up).",
  },
  // ── Backend: validation/error messages. The error handler serializes a
  //    code (never the thrown message), so these are server-side log/debug
  //    copy that never reaches the client. English would be cleaner but
  //    changing them is non-blocking and out of closeout scope. ──
  {
    path: "apps/api/src/routes/course.ts",
    reason:
      "Thrown/inline validation messages (课程代码已存在/课程下仍有题目...). Server-side only — the error handler returns an error code, not this message.",
    removal:
      "When server-side messages are standardized to English (follow-up); not user-facing.",
  },
  {
    path: "apps/api/src/routes/user.ts",
    reason:
      "Thrown validation messages (不能停用...). Server-side only — error handler returns a code, not this message.",
    removal:
      "When server-side messages are standardized to English (follow-up); not user-facing.",
  },
  {
    path: "apps/api/src/routes/question.ts",
    reason:
      "Thrown validation messages (课程不存在). Server-side only — error handler returns a code, not this message.",
    removal:
      "When server-side messages are standardized to English (follow-up); not user-facing.",
  },
  {
    path: "apps/api/src/routes/candidate.ts",
    reason:
      "Inline field validation messages (缺少用户名或姓名/新增考生需要初始密码). Server-side only.",
    removal:
      "When server-side messages are standardized to English (follow-up); not user-facing.",
  },
  {
    path: "apps/api/src/routes/attempts.candidate.ts",
    reason:
      "Thrown NotFound/ValidationError messages (候选人资料不存在/尝试不存在/问题不在此尝试中). Server-side only — error handler returns a code.",
    removal:
      "When server-side messages are standardized to English (follow-up); not user-facing.",
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
  // Dev-only comparison labs under apps/web/src/dev/ are tree-shaken out of
  // production builds (gated behind import.meta.env.DEV). Their specimen
  // copy is dev tooling, not product UI, and must not pollute the
  // production i18n catalog. Treated like test/fixture files.
  /apps\/web\/src\/dev\//,
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

/**
 * Strips line comments (// ...) from a line, preserving URLs (https://).
 * Returns the code portion only, so CJK in comments is not flagged.
 */
function stripComments(line) {
  // Match // not preceded by : (preserves https://, http://, ftp://)
  const match = line.match(/(?<!:)\/\//);
  if (match && match.index !== undefined) {
    return line.slice(0, match.index);
  }
  return line;
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

    const relPath = relative(process.cwd(), filePath).replace(/\\/g, "/");

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
    // Scan apps/web/src AND apps/api/src for the CJK gate.
    if (
      !relPath.startsWith("apps/web/src/") &&
      !relPath.startsWith("apps/api/src/")
    )
      return;

    // Skip locale catalog
    if (relPath.includes("i18n/locales/")) return;

    // Skip test files (caught by EXCLUDE_PATTERNS, but double-check)
    if (
      relPath.includes(".test.") ||
      relPath.includes("__tests__/") ||
      relPath.includes("testHelpers") ||
      relPath.includes("e2e-seed") ||
      relPath.includes("demo-seed")
    )
      return;

    // Allowlisted files: skip entirely (CSV/template/status-reason/log copy)
    if (ALLOWED_PATH_SET.has(relPath)) return;

    for (let i = 0; i < lines.length; i++) {
      const code = stripComments(lines[i]);
      if (!CJK_REGEX.test(code)) continue;

      // Skip full-line comments
      if (isCommentLine(lines[i])) continue;

      tier2Violations.push({
        file: relPath,
        line: i + 1,
        content: lines[i].trim(),
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
