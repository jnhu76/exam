/**
 * Gate: business UI must not bypass the semantic token system with raw
 * Tailwind palette utilities (text/bg/border/ring-<gray|slate|zinc|neutral|...>).
 *
 * Tailwind is the implementation substrate; the project's semantic CSS variables
 * (exposed as utilities like text-primary, bg-surface, border-border) are the
 * ONLY color interface for business pages. Raw palettes are allowed only in the
 * token-definition layer, generated shadcn primitives, and lint internals.
 *
 * Allowlist (precise, no broad exclusions):
 *   - apps/web/src/index.css            (token foundation)
 *   - apps/web/src/{typography,surface,table,badge,control}/recipes.css
 *   - apps/web/src/components/ui/**      (generated shadcn primitives)
 *   - apps/web/src/lint/**               (the lint rules themselves)
 *   - *.test.*                           (fixtures)
 */
import { readdir, readFile } from "node:fs/promises";
import { relative } from "node:path";

const PALETTE =
  /(?:text|bg|border|ring|fill|stroke|from|to|via|outline|shadow|decoration)-(?:gray|slate|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-[0-9]{2,3})?\b/;

const ALLOW = (f) =>
  f.endsWith(".test.ts") ||
  f.endsWith(".test.tsx") ||
  f.includes("src/index.css") ||
  f.includes("/recipes.css") ||
  f.includes("src/components/ui/") ||
  f.includes("src/lint/");

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
    if (ALLOW(f)) continue;
    const text = await readFile(f, "utf8");
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      if (PALETTE.test(line)) {
        violations.push(
          `${relative(".", f)}:${i + 1}: raw Tailwind palette utility (use a semantic token) — ${line.trim().slice(0, 80)}`,
        );
      }
    });
  }
}

if (violations.length > 0) {
  process.stderr.write(
    `Token-bypass violations (${violations.length}):\n${violations.join("\n")}\n`,
  );
  process.exit(1);
}
process.stdout.write("✅ No raw-palette token bypass in business UI.\n");
