import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTlcArgs,
  executionToolError,
  parseViolation,
  resolveWorkers,
  validateJavaProbe,
} from "./run-operator-grant-tlc.mjs";

test("temporal violations never inherit an expected invariant name", () => {
  assert.equal(
    parseViolation("Error: Temporal properties were violated."),
    "__temporal__",
  );
});

test("spawn failures are classified as tool failures", () => {
  const spawnError = new Error("spawn java ENOENT");

  assert.equal(
    executionToolError({ code: -1, output: "", spawnError }),
    "process spawn failed: spawn java ENOENT",
  );
});

test("FORMAL_WORKERS accepts only positive integers", () => {
  assert.equal(resolveWorkers(undefined), 2);
  assert.equal(resolveWorkers("4"), 4);
  assert.throws(() => resolveWorkers("auto"), /positive integer.*auto/);
  assert.throws(() => resolveWorkers("0"), /positive integer.*0/);
  assert.throws(() => resolveWorkers("1.5"), /positive integer.*1\.5/);
});

test("a non-zero Java probe status fails before TLC starts", () => {
  assert.throws(
    () =>
      validateJavaProbe("java", {
        error: undefined,
        status: 1,
        signal: null,
        stderr: Buffer.from("broken runtime"),
      }),
    /Java probe 'java -version' exited with status 1.*broken runtime/,
  );
});

test("TLC arguments keep deadlock checking enabled", () => {
  const args = buildTlcArgs({
    jar: "/tmp/tla2tools.jar",
    workers: 2,
    configFile: "OperatorGrantServerSafety.cfg",
    metadir: "/tmp/tlc-meta",
    modelFile: "OperatorGrantServer.tla",
  });

  assert.equal(args.includes("-deadlock"), false);
});
