#!/usr/bin/env node
// Exam #817 — WSL Reliability Harness orchestrator.
//
// One run_id per trial (maximum isolation + replay safety). Lifecycle:
//   init → deploy → seed → publish(scenario + ENV_READY) → wait
//   [CHECKPOINT_READY → FAULT_INTENT → fault → recovery → SERVICE_RECOVERED
//    → BROWSER_VERIFIED → verdict] → cleanup → report
//
// RESEARCH ONLY: never touches containers outside this run's compose
// project; never writes candidate answers directly to the DB.

import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { atomicWriteJson, EventWriter, JsonlFileReader, dedupKey, SCHEMA_VERSION, sha256Hex } from "./mailbox.mjs";
import {
  BASE_SHA,
  captureDeploymentEvidence,
  composeUp,
  generateEnvFile,
  preflight,
  runContainers,
  runPaths,
  waitForHealthy,
} from "./stack.mjs";
import { seedExamData } from "./seed.mjs";
import {
  capturePgSettings,
  captureWalRecoveryLog,
  classifyPerQuestion,
  oracleMutationRedTest,
  pgQuery,
  snapshotAttempt,
  writePgSnapshotEvidence,
} from "./oracle.mjs";
import { executeFault, FAULT_PLAN, probeRecovery, resolveInterruptedFault } from "./fault.mjs";

const execFileP = promisify(execFile);

const MAILBOX_ROOT = "/mnt/c/Users/fred1/exam-817/mailbox";
const RUNS_ROOT = "/home/hoo/exam817-runs";

const WINDOWS_EVENTS = "windows.events.jsonl";

// ── run state ─────────────────────────────────────────────────────

function statePath(runId) {
  return path.join(RUNS_ROOT, runId, "wsl.state.json");
}

function loadState(runId) {
  const st = JSON.parse(fs.readFileSync(statePath(runId), "utf8"));
  st.dispatched = new Set(st.dispatched_keys ?? []);
  return st;
}

function saveState(runId, st) {
  const s = { ...st, dispatched_keys: [...st.dispatched] };
  delete s.dispatched;
  atomicWriteJson(statePath(runId), s);
}

function mailboxDir(runId) {
  return path.join(MAILBOX_ROOT, runId);
}

function newRunId(arm) {
  // Compose project names: lowercase alphanumerics, hyphens, underscores
  // only — timestamps are compact lowercase, plus a random suffix.
  const ts = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "").toLowerCase();
  return `e817-${arm.toLowerCase()}-${ts}${randomBytes(2).toString("hex")}`;
}

// ── commands ──────────────────────────────────────────────────────

function cmdInit(argv) {
  const armIdx = argv.indexOf("--arm");
  const arm = armIdx >= 0 ? argv[armIdx + 1] : null;
  if (!arm || !FAULT_PLAN[arm]) {
    console.error("usage: run.mjs init --arm D0|D1|D2|D3|D4|D5 [--run-id <id>]");
    process.exit(2);
  }
  const idIdx = argv.indexOf("--run-id");
  const runId = idIdx >= 0 ? argv[idIdx + 1] : newRunId(arm);
  const trialId = `t-${runId.split("-").slice(2).join("-")}`;
  const p = runPaths(runId);
  fs.mkdirSync(p.evidenceDir, { recursive: true });
  fs.mkdirSync(path.join(mailboxDir(runId), "artifacts", "wsl"), { recursive: true });
  const st = {
    schema_version: SCHEMA_VERSION,
    run_id: runId,
    trial_id: trialId,
    arm,
    source_sha: BASE_SHA,
    phase: "initialized",
    created_at: new Date().toISOString(),
    fault_plan: FAULT_PLAN[arm],
    dispatched: [],
    ack_state: {},
    fault_resolved: null,
    scenario_published_at: null,
    env_ready_event_id: null,
    port: null,
    origin: null,
    exam_id: null,
    attempt_id: null,
  };
  saveState(runId, st);
  console.log(`initialized run ${runId} (trial ${trialId}, arm ${arm}, sha ${BASE_SHA})`);
  console.log(`run dir: ${p.root}`);
  console.log(`mailbox: ${mailboxDir(runId)}`);
}

