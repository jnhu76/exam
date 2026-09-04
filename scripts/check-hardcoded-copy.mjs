#!/usr/bin/env node

/**
 * Hardcoded copy guard — two tiers.
 *
 * Copy zones and their authorities are defined in
 * docs/standards/i18n-copy-policy.md; message semantics live in
 * docs/contracts/api-contract.md. This script only enforces placement.
 *
 * Tier 1 — deployment-specific terms (校内/校园/大学/…): forbidden
 * everywhere except docs, tests, stories, demo seed. Scans all text files
 * under apps/ and packages/.
 *
 * Tier 2 — production-source CJK gate. Every CJK string literal, template
 * literal, or JSX text in production source must either live in an explicit
 * catalog authority or carry a narrow suppression directive:
 *
 *     // i18n-copy-allow: <category> — <reason>
 *
 * with category one of wire-compat | server-rendered | developer-diagnostic
 * | data-format | temporary. The directive covers the literal on its own
 * line (trailing) or on the immediately following line (a block of
 * consecutive directive comments is allowed for multi-line reasons).
 * INVARIANT: a directive must not degrade into file-level immunity — any
 * other CJK literal in the same file still fails, and an unknown category,
 * missing reason, malformed directive, or stale directive fails.
 *
 * Comments (including Chinese comments) are not user-facing copy and are
 * never flagged; literal extraction is AST-based, so `//` inside a string
 * cannot disguise copy as a comment.
 *
 * Exit code 1 if violations found.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";
import ts from "typescript";

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

// ─── Shared walk/exclusion helpers ──────────────────────────────────

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

function walkDir(dir, callback) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return; // skip inaccessible directories
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue; // skip inaccessible entries
    }
    if (stat.isDirectory()) {
      walkDir(fullPath, callback);
    } else if (stat.isFile()) {
      // INVARIANT: callback errors must surface — a scan crash must never
      // masquerade as a clean pass for that file.
      callback(fullPath);
    }
  }
}

function isExcluded(filePath, patterns) {
  return patterns.some((pattern) => pattern.test(filePath));
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

function toRelPath(filePath) {
  return relative(process.cwd(), filePath).replace(/\\/g, "/");
}

// ─── Tier 2: Production source CJK gate ─────────────────────────────

const CJK_REGEX = /[\u4e00-\u9fff]/;

// Production-source roots for Tier2: browser, server, and every workspace
// package's src/ tree. A package added under packages/* is scanned
// automatically — no per-package registration.
const TIER2_WEB_API_ROOTS = ["apps/web/src", "apps/api/src"];
const TIER2_PACKAGE_SRC = /^packages\/[^/]+\/src\//;

const JS_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

// Structural test-only / non-product exclusions. Directory- and
// extension-shaped only: a production file must not evade the gate through
// its name (a file called foo.testHelpers.ts is still scanned).
const TIER2_EXCLUDE_PATTERNS = [
  ...EXCLUDE_PATTERNS,
  /(^|\/)__tests__\//,
  // testHelpers DIRECTORIES are test-only trees; requiring the trailing
  // slash keeps plain files named testHelpers.ts inside the gate.
  /(^|\/)testHelpers\//,
  /(^|\/)fixtures\//,
  /(^|\/)(e2e-seed|demo-seed)/,
  // Dev-only comparison labs under apps/web/src/dev/ are tree-shaken out of
  // production builds (gated behind import.meta.env.DEV); treated like
  // test/fixture files.
  /^apps\/web\/src\/dev\//,
];

// Files whose declared architectural responsibility is copy storage.
// CATALOG authority is exact-path on purpose: the whole file may contain
// copy because storing copy is the file's job. This must never widen to a
// package or directory, so mixed production files cannot inherit it.
const CATALOG_AUTHORITIES = [
  /^apps\/web\/src\/i18n\/locales\//,
  /^packages\/contracts\/src\/messageRegistry\.ts$/,
];

const SUPPRESSION_CATEGORIES = new Set([
  "wire-compat",
  "server-rendered",
  "developer-diagnostic",
  "data-format",
  "temporary",
]);

const DIRECTIVE_PREFIX = "i18n-copy-allow:";
const DIRECTIVE_RE = /^i18n-copy-allow:\s*([a-z-]+)(?:\s+(.*))?$/;

const SUPPRESSION_USAGE =
  "Directive syntax: // i18n-copy-allow: <category> — <reason>\n" +
  "  Categories: wire-compat | server-rendered | developer-diagnostic | data-format | temporary\n" +
  "  The directive must sit on the literal's own line or the line immediately above it.\n" +
  "  Policy: docs/standards/i18n-copy-policy.md";

function scriptKindFor(filePath) {
  switch (extname(filePath)) {
    case ".tsx":
      return ts.ScriptKind.TSX;
    case ".jsx":
      return ts.ScriptKind.JSX;
    case ".js":
    case ".mjs":
    case ".cjs":
      return ts.ScriptKind.JS;
    default:
      return ts.ScriptKind.TS;
  }
}

/**
 * Collects CJK-bearing copy nodes: string literals, template literals
 * (reported once per literal, in any part), and JSX text. Property-key
 * identifiers are code, not copy, and are not collected.
 */
