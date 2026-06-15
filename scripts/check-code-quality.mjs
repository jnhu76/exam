import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const roots = ["apps", "packages"];
const violations = [];

async function walk(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (["dist", "coverage", "node_modules", "public"].includes(entry.name))
      continue;
    const target = join(path, entry.name);
    if (entry.isDirectory()) {
      await walk(target);
    } else if ([".ts", ".tsx", ".js", ".mjs"].includes(extname(entry.name))) {
      const text = await readFile(target, "utf8");
      text.split("\n").forEach((line, index) => {
        if (/\bconsole\.(log|error)\s*\(/.test(line)) {
          violations.push(
            `${relative(".", target)}:${index + 1} console output`,
          );
        }
      });
    }
  }
}

for (const root of roots) await walk(root);

if (violations.length > 0) {
  process.stderr.write(`Code quality violations:\n${violations.join("\n")}\n`);
  process.exit(1);
}

process.stdout.write("Code quality checks passed.\n");