async function cmdDeploy(runId) {
  const st = loadState(runId);
  const port = 21000 + (fnv1a(st.run_id) % 9999);
  const subnet = `172.28.${100 + (fnv1a(st.run_id) % 100)}.0/24`;
  const hostAlias = "localhost"; // Windows Chrome reaches WSL via localhost
  console.log(`preflight: port=${port} subnet=${subnet} project=exam817-${runId}`);
  const pf = await preflight(runId, port, subnet);
  if (!pf.ok) {
    console.error("PREFLIGHT FAILED — closed:");
    for (const pr of pf.problems) console.error(`  - ${pr}`);
    process.exit(1);
  }
  console.log("preflight OK");

  const { origin, launchpadToken } = generateEnvFile(runId, port, subnet, hostAlias);
  console.log(`env file: ${runPaths(runId).envFile}`);

  console.log("compose up...");
  await composeUp(runId);
  const health = await waitForHealthy(runId);
  console.log(`stack healthy after ${health.waitedMs}ms at ${origin}`);

  const evidence = await captureDeploymentEvidence(runId);
  console.log(`db container: ${evidence.containers.db?.id}`);
  console.log(`pgdata mount: ${evidence.pgdata_mount?.source}`);

  st.phase = "deployed";
  st.port = port;
  st.origin = origin;
  st.launchpad_token_local = launchpadToken; // never published
  st.deployment_evidence = {
    project: evidence.project,
    db_container_id: evidence.containers.db?.id,
    app_container_id: evidence.containers.app?.id,
    web_container_id: evidence.containers.web?.id,
    pgdata_mount: evidence.pgdata_mount,
    images: evidence.images,
    image_repo_digests: evidence.image_repo_digests,
    filesystem: evidence.filesystem,
    subnet: evidence.subnet,
  };
  saveState(runId, st);
  console.log("phase: deployed");
}

async function cmdSeed(runId) {
  const st = loadState(runId);
  if (st.phase !== "deployed") throw new Error(`seed requires phase=deployed (got ${st.phase})`);
  const trialId = st.trial_id;
  // Resume support: every completed step is persisted before the next one
  // starts, so a mid-seed contract failure costs one API call, not a whole
  // deployment cycle. Credentials live only in the local run state.
  st.seed_progress = st.seed_progress ?? {};
  saveState(runId, st);
  console.log(`seeding exam data for trial ${trialId} via product API at ${st.origin}`);
  const seed = await seedExamData({
    origin: st.origin,
    launchpadToken: st.launchpad_token_local,
    runId: st.run_id,
    trialId,
    evidenceDir: runPaths(runId).evidenceDir,
    resume: st.seed_progress,
    persist: (progress) => {
      st.seed_progress = { ...st.seed_progress, ...progress };
      saveState(runId, st);
    },
  });

  // Credentials stay on the local channel only (mailbox file, never in
  // evidence, never committed).
  atomicWriteJson(path.join(mailboxDir(runId), "credentials.local.json"), {
    schema_version: SCHEMA_VERSION,
    run_id: st.run_id,
    trial_id: trialId,
    exam_url: st.origin,
    admin: seed.admin,
    candidate: seed.candidate,
    note: "LOCAL-ONLY credential channel for the paired harness. Never commit, never copy into events or evidence.",
  });

  st.phase = "seeded";
  st.exam_id = seed.examId;
  st.manifest_questions = seed.manifestQuestions;
  st.expected_question_count = seed.manifestQuestions.length;
  st.marker = seed.marker;
  saveState(runId, st);
  console.log(`exam ${seed.examId} ready; ${seed.manifestQuestions.length} questions in manifest`);
}

