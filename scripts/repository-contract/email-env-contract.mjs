#!/usr/bin/env node
/**
 * Email env contract conformance (Issue #367 Phase C).
 *
 * The 24-key Email / EmailWorker / SMTP cluster is declared ONCE in
 * `apps/api/src/config/emailEnvContract.json` (an array of entries). This
 * tool owns two mechanical conformance facts:
 *
 *   1. RUNTIME MEMBERSHIP — every contract key must be explicitly consumed by
 *      `resolveEmailEnv(env, "<KEY>")` inside resolveEmailConfig() /
 *      resolveEmailWorkerConfig() in apps/api/src/config/runtimeConfig.ts.
 *      A semantic member cannot silently exist without a runtime consumer.
 *   2. COMPOSE PROJECTION — the generated block inside docker-compose.yml
 *      `app.environment` is mechanically projected from the contract:
 *
 *        # BEGIN GENERATED: EMAIL ENV CONTRACT
 *        EMAIL_ENABLED: ${EMAIL_ENABLED:-false}
 *        ...
 *        SMTP_PASSWORD: ${SMTP_PASSWORD:-}
 *        # END GENERATED: EMAIL ENV CONTRACT
 *
 * Usage:
 *   node scripts/repository-contract/email-env-contract.mjs --check
 *     Verify runtime membership + Compose projection. Exit 1 on drift.
 *   node scripts/repository-contract/email-env-contract.mjs --write
 *     Rewrite the Compose generated block (markers must already exist).
 *     Runtime membership still gates the exit code — only an explicit
 *     runtime consumer can close that gap.
 *
 * This tool is deliberately NOT the deployment-topology oracle: placement
 * (block inside app.environment, no duplicate keys outside) belongs to
 * deployment-topology-contract.mjs. Topology and content/membership checks
 * stay independent.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
const CONTRACT_PATH = join(ROOT, "apps/api/src/config/emailEnvContract.json");
const COMPOSE_PATH = join(ROOT, "docker-compose.yml");
const RUNTIME_CONFIG_PATH = join(ROOT, "apps/api/src/config/runtimeConfig.ts");

export const BEGIN_MARKER = "# BEGIN GENERATED: EMAIL ENV CONTRACT";
export const END_MARKER = "# END GENERATED: EMAIL ENV CONTRACT";
const BLOCK_INDENT = "      ";

/** Resolvers that must explicitly consume every Email contract key. */
const RUNTIME_RESOLVER_FNS = ["resolveEmailConfig", "resolveEmailWorkerConfig"];

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
 * entry, in contract order). `contract` is the parsed entry array.
 */
export function renderEmailEnvBlock(contract) {
  const lines = [BLOCK_INDENT + BEGIN_MARKER];
  for (const entry of contract) {
    lines.push(`${BLOCK_INDENT}${projectDefault(entry.key, entry)}`);
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

/**
 * Extract the body of `function <fnName>(...) { ... }` from a TypeScript
 * source string (bounded brace matching — no AST). Returns null when the
 * function is not found. The parameter list is skipped by paren matching so a
 * default parameter like `opts = { isTestLike: false }` cannot be mistaken
 * for the body.
 */
export function extractFunctionBody(source, fnName) {
  const head = `function ${fnName}(`;
  const fnIdx = source.indexOf(head);
  if (fnIdx === -1) return null;
  const openParen = fnIdx + head.length - 1;
  let parenDepth = 0;
  let closeParen = -1;
  for (let i = openParen; i < source.length; i++) {
    if (source[i] === "(") parenDepth++;
    else if (source[i] === ")") {
      parenDepth--;
      if (parenDepth === 0) {
        closeParen = i;
        break;
      }
    }
  }
  if (closeParen === -1) return null;
  const bodyOpen = source.indexOf("{", closeParen);
  if (bodyOpen === -1) return null;
  let depth = 0;
  for (let i = bodyOpen; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(bodyOpen + 1, i);
    }
  }
  return null;
}

/**
 * Collect every `resolveEmailEnv(env, "<KEY>")` literal inside the Email
 * resolver functions of runtimeConfig.ts. Only the two resolver functions are
 * scanned — a contract key consumed nowhere else still fails conformance.
 */
export function extractRuntimeConsumedKeys(source) {
  const consumed = new Set();
  for (const fn of RUNTIME_RESOLVER_FNS) {
    const body = extractFunctionBody(source, fn);
    if (body === null) continue;
    const callRe = /resolveEmailEnv\(\s*env\s*,\s*"([A-Z0-9_]+)"\s*,?\s*\)/g;
    let match;
    while ((match = callRe.exec(body)) !== null) consumed.add(match[1]);
  }
  return consumed;
}

/**
 * Contract ↔ runtime membership completeness: every contract key must be
 * explicitly consumed by an Email resolver, and every resolver-consumed key
 * must exist in the contract. Returns `{ ok, reason }`.
 */
export function checkRuntimeConformance(contract, runtimeSource) {
  const contractKeys = new Set(contract.map((entry) => entry.key));
  const runtimeKeys = extractRuntimeConsumedKeys(runtimeSource);
  const unconsumed = [...contractKeys].filter((key) => !runtimeKeys.has(key));
  if (unconsumed.length > 0) {
    return {
      ok: false,
      reason: `contract key ${unconsumed[0]} has no runtime consumer`,
    };
  }
  const unknown = [...runtimeKeys].filter((key) => !contractKeys.has(key));
  if (unknown.length > 0) {
    return {
      ok: false,
      reason: `runtime consumes ${unknown[0]} which is not in the contract`,
    };
  }
  return {
    ok: true,
    contractKeys: contractKeys.size,
    runtimeKeys: runtimeKeys.size,
  };
}

export function runEmailEnvContractCli(args) {
  const mode = args.includes("--write") ? "write" : "check";
  const contract = readEmailEnvContract();
  const composeText = readFileSync(COMPOSE_PATH, "utf-8");
  const runtimeSource = readFileSync(RUNTIME_CONFIG_PATH, "utf-8");
  const conformance = checkRuntimeConformance(contract, runtimeSource);

  if (mode === "write") {
    const updated = writeProjection(composeText, contract);
    writeFileSync(COMPOSE_PATH, updated);
    console.log(
      `WROTE: regenerated ${BEGIN_MARKER} block in docker-compose.yml`,
    );
    if (!conformance.ok) {
      console.error(`FAIL: ${conformance.reason}`);
      return 1;
    }
    return 0;
  }

  const projection = checkProjection(composeText, contract);
  let failed = false;
  if (!projection.ok) {
    console.error(
      `FAIL: docker-compose.yml email env block is ${projection.reason}. ` +
        "Run `node scripts/repository-contract/email-env-contract.mjs --write` " +
        "after changing apps/api/src/config/emailEnvContract.json.",
    );
    if (projection.actual !== null) {
      console.error("--- expected ---");
      console.error(projection.expected);
      console.error("--- actual ---");
      console.error(projection.actual);
    }
    failed = true;
  }
  if (!conformance.ok) {
    console.error(`FAIL: ${conformance.reason}`);
    failed = true;
  }
  if (!failed) {
    console.log(
      "PASS: email env contract conformance (runtime membership + Compose projection).",
    );
    return 0;
  }
  return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(runEmailEnvContractCli(process.argv.slice(2)));
}
