// Exam #817 — D6: old-backup restore + RPO measurement (R3).
//
// The Source stack keeps serving the real candidate flow. A pg_dump -Fc is
// taken AFTER the pre-dump answers are ACKed and PG-verified, the candidate
// keeps answering (post-dump ACKs), and the OLD dump is then restored into
// a SCRATCH PostgreSQL that shares nothing with the source: own compose
// project (`<run>-sc`), own env file, own PGDATA, own subnet. The source
// PGDATA is never touched by any restore path.
//
// Verdict semantics (R3 brief §5): the old snapshot not containing the
// post-dump updates is the EXPECTED recovery-point loss (POST_DUMP_MISSING /
// DUMP_RPO_LOSS) — not a PostgreSQL durability failure. A missing pre-dump
// answer in the restored DB is RESTORE_INTEGRITY_FAILURE; a restored DB that
// somehow contains post-dump versions means the dump window was violated.

import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { atomicWriteJson, sha256Hex } from "./mailbox.mjs";
import { COMPOSE_FILE, runPaths } from "./stack.mjs";
import { valuesEqual } from "./oracle.mjs";

const execFileP = promisify(execFile);

const PG_IMAGE = "postgres:18.4-bookworm";

export function scratchProjectName(runId) {
  return `exam817-${runId}-sc`;
}

// Local copy of the run-mjs hash: scratch port/subnet must differ from the
// source stack's, derived from a distinct key.
function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function scratchPaths(runId) {
  const p = runPaths(runId);
  return {
    root: path.join(p.root, "scratch"),
    dataRoot: path.join(p.root, "scratch", "data"),
    pgdata: path.join(p.root, "scratch", "data", "postgres"),
    deployDir: path.join(p.root, "scratch", "deploy"),
    envFile: path.join(p.root, "scratch", "deploy", "env.production"),
    evidenceDir: p.evidenceDir,
  };
}

function scratchComposeArgs(runId, extra) {
  const s = scratchPaths(runId);
  return ["compose", "--env-file", s.envFile, "-f", COMPOSE_FILE, "-p", scratchProjectName(runId), ...extra];
}

function sh(cmd, args, opts = {}) {
  return execFileP(cmd, args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, ...opts });
}

// ── Scratch stack lifecycle ───────────────────────────────────────

export async function scratchPreflight(runId) {
  const problems = [];
  const s = scratchPaths(runId);
  const project = scratchProjectName(runId);
  const port = 21000 + (fnv1a(`${runId}:scratch`) % 9999);
  const subnet = `172.28.${100 + (fnv1a(`${runId}:scratch`) % 100)}.0/24`;

  const { stdout: psOut } = await sh("docker", ["compose", "ls", "--format", "json"]).catch(() => ({ stdout: "[]" }));
  const t = (psOut || "[]").trim();
  const projList = t.startsWith("[") ? JSON.parse(t) : t.split("\n").filter(Boolean).map((l) => JSON.parse(l));
  for (const proj of projList) {
    if (proj.Name === project) problems.push(`scratch compose project '${project}' already exists`);
  }

  const nets = await sh("docker", ["network", "ls", "--format", "{{.Name}}"]).catch(() => ({ stdout: "" }));
  for (const n of nets.stdout.split("\n").filter(Boolean)) {
    const inspect = await sh("docker", ["network", "inspect", n, "--format", "{{json .IPAM.Config}}"]).catch(() => ({ stdout: "" }));
    if (inspect.stdout.includes(subnet)) problems.push(`docker network '${n}' already uses subnet ${subnet}`);
  }

  if (fs.existsSync(s.pgdata) && fs.readdirSync(s.pgdata).length > 0) {
    problems.push(`scratch PGDATA ${s.pgdata} already exists and is non-empty`);
  }
  if (s.root.startsWith("/mnt/")) problems.push(`scratch root ${s.root} is on a DrvFs mount (forbidden)`);

  return { ok: problems.length === 0, problems, project, port, subnet };
}