function buildScenario(st) {
  const gen2Questions = st.manifest_questions.filter((q) => q.expected_gen2 !== null).map((q) => q.question_id);
  return {
    schema_version: SCHEMA_VERSION,
    kind: "exam817/scenario",
    run_id: st.run_id,
    trial_id: st.trial_id,
    source_sha: BASE_SHA,
    exam_url: st.origin,
    exam_id: st.exam_id,
    candidate_identity_ref: "credentials.local.json#candidate",
    expected_question_count: st.expected_question_count,
    fault: {
      arm: st.arm,
      target: st.fault_plan.target,
      trigger: "ALL_EXPECTED_SAVES_ACCEPTED",
      description: st.fault_plan.label,
    },
    answer_manifest: {
      marker: st.marker,
      save_order_gen1: st.manifest_questions.map((q) => q.question_id),
      re_save_order_gen2: gen2Questions,
      questions: st.manifest_questions,
      value_hints: {
        true_false: "boolean true(对)/false(错)",
        single_choice: "option id string, e.g. \"A\"",
        multiple_choice: "array of option ids, e.g. [\"A\",\"B\"]",
        fill_blank: "exact marker string, type it verbatim",
        text_response: "exact string including any newlines (use the editor's own line breaks for \\r\\n)",
      },
    },
    answer_flow: {
      attempt_start: "browser: login as candidate → open exam → click start (real UI flow)",
      save_endpoint: "POST /api/attempts/:attemptId/answers/:questionId",
      ack_requires: ["accepted === true", "serverVersion present (HTTP 200 alone is not an ACK)"],
      debounce_note: "TakeExamPage flushes edits after a 1500ms in-memory debounce; wait for the SAVE_ACCEPTED per question before the next phase",
      windows_events_file: WINDOWS_EVENTS,
    },
    windows_instructions: [
      "1. Read credentials.local.json (local-only) and log in as the candidate in Chrome.",
      "2. Open the exam and start the attempt through the real UI.",
      "3. Fill EVERY question with answer_manifest.questions[*].expected_gen1, in save_order_gen1 order.",
      "4. For each observed save request, append a SAVE_ACCEPTED event (accepted + server_version + evidence refs).",
      "5. Re-edit ONLY re_save_order_gen2 questions with expected_gen2 values; append SAVE_ACCEPTED for those too.",
      "6. When every question's LAST save is ACKed, append CHECKPOINT_READY {arm, attempt_id, saves[]}.",
      "7. After the WSL side emits SERVICE_RECOVERED, reload the SAME candidate page, re-read every answer,",
      "   and append BROWSER_VERIFIED {attempt_id, browser_answers[]}.",
      "Do not write any other files in the run directory except windows.events.jsonl, windows-result.json",
      "and artifacts/windows/*.",
    ],
  };
}

async function cmdPublish(runId) {
  const st = loadState(runId);
  if (st.phase !== "seeded") throw new Error(`publish requires phase=seeded (got ${st.phase})`);
  const scenario = buildScenario(st);
  const scenarioPath = path.join(mailboxDir(runId), "scenario.json");
  atomicWriteJson(scenarioPath, scenario);
  st.phase = "scenario_published";
  st.scenario_published_at = new Date().toISOString();
  saveState(runId, st);

  const writer = new EventWriter(path.join(mailboxDir(runId), "wsl.events.jsonl"), path.join(runPaths(runId).evidenceDir, "wsl-seq.json"));
  const ev = writer.append("ENV_READY", {
    run_id: st.run_id,
    trial_id: st.trial_id,
    exam_url: st.origin,
    exam_id: st.exam_id,
    expected_question_count: st.expected_question_count,
    scenario_ref: "scenario.json",
    scenario_sha256: sha256Hex(fs.readFileSync(scenarioPath)),
    arm: st.arm,
    fault_description: st.fault_plan.label,
  });
  st.env_ready_event_id = ev.event_id;
  saveState(runId, st);
  console.log(`scenario published + ENV_READY (${ev.event_id}). Waiting for Windows.`);
}

// ── wait loop / trial state machine ───────────────────────────────

function requireFields(obj, fields, what) {
  const missing = fields.filter((f) => obj[f] === undefined || obj[f] === null);
  if (missing.length > 0) throw new Error(`${what} missing fields: ${missing.join(",")}`);
}

