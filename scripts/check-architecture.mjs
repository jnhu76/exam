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
// authz is the Phase 3 RBAC leaf (ADR RBAC-M1): no fastify/React/Drizzle, and
// it may only reach @exam/domain (not db/contracts/api) so it stays portable.
await forbid("packages/authz/src", [
  [
    /from ["'](?:fastify|react|drizzle-orm)/,
    "authz must stay a leaf package (no fastify/React/Drizzle)",
  ],
  [
    /from ["']@exam\/(?:db|contracts|auth|exam-engine|import-export)\//,
    "authz may only depend on @exam/domain",
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
  [/from ["']drizzle-orm/, "routes must not import drizzle-orm directly"],
  [
    /from ["']@exam\/db\/src\/schema\//,
    "routes must not import DB schema directly",
  ],
]);

if (violations.length > 0) {
  process.stderr.write(`Architecture violations:\n${violations.join("\n")}\n`);
  process.exit(1);
}

process.stdout.write("Architecture checks passed.\n");
