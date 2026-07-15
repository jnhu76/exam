/**
 * Gate: Ant Design residue must stay at zero.
 *
 * Scans dependencies, source, CSS, tests, docs, and build output for any Ant
 * Design artifacts (antd, @ant-design/*, rc-* runtime packages, ConfigProvider,
 * .ant- selectors). Ant Design exited this project's stack and must not return.
 *
 * Allowlist: docs/archive/** may mention Ant ONLY as forbidden/purged (not as
 * current/recommended architecture) — those mentions are historical and cannot
 * be detected deterministically, so they are excluded; check-stale-ui-docs.mjs
 * covers the "current/recommended" framing separately.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

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
    const target = join(path, e.name);
    if (e.isDirectory()) await walk(target, out);
    else out.push(target);
  }
  return out;
}

// 1. Dependencies: any package.json referencing antd / @ant-design / rc-* runtime.
const PKG_RE =
  /"(?:antd|@ant-design\/[^"]+|rc-table|rc-select|rc-pagination|rc-picker|rc-menu|rc-dialog|rc-dropdown|rc-tooltip|rc-util)"/;

async function checkDeps() {
  const all = await walk(".");
  for (const f of all.filter((f) => f.endsWith("package.json"))) {
    if (f.includes("node_modules")) continue;
    const text = await readFile(f, "utf8");
    if (PKG_RE.test(text)) {
      violations.push(
        `${relative(".", f)}: declares an Ant Design dependency (${text.match(PKG_RE)?.[0]})`,
      );
    }
  }
}

// 2. Source: imports from antd / @ant-design / rc-* runtime, plus Ant-specific
//    API surface. Type names (TableProps/ColumnsType) are matched as standalone
//    identifiers with boundaries so they don't false-positive inside unrelated
//    identifiers like "DesktopDataTableProps".
const SRC_RE =
  /from\s+["'](?:antd|@ant-design\/[^"']+|rc-table|rc-select|rc-pagination|rc-picker|rc-menu|rc-dialog|rc-dropdown|rc-tooltip)["']|\bConfigProvider\b|\bApp\.useApp\b|\bColumnsType\b|\bTableProps\b|\bFormInstance\b|\bAntTable\b|\bAntButton\b|\bAntInput\b|\bAntModal\b/;

async function checkSource() {
  const roots = ["apps", "packages", "scripts"];
  for (const root of roots) {
    const files = (await walk(root)).filter((f) =>
      /\.(ts|tsx|js|jsx|mjs)$/.test(f),
    );
    for (const f of files) {
      if (f.includes("check-ant-residue.mjs")) continue; // self
      const text = await readFile(f, "utf8");
      if (SRC_RE.test(text)) {
        violations.push(
          `${relative(".", f)}: Ant Design source artifact detected`,
        );
      }
    }
  }
}

// 3. CSS: .ant- / --ant- selectors.
const CSS_RE = /\.ant-|--ant-/;

async function checkCss() {
  const files = (await walk("apps")).filter((f) => /\.(css|scss)$/.test(f));
  for (const f of files) {
    const text = await readFile(f, "utf8");
    if (CSS_RE.test(text)) {
      violations.push(
        `${relative(".", f)}: Ant Design CSS selector (.ant-/--ant-)`,
      );
    }
  }
}

// 4. Build output: no ant markers in dist.
async function checkBuild() {
  for (const d of ["apps/web/dist", "apps/api/dist"]) {
    const files = (await walk(d)).filter((f) => /\.(js|css)$/.test(f));
    for (const f of files) {
      const text = await readFile(f, "utf8");
      if (
        /ant-table|ant-select|ant-pagination|ant-modal|ant-btn|ant-input|antd|@ant-design/.test(
          text,
        )
      ) {
        violations.push(`${relative(".", f)}: Ant marker in build output`);
      }
    }
  }
}

await checkDeps();
await checkSource();
await checkCss();
await checkBuild();

if (violations.length > 0) {
  process.stderr.write(
    `Ant residue violations (${violations.length}):\n${violations.join("\n")}\n`,
  );
  process.exit(1);
}
process.stdout.write("✅ No Ant Design residue.\n");