async function cmdWait(runId, { timeoutSec = 7200, browserTimeoutSec = 900 } = {}) {
  const st = loadState(runId);
  if (!["scenario_published"].includes(st.phase)) {
    throw new Error(`wait requires phase=scenario_published (got ${st.phase})`);
  }
  const mdir = mailboxDir(runId);
  const winEventsPath = path.join(mdir, WINDOWS_EVENTS);
  const cursorPath = path.join(runPaths(runId).evidenceDir, "windows-reader-cursor.json");
  const reader = new JsonlFileReader(winEventsPath, cursorPath);
  const writer = new EventWriter(path.join(mdir, "wsl.events.jsonl"), path.join(runPaths(runId).evidenceDir, "wsl-seq.json"));
  const deadline = Date.now() + timeoutSec * 1000;
  let browserDeadline = null;

  // Resume: an interrupted fault between INTENT and terminal event resolves
  // from container evidence — never re-killed blindly.
  if (st.fault_intent_written && !st.fault_terminal) {
    console.log("resuming: FAULT_INTENT present without terminal receipt — resolving from container evidence");
    const res = await resolveInterruptedFault(runId, { arm: st.arm, trialId: st.trial_id });
    st.fault_resolved = res;
    saveState(runId, st);
    writer.append("FAULT_RESOLVED_UNKNOWN", { run_id: st.run_id, trial_id: st.trial_id, classification: res.classification, reason: res.reason });
    if (res.classification === "APPLIED") {
      st.fault_terminal = { kind: "FAULT_APPLIED", receipt: res.receipt ?? null };
      st.phase = "fault_done";
    } else if (res.classification === "NOT_APPLIED") {
      st.fault_terminal = null;
      st.fault_intent_written = false;
      st.phase = "scenario_published";
      console.log("fault NOT_APPLIED (container untouched) — checkpoint remains valid, fault will re-run on next CHECKPOINT_READY");
    } else {
      console.error(`fault resolution: ${res.classification} — ${res.reason}`);
      st.phase = "incomplete";
      saveState(runId, st);
      await writeVerdict(runId, st, writer, { verdict: "UNKNOWN", reason: `interrupted fault resolved as ${res.classification}: ${res.reason}` });
      return;
    }
    saveState(runId, st);
  }

  console.log(`polling ${winEventsPath} (phase=${st.phase}, arm=${st.arm})`);

  for (;;) {
    if (Date.now() > deadline) {
      st.phase = "incomplete";
      saveState(runId, st);
      await writeVerdict(runId, st, writer, { verdict: "INCOMPLETE", reason: `wait timeout after ${timeoutSec}s without trial completion` });
      return;
    }

    const { records, rejected, halted } = reader.poll();
    if (halted) {
      console.error(`READER HALTED: ${halted.reason} — refusing to skip bytes; stopping fault execution path.`);
      st.phase = "incomplete";
      saveState(runId, st);
      await writeVerdict(runId, st, writer, { verdict: "UNKNOWN", reason: `windows events reader halted: ${halted.reason}` });
      return;
    }
    for (const rej of rejected) {
      console.log(`  [rejected] line ${rej.lineNo}: ${rej.reason}`);
      writer.append("PROTOCOL_REJECTED", {
        run_id: st.run_id,
        trial_id: st.trial_id,
        file: WINDOWS_EVENTS,
        line_no: rej.lineNo,
        line_sha256: rej.lineSha256,
        reason: rej.reason,
      });
    }

    for (const rec of records) {
      const key = dedupKey(WINDOWS_EVENTS, rec.value);
      if (st.dispatched.has(key)) continue;
      st.dispatched.add(key);
      const ev = rec.value;

      if (ev.run_id !== st.run_id || ev.trial_id !== st.trial_id) {
        console.log(`  [ignored] ${ev.event} for ${ev.run_id}/${ev.trial_id} (not this run)`);
        continue;
      }
      saveState(runId, st);

      try {
        if (ev.event === "SAVE_ACCEPTED") {
          requireFields(ev, ["attempt_id", "question_id", "generation", "server_version", "evidence_ref"], "SAVE_ACCEPTED");
          if (ev.accepted !== true) {
            console.log(`  [save] question ${ev.question_id} NOT accepted (${JSON.stringify(ev.reason ?? "")})`);
            st.rejected_saves = st.rejected_saves ?? {};
            st.rejected_saves[ev.question_id] = { generation: ev.generation, reason: ev.reason ?? "unknown" };
            saveState(runId, st);
            continue;
          }
          st.attempt_id = ev.attempt_id;
          st.ack_state[ev.question_id] = {
            generation: ev.generation,
            serverVersion: ev.server_version,
            evidence_ref: ev.evidence_ref,
            at: ev.timestamp_utc,
          };
          saveState(runId, st);
          console.log(`  [save] q=${ev.question_id.slice(0, 8)} gen=${ev.generation} v=${ev.server_version} ACKED`);
        } else if (ev.event === "CHECKPOINT_READY") {
          requireFields(ev, ["arm", "attempt_id", "saves", "evidence_ref"], "CHECKPOINT_READY");
          await handleCheckpoint(runId, st, writer, ev, reader);
          if (st.phase === "incomplete") return;
        } else if (ev.event === "BROWSER_VERIFIED") {
          requireFields(ev, ["attempt_id", "browser_answers", "evidence_ref"], "BROWSER_VERIFIED");
          st.browser_verified = {
            at: ev.timestamp_utc,
            attempt_id: ev.attempt_id,
            reload_at: ev.reload_at ?? null,
            evidence_ref: ev.evidence_ref,
            browser_answers: ev.browser_answers,
          };
          st.browser_state = {};
          for (const b of ev.browser_answers) {
            st.browser_state[b.question_id] = { visible_value: b.visible_value, evidence_ref: ev.evidence_ref };
          }
          st.phase = "verdict_phase";
          saveState(runId, st);
          await writeVerdict(runId, st, writer, {});
          return;
        } else if (ev.event === "WINDOW_ERROR") {
          console.log(`  [window-error] ${JSON.stringify(ev).slice(0, 300)}`);
          st.window_error = ev;
          saveState(runId, st);
        } else if (ev.event === "HELLO") {
          console.log(`  [hello] windows agent: ${JSON.stringify(ev.agent ?? {})}`.slice(0, 200));
        } else {
          console.log(`  [unhandled] ${ev.event} (logged, no action)`);
        }
      } catch (e) {
        console.error(`  [dispatch-error] ${ev.event}: ${e.message}`);
        writer.append("PROTOCOL_REJECTED", {
          run_id: st.run_id,
          trial_id: st.trial_id,
          file: WINDOWS_EVENTS,
          event_id: ev.event_id,
          reason: `dispatch error on ${ev.event}: ${e.message}`,
        });
        st.phase = "incomplete";
        saveState(runId, st);
        await writeVerdict(runId, st, writer, { verdict: "UNKNOWN", reason: `dispatch error on ${ev.event}: ${e.message}` });
        return;
      }
    }

    // Browser-verified watchdog: SERVICE_RECOVERED sent but no browser result.
    if (st.phase === "service_recovered" && !st.browser_verified) {
      if (browserDeadline === null) browserDeadline = Date.now() + browserTimeoutSec * 1000;
      if (Date.now() > browserDeadline) {
        st.phase = "incomplete";
        saveState(runId, st);
        await writeVerdict(runId, st, writer, { verdict: "INCOMPLETE", reason: `no BROWSER_VERIFIED within ${browserTimeoutSec}s after SERVICE_RECOVERED` });
        return;
      }
    }

    await new Promise((r) => setTimeout(r, 500));
  }
}

