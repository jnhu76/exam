#!/usr/bin/env node
/**
 * Unit tests for the Email env contract conformance tool (Issue #367 Phase C):
 * Compose projection + runtime-membership completeness. Uses SYNTHETIC
 * contract fixtures so the renderer/checker tests never duplicate production
 * Email defaults (Phase C §27).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BEGIN_MARKER,
  END_MARKER,
  projectDefault,
  renderEmailEnvBlock,
  extractGeneratedBlock,
  checkProjection,
  writeProjection,
  extractFunctionBody,
  extractRuntimeConsumedKeys,
  checkRuntimeConformance,
} from "./email-env-contract.mjs";

const SYNTHETIC = [
  { key: "FAKE_PORT", kind: "positiveInt", default: 1234 },
  { key: "FAKE_COUNT", kind: "nonNegativeInt", default: 0 },
  { key: "FAKE_TLS", kind: "boolean", default: true },
  { key: "FAKE_OFF", kind: "boolean", default: false },
  { key: "FAKE_SWITCH", kind: "booleanTruthy", default: false },
  { key: "FAKE_NAME", kind: "string", default: "hello world" },
  { key: "FAKE_EMPTY", kind: "string", default: "" },
  { key: "FAKE_SECRET", kind: "secretString", default: "" },
  {
    key: "FAKE_MODE",
    kind: "enum",
    default: "auto",
    values: ["auto", "manual"],
  },
];

// ── Compose projection ───────────────────────────────────────────────────
test("projectDefault renders each primitive kind to its Compose fallback form", () => {
  assert.equal(
    projectDefault("FAKE_PORT", SYNTHETIC[0]),
    "FAKE_PORT: ${FAKE_PORT:-1234}",
  );
  assert.equal(
    projectDefault("FAKE_COUNT", SYNTHETIC[1]),
    "FAKE_COUNT: ${FAKE_COUNT:-0}",
  );
  assert.equal(
    projectDefault("FAKE_TLS", SYNTHETIC[2]),
    "FAKE_TLS: ${FAKE_TLS:-true}",
  );
  assert.equal(
    projectDefault("FAKE_OFF", SYNTHETIC[3]),
    "FAKE_OFF: ${FAKE_OFF:-false}",
  );
  assert.equal(
    projectDefault("FAKE_SWITCH", SYNTHETIC[4]),
    "FAKE_SWITCH: ${FAKE_SWITCH:-false}",
  );
  assert.equal(
    projectDefault("FAKE_NAME", SYNTHETIC[5]),
    "FAKE_NAME: ${FAKE_NAME:-hello world}",
  );
  assert.equal(
    projectDefault("FAKE_EMPTY", SYNTHETIC[6]),
    "FAKE_EMPTY: ${FAKE_EMPTY:-}",
  );
  assert.equal(
    projectDefault("FAKE_SECRET", SYNTHETIC[7]),
    "FAKE_SECRET: ${FAKE_SECRET:-}",
  );
  assert.equal(
    projectDefault("FAKE_MODE", SYNTHETIC[8]),
    "FAKE_MODE: ${FAKE_MODE:-auto}",
  );
});

test("projectDefault fails loud on a default that cannot be projected safely", () => {
  assert.throws(
    () =>
      projectDefault("FAKE_BAD", {
        key: "FAKE_BAD",
        kind: "string",
        default: "a}b",
      }),
    /not safe for the \$\{KEY:-default\} Compose form/,
  );
  assert.throws(
    () =>
      projectDefault("FAKE_BAD", {
        key: "FAKE_BAD",
        kind: "positiveInt",
        default: "587",
      }),
    /must be an integer/,
  );
});

test("renderEmailEnvBlock emits markers + one projected line per key in order", () => {
  const block = renderEmailEnvBlock(SYNTHETIC);
  const lines = block.split("\n");
  assert.equal(lines[0], `      ${BEGIN_MARKER}`);
  assert.equal(lines.at(-1), `      ${END_MARKER}`);
  // Every contract key appears exactly once, in contract order.
  const expectedKeys = SYNTHETIC.map((entry) => entry.key);
  const body = lines.slice(1, -1);
  assert.equal(body.length, expectedKeys.length);
  for (let i = 0; i < expectedKeys.length; i++) {
    assert.ok(
      body[i].startsWith(`      ${expectedKeys[i]}: `),
      `line ${i} should start with ${expectedKeys[i]}`,
    );
  }
  // Spot-check the synthetic expectations from Phase C §27.
  assert.ok(block.includes("      FAKE_PORT: ${FAKE_PORT:-1234}"));
  assert.ok(block.includes("      FAKE_TLS: ${FAKE_TLS:-true}"));
  assert.ok(block.includes("      FAKE_EMPTY: ${FAKE_EMPTY:-}"));
});

function composeWith(block) {
  return [
    "services:",
    "  app:",
    "    environment:",
    "      DATABASE_URL: postgresql://x",
    ...block,
    "      JWT_SECRET: ${JWT_SECRET:?...}",
  ].join("\n");
}

test("checkProjection passes when the block matches the contract", () => {
  const rendered = renderEmailEnvBlock(SYNTHETIC).split("\n");
  const result = checkProjection(composeWith(rendered), SYNTHETIC);
  assert.equal(result.ok, true);
});

test("checkProjection fails when the block is stale (contract changed, compose not regenerated)", () => {
  const rendered = renderEmailEnvBlock(SYNTHETIC).split("\n");
  const stale = SYNTHETIC.map((entry) =>
    entry.key === "FAKE_PORT"
      ? { key: "FAKE_PORT", kind: "positiveInt", default: 2525 }
      : entry,
  );
  const result = checkProjection(composeWith(rendered), stale);
  assert.equal(result.ok, false);
  assert.equal(result.reason, "content drift");
});

test("checkProjection fails when markers are missing", () => {
  const result = checkProjection(
    composeWith(["      FAKE_PORT: ${FAKE_PORT:-1234}"]),
    SYNTHETIC,
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "generated block markers missing");
});

test("extractGeneratedBlock returns null when either marker is absent", () => {
  assert.equal(extractGeneratedBlock("no markers here"), null);
  assert.equal(
    extractGeneratedBlock(`      ${BEGIN_MARKER}\n      x: y\n`),
    null,
  );
});

test("writeProjection replaces only the generated block and preserves the rest", () => {
  const original = composeWith(renderEmailEnvBlock(SYNTHETIC).split("\n"));
  const updated = SYNTHETIC.map((entry) =>
    entry.key === "FAKE_TLS"
      ? { key: "FAKE_TLS", kind: "boolean", default: false }
      : entry,
  );
  const rewritten = writeProjection(original, updated);
  // Outside lines preserved verbatim.
  assert.ok(rewritten.includes("      DATABASE_URL: postgresql://x"));
  assert.ok(rewritten.includes("      JWT_SECRET: ${JWT_SECRET:?...}"));
  assert.ok(rewritten.includes("      FAKE_TLS: ${FAKE_TLS:-false}"));
  assert.ok(!rewritten.includes("      FAKE_TLS: ${FAKE_TLS:-true}"));
  // Exactly one marker pair.
  assert.equal(rewritten.split(BEGIN_MARKER).length - 1, 1);
  assert.equal(rewritten.split(END_MARKER).length - 1, 1);
});

test("writeProjection fails loud when markers are missing", () => {
  assert.throws(
    () => writeProjection("services:\n  app:\n    environment:\n", SYNTHETIC),
    /markers are missing/,
  );
});

// ── Runtime membership conformance ───────────────────────────────────────
const FAKE_RUNTIME = `
function resolveEmailConfig(
  env: NodeJS.ProcessEnv,
  opts = { isTestLike: false },
) {
  const a = resolveEmailEnv(env, "FAKE_PORT");
  const b = resolveEmailEnv(env, "FAKE_TLS");
  if (a > 0) {
    return resolveEmailEnv(env, "FAKE_NAME");
  }
  return b;
}
function resolveEmailWorkerConfig(env: NodeJS.ProcessEnv, email: unknown) {
  const mode = resolveEmailEnv(
    env,
    "FAKE_MODE",
  );
  return mode;
}
function unrelated() {
  return resolveEmailEnv(env, "FAKE_UNRELATED");
}
`;

test("extractFunctionBody handles a default-parameter brace and nested braces", () => {
  const body = extractFunctionBody(FAKE_RUNTIME, "resolveEmailConfig");
  assert.ok(body.includes('resolveEmailEnv(env, "FAKE_PORT")'));
  assert.ok(body.includes('resolveEmailEnv(env, "FAKE_TLS")'));
  assert.ok(body.includes('resolveEmailEnv(env, "FAKE_NAME")'));
  assert.ok(!body.includes("FAKE_UNRELATED"));
  // The default-param braces must not terminate the scan early.
  assert.ok(body.includes("return b;"));
});

test("extractRuntimeConsumedKeys collects only the resolver functions' literals", () => {
  const keys = extractRuntimeConsumedKeys(FAKE_RUNTIME);
  assert.deepEqual([...keys].sort(), [
    "FAKE_MODE",
    "FAKE_NAME",
    "FAKE_PORT",
    "FAKE_TLS",
  ]);
  // An unrelated function's call is NOT part of the conformance surface.
  assert.ok(!keys.has("FAKE_UNRELATED"));
});

test("checkRuntimeConformance passes when every contract key is consumed", () => {
  const contract = SYNTHETIC.filter((entry) =>
    ["FAKE_MODE", "FAKE_NAME", "FAKE_PORT", "FAKE_TLS"].includes(entry.key),
  );
  const result = checkRuntimeConformance(contract, FAKE_RUNTIME);
  assert.equal(result.ok, true);
  assert.equal(result.contractKeys, 4);
  assert.equal(result.runtimeKeys, 4);
});

test("checkRuntimeConformance fails on a contract key with no runtime consumer", () => {
  const result = checkRuntimeConformance(SYNTHETIC, FAKE_RUNTIME);
  assert.equal(result.ok, false);
  assert.match(result.reason, /contract key FAKE_/);
  assert.match(result.reason, /has no runtime consumer/);
});

test("checkRuntimeConformance fails on a runtime key not in the contract", () => {
  // Contract fully consumed; the runtime additionally resolves an unknown key.
  const contract = SYNTHETIC.filter((entry) =>
    ["FAKE_MODE", "FAKE_NAME", "FAKE_PORT", "FAKE_TLS"].includes(entry.key),
  );
  const runtime = FAKE_RUNTIME.replace(
    "return mode;",
    'const extra = resolveEmailEnv(env, "FAKE_NOPE");\n  return mode;',
  );
  const result = checkRuntimeConformance(contract, runtime);
  assert.equal(result.ok, false);
  assert.match(result.reason, /runtime consumes FAKE_NOPE/);
  assert.match(result.reason, /which is not in the contract/);
});
