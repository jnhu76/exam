/**
 * Gate: high font-weight (600/700) must not leak into roles that should stay
 * light. Weight hierarchy: body/input/table-cell/search/badge/button/nav/labels
 * stay 400–500; 600 is forbidden entirely (no semibold face ships); 700 is
 * allowed ONLY via an approved typography recipe (type-metric / type-metric-hero
 * for numeric emphasis), never as a raw font-bold utility on general text.
 *
 * This script flags raw `font-bold` / `font-semibold` utilities in business UI.
 * (The eslint exam-ui/no-heavy-font-weight rule covers this at the AST level for
 * wired source; this script is a belt-and-suspenders file/line gate including
 * CSS and any non-wired files.)
 */
import { readdir, readFile } from "node:fs/promises";
import { relative } from "node:path";

const HEAVY = /\bfont-(?:semibold|bold|extrabold|black)\b/;
const ALLOW = (f) =>
  f.endsWith(".test.ts") ||
  f.endsWith(".test.tsx") ||
  f.includes("src/components/ui/") || // generated primitives
  f.includes("src/lint/") ||
  f.includes("/recipes.css"); // recipes own their weights (e.g. type-metric 700)

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
      if (HEAVY.test(line)) {
        violations.push(
          `${relative(".", f)}:${i + 1}: heavy font-weight utility (use a recipe or 400/500) — ${line.trim().slice(0, 80)}`,
        );
      }
    });
  }
}

if (violations.length > 0) {
  process.stderr.write(
    `High-font-weight violations (${violations.length}):\n${violations.join("\n")}\n`,
  );
  process.exit(1);
}
process.stdout.write("✅ No heavy font-weight leaks in business UI.\n");