async function handleCheckpoint(runId, st, writer, ev, reader) {
  // 1. Validate the checkpoint against the frozen plan.
  if (ev.arm !== st.arm) throw new Error(`CHECKPOINT_READY arm ${ev.arm} != frozen arm ${st.arm}`);
  const acked = new Set(Object.keys(st.ack_state));
  const saves = new Set((ev.saves ?? []).map((s) => s.question_id));
  const expected = new Set(st.manifest_questions.map((q) => q.question_id));
  const missing = [...expected].filter((q) => !acked.has(q) && !saves.has(q));
  if (missing.length > 0) {
    throw new Error(`CHECKPOINT_READY lacks ACKed saves for ${missing.length} questions: ${missing.slice(0, 3).join(",")}`);
  }
  // Fold the checkpoint's save receipts into ack state (authoritative last write).
  for (const s of ev.saves ?? []) {
    if (s.accepted === true && s.server_version !== undefined) {
      st.ack_state[s.question_id] = {
        generation: s.generation ?? st.ack_state[s.question_id]?.generation ?? 1,
        serverVersion: s.server_version,
        evidence_ref: s.evidence_ref ?? ev.evidence_ref,
        at: ev.timestamp_utc,
      };
    }
  }
  st.attempt_id = ev.attempt_id;

  // 2. Cross-check attempt identity in PG (exactly one in_progress attempt
  // for this exam — maxAttempts=1, single candidate).
  const sql =
    `SELECT row_to_json(t) FROM (SELECT id, status FROM exam_attempts WHERE exam_id = '${st.exam_id}') t;`;
  const { stdout } = await pgQuery(runId, sql);
  const attempts = stdout.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const active = attempts.filter((a) => a.status === "in_progress");
  if (active.length !== 1 || active[0].id !== ev.attempt_id) {
    throw new Error(
      `attempt identity mismatch: checkpoint says ${ev.attempt_id}, PG has ${active.length} in_progress attempt(s) for exam ${st.exam_id}: ${active.map((a) => a.id).join(",")}`,
    );
  }

  // 3. PRE-fault authoritative snapshot (read-only; latency recorded).
  const pre = await snapshotAttempt(runId, ev.attempt_id);
  if (!pre) throw new Error("pre-fault snapshot: attempt row not found");
  const preEv = await writePgSnapshotEvidence(runId, st.trial_id, "pre", pre);
  writer.append("PG_SNAPSHOT_TAKEN", {
    run_id: st.run_id,
    trial_id: st.trial_id,
    phase: "pre",
    attempt_id: ev.attempt_id,
    evidence_ref: path.basename(preEv.file),
    sha256: preEv.sha256,
    query_latency_ms: preEv.latencyMs,
  });
  console.log(`pre-fault snapshot taken (${preEv.latencyMs.toFixed(0)}ms)`);
  st.pre_snapshot = { ref: path.basename(preEv.file), sha256: preEv.sha256, latency_ms: preEv.latencyMs };

  // 4. Persist FAULT_INTENT BEFORE touching Docker (replay-safety anchor).
  writer.append("FAULT_INTENT", {
    run_id: st.run_id,
    trial_id: st.trial_id,
    arm: st.arm,
    checkpoint_event_id: ev.event_id,
    checkpoint_seq: ev.seq,
    attempt_id: ev.attempt_id,
    planned_action: st.fault_plan.action,
    planned_target: st.fault_plan.target,
  });
  st.fault_intent_written = true;
  st.phase = "fault_phase";
  saveState(runId, st);

  // 5. Execute the fault (identity-gated inside).
  let receipt;
  try {
    receipt = await executeFault(runId, { arm: st.arm, trialId: st.trial_id });
    st.fault_terminal = { kind: "FAULT_APPLIED", receipt };
  } catch (e) {
    st.fault_terminal = { kind: "FAULT_FAILED", reason: e.message };
    saveState(runId, st);
    writer.append("FAULT_FAILED", { run_id: st.run_id, trial_id: st.trial_id, arm: st.arm, reason: e.message });
    st.phase = "incomplete";
    saveState(runId, st);
    await writeVerdict(runId, st, writer, { verdict: "UNKNOWN", reason: `fault failed: ${e.message}` });
    return;
  }

  writer.append("FAULT_APPLIED", {
    run_id: st.run_id,
    trial_id: st.trial_id,
    arm: st.arm,
    receipt: receipt,
  });
  st.phase = "fault_done";
  saveState(runId, st);
  console.log(`fault applied: ${st.arm} (${st.fault_plan.label})`);

  // 6. Recovery: probe until the full chain answers again.
  const faultEndedAt = new Date().toISOString();
  const recovery = await probeRecovery(runId, { timeoutMs: 300000 });
  if (!recovery.recovered) {
    st.phase = "incomplete";
    saveState(runId, st);
    await writeVerdict(runId, st, writer, { verdict: "UNKNOWN", reason: "service did not recover within 300s" });
    return;
  }
  console.log(`service recovered in ${recovery.window_ms}ms`);

  // 7. POST snapshot + PG settings + WAL recovery logs.
  const post = await snapshotAttempt(runId, ev.attempt_id);
  const postEv = await writePgSnapshotEvidence(runId, st.trial_id, "post", post);
  const wal = st.arm.startsWith("D3") || st.arm.startsWith("D4") ? await captureWalRecoveryLog(runId, faultEndedAt) : { log: "", note: "not a db arm" };
  const pgSettings = await capturePgSettings(runId);
  const recoveryRef = `pg-recovery-${st.trial_id}.json`;
  atomicWriteJson(path.join(runPaths(runId).evidenceDir, recoveryRef), {
    arm: st.arm,
    fault_receipt: receipt,
    recovery,
    wal_recovery_log: wal,
    pg_settings: pgSettings,
    post_snapshot_ref: path.basename(postEv.file),
  });

  st.post_snapshot = { ref: path.basename(postEv.file), sha256: postEv.sha256, latency_ms: postEv.latencyMs };
  st.rto = { window_ms: recovery.window_ms, probe: recovery.url, first_ok_at: recovery.first_ok_at };
  st.phase = "service_recovered";
  saveState(runId, st);

  writer.append("SERVICE_RECOVERED", {
    run_id: st.run_id,
    trial_id: st.trial_id,
    arm: st.arm,
    rto_window_ms: recovery.window_ms,
    probe: recovery.url,
    pg_recovery_evidence_ref: `../evidence/${recoveryRef}`,
    note: st.arm === "D0" ? "no-fault arm: baseline reload checkpoint" : "service chain healthy; browser reload may proceed",
  });
  console.log("SERVICE_RECOVERED emitted; waiting for BROWSER_VERIFIED");
}