export function writeScratchEnv(runId, { port, subnet }) {
  const s = scratchPaths(runId);
  fs.mkdirSync(s.deployDir, { recursive: true });
  const env = [
    `# Exam #817 D6 scratch restore stack (generated). Source stack env is separate.`,
    `EXAM_IMAGE=exam817-e817:app`,
    `EXAM_WEB_IMAGE=exam817-e817:web`,
    `EXAM_PORT=${port}`,
    `EXAM_DATA_ROOT=${s.dataRoot}`,
    `EXAM_DOCKER_SUBNET=${subnet}`,
    `POSTGRES_USER=exam`,
    `POSTGRES_DB=exam`,
    `POSTGRES_PASSWORD=e817sc-${randomBytes(16).toString("hex")}`,
    `JWT_SECRET=e817jwt-${randomBytes(32).toString("hex")}`,
    `LAUNCHPAD_SETUP_TOKEN=e817lp-${randomBytes(24).toString("hex")}`,
    `CORS_ORIGIN=http://localhost:${port}`,
    `PUBLIC_WEB_ORIGIN=http://localhost:${port}`,
    `EXAM_HOST_ALIAS=localhost`,
    `DEPLOYMENT_MODE=singleTenant`,
    `EMAIL_ENABLED=false`,
    `TZ=Asia/Shanghai`,
    `APP_TIMEZONE=Asia/Shanghai`,
    ``,
  ].join("\n");
  fs.writeFileSync(s.envFile, env, { mode: 0o600 });
  return { envFile: s.envFile, port, subnet };
}

/** Start the scratch stack's db service ONLY (production compose file, db has no depends_on). */
export async function scratchUp(runId) {
  const s = scratchPaths(runId);
  await sh("docker", scratchComposeArgs(runId, ["up", "-d", "db"]));
  // Wait for pg_isready through the healthcheck-ish direct probe.
  const deadline = Date.now() + 90000;
  for (;;) {
    try {
      const { stdout } = await sh("docker", [
        "compose", "--env-file", s.envFile, "-f", COMPOSE_FILE, "-p", scratchProjectName(runId),
        "exec", "-T", "db", "pg_isready", "-U", "exam", "-d", "exam",
      ]);
      if (stdout.includes("accepting connections")) return { ready: true };
    } catch (e) {
      if (Date.now() > deadline) throw new Error(`scratch db not ready within 90s: ${e.message}`);
    }
    if (Date.now() > deadline) throw new Error("scratch db not ready within 90s");
    await new Promise((r) => setTimeout(r, 1000));
  }
}

/** Scratch psql sidecar (SELECT-only usage by the caller, like oracle.pgQuery). */
export async function scratchQuery(runId, sql, { timeoutMs = 30000 } = {}) {
  const s = scratchPaths(runId);
  const env = fs.readFileSync(s.envFile, "utf8");
  const password = env.match(/^POSTGRES_PASSWORD=(.*)$/m)[1];
  const network = `${scratchProjectName(runId)}_exam-net`;
  const { stdout } = await sh(
    "docker",
    [
      "run", "--rm", "--network", network,
      "-e", `PGPASSWORD=${password}`,
      PG_IMAGE,
      "psql", "-h", "db", "-U", "exam", "-d", "exam",
      "-v", "ON_ERROR_STOP=1", "-At", "-c", sql,
    ],
    { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 },
  );
  return { stdout };
}

// ── Dump / restore ────────────────────────────────────────────────

/**
 * Full pg_dump -Fc of the SOURCE db via docker exec. Binary stdout is
 * captured as a Buffer and written to run evidence with its sha256.
 */
export async function pgDumpSource(runId, { trialId } = {}) {
  const p = runPaths(runId);
  const { stdout: psContainers } = await sh("docker", [
    "ps", "--filter", `label=com.docker.compose.project=exam817-${runId}`,
    "--filter", "label=com.docker.compose.service=db", "--format", "{{.ID}}",
  ]);
  const dbId = psContainers.trim().split("\n")[0];
  if (!dbId) throw new Error("source db container not found for pg_dump (identity gate)");

  const startedAt = new Date().toISOString();
  const { stdout: versionOut } = await sh("docker", ["exec", dbId, "pg_dump", "--version"]);
  const t0 = Date.now();
  const { stdout: dump } = await execFileP("docker", ["exec", dbId, "pg_dump", "-U", "exam", "-d", "exam", "-Fc", "--no-owner", "--no-privileges"], {
    encoding: "buffer",
    maxBuffer: 256 * 1024 * 1024,
    timeout: 120000,
  });
  const durationMs = Date.now() - t0;
  const completedAt = new Date().toISOString();
  const file = path.join(p.evidenceDir, `source-dump-${trialId}.dump`);
  fs.writeFileSync(file, dump);
  const receipt = {
    command: `docker exec <source-db> pg_dump -U exam -d exam -Fc --no-owner --no-privileges`,
    db_container_id: dbId,
    pg_dump_version: versionOut.trim(),
    started_at: startedAt,
    completed_at: completedAt,
    duration_ms: durationMs,
    exit: 0,
    bytes: dump.length,
    sha256: sha256Hex(dump),
    file: path.basename(file),
  };
  atomicWriteJson(path.join(p.evidenceDir, `d6-dump-receipt-${trialId}.json`), receipt);
  return receipt;
}

