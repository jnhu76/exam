/**
 * Shell-consumable projection of TEST_DATABASE_TARGET.
 *
 * Non-Node maintenance tooling (scripts/db/*.sh, scripts/test/*.sh) must not
 * resolve the test database target itself: a shell-local
 * `${DATABASE_URL:-…exam_test}` fallback is a second TEST_DATABASE_TARGET
 * authority — DATABASE_URL is masked for test targets (#730 EXP-01) and the
 * constructed fallback duplicates resolveTestBranchUrl. Those scripts shell
 * out here instead, so the answer they observe IS the canonical answer.
 *
 * Contract:
 *   - INPUT   : the already-supplied process env (no dotenv admission —
 *               physical source admission is owned by application
 *               entrypoints).
 *   - AUTHORITY: resolveTestBranchUrl (packages/db/src/databaseUrl.ts) — this
 *               file owns no precedence, construction, or name-safety logic.
 *   - STDOUT  : the resolved URL and nothing else, so `DB_URL="$(…)"` capture
 *               is stable. Diagnostics go to STDERR.
 *   - EXIT    : 0 on success; 1 when the canonical resolver rejects the
 *               configuration. Under `set -euo pipefail` the non-zero exit
 *               stops the caller before any psql command runs (fail closed).
 *
 * It opens no connection and mutates nothing.
 *
 * Usage (repo convention, from any cwd inside the workspace):
 *   pnpm --filter @exam/db exec tsx src/testDatabaseUrlCli.ts
 */

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { resolveTestBranchUrl } from "./databaseUrl.js";

/** Minimal structural sink so tests can assert output without real streams. */
interface TextSink {
  write(chunk: string): unknown;
}

/**
 * Resolve TEST_DATABASE_TARGET from `env` and write it to `out`.
 *
 * @returns The process exit code: 0 with `URL\n` on `out`; 1 with the
 *   canonical resolver's rejection reason on `err`.
 */
export function projectTestDatabaseUrl(
  env: NodeJS.ProcessEnv,
  out: TextSink,
  err: TextSink,
): number {
  try {
    out.write(`${resolveTestBranchUrl(env)}\n`);
    return 0;
  } catch (error) {
    err.write(
      `testDatabaseUrlCli: ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    );
    return 1;
  }
}

// INVARIANT: the projection runs only when this file is executed as a script.
// Importing the module (tests, tooling) must not write to stdout or exit.
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (invokedDirectly) {
  process.exitCode = projectTestDatabaseUrl(
    process.env,
    process.stdout,
    process.stderr,
  );
}