async function writeVerdict(runId, st, writer, { verdict, reason }) {
  // Per-question classification requires BOTH snapshots: with only the pre
  // snapshot a missing post row would masquerade as ACK_LOST.
  const perQuestion =
    st.pre_snapshot && st.post_snapshot
      ? classifyPerQuestion({
          manifestQuestions: st.manifest_questions,
          attemptRow: loadSnapshotRow(runId, st.post_snapshot?.ref),
          ackState: st.ack_state,
          browserState: st.phase === "verdict_phase" ? st.browser_state : null,
        })
      : null;
  const counts = {};
  for (const q of perQuestion ?? []) counts[q.classification] = (counts[q.classification] ?? 0) + 1;

  const mutation = oracleMutationRedTest();
  const finalVerdict = verdict ?? (counts.ACK_LOST > 0 ? "LOSS_OBSERVED" : "COMPLETE");

  const verdictBody = {
    schema_version: SCHEMA_VERSION,
    kind: "exam817/verdict",
    run_id: st.run_id,
    trial_id: st.trial_id,
    arm: st.arm,
    source_sha: BASE_SHA,
    verdict: finalVerdict,
    reason: reason ?? null,
    attempt_id: st.attempt_id,
    exam_id: st.exam_id,
    counts,
    per_question: perQuestion,
    rto: st.rto ?? null,
    fault: st.fault_terminal ?? null,
    fault_resolved: st.fault_resolved ?? null,
    oracle_mutation_test: { red: mutation.red, green: mutation.green, detail: mutation.detail },
    evidence_refs: {
      pre_snapshot: st.pre_snapshot ?? null,
      post_snapshot: st.post_snapshot ?? null,
      browser: st.browser_verified?.evidence_ref ?? null,
      deployment_identity: "deployment-identity.json",
    },
    window_error: st.window_error ?? null,
    generated_at: new Date().toISOString(),
  };
  atomicWriteJson(path.join(mailboxDir(runId), "verdict.json"), verdictBody);
  writer.append("VERDICT_PUBLISHED", {
    run_id: st.run_id,
    trial_id: st.trial_id,
    verdict: finalVerdict,
    counts,
    verdict_ref: "verdict.json",
    oracle_mutation_test: { red: mutation.red, green: mutation.green },
  });
  console.log(`verdict: ${finalVerdict} ${JSON.stringify(counts)}`);
}