/** Restore the dump into the SCRATCH db via a read-only sidecar. */
export async function pgRestoreScratch(runId, dumpReceipt, { trialId } = {}) {
  const p = runPaths(runId);
  const dumpPath = path.join(p.evidenceDir, dumpReceipt.file);
  const network = `${scratchProjectName(runId)}_exam-net`;
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  let exit = 0;
  let stderr = "";
  try {
    await sh(
      "docker",
      [
        "run", "--rm", "--network", network,
        "-v", `${dumpPath}:/dump/source.dump:ro`,
        "-e", "PGPASSWORD=" + sourceDbPasswordForScratch(runId),
        PG_IMAGE,
        "pg_restore", "-h", "db", "-U", "exam", "-d", "exam",
        "--no-owner", "--no-privileges", "--exit-on-error", "/dump/source.dump",
      ],
      { timeout: 180000, maxBuffer: 8 * 1024 * 1024 },
    );
  } catch (e) {
    exit = e.code ?? 1;
    stderr = (e.stderr?.toString?.() ?? e.message ?? "").slice(0, 2000);
  }
  const receipt = {
    command: "docker run --rm --network <scratch-net> -v <dump>:ro postgres:18.4-bookworm pg_restore -h db -U exam -d exam --no-owner --no-privileges --exit-on-error",
    dump_sha256: dumpReceipt.sha256,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    duration_ms: Date.now() - t0,
    exit,
    stderr,
  };
  atomicWriteJson(path.join(p.evidenceDir, `d6-restore-receipt-${trialId}.json`), receipt);
  if (exit !== 0) throw new Error(`pg_restore exited ${exit}: ${stderr.slice(0, 200)}`);
  return receipt;
}

function sourceDbPasswordForScratch(runId) {
  const s = scratchPaths(runId);
  const env = fs.readFileSync(s.envFile, "utf8");
  return env.match(/^POSTGRES_PASSWORD=(.*)$/m)[1];
}

// ── Comparison ────────────────────────────────────────────────────

function latestByQuestion(answers) {
  const latest = new Map();
  for (const rec of answers ?? []) {
    const prev = latest.get(rec.questionId);
    if (!prev || Number(rec.version) > Number(prev.version)) latest.set(rec.questionId, rec);
  }
  return latest;
}

/**
 * Per-question, per-version comparison of the restored (scratch) DB against
 * the two ACK generations. Pre-dump answers MUST be present exactly as
 * ACKed; post-dump answers MUST be absent (the recovery-point gap — the
 * measured RPO loss, not a durability failure).
 *
 * @returns per-question entries {question_id, role, classification,
 *          scratch_version, expected_pre_version, rpo_note?}
 */
export function compareD6({ manifestQuestions, scratchRow, ackStatePre, ackStatePost }) {
  const scratchLatest = latestByQuestion(scratchRow?.answers);
  const out = [];
  for (const q of manifestQuestions) {
    const qid = q.question_id;
    const post = ackStatePost?.[qid] ?? null;
    const pre = ackStatePre?.[qid] ?? null;
    const role = post ? "post_dump" : "pre_dump";
    const rec = scratchLatest.get(qid) ?? null;

    if (role === "pre_dump") {
      const retained =
        pre && rec &&
        Number(rec.version) === Number(pre.serverVersion) &&
        contentMatches(pre, rec.answer, q.type);
      out.push({
        question_id: qid,
        role,
        classification: retained ? "PRE_DUMP_RETAINED" : "RESTORE_INTEGRITY_FAILURE",
        scratch_version: rec?.version ?? null,
        expected_pre_version: pre?.serverVersion ?? null,
      });
      continue;
    }
    // post_dump: the restored DB must still hold the PRE-dump state for this
    // question (same version and value the pre-dump ACK had) and must NOT
    // contain the post-dump version.
    const preIntact =
      pre && rec &&
      Number(rec.version) === Number(pre.serverVersion) &&
      contentMatches(pre, rec.answer, q.type);
    const postLeaked =
      rec && post && (Number(rec.version) >= Number(post.serverVersion) || contentMatches(post, rec.answer, q.type));
    let classification;
    if (preIntact && !postLeaked) classification = "POST_DUMP_MISSING";
    else if (postLeaked) classification = "DUMP_WINDOW_VIOLATED";
    else classification = "RESTORE_INTEGRITY_FAILURE";
    out.push({
      question_id: qid,
      role,
      classification,
      scratch_version: rec?.version ?? null,
      expected_pre_version: pre?.serverVersion ?? null,
      post_ack_version: post?.serverVersion ?? null,
    });
  }
  return out;
}

