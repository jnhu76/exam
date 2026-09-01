#!/usr/bin/env node
/**
 * Email env contract → docker-compose.yml projection (Issue #367 Phase C).
 *
 * The 24-key Email / EmailWorker / SMTP block inside `app.environment` is
 * the ONE region of docker-compose.yml that is mechanically projected from
 * the semantic contract (`apps/api/src/config/emailEnvContract.json`):
 *
 *   # BEGIN GENERATED: EMAIL ENV CONTRACT
 *   EMAIL_ENABLED: ${EMAIL_ENABLED:-false}
 *   ...
 *   SMTP_PASSWORD: ${SMTP_PASSWORD:-}
 *   # END GENERATED: EMAIL ENV CONTRACT
 *
 * Everything else in docker-compose.yml stays human-owned. The projection
 * rule is mechanical: `KEY: ${KEY:-<default>}` where the default form follows
 * the contract kind (booleans → true/false, integers → decimal, strings →
 * verbatim, empty strings → nothing after `:-`).
 *
 * Usage:
 *   node scripts/repository-contract/email-env-projection.mjs --check
 *     Verify docker-compose.yml's generated block matches the contract.
 *     Exit 1 when the block is missing, stale, or drifted.
 *   node scripts/repository-contract/email-env-projection.mjs --write
 *     Rewrite the generated block (markers must already exist).
 *
 * The checker is deliberately NOT the deployment-topology oracle: it proves
 * the block CONTENT equals the contract; placement (inside app.environment,
 * no duplicate keys outside) belongs to deployment-topology-contract.mjs.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
const CONTRACT_PATH = join(ROOT, "apps/api/src/config/emailEnvContract.json");
const COMPOSE_PATH = join(ROOT, "docker-compose.yml");

export const BEGIN_MARKER = "# BEGIN GENERATED: EMAIL ENV CONTRACT";
export const END_MARKER = "# END GENERATED: EMAIL ENV CONTRACT";
const BLOCK_INDENT = "      ";

/** Compose-interpolation-safe plain-scalar fallback: no `$ { } : #` or
 * newlines (the empty string is allowed — it projects to `${KEY:-}`). A
 * future default outside this set must be reviewed and quoted deliberately —
 * failing loudly beats silently projecting a broken line. */
const SAFE_DEFAULT_RE = /^[^${}:{}#\n\r]*$/;

/**
 * Project one contract default into the `${KEY:-default}` fallback form.
 * Throws when the default cannot be projected with the simple syntax.
 */
export function projectDefault(key, entry) {
  let form;
  switch (entry.kind) {
    case "booleanTruthy":
    case "boolean":
      form = entry.default ? "true" : "false";
      break;
    case "positiveInt":
    case "nonNegativeInt":
      if (
        typeof entry.default !== "number" ||
        !Number.isInteger(entry.default)
      ) {
        throw new Error(
          `email env projection: ${key} default must be an integer`,
        );
      }
      form = String(entry.default);
      break;
    case "string":
    case "secretString":
    case "enum":
      if (typeof entry.default !== "string") {
        throw new Error(
          `email env projection: ${key} default must be a string`,
        );
      }
      if (!SAFE_DEFAULT_RE.test(entry.default)) {
        throw new Error(
          `email env projection: ${key} default ${JSON.stringify(entry.default)} ` +
            "is not safe for the ${KEY:-default} Compose form — review and quote it " +
            "deliberately instead of generating a broken line.",
        );
      }
      form = entry.default;
      break;
    default:
      throw new Error(
        `email env projection: ${key} has unsupported kind ${entry.kind}`,
      );
  }
  return `${key}: ${"$"}{${key}:-${form}}`;
}

/**
 * Render the full generated block (markers + one projected line per contract
 * key, in contract order). `contract` is `{ [key]: { kind, default, ... } }`.
 */
export function renderEmailEnvBlock(contract) {
  const lines = [BLOCK_INDENT + BEGIN_MARKER];
  for (const [key, entry] of Object.entries(contract)) {
    const line = projectDefault(key, entry);
    lines.push(`${BLOCK_INDENT}${line}`);
  }
  lines.push(BLOCK_INDENT + END_MARKER);
  return lines.join("\n");
}

export function readEmailEnvContract() {
  return JSON.parse(readFileSync(CONTRACT_PATH, "utf-8"));
}

/** Extract the generated block (markers inclusive) as an array of lines, or
 * null when either marker is missing. */
export function extractGeneratedBlock(composeText) {
  const lines = composeText.split("\n");
  const beginIdx = lines.findIndex((l) => l.trim() === BEGIN_MARKER);
  if (beginIdx === -1) return null;
  const endIdx = lines.findIndex(
    (l, i) => i > beginIdx && l.trim() === END_MARKER,
  );
  if (endIdx === -1) return null;
  return {
    start: beginIdx,
    end: endIdx,
    block: lines.slice(beginIdx, endIdx + 1),
  };
}

/** Check whether `composeText` contains the exact generated block for
 * `contract`. Returns `{ ok, expected, actual }` for reporting. */
export function checkProjection(composeText, contract) {
  const expected = renderEmailEnvBlock(contract);
  const found = extractGeneratedBlock(composeText);
  if (found === null) {
    return {
      ok: false,
      reason: "generated block markers missing",
      expected,
      actual: null,
    };
  }
  const actual = found.block.join("\n");
  return { ok: actual === expected, reason: "content drift", expected, actual };
}

/** Replace the generated block in `composeText` with the freshly rendered
 * block. Throws when markers are missing. */
export function writeProjection(composeText, contract) {
  const found = extractGeneratedBlock(composeText);
  if (found === null) {
    throw new Error(
      `Cannot write email env projection: ${BEGIN_MARKER} / ${END_MARKER} ` +
        "markers are missing from docker-compose.yml. Add them inside " +
        "app.environment first (the topology contract requires them).",
    );
  }
  const rendered = renderEmailEnvBlock(contract).split("\n");
  const lines = composeText.split("\n");
  return [
    ...lines.slice(0, found.start),
    ...rendered,
    ...lines.slice(found.end + 1),
  ].join("\n");
}

export function runProjectionCli(args) {
  const mode = args.includes("--write") ? "write" : "check";
  const contract = readEmailEnvContract();
  const composeText = readFileSync(COMPOSE_PATH, "utf-8");

  if (mode === "write") {
    const updated = writeProjection(composeText, contract);
    writeFileSync(COMPOSE_PATH, updated);
    console.log(
      `WROTE: regenerated ${BEGIN_MARKER} block in docker-compose.yml`,
    );
    return 0;
  }

  const result = checkProjection(composeText, contract);
  if (result.ok) {
    console.log(
      "PASS: docker-compose.yml email env block matches the contract.",
    );
    return 0;
  }
  console.error(
    `FAIL: docker-compose.yml email env block is ${result.reason}. ` +
      "Run `node scripts/repository-contract/email-env-projection.mjs --write` " +
      "after changing apps/api/src/config/emailEnvContract.json.",
  );
  if (result.actual !== null) {
    console.error("--- expected ---");
    console.error(result.expected);
    console.error("--- actual ---");
    console.error(result.actual);
  }
  return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(runProjectionCli(process.argv.slice(2)));
}