function loadSnapshotRow(runId, snapshotFile) {
  if (!snapshotFile) return null;
  const p = path.join(runPaths(runId).evidenceDir, snapshotFile);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8")).row;
}

// ── cleanup / report ──────────────────────────────────────────────

async function cmdCleanup(runId, { deleteData = false } = {}) {
  const p = runPaths(runId);
  const project = `exam817-${runId}`;
  const { stdout: beforePs } = await execFileP(
    "docker",
    ["ps", "-a", "--filter", `label=com.docker.compose.project=${project}`, "--format", "{{.ID}} {{.Names}} {{.Status}}"],
  ).catch(() => ({ stdout: "" }));
  if (beforePs.trim().length > 0) {
    const { stdout } = await execFileP("docker", [
      "compose",
      "--env-file",
      p.envFile,
      "-f",
      "/home/hoo/Source/exam-817-harness/docker-compose.yml",
      "-p",
      project,
      "down",
    ]);
    console.log(stdout.trim().split("\n").slice(-4).join("\n"));
  }
  const { stdout: afterPs } = await execFileP(
    "docker",
    ["ps", "-a", "--filter", `label=com.docker.compose.project=${project}`, "--format", "{{.ID}}"],
  ).catch(() => ({ stdout: "" }));
  let dataDeleted = false;
  if (deleteData && afterPs.trim().length === 0) {
    // PGDATA files are owned by the container's postgres uid; deleting from
    // the host needs root. A throwaway container bind-mounts EXACTLY this
    // run's data root (never a parent) and removes its contents.
    await execFileP("docker", [
      "run",
      "--rm",
      "-v",
      `${p.dataRoot}:/target`,
      "alpine:latest",
      "sh",
      "-c",
      "rm -rf /target/postgres /target/redis && ls -A /target",
    ]).catch((e) => {
      throw new Error(`data cleanup container failed: ${e.message}`);
    });
    fs.rmSync(p.dataRoot, { recursive: true, force: true });
    dataDeleted = !fs.existsSync(p.dataRoot);
  }
  const receipt = {
    run_id: runId,
    cleaned_at: new Date().toISOString(),
    containers_before: beforePs.trim().split("\n").filter(Boolean),
    containers_after: afterPs.trim().split("\n").filter(Boolean),
    data_root_deleted: dataDeleted,
    data_root: deleteData ? p.dataRoot : "retained",
  };
  atomicWriteJson(path.join(p.evidenceDir, "cleanup-receipt.json"), receipt);
  console.log(JSON.stringify(receipt, null, 2));
}

