/**
 * Atlas CLI — deterministic build / validate entry points.
 *
 * Run via tsx from the repository:
 * `pnpm --filter @exam/atlas exec tsx src/cli.ts <command> <file>`.
 *
 * Commands:
 *   build    — assemble the canonical snapshot from explicit inputs and
 *              write generated/atlas-snapshot.json (wired up as extractors
 *              and curation land; see assemble.ts)
 *   validate — check a snapshot envelope: schema + body-hash consistency
 *
 * The build consumes ONLY explicit local inputs. It must never call GitHub
 * or any other network service (R1 handoff §7:
 * HIDDEN_NETWORK_DURING_BUILD = NO). The observed revision comes from
 * ATLAS_SOURCE_SHA; the semantic body never depends on where or when the
 * build runs.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { canonicalHash } from "./canon/serialize.js";
import { buildSnapshot, BuildError } from "./snapshot/build.js";
import type { SemanticInput } from "./snapshot/types.js";
import { GitRevisionView } from "./view/revision.js";

const REPO_ROOT = new URL("../../..", import.meta.url).pathname;

function fail(message: string): never {
  process.stderr.write(`atlas: ${message}\n`);
  process.exit(1);
}

async function main(argv: string[]): Promise<void> {
  const command = argv[0] ?? "help";
  switch (command) {
    case "build": {
      const inputPath = argv[1];
      if (inputPath === undefined || !existsSync(inputPath)) {
        fail("build requires a semantic-input JSON file");
      }
      const input = JSON.parse(
        readFileSync(inputPath, "utf8"),
      ) as SemanticInput;
      const sha = readSourceSha();
      if (sha !== input.source_sha) {
        fail(
          `input source_sha ${input.source_sha} != observed revision ${sha}`,
        );
      }
      const bound = new GitRevisionView(sha, REPO_ROOT);
      const output = buildSnapshot(
        input,
        { bound },
        "no-curation",
        "no-route-facts",
      );
      process.stdout.write(Buffer.from(output.bytes).toString("utf8"));
      return;
    }
    case "validate": {
      const path = argv[1];
      if (path === undefined || !existsSync(path)) {
        fail("validate requires a file path");
      }
      const parsed = JSON.parse(readFileSync(path, "utf8")) as Record<
        string,
        unknown
      >;
      const body = parsed["body"];
      if (body === undefined || typeof body !== "object") {
        fail("not a snapshot envelope (missing body)");
      }
      const hash = canonicalHash(body);
      const manifest = parsed["manifest"] as Record<string, unknown>;
      if (manifest["normalized_body_hash"] !== hash) {
        fail(
          `body hash mismatch: manifest ${String(manifest["normalized_body_hash"])} vs computed ${hash}`,
        );
      }
      process.stdout.write(
        `atlas: validate PASS (${String(manifest["snapshot_id"])})\n`,
      );
      return;
    }
    default:
      process.stdout.write(
        "usage: tsx src/cli.ts build <input.json> | validate <snapshot.json>\n",
      );
  }
}

/** The observed revision: ATLAS_SOURCE_SHA env, else the worktree HEAD. */
function readSourceSha(): string {
  const fromEnv = process.env["ATLAS_SOURCE_SHA"];
  if (fromEnv !== undefined && /^[0-9a-f]{40}$/.test(fromEnv)) {
    return fromEnv;
  }
  const sha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  }).trim();
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    fail("cannot determine source SHA (ATLAS_SOURCE_SHA or git HEAD)");
  }
  return sha;
}

main(process.argv.slice(2)).catch((error: unknown) => {
  if (error instanceof BuildError || error instanceof Error) {
    fail(error.message);
  }
  fail(String(error));
});
