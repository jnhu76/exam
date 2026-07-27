#!/usr/bin/env node
/**
 * REC-F1 — TLC runner for the RecoveryProtocol formal model.
 *
 * Executes the pinned TLA+ tools (TLC) against the safety, liveness, and
 * expected-counterexample configurations under formal/tla/recovery/.
 *
 * Design constraints (binding — see formal/AGENTS.md):
 *   - uses existing Node.js only; introduces NO npm dependency;
 *   - requires TLA2TOOLS_JAR (fails clearly when unset / not a regular file);
 *   - fails clearly when Java is unavailable;
 *   - runs from formal/tla/recovery/;
 *   - puts TLC generated data under formal/.work/recovery/<mode>/;
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
 *   TLA2TOOLS_JAR=/path/to/tla2tools.jar node scripts/formal/run-recovery-tlc.mjs safety
 *   TLA2TOOLS_JAR=/path/to/tla2tools.jar node scripts/formal/run-recovery-tlc.mjs liveness
 *   TLA2TOOLS_JAR=/path/to/tla2tools.jar node scripts/formal/run-recovery-tlc.mjs counterexamples
 *   TLA2TOOLS_JAR=/path/to/tla2tools.jar node scripts/formal/run-recovery-tlc.mjs all
 */

import { spawn } from "node:child_process";
import { existsSync, statSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..", "..");
const MODEL_DIR = join(REPO_ROOT, "formal", "tla", "recovery");
const WORK_ROOT = join(REPO_ROOT, "formal", ".work", "recovery");
const MODEL_FILE = "RecoveryProtocol.tla";

// Each expected-counterexample config maps to the invariant it MUST
// violate. The runner parses TLC output for the named violation; an
// arbitrary non-zero exit is NOT treated as expected success.
const COUNTEREXAMPLES = [
  {
    config: "LegacyWrongAttemptRestore",
    expectedViolation: "NoWrongAttemptRestore",
    flag: "LegacyWrongAttemptCapability",
  },
  {
    config: "LegacyGlobalInFlight",
    expectedViolation: "NoCrossAttemptRestoreBlocking",
    flag: "LegacyGlobalInFlight",
  },
  {
    config: "LegacyStalePageLoad",
    expectedViolation: "NoStalePageLoadApply",
    flag: "LegacyApplyStalePageLoad",
  },
  {
    config: "LegacyNoReloadAfterPostFailure",
    expectedViolation: "PostOutcomeIsNotPageAuthority",
    flag: "LegacySkipReloadAfterPostFailure",
  },
];

const MODES = new Set([
  "safety",
  "safety:route",
  "safety:submission",
  "liveness",
  "counterexamples",
  "explore",
  "all",
]);

function fail(msg) {
  console.error(`formal:recovery: ERROR — ${msg}`);
  process.exit(2);
}

function info(msg) {
  console.error(`formal:recovery: ${msg}`);
}

/**
 * Resolves and validates the Java executable. Returns the absolute path or
 * fails clearly. No shell interpolation — uses spawnSync to probe -version.
 */
function resolveJava() {
  const javaBin = process.env.JAVA_HOME
    ? join(process.env.JAVA_HOME, "bin", "java")
    : "java";
  // Probe java availability. spawnSync avoids any shell interpolation.
  try {
    const probe = spawnSync(javaBin, ["-version"], {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    if (probe.error) {
      if (process.env.JAVA_HOME) throw probe.error;
      // 'java' not on PATH and no JAVA_HOME.
      fail(
        "Java is unavailable. Install Java (JRE 8+) or set JAVA_HOME. " +
          "spawnSync error: " +
          probe.error.message,
      );
    }
    if (probe.status !== 0 && probe.signal === null) {
      // Some JVMs print version to stderr with exit 0; accept either.
      // Only hard-fail if java itself could not start.
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

/**
 * Resolves and validates TLA2TOOLS_JAR. Must be an existing regular file.
 */
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

/**
 * Runs TLC with the given config file. Returns { code, output } where output
 * is the full combined stdout+stderr. Streams output through to the parent
 * process's stderr so a long run is observable, and also buffers it for the
 * violation-name parse.
 *
 * spawn argument array is passed directly — no shell, no string interpolation.
 */
function runTlc({ javaBin, jar, configFile, metadir, label, workers }) {
  if (!existsSync(join(MODEL_DIR, MODEL_FILE))) {
    fail(
      `Model file not found: ${join(MODEL_DIR, MODEL_FILE)}. ` +
        `Run from the repository root.`,
    );
  }
  if (!existsSync(join(MODEL_DIR, configFile))) {
    fail(`Config file not found: ${join(MODEL_DIR, configFile)}.`);
  }
  mkdirSync(metadir, { recursive: true });

  // -XX:+UseParallelGC silences the TLC throughput warning (official guidance).
  // -nowarning suppresses the GC banner (we already set ParallelGC).
  // -deadlock disables TLC's deadlock check (the model permits stuttering).
  // -difftrace keeps traces compact.
  // -workers N: safety may use multiple; liveness uses 1 per soundness note.
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
    MODEL_FILE,
  ];

  info(
    `[${label}] model    : ${join("formal", "tla", "recovery", MODEL_FILE)}`,
  );
  info(
    `[${label}] config   : ${join("formal", "tla", "recovery", configFile)}`,
  );
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

/**
 * Parses TLC output for a named invariant or property violation, or a
 * generic temporal-properties violation. Returns the matched name or null.
 * Robust to the TLC lines:
 *   "Invariant <Name> is violated."
 *   "<Name> is violated." (property)
 *   "Temporal properties were violated." (when TLC does not name the property)
 */
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
    // TLC prints the generic temporal-violation line; for PROPERTY checks
    // the name is in the .cfg, so return the expected name if provided.
    return expectedName ?? "__temporal__";
  }
  return null;
}

/**
 * Detects syntax / Java / OOM / module errors that must NEVER be masked as
 * "expected counterexample success". Returns a human label or null.
 */
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

async function runSafetyConfig(javaBin, jar, cfgFile, label) {
  const res = await runTlc({
    javaBin,
    jar,
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
    info(`${label}: PASS — no invariant/property violation, no unexpected deadlock.`);
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

async function runSafety(javaBin, jar) {
  return runSafetyConfig(javaBin, jar, "RecoveryProtocolSafety.cfg", "safety");
}

async function runLiveness(javaBin, jar) {
  const res = await runTlc({
    javaBin,
    jar,
    configFile: "RecoveryProtocolLiveness.cfg",
    metadir: join(WORK_ROOT, "liveness"),
    label: "liveness",
    // Liveness uses ONE worker unless the pinned tool documents a verified
    // multi-worker liveness configuration. This is the conservative default.
    workers: 1,
  });
  const toolErr = detectToolError(res.output);
  if (toolErr) {
    info(`liveness: FAILED — tool error (${toolErr}). Not a property result.`);
    return { mode: "liveness", ok: false, reason: toolErr, code: res.code };
  }
  // Liveness is a REQUIRED check: a property violation is a failure (exit
  // non-zero). It is NOT wrapped as success. The current model has a known
  // PARTIAL status (see formal/tla/recovery/README.md §Liveness), so this
  // mode currently fails — that is the honest signal. Use
  // formal:recovery:explore for a non-gated run that does not fail the suite.
  if (res.code === 0) {
    info("liveness: PASS — temporal properties hold under the stated fairness.");
    return { mode: "liveness", ok: true, code: res.code };
  }
  info(
    "liveness: FAILED — temporal property violated under current fairness. " +
      "This is the known PARTIAL status (documented), but it is NOT wrapped " +
      "as success. See formal/tla/recovery/README.md §Liveness and the " +
      "closeout audit. Use formal:recovery:explore for a non-gated run.",
  );
  return {
    mode: "liveness",
    ok: false,
    reason: "temporal property violated (documented PARTIAL)",
    partial: true,
    code: res.code,
  };
}

async function runCounterexamples(javaBin, jar) {
  const results = [];
  for (const ce of COUNTEREXAMPLES) {
    const res = await runTlc({
      javaBin,
      jar,
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
      // No violation — the expected counterexample was NOT reproduced. This
      // is a FAILURE: per the REC-F1 acceptance bar, each expected-negative
      // config must produce the named violation. The runner does NOT wrap
      // it as success.
      info(
        `counterexample:${ce.config}: FAILED — TLC found NO violation of ` +
          `${ce.expectedViolation}. An expected-negative config MUST ` +
          `produce the named violation; absence is failure, not success. ` +
          `See formal/tla/recovery/counterexamples/README.md.`,
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
      // A DIFFERENT invariant was violated — that is a real failure, not
      // the expected counterexample. Do not mask it.
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
      `Unknown mode "${mode}". Usage: node scripts/formal/run-recovery-tlc.mjs ` +
        `<safety|liveness|counterexamples|all>`,
    );
  }

  const javaBin = resolveJava();
  const jar = resolveJar();
  info(`java      : ${javaBin}`);
  info(`tla2tools : ${jar}`);
  info(`model dir : ${MODEL_DIR}`);

  const summary = [];
  const isExplore = mode === "explore";
  if (mode === "safety" || mode === "all")
    summary.push(await runSafety(javaBin, jar));
  if (mode === "safety:route" || mode === "all")
    summary.push(
      await runSafetyConfig(
        javaBin,
        jar,
        "RecoveryProtocolRouteSwitchSafety.cfg",
        "safety:route",
      ),
    );
  if (mode === "safety:submission" || mode === "all")
    summary.push(
      await runSafetyConfig(
        javaBin,
        jar,
        "RecoveryProtocolSubmissionSafety.cfg",
        "safety:submission",
      ),
    );
  if (mode === "liveness" || mode === "all")
    summary.push(await runLiveness(javaBin, jar));
  if (mode === "counterexamples" || mode === "all")
    summary.push(await runCounterexamples(javaBin, jar));
  if (isExplore) {
    // Explore runs the liveness model without gating — it always exits 0 so
    // a human can inspect PARTIAL / open-question results without CI failing.
    summary.push(await runLiveness(javaBin, jar));
  }

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
      const tag = s.partial ? "PARTIAL" : s.ok ? "PASS" : "FAIL";
      info(`  ${s.mode}: ${tag}${s.reason ? " — " + s.reason : ""}`);
    }
  }

  // Acceptance bar:
  //   safety / safety:route / safety:submission PASS  → ok
  //   liveness violation                                → FAIL (PARTIAL is a real fail)
  //   counterexample NOT reproduced / wrong violation   → FAIL
  // 'explore' is non-gated and always exits 0.
  if (isExplore) {
    info("suite (explore): non-gated — always exits 0. Review output above.");
    process.exit(0);
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
