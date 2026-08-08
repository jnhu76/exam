/**
 * Gate: current architecture/construction docs must not contain framing that
 * would mislead a future agent into thinking:
 *   - Ant Design is the current/recommended UI stack
 *   - the rejected A/B/C table-direction lab is an approved production direction
 *   - business pages may use raw Tailwind color palettes
 *   - font-bold is a valid way to build hierarchy
 *
 * Scans active docs (docs/architecture/frontend.md, docs/standards/ui-system.md,
 * docs/SPEC.md, README.md, AGENTS.md, CONTEXT.md). docs/archive/** is excluded
 * (archived history; the ant-removal audit separately confirms archive mentions
 * frame Ant as forbidden/purged).
 *
 * STALE_UI_DOCS_TARGETS_OVERRIDE (comma-separated paths) replaces the default
 * target list — test-only escape hatch used by check-stale-ui-docs.test.mjs
 * (same pattern as MIGRATIONS_DIR_OVERRIDE in the migration-journal checker).
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { relative } from "node:path";
import { pathToFileURL } from "node:url";

const MISLEADING = [
  // Ant as current/recommended (not forbidden).
  {
    re: /(?:当前基于\s*Ant|推荐使用\s*Ant|Ant Design\s*(?:是|作为).*(?:当前|推荐|技术栈))/,
    msg: "frames Ant Design as current/recommended architecture",
  },
  // A/B/C lab as approved.
  {
    re: /A\/B\/C\s*(?:表格?|table).*(?:批准|approved|生产|production)/,
    msg: "frames the rejected A/B/C table lab as an approved direction",
  },
  // Raw palette permitted in business pages.
  {
    re: /业务页面\s*(?:可以|允许).*(?:raw|原始)\s*(?:slate|gray|zinc|neutral)/,
    msg: "permits raw Tailwind palettes in business pages",
  },
  // font-bold as a hierarchy tool.
  {
    re: /(?:通过|使用)\s*font-bold\s*(?:建立|制造|实现)\s*(?:层级|清晰)/,
    msg: "promotes font-bold as a hierarchy tool",
  },
];

const DEFAULT_TARGETS = [
  "docs/architecture/frontend.md",
  "docs/standards/ui-system.md",
  "docs/SPEC.md",
  "README.md",
  "AGENTS.md",
  "CONTEXT.md",
];

/**
 * Pure scan of one document's content. Returns violations as
 * [{ line, reason, snippet }] — exported for the regression test.
 */
export function findViolations(content) {
  const violations = [];
  content.split("\n").forEach((line, i) => {
    for (const { re, msg } of MISLEADING) {
      if (re.test(line)) {
        violations.push({
          line: i + 1,
          reason: msg,
          snippet: line.trim().slice(0, 80),
        });
      }
    }
  });
  return violations;
}

async function walk(path, out = []) {
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (["dist", "coverage", "node_modules", ".git"].includes(e.name)) continue;
    const t = `${path}/${e.name}`;
    if (e.isDirectory()) await walk(t, out);
    else out.push(t);
  }
  return out;
}

async function scanFile(path, violations) {
  let content;
  try {
    content = await readFile(path, "utf8");
  } catch {
    return;
  }
  for (const v of findViolations(content)) {
    violations.push(
      `${relative(".", path)}:${v.line}: ${v.reason} — ${v.snippet}`,
    );
  }
}

async function scanTargets(targets) {
  const violations = [];
  for (const t of targets) {
    let st;
    try {
      st = await stat(t);
    } catch {
      continue; // missing — skip
    }
    if (st.isFile()) {
      await scanFile(t, violations);
      continue;
    }
    if (st.isDirectory()) {
      const files = (await walk(t)).filter(
        (f) => f.endsWith(".md") && !f.includes("docs/archive/"),
      );
      for (const f of files) await scanFile(f, violations);
    }
  }
  return violations;
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const override = process.env.STALE_UI_DOCS_TARGETS_OVERRIDE;
  const targets = override
    ? override
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : DEFAULT_TARGETS;
  const violations = await scanTargets(targets);
  if (violations.length > 0) {
    process.stderr.write(
      `Stale/misleading doc violations (${violations.length}):\n${violations.join("\n")}\n`,
    );
    process.exit(1);
  }
  process.stdout.write(
    "✅ No misleading UI architecture framing in active docs.\n",
  );
}