function contentMatches(ack, actualValue, type) {
  if (!ack) return false;
  if (ack.answer_value !== undefined && ack.answer_value !== null) {
    return valuesEqual(ack.answer_value, actualValue, type);
  }
  if (ack.answer_digest) return sha256Hex(JSON.stringify(actualValue)) === ack.answer_digest;
  return false;
}

/**
 * RPO measurement: per post-dump answer, how long after the dump snapshot
 * its ACK arrived (the answer exists in the source but not in any backup
 * taken at dump time).
 */
export function measureRpo({ dumpReceipt, ackStatePost }) {
  const dumpCompletedMs = Date.parse(dumpReceipt.completed_at);
  const entries = Object.entries(ackStatePost ?? {}).map(([qid, ack]) => ({
    question_id: qid,
    ack_at: ack.at ?? null,
    rpo_ms: ack.at ? Date.parse(ack.at) - dumpCompletedMs : null,
    ack_version: ack.serverVersion ?? null,
  }));
  entries.sort((a, b) => (a.rpo_ms ?? Infinity) - (b.rpo_ms ?? Infinity));
  return {
    dump_completed_at: dumpReceipt.completed_at,
    lost_answer_count: entries.length,
    rpo_min_ms: entries[0]?.rpo_ms ?? null,
    rpo_max_ms: entries[entries.length - 1]?.rpo_ms ?? null,
    per_answer: entries,
  };
}

/**
 * The post-dump ACK set is ONLY the gen2 questions — phase C re-edits
 * exactly re_save_order_gen2. Folding the whole ack_state (D6-01 defect)
 * made every gen1-only question look "post-dump" and its own pre-dump
 * version trip the leak check (DUMP_WINDOW_VIOLATED on 6/6 gen1-only).
 */
export function postDumpAckSubset(ackState, manifestQuestions) {
  const gen2 = new Set(
    (manifestQuestions ?? [])
      .filter((q) => q.expected_gen2 !== null && q.expected_gen2 !== undefined)
      .map((q) => q.question_id),
  );
  const out = {};
  for (const [qid, ack] of Object.entries(ackState ?? {})) {
    if (gen2.has(qid)) out[qid] = ack;
  }
  return out;
}

// ── Scratch teardown ──────────────────────────────────────────────

export async function scratchDown(runId, { deleteData = false } = {}) {
  const s = scratchPaths(runId);
  const project = scratchProjectName(runId);
  const { stdout: before } = await sh("docker", [
    "ps", "-a", "--filter", `label=com.docker.compose.project=${project}`, "--format", "{{.ID}} {{.Names}} {{.Status}}",
  ]).catch(() => ({ stdout: "" }));
  if (before.trim().length > 0) {
    await sh("docker", scratchComposeArgs(runId, ["down"]));
  }
  const { stdout: after } = await sh("docker", [
    "ps", "-a", "--filter", `label=com.docker.compose.project=${project}`, "--format", "{{.ID}}",
  ]).catch(() => ({ stdout: "" }));
  let dataDeleted = false;
  if (deleteData && after.trim().length === 0 && fs.existsSync(s.dataRoot)) {
    await execFileP("docker", [
      "run", "--rm", "-v", `${s.dataRoot}:/target`, "alpine:latest",
      "sh", "-c", "rm -rf /target/postgres /target/redis && ls -A /target",
    ]).catch((e) => {
      throw new Error(`scratch data cleanup container failed: ${e.message}`);
    });
    fs.rmSync(s.dataRoot, { recursive: true, force: true });
    dataDeleted = !fs.existsSync(s.dataRoot);
  }
  return {
    project,
    containers_before: before.trim().split("\n").filter(Boolean),
    containers_after: after.trim().split("\n").filter(Boolean),
    data_root_deleted: dataDeleted,
  };
}
