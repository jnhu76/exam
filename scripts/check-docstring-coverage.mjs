import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const roots = ["apps", "packages"];
const skipDirs = new Set(["dist", "coverage", "node_modules", "public"]);
const skipFiles = [
  "vitest.config",
  "playwright.config",
  "drizzle.config",
  "vite.config",
  "tailwind.config",
  "postcss.config",
];
const sourceExts = new Set([".ts", ".tsx"]);
let totalSymbols = 0;
let documentedSymbols = 0;
const fileResults = [];

function hasJSDocBefore(lines, lineIndex) {
  for (let i = lineIndex - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (trimmed === "") continue;
    if (trimmed.endsWith("*/") && trimmed.includes("/**")) return true;
    if (trimmed.endsWith("*/")) {
      for (let j = i - 1; j >= 0; j--) {
        if (lines[j].trim().startsWith("/**")) return true;
        if (!lines[j].trim().startsWith("*") && lines[j].trim() !== "") break;
      }
      return false;
    }
    if (
      trimmed.startsWith("/**") ||
      trimmed.startsWith("*/") ||
      trimmed.startsWith("*")
    )
      continue;
    return false;
  }
  return false;
}

function findDocstringEnd(lines, startIndex) {
  for (let i = startIndex; i < lines.length; i++) {
    if (lines[i].trim().includes("*/")) return i;
  }
  return -1;
}

function findDocstringStart(lines, endIndex) {
  for (let i = endIndex; i >= 0; i--) {
    if (lines[i].trim().startsWith("/**")) return i;
  }
  return -1;
}

function findNearestDocstring(lines, lineIndex) {
  for (let i = lineIndex - 1; i >= 0; i--) {
    const trimmed = lines[i].trim();
    if (trimmed === "") continue;
    if (trimmed.includes("*/")) {
      const start = findDocstringStart(lines, i);
      if (start >= 0) return { start, end: i };
      return null;
    }
    if (trimmed.startsWith("//")) continue;
    return null;
  }
  return null;
}

function isExported(line, lines, lineIndex) {
  if (
    /\bexport\s+(default\s+)?(function|class|const|let|var|enum|interface|type)\b/.test(
      line,
    )
  )
    return true;
  if (/^export\s*\{/.test(line.trim())) return false;
  if (/\bexport\s+default\s+/.test(line)) return true;
  const trimmed = line.trim();
  if (
    trimmed.startsWith("export ") &&
    !trimmed.startsWith("export {") &&
    !trimmed.startsWith("export type {") &&
    !trimmed.startsWith("export enum {")
  )
    return true;
  return false;
}

function isShadcnUi(path) {
  return path.includes("components/ui/") && !path.endsWith("index.ts");
}

async function processFile(filePath, projectRoot) {
  const text = await readFile(filePath, "utf8");
  const lines = text.split("\n");
  let fileSymbols = 0;
  let fileDocumented = 0;

  const relPath = relative(projectRoot, filePath);

  const skipFile = skipFiles.some((f) => filePath.includes(f));
  if (skipFile) return;

  const documentedExports = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (
      trimmed.startsWith("//") ||
      trimmed === "" ||
      trimmed.startsWith("*") ||
      trimmed.startsWith("/*") ||
      trimmed.startsWith("/**")
    )
      continue;

    let isSymbol = false;
    const isTopLevel = line === trimmed || line.startsWith("export ");

    if (isTopLevel) {
      if (
        /^(export\s+)?(default\s+)?(export\s+)?(async\s+)?function\s+\w+/.test(
          trimmed,
        )
      )
        isSymbol = true;
      else if (
        /^(export\s+)?(default\s+)?(export\s+)?class\s+\w+/.test(trimmed)
      )
        isSymbol = true;
      else if (
        /^(export\s+)?(default\s+)?(export\s+)?(async\s+)?function\s*\(/.test(
          trimmed,
        )
      )
        isSymbol = true;
      else if (/^export\s+(const|let)\s+\w+\s*[=:]/.test(trimmed))
        isSymbol = true;
      else if (/^export\s+(enum|interface|type)\s+\w+/.test(trimmed))
        isSymbol = true;
      else if (/^(enum|interface|type)\s+\w+/.test(trimmed)) isSymbol = true;
      else if (/^(export\s+)?const\s+\w+\s*=\s*(async\s+)?\(/.test(trimmed))
        isSymbol = true;
      else if (
        /^(export\s+)?const\s+\w+\s*=\s*(async\s+)?function/.test(trimmed)
      )
        isSymbol = true;
    }

    if (!isSymbol) continue;

    fileSymbols++;
    totalSymbols++;

    const doc = findNearestDocstring(lines, i);
    const isExportedSym = isExported(line, lines, i);

    if (doc) {
      fileDocumented++;
      documentedSymbols++;
      if (isExportedSym) {
        documentedExports.push({ line: i + 1, name: trimmed.substring(0, 60) });
      }
    }
  }

  if (fileSymbols > 0) {
    const coverage = ((fileDocumented / fileSymbols) * 100).toFixed(1);
    fileResults.push({
      file: relPath,
      symbols: fileSymbols,
      documented: fileDocumented,
      coverage,
    });
  }
}

async function walk(dir, projectRoot) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (skipDirs.has(entry.name)) continue;
    const target = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(target, projectRoot);
    } else if (sourceExts.has(extname(entry.name))) {
      if (isShadcnUi(target)) continue;
      if (
        entry.name.includes(".test.") ||
        entry.name.includes(".spec.") ||
        entry.name.includes(".d.ts")
      )
        continue;
      await processFile(target, projectRoot);
    }
  }
}

const projectRoot = process.cwd();
for (const root of roots) {
  const rootPath = join(projectRoot, root);
  try {
    await walk(rootPath, projectRoot);
  } catch {}
}

fileResults.sort((a, b) => Number(a.coverage) - Number(b.coverage));

console.log(`\n=== Docstring Coverage Report ===\n`);
console.log(`Total symbols: ${totalSymbols}`);
console.log(`Documented: ${documentedSymbols}`);
console.log(
  `Coverage: ${totalSymbols > 0 ? ((documentedSymbols / totalSymbols) * 100).toFixed(1) : 0}%\n`,
);

const uncovered = fileResults.filter((f) => Number(f.coverage) === 0);
const partial = fileResults.filter(
  (f) => Number(f.coverage) > 0 && Number(f.coverage) < 100,
);
const full = fileResults.filter((f) => Number(f.coverage) === 100);

console.log(`Fully documented: ${full.length} files`);
console.log(`Partially documented: ${partial.length} files`);
console.log(`No documentation: ${uncovered.length} files`);
console.log(`Target: 80% = ${Math.ceil(totalSymbols * 0.8)} symbols`);
console.log(
  `Remaining: ${Math.max(0, Math.ceil(totalSymbols * 0.8) - documentedSymbols)} symbols\n`,
);

const gaps = fileResults
  .filter((f) => Number(f.coverage) < 100)
  .map((f) => ({ ...f, gap: f.symbols - f.documented }))
  .sort((a, b) => b.gap - a.gap);

console.log(`Top files by gap (need docstrings):\n`);
for (const f of gaps.slice(0, 40)) {
  console.log(
    `  ${String(f.gap).padStart(4)} gap  ${f.documented}/${String(f.symbols).padStart(3)}  ${f.file}`,
  );
}
