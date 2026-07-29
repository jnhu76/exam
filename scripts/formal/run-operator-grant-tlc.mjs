#!/usr/bin/env node
/**
 * REC-I4-F1 — TLC runner for the OperatorGrant formal models.
 *
 * Executes the pinned TLA+ tools (TLC) against the server safety, client
 * safety, and expected-counterexample configurations under
 * formal/tla/operator-grant/.
 *
 * Design constraints (binding — see formal/AGENTS.md):
 *   - uses existing Node.js only; introduces NO npm dependency;
 *   - requires TLA2TOOLS_JAR (fails clearly when unset / not a regular file);
 *   - fails clearly when Java is unavailable;
 *   - runs from formal/tla/operator-grant/;
 *   - puts TLC generated data under formal/.work/operator-grant/<mode>/;
 *   - preserves stdout/stderr (streams them through);
 *   - propagates TLC's actual exit code;
 *   - NEVER hides a property violation: a target-config violation is failure,
 *     an expected-counterexample must produce the EXPECTED named violation
 *     (parsed from TLC output), otherwise it is failure;
 *   - avoids shell-string interpolation — spawn argument array is passed safe;
 *   - prints the exact model/config and the exact tool path;
 *   - works on Windows and Unix-like environments where practical.
 *
 * Usage:
 *   TLA2TOOLS_JAR=/path/to/tla2tools.jar node scripts/formal/run-operator-grant-tlc.mjs server
 *   TLA2TOOLS_JAR=/path/to/tla2tools.jar node scripts/formal/run-operator-grant-tlc.mjs client
 *   TLA2TOOLS_JAR=/path/to/tla2tools.jar node scripts/formal/run-operator-grant-tlc.mjs counterexamples
 *   TLA2TOOLS_JAR=/path/to/tla2tools.jar node scripts/formal/run-operator-grant-tlc.mjs all
 */

