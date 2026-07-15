/**
 * Gate: current architecture/construction docs must not contain framing that
 * would mislead a future agent into thinking:
 *   - Ant Design is the current/recommended UI stack
 *   - the rejected A/B/C table-direction lab is an approved production direction
 *   - business pages may use raw Tailwind color palettes
 *   - font-bold is a valid way to build hierarchy
 *
 * Scans active docs (docs/frontend/**, docs/SPEC.md, README.md, AGENTS.md,
 * CONTEXT.md). docs/archive/** is excluded (archived history; the ant-removal
 * audit separately confirms archive mentions frame Ant as forbidden/purged).
 */
import { readdir, readFile } from "node:fs/promises";
import { relative } from "node:path";

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

const violations = [];

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

const targets = [
  "docs/frontend",
  "docs/SPEC.md",
  "README.md",
  "AGENTS.md",
  "CONTEXT.md",
];

async function scan(path) {
  let st;
  try {
    st = await readFile(path, "utf8");
  } catch {
    return;
  }
  st.split("\n").forEach((line, i) => {
    for (const { re, msg } of MISLEADING) {
      if (re.test(line)) {
        violations.push(
          `${relative(".", path)}:${i + 1}: ${msg} — ${line.trim().slice(0, 80)}`,
        );
      }
    }
  });
}

for (const t of targets) {
  let s;
  try {
    s = await readFile(t);
  } catch {
    // not a file or missing — skip
  }
  if (s !== undefined && typeof s === "string") {
    await scan(t);
    continue;
  }
  // directory
  const files = (await walk(t)).filter((f) => f.endsWith(".md"));
  for (const f of files) {
    if (f.includes("docs/archive/")) continue;
    await scan(f);
  }
}

if (violations.length > 0) {
  process.stderr.write(
    `Stale/misleading doc violations (${violations.length}):\n${violations.join("\n")}\n`,
  );
  process.exit(1);
}
process.stdout.write(
  "✅ No misleading UI architecture framing in active docs.\n",
);