function cmdStatus(runId) {
  const st = loadState(runId);
  const { run_id, trial_id, arm, phase, origin, exam_id, attempt_id } = st;
  console.log(JSON.stringify({ run_id, trial_id, arm, phase, origin, exam_id, attempt_id, acks: Object.keys(st.ack_state ?? {}).length }, null, 2));
}

function cmdReport(runId) {
  const st = loadState(runId);
  const vPath = path.join(mailboxDir(runId), "verdict.json");
  const verdict = fs.existsSync(vPath) ? JSON.parse(fs.readFileSync(vPath, "utf8")) : null;
  const ev = fs.existsSync(path.join(runPaths(runId).evidenceDir, "deployment-identity.json"))
    ? JSON.parse(fs.readFileSync(path.join(runPaths(runId).evidenceDir, "deployment-identity.json"), "utf8"))
    : null;
  console.log(JSON.stringify({
    BASE_SHA: BASE_SHA,
    RUN_ID: st.run_id,
    TRIAL_ID: st.trial_id,
    ARM: st.arm,
    PHASE: st.phase,
    TEST_PROJECT: ev?.project ?? `exam817-${st.run_id}`,
    PGDATA_IDENTITY: ev?.pgdata_mount ?? null,
    ORIGIN: st.origin,
    EXAM_ID: st.exam_id,
    RTO_MS: st.rto?.window_ms ?? null,
    VERDICT: verdict?.verdict ?? "NOT_READY",
    COUNTS: verdict?.counts ?? null,
  }, null, 2));
}

// ── main ──────────────────────────────────────────────────────────

function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const [cmd, runId] = process.argv.slice(2);
const argv = process.argv.slice(2);
const getOpt = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : dflt;
};

(async () => {
  switch (cmd) {
    case "init":
      cmdInit(argv.slice(1));
      break;
    case "deploy":
      await cmdDeploy(runId);
      break;
    case "seed":
      await cmdSeed(runId);
      break;
    case "publish":
      await cmdPublish(runId);
      break;
    case "wait":
      await cmdWait(runId, {
        timeoutSec: Number(getOpt("--timeout-sec", "7200")),
        browserTimeoutSec: Number(getOpt("--browser-timeout-sec", "900")),
      });
      break;
    case "status":
      cmdStatus(runId);
      break;
    case "cleanup":
      await cmdCleanup(runId, { deleteData: argv.includes("--delete-data") });
      break;
    case "report":
      cmdReport(runId);
      break;
    default:
      console.error(`usage: run.mjs <init|deploy|seed|publish|wait|status|cleanup|report> <run_id> [options]`);
      process.exit(2);
  }
})().catch((e) => {
  console.error(`FATAL: ${e.message}`);
  if (process.env.E817_DEBUG) console.error(e.stack);
  process.exit(1);
});
