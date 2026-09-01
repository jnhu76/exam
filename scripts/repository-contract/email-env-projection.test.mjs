#!/usr/bin/env node
/**
 * Unit tests for the Email env contract → Compose projection (Issue #367
 * Phase C). Uses SYNTHETIC contract fixtures so the renderer/checker tests
 * never duplicate production Email defaults (Phase C §27).
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
} from "./email-env-projection.mjs";

const SYNTHETIC = {
  FAKE_PORT: { kind: "positiveInt", default: 1234, target: "app" },
  FAKE_COUNT: { kind: "nonNegativeInt", default: 0, target: "app" },
  FAKE_TLS: { kind: "boolean", default: true, target: "app" },
  FAKE_OFF: { kind: "boolean", default: false, target: "app" },
  FAKE_SWITCH: { kind: "booleanTruthy", default: false, target: "app" },
  FAKE_NAME: { kind: "string", default: "hello world", target: "app" },
  FAKE_EMPTY: { kind: "string", default: "", target: "app" },
  FAKE_SECRET: { kind: "secretString", default: "", target: "app" },
  FAKE_MODE: {
    kind: "enum",
    default: "auto",
    values: ["auto", "manual"],
    target: "app",
  },
};

test("projectDefault renders each primitive kind to its Compose fallback form", () => {
  assert.equal(
    projectDefault("FAKE_PORT", SYNTHETIC.FAKE_PORT),
    "FAKE_PORT: ${FAKE_PORT:-1234}",
  );
  assert.equal(
    projectDefault("FAKE_COUNT", SYNTHETIC.FAKE_COUNT),
    "FAKE_COUNT: ${FAKE_COUNT:-0}",
  );
  assert.equal(
    projectDefault("FAKE_TLS", SYNTHETIC.FAKE_TLS),
    "FAKE_TLS: ${FAKE_TLS:-true}",
  );
  assert.equal(
    projectDefault("FAKE_OFF", SYNTHETIC.FAKE_OFF),
    "FAKE_OFF: ${FAKE_OFF:-false}",
  );
  assert.equal(
    projectDefault("FAKE_SWITCH", SYNTHETIC.FAKE_SWITCH),
    "FAKE_SWITCH: ${FAKE_SWITCH:-false}",
  );
  assert.equal(
    projectDefault("FAKE_NAME", SYNTHETIC.FAKE_NAME),
    "FAKE_NAME: ${FAKE_NAME:-hello world}",
  );
  assert.equal(
    projectDefault("FAKE_EMPTY", SYNTHETIC.FAKE_EMPTY),
    "FAKE_EMPTY: ${FAKE_EMPTY:-}",
  );
  assert.equal(
    projectDefault("FAKE_SECRET", SYNTHETIC.FAKE_SECRET),
    "FAKE_SECRET: ${FAKE_SECRET:-}",
  );
  assert.equal(
    projectDefault("FAKE_MODE", SYNTHETIC.FAKE_MODE),
    "FAKE_MODE: ${FAKE_MODE:-auto}",
  );
});

test("projectDefault fails loud on a default that cannot be projected safely", () => {
  assert.throws(
    () =>
      projectDefault("FAKE_BAD", {
        kind: "string",
        default: "a}b",
        target: "app",
      }),
    /not safe for the \$\{KEY:-default\} Compose form/,
  );
  assert.throws(
    () =>
      projectDefault("FAKE_BAD", {
        kind: "positiveInt",
        default: "587",
        target: "app",
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
  const expectedKeys = Object.keys(SYNTHETIC);
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
  const stale = {
    ...SYNTHETIC,
    FAKE_PORT: { kind: "positiveInt", default: 2525, target: "app" },
  };
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
  const updated = {
    ...SYNTHETIC,
    FAKE_TLS: { kind: "boolean", default: false, target: "app" },
  };
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
