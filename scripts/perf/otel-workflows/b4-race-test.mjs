#!/usr/bin/env node
/**
 * B4 / R2-03 directed race repro — same-attempt concurrent saves.
 *
 * Drives the REAL execOp + runOpStream path (imported from runner.js, never a
 * re-implementation) against a real APP_MODE=e2e server boot on the harness
 * test DB, with a single-attempt hot pool so every save collides on one
 * attempt. Pre-fix this reproduces the B4 client race: two workers snapshot
 * the same (clientSeq, baseVersion) across the HTTP await and the server's
 * loser returns STALE_VERSION, which the oracle correctly reports as an
 * unexpected shape (a false positive attributable to the harness, not the
 * product). Post-fix the per-attempt serialization ownership makes the same
 * test run with zero false positives.
 *
 * Evidence contract (workflow-audit-v3/b4-repro/): <label>.json +
 * <label>-ops.jsonl. Exit code: 0 iff the recorded outcome matches
 * --expect-violations (true = repro phase expects violations > 0).
 *
 * The concurrent-save experiment class (execConcurrentSaveBatch) runs after
 * the main stream when the runner exports it; its batch-level contract is
 * recorded alongside. In the pre-fix phase it is recorded as SKIPPED.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as runner from "./runner.js";

const HERE = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else {
        out[key] = true;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

const cli = parseArgs(process.argv);
const label = String(cli.label ?? `run-${new Date().toISOString()}`);
const expectViolations = cli["expect-violations"] === "true";
const concurrency = Math.max(2, Number(cli.concurrency ?? 8));
const saves = Math.max(2, Number(cli.saves ?? 24));
const configName = String(cli.config ?? "H1");
const outDir = cli.out
  ? pathResolve(String(cli.out))
  : join(HERE, "../../../out/otel-w964/workflow-audit-v3/b4-repro");

const manifest = runner.loadManifest(
  cli.manifest ? pathResolve(String(cli.manifest)) : join(HERE, "configs.json"),
);
// dbUrlFor/buildLaunchEnv/extendSeed read the module-global manifest — bind
// it explicitly on the directed-test path (CLI main() assigns the same global)
runner.setActiveManifest(manifest);
const config = manifest.configs[configName];
if (!config) throw new Error(`unknown config "${configName}"`);
const dbUrl = runner.dbUrlFor(configName);

const startedAt = new Date().toISOString();
const t0Wall = Date.now();
mkdirSync(outDir, { recursive: true });

let sql = null;
let server = null;
let exitCode = 1;
try {
  // ── DB: ensure + FULL converge + deterministic extend (§2.8) ──
  // INVARIANT: every run re-seeds, mirroring the runSegment lifecycle
  // (PROTOCOL §4.1). Post /start is RESUME semantics — a live in_progress
  // attempt from a previous run would be reused with a dirty version/receipt
  // history, and every save would legitimately STALE against it (that
  // invalidated the first post-fix attempt at 04:36: the client resumed an
  // attempt whose server version was 6 while the client state said 1).
  await runner.ensureBenchDatabase(() => {}, configName);
  await runner.convergeSeed(
    dbUrl,
    join(outDir, `seed-converge-${label}.log`),
    configName,
  );
  sql = await runner.openVerified(
    dbUrl,
    manifest.configs[configName].db ?? manifest.db.name,
  );
  await runner.extendSeed(sql, () => {}, configName);
  const examId = await runner.getBenchExamId(sql);
  if (!examId) throw new Error("bench exam missing after converge+extend");

  // ── boot: independent clean server process (H1 = telemetry Off) ──
  const bootDir = join(outDir, `boot-${label}`);
  mkdirSync(bootDir, { recursive: true });
  const env = runner.buildLaunchEnv(config, {
    segmentDir: bootDir,
    sinkPort: manifest.sink.port,
    dbUrl,
  });
  server = runner.spawnServer(
    config,
    env,
    join(bootDir, "server-out.log"),
    join(bootDir, "server-err.log"),
  );
  const http = new runner.Http(`http://127.0.0.1:${config.port}`);
  await runner.waitHttp(`http://127.0.0.1:${config.port}/api/health`, {
    timeoutMs: 60_000,
  });
  await runner.waitHttp(`http://127.0.0.1:${config.port}/api/ready`, {
    timeoutMs: 30_000,
  });

  // ── prep: single-attempt hot pool → every save collides on ONE attempt ──
  const plan = runner.buildAttemptPlan({
    hotAttemptsC3: 1,
    submitAttemptsC5: 1,
    frozenAttemptsW08: 1,
    unchangedAttemptsW08: 1,
    disruptedAttemptsW06: 1,
    staleAttemptsW09: 1,
    closedAttemptsC4: 1,
  });
  const prep = await runner.runPrep({ http, sql, plan, examId });
  const ctx = {
    http,
    sql,
    prep,
    t0: Date.now(),
    cursors: {},
    concurrency,
  };

  // ── concurrent saves through the REAL stream path ──
  const ops = Array.from({ length: saves }, () => ({ kind: "saveAccepted" }));
  const recs = [];
  const t0 = performance.now();
  await runner.runOpStream(ops, concurrency, async (op) => {
    recs.push(await runner.execOp(op, ctx));
    return true;
  });
  const streamMs = +(performance.now() - t0).toFixed(3);

  const accepted = recs.filter((r) => r.body?.accepted === true);
  const rejectedByReason = {};
  for (const r of recs) {
    if (r.body && r.body.accepted === false) {
      rejectedByReason[r.body.reason] =
        (rejectedByReason[r.body.reason] ?? 0) + 1;
    }
  }
  const violations = recs.flatMap((r) => r.violations);
  const attemptIds = [...new Set(recs.map((r) => r.attemptId))];
  // accepted-write chain: versions must advance by exactly 1 per accepted
  // save (replay-accepted responses re-deliver an old receipt and are exposed
  // by this contiguity check — they must not appear on a converged attempt)
  const versions = accepted.map((r) => r.body.serverVersion);
  const chainContiguous = versions.every(
    (v, i) => i === 0 || v === versions[i - 1] + 1,
  );

  // ── concurrent-save experiment class (exported post-fix only) ──
  let concurrentBatch =
    "SKIPPED (execConcurrentSaveBatch not exported at this phase)";
  if (typeof runner.execConcurrentSaveBatch === "function") {
    const batch = await runner.execConcurrentSaveBatch(ctx, { batchSize: 4 });
    concurrentBatch = {
      batchSize: batch.batchSize,
      baseline: batch.baseline,
      winnerSeq: batch.winnerSeq,
      winnerVersion: batch.winnerVersion,
      batchMs: batch.batchMs,
      violations: batch.violations,
      recs: batch.recs.map((r) => ({
        clientSeq: r.clientSeq,
        statusCode: r.statusCode,
        accepted: r.body?.accepted ?? null,
        reason: r.body?.reason ?? null,
        serverVersion: r.body?.serverVersion ?? null,
      })),
    };
  }

  const evidence = {
    label,
    expectViolations,
    startedAt,
    durationMs: Date.now() - t0Wall,
    config: configName,
    port: config.port,
    db: manifest.configs[configName].db ?? manifest.db.name,
    concurrency,
    saves,
    hotAttempts: prep.hotAttemptIds.length,
    collidedOnAttemptCount: attemptIds.length,
    result: {
      accepted: accepted.length,
      rejectedByReason,
      transportErrors: recs.filter((r) => r.error).length,
      violationsTotal: violations.length,
      violationsSample: violations.slice(0, 8),
      acceptedClientSeqChain: accepted.map((r) => r.clientSeq),
      acceptedVersionChain: versions,
      acceptedChainContiguous: chainContiguous,
      finalServerVersion: accepted.at(-1)?.body?.serverVersion ?? null,
    },
    concurrentBatch,
  };

  writeFileSync(
    join(outDir, `${label}.json`),
    JSON.stringify(evidence, null, 2),
  );
  writeFileSync(
    join(outDir, `${label}-ops.jsonl`),
    recs.map((r) => JSON.stringify(r)).join("\n") + "\n",
  );
  console.log(`###B4RACE###${JSON.stringify(evidence)}`);
  const batchOk =
    !concurrentBatch ||
    concurrentBatch === "SKIPPED" ||
    (concurrentBatch.violations?.length ?? 0) === 0;
  const streamOk = expectViolations
    ? evidence.result.violationsTotal > 0
    : evidence.result.violationsTotal === 0 &&
      evidence.result.acceptedChainContiguous;
  exitCode = streamOk && batchOk ? 0 : 1;
} catch (err) {
  const fail = {
    label,
    error: String(err?.stack ?? err).slice(0, 800),
    startedAt,
  };
  writeFileSync(
    join(outDir, `${label}.error.json`),
    JSON.stringify(fail, null, 2),
  );
  console.log(`###B4RACE-ERROR###${JSON.stringify(fail)}`);
  exitCode = 2;
} finally {
  if (server) {
    await runner.stopServerGracefully(server.child).catch(() => {});
    server.out.end();
    server.err.end();
  }
  if (sql) await sql.end({ timeout: 3 }).catch(() => {});
}
process.exit(exitCode);