function collectCjkNodes(sourceFile) {
  const hits = [];
  function visit(node) {
    if (ts.isStringLiteral(node) && CJK_REGEX.test(node.text)) {
      hits.push(node);
    } else if (
      ts.isNoSubstitutionTemplateLiteral(node) &&
      CJK_REGEX.test(node.text)
    ) {
      hits.push(node);
    } else if (ts.isTemplateExpression(node)) {
      const joined =
        node.head.text +
        node.templateSpans.map((span) => span.literal.text).join("");
      if (CJK_REGEX.test(joined)) hits.push(node);
    } else if (ts.isJsxText(node) && CJK_REGEX.test(node.text)) {
      hits.push(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return hits;
}

function parseDirectives(sourceFile, text) {
  const directives = [];
  const seen = new Set();
  function addRanges(ranges) {
    for (const range of ranges ?? []) {
      const key = `${range.pos}:${range.end}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const raw = text.slice(range.pos, range.end);
      let body = raw;
      if (body.startsWith("//")) {
        body = body.slice(2);
      } else if (body.startsWith("/*")) {
        body = body.slice(2, body.endsWith("*/") ? -2 : undefined);
      }
      body = body.trim();
      // Any comment opening with the reserved "i18n-copy-allow" token is a
      // directive attempt; a typo (missing colon, bad category) must be
      // reported, never silently treated as an ordinary comment.
      if (!body.startsWith("i18n-copy-allow")) continue;
      const line = text.slice(0, range.pos).split("\n").length;
      const match = body.match(DIRECTIVE_RE);
      if (!match) {
        directives.push({ line, valid: false, problem: "malformed directive" });
        continue;
      }
      const [, category, reason] = match;
      if (!SUPPRESSION_CATEGORIES.has(category)) {
        directives.push({
          line,
          valid: false,
          problem: `unknown category "${category}"`,
        });
        continue;
      }
      if (!reason || !reason.trim()) {
        directives.push({
          line,
          valid: false,
          problem: `category "${category}" has no reason`,
        });
        continue;
      }
      directives.push({
        line,
        valid: true,
        category,
        reason: reason.trim(),
        consumed: false,
      });
    }
  }
  function visit(node) {
    addRanges(ts.getLeadingCommentRanges(text, node.getFullStart()));
    addRanges(ts.getTrailingCommentRanges(text, node.getEnd()));
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  directives.sort((a, b) => a.line - b.line);
  return directives;
}

/**
 * Groups consecutive directive lines into blocks so a multi-line reason
 * reads naturally; the block's effective position is its LAST line.
 */
function groupDirectiveBlocks(directives) {
  const blocks = [];
  for (const directive of directives) {
    const last = blocks[blocks.length - 1];
    if (last && directive.line === last.endLine + 1) {
      last.items.push(directive);
      last.endLine = directive.line;
    } else {
      blocks.push({ items: [directive], endLine: directive.line });
    }
  }
  return blocks;
}

function scanTier2File(filePath, relPath) {
  const content = readFileSync(filePath, "utf-8");
  const lineTexts = content.split("\n");

  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    scriptKindFor(filePath),
  );

  const directives = parseDirectives(sourceFile, content);
  // INVARIANT: only fully valid blocks suppress. An invalid directive must
  // never silence the adjacent literal — both the directive problem and the
  // violation are reported.
  const validBlocks = groupDirectiveBlocks(directives).filter((block) =>
    block.items.every((item) => item.valid),
  );

  const violations = [];
  for (const node of collectCjkNodes(sourceFile)) {
    const line =
      sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line +
      1;
    const suppressedBy = validBlocks.find(
      (block) => block.endLine === line || block.endLine === line - 1,
    );
    if (suppressedBy) {
      for (const item of suppressedBy.items) item.consumed = true;
      continue;
    }
    violations.push({
      relPath,
      line,
      excerpt: (lineTexts[line - 1] ?? "").trim(),
    });
  }

  const problems = [];
  for (const directive of directives) {
    if (!directive.valid) {
      problems.push({
        relPath,
        line: directive.line,
        kind: "invalid-suppression",
        detail: directive.problem,
      });
    } else if (!directive.consumed) {
      problems.push({
        relPath,
        line: directive.line,
        kind: "stale-suppression",
        detail: "no CJK literal on this line or the line immediately below",
      });
    }
  }

  return { violations, problems };
}

// ─── Run ────────────────────────────────────────────────────────────

const tier1Violations = [];
const tier2Violations = [];
const suppressionProblems = [];

for (const dir of ["apps", "packages"]) {
  const fullPath = join(process.cwd(), dir);
  try {
    statSync(fullPath);
  } catch {
    continue;
  }

  walkDir(fullPath, (filePath) => {
    if (!isTextFile(filePath)) return;
    if (isExcluded(filePath, EXCLUDE_PATTERNS)) return;

    const relPath = toRelPath(filePath);

    let content;
    try {
      content = readFileSync(filePath, "utf-8");
    } catch {
      return;
    }

    // ── Tier 1: forbidden deployment-specific terms, all text files ──
    for (const [i, line] of content.split("\n").entries()) {
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

    // ── Tier 2: production source CJK gate ──
    if (!JS_EXTENSIONS.has(extname(filePath))) return;
    const inProductionRoot =
      TIER2_WEB_API_ROOTS.some(
        (root) => relPath === root || relPath.startsWith(root + "/"),
      ) || TIER2_PACKAGE_SRC.test(relPath);
    if (!inProductionRoot) return;
    if (isExcluded(filePath, TIER2_EXCLUDE_PATTERNS)) return;
    if (CATALOG_AUTHORITIES.some((pattern) => pattern.test(relPath))) return;

    const { violations, problems } = scanTier2File(filePath, relPath);
    tier2Violations.push(...violations);
    suppressionProblems.push(...problems);
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
    "See docs/standards/code-quality.md §4.1 for the Hardcoded Business Copy Guard rules.\n",
  );
}

if (tier2Violations.length > 0) {
  hasErrors = true;
  console.error(
    "\n❌ Unauthorized production CJK literal (no catalog authority, no suppression):\n",
  );
  for (const v of tier2Violations) {
    console.error(`  [CJK] ${v.relPath}:${v.line}`);
    console.error(`    ${v.excerpt}\n`);
  }
  console.error(
    "Browser-interactive copy → apps/web/src/i18n/locales/zh-CN.ts via t(...).\n" +
      "Copy in another legitimate zone stays in place with a narrow directive:\n" +
      SUPPRESSION_USAGE +
      "\n",
  );
}

if (suppressionProblems.length > 0) {
  hasErrors = true;
  console.error("\n❌ Invalid or stale i18n-copy-allow suppression:\n");
  for (const p of suppressionProblems) {
    console.error(`  [SUPPRESSION] ${p.relPath}:${p.line} — ${p.detail}`);
  }
  console.error(`\n${SUPPRESSION_USAGE}\n`);
}

if (hasErrors) {
  process.exit(1);
} else {
  console.log("✅ No hardcoded business copy found.");
}
