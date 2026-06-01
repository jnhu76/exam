import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const violations = [];

async function files(path) {
  const result = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (["dist", "coverage", "node_modules"].includes(entry.name)) continue;
    const target = join(path, entry.name);
    if (entry.isDirectory()) result.push(...(await files(target)));
    else if (/\.(ts|tsx)$/.test(entry.name)) result.push(target);
  }
  return result;
}

async function forbid(path, patterns) {
  for (const file of await files(path)) {
    if (file.endsWith("testHelpers.ts") || file.includes(".test.")) continue;
    const text = await readFile(file, "utf8");
    for (const [pattern, message] of patterns) {
      if (pattern.test(text)) {
        violations.push(`${relative(".", file)}: ${message}`);
      }
    }
  }
}

await forbid("packages/domain/src", [
  [
    /from ["'](?:fastify|react|drizzle-orm|@exam\/)/,
    "domain must remain a leaf package",
  ],
]);
await forbid("packages/contracts/src", [
  [/from ["']fastify/, "contracts cannot depend on fastify"],
]);
await forbid("packages/exam-engine/src", [
  [/from ["']fastify/, "exam-engine cannot depend on fastify"],
]);
await forbid("apps/web/src", [
  [/from ["']@exam\/db/, "web cannot import the database package"],
]);
await forbid("apps/api/src/routes", [
  [
    /\bdb\.(?:select|insert|update|delete)\s*\(/,
    "routes must use repositories",
  ],
]);

if (violations.length > 0) {
  process.stderr.write(`Architecture violations:\n${violations.join("\n")}\n`);
  process.exit(1);
}

process.stdout.write("Architecture checks passed.\n");
