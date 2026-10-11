/**
 * Atlas CLI — deterministic build / check / validate entry points.
 *
 * Run via tsx from the repository:
 * `pnpm --filter @exam/atlas exec tsx src/cli.ts <command>`.
 *
 * Commands:
 *   build    — assemble the canonical snapshot from the explicit inputs
 *              (curation/ + input/route-facts.json + the git object store)
 *              and write generated/atlas-snapshot.json + coverage-report.json
 *   check    — rebuild in memory and byte-compare the committed artifacts
 *   validate — check a snapshot envelope: schema + body-hash consistency
 *
 * The build consumes ONLY explicit local inputs. It never calls GitHub or
 * any other network service (R1 handoff §7: HIDDEN_NETWORK_DURING_BUILD =
 * NO). The observed revision comes from ATLAS_SOURCE_SHA (else the worktree
 * HEAD); the semantic body never depends on where or when the build runs.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  canonicalBytes,
  canonicalHash,
  canonicalJson,
  sha256Hex,
} from "./canon/serialize.js";
import {
  buildAtlasInput,
  curationInputRevisionOf,
  loadCurationInputs,
} from "./curation/assemble.js";
import { buildSnapshot, BuildError } from "./snapshot/build.js";
import { coverageReport } from "./snapshot/coverage.js";
import type { RouteFacts } from "./extract/routes.js";
import { CompositeRevisionView, GitRevisionView } from "./view/revision.js";

const PACKAGE_ROOT = new URL("..", import.meta.url).pathname;
const REPO_ROOT = new URL("../../..", import.meta.url).pathname;

function fail(message: string): never {
  process.stderr.write(`atlas: ${message}\n`);
  process.exit(1);
}

/**
 * The capture artifact is committed by the same PR that contains the
 * snapshot, so its observed HEAD necessarily precedes the final source SHA
 * (snapshot-SHA circularity, R1 handoff §6). The honest invariant is: the
 * capture HEAD is an ancestor of the source SHA and the PRODUCT tree
 * (everything the capture observes) is identical between the two — only
 * atlas-package files may differ.
 */
function assertCaptureMatchesProductTree(
  captureHead: string,
  sourceSha: string,
): void {
  if (!/^[0-9a-f]{40}$/.test(captureHead)) {
    fail(`route-facts observed_head "${captureHead}" is not full 40-hex`);
  }
  const git = (args: string[]): string =>
    execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  const isAncestor =
    git(["merge-base", "--is-ancestor", captureHead, sourceSha]) !== "" || true;
  try {
    execFileSync(
      "git",
      ["merge-base", "--is-ancestor", captureHead, sourceSha],
      {
        cwd: REPO_ROOT,
        stdio: "ignore",
      },
    );
  } catch {
    fail(
      `route-facts observed_head ${captureHead} is not an ancestor of the observed revision ${sourceSha} — re-run the capture`,
    );
  }
  void isAncestor;
  const drift = git([
    "diff",
    "--name-only",
    `${captureHead}..${sourceSha}`,
    "--",
    "apps/",
    "packages/",
    ":(exclude)packages/atlas/",
    // The extractor itself is the observation instrument, not observed
    // product behaviour; the artifact digest pins its output.
    ":(exclude)apps/api/src/atlas/",
  ]);
  if (drift.length > 0) {
    fail(
      `product tree drifted between the capture (${captureHead}) and the observed revision (${sourceSha}):\n${drift} — re-run pnpm --filter @exam/api atlas:capture-routes`,
    );
  }
}

interface LoadedInputs {
  sourceSha: string;
  routeFacts: RouteFacts;
  routeFactsDigest: string;
  curationRevision: string;
}

function loadInputs(): LoadedInputs {
  const sourceSha = readSourceSha();
  const routeFactsPath = join(PACKAGE_ROOT, "input", "route-facts.json");
  if (!existsSync(routeFactsPath)) {
    fail(
      `missing route facts capture at ${routeFactsPath} — run pnpm --filter @exam/api atlas:capture-routes`,
    );
  }
  const routeFacts = JSON.parse(
    readFileSync(routeFactsPath, "utf8"),
  ) as RouteFacts;
  assertCaptureMatchesProductTree(routeFacts.observed_head, sourceSha);
  const routeFactsDigest = sha256Hex(canonicalJson(routeFacts));
  const curation = loadCurationInputs(join(PACKAGE_ROOT, "curation"));
  return {
    sourceSha,
    routeFacts,
    routeFactsDigest,
    curationRevision: curationInputRevisionOf(curation),
  };
}

function buildFromInputs(
  inputs: LoadedInputs,
): ReturnType<typeof buildSnapshot> {
  const assembled = buildAtlasInput({
    repo: "jnhu76/exam",
    sourceSha: inputs.sourceSha,
    curation: loadCurationInputs(join(PACKAGE_ROOT, "curation")),
    routeFacts: inputs.routeFacts,
  });
  if (assembled.ir091Findings.length > 0) {
    fail(
      `ATLAS-IR-091 completeness gate failed:\n${assembled.ir091Findings.join("\n")}`,
    );
  }
  const bound = new CompositeRevisionView(
    inputs.sourceSha,
    new GitRevisionView(inputs.sourceSha, REPO_ROOT),
    "packages/atlas/",
    REPO_ROOT,
  );
  return buildSnapshot(
    assembled,
    { bound },
    inputs.curationRevision,
    inputs.routeFactsDigest,
  );
}

async function main(argv: string[]): Promise<void> {
  const command = argv[0] ?? "help";
  switch (command) {
    case "build": {
      const inputs = loadInputs();
      const output = buildFromInputs(inputs);
      const outDir = join(PACKAGE_ROOT, "generated");
      mkdirSync(outDir, { recursive: true });
      const snapshotPath = join(outDir, "atlas-snapshot.json");
      writeFileSync(snapshotPath, Buffer.from(output.bytes));
      const curation = loadCurationInputs(join(PACKAGE_ROOT, "curation"));
      const assembled = buildAtlasInput({
        repo: "jnhu76/exam",
        sourceSha: inputs.sourceSha,
        curation,
        routeFacts: inputs.routeFacts,
      });
      const report = coverageReport(output.envelope, curation, assembled.o07);
      const coveragePath = join(outDir, "coverage-report.json");
      writeFileSync(coveragePath, canonicalBytes(report));
      process.stdout.write(
        `atlas: wrote ${snapshotPath}\n  snapshot_id = ${output.envelope.manifest.snapshot_id}\n  body hash   = ${output.bodyHash}\n  findings    = ${output.findings.length}\n  families    = ${report.seed_families_reconciled}/${report.seed_families_total} reconciled\n`,
      );
      return;
    }
    case "check": {
      const snapshotPath = join(
        PACKAGE_ROOT,
        "generated",
        "atlas-snapshot.json",
      );
      if (!existsSync(snapshotPath)) {
        fail("no generated snapshot — run `build` first");
      }
      const committed = readFileSync(snapshotPath, "utf8");
      const output = buildFromInputs(loadInputs());
      const rebuilt = Buffer.from(output.bytes).toString("utf8");
      if (rebuilt !== committed) {
        fail(
          "committed snapshot differs from rebuild — run `build` and review the diff",
        );
      }
      process.stdout.write(
        `atlas: check PASS (${output.envelope.manifest.snapshot_id})\n`,
      );
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
        "usage: tsx src/cli.ts build|check|validate <file>\n",
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
