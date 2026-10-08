import { fileURLToPath } from "node:url";

/**
 * #689 — Test-only workspace resolution policy.
 *
 * `@exam/domain` advertises dist/index.js for production/Node consumers.
 * A direct `pnpm exec vitest run` does not run Turbo's ^build dependency
 * graph, so resolving that package entry silently tests a stale dist build
 * after edits to packages/domain/src. Resolve the exact package root import
 * to source inside the affected Vitest projects instead.
 *
 * This must NOT be copied to production TS / Node package resolution: built
 * artifacts and Turbo's existing ^build graph remain authoritative there.
 * The exact-match regex deliberately does not rewrite deep package imports.
 */
export const DOMAIN_TEST_SOURCE_ALIAS = {
  find: /^@exam\/domain$/,
  replacement: fileURLToPath(
    new URL("../packages/domain/src/index.ts", import.meta.url),
  ),
};