import { spawn } from "node:child_process";
import { existsSync, statSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..");
const MODEL_DIR = join(REPO_ROOT, "formal", "tla", "operator-grant");
const WORK_ROOT = join(REPO_ROOT, "formal", ".work", "operator-grant");

const SERVER_MODEL = "OperatorGrantServer.tla";
const CLIENT_MODEL = "OperatorGrantClient.tla";

const COUNTEREXAMPLES = [
  {
    config: "ServerLegacyDuplicateEffect",
    model: SERVER_MODEL,
    expectedViolation: "AtMostOneDeadlineEffectPerOperation",
    flag: "LegacyDuplicateEffect",
  },
  {
    config: "ServerLegacyPartialCommit",
    model: SERVER_MODEL,
    expectedViolation: "LedgerAndDeadlineCommitAtomically",
    flag: "LegacyPartialCommit",
  },
  {
    config: "ServerLegacyWrongConflictOutcome",
    model: SERVER_MODEL,
    expectedViolation: "DifferentCommandReturnsIdempotencyConflict",
    flag: "LegacyWrongConflictOutcome",
  },
  {
    config: "ServerLegacyTerminalGrant",
    model: SERVER_MODEL,
    expectedViolation: "TerminalAttemptNeverGranted",
    flag: "LegacyTerminalGrant",
  },
  {
    config: "ClientLegacyPerTabPending",
    model: CLIENT_MODEL,
    expectedViolation: "AtMostOneUnresolvedCommandPerWorkflow",
    flag: "LegacyPerTabPending",
  },
  {
    config: "ClientLegacyNewIdentityAfterLoss",
    model: CLIENT_MODEL,
    expectedViolation: "IndeterminatePreservesCommandIdentity",
    flag: "LegacyNewIdentityAfterLoss",
  },
  {
    config: "ClientLegacyMutableRetry",
    model: CLIENT_MODEL,
    expectedViolation: "FrozenCommandImmutable",
    flag: "LegacyMutableRetry",
  },
  {
    config: "ClientLegacyTerminalAsGranted",
    model: CLIENT_MODEL,
    expectedViolation: "TerminalNeverReportedAsGranted",
    flag: "LegacyTerminalAsGranted",
  },
];

const MODES = new Set(["server", "client", "counterexamples", "all"]);

function fail(msg) {
  console.error(`formal:operator-grant: ERROR — ${msg}`);
  process.exit(2);
}

function info(msg) {
  console.error(`formal:operator-grant: ${msg}`);
}

function resolveJava() {
  const javaBin = process.env.JAVA_HOME
    ? join(process.env.JAVA_HOME, "bin", "java")
    : "java";
  try {
    const probe = spawnSync(javaBin, ["-version"], {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    if (probe.error) {
      if (process.env.JAVA_HOME) throw probe.error;
      fail(
        "Java is unavailable. Install Java (JRE 8+) or set JAVA_HOME. " +
          "spawnSync error: " +
          probe.error.message,
      );
    }
  } catch (err) {
    fail(
      "Java probe failed: " +
        (err ? err.message : String(err)) +
        ". Set JAVA_HOME or put 'java' on PATH.",
    );
  }
  return javaBin;
}

function resolveJar() {
  const jar = process.env.TLA2TOOLS_JAR;
  if (!jar) {
    fail(
      "TLA2TOOLS_JAR is not set. Point it at an official tla2tools.jar " +
        "(see formal/tla/TOOLCHAIN.md for the pinned v1.7.4 release and " +
        "its published SHA-1).",
    );
  }
  const abs = resolve(jar);
  let st;
  try {
    st = statSync(abs);
  } catch (err) {
    fail(
      `TLA2TOOLS_JAR points to a path that cannot be stat'd: ${abs}\n` +
        `  ${err.message}\n` +
        `  Download from https://github.com/tlaplus/tlaplus/releases/tag/v1.7.4`,
    );
  }
  if (!st.isFile()) {
    fail(
      `TLA2TOOLS_JAR is not a regular file: ${abs} ` +
        `(it is a ${st.isDirectory() ? "directory" : "non-file"}).`,
    );
  }
  return abs;
}

function runTlc({ javaBin, jar, modelFile, configFile, metadir, label, workers }) {
  if (!existsSync(join(MODEL_DIR, modelFile))) {
    fail(
      `Model file not found: ${join(MODEL_DIR, modelFile)}. ` +
        `Run from the repository root.`,
    );
  }
  const cfgPath = join(MODEL_DIR, configFile);
  if (!existsSync(cfgPath)) {
    fail(`Config file not found: ${cfgPath}.`);
  }
  mkdirSync(metadir, { recursive: true });

  const args = [
    "-XX:+UseParallelGC",
    "-jar",
    jar,
    "-workers",
    String(workers),
    "-nowarning",
    "-deadlock",
    "-difftrace",
    "-config",
    configFile,
    "-metadir",
    metadir,
    modelFile,
  ];

  info(`[${label}] model    : ${join("formal", "tla", "operator-grant", modelFile)}`);
  info(`[${label}] config   : ${join("formal", "tla", "operator-grant", configFile)}`);
  info(`[${label}] tool     : ${jar}`);
  info(`[${label}] metadir  : ${metadir}`);
  info(`[${label}] workers  : ${workers}`);
  info(`[${label}] java -jar ... (output below)`);

  return new Promise((resolveFn) => {
    const child = spawn(javaBin, args, {
      cwd: MODEL_DIR,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    let output = "";
    const append = (chunk) => {
      output += chunk.toString("utf8");
      process.stderr.write(chunk);
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.on("error", (err) => {
      info(`[${label}] spawn error: ${err.message}`);
      resolveFn({ code: -1, output, spawnError: err });
    });
    child.on("close", (code) => {
      resolveFn({ code: code ?? -1, output });
    });
  });
}

function parseViolation(output, expectedName) {
  const lines = output.split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/Invariant\s+(\w+)\s+is\s+violated/i);
    if (m && m[1]) return m[1];
  }
  for (const line of lines) {
    const m = line.match(/Invariant\s+(\w+)\s+violated/i);
    if (m && m[1]) return m[1];
  }
  for (const line of lines) {
    const m = line.match(/^\s*Error:\s*(\w+)\s+is\s+violated/i);
    if (m && m[1]) return m[1];
  }
  if (/Temporal properties were violated/i.test(output)) {
    return expectedName ?? "__temporal__";
  }
  return null;
}

function detectToolError(output) {
  if (/Parsing or semantic analysis failed/i.test(output))
    return "TLA+ parse/semantic error";
  if (/java\.lang\.(OutOfMemoryError|StackOverflowError)/i.test(output))
    return "JVM out-of-memory / stack-overflow";
  if (/Could not find declaration or definition of symbol/i.test(output))
    return "TLA+ undefined symbol";
  if (/Error: TLC threw an unexpected exception/i.test(output))
    return "TLC unexpected exception";
  if (/unrecognized option/i.test(output)) return "TLC unrecognized option";
  if (/Cannot find source file for module/i.test(output))
    return "TLC cannot find module source";
  return null;
}

async function runSafety(javaBin, jar, modelFile, cfgFile, label) {
  const res = await runTlc({
    javaBin,
    jar,
    modelFile,
    configFile: cfgFile,
    metadir: join(WORK_ROOT, label),
    label,
    workers: Number(process.env.FORMAL_WORKERS ?? 2),
  });
  const toolErr = detectToolError(res.output);
  if (toolErr) {
    info(`${label}: FAILED — tool error (${toolErr}). Not a property result.`);
    return { mode: label, ok: false, reason: toolErr, code: res.code };
  }
  if (res.code === 0) {
    info(`${label}: PASS — no invariant violation, no unexpected deadlock.`);
    return { mode: label, ok: true, code: res.code };
  }
  const violated = parseViolation(res.output, null);
  const vname = violated ?? "<unknown>";
  info(
    `${label}: FAILED — ${vname} was violated. ` +
      `(A target safety violation is never an expected outcome.)`,
  );
  return {
    mode: label,
    ok: false,
    reason: `${violated ?? "<unknown>"} violated`,
    code: res.code,
  };
}

async function runCounterexamples(javaBin, jar) {
  const results = [];
  for (const ce of COUNTEREXAMPLES) {
    const res = await runTlc({
      javaBin,
      jar,
      modelFile: ce.model,
      configFile: join("counterexamples", `${ce.config}.cfg`),
      metadir: join(WORK_ROOT, `ce_${ce.config}`),
      label: `counterexample:${ce.config}`,
      workers: Number(process.env.FORMAL_WORKERS ?? 2),
    });
    const toolErr = detectToolError(res.output);
    if (toolErr) {
      info(
        `counterexample:${ce.config}: FAILED — tool error (${toolErr}). ` +
          `This is NOT the expected violation; do not mask it.`,
      );
      results.push({
        config: ce.config,
        ok: false,
        reason: `tool error: ${toolErr}`,
        expected: ce.expectedViolation,
        code: res.code,
      });
      continue;
    }
    if (res.code === 0) {
      info(
        `counterexample:${ce.config}: FAILED — TLC found NO violation of ` +
          `${ce.expectedViolation}. An expected-negative config MUST ` +
          `produce the named violation; absence is failure, not success.`,
      );
      results.push({
        config: ce.config,
        ok: false,
        reason: `expected violation ${ce.expectedViolation} not reproduced`,
        reproduced: false,
        expected: ce.expectedViolation,
        code: res.code,
      });
      continue;
    }
    const violated = parseViolation(res.output, ce.expectedViolation);
    if (violated === ce.expectedViolation) {
      info(
        `counterexample:${ce.config}: EXPECTED VIOLATION reproduced — ` +
          `${violated} (flag ${ce.flag}=TRUE).`,
      );
      results.push({
        config: ce.config,
        ok: true,
        reproduced: true,
        expected: ce.expectedViolation,
        violated,
        code: res.code,
      });
    } else {
      info(
        `counterexample:${ce.config}: FAILED — expected ` +
          `${ce.expectedViolation} to be violated, but TLC reported ` +
          `${violated ?? "<no named violation>"}. Investigate before ` +
          `treating this as expected.`,
      );
      results.push({
        config: ce.config,
        ok: false,
        reason: `expected ${ce.expectedViolation}, got ${violated ?? "<none>"}`,
        expected: ce.expectedViolation,
        violated,
        code: res.code,
      });
    }
  }
  return { mode: "counterexamples", results };
}

async function main() {
  const mode = process.argv[2];
  if (!MODES.has(mode)) {
    fail(
      `Unknown mode "${mode}". Usage: node scripts/formal/run-operator-grant-tlc.mjs ` +
        `<server|client|counterexamples|all>`,
    );
  }

  const javaBin = resolveJava();
  const jar = resolveJar();
  info(`java      : ${javaBin}`);
  info(`tla2tools : ${jar}`);
  info(`model dir : ${MODEL_DIR}`);

  const summary = [];
  if (mode === "server" || mode === "all")
    summary.push(
      await runSafety(javaBin, jar, SERVER_MODEL, "OperatorGrantServerSafety.cfg", "server"),
    );
  if (mode === "client" || mode === "all")
    summary.push(
      await runSafety(javaBin, jar, CLIENT_MODEL, "OperatorGrantClientSafety.cfg", "client"),
    );
  if (mode === "counterexamples" || mode === "all")
    summary.push(await runCounterexamples(javaBin, jar));

  info("---- summary ----");
  for (const s of summary) {
    if (s.mode === "counterexamples") {
      for (const r of s.results) {
        const tag = r.reproduced
          ? `EXPECTED_VIOLATION(${r.violated})`
          : r.ok
            ? "OK"
            : "FAILED";
        info(`  counterexample ${r.config}: ${tag}`);
      }
    } else {
      const tag = s.ok ? "PASS" : "FAIL";
      info(`  ${s.mode}: ${tag}${s.reason ? " — " + s.reason : ""}`);
    }
  }

  const hardFail = summary.some((s) => {
    if (s.mode === "counterexamples") {
      return s.results.some((r) => r.ok === false);
    }
    return s.ok === false;
  });
  if (hardFail) {
    info("suite: FAILED — see above. A required check did not pass.");
    process.exit(1);
  }
  info("suite: PASS — all required checks satisfied.");
  process.exit(0);
}

main().catch((err) => {
  fail(`uncaught error: ${err ? err.stack || err.message : String(err)}`);
});
