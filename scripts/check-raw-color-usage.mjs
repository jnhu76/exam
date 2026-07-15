/**
 * Gate: business UI must not hardcode colors (hex / rgb / rgba / hsl / hsla /
 * oklch literals, or arbitrary color utilities like bg-[#fff]).
 *
 * Colors must flow from the semantic token system. Allowlist:
 *   - token foundation (index.css) + recipe CSS (rgb() inside box-shadow /
 *     color-mix elevation is legal per the documented elevation rule)
 *   - generated shadcn primitives (components/ui)
 *   - test fixtures
 *
 * This complements check-token-bypass (raw palettes) — together they enforce
 * that no color reaches business UI except through a semantic token.
 */
import { readdir, readFile } from "node:fs/promises";
import { relative } from "node:path";

// Hex (#rgb / #rrggbb), rgb(), rgba(), hsl(), hsla(), oklch(), and arbitrary
// bracket color utilities (bg-[#...], text-[rgb(...)], etc.).
const RAW_COLOR =
  /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|oklch\(|\[(?:bg|text|border|ring|fill|stroke|from|to|via|shadow)-#|\[(?:bg|text|border)-(?:rgb|hsl|oklch)/;

const ALLOW_DIR = (f) =>
  f.endsWith(".test.ts") ||
  f.endsWith(".test.tsx") ||
  f.includes("src/components/ui/") ||
  f.includes("src/lint/");

// Token/recipe files allow color literals (they define the palette + own
// elevation rgb() per the documented rule).
const ALLOW_FILE = (f) =>
  f.endsWith("src/index.css") || f.endsWith("/recipes.css");

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

const violations = [];
const roots = [
  "apps/web/src/pages",
  "apps/web/src/components/shared",
  "apps/web/src/components/exam",
  "apps/web/src/components/layout",
  "apps/web/src/components/settings",
  "apps/web/src/components/question",
];
for (const root of roots) {
  const files = (await walk(root)).filter((f) => /\.(ts|tsx|css)$/.test(f));
  for (const f of files) {
    if (ALLOW_DIR(f) || ALLOW_FILE(f)) continue;
    const text = await readFile(f, "utf8");
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      if (RAW_COLOR.test(line)) {
        violations.push(
          `${relative(".", f)}:${i + 1}: hardcoded color literal (use a semantic token) — ${line.trim().slice(0, 80)}`,
        );
      }
    });
  }
}

if (violations.length > 0) {
  process.stderr.write(
    `Raw-color violations (${violations.length}):\n${violations.join("\n")}\n`,
  );
  process.exit(1);
}
process.stdout.write("✅ No hardcoded color literals in business UI.\n");
